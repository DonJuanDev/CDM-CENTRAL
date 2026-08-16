import { createClient } from "jsr:@supabase/supabase-js@2";

const CANVA_API = "https://api.canva.com/rest/v1";
const CANVA_AUTH = "https://www.canva.com/api/oauth/authorize";
const CANVA_TOKEN = "https://api.canva.com/rest/v1/oauth/token";

export const CANVA_SCOPES = [
  "design:meta:read",
  "design:content:read",
  "folder:read",
  "asset:read",
  "brandtemplate:meta:read",
].join(" ");

export type CanvaSettings = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  code_verifier?: string;
  mode?: string;
  folder_mappings?: Record<string, string>;
  last_sync_summary?: Record<string, unknown>;
};

type CdmClient = { id: string; company_name: string };
type Supabase = ReturnType<typeof createClient>;

export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchClientByName(
  name: string,
  clients: CdmClient[],
  manualMappings: Record<string, string>,
  key: string
): CdmClient | null {
  if (manualMappings[key]) {
    return clients.find((c) => c.id === manualMappings[key]) ?? null;
  }

  const normalized = normalizeName(name);
  if (!normalized) return null;

  let best: CdmClient | null = null;
  let bestScore = 0;

  for (const client of clients) {
    const normalizedClient = normalizeName(client.company_name);
    if (!normalizedClient) continue;

    if (normalized === normalizedClient) return client;
    if (normalized.includes(normalizedClient) || normalizedClient.includes(normalized)) {
      const score = Math.min(normalized.length, normalizedClient.length);
      if (score > bestScore) {
        best = client;
        bestScore = score;
      }
      continue;
    }

    const tokens = normalized.split(" ").filter((t) => t.length > 2);
    const clientTokens = normalizedClient.split(" ").filter((t) => t.length > 2);
    const overlap = tokens.filter((t) =>
      clientTokens.some((ct) => ct.includes(t) || t.includes(ct))
    ).length;
    if (overlap > 0 && overlap > bestScore) {
      best = client;
      bestScore = overlap;
    }
  }

  return bestScore >= 1 ? best : null;
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

/** PKCE: code_verifier + S256 challenge */
export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const verifier = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return { verifier, challenge };
}

export function buildCanvaAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope: CANVA_SCOPES,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
    state: opts.state,
  });
  return `${CANVA_AUTH}?${params}`;
}

export async function exchangeCanvaCode(opts: {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const res = await fetch(CANVA_TOKEN, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(opts.clientId, opts.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: opts.code,
      code_verifier: opts.codeVerifier,
      redirect_uri: opts.redirectUri,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as {
      error?: string;
      error_description?: string;
    };
    throw new Error(
      `Canva token: ${err.error_description || err.error || res.statusText}`
    );
  }

  return await res.json();
}

export async function refreshCanvaToken(opts: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}> {
  const res = await fetch(CANVA_TOKEN, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(opts.clientId, opts.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: opts.refreshToken,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as {
      error?: string;
      error_description?: string;
    };
    throw new Error(
      `Canva refresh: ${err.error_description || err.error || res.statusText}`
    );
  }

  return await res.json();
}

/** Returns a valid access token, refreshing if needed and persisting to integrations.settings */
export async function getCanvaAccessToken(
  supabase: Supabase,
  integration: { id: string; settings?: CanvaSettings | null }
): Promise<string> {
  const settings = (integration.settings ?? {}) as CanvaSettings;
  const clientId = Deno.env.get("CANVA_CLIENT_ID");
  const clientSecret = Deno.env.get("CANVA_CLIENT_SECRET");

  if (!settings.access_token) {
    throw new Error("Canva não conectado. Conecte em Integrações.");
  }

  const expiresAt = settings.expires_at ?? 0;
  const needsRefresh = Date.now() > expiresAt - 60_000;

  if (!needsRefresh) return settings.access_token;

  if (!settings.refresh_token) {
    throw new Error("Token Canva expirado. Reconecte em Integrações.");
  }
  if (!clientId || !clientSecret) {
    throw new Error("CANVA_CLIENT_ID / CANVA_CLIENT_SECRET não configurados.");
  }

  const tokenData = await refreshCanvaToken({
    refreshToken: settings.refresh_token,
    clientId,
    clientSecret,
  });

  const nextSettings: CanvaSettings = {
    ...settings,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token ?? settings.refresh_token,
    expires_at: Date.now() + (tokenData.expires_in ?? 14400) * 1000,
    code_verifier: undefined,
  };

  await supabase
    .from("integrations")
    .update({ settings: nextSettings })
    .eq("id", integration.id);

  return tokenData.access_token;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function canvaFetch(
  path: string,
  token: string,
  query?: Record<string, string>
): Promise<Record<string, unknown>> {
  const url = new URL(`${CANVA_API}${path}`);
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v) url.searchParams.set(k, v);
    });
  }

  // Canva folder endpoints: 100 req/min — retry on 429
  let attempt = 0;
  while (true) {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 429 && attempt < 5) {
      const retryAfter = Number(res.headers.get("Retry-After") || "5");
      await sleep(Math.max(retryAfter, 2) * 1000 * (attempt + 1));
      attempt++;
      continue;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as {
        message?: string;
        code?: string;
      };
      throw new Error(
        `Canva API ${path}: ${err.message || err.code || res.statusText}`
      );
    }

    return await res.json();
  }
}

type FolderItem = {
  type: string;
  folder?: { id: string; name: string };
  design?: {
    id: string;
    title?: string;
    page_count?: number;
    updated_at?: number;
    thumbnail?: { url?: string };
  };
};

/** Lista itens de uma pasta. maxItems limita paginação (evita timeout em pastas com 700+ artes). */
async function listFolderItems(
  token: string,
  folderId: string,
  opts: {
    itemTypes?: string;
    maxItems?: number;
    sortBy?: string;
  } = {}
): Promise<FolderItem[]> {
  const items: FolderItem[] = [];
  let continuation = "";
  const maxItems = opts.maxItems ?? Infinity;

  do {
    const query: Record<string, string> = {
      item_types: opts.itemTypes ?? "folder,design",
      limit: "100",
      sort_by: opts.sortBy ?? "modified_descending",
    };
    if (continuation) query.continuation = continuation;

    const data = await canvaFetch(`/folders/${folderId}/items`, token, query);
    const batch = (data.items as FolderItem[]) ?? [];
    items.push(...batch);
    continuation = (data.continuation as string) || "";

    if (items.length >= maxItems) {
      return items.slice(0, maxItems);
    }
  } while (continuation);

  return items;
}

type FolderRow = {
  folder_id: string;
  name: string;
  parent_folder_id: string | null;
  client_id: string | null;
};

type DesignRow = {
  design_id: string;
  folder_id: string | null;
  client_id: string | null;
  title: string;
  thumbnail_url: string | null;
  page_count: number;
  updated_at_canva: string | null;
};

async function upsertInChunks<T extends Record<string, unknown>>(
  supabase: Supabase,
  table: string,
  rows: T[],
  onConflict: string,
  chunkSize = 80
) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`${table} upsert: ${error.message}`);
  }
}

/** Memória visual: ~40 artes recentes por pasta (não precisa das 900 do Phytomaster). */
const DESIGNS_PER_FOLDER = 40;
const RECENT_DESIGNS_FALLBACK = 150;

/**
 * Sync em 2 fases:
 * 1) Só pastas (BFS em Projetos/root) — rápido, pega Phytomaster/RSWF/etc.
 * 2) Artes recentes por pasta (cap) + fallback /designs
 */
export async function syncCanvaCatalog(
  supabase: Supabase,
  integration: { id: string; settings?: CanvaSettings | null }
): Promise<{
  folders: number;
  designs: number;
  unmatched: Array<{ id: string; name: string }>;
  warnings?: string[];
}> {
  const token = await getCanvaAccessToken(supabase, integration);
  const settings = (integration.settings ?? {}) as CanvaSettings;
  const manualMappings = settings.folder_mappings ?? {};
  const warnings: string[] = [];

  const { data: clients } = await supabase
    .from("clients")
    .select("id, company_name")
    .eq("status", "ativo");
  const cdmClients = (clients ?? []) as CdmClient[];

  const folderRows: FolderRow[] = [];
  const folderClientMap = new Map<string, string | null>();
  const visited = new Set<string>();

  // ── Fase 1: só pastas (item_types=folder) — não trava em milhares de artes ──
  type QueueNode = {
    id: string;
    parentId: string | null;
    name: string;
    inheritedClientId: string | null;
  };
  const queue: QueueNode[] = [
    { id: "root", parentId: null, name: "Projetos", inheritedClientId: null },
    { id: "uploads", parentId: null, name: "Uploads", inheritedClientId: null },
  ];

  while (queue.length) {
    const node = queue.shift()!;
    if (visited.has(node.id)) continue;
    visited.add(node.id);

    const matched = matchClientByName(
      node.name,
      cdmClients,
      manualMappings,
      node.id
    );
    const clientId = matched?.id ?? node.inheritedClientId ?? null;
    folderClientMap.set(node.id, clientId);

    const skipRow = node.id === "root" || node.id === "uploads";
    if (!skipRow) {
      folderRows.push({
        folder_id: node.id,
        name: node.name || node.id,
        parent_folder_id:
          node.parentId === "root" || node.parentId === "uploads"
            ? null
            : node.parentId,
        client_id: clientId,
      });
    }

    let items: FolderItem[] = [];
    try {
      items = await listFolderItems(token, node.id, {
        itemTypes: "folder",
        sortBy: "title_ascending",
      });
    } catch (e) {
      const msg = (e as Error).message;
      console.error(`Canva folders failed for ${node.id}:`, msg);
      warnings.push(`${node.name}: ${msg}`);
      continue;
    }

    for (const item of items) {
      if (item.type === "folder" && item.folder?.id) {
        queue.push({
          id: item.folder.id,
          parentId: node.id,
          name: item.folder.name || item.folder.id,
          inheritedClientId: clientId,
        });
      }
    }
  }

  if (folderRows.length) {
    await upsertInChunks(supabase, "canva_folders", folderRows, "folder_id");
  }

  // ── Fase 2: artes recentes por pasta (cap) ──
  const designRows: DesignRow[] = [];
  const designIdsSeen = new Set<string>();

  for (const folder of folderRows) {
    let items: FolderItem[] = [];
    try {
      items = await listFolderItems(token, folder.folder_id, {
        itemTypes: "design",
        maxItems: DESIGNS_PER_FOLDER,
        sortBy: "modified_descending",
      });
    } catch (e) {
      const msg = (e as Error).message;
      console.error(`Canva designs failed for ${folder.folder_id}:`, msg);
      warnings.push(`${folder.name} (artes): ${msg}`);
      continue;
    }

    const clientId = folderClientMap.get(folder.folder_id) ?? folder.client_id;

    for (const item of items) {
      if (item.type !== "design" || !item.design?.id) continue;
      const d = item.design;
      if (designIdsSeen.has(d.id)) continue;
      designIdsSeen.add(d.id);

      designRows.push({
        design_id: d.id,
        folder_id: folder.folder_id,
        client_id:
          clientId ??
          matchClientByName(d.title || "", cdmClients, {}, d.id)?.id ??
          null,
        title: d.title || "Sem título",
        thumbnail_url: d.thumbnail?.url ?? null,
        page_count: d.page_count ?? 1,
        updated_at_canva: d.updated_at
          ? new Date(d.updated_at * 1000).toISOString()
          : null,
      });
    }
  }

  // Fallback: artes recentes da conta (sem pasta), sem sobrescrever as já ligadas
  try {
    let continuation = "";
    let fetched = 0;
    do {
      const query: Record<string, string> = {
        limit: "100",
        ownership: "any",
        sort_by: "modified_descending",
      };
      if (continuation) query.continuation = continuation;

      const data = await canvaFetch("/designs", token, query);
      const items = (data.items as Array<{
        id: string;
        title?: string;
        page_count?: number;
        updated_at?: number;
        thumbnail?: { url?: string };
      }>) ?? [];

      for (const d of items) {
        if (designIdsSeen.has(d.id)) continue;
        designIdsSeen.add(d.id);
        designRows.push({
          design_id: d.id,
          folder_id: null,
          client_id:
            matchClientByName(d.title || "", cdmClients, {}, d.id)?.id ?? null,
          title: d.title || "Sem título",
          thumbnail_url: d.thumbnail?.url ?? null,
          page_count: d.page_count ?? 1,
          updated_at_canva: d.updated_at
            ? new Date(d.updated_at * 1000).toISOString()
            : null,
        });
        fetched++;
        if (fetched >= RECENT_DESIGNS_FALLBACK) break;
      }

      continuation =
        fetched >= RECENT_DESIGNS_FALLBACK
          ? ""
          : ((data.continuation as string) || "");
    } while (continuation);
  } catch (e) {
    warnings.push(`Lista geral de artes: ${(e as Error).message}`);
  }

  if (designRows.length) {
    await upsertInChunks(supabase, "canva_designs", designRows, "design_id");
  }

  // Aplicar mapeamentos manuais
  for (const [folderId, clientId] of Object.entries(manualMappings)) {
    if (!clientId) continue;
    await supabase
      .from("canva_folders")
      .update({ client_id: clientId })
      .eq("folder_id", folderId);
    await supabase
      .from("canva_designs")
      .update({ client_id: clientId })
      .eq("folder_id", folderId);
  }

  const { data: unmappedFolders } = await supabase
    .from("canva_folders")
    .select("folder_id, name")
    .is("client_id", null);

  const finalUnmatched = (unmappedFolders ?? []).map(
    (f: { folder_id: string; name: string }) => ({
      id: f.folder_id,
      name: f.name,
    })
  );

  if (folderRows.length < 5) {
    warnings.push(
      "Poucas pastas encontradas. Confirme que a conta Canva conectada é a mesma que vê Projetos (Phytomaster, RSWF, etc.)."
    );
  }

  return {
    folders: folderRows.length,
    designs: designRows.length,
    unmatched: finalUnmatched.slice(0, 50),
    warnings: warnings.slice(0, 20),
  };
}

export async function fetchDesignMeta(
  token: string,
  designId: string
): Promise<{
  id: string;
  title?: string;
  thumbnail_url?: string;
  page_count?: number;
}> {
  const data = await canvaFetch(`/designs/${designId}`, token);
  const thumb = data.thumbnail as { url?: string } | undefined;
  return {
    id: designId,
    title: data.title as string | undefined,
    thumbnail_url: thumb?.url,
    page_count: data.page_count as number | undefined,
  };
}
