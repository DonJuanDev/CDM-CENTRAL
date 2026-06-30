import { supabase } from '../supabase-client.js';

export async function markAllNotificationsRead() {
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('read', false);
  if (error) throw error;
}

export async function markNotificationRead(id) {
  const { error } = await supabase.from('notifications').update({ read: true }).eq('id', id);
  if (error) throw error;
}

export async function fetchUnreadNotifications(limit = 20) {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, title, message, type, read, link, entity_type, entity_id, created_at')
    .eq('read', false)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export function parseNotificationLink(link = '') {
  if (!link) return null;
  const raw = link.startsWith('#') ? link.slice(1) : link;
  const [viewPart, queryPart] = raw.split('?');
  const view = viewPart.replace(/^\//, '');
  const params = new URLSearchParams(queryPart || '');
  return {
    view,
    taskId: params.get('task'),
    noteId: params.get('nota'),
    date: params.get('date'),
    hash: link.startsWith('#') ? link : `#${raw}`
  };
}
