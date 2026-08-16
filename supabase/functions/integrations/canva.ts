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
  /** Pastas do time coladas via link (API não lista elas no root pessoal) */
  tracked_folders?: Array<{
    folder_id: string;
    client_id?: string | null;
    name?: string;
  }>;
  last_sync_summary?: Record<string, unknown>;
};

/** Extrai ID de pasta de URL Canva ou ID puro (ex.: FAFxxxx). */
export function parseCanvaFolderId(input: string): string | null {
  const raw = (input || "").trim();
  if (!raw) return null;

  const fromPath = raw.match(
    /canva\.com\/(?:folder|folders)\/([A-Za-z0-9_-]+)/i
  );
  if (fromPath?.[1] && fromPath[1] !== "root" && fromPath[1] !== "uploads") {
    return fromPath[1];
  }

  const fromQuery = raw.match(
    /[?&#](?:folderId|folder_id|folder|id)=([A-Za-z0-9_-]+)/i
  );
  if (fromQuery?.[1]) return fromQuery[1];

  if (/^[A-Za-z0-9_-]{6,50}$/.test(raw) && raw !== "root" && raw !== "uploads") {
    return raw;
  }

  return null;
}

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

/**
 * A API do Canva só lista pastas do root pessoal do usuário OAuth.
 * Pastas de clientes do time (Phytomaster, RSWF…) costumam ser de outro membro —
 * as artes aparecem em GET /designs (ownership=any), mas as pastas NÃO.
 *
 * Estratégia:
 * 1) Pastas reais do root (se houver)
 * 2) TODAS as artes acessíveis (paginação completa) + busca por nome de cada cliente
 * 3) Criar pastas virtuais virt:{clientId} para o painel de vínculos / Escritório
 */
export async function syncCanvaCatalog(
  supabase: Supabase,
  integration: { id: string; settings?: CanvaSettings | null }
): Promise<{
  folders: number;
  designs: number;
  unmatched: Array<{ id: string; name: string }>;
  warnings?: string[];
  personal_folders?: number;
  virtual_folders?: number;
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
  const visited = new Set<string>();

  type QueueNode = {
    id: string;
    parentId: string | null;
    name: string;
    inheritedClientId: string | null;
  };
  const queue: QueueNode[] = [
    { id: "root", parentId: null, name: "Projetos", inheritedClientId: null },
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

    if (node.id !== "root" && node.id !== "uploads") {
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

    try {
      const items = await listFolderItems(token, node.id, {
        itemTypes: "folder",
        sortBy: "title_ascending",
      });
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
    } catch (e) {
      warnings.push(
        "Pastas pessoais (" + node.name + "): " + (e as Error).message
      );
    }
  }

  const personalFolderCount = folderRows.length;
  if (personalFolderCount <= 2) {
    warnings.push(
      "A API do Canva só enxerga pastas pessoais do usuário conectado. Pastas do time são mapeadas pelo nome das artes."
    );
  }

  type CanvaDesignItem = {
    id: string;
    title?: string;
    page_count?: number;
    updated_at?: number;
    thumbnail?: { url?: string };
  };

  const designRows: DesignRow[] = [];
  const designIdsSeen = new Set<string>();
  const clientDesignCounts = new Map<string, number>();

  function ingestDesign(d: CanvaDesignItem, forcedClientId?: string | null) {
    if (designIdsSeen.has(d.id)) return;
    designIdsSeen.add(d.id);

    const matched =
      (forcedClientId
        ? cdmClients.find((c) => c.id === forcedClientId)
        : null) ??
      matchClientByName(d.title || "", cdmClients, manualMappings, d.id);
    const clientId = matched?.id ?? forcedClientId ?? null;
    const folderId = clientId ? "virt:" + clientId : null;

    if (clientId) {
      clientDesignCounts.set(
        clientId,
        (clientDesignCounts.get(clientId) ?? 0) + 1
      );
    }

    designRows.push({
      design_id: d.id,
      folder_id: folderId,
      client_id: clientId,
      title: d.title || "Sem título",
      thumbnail_url: d.thumbnail?.url ?? null,
      page_count: d.page_count ?? 1,
      updated_at_canva: d.updated_at
        ? new Date(d.updated_at * 1000).toISOString()
        : null,
    });
  }

  async function fetchAllDesigns(extraQuery: Record<string, string> = {}) {
    let continuation = "";
    do {
      const query: Record<string, string> = {
        limit: "100",
        ownership: "any",
        sort_by: "modified_descending",
        ...extraQuery,
      };
      if (continuation) query.continuation = continuation;

      const data = await canvaFetch("/designs", token, query);
      const items = (data.items as CanvaDesignItem[]) ?? [];
      for (const d of items) {
        ingestDesign(
          d,
          extraQuery.query
            ? matchClientByName(
                extraQuery.query,
                cdmClients,
                {},
                "search:" + extraQuery.query
              )?.id ?? null
            : null
        );
      }
      continuation = (data.continuation as string) || "";
    } while (continuation);
  }

  try {
    // 1) Catálogo completo liberado para esta conta
    await fetchAllDesigns();

    // 2) Busca por nome de cada cliente (pega artes que o list geral às vezes omitiria)
    for (const client of cdmClients) {
      const terms = [
        client.company_name,
        ...client.company_name.split(/\s+/).filter((t) => t.length >= 4),
      ];
      const uniqueTerms = [...new Set(terms.map((t) => t.trim()).filter(Boolean))];
      for (const term of uniqueTerms.slice(0, 2)) {
        try {
          await fetchAllDesigns({ query: term });
        } catch (e) {
          warnings.push(
            "Busca \"" + term + "\": " + (e as Error).message
          );
        }
      }
    }
  } catch (e) {
    warnings.push("Lista de artes: " + (e as Error).message);
  }

  warnings.push(
    "Lista geral da API: " +
      designRows.length +
      " artes. Pastas grandes do time (ex.: Phytomaster 850) só entram se você colar o link da pasta em Vincular pastas."
  );

  // ── Fase 3: pastas rastreadas por link (desce a árvore TODA, sem teto) ──
  const tracked = settings.tracked_folders ?? [];
  let trackedDesignAdds = 0;
  let trackedImageSkips = 0;

  async function deepSyncTrackedFolder(
    folderId: string,
    preferredClientId: string | null,
    folderNameHint?: string
  ) {
    let metaName = folderNameHint || folderId;
    try {
      const meta = await canvaFetch("/folders/" + folderId, token);
      const folder = (meta.folder as { name?: string; id?: string } | undefined) ??
        (meta as { name?: string });
      if (folder?.name) metaName = folder.name;
    } catch (e) {
      warnings.push(
        "Pasta " + folderId + ": " + (e as Error).message +
          " (confira se a conta conectada tem acesso a essa pasta)"
      );
      return;
    }

    const matched =
      (preferredClientId
        ? cdmClients.find((c) => c.id === preferredClientId)
        : null) ??
      matchClientByName(metaName, cdmClients, manualMappings, folderId);
    const clientId = matched?.id ?? preferredClientId ?? null;

    folderRows.push({
      folder_id: folderId,
      name: metaName,
      parent_folder_id: null,
      client_id: clientId,
    });

    type DeepNode = { id: string; name: string; clientId: string | null };
    const deepQueue: DeepNode[] = [
      { id: folderId, name: metaName, clientId },
    ];
    const deepVisited = new Set<string>();

    while (deepQueue.length) {
      const node = deepQueue.shift()!;
      if (deepVisited.has(node.id)) continue;
      deepVisited.add(node.id);

      let items: FolderItem[] = [];
      try {
        // Sem maxItems — pagina tudo (designs + subpastas + conta imagens)
        items = await listFolderItems(token, node.id, {
          itemTypes: "folder,design,image",
          sortBy: "modified_descending",
        });
      } catch (e) {
        warnings.push(
          "Itens de " + node.name + ": " + (e as Error).message
        );
        continue;
      }

      for (const item of items) {
        if (item.type === "folder" && item.folder?.id) {
          const subName = item.folder.name || item.folder.id;
          const subClient =
            matchClientByName(
              subName,
              cdmClients,
              manualMappings,
              item.folder.id
            )?.id ?? node.clientId;

          folderRows.push({
            folder_id: item.folder.id,
            name: subName,
            parent_folder_id: node.id,
            client_id: subClient,
          });
          deepQueue.push({
            id: item.folder.id,
            name: subName,
            clientId: subClient,
          });
        } else if (item.type === "image") {
          trackedImageSkips++;
        } else if (item.type === "design" && item.design?.id) {
          const before = designIdsSeen.size;
          ingestDesign(item.design, node.clientId);
          // reforça pasta real (não virtual)
          const row = designRows.find((r) => r.design_id === item.design!.id);
          if (row) {
            row.folder_id = node.id;
            if (node.clientId) row.client_id = node.clientId;
          }
          if (designIdsSeen.size > before) trackedDesignAdds++;
        }
      }
    }
  }

  for (const t of tracked) {
    if (!t.folder_id) continue;
    await deepSyncTrackedFolder(
      t.folder_id,
      t.client_id ?? manualMappings[t.folder_id] ?? null,
      t.name
    );
  }

  if (tracked.length) {
    warnings.push(
      "Pastas por link: +" +
        trackedDesignAdds +
        " artes" +
        (trackedImageSkips
          ? " (" + trackedImageSkips + " imagens ignoradas — não são designs)"
          : "")
    );
  }

  // Recalcula contagens por cliente após deep sync
  clientDesignCounts.clear();
  for (const row of designRows) {
    if (!row.client_id) continue;
    clientDesignCounts.set(
      row.client_id,
      (clientDesignCounts.get(row.client_id) ?? 0) + 1
    );
  }

  const virtualFolders: FolderRow[] = [];
  const realFolderClientIds = new Set(
    folderRows.filter((f) => f.client_id).map((f) => f.client_id as string)
  );
  for (const client of cdmClients) {
    const count = clientDesignCounts.get(client.id) ?? 0;
    if (!count) continue;
    // Se já tem pasta real rastreada/pessoal do cliente, não cria virtual
    if (realFolderClientIds.has(client.id)) continue;
    const folderId = "virt:" + client.id;
    virtualFolders.push({
      folder_id: folderId,
      name: client.company_name + " (" + count + " artes)",
      parent_folder_id: null,
      client_id: manualMappings[folderId] || client.id,
    });
  }

  // Dedup folders by folder_id (última ganha)
  const folderById = new Map<string, FolderRow>();
  for (const f of [...folderRows, ...virtualFolders]) {
    folderById.set(f.folder_id, f);
  }
  const allFolders = [...folderById.values()];

  await supabase
    .from("canva_folders")
    .delete()
    .in("folder_id", ["root", "uploads", "Projects"]);

  if (allFolders.length) {
    await upsertInChunks(supabase, "canva_folders", allFolders, "folder_id");
  }

  if (designRows.length) {
    await upsertInChunks(supabase, "canva_designs", designRows, "design_id");
  }

  for (const [folderId, clientId] of Object.entries(manualMappings)) {
    if (!clientId) continue;
    await supabase
      .from("canva_folders")
      .update({ client_id: clientId })
      .eq("folder_id", folderId);

    if (folderId.startsWith("virt:")) {
      await supabase
        .from("canva_designs")
        .update({ client_id: clientId, folder_id: "virt:" + clientId })
        .eq("folder_id", folderId);
    } else {
      await supabase
        .from("canva_designs")
        .update({ client_id: clientId })
        .eq("folder_id", folderId);
    }
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

  return {
    folders: allFolders.length,
    designs: designRows.length,
    unmatched: finalUnmatched.slice(0, 50),
    warnings: warnings.slice(0, 20),
    personal_folders: personalFolderCount,
    virtual_folders: virtualFolders.length,
    tracked_folders: tracked.length,
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
  const data = await canvaFetch("/designs/" + designId, token);
  const design = (data.design as Record<string, unknown> | undefined) ?? data;
  const thumb = design.thumbnail as { url?: string } | undefined;
  return {
    id: designId,
    title: design.title as string | undefined,
    thumbnail_url: thumb?.url,
    page_count: design.page_count as number | undefined,
  };
}
