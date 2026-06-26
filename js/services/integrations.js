import { supabase } from '../supabase-client.js';
import { SUPABASE_URL } from '../config.js';

const BASE = `${SUPABASE_URL}/functions/v1/integrations`;

async function callIntegration(action, body = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Não autenticado');

  const res = await fetch(`${BASE}?action=${action}`, {
    method: body && Object.keys(body).length ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json'
    },
    body: Object.keys(body).length ? JSON.stringify(body) : undefined
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro na integração');
  return data;
}

export const integrationsService = {
  listProviders: () => callIntegration('list_providers'),
  connect: (provider, clientId, settings) => callIntegration('connect', { provider, client_id: clientId, settings }),
  sync: (integrationId) => callIntegration('sync', { integration_id: integrationId }),
  disconnect: (integrationId) => callIntegration('disconnect', { integration_id: integrationId })
};
