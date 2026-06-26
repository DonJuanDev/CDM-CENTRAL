import { supabase } from './supabase-client.js';
import { ROLES } from './config.js';

let currentProfile = null;

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function getProfile() {
  const session = await getSession();
  if (!session) return null;

  if (currentProfile?.id === session.user.id) return currentProfile;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .maybeSingle();

  if (error) {
    console.error('Erro ao carregar perfil:', error);
    throw new Error('Não foi possível carregar seu perfil: ' + error.message);
  }

  if (!data) {
    throw new Error('Perfil não encontrado. Contate o administrador.');
  }

  currentProfile = data;
  return data;
}

export async function requireAuth(redirectTo = 'login.html') {
  const session = await getSession();
  if (!session) {
    window.location.replace(redirectTo);
    return null;
  }

  try {
    const profile = await getProfile();
    if (!profile.is_active) {
      await signOut();
      window.location.replace(redirectTo);
      return null;
    }
    return { session, profile };
  } catch (err) {
    console.error(err);
    await signOut();
    window.location.replace(redirectTo + '?error=' + encodeURIComponent(err.message));
    return null;
  }
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  currentProfile = null;
  return data;
}

export async function signUp(email, password, fullName, role = ROLES.COLABORADOR) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      // role must be set via app_metadata by admin in production
    }
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  currentProfile = null;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function resetPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password.html`
  });
  if (error) throw error;
}

export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function changePassword(email, currentPassword, newPassword) {
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password: currentPassword
  });
  if (signInError) throw new Error('Senha atual incorreta');

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export function hasRole(profile, ...roles) {
  return profile && roles.includes(profile.role);
}

export function canManage(profile) {
  return hasRole(profile, ROLES.ADMIN, ROLES.GESTOR);
}

export function isAdmin(profile) {
  return hasRole(profile, ROLES.ADMIN);
}

export function clearProfileCache() {
  currentProfile = null;
}

supabase.auth.onAuthStateChange(() => {
  currentProfile = null;
});
