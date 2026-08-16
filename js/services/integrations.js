import { supabase } from '../supabase-client.js';
import { SUPABASE_URL } from '../config.js';

const BASE = `${SUPABASE_URL}/functions/v1/integrations`;

async function callIntegration(action, body = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Não autenticado');

  const method = Object.keys(body).length ? 'POST' : 'GET';
  const res = await fetch(`${BASE}?action=${action}`, {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro na integração');
  return data;
}

export const integrationsService = {
  list: () => callIntegration('list'),

  /** Conecta conta mãe (Business Manager) — só precisa do token */
  connectBusinessManager: (provider, accessToken) =>
    callIntegration('connect', {
      provider,
      mode: 'business_manager',
      settings: { access_token: accessToken },
    }),

  connect: (provider, clientId, settings) =>
    callIntegration('connect', { provider, client_id: clientId || null, settings }),

  sync: (integrationId) =>
    callIntegration('sync', { integration_id: integrationId }),

  disconnect: (integrationId) =>
    callIntegration('disconnect', { integration_id: integrationId }),

  listAdAccounts: (integrationId) =>
    callIntegration('list_ad_accounts', { integration_id: integrationId }),

  saveMappings: (integrationId, mappings) =>
    callIntegration('save_mappings', { integration_id: integrationId, mappings }),

  oauthStart: (provider) =>
    callIntegration('oauth_start', { provider }),

  listCanvaFolders: (integrationId) =>
    callIntegration('list_canva_folders', { integration_id: integrationId }),

  saveCanvaMappings: (integrationId, mappings) =>
    callIntegration('save_canva_mappings', { integration_id: integrationId, mappings }),

  registerCanvaFolders: (integrationId, links, clientId = null) =>
    callIntegration('register_canva_folders', {
      integration_id: integrationId,
      links,
      client_id: clientId,
    }),
};
