import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CANVA_API = "https://api.canva.com/rest/v1";
const CANVA_TOKEN = "https://api.canva.com/rest/v1/oauth/token";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type CanvaSettings = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  folder_mappings?: Record<string, string>;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function classifyTitle(title = "") {
  const t = title.toLowerCase();
  if (/aprova|legenda para apro/.test(t)) return { role: "qa", content_type: "aprovacao" };
  if (/marca|identidade|brand|logo/.test(t)) return { role: "brand", content_type: "marca" };
  if (/an[uú]ncio|\bads\b|meta ads/.test(t)) return { role: "roteirista_ads", content_type: "anuncio" };
  if (/v[ií]deo|reels|institucional|videomaker|roteiro/.test(t)) {
    return { role: "roteirista", content_type: "roteiro" };
  }
  if (/carrossel/.test(t)) return { role: "social", content_type: "carrossel" };
  if (/\bpost\b/.test(t)) return { role: "social", content_type: "post" };
  return { role: "social", content_type: "post" };
}

const ROLE_PROMPTS: Record<string, string> = {
  social:
    "Você é o Social Media da agência CDM Marketing (películas automotivas, PPF, farmácia, software). Escreva copy de Instagram em português do Brasil: headline curta, legenda envolvente, CTA. Tom direto, comercial, sem enrolação.",
  roteirista:
    "Você é roteirista de videomaker da CDM. Entregue roteiro em português: gancho (3s), desenvolvimento, CTA. Formato Reels/TikTok ou institucional conforme o briefing.",
  roteirista_ads:
    "Você é roteirista de anúncios pagos da CDM (Meta Ads). Entregue script curto para UGC/ads: gancho forte, prova, oferta, CTA. Português do Brasil.",
  brand:
    "Você é Brand da CDM. Analise a identidade visual do cliente (Canva) e proponha direção criativa: cores, tom, o que repetir/evitar. Português do Brasil.",
  qa:
    "Você é QA de conteúdo da CDM. Revise o texto: tom da marca, CTA claro, erros, clichês. Devolva versão corrigida + notas curtas.",
  ceo:
    "Você é o CEO/PM da CDM. Priorize e resuma o briefing executivo da task em 3 bullets.",
};

async function refreshCanvaToken(refreshToken: string) {
  const clientId = Deno.env.get("CANVA_CLIENT_ID")!;
  const clientSecret = Deno.env.get("CANVA_CLIENT_SECRET")!;
  const res = await fetch(CANVA_TOKEN, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error("Falha ao renovar token Canva");
  return await res.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
}

async function getCanvaToken(
  supabase: ReturnType<typeof createClient>,
  integration: { id: string; settings?: CanvaSettings | null }
): Promise<string | null> {
  const settings = (integration.settings ?? {}) as CanvaSettings;
  if (!settings.access_token) return null;

  if ((settings.expires_at ?? 0) > Date.now() + 60_000) {
    return settings.access_token;
  }
  if (!settings.refresh_token || !Deno.env.get("CANVA_CLIENT_ID")) {
    return settings.access_token; // try anyway
  }

  try {
    const tokenData = await refreshCanvaToken(settings.refresh_token);
    const next: CanvaSettings = {
      ...settings,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token ?? settings.refresh_token,
      expires_at: Date.now() + (tokenData.expires_in ?? 14400) * 1000,
    };
    await supabase.from("integrations").update({ settings: next }).eq("id", integration.id);
    return tokenData.access_token;
  } catch {
    return settings.access_token;
  }
}

async function fetchDesignThumbnail(token: string, designId: string): Promise<string | null> {
  try {
    const res = await fetch(`${CANVA_API}/designs/${designId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.thumbnail?.url ?? null;
  } catch {
    return null;
  }
}

async function imageToBase64(url: string): Promise<{ media_type: string; data: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    // Cap ~1.5MB
    if (buf.byteLength > 1_500_000) return null;
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const data = btoa(binary);
    const ct = res.headers.get("content-type") || "image/png";
    const media_type = ct.includes("jpeg") || ct.includes("jpg")
      ? "image/jpeg"
      : ct.includes("webp")
      ? "image/webp"
      : "image/png";
    return { media_type, data };
  } catch {
    return null;
  }
}

function extractJson(text: string): Record<string, string> {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : text;
  const brace = raw.match(/\{[\s\S]*\}/);
  if (!brace) {
    return { caption: text.trim(), notes: "" };
  }
  try {
    return JSON.parse(brace[0]);
  } catch {
    return { caption: text.trim(), notes: "" };
  }
}

async function callClaude(opts: {
  system: string;
  userText: string;
  images?: Array<{ media_type: string; data: string }>;
}): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY não configurada nas secrets da Edge Function.");

  const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-5";

  const content: Array<Record<string, unknown>> = [];
  for (const img of opts.images ?? []) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.media_type,
        data: img.data,
      },
    });
  }
  content.push({ type: "text", text: opts.userText });

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: opts.system,
      messages: [{ role: "user", content }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  const parts = (data.content ?? []) as Array<{ type: string; text?: string }>;
  return parts.filter((p) => p.type === "text").map((p) => p.text || "").join("\n");
}

async function runSingleTask(
  supabase: ReturnType<typeof createClient>,
  taskId: string,
  userId: string
) {
  const { data: task, error: taskErr } = await supabase
    .from("tasks")
    .select("id, title, description, client_id, client_names, due_date, status, clients(id, company_name, notes, icon)")
    .eq("id", taskId)
    .single();

  if (taskErr || !task) throw new Error("Task não encontrada");

  const { role, content_type } = classifyTitle(task.title);

  const { data: job, error: jobErr } = await supabase
    .from("office_jobs")
    .insert({
      task_id: task.id,
      agent_role: role,
      content_type,
      status: "queued",
      created_by: userId,
    })
    .select("*")
    .single();

  if (jobErr || !job) throw new Error(jobErr?.message || "Falha ao criar job");

  try {
    await supabase.from("office_jobs").update({ status: "studying" }).eq("id", job.id);

    const clientId = task.client_id as string | null;
    const client = task.clients as {
      company_name?: string;
      notes?: string;
    } | null;

    let designs: Array<{
      design_id: string;
      title: string;
      thumbnail_url: string | null;
    }> = [];
    let warning: string | undefined;

    const { data: canvaIntegration } = await supabase
      .from("integrations")
      .select("id, status, settings")
      .eq("provider", "canva")
      .is("client_id", null)
      .eq("status", "connected")
      .maybeSingle();

    if (!canvaIntegration) {
      warning = "Canva desconectado — gerando só com notas do cliente e briefing.";
    } else if (!clientId) {
      warning = "Task sem cliente — sem artes Canva específicas.";
    } else {
      const { data: catalog } = await supabase
        .from("canva_designs")
        .select("design_id, title, thumbnail_url, updated_at_canva")
        .eq("client_id", clientId)
        .order("updated_at_canva", { ascending: false, nullsFirst: false })
        .limit(6);

      designs = (catalog ?? []).map((d) => ({
        design_id: d.design_id,
        title: d.title || "Sem título",
        thumbnail_url: d.thumbnail_url,
      }));

      if (!designs.length) {
        warning = "Nenhuma arte Canva vinculada a este cliente. Vincule pastas em Integrações.";
      } else {
        const token = await getCanvaToken(supabase, canvaIntegration);
        if (token) {
          for (const d of designs.slice(0, 4)) {
            const fresh = await fetchDesignThumbnail(token, d.design_id);
            if (fresh) d.thumbnail_url = fresh;
          }
        }
      }
    }

    const canva_context = {
      warning,
      client: client?.company_name || task.client_names || null,
      client_notes: client?.notes || null,
      designs: designs.map((d) => ({
        design_id: d.design_id,
        title: d.title,
        thumbnail_url: d.thumbnail_url,
      })),
    };

    await supabase
      .from("office_jobs")
      .update({ status: "writing", canva_context })
      .eq("id", job.id);

    const images: Array<{ media_type: string; data: string }> = [];
    for (const d of designs.slice(0, 3)) {
      if (!d.thumbnail_url) continue;
      const img = await imageToBase64(d.thumbnail_url);
      if (img) images.push(img);
    }

    const designList = designs.map((d) => `- ${d.title}`).join("\n") || "(nenhuma)";
    const userText = `TASK / BRIEFING
Título: ${task.title}
Cliente: ${client?.company_name || task.client_names || "—"}
Descrição atual: ${task.description || "(vazia)"}
Notas do cliente: ${client?.notes || "(nenhuma)"}
Tipo detectado: ${content_type}
Cargo: ${role}

ARTES CANVA RECENTES DESTE CLIENTE:
${designList}
${warning ? `\nAVISO: ${warning}` : ""}

Responda APENAS com JSON válido neste formato:
{
  "headline": "...",
  "caption": "...",
  "script": "...",
  "cta": "...",
  "notes": "..."
}
Preencha os campos relevantes ao tipo (post → headline+caption+cta; roteiro → script+cta; brand → notes+headline; etc).`;

    const system = `${ROLE_PROMPTS[role] || ROLE_PROMPTS.social}

Use as imagens anexadas (thumbnails Canva) para manter consistência visual/tom. Não invente produtos que não existam no briefing.`;

    let raw = await callClaude({ system, userText, images });
    let output = extractJson(raw);

    // QA pass for content roles
    if (["social", "roteirista", "roteirista_ads"].includes(role)) {
      const qaRaw = await callClaude({
        system: ROLE_PROMPTS.qa,
        userText: `Revise este entregável e devolva JSON no mesmo formato (headline, caption, script, cta, notes) com melhorias:\n\n${JSON.stringify(output)}`,
      });
      const qaOut = extractJson(qaRaw);
      output = {
        ...output,
        ...qaOut,
        notes: [output.notes, qaOut.notes].filter(Boolean).join(" | "),
      };
    }

    await supabase
      .from("office_jobs")
      .update({
        status: "done",
        output,
        agent_role: role,
        error_message: null,
      })
      .eq("id", job.id);

    return { job_id: job.id, status: "done", output };
  } catch (e) {
    await supabase
      .from("office_jobs")
      .update({
        status: "error",
        error_message: (e as Error).message,
      })
      .eq("id", job.id);
    throw e;
  }
}

async function applyJob(
  supabase: ReturnType<typeof createClient>,
  jobId: string
) {
  const { data: job } = await supabase
    .from("office_jobs")
    .select("*, tasks(id, description)")
    .eq("id", jobId)
    .single();

  if (!job || job.status !== "done") throw new Error("Job não está pronto para aplicar");
  if (!job.task_id) throw new Error("Job sem task");

  const out = (job.output ?? {}) as Record<string, string>;
  const blocks = [
    out.headline && `HEADLINE: ${out.headline}`,
    out.caption && `LEGENDA:\n${out.caption}`,
    out.script && `ROTEIRO:\n${out.script}`,
    out.cta && `CTA: ${out.cta}`,
    out.notes && `NOTAS:\n${out.notes}`,
  ].filter(Boolean);

  const generated = `\n\n--- Escritório CDM (${new Date().toLocaleString("pt-BR")}) ---\n${blocks.join("\n\n")}`;
  const prev = (job.tasks as { description?: string } | null)?.description || "";
  const nextDesc = prev.includes("--- Escritório CDM")
    ? prev.replace(/\n\n--- Escritório CDM[\s\S]*$/, generated)
    : `${prev}${generated}`;

  await supabase.from("tasks").update({ description: nextDesc }).eq("id", job.task_id);
  return { success: true };
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
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) return json({ error: "Token inválido" }, 401);

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .single();

    if (!profile || !["admin", "gestor", "colaborador"].includes(profile.role)) {
      return json({ error: "Sem permissão" }, 403);
    }

    if (action === "run_task") {
      const taskId = (body as { task_id?: string }).task_id;
      if (!taskId) return json({ error: "task_id obrigatório" }, 400);
      const result = await runSingleTask(supabase, taskId, user.id);
      return json({ success: true, ...result });
    }

    if (action === "apply_job") {
      const jobId = (body as { job_id?: string }).job_id;
      if (!jobId) return json({ error: "job_id obrigatório" }, 400);
      const result = await applyJob(supabase, jobId);
      return json(result);
    }

    if (action === "run_day") {
      const today = todayKey();
      const { data: tasks } = await supabase
        .from("tasks")
        .select("id, title, due_date, status")
        .in("status", ["pendente", "em_progresso", "em_aprovacao"])
        .order("due_date", { ascending: true })
        .limit(40);

      const agenda = (tasks ?? []).filter((t) => {
        if (!t.due_date) return true;
        return t.due_date <= today;
      }).slice(0, 8);

      const results: Array<{ task_id: string; ok: boolean; error?: string }> = [];
      // Parallelism of 2
      for (let i = 0; i < agenda.length; i += 2) {
        const batch = agenda.slice(i, i + 2);
        const settled = await Promise.allSettled(
          batch.map((t) => runSingleTask(supabase, t.id, user.id))
        );
        settled.forEach((s, idx) => {
          const tid = batch[idx].id;
          if (s.status === "fulfilled") results.push({ task_id: tid, ok: true });
          else results.push({ task_id: tid, ok: false, error: String(s.reason?.message || s.reason) });
        });
      }

      return json({
        success: true,
        started: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      });
    }

    return json({
      message: "Office run CDM",
      actions: ["run_day", "run_task", "apply_job"],
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
