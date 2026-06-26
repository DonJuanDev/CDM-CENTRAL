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
  /** Lista todas as integrações cadastradas (com dados dos clientes) */
  list: () => callIntegration('list'),

  /** Conecta uma integração com token manual */
  connect: (provider, clientId, settings) =>
    callIntegration('connect', { provider, client_id: clientId || null, settings }),

  /** Sincroniza dados da plataforma externa para o banco */
  sync: (integrationId) =>
    callIntegration('sync', { integration_id: integrationId }),

  /** Remove as credenciais e marca como desconectado */
  disconnect: (integrationId) =>
    callIntegration('disconnect', { integration_id: integrationId }),

  /** Inicia fluxo OAuth (retorna URL para redirecionar) */
  oauthStart: (provider, clientId) =>
    callIntegration('oauth_start', { provider, client_id: clientId || null }),
};
