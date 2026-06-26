import { parseAssigneeNames, findTeamMemberByName } from './config.js';

export const formatCurrency = (v) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);

export const formatNumber = (v) => new Intl.NumberFormat('pt-BR').format(Number(v) || 0);

export const formatDate = (d) => {
  if (!d) return '—';
  const date = new Date(d.includes('T') ? d : d + 'T00:00:00');
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const formatDateShort = (d) => {
  if (!d) return '—';
  const date = new Date(d.includes('T') ? d : d + 'T00:00:00');
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
};

export const formatDateTime = (d) => {
  if (!d) return '—';
  return new Date(d).toLocaleString('pt-BR', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
};

export function formatFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return 'calculando...';
  if (seconds < 1) return 'menos de 1 seg';
  if (seconds < 60) return `${Math.ceil(seconds)} seg`;
  const minutes = Math.floor(seconds / 60);
  const secs = Math.ceil(seconds % 60);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours} h ${mins} min`;
  }
  return `${minutes} min ${secs > 0 ? `${secs} seg` : ''}`.trim();
}

export const $ = (sel, ctx = document) => ctx.querySelector(sel);
export const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

export const statusBadge = (status) => {
  const map = {
    pago: 'success', pendente: 'warning', atrasado: 'danger', cancelado: 'neutral',
    futuro: 'info', ativo: 'success', inativo: 'neutral', risco: 'danger', prospect: 'info',
    concluida: 'success', em_progresso: 'info', em_aprovacao: 'warning', cancelada: 'neutral',
    planejado: 'neutral', em_andamento: 'info', concluido: 'success', pausado: 'warning',
    rascunho: 'neutral', ativa: 'success', pausada: 'warning',
    aprovado: 'success', rejeitado: 'danger', nao_iniciada: 'neutral',
    connected: 'success', disconnected: 'neutral', error: 'danger', syncing: 'info'
  };
  const labels = {
    em_progresso: 'Em andamento', em_aprovacao: 'Em aprovação',
    nao_iniciada: 'Não Iniciada', em_andamento: 'Em Andamento', a_fazer: 'A fazer',
    pendente: 'A fazer', concluida: 'Concluído', agendada: 'Agendada'
  };
  const cls = map[status] || 'neutral';
  const label = labels[status] || (status || '').charAt(0).toUpperCase() + (status || '').slice(1).replace(/_/g, ' ');
  return `<span class="badge badge-${cls}">${label}</span>`;
};

export const priorityBadge = (p) => {
  const map = { alta: 'danger', media: 'warning', baixa: 'success' };
  return `<span class="badge badge-${map[p] || 'neutral'}">${(p || '').charAt(0).toUpperCase() + (p || '').slice(1)}</span>`;
};

export function showToast(msg, type = 'info') {
  let container = $('#toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

export function areaTag(area) {
  if (!area) return '—';
  const map = {
    'Cliente Final - Farmácia': 'area-farmacia',
    'Cliente Final - Película': 'area-pelicula',
    'Cliente Final - PPF': 'area-ppf',
    'Software': 'area-software',
    'Lojista - Película': 'area-lojista',
    'Mãe de todos': 'area-mae'
  };
  const cls = map[area] || 'area-default';
  return `<span class="notion-tag ${cls}">${escapeHtml(area)}</span>`;
}

export function notionStatusBadge(status) {
  const map = {
    concluida: 'notion-status-done',
    em_aprovacao: 'notion-status-review',
    em_progresso: 'notion-status-progress',
    pendente: 'notion-status-todo',
    cancelada: 'notion-status-cancel'
  };
  const labels = {
    concluida: 'Concluído', em_aprovacao: 'Em aprovação',
    em_progresso: 'Em andamento', pendente: 'A fazer', cancelada: 'Cancelado'
  };
  const cls = map[status] || 'notion-status-todo';
  const label = labels[status] || status;
  return `<span class="notion-status ${cls}">${label}</span>`;
}

export function assigneeChip(name, ownerKey) {
  if (!name) return '';
  const initial = name.trim().charAt(0).toUpperCase();
  const avatarCls = ownerKey ? `notion-avatar notion-avatar-${ownerKey}` : 'notion-avatar';
  return `<span class="notion-assignee"><span class="${avatarCls}">${initial}</span>${escapeHtml(name)}</span>`;
}

export function assigneeChips(namesStr, colorKeys = []) {
  const names = parseAssigneeNames(typeof namesStr === 'string' ? namesStr : '');
  if (!names.length) return '';
  const chips = names.map((name, i) => {
    const key = colorKeys[i] || findTeamMemberByName(name)?.color || '';
    return assigneeChip(name, key);
  }).join('');
  return `<div class="notion-card-assignees">${chips}</div>`;
}

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export async function handleError(error, fallback = 'Operação falhou') {
  console.error(error);
  showToast(error?.message || fallback, 'error');
}
