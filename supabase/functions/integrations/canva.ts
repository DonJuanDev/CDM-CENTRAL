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

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as {
      message?: string;
      code?: string;
    };
    throw new Error(`Canva API ${path}: ${err.message || err.code || res.statusText}`);
  }

  return await res.json();
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

async function listFolderItems(
  token: string,
  folderId: string
): Promise<FolderItem[]> {
  const items: FolderItem[] = [];
  let continuation = "";

  do {
    const query: Record<string, string> = {
      item_types: "folder,design",
      limit: "100",
    };
    if (continuation) query.continuation = continuation;

    const data = await canvaFetch(`/folders/${folderId}/items`, token, query);
    const batch = (data.items as FolderItem[]) ?? [];
    items.push(...batch);
    continuation = (data.continuation as string) || "";
  } while (continuation);

  return items;
}

/** Sync Canva Projects root → folders + designs; auto-map clients by folder name */
export async function syncCanvaCatalog(
  supabase: Supabase,
  integration: { id: string; settings?: CanvaSettings | null }
): Promise<{
  folders: number;
  designs: number;
  unmatched: Array<{ id: string; name: string }>;
}> {
  const token = await getCanvaAccessToken(supabase, integration);
  const settings = (integration.settings ?? {}) as CanvaSettings;
  const manualMappings = settings.folder_mappings ?? {};

  const { data: clients } = await supabase
    .from("clients")
    .select("id, company_name")
    .eq("status", "ativo");
  const cdmClients = (clients ?? []) as CdmClient[];

  // Root "Projects" folder id is typically available via /folders; Canva uses
  // special root. We list designs with ownership filter AND walk folder tree
  // starting from folder items that we discover via search-folders or root.
  // Canva Connect: GET /v1/folders — not always present; use list designs +
  // recursive walk from known roots. Docs: list folder items needs folderId.
  // The root projects folder is often obtained via GET /v1/folders?include=shared
  // Fallback: list all designs via /v1/designs and skip folder tree if needed.

  let foldersSynced = 0;
  let designsSynced = 0;
  const unmatched: Array<{ id: string; name: string }> = [];
  const visitedFolders = new Set<string>();

  async function walkFolder(folderId: string, parentId: string | null, folderName: string) {
    if (visitedFolders.has(folderId)) return;
    visitedFolders.add(folderId);

    const matched = matchClientByName(folderName, cdmClients, manualMappings, folderId);
    if (!matched && folderName && folderId !== "root") {
      // only track top-level-ish unmatched (skip if already in unmatched)
      if (!unmatched.some((u) => u.id === folderId)) {
        unmatched.push({ id: folderId, name: folderName });
      }
    }

    await supabase.from("canva_folders").upsert(
      {
        folder_id: folderId,
        name: folderName || folderId,
        parent_folder_id: parentId,
        client_id: matched?.id ?? null,
      },
      { onConflict: "folder_id" }
    );
    foldersSynced++;

    // If parent mapped but this folder isn't, inherit client from matching name only
    const clientId = matched?.id ?? null;

    let items: FolderItem[] = [];
    try {
      items = await listFolderItems(token, folderId);
    } catch {
      return;
    }

    for (const item of items) {
      if (item.type === "folder" && item.folder) {
        await walkFolder(item.folder.id, folderId, item.folder.name);
      } else if (item.type === "design" && item.design) {
        const d = item.design;
        // Prefer folder's client; else try match by design title
        const designClient =
          clientId ??
          matchClientByName(d.title || "", cdmClients, {}, d.id)?.id ??
          null;

        await supabase.from("canva_designs").upsert(
          {
            design_id: d.id,
            folder_id: folderId,
            client_id: designClient,
            title: d.title || "Sem título",
            thumbnail_url: d.thumbnail?.url ?? null,
            page_count: d.page_count ?? 1,
            updated_at_canva: d.updated_at
              ? new Date(d.updated_at * 1000).toISOString()
              : null,
          },
          { onConflict: "design_id" }
        );
        designsSynced++;
      }
    }
  }

  // Discover root folders: Canva has a special "root" — try listing via designs
  // and also try common root folder endpoints.
  // Approach 1: list designs and capture metadata
  let continuation = "";
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
      const matched = matchClientByName(d.title || "", cdmClients, {}, d.id);
      await supabase.from("canva_designs").upsert(
        {
          design_id: d.id,
          folder_id: null,
          client_id: matched?.id ?? null,
          title: d.title || "Sem título",
          thumbnail_url: d.thumbnail?.url ?? null,
          page_count: d.page_count ?? 1,
          updated_at_canva: d.updated_at
            ? new Date(d.updated_at * 1000).toISOString()
            : null,
        },
        { onConflict: "design_id" }
      );
      designsSynced++;
    }

    continuation = (data.continuation as string) || "";
  } while (continuation);

  // Folder walk is optional — designs list already filled the catalog.
  // Try walking Canva root if the API allows it.
  try {
    await walkFolder("root", null, "Projects");
  } catch {
    // ignore
  }

  // Apply manual folder mappings to designs in those folders
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

  // Filter unmatched to folders that still have no client
  const { data: unmappedFolders } = await supabase
    .from("canva_folders")
    .select("folder_id, name")
    .is("client_id", null);

  const finalUnmatched = (unmappedFolders ?? []).map((f: { folder_id: string; name: string }) => ({
    id: f.folder_id,
    name: f.name,
  }));

  return {
    folders: foldersSynced,
    designs: designsSynced,
    unmatched: finalUnmatched.slice(0, 50),
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
