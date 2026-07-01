import { $, showToast, escapeHtml, handleError } from './utils.js';
import {
  clientsApi, projectsApi, tasksApi, invoicesApi, paymentsApi,
  eventsApi, meetingsApi, notesApi, campaignsApi, filesApi, integrationsApi,
  profilesApi
} from './api/crud.js?v=20260621a';
import { uploadFile, uploadInvoicePdf, linkDriveFile } from './services/storage.js?v=20260621a';
import { showUploadProgress, hideUploadProgress } from './files-browser.js?v=20260621a';
import { getProfile } from './auth.js';
import { TEAM_MEMBERS, inferColorOwner, findTeamMemberByName, resolveAssigneeColorKeys, FILE_CATEGORIES } from './config.js';
import { invalidatePrefix } from './cache.js';
import { loadTeamWithProfiles } from './services/team.js';

let teamProfilesForForm = [];

const API_MAP = {
  clients: clientsApi,
  projects: projectsApi,
  tasks: tasksApi,
  invoices: invoicesApi,
  payments: paymentsApi,
  events: eventsApi,
  meetings: meetingsApi,
  notes: notesApi,
  campaigns: campaignsApi,
  files: filesApi,
  integrations: integrationsApi
};

const SCHEMAS = {
  clients: {
    title: 'Cliente',
    fields: [
      { name: 'company_name', label: 'Empresa', type: 'text', required: true },
      { name: 'icon', label: 'Ícone (emoji)', type: 'text', placeholder: '💊 🚗' },
      { name: 'contact_name', label: 'Responsável', type: 'text' },
      { name: 'area_atuacao', label: 'Área de Atuação', type: 'text', placeholder: 'Ex: Cliente Final - Película' },
      { name: 'email', label: 'E-mail', type: 'email' },
      { name: 'phone', label: 'Telefone', type: 'text' },
      { name: 'instagram', label: 'Login Instagram', type: 'text' },
      { name: 'instagram_password', label: 'Senha Instagram', type: 'text' },
      { name: 'tiktok_password', label: 'Senha TikTok', type: 'text' },
      { name: 'facebook_password', label: 'Senha Facebook', type: 'text' },
      { name: 'email_password', label: 'Senha E-mail', type: 'text' },
      { name: 'linktree', label: 'Linktree', type: 'text' },
      { name: 'linktree_password', label: 'Senha Linktree', type: 'text' },
      { name: 'website', label: 'Website', type: 'text' },
      { name: 'contract_type', label: 'Contrato', type: 'select', options: ['mensal', 'semestral', 'anual', 'projeto'] },
      { name: 'monthly_fee', label: 'Mensalidade (R$)', type: 'number', step: '0.01' },
      { name: 'status', label: 'Status', type: 'select', options: ['ativo', 'inativo', 'risco', 'prospect'] },
      { name: 'notes', label: 'Observações', type: 'textarea', full: true }
    ]
  },
  projects: {
    title: 'Projeto',
    fields: [
      { name: 'client_id', label: 'Cliente', type: 'client_select', required: true, full: true },
      { name: 'name', label: 'Nome', type: 'text', required: true },
      { name: 'description', label: 'Descrição', type: 'textarea', full: true },
      { name: 'status', label: 'Status', type: 'select', options: ['planejado', 'em_andamento', 'concluido', 'pausado', 'cancelado'] },
      { name: 'budget', label: 'Orçamento (R$)', type: 'number', step: '0.01' },
      { name: 'start_date', label: 'Início', type: 'date' },
      { name: 'end_date', label: 'Término', type: 'date' }
    ]
  },
  tasks: {
    title: 'Conteúdo / Tarefa',
    fields: [
      { name: 'title', label: 'Tarefa', type: 'text', required: true, full: true },
      { name: 'description', label: 'Descrição / Briefing', type: 'textarea', full: true },
      { name: 'client_ids', label: 'Clientes', type: 'client_multi_select', full: true },
      { name: 'team_member_names', label: 'Responsáveis', type: 'team_multi_select', full: true },
      { name: 'due_date', label: 'Data de publicação', type: 'date' },
      { name: 'priority', label: 'Prioridade', type: 'select', options: ['baixa', 'media', 'alta'] },
      { name: 'status', label: 'Status', type: 'select', options: ['pendente', 'em_progresso', 'em_aprovacao', 'concluida', 'cancelada'] }
    ]
  },
  invoices: {
    title: 'Boleto',
    fields: [
      { name: 'client_id', label: 'Cliente', type: 'client_select', required: true, full: true },
      { name: 'amount', label: 'Valor (R$)', type: 'number', step: '0.01', required: true },
      { name: 'due_date', label: 'Vencimento', type: 'date', required: true },
      { name: 'status', label: 'Status', type: 'select', options: ['pendente', 'pago', 'atrasado', 'cancelado', 'futuro'] },
      { name: 'barcode', label: 'Código de barras', type: 'text', full: true },
      { name: 'description', label: 'Descrição', type: 'textarea', full: true }
    ]
  },
  payments: {
    title: 'Lançamento Financeiro',
    fields: [
      { name: 'type', label: 'Tipo', type: 'select', options: ['receita', 'despesa'], required: true },
      { name: 'description', label: 'Descrição', type: 'text', required: true, full: true },
      { name: 'amount', label: 'Valor (R$)', type: 'number', step: '0.01', required: true },
      { name: 'category', label: 'Categoria', type: 'text' },
      { name: 'cost_center', label: 'Centro de Custo', type: 'text' },
      { name: 'client_id', label: 'Cliente', type: 'client_select' },
      { name: 'payment_date', label: 'Data', type: 'date', required: true }
    ]
  },
  events: {
    title: 'Evento',
    fields: [
      { name: 'title', label: 'Título', type: 'text', required: true, full: true },
      { name: 'description', label: 'Descrição', type: 'textarea', full: true },
      { name: 'start_at', label: 'Início', type: 'datetime-local', required: true },
      { name: 'end_at', label: 'Término', type: 'datetime-local', required: true },
      { name: 'client_id', label: 'Cliente', type: 'client_select' },
      { name: 'priority', label: 'Prioridade', type: 'select', options: ['baixa', 'media', 'alta'] },
      { name: 'status', label: 'Status', type: 'text' }
    ]
  },
  meetings: {
    title: 'Reunião',
    fields: [
      { name: 'title', label: 'Título', type: 'text', required: true, full: true },
      { name: 'description', label: 'Descrição', type: 'textarea', full: true },
      { name: 'client_id', label: 'Cliente', type: 'client_select' },
      { name: 'scheduled_at', label: 'Data/Hora', type: 'datetime-local', required: true },
      { name: 'duration_minutes', label: 'Duração (min)', type: 'number' },
      { name: 'meeting_type', label: 'Tipo', type: 'select', options: ['online', 'presencial'] },
      { name: 'meeting_link', label: 'Link', type: 'text', full: true }
    ]
  },
  notes: {
    title: 'Nota',
    fields: [
      { name: 'title', label: 'Título', type: 'text', required: true, full: true },
      { name: 'content', label: 'Conteúdo', type: 'textarea', full: true }
    ]
  },
  campaigns: {
    title: 'Campanha',
    fields: [
      { name: 'client_id', label: 'Cliente', type: 'client_select', required: true, full: true },
      { name: 'name', label: 'Nome', type: 'text', required: true, full: true },
      { name: 'platform', label: 'Plataforma', type: 'select', options: ['Google Ads', 'Meta Ads', 'TikTok Ads', 'LinkedIn Ads'] },
      { name: 'status', label: 'Status', type: 'select', options: ['rascunho', 'ativa', 'pausada', 'concluida'] },
      { name: 'budget', label: 'Budget (R$)', type: 'number', step: '0.01' },
      { name: 'spent', label: 'Gasto (R$)', type: 'number', step: '0.01' },
      { name: 'roas', label: 'ROAS', type: 'number', step: '0.01' },
      { name: 'leads', label: 'Leads', type: 'number' }
    ]
  }
};

function getNotesSchema(noteType = 'personal') {
  const fields = [
    { name: 'title', label: 'Título', type: 'text', required: true, full: true },
    { name: 'content', label: 'Conteúdo', type: 'textarea', full: true }
  ];
  if (noteType === 'general') {
    fields.push({ name: 'assigned_to', label: 'Responsável (opcional)', type: 'user_select', full: true });
  }
  return {
    title: noteType === 'general' ? 'Nota Geral' : 'Nota Pessoal',
    fields
  };
}

let clientsCache = [];
let profilesCache = [];
let crudState = null;

function serializeCrudForm(form) {
  if (!form) return '';
  const parts = [];
  form.querySelectorAll('input, select, textarea').forEach(el => {
    if (!el.name) return;
    if (el.type === 'checkbox') {
      parts.push(`${el.name}:${el.value}=${el.checked}`);
    } else if (el.type === 'file') {
      parts.push(`${el.name}=${el.files?.[0]?.name || ''}`);
    } else {
      parts.push(`${el.name}=${el.value}`);
    }
  });
  return parts.sort().join('|');
}

function isCrudFormDirty() {
  const form = $('#crud-form');
  if (!form || !crudState?.initialSnapshot) return false;
  return serializeCrudForm(form) !== crudState.initialSnapshot;
}

async function buildCrudPayload(form, entity, schema, record, profile) {
  const fd = new FormData(form);
  const payload = {};

  schema.fields.forEach(f => {
    if (f.type === 'client_multi_select' || f.type === 'team_multi_select') return;
    let v = fd.get(f.name);
    if (f.type === 'number') v = v ? parseFloat(v) : null;
    if (f.name === 'tags') v = v ? v.split(',').map(t => t.trim()).filter(Boolean) : [];
    if (f.type === 'datetime-local' && v) v = new Date(v).toISOString();
    if (v !== '' && v !== null) payload[f.name] = v;
  });

  if (entity === 'tasks') {
    const checkedIds = [...form.querySelectorAll('input[name="client_ids"]:checked')].map(el => el.value);
    const selectedClients = checkedIds
      .map(id => clientsCache.find(c => c.id === id))
      .filter(Boolean);
    payload.client_id = selectedClients[0]?.id || null;
    payload.client_names = selectedClients.length
      ? selectedClients.map(formatClientLabel).join(', ')
      : null;

    const checkedMembers = [...form.querySelectorAll('input[name="team_member_names"]:checked')];
    if (!checkedMembers.length) {
      if (record?.id) {
        payload.assignee_name = record.assignee_name ?? null;
        payload.assigned_to = record.assigned_to ?? null;
        payload.color_owner = record.color_owner ?? null;
      } else {
        throw new Error('SELECT_TEAM_REQUIRED');
      }
    } else {
      const memberNames = checkedMembers.map(el => el.value);
      payload.assignee_name = memberNames.join(', ');
      payload.assigned_to = checkedMembers[0]?.dataset?.profileId || null;
      const colors = memberNames
        .map(name => findTeamMemberByName(name)?.color || inferColorOwner(name, payload.title || ''))
        .filter(Boolean);
      payload.color_owner = colors[0] || null;
    }

    if (payload.status) {
      payload.column_name = STATUS_TO_COLUMN[payload.status] || 'a_fazer';
    }
  }

  if (entity === 'notes') {
    const noteType = crudState?.noteType || record?.note_type || 'personal';
    payload.note_type = noteType;
    if (!record?.id) payload.author_id = profile?.id;
    if (noteType === 'personal') {
      payload.assigned_to = null;
    } else if (!payload.assigned_to) {
      payload.assigned_to = null;
    }
  }

  if (!record?.id) {
    if (entity !== 'notes') payload.created_by = profile?.id;
  }

  return payload;
}

async function saveCrudForm({ silent = false } = {}) {
  if (!crudState) return false;
  const { entity, record, onSave, schema, isEdit } = crudState;
  const form = $('#crud-form');
  if (!form) return false;

  const profile = await getProfile();

  let payload;
  try {
    payload = await buildCrudPayload(form, entity, schema, record, profile);
  } catch (err) {
    if (err.message === 'SELECT_TEAM_REQUIRED') {
      if (!silent) showToast('Selecione ao menos um responsável', 'error');
      return false;
    }
    throw err;
  }

  try {
    let saved;
    if (isEdit) {
      saved = await API_MAP[entity].update(record.id, payload);
    } else {
      saved = await API_MAP[entity].create(payload);
    }

    const pdfFile = $('#pdf-file')?.files?.[0];
    if (pdfFile && saved?.id) {
      await uploadInvoicePdf(pdfFile, saved.client_id, saved.id);
    }

    const fileInput = $('#file-input')?.files?.[0];
    if (fileInput) {
      await uploadFile(fileInput, { clientId: payload.client_id });
    }

    if (!silent) {
      showToast(`${schema.title} ${isEdit ? 'atualizado' : 'criado'} com sucesso`, 'success');
    }
    if (entity === 'tasks') invalidatePrefix('calendar:');
    crudState.initialSnapshot = serializeCrudForm(form);
    onSave?.();
    return true;
  } catch (err) {
    if (!silent) handleError(err);
    return false;
  }
}

export async function dismissCrudModal() {
  const modal = $('#detail-modal');
  if (!modal || modal.classList.contains('hidden')) return false;

  const shouldAutoSave = crudState?.isEdit && crudState?.entity === 'tasks';
  if (shouldAutoSave && isCrudFormDirty()) {
    const ok = await saveCrudForm({ silent: false });
    if (!ok) return true;
  }

  closeCrudModal();
  return true;
}

export async function loadClientsCache() {
  clientsCache = await clientsApi.list({ order: { column: 'company_name', asc: true } });
  return clientsCache;
}

async function loadProfilesCache() {
  profilesCache = await profilesApi.list({ order: { column: 'full_name', asc: true } });
  return profilesCache;
}

const STATUS_TO_COLUMN = {
  pendente: 'a_fazer',
  em_progresso: 'em_progresso',
  em_aprovacao: 'em_progresso',
  concluida: 'concluido',
  cancelada: 'a_fazer'
};

function resolveSelectedClientIds(record) {
  const ids = new Set();
  if (!record) return ids;
  if (record.client_id) ids.add(record.client_id);
  if (record.client_names) {
    const namesBlob = record.client_names.toLowerCase();
    clientsCache.forEach(c => {
      if (namesBlob.includes(c.company_name.toLowerCase())) ids.add(c.id);
    });
  }
  return ids;
}

function formatClientLabel(client) {
  const icon = (client.icon || '').trim();
  return icon ? `${icon} ${client.company_name}`.trim() : client.company_name;
}

function resolveSelectedTeamMembers(record) {
  const selected = new Set();
  if (!record) return selected;
  const members = teamProfilesForForm.length
    ? teamProfilesForForm
    : TEAM_MEMBERS.map(m => ({ ...m, profile: null }));
  if (record.assigned_to) {
    const byProfile = members.find(m => m.profile?.id === record.assigned_to);
    if (byProfile) selected.add(byProfile.name);
  }
  if (record.assignee_name) {
    record.assignee_name.split(/[,;|]/).map(s => s.trim()).filter(Boolean).forEach(part => {
      const match = members.find(m =>
        m.name.toLowerCase() === part.toLowerCase()
        || part.toLowerCase().includes(m.id)
        || (m.id === 'mariah' && part.toLowerCase().includes('mariah'))
        || (m.id === 'wanessa' && (part.toLowerCase().includes('waness') || part.toLowerCase().includes('wanes')))
        || (m.id === 'juan' && part.toLowerCase().includes('juan'))
        || (m.id === 'ney' && /\bney\b/.test(part.toLowerCase()))
        || (m.id === 'bernardo' && part.toLowerCase().includes('bernardo'))
      );
      if (match) selected.add(match.name);
    });
  }
  return selected;
}

function renderField(field, value = '', record = null) {
  const val = escapeHtml(String(value ?? ''));
  const req = field.required ? 'required' : '';
  const full = field.full ? 'full' : '';

  if (field.type === 'client_select') {
    const options = clientsCache.map(c =>
      `<option value="${c.id}" ${value === c.id ? 'selected' : ''}>${escapeHtml(c.company_name)}</option>`
    ).join('');
    return `<div class="form-group ${full}"><label class="form-label">${field.label}</label>
      <select class="form-input" name="${field.name}" ${req}><option value="">— Selecionar —</option>${options}</select></div>`;
  }

  if (field.type === 'client_multi_select') {
    const selected = resolveSelectedClientIds(record);
    const items = clientsCache.map(c => {
      const checked = selected.has(c.id) ? 'checked' : '';
      const icon = c.icon ? `${escapeHtml(c.icon)} ` : '';
      return `<label class="client-checkbox-item">
        <input type="checkbox" name="client_ids" value="${c.id}" ${checked}>
        <span>${icon}${escapeHtml(c.company_name)}</span>
      </label>`;
    }).join('');
    return `<div class="form-group ${full}"><label class="form-label">${field.label}</label>
      <div class="client-checkbox-group">${items || '<span class="text-muted" style="font-size:13px;color:var(--text-tertiary)">Nenhum cliente cadastrado</span>'}</div></div>`;
  }

  if (field.type === 'team_multi_select') {
    const selected = resolveSelectedTeamMembers(record);
    const members = teamProfilesForForm.length
      ? teamProfilesForForm
      : TEAM_MEMBERS.map(m => ({ ...m, profile: null }));
    const items = members.map(m => {
      const checked = selected.has(m.name) ? 'checked' : '';
      return `<label class="client-checkbox-item team-checkbox-item">
        <input type="checkbox" name="team_member_names" value="${escapeHtml(m.name)}" data-profile-id="${m.profile?.id || ''}" data-color="${m.color}" ${checked}>
        <span class="team-checkbox-dot notion-avatar notion-avatar-${m.color}">${m.name.charAt(0)}</span>
        <span>${escapeHtml(m.label || m.name)}</span>
      </label>`;
    }).join('');
    return `<div class="form-group ${full}"><label class="form-label">${field.label}</label>
      <div class="client-checkbox-group team-checkbox-group">${items}</div></div>`;
  }

  if (field.type === 'team_select') {
    const assignedTo = record?.assigned_to;
    const options = (teamProfilesForForm.length ? teamProfilesForForm : TEAM_MEMBERS.map(m => ({ ...m, profile: null }))).map(m => {
      const selected = value === m.name || (assignedTo && m.profile?.id === assignedTo);
      return `<option value="${escapeHtml(m.name)}" data-profile-id="${m.profile?.id || ''}" data-color="${m.color}" ${selected ? 'selected' : ''}>${escapeHtml(m.label || m.name)}</option>`;
    }).join('');
    return `<div class="form-group ${full}"><label class="form-label">${field.label}</label>
      <select class="form-input" name="${field.name}" id="task-assignee-select" ${req}>${options}</select></div>`;
  }

  if (field.type === 'user_select') {
    const options = profilesCache.map(u =>
      `<option value="${u.id}" ${value === u.id ? 'selected' : ''}>${escapeHtml(u.full_name || u.email)}</option>`
    ).join('');
    return `<div class="form-group ${full}"><label class="form-label">${field.label}</label>
      <select class="form-input" name="${field.name}" ${req}><option value="">— Selecionar —</option>${options}</select></div>`;
  }

  if (field.type === 'select') {
    const opts = field.options.map(o => {
      const label = o.charAt(0).toUpperCase() + o.slice(1).replace(/_/g, ' ');
      return `<option value="${o}" ${value === o ? 'selected' : ''}>${label}</option>`;
    }).join('');
    return `<div class="form-group ${full}"><label class="form-label">${field.label}</label>
      <select class="form-input" name="${field.name}" ${req}>${opts}</select></div>`;
  }

  if (field.type === 'textarea') {
    return `<div class="form-group ${full}"><label class="form-label">${field.label}</label>
      <textarea class="form-input" name="${field.name}" ${req}>${val}</textarea></div>`;
  }

  return `<div class="form-group ${full}"><label class="form-label">${field.label}</label>
    <input class="form-input" type="${field.type}" name="${field.name}" value="${val}" ${req}
      ${field.step ? `step="${field.step}"` : ''}></div>`;
}

export async function openCrudModal(entity, record = null, onSave) {
  let schema = SCHEMAS[entity];
  if (!schema) return;

  await loadClientsCache();
  const profile = await getProfile();

  let noteType = null;
  if (entity === 'notes') {
    noteType = record?.note_type || 'personal';
    if (!record?.id) {
      record = { ...(record || {}), note_type: noteType, author_id: profile?.id };
    }
    if (noteType === 'general') await loadProfilesCache();
    schema = getNotesSchema(noteType);
  }

  if (entity === 'tasks') {
    teamProfilesForForm = await loadTeamWithProfiles();
  }
  const isEdit = !!record?.id;

  const fieldsHtml = schema.fields.map(f => {
    let val = record?.[f.name] ?? '';
    if (f.name === 'tags' && Array.isArray(record?.tags)) val = record.tags.join(', ');
    if (f.type === 'datetime-local' && val) val = val.slice(0, 16);
    return renderField(f, val, record);
  }).join('');

  const uploadHtml = entity === 'invoices' ? `
    <div class="form-group full">
      <label class="form-label">Upload PDF do boleto</label>
      <div class="upload-zone" id="pdf-upload">
        <input type="file" id="pdf-file" accept="application/pdf">
        <p>Arraste ou clique para enviar PDF</p>
      </div>
    </div>` : '';

  const fileUploadHtml = entity === 'files' ? `
    <div class="form-group full">
      <label class="form-label">Arquivo</label>
      <div class="upload-zone" id="file-upload">
        <input type="file" id="file-input">
        <p>PDF, imagem, vídeo, ZIP ou documento</p>
      </div>
    </div>` : '';

  $('#detail-modal-title').textContent = `${isEdit ? 'Editar' : 'Novo'} ${schema.title}`;
  $('#detail-modal-body').innerHTML = `
    <form id="crud-form" class="crud-form">
      <div class="form-row">${fieldsHtml}${uploadHtml}${fileUploadHtml}</div>
      <div class="form-actions">
        ${isEdit ? '<button type="button" class="btn btn-ghost" id="crud-delete">Excluir</button>' : ''}
        <button type="button" class="btn btn-secondary" id="crud-cancel">Cancelar</button>
        <button type="submit" class="btn btn-primary">${isEdit ? 'Salvar' : 'Criar'}</button>
      </div>
    </form>`;

  $('#detail-modal').classList.remove('hidden');
  $('#overlay').classList.remove('hidden');

  crudState = { entity, record, onSave, schema, isEdit, noteType };
  requestAnimationFrame(() => {
    const form = $('#crud-form');
    if (form) crudState.initialSnapshot = serializeCrudForm(form);
  });

  const closeWithAutoSave = () => dismissCrudModal();
  $('#crud-cancel').onclick = closeWithAutoSave;
  if (isEdit) {
    $('#crud-delete').onclick = async () => {
      if (entity === 'clients') {
        if (!confirm('Remover cliente da lista? As senhas permanecem na aba Senhas Clientes.')) return;
      } else if (!confirm('Confirmar exclusão?')) {
        return;
      }
      try {
        if (entity === 'clients') {
          await clientsApi.update(record.id, { status: 'inativo' });
          showToast('Cliente removido. Senhas mantidas.', 'success');
        } else {
          await API_MAP[entity].remove(record.id);
          showToast('Excluído com sucesso', 'success');
        }
        closeCrudModal();
        onSave?.();
      } catch (e) { handleError(e); }
    };
  }

  $('#crud-form').onsubmit = async (e) => {
    e.preventDefault();
    const ok = await saveCrudForm({ silent: false });
    if (ok) closeCrudModal();
  };
}

export function openUploadModal({ clientId = null, folderCategoryId = null, folders = [] } = {}, onSave) {
  const folderOptions = folders.length
    ? folders
    : FILE_CATEGORIES.map(c => ({ slug: c.id, label: c.label, icon: c.icon }));
  const defaultCategory = folderCategoryId || folderOptions[0]?.slug || 'videos';

  $('#detail-modal-title').textContent = 'Upload de Arquivo';
  $('#detail-modal-body').innerHTML = `
    <form id="upload-form">
      <div class="form-group"><label class="form-label">Cliente</label>
        <select class="form-input" id="upload-client" required ${clientId ? 'disabled' : ''}>
          <option value="">— Selecionar —</option>
          ${clientsCache.map(c => `<option value="${c.id}" ${c.id === clientId ? 'selected' : ''}>${escapeHtml(c.company_name)}</option>`).join('')}
        </select>
        ${clientId ? `<input type="hidden" id="upload-client-hidden" value="${clientId}">` : ''}
      </div>
      <div class="form-group"><label class="form-label">Pasta</label>
        <select class="form-input" id="upload-folder" required>
          ${folderOptions.map(c => `<option value="${c.slug}" ${c.slug === defaultCategory ? 'selected' : ''}>${c.icon || '📁'} ${escapeHtml(c.label)}</option>`).join('')}
        </select>
      </div>
      <div class="upload-zone" id="upload-zone">
        <input type="file" id="upload-file" required accept="video/*,image/*,.pdf,.zip,.mov,.mp4,.mxf,.r3d,.braw">
        <p>📁 Arraste ou clique para selecionar</p>
        <p style="font-size:12px;color:var(--text-tertiary);margin-top:8px">Vídeos até 1 GB · Outros até 500 MB</p>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" id="upload-cancel-btn">Cancelar</button>
        <button type="submit" class="btn btn-primary" id="upload-submit-btn">Enviar</button>
      </div>
    </form>`;
  $('#detail-modal').classList.remove('hidden');
  $('#overlay').classList.remove('hidden');

  const zone = $('#upload-zone');
  zone.onclick = () => $('#upload-file').click();
  $('#upload-cancel-btn').onclick = closeCrudModal;

  $('#upload-form').onsubmit = async (e) => {
    e.preventDefault();
    const file = $('#upload-file').files[0];
    const cid = $('#upload-client-hidden')?.value || $('#upload-client').value;
    const folderSlug = $('#upload-folder').value;
    if (!file || !cid) return;

    const submitBtn = $('#upload-submit-btn');
    submitBtn.disabled = true;
    closeCrudModal();

    showUploadProgress({
      fileName: file.name,
      percent: 0,
      loaded: 0,
      total: file.size
    });

    try {
      await uploadFile(file, {
        clientId: cid,
        folderSlug,
        onProgress: ({ percent, loaded, total, etaSeconds }) => {
          showUploadProgress({ fileName: file.name, percent, loaded, total, etaSeconds, phase: 'upload' });
        }
      });
      showUploadProgress({
        fileName: file.name,
        percent: 100,
        loaded: file.size,
        total: file.size,
        phase: 'save'
      });
      showToast('Arquivo enviado!', 'success');
      onSave?.();
    } catch (err) {
      handleError(err);
    } finally {
      hideUploadProgress();
      submitBtn.disabled = false;
    }
  };
}

export function openDriveLinkModal({ clientId = null, folderCategoryId = null, folders = [] } = {}, onSave) {
  const folderOptions = folders.length
    ? folders
    : FILE_CATEGORIES.map(c => ({ slug: c.id, label: c.label, icon: c.icon }));
  const defaultCategory = folderCategoryId || folderOptions[0]?.slug || 'videos';

  $('#detail-modal-title').textContent = 'Link do Google Drive';
  $('#detail-modal-body').innerHTML = `
    <form id="drive-link-form">
      <div class="form-group"><label class="form-label">Cliente</label>
        <select class="form-input" id="drive-client" required ${clientId ? 'disabled' : ''}>
          <option value="">— Selecionar —</option>
          ${clientsCache.map(c => `<option value="${c.id}" ${c.id === clientId ? 'selected' : ''}>${escapeHtml(c.company_name)}</option>`).join('')}
        </select>
        ${clientId ? `<input type="hidden" id="drive-client-hidden" value="${clientId}">` : ''}
      </div>
      <div class="form-group"><label class="form-label">Pasta</label>
        <select class="form-input" id="drive-folder" required>
          ${folderOptions.map(c => `<option value="${c.slug}" ${c.slug === defaultCategory ? 'selected' : ''}>${c.icon || '📁'} ${escapeHtml(c.label)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label class="form-label">Nome do arquivo</label>
        <input class="form-input" id="drive-name" type="text" required placeholder="Ex.: Vídeo 4K — Campanha Março">
      </div>
      <div class="form-group"><label class="form-label">Link do Google Drive</label>
        <input class="form-input" id="drive-url" type="url" required placeholder="https://drive.google.com/file/d/...">
        <p style="font-size:12px;color:var(--text-tertiary);margin-top:8px">Cole o link compartilhado do arquivo ou pasta. O arquivo fica no Drive — <strong>zero espaço</strong> no site.</p>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" id="drive-cancel-btn">Cancelar</button>
        <button type="submit" class="btn btn-primary">Adicionar link</button>
      </div>
    </form>`;
  $('#detail-modal').classList.remove('hidden');
  $('#overlay').classList.remove('hidden');

  $('#drive-cancel-btn').onclick = closeCrudModal;

  $('#drive-link-form').onsubmit = async (e) => {
    e.preventDefault();
    const cid = $('#drive-client-hidden')?.value || $('#drive-client').value;
    const folderSlug = $('#drive-folder').value;
    const name = $('#drive-name').value.trim();
    const url = $('#drive-url').value.trim();
    if (!cid || !name || !url) return;

    try {
      await linkDriveFile({ clientId: cid, folderSlug, name, url });
      showToast('Link do Drive adicionado!', 'success');
      closeCrudModal();
      onSave?.();
    } catch (err) { handleError(err); }
  };
}

function closeCrudModal() {
  $('#detail-modal').classList.add('hidden');
  $('#overlay').classList.add('hidden');
  crudState = null;
}

export { closeCrudModal };
