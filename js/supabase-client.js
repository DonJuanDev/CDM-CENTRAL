import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

function getCreateClient() {
  const lib = window.supabase;
  if (!lib?.createClient) {
    throw new Error(
      'Biblioteca Supabase não carregou. Use Live Server (porta 5501) e recarregue a página.'
    );
  }
  return lib.createClient;
}

export const supabase = getCreateClient()(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storageKey: 'cdm-central-auth'
  }
});
