import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const META_GRAPH = "https://graph.facebook.com/v21.0";
const APP_URL = "https://cdm-central.vercel.app";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Settings = {
  access_token?: string;
  mode?: string;
  ad_account_id?: string;
  ad_account_mappings?: Record<string, string>;
  last_sync_summary?: Record<string, unknown>;
};

type AdAccount = { id: string; name: string; account_id?: string };
type CdmClient = { id: string; company_name: string };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchClientForAccount(
  accountName: string,
  clients: CdmClient[],
  manualMappings: Record<string, string>,
  accountId: string
): CdmClient | null {
  if (manualMappings[accountId]) {
    return clients.find((c) => c.id === manualMappings[accountId]) ?? null;
  }

  const normalizedAccount = normalizeName(accountName);
  if (!normalizedAccount) return null;

  let best: CdmClient | null = null;
  let bestScore = 0;

  for (const client of clients) {
    const normalizedClient = normalizeName(client.company_name);
    if (!normalizedClient) continue;

    if (normalizedAccount === normalizedClient) return client;
    if (normalizedAccount.includes(normalizedClient) || normalizedClient.includes(normalizedAccount)) {
      const score = Math.min(normalizedAccount.length, normalizedClient.length);
      if (score > bestScore) {
        best = client;
        bestScore = score;
      }
      continue;
    }

    const accountTokens = normalizedAccount.split(" ").filter((t) => t.length > 2);
    const clientTokens = normalizedClient.split(" ").filter((t) => t.length > 2);
    const overlap = accountTokens.filter((t) =>
      clientTokens.some((ct) => ct.includes(t) || t.includes(ct))
    ).length;
    if (overlap > 0 && overlap > bestScore) {
      best = client;
      bestScore = overlap;
    }
  }

  return bestScore >= 1 ? best : null;
}

async function fetchMetaAdAccounts(token: string): Promise<AdAccount[]> {
  const accounts: AdAccount[] = [];
  let nextUrl: string | null =
    `${META_GRAPH}/me/adaccounts?fields=id,name,account_id,account_status&limit=100&access_token=${encodeURIComponent(token)}`;

  while (nextUrl) {
    const res = await fetch(nextUrl);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(`Meta API (contas): ${err.error?.message ?? res.statusText}`);
    }
    const payload = await res.json() as {
      data?: AdAccount[];
      paging?: { next?: string };
    };
    accounts.push(...(payload.data ?? []));
    nextUrl = payload.paging?.next ?? null;
  }

  return accounts;
}

async function validateMetaToken(token: string): Promise<{ id: string; name: string }> {
  const meRes = await fetch(
    `${META_GRAPH}/me?access_token=${encodeURIComponent(token)}&fields=id,name`
  );
  if (!meRes.ok) {
    const meErr = (await meRes.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`Token Meta inválido: ${meErr.error?.message ?? "Falha na validação"}`);
  }
  return await meRes.json();
}

async function syncSingleAdAccount(
  supabase: ReturnType<typeof createClient>,
  token: string,
  rawAccountId: string,
  clientId: string,
  accountName: string
): Promise<{ records: number; campaigns: number; period: string }> {
  const accountId = rawAccountId.startsWith("act_") ? rawAccountId : `act_${rawAccountId}`;

  const campaignsRes = await fetch(
    `${META_GRAPH}/${accountId}/campaigns` +
    `?fields=id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time` +
    `&access_token=${encodeURIComponent(token)}&limit=200`
  );

  if (!campaignsRes.ok) {
    const err = (await campaignsRes.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`Meta API (${accountName}): ${err.error?.message ?? campaignsRes.statusText}`);
  }

  const campaignsPayload = await campaignsRes.json() as { data: Array<Record<string, string>> };
  const campaigns = campaignsPayload.data ?? [];
  if (!campaigns.length) return { records: 0, campaigns: 0, period: "" };

  const now = new Date();
  const since = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const until = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const insightsRes = await fetch(
    `${META_GRAPH}/${accountId}/insights` +
    `?fields=campaign_id,spend,impressions,clicks,reach,frequency,actions,action_values` +
    `&time_range={"since":"${since}","until":"${until}"}` +
    `&level=campaign&access_token=${encodeURIComponent(token)}&limit=200`
  );

  const insightsPayload = insightsRes.ok
    ? (await insightsRes.json() as { data: Array<Record<string, unknown>> })
    : { data: [] };
  const insights = insightsPayload.data ?? [];

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

    const rawBudget = parseFloat(campaign.daily_budget ?? campaign.lifetime_budget ?? "0");
    const budget = rawBudget > 1000 ? rawBudget / 100 : rawBudget;

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
        meta_ad_account_id: accountId,
        meta_ad_account_name: accountName,
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

async function syncMetaAdsBusinessManager(
  supabase: ReturnType<typeof createClient>,
  integration: Record<string, unknown>
): Promise<{
  records: number;
  campaigns: number;
  period: string;
  accounts_synced: number;
  accounts_total: number;
  unmatched: Array<{ id: string; name: string }>;
}> {
  const settings = (integration.settings ?? {}) as Settings;
  const token = settings.access_token;
  if (!token) throw new Error("Access Token não configurado");

  const manualMappings = settings.ad_account_mappings ?? {};
  const { data: clients } = await supabase
    .from("clients")
    .select("id, company_name")
    .eq("status", "ativo");

  const cdmClients = (clients ?? []) as CdmClient[];
  const adAccounts = await fetchMetaAdAccounts(token);

  let totalRecords = 0;
  let totalCampaigns = 0;
  let accountsSynced = 0;
  let period = "";
  const unmatched: Array<{ id: string; name: string }> = [];

  for (const account of adAccounts) {
    const accountId = account.id;
    const matchedClient = matchClientForAccount(account.name, cdmClients, manualMappings, accountId);

    if (!matchedClient) {
      unmatched.push({ id: accountId, name: account.name });
      continue;
    }

    const result = await syncSingleAdAccount(
      supabase,
      token,
      accountId,
      matchedClient.id,
      account.name
    );

    totalRecords += result.records;
    totalCampaigns += result.campaigns;
    if (result.period) period = result.period;
    accountsSynced++;
  }

  return {
    records: totalRecords,
    campaigns: totalCampaigns,
    period,
    accounts_synced: accountsSynced,
    accounts_total: adAccounts.length,
    unmatched,
  };
}

async function syncMetaAdsLegacy(
  supabase: ReturnType<typeof createClient>,
  integration: Record<string, unknown>
): Promise<{ records: number; campaigns: number; period: string }> {
  const settings = (integration.settings ?? {}) as Settings;
  const token = settings.access_token;
  const rawAccountId = settings.ad_account_id;
  const clientId = integration.client_id as string;

  if (!token) throw new Error("Access Token não configurado");
  if (!rawAccountId) throw new Error("Ad Account ID não configurado");
  if (!clientId) throw new Error("Cliente CDM não associado à integração");

  return syncSingleAdAccount(supabase, token, rawAccountId, clientId, rawAccountId);
}

async function upsertMasterIntegration(
  supabase: ReturnType<typeof createClient>,
  provider: string,
  userId: string,
  settings: Settings
) {
  const { data: existing } = await supabase
    .from("integrations")
    .select("id, settings")
    .eq("provider", provider)
    .is("client_id", null)
    .maybeSingle();

  const mergedSettings = {
    ...((existing?.settings ?? {}) as Settings),
    ...settings,
    mode: "business_manager",
  };

  if (existing?.id) {
    const { data, error } = await supabase
      .from("integrations")
      .update({
        status: "connected",
        settings: mergedSettings,
        last_sync: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("*, clients(company_name)")
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from("integrations")
    .insert({
      provider,
      client_id: null,
      status: "connected",
      settings: mergedSettings,
      created_by: userId,
      last_sync: new Date().toISOString(),
    })
    .select("*, clients(company_name)")
    .single();
  if (error) throw error;
  return data;
}

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
          const tokenRes = await fetch(
            `${META_GRAPH}/oauth/access_token` +
            `?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&client_secret=${appSecret}&code=${code}`
          );
          const tokenData = (await tokenRes.json()) as { access_token?: string };

          if (tokenData.access_token) {
            const exchangeRes = await fetch(
              `${META_GRAPH}/oauth/access_token` +
              `?grant_type=fb_exchange_token&client_id=${appId}` +
              `&client_secret=${appSecret}&fb_exchange_token=${tokenData.access_token}`
            );
            const exchangeData = (await exchangeRes.json()) as { access_token?: string };
            const finalToken = exchangeData.access_token ?? tokenData.access_token;

            await supabase.from("integrations").update({
              status: "connected",
              settings: { access_token: finalToken, mode: "business_manager" },
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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) return json({ error: "Token inválido" }, 401);

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
        const { provider, client_id, settings, mode } = body as {
          provider?: string;
          client_id?: string;
          settings?: Settings;
          mode?: string;
        };

        if (!provider) return json({ error: "provider é obrigatório" }, 400);

        const token = settings?.access_token;
        if (provider === "meta_ads" && token) {
          await validateMetaToken(token);
        }

        const isBusinessManager =
          provider === "meta_ads" && (mode === "business_manager" || !client_id);

        if (isBusinessManager) {
          const adAccounts = token ? await fetchMetaAdAccounts(token) : [];
          const data = await upsertMasterIntegration(supabase, provider, user.id, {
            access_token: token,
            mode: "business_manager",
            ad_account_mappings: settings?.ad_account_mappings ?? {},
          });

          await supabase.from("integration_sync_logs").insert({
            integration_id: data.id,
            status: "connected",
            records_synced: adAccounts.length,
          });

          return json({
            integration: data,
            success: true,
            ad_accounts_found: adAccounts.length,
          });
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

      case "list_ad_accounts": {
        const { integration_id } = body as { integration_id?: string };
        if (!integration_id) return json({ error: "integration_id é obrigatório" }, 400);

        const { data: integration } = await supabase
          .from("integrations")
          .select("*")
          .eq("id", integration_id)
          .single();

        if (!integration) return json({ error: "Integração não encontrada" }, 404);

        const settings = (integration.settings ?? {}) as Settings;
        const token = settings.access_token;
        if (!token) return json({ error: "Token não configurado" }, 400);

        const manualMappings = settings.ad_account_mappings ?? {};
        const { data: clients } = await supabase
          .from("clients")
          .select("id, company_name")
          .eq("status", "ativo");

        const cdmClients = (clients ?? []) as CdmClient[];
        const adAccounts = await fetchMetaAdAccounts(token);

        const accounts = adAccounts.map((account) => {
          const matched = matchClientForAccount(
            account.name,
            cdmClients,
            manualMappings,
            account.id
          );
          return {
            id: account.id,
            name: account.name,
            account_id: account.account_id ?? account.id.replace("act_", ""),
            matched_client_id: matched?.id ?? null,
            matched_client_name: matched?.company_name ?? null,
            manual_mapping: !!manualMappings[account.id],
          };
        });

        return json({ accounts, total: accounts.length });
      }

      case "save_mappings": {
        const { integration_id, mappings } = body as {
          integration_id?: string;
          mappings?: Record<string, string>;
        };
        if (!integration_id) return json({ error: "integration_id é obrigatório" }, 400);

        const { data: integration } = await supabase
          .from("integrations")
          .select("settings")
          .eq("id", integration_id)
          .single();

        if (!integration) return json({ error: "Integração não encontrada" }, 404);

        const settings = (integration.settings ?? {}) as Settings;
        const { data, error } = await supabase
          .from("integrations")
          .update({
            settings: {
              ...settings,
              ad_account_mappings: mappings ?? {},
            },
          })
          .eq("id", integration_id)
          .select("*")
          .single();

        if (error) throw error;
        return json({ success: true, integration: data });
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

        try {
          const settings = (integration.settings ?? {}) as Settings;
          const isBusinessManager =
            settings.mode === "business_manager" ||
            (!integration.client_id && !settings.ad_account_id);

          let result: Record<string, unknown>;

          if (integration.provider === "meta_ads" && isBusinessManager) {
            const bulk = await syncMetaAdsBusinessManager(supabase, integration);
            result = { success: true, ...bulk };

            await supabase.from("integrations").update({
              status: "connected",
              last_sync: new Date().toISOString(),
              settings: {
                ...settings,
                last_sync_summary: {
                  accounts_synced: bulk.accounts_synced,
                  accounts_total: bulk.accounts_total,
                  records: bulk.records,
                  unmatched: bulk.unmatched,
                  synced_at: new Date().toISOString(),
                },
              },
            }).eq("id", integration_id);

            await supabase.from("integration_sync_logs").insert({
              integration_id,
              status: bulk.unmatched.length ? "partial" : "success",
              records_synced: bulk.records,
              error_message: bulk.unmatched.length
                ? `${bulk.unmatched.length} conta(s) sem cliente vinculado`
                : null,
            });
          } else if (integration.provider === "meta_ads") {
            const single = await syncMetaAdsLegacy(supabase, integration);
            result = { success: true, ...single };

            await supabase.from("integrations").update({
              status: "connected",
              last_sync: new Date().toISOString(),
            }).eq("id", integration_id);

            await supabase.from("integration_sync_logs").insert({
              integration_id,
              status: "success",
              records_synced: single.records,
            });
          } else {
            throw new Error(`Sync não implementado para ${integration.provider}`);
          }

          return json(result);
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
        const { provider } = body as { provider?: string };

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

        const data = await upsertMasterIntegration(supabase, "meta_ads", user.id, {});

        const state = btoa(JSON.stringify({
          provider,
          integration_id: data.id,
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
          available_actions: [
            "list", "connect", "sync", "disconnect", "oauth_start", "oauth_callback",
            "list_ad_accounts", "save_mappings",
          ],
        });
    }
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
