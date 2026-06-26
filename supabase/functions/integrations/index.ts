import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const META_GRAPH = "https://graph.facebook.com/v21.0";
const APP_URL = "https://cdm-central.vercel.app";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ──────────────────────────────────────────────────────────────
// META ADS SYNC
// Busca campanhas + insights do mês atual e faz upsert na tabela campaigns
// ──────────────────────────────────────────────────────────────
async function syncMetaAds(
  supabase: ReturnType<typeof createClient>,
  integration: Record<string, unknown>
): Promise<{ records: number; campaigns: number; period: string }> {
  const settings = (integration.settings ?? {}) as Record<string, string>;
  const token = settings.access_token;
  const rawAccountId = settings.ad_account_id;

  if (!token) throw new Error("Access Token não configurado");
  if (!rawAccountId) throw new Error("Ad Account ID não configurado");

  const clientId = integration.client_id as string;
  if (!clientId) throw new Error("Cliente CDM não associado à integração");

  const accountId = rawAccountId.startsWith("act_") ? rawAccountId : `act_${rawAccountId}`;

  // 1 – Buscar campanhas
  const campaignsRes = await fetch(
    `${META_GRAPH}/${accountId}/campaigns` +
    `?fields=id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time` +
    `&access_token=${token}&limit=200`
  );

  if (!campaignsRes.ok) {
    const err = (await campaignsRes.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`Meta API (campanhas): ${err.error?.message ?? campaignsRes.statusText}`);
  }

  const campaignsPayload = await campaignsRes.json() as { data: Array<Record<string, string>> };
  const campaigns = campaignsPayload.data ?? [];
  if (!campaigns.length) return { records: 0, campaigns: 0, period: "" };

  // 2 – Buscar insights do mês atual
  const now = new Date();
  const since = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const until = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const insightsRes = await fetch(
    `${META_GRAPH}/${accountId}/insights` +
    `?fields=campaign_id,spend,impressions,clicks,reach,frequency,actions,action_values` +
    `&time_range={"since":"${since}","until":"${until}"}` +
    `&level=campaign&access_token=${token}&limit=200`
  );

  const insightsPayload = insightsRes.ok
    ? (await insightsRes.json() as { data: Array<Record<string, unknown>> })
    : { data: [] };
  const insights = insightsPayload.data ?? [];

  // Map de insights por campaign_id
  const insightMap: Record<string, Record<string, unknown>> = {};
  for (const ins of insights) insightMap[ins.campaign_id as string] = ins;

  const statusMap: Record<string, string> = {
    ACTIVE: "ativa",
    PAUSED: "pausada",
    DELETED: "concluida",
    ARCHIVED: "concluida",
  };

  let synced = 0;

  for (const campaign of campaigns) {
    const ins = insightMap[campaign.id] ?? {};
    const actions = (ins.actions ?? []) as Array<Record<string, string>>;
    const actionValues = (ins.action_values ?? []) as Array<Record<string, string>>;

    const spent = parseFloat(String(ins.spend ?? "0"));
    const impressions = parseInt(String(ins.impressions ?? "0"));
    const clicks = parseInt(String(ins.clicks ?? "0"));
    const reach = parseInt(String(ins.reach ?? "0"));

    const leadAction = actions.find(
      (a) => a.action_type === "lead" || a.action_type === "offsite_conversion.fb_pixel_lead"
    );
    const leads = parseInt(leadAction?.value ?? "0");

    const revenueAction = actionValues.find(
      (a) => a.action_type === "offsite_conversion.fb_pixel_purchase" || a.action_type === "purchase"
    );
    const revenue = parseFloat(revenueAction?.value ?? "0");

    const roas = spent > 0 && revenue > 0 ? parseFloat((revenue / spent).toFixed(2)) : 0;
    const cpa = leads > 0 && spent > 0 ? parseFloat((spent / leads).toFixed(2)) : 0;

    // Budget: Meta retorna em centavos para algumas moedas
    const rawBudget = parseFloat(campaign.daily_budget ?? campaign.lifetime_budget ?? "0");
    const budget = rawBudget > 1000 ? rawBudget / 100 : rawBudget; // heurística simples

    const payload = {
      client_id: clientId,
      name: campaign.name,
      platform: "meta_ads",
      status: (statusMap[campaign.status] ?? "rascunho") as "rascunho" | "ativa" | "pausada" | "concluida",
      budget,
      spent,
      roas,
      leads,
      cpa,
      external_id: campaign.id,
      metadata: {
        impressions,
        clicks,
        reach,
        objective: campaign.objective,
        meta_status: campaign.status,
        period_since: since,
        period_until: until,
        synced_at: new Date().toISOString(),
      },
    };

    const { error } = await supabase
      .from("campaigns")
      .upsert(payload, { onConflict: "external_id" });

    if (!error) synced++;
  }

  return { records: synced, campaigns: campaigns.length, period: `${since} → ${until}` };
}

// ──────────────────────────────────────────────────────────────
// HANDLER PRINCIPAL
// ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "";
    const body: Record<string, unknown> =
      req.method === "POST" ? await req.json().catch(() => ({})) : {};

    // ── OAUTH CALLBACK (sem auth header — vem de redirect do browser) ──
    if (action === "oauth_callback") {
      const code = url.searchParams.get("code");
      const stateRaw = url.searchParams.get("state");
      const oauthError = url.searchParams.get("error");

      if (oauthError || !code || !stateRaw) {
        return Response.redirect(
          `${APP_URL}/app.html#/integracoes?oauth_error=${oauthError ?? "missing"}`,
          302
        );
      }

      let state: Record<string, string>;
      try {
        state = JSON.parse(atob(stateRaw));
      } catch {
        return Response.redirect(`${APP_URL}/app.html#/integracoes?oauth_error=bad_state`, 302);
      }

      if (state.provider === "meta_ads") {
        const appId = Deno.env.get("META_APP_ID");
        const appSecret = Deno.env.get("META_APP_SECRET");
        const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/integrations?action=oauth_callback`;

        if (appId && appSecret && state.integration_id) {
          // Troca code → short-lived token
          const tokenRes = await fetch(
            `${META_GRAPH}/oauth/access_token` +
            `?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&client_secret=${appSecret}&code=${code}`
          );
          const tokenData = (await tokenRes.json()) as { access_token?: string };

          if (tokenData.access_token) {
            // Troca short-lived → long-lived (60 dias)
            const exchangeRes = await fetch(
              `${META_GRAPH}/oauth/access_token` +
              `?grant_type=fb_exchange_token&client_id=${appId}` +
              `&client_secret=${appSecret}&fb_exchange_token=${tokenData.access_token}`
            );
            const exchangeData = (await exchangeRes.json()) as { access_token?: string };
            const finalToken = exchangeData.access_token ?? tokenData.access_token;

            await supabase.from("integrations").update({
              status: "connected",
              settings: { access_token: finalToken },
              last_sync: new Date().toISOString(),
            }).eq("id", state.integration_id);
          }
        }
      }

      return Response.redirect(
        `${APP_URL}/app.html#/integracoes?oauth_connected=${state.provider}`,
        302
      );
    }

    // ── TODAS AS OUTRAS ACTIONS PRECISAM DE AUTH ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) return json({ error: "Token inválido" }, 401);

    // ── ACTIONS ──
    switch (action) {
      case "list": {
        const { data, error } = await supabase
          .from("integrations")
          .select("*, clients(id, company_name)")
          .order("created_at", { ascending: false });
        if (error) throw error;
        return json({ integrations: data ?? [] });
      }

      case "connect": {
        const { provider, client_id, settings } = body as {
          provider?: string;
          client_id?: string;
          settings?: Record<string, string>;
        };

        if (!provider) return json({ error: "provider é obrigatório" }, 400);

        // Valida token do Meta antes de salvar
        if (provider === "meta_ads" && settings?.access_token) {
          const meRes = await fetch(
            `${META_GRAPH}/me?access_token=${settings.access_token}&fields=id,name`
          );
          if (!meRes.ok) {
            const meErr = (await meRes.json().catch(() => ({}))) as { error?: { message?: string } };
            return json(
              { error: `Token Meta inválido: ${meErr.error?.message ?? "Falha na validação"}` },
              400
            );
          }
        }

        const { data, error } = await supabase
          .from("integrations")
          .upsert(
            {
              provider,
              client_id: client_id ?? null,
              status: "connected",
              settings: settings ?? {},
              created_by: user.id,
              last_sync: new Date().toISOString(),
            },
            { onConflict: "provider,client_id" }
          )
          .select("*, clients(company_name)")
          .single();

        if (error) throw error;

        await supabase.from("integration_sync_logs").insert({
          integration_id: data.id,
          status: "connected",
          records_synced: 0,
        });

        return json({ integration: data, success: true });
      }

      case "sync": {
        const { integration_id } = body as { integration_id?: string };
        if (!integration_id) return json({ error: "integration_id é obrigatório" }, 400);

        const { data: integration } = await supabase
          .from("integrations")
          .select("*")
          .eq("id", integration_id)
          .single();

        if (!integration) return json({ error: "Integração não encontrada" }, 404);

        await supabase.from("integrations").update({ status: "syncing" }).eq("id", integration_id);

        let result = { records: 0, campaigns: 0, period: "" };

        try {
          if (integration.provider === "meta_ads") {
            result = await syncMetaAds(supabase, integration);
          } else {
            throw new Error(`Sync não implementado para ${integration.provider}`);
          }

          await supabase.from("integrations").update({
            status: "connected",
            last_sync: new Date().toISOString(),
          }).eq("id", integration_id);

          await supabase.from("integration_sync_logs").insert({
            integration_id,
            status: "success",
            records_synced: result.records,
          });
        } catch (e) {
          await supabase.from("integrations").update({ status: "error" }).eq("id", integration_id);
          await supabase.from("integration_sync_logs").insert({
            integration_id,
            status: "error",
            error_message: (e as Error).message,
            records_synced: 0,
          });
          throw e;
        }

        return json({ success: true, ...result });
      }

      case "disconnect": {
        const { integration_id } = body as { integration_id?: string };
        if (!integration_id) return json({ error: "integration_id é obrigatório" }, 400);

        await supabase.from("integrations").update({
          status: "disconnected",
          settings: {},
        }).eq("id", integration_id);

        return json({ success: true });
      }

      case "oauth_start": {
        const { provider, client_id } = body as { provider?: string; client_id?: string };

        if (provider !== "meta_ads") {
          return json({ error: "OAuth disponível apenas para Meta Ads no momento" }, 400);
        }

        const appId = Deno.env.get("META_APP_ID");
        if (!appId) {
          return json(
            { error: "META_APP_ID não configurado. Adicione nas secrets da Edge Function no Supabase." },
            400
          );
        }

        // Cria / recupera a integração para ter um ID para o state
        const { data: integration } = await supabase
          .from("integrations")
          .upsert(
            {
              provider: "meta_ads",
              client_id: client_id ?? null,
              status: "disconnected",
              settings: {},
              created_by: user.id,
            },
            { onConflict: "provider,client_id" }
          )
          .select("id")
          .single();

        const state = btoa(JSON.stringify({
          provider,
          integration_id: integration?.id,
          user_id: user.id,
        }));

        const redirectUri = encodeURIComponent(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/integrations?action=oauth_callback`
        );
        const scope = encodeURIComponent("ads_read,business_management,ads_management");
        const authUrl =
          `https://www.facebook.com/v21.0/dialog/oauth` +
          `?client_id=${appId}&redirect_uri=${redirectUri}` +
          `&scope=${scope}&state=${state}&response_type=code`;

        return json({ auth_url: authUrl });
      }

      default:
        return json({
          message: "Integrações CDM Central",
          available_actions: ["list", "connect", "sync", "disconnect", "oauth_start", "oauth_callback"],
        });
    }
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
