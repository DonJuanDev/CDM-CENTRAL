import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const PROVIDERS = {
  meta_ads: { name: "Meta Ads", authUrl: "https://www.facebook.com/v18.0/dialog/oauth" },
  google_ads: { name: "Google Ads", authUrl: "https://accounts.google.com/o/oauth2/v2/auth" },
  google_analytics: { name: "Google Analytics", authUrl: "https://accounts.google.com/o/oauth2/v2/auth" },
  google_search_console: { name: "Google Search Console", authUrl: "https://accounts.google.com/o/oauth2/v2/auth" },
  tiktok_ads: { name: "TikTok Ads", authUrl: "https://business-api.tiktok.com/portal/auth" },
  whatsapp_business: { name: "WhatsApp Business", authUrl: "https://www.facebook.com/v18.0/dialog/oauth" },
  canva: { name: "Canva", authUrl: "https://www.canva.com/api/oauth/authorize" },
  google_calendar: { name: "Google Calendar", authUrl: "https://accounts.google.com/o/oauth2/v2/auth" },
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const body = req.method !== "GET" ? await req.json().catch(() => ({})) : {};

    switch (action) {
      case "list_providers":
        return json({ providers: PROVIDERS });

      case "connect": {
        const { provider, client_id, settings } = body;
        if (!provider || !PROVIDERS[provider as keyof typeof PROVIDERS]) {
          return json({ error: "Invalid provider" }, 400);
        }
        const { data, error } = await supabase.from("integrations").upsert({
          provider,
          client_id: client_id || null,
          status: "connected",
          settings: settings || {},
          created_by: user.id,
          last_sync: new Date().toISOString(),
        }, { onConflict: "provider,client_id" }).select().single();
        if (error) throw error;
        await supabase.from("integration_sync_logs").insert({
          integration_id: data.id,
          status: "connected",
          records_synced: 0,
        });
        return json({ integration: data, message: `${PROVIDERS[provider as keyof typeof PROVIDERS].name} conectado` });
      }

      case "sync": {
        const { integration_id } = body;
        const { data: integration } = await supabase
          .from("integrations")
          .select("*")
          .eq("id", integration_id)
          .single();

        if (!integration) return json({ error: "Integration not found" }, 404);

        // Placeholder: cada provider terá lógica de sync específica
        const syncResult = await syncProvider(integration);

        await supabase.from("integrations").update({
          last_sync: new Date().toISOString(),
          status: "connected",
        }).eq("id", integration_id);

        await supabase.from("integration_sync_logs").insert({
          integration_id,
          status: "success",
          records_synced: syncResult.records,
        });

        return json({ success: true, ...syncResult });
      }

      case "disconnect": {
        const { integration_id } = body;
        await supabase.from("integrations").update({ status: "disconnected" }).eq("id", integration_id);
        return json({ success: true });
      }

      default:
        return json({
          endpoints: {
            "GET ?action=list_providers": "Lista providers disponíveis",
            "POST ?action=connect": "Conecta integração { provider, client_id, settings }",
            "POST ?action=sync": "Sincroniza dados { integration_id }",
            "POST ?action=disconnect": "Desconecta { integration_id }",
          },
        });
    }
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});

async function syncProvider(integration: Record<string, unknown>) {
  const provider = integration.provider as string;
  // Estrutura pronta — implementar fetch real por provider com credenciais do vault
  const mockData: Record<string, { records: number; metrics: Record<string, number> }> = {
    meta_ads: { records: 12, metrics: { impressions: 45000, clicks: 1200, spend: 850 } },
    google_ads: { records: 8, metrics: { impressions: 32000, clicks: 980, spend: 620 } },
    google_analytics: { records: 30, metrics: { sessions: 15000, users: 9800, bounce_rate: 32 } },
    tiktok_ads: { records: 5, metrics: { impressions: 120000, clicks: 4500, spend: 400 } },
  };
  return mockData[provider] || { records: 0, metrics: {} };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
