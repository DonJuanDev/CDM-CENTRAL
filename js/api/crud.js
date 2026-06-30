import { supabase } from '../supabase-client.js';
import { cached, invalidatePrefix } from '../cache.js';

function listKey(table, options) {
  return `list:${table}:${JSON.stringify(options)}`;
}

export function createApi(table, defaultSelect = '*') {
  return {
    async list(options = {}) {
      const key = listKey(table, options);
      return cached(key, async () => {
        let query = supabase.from(table).select(options.select || defaultSelect);
        if (options.order) query = query.order(options.order.column, { ascending: options.order.asc ?? false });
        if (options.filter) {
          Object.entries(options.filter).forEach(([k, v]) => {
            if (v !== undefined && v !== null && v !== '') query = query.eq(k, v);
          });
        }
        if (options.limit) query = query.limit(options.limit);
        const { data, error } = await query;
        if (error) throw error;
        return data;
      });
    },

    async get(id, select = defaultSelect) {
      const key = `get:${table}:${id}:${select}`;
      return cached(key, async () => {
        const { data, error } = await supabase.from(table).select(select).eq('id', id).single();
        if (error) throw error;
        return data;
      }, 30_000);
    },

    async create(payload) {
      const { data, error } = await supabase.from(table).insert(payload).select().single();
      if (error) throw error;
      invalidatePrefix(`list:${table}`);
      invalidatePrefix(`get:${table}`);
      return data;
    },

    async update(id, payload) {
      const { data, error } = await supabase.from(table).update(payload).eq('id', id).select().single();
      if (error) throw error;
      invalidatePrefix(`list:${table}`);
      invalidatePrefix(`get:${table}:${id}`);
      return data;
    },

    async remove(id) {
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) throw error;
      invalidatePrefix(`list:${table}`);
      invalidatePrefix(`get:${table}:${id}`);
    }
  };
}

export const clientsApi = createApi('clients');
export const projectsApi = createApi('projects', '*, clients(company_name)');
export const tasksApi = createApi('tasks', 'id, title, due_date, status, priority, client_id, client_names, assignee_name, color_owner, assigned_to, created_by, column_name, clients(company_name, icon), projects(name), assignee:profiles!tasks_assigned_to_fkey(full_name, email)');
export const invoicesApi = createApi('invoices', '*, clients(company_name)');
export const paymentsApi = createApi('payments', '*, clients(company_name)');
export const eventsApi = createApi('calendar_events', '*, clients(company_name)');
export const meetingsApi = createApi('meetings', '*, clients(company_name)');
export const filesApi = createApi('files', '*, clients(company_name)');
export const fileFoldersApi = createApi('file_folders');
export const notesApi = createApi(
  'notes',
  '*, author:profiles!notes_author_id_fkey(id, full_name, email), assignee:profiles!notes_assigned_to_fkey(id, full_name, email)'
);
export const campaignsApi = createApi('campaigns', '*, clients(company_name)');
export const creativesApi = createApi('creatives', '*, clients(company_name)');
export const videosApi = createApi('videos', '*, clients(company_name)');
export const notificationsApi = createApi('notifications');
export const integrationsApi = createApi('integrations', '*, clients(company_name)');
export const profilesApi = createApi('profiles');

export const dailyPlansApi = {
  async listForUser(userId, { daysBack = 30 } = {}) {
    const since = new Date();
    since.setDate(since.getDate() - daysBack);
    const sinceKey = since.toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('daily_plans')
      .select('*')
      .eq('user_id', userId)
      .gte('plan_date', sinceKey)
      .order('plan_date', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async getByDate(userId, planDate) {
    const { data, error } = await supabase
      .from('daily_plans')
      .select('*')
      .eq('user_id', userId)
      .eq('plan_date', planDate)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async upsert(userId, planDate, { notes, items }) {
    const payload = {
      user_id: userId,
      plan_date: planDate,
      notes: notes ?? '',
      items: items ?? []
    };
    const { data, error } = await supabase
      .from('daily_plans')
      .upsert(payload, { onConflict: 'user_id,plan_date' })
      .select()
      .single();
    if (error) throw error;
    invalidatePrefix('list:daily_plans');
    return data;
  }
};

export async function getDashboardStats() {
  return cached('dashboard:stats', async () => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];

    const [clients, invoices, payments, campaigns, tasks, projects] = await Promise.all([
      supabase.from('clients').select('id, status, monthly_fee'),
      supabase.from('invoices').select('id, status, amount, due_date'),
      supabase.from('payments').select('type, amount, payment_date').gte('payment_date', monthStart),
      supabase.from('campaigns').select('id, status, roas, leads, spent').eq('status', 'ativa'),
      supabase.from('tasks').select('id, status, due_date').neq('status', 'concluida'),
      supabase.from('projects').select('id, status').eq('status', 'em_andamento')
    ]);

    const receitas = (payments.data || []).filter(p => p.type === 'receita').reduce((s, p) => s + Number(p.amount), 0);
    const despesas = (payments.data || []).filter(p => p.type === 'despesa').reduce((s, p) => s + Number(p.amount), 0);
    const activeClients = (clients.data || []).filter(c => c.status === 'ativo').length;
    const riskClients = (clients.data || []).filter(c => c.status === 'risco').length;
    const pendingInvoices = (invoices.data || []).filter(i => i.status === 'pendente' || i.status === 'atrasado').length;
    const activeCampaigns = (campaigns.data || []).length;
    const totalLeads = (campaigns.data || []).reduce((s, c) => s + (c.leads || 0), 0);
    const avgRoas = activeCampaigns ? (campaigns.data.reduce((s, c) => s + Number(c.roas), 0) / activeCampaigns).toFixed(1) : 0;
    const totalSpent = (campaigns.data || []).reduce((s, c) => s + Number(c.spent), 0);
    const metaMensal = 150000;

    return {
      receitaMes: receitas,
      lucroMes: receitas - despesas,
      boletosPendentes: pendingInvoices,
      clientesAtivos: activeClients,
      clientesRisco: riskClients,
      projetosAndamento: (projects.data || []).length,
      campanhasAtivas: activeCampaigns,
      leadsGerados: totalLeads,
      roasMedio: avgRoas,
      investimentoAnuncios: totalSpent,
      metaMensal,
      percentualMeta: Math.min(100, Math.round((receitas / metaMensal) * 100))
    };
  }, 60_000);
}
