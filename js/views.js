import {
  formatCurrency, formatDate, formatDateShort, formatDateTime, formatFileSize,
  statusBadge, priorityBadge, escapeHtml, areaTag
} from './utils.js';
import {
  clientsApi, projectsApi, tasksApi, invoicesApi, paymentsApi,
  eventsApi, meetingsApi, notesApi, campaignsApi, filesApi,
  creativesApi, videosApi, notificationsApi, integrationsApi,
  getDashboardStats
} from './api/crud.js?v=20260703a';
import { INTEGRATION_PROVIDERS, ROLE_LABELS, TEAM_MEMBERS, inferColorOwner, FILE_CLIENT_GROUPS, findClientGroupForName } from './config.js';
import { canManage } from './auth.js';
import { parseHashQuery } from './router.js';
import { ensureClientFolders, fileMatchesFolder, findFolderBySlug } from './services/file-folders.js?v=20260621a';

function metricCard(label, value, icon = '', color = 'purple') {
  return `<div class="metric-card">
    ${icon ? `<div class="metric-icon ${color}">${icon}</div>` : ''}
    <div class="metric-label">${label}</div>
    <div class="metric-value">${value}</div>
  </div>`;
}

function pageHeader(title, subtitle, actions = '') {
  return `<div class="page-header">
    <h1 class="page-title">${title}</h1>
    ${subtitle ? `<p class="page-subtitle">${subtitle}</p>` : ''}
    ${actions ? `<div class="page-actions">${actions}</div>` : ''}
  </div>`;
}

function emptyState(msg = 'Nenhum registro encontrado') {
  return `<div class="empty-db"><div class="empty-state-icon">📭</div><div class="empty-state-title">${msg}</div>
    <p style="margin-top:8px;font-size:13px">Clique em "+ Novo" para adicionar</p></div>`;
}

function sortNotes(notes) {
  return [...notes].sort((a, b) => {
    const aDone = a.is_completed ? 1 : 0;
    const bDone = b.is_completed ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return new Date(b.created_at) - new Date(a.created_at);
  });
}

function renderNoteCard(note, { showAuthor = false, showAssignee = false, hideTypeBadge = false } = {}) {
  const done = !!note.is_completed;
  const typeBadge = hideTypeBadge ? '' : (
    note.note_type === 'general'
      ? '<span class="note-type-badge note-type-general">Geral</span>'
      : '<span class="note-type-badge note-type-personal">Pessoal</span>'
  );
  return `<div class="note-card${done ? ' is-completed' : ''}" data-edit="notes" data-id="${note.id}">
    <div class="note-card-header">
      <div class="note-card-title">${escapeHtml(note.title)}</div>
      ${typeBadge}
    </div>
    <div class="note-card-content">${escapeHtml(note.content || '')}</div>
    <div class="note-card-meta">
      ${showAuthor && note.author?.full_name ? `<span class="note-meta-item">Por ${escapeHtml(note.author.full_name)}</span>` : ''}
      ${showAssignee && note.assignee?.full_name ? `<span class="note-meta-item note-assignee">Responsável: ${escapeHtml(note.assignee.full_name)}</span>` : ''}
      <span class="note-meta-item">${formatDateShort(note.created_at)}</span>
    </div>
    <button type="button" class="note-complete-btn${done ? ' is-done' : ''}" data-note-complete="${note.id}" data-completed="${done ? '1' : '0'}">
      ${done ? '✓ Concluída' : 'Concluir'}
    </button>
  </div>`;
}

function normalizeFolderId(folderPath = '/') {
  return (folderPath || '/').replace(/^\/+|\/+$/g, '');
}

function fileTypeIcon(type, { drive = false } = {}) {
  if (drive) return type === 'pasta' ? '📁' : '🔗';
  const icons = { pdf: '📄', video: '🎬', imagem: '🖼️', zip: '📦', documento: '📁', pasta: '📁' };
  return icons[type] || '📄';
}

function isDriveFileRecord(file) {
  return file?.source === 'drive' || Boolean(file?.external_url);
}

function renderFileCard(file, { canDelete = false } = {}) {
  const drive = isDriveFileRecord(file);
  const meta = drive
    ? `<span class="file-drive-badge">Google Drive</span> · ${formatDateShort(file.created_at)}`
    : `${formatFileSize(file.size_bytes)} · ${formatDateShort(file.created_at)}`;
  const openLabel = drive ? 'Abrir no Drive' : 'Baixar';

  return `<div class="file-item file-item-doc${drive ? ' file-item-drive' : ''}" data-file-doc data-file-id="${file.id}" draggable="false">
    <div class="file-icon">${fileTypeIcon(file.file_type, { drive })}</div>
    <div class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
    <div class="file-meta">${meta}</div>
    <div class="file-item-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-file-download="${file.id}" title="${openLabel}">${drive ? '↗' : '↓'}</button>
      ${canDelete ? `<button type="button" class="btn btn-ghost btn-sm file-delete-btn" data-file-delete="${file.id}" data-file-drive="${drive ? '1' : ''}" title="Excluir">×</button>` : ''}
    </div>
  </div>`;
}

function renderFileBreadcrumb(segments) {
  return `<nav class="file-breadcrumb" aria-label="Navegação de pastas">
    ${segments.map((s, i) => {
      const isLast = i === segments.length - 1;
      const sep = i > 0 ? '<span class="file-breadcrumb-sep">/</span>' : '';
      if (isLast) return `${sep}<span class="file-breadcrumb-current">${escapeHtml(s.label)}</span>`;
      const attrs = ` data-file-nav data-grupo="${s.grupo || ''}" data-client="${s.client || ''}" data-pasta="${s.pasta || ''}"`;
      return `${sep}<button type="button" class="file-breadcrumb-link"${attrs}>${escapeHtml(s.label)}</button>`;
    }).join('')}
  </nav>`;
}

function renderGroupFolder(group, fileCount) {
  return `<button type="button" class="file-item file-folder file-folder-group" data-file-nav data-grupo="${group.id}" data-client="" data-pasta="">
    <div class="file-icon file-folder-icon">${group.icon}</div>
    <div class="file-name">${escapeHtml(group.label)}</div>
    <div class="file-meta">${fileCount} arquivo${fileCount !== 1 ? 's' : ''} · ${group.clientNames.length} pastas</div>
  </button>`;
}

function renderClientFolder(client, fileCount, { grupo = '' } = {}) {
  return `<button type="button" class="file-item file-folder file-folder-client" data-file-nav data-grupo="${grupo}" data-client="${client.id}" data-pasta="">
    <div class="file-icon file-folder-icon">${escapeHtml(client.icon || '📁')}</div>
    <div class="file-name">${escapeHtml(client.company_name)}</div>
    <div class="file-meta">${fileCount} arquivo${fileCount !== 1 ? 's' : ''}</div>
  </button>`;
}

function renderDbFolder(folder, fileCount, clientId, { draggable = false, grupo = '' } = {}) {
  return `<button type="button" class="file-item file-folder" data-file-folder data-file-nav
    data-folder-id="${folder.id}" data-grupo="${grupo}" data-client="${clientId}" data-pasta="${folder.slug}"
    ${draggable ? 'draggable="true"' : ''}>
    <div class="file-icon file-folder-icon">${escapeHtml(folder.icon || '📁')}</div>
    <div class="file-name">${escapeHtml(folder.label)}</div>
    <div class="file-meta">${fileCount} arquivo${fileCount !== 1 ? 's' : ''}</div>
  </button>`;
}

function clientsInGroup(clients, group) {
  return group.clientNames
    .map(name => clients.find(c => c.company_name === name))
    .filter(Boolean);
}

function groupedClientNames() {
  return new Set(FILE_CLIENT_GROUPS.flatMap(g => g.clientNames));
}

function fileCountForClients(filesByClient, clientList) {
  return clientList.reduce((sum, c) => sum + (filesByClient[c.id] || []).length, 0);
}

function arquivosBreadcrumbRoot() {
  return [{ label: 'Arquivos', grupo: '', client: '', pasta: '' }];
}

function arquivosBreadcrumbWithGroup(group) {
  return [
    ...arquivosBreadcrumbRoot(),
    { label: group.label, grupo: group.id, client: '', pasta: '' }
  ];
}

export const Views = {
  async dashboard(profile) {
    const stats = await getDashboardStats();
    const subtitle = `Olá, ${escapeHtml(profile.full_name || profile.email)} — ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}`;
    const [tasks, meetings] = await Promise.all([
      tasksApi.list({ order: { column: 'created_at' }, limit: 5 }),
      meetingsApi.list({ order: { column: 'scheduled_at' }, limit: 5 })
    ]);

    return `
      ${pageHeader('Dashboard', subtitle)}
      <div class="grid grid-auto" style="margin-bottom:24px">
        ${metricCard('Receita do Mês', formatCurrency(stats.receitaMes), '💰', 'green')}
        ${metricCard('Lucro do Mês', formatCurrency(stats.lucroMes), '📈', 'purple')}
        ${metricCard('Boletos Pendentes', stats.boletosPendentes, '📄', 'yellow')}
        ${metricCard('Clientes Ativos', stats.clientesAtivos, '👥', 'blue')}
        ${metricCard('Clientes em Risco', stats.clientesRisco, '⚠️', 'red')}
        ${metricCard('Projetos', stats.projetosAndamento, '🚀', 'purple')}
        ${metricCard('Campanhas Ativas', stats.campanhasAtivas, '🎯', 'blue')}
        ${metricCard('Leads', stats.leadsGerados, '📊', 'green')}
        ${metricCard('ROAS Médio', `${stats.roasMedio}x`, '📈', 'green')}
        ${metricCard('Investimento Ads', formatCurrency(stats.investimentoAnuncios), '💸', 'yellow')}
      </div>
      <div class="card" style="margin-bottom:24px">
        <div class="card-header"><span class="card-title">Meta Mensal — ${formatCurrency(stats.metaMensal)}</span></div>
        <div class="progress-bar"><div class="progress-fill" style="width:${stats.percentualMeta}%"></div></div>
        <p style="margin-top:8px;font-size:13px;color:var(--text-secondary)">${stats.percentualMeta}% atingido</p>
      </div>
      <div class="two-col">
        <div class="section">
          <div class="section-header"><span class="section-title">Tarefas Recentes</span></div>
          <div class="card" style="padding:0">
            ${tasks.length ? tasks.map(t => `
              <div class="list-item" data-edit="tasks" data-id="${t.id}">
                <div class="list-item-content">
                  <div class="list-item-title">${escapeHtml(t.title)}</div>
                  <div class="list-item-desc">${formatDateShort(t.due_date)}</div>
                </div>
                ${statusBadge(t.status)}
              </div>`).join('') : emptyState('Sem tarefas')}
          </div>
        </div>
        <div class="section">
          <div class="section-header"><span class="section-title">Próximas Reuniões</span></div>
          <div class="card" style="padding:0">
            ${meetings.length ? meetings.map(m => `
              <div class="list-item">
                <div class="list-item-content">
                  <div class="list-item-title">${escapeHtml(m.title)}</div>
                  <div class="list-item-desc">${formatDateTime(m.scheduled_at)}</div>
                </div>
              </div>`).join('') : emptyState('Sem reuniões')}
          </div>
        </div>
      </div>`;
  },

  async clientes(profile) {
    const allClients = await clientsApi.list({ order: { column: 'company_name', asc: true } });
    const clients = allClients.filter(c => c.status !== 'inativo');
    const canEdit = canManage(profile);
    const rows = clients.map(c => `
      <tr data-edit="clients" data-id="${c.id}" class="notion-row">
        <td class="notion-cell-name"><span class="client-icon">${escapeHtml(c.icon || '📋')}</span> ${escapeHtml(c.company_name)}</td>
        <td>${areaTag(c.area_atuacao)}</td>
        <td class="notion-cell-muted">${c.notes ? '📎' : '—'}</td>
        <td class="notion-cell-notes">${escapeHtml((c.notes || '').slice(0, 120))}${(c.notes || '').length > 120 ? '…' : ''}</td>
        ${canEdit ? `<td class="notion-cell-actions"><button type="button" class="btn btn-ghost btn-sm btn-danger-ghost client-delete-btn" data-client-archive="${c.id}" title="Remover da lista (senhas mantidas)">🗑</button></td>` : ''}
      </tr>`).join('');

    const senhasRows = allClients.map(c => `
      <tr data-edit="clients" data-id="${c.id}" class="notion-row">
        <td class="notion-cell-name">${escapeHtml(c.company_name)}</td>
        <td>${escapeHtml(c.instagram || '—')}</td>
        <td>${escapeHtml(c.instagram_password || '—')}</td>
        <td>${escapeHtml(c.tiktok_password || '—')}</td>
        <td>${escapeHtml(c.facebook_password || '—')}</td>
        <td>${escapeHtml(c.email || '—')}</td>
        <td>${escapeHtml(c.email_password || '—')}</td>
        <td>${escapeHtml(c.linktree || '—')}</td>
        <td>${escapeHtml(c.linktree_password || '—')}</td>
      </tr>`).join('');

    return `
      ${pageHeader('Gestão de Projetos — CDM Marketing', 'Clientes CDM', canEdit ? '<button class="btn btn-primary" data-create="clients">+ Novo Cliente</button>' : '')}
      <div class="tabs notion-tabs" id="client-tabs">
        <button class="tab active" data-client-tab="lista">Clientes CDM</button>
        <button class="tab" data-client-tab="senhas">Senhas Clientes</button>
      </div>
      <div id="client-panel-lista" class="client-panel">
        <div class="table-wrapper notion-table-wrap">
          <table class="notion-table">
            <thead><tr><th>Clientes</th><th>Área de Atuação</th><th>Arquivos e mídia</th><th>Observações</th>${canEdit ? '<th></th>' : ''}</tr></thead>
            <tbody>${rows || `<tr><td colspan="${canEdit ? 5 : 4}">${emptyState()}</td></tr>`}</tbody>
          </table>
        </div>
      </div>
      <div id="client-panel-senhas" class="client-panel hidden">
        <div class="table-wrapper notion-table-wrap">
          <table class="notion-table">
            <thead><tr>
              <th>Cliente</th><th>Login</th><th>Senha Insta</th><th>Senha TikTok</th>
              <th>Senha Face</th><th>E-mail</th><th>Senha E-mail</th><th>Linktree</th><th>Senha Linktree</th>
            </tr></thead>
            <tbody>${senhasRows}</tbody>
          </table>
        </div>
      </div>`;
  },

  async projetos(profile) {
    const projects = await projectsApi.list({ order: { column: 'created_at' } });
    return `
      ${pageHeader('Projetos', `${projects.length} projetos`, canManage(profile) ? '<button class="btn btn-primary" data-create="projects">+ Novo Projeto</button>' : '')}
      <div class="table-wrapper"><table><thead><tr><th>Nome</th><th>Cliente</th><th>Status</th><th>Orçamento</th><th>Prazo</th></tr></thead><tbody>
        ${projects.length ? projects.map(p => `
          <tr data-edit="projects" data-id="${p.id}" style="cursor:pointer">
            <td style="font-weight:500">${escapeHtml(p.name)}</td>
            <td>${escapeHtml(p.clients?.company_name || '—')}</td>
            <td>${statusBadge(p.status)}</td>
            <td>${formatCurrency(p.budget)}</td>
            <td>${formatDateShort(p.end_date)}</td>
          </tr>`).join('') : `<tr><td colspan="5">${emptyState()}</td></tr>`}
      </tbody></table></div>`;
  },

  async tarefas(profile) {
    const tasks = await tasksApi.list({ order: { column: 'due_date' } });
    const cols = { a_fazer: 'A Fazer', em_progresso: 'Em Progresso', concluido: 'Concluído' };
    const calLink = canManage(profile)
      ? '<button class="btn btn-secondary" data-view-link="calendario">📅 Ver no Calendário</button>'
      : '';
    return `
      ${pageHeader('Tarefas', 'Kanban operacional — Calendário de Conteúdos',
        `${calLink}${canManage(profile) ? '<button class="btn btn-primary" data-create="tasks">+ Nova Tarefa</button>' : ''}`)}
      <div class="kanban">
        ${Object.entries(cols).map(([key, title]) => {
          const col = tasks.filter(t => t.column_name === key);
          return `<div class="kanban-column">
            <div class="kanban-column-header"><span class="kanban-column-title">${title}</span><span class="kanban-count">${col.length}</span></div>
            ${col.map(t => `<div class="kanban-card" data-edit="tasks" data-id="${t.id}">
              <div class="kanban-card-title">${escapeHtml(t.title)}</div>
              <div class="kanban-card-meta">
                <span>${priorityBadge(t.priority)}</span>
                <span>${formatDateShort(t.due_date)}</span>
                ${t.clients?.company_name ? `<span class="tag">${escapeHtml(t.clients.company_name)}</span>` : ''}
              </div>
            </div>`).join('')}
          </div>`;
        }).join('')}
      </div>`;
  },

  async financeiro(profile) {
    if (!canManage(profile)) return pageHeader('Acesso negado', 'Sem permissão para financeiro');
    const payments = await paymentsApi.list({ order: { column: 'payment_date' } });
    const receitas = payments.filter(p => p.type === 'receita').reduce((s, p) => s + Number(p.amount), 0);
    const despesas = payments.filter(p => p.type === 'despesa').reduce((s, p) => s + Number(p.amount), 0);
    return `
      ${pageHeader('Financeiro', 'Receitas, despesas e fluxo de caixa',
        '<button class="btn btn-primary" data-create="payments" data-extra=\'{"type":"receita"}\'>+ Receita</button><button class="btn btn-secondary" data-create="payments" data-extra=\'{"type":"despesa"}\'>+ Despesa</button>')}
      <div class="grid grid-3" style="margin-bottom:24px">
        ${metricCard('Receitas', formatCurrency(receitas), '💰', 'green')}
        ${metricCard('Despesas', formatCurrency(despesas), '💸', 'red')}
        ${metricCard('Saldo', formatCurrency(receitas - despesas), '📊', 'purple')}
      </div>
      <div class="table-wrapper"><table><thead><tr><th>Descrição</th><th>Tipo</th><th>Valor</th><th>Categoria</th><th>Data</th></tr></thead><tbody>
        ${payments.map(p => `<tr data-edit="payments" data-id="${p.id}" style="cursor:pointer">
          <td>${escapeHtml(p.description)}</td><td>${statusBadge(p.type === 'receita' ? 'ativo' : 'risco')}</td>
          <td>${formatCurrency(p.amount)}</td><td>${escapeHtml(p.category || '—')}</td><td>${formatDateShort(p.payment_date)}</td>
        </tr>`).join('') || `<tr><td colspan="5">${emptyState()}</td></tr>`}
      </tbody></table></div>`;
  },

  async boletos(profile) {
    const invoices = await invoicesApi.list({ order: { column: 'due_date' } });
    const canEdit = canManage(profile);
    return `
      ${pageHeader('Boletos', `${invoices.length} boletos`, canEdit ? '<button class="btn btn-primary" data-create="invoices">+ Emitir Boleto</button>' : '')}
      <div class="table-wrapper"><table><thead><tr><th>Cliente</th><th>Valor</th><th>Vencimento</th><th>Status</th><th>Ações</th></tr></thead><tbody>
        ${invoices.length ? invoices.map(i => `<tr>
          <td style="font-weight:500">${escapeHtml(i.clients?.company_name || '—')}</td>
          <td>${formatCurrency(i.amount)}</td><td>${formatDate(i.due_date)}</td><td>${statusBadge(i.status)}</td>
          <td>${canEdit ? `<button class="btn btn-sm btn-ghost" data-edit="invoices" data-id="${i.id}">Editar</button>` : ''}
          ${i.pdf_path ? '<span class="badge badge-success">PDF</span>' : ''}</td>
        </tr>`).join('') : `<tr><td colspan="5">${emptyState()}</td></tr>`}
      </tbody></table></div>`;
  },

  async calendario(profile) {
    const { renderCalendarView, highlightPendingTask } = await import('./calendar.js?v=20260813b');
    const html = await renderCalendarView(profile);
    queueMicrotask(() => highlightPendingTask());
    return html;
  },

  async escritorio(profile) {
    const { renderOffice } = await import('./office.js?v=20260816d');
    return renderOffice(profile);
  },

  async reunioes(profile) {
    const meetings = await meetingsApi.list({ order: { column: 'scheduled_at' } });
    return `
      ${pageHeader('Reuniões', 'Agenda comercial e operacional', canManage(profile) ? '<button class="btn btn-primary" data-create="meetings">+ Nova Reunião</button>' : '')}
      <div class="table-wrapper"><table><thead><tr><th>Título</th><th>Cliente</th><th>Data</th><th>Tipo</th><th>Status</th></tr></thead><tbody>
        ${meetings.map(m => `<tr data-edit="meetings" data-id="${m.id}" style="cursor:pointer">
          <td style="font-weight:500">${escapeHtml(m.title)}</td>
          <td>${escapeHtml(m.clients?.company_name || '—')}</td>
          <td>${formatDateTime(m.scheduled_at)}</td>
          <td><span class="tag">${m.meeting_type}</span></td>
          <td>${statusBadge(m.status || 'planejado')}</td>
        </tr>`).join('') || `<tr><td colspan="5">${emptyState()}</td></tr>`}
      </tbody></table></div>`;
  },

  async trafego(profile) {
    const campaigns = await campaignsApi.list({ order: { column: 'created_at' } });

    const totalSpent   = campaigns.reduce((s, c) => s + (c.spent  || 0), 0);
    const totalLeads   = campaigns.reduce((s, c) => s + (c.leads  || 0), 0);
    const avgRoas      = campaigns.filter(c => c.roas > 0);
    const roasMedia    = avgRoas.length ? (avgRoas.reduce((s, c) => s + c.roas, 0) / avgRoas.length).toFixed(2) : '0.00';
    const ativas       = campaigns.filter(c => c.status === 'ativa').length;

    const platformIcon = { meta_ads: '📘', google_ads: '🔍', tiktok_ads: '🎵' };

    const syncBannerHtml = canManage(profile) ? `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
        <button class="btn btn-ghost btn-sm" id="trafego-sync-btn" style="display:flex;align-items:center;gap:6px">
          <span>↻</span> Sincronizar Meta Ads
        </button>
        <span id="trafego-sync-msg" style="font-size:12px;color:var(--text-tertiary)"></span>
      </div>` : '';

    const actions = canManage(profile)
      ? `<div style="display:flex;gap:8px">${syncBannerHtml}<button class="btn btn-primary" data-create="campaigns">+ Nova Campanha</button></div>`
      : '';

    return `
      ${pageHeader('Tráfego Pago', `${campaigns.length} campanhas`, actions)}

      <div class="metrics-row" style="margin-bottom:24px">
        ${metricCard('Total Gasto', formatCurrency(totalSpent), '💸', 'orange')}
        ${metricCard('Total Leads', totalLeads.toLocaleString('pt-BR'), '🎯', 'blue')}
        ${metricCard('ROAS Médio', `${roasMedia}x`, '📈', roasMedia >= 3 ? 'green' : 'red')}
        ${metricCard('Ativas', ativas, '▶', 'purple')}
      </div>

      <div class="table-wrapper">
        <table>
          <thead><tr>
            <th>Campanha</th><th>Cliente</th><th>Plataforma</th>
            <th>Budget</th><th>Gasto</th><th>ROAS</th><th>Leads</th><th>CPA</th><th>Status</th>
          </tr></thead>
          <tbody>
            ${campaigns.map(c => {
              const icon = platformIcon[c.platform] || '📡';
              const meta = c.metadata || {};
              const impressionsHtml = meta.impressions
                ? `<br><span style="font-size:11px;color:var(--text-tertiary)">${Number(meta.impressions).toLocaleString('pt-BR')} impressões</span>`
                : '';
              return `<tr data-edit="campaigns" data-id="${c.id}" style="cursor:pointer">
                <td style="font-weight:500">${escapeHtml(c.name)}${impressionsHtml}</td>
                <td>${escapeHtml(c.clients?.company_name || '')}</td>
                <td><span class="tag">${icon} ${escapeHtml(c.platform.replace('_', ' '))}</span></td>
                <td>${formatCurrency(c.budget)}</td>
                <td>${formatCurrency(c.spent)}</td>
                <td style="color:${c.roas >= 3 ? 'var(--success)' : c.roas > 0 ? 'inherit' : 'var(--text-tertiary)'}">${c.roas > 0 ? c.roas + 'x' : '—'}</td>
                <td>${c.leads || '—'}</td>
                <td>${c.cpa > 0 ? formatCurrency(c.cpa) : '—'}</td>
                <td>${statusBadge(c.status)}</td>
              </tr>`;
            }).join('') || `<tr><td colspan="9">${emptyState()}</td></tr>`}
          </tbody>
        </table>
      </div>`;
  },

  async arquivos(profile) {
    const query = parseHashQuery();
    let clientId = query.client || '';
    let grupoId = query.grupo || '';
    const pastaId = query.pasta || '';
    const isStaff = canManage(profile) || profile.role === 'colaborador';
    const canManageFolders = isStaff;

    if (profile.role === 'cliente' && profile.client_id && !clientId) {
      clientId = profile.client_id;
    }

    const [allClients, allFiles] = await Promise.all([
      clientsApi.list({ order: { column: 'company_name', asc: true } }),
      filesApi.list({ order: { column: 'created_at' } })
    ]);

    let clients = allClients;
    if (profile.role === 'cliente' && profile.client_id) {
      clients = allClients.filter(c => c.id === profile.client_id);
    }

    const filesByClient = {};
    allFiles.forEach(f => {
      const cid = f.client_id || 'geral';
      if (!filesByClient[cid]) filesByClient[cid] = [];
      filesByClient[cid].push(f);
    });

    const newFolderBtn = canManageFolders && clientId
      ? `<button class="btn btn-secondary" id="btn-new-folder" data-client-id="${clientId}">+ Nova pasta</button>`
      : '';

    const driveLinkBtn = isStaff && clientId
      ? `<button class="btn btn-secondary" id="btn-drive-link" data-drive-client="${clientId}" data-drive-pasta="${pastaId}">+ Link do Drive</button>`
      : '';

    const uploadBtn = isStaff
      ? `<button class="btn btn-primary" id="btn-upload" data-upload-client="${clientId}" data-upload-pasta="${pastaId}">+ Upload</button>`
      : '';

    const actions = [newFolderBtn, driveLinkBtn, uploadBtn].filter(Boolean).join('');

    // Raiz — grupos + clientes avulsos
    if (!clientId && !grupoId) {
      const inGroup = groupedClientNames();
      const groupFolders = FILE_CLIENT_GROUPS.map(g =>
        renderGroupFolder(g, fileCountForClients(filesByClient, clientsInGroup(clients, g)))
      ).join('');
      const looseClients = clients
        .filter(c => !inGroup.has(c.company_name))
        .map(c => renderClientFolder(c, (filesByClient[c.id] || []).length))
        .join('');

      return `
        ${pageHeader('Central de Arquivos', 'Pastas por cliente e grupos', actions)}
        ${renderFileBreadcrumb(arquivosBreadcrumbRoot())}
        ${groupFolders ? `<p class="file-section-label">Grupos</p><div class="file-grid file-grid-folders">${groupFolders}</div>` : ''}
        ${looseClients ? `<p class="file-section-label">Clientes</p><div class="file-grid file-grid-folders">${looseClients}</div>` : ''}
        ${!groupFolders && !looseClients ? emptyState('Nenhum cliente cadastrado') : ''}`;
    }

    // Dentro de um grupo (ex.: Distribuidoras)
    if (!clientId && grupoId) {
      const group = FILE_CLIENT_GROUPS.find(g => g.id === grupoId);
      if (!group) {
        return `
          ${pageHeader('Central de Arquivos', 'Grupo não encontrado', actions)}
          ${renderFileBreadcrumb(arquivosBreadcrumbRoot())}
          ${emptyState('Pasta não encontrada')}`;
      }

      const groupClients = clientsInGroup(clients, group);
      const folders = groupClients
        .map(c => renderClientFolder(c, (filesByClient[c.id] || []).length, { grupo: grupoId }))
        .join('');

      return `
        ${pageHeader('Central de Arquivos', escapeHtml(group.label), actions)}
        ${renderFileBreadcrumb([
          ...arquivosBreadcrumbRoot(),
          { label: group.label, grupo: grupoId, client: '', pasta: '' }
        ])}
        <div class="file-grid file-grid-folders">${folders || emptyState('Nenhuma pasta neste grupo')}</div>`;
    }

    const client = clients.find(c => c.id === clientId);
    if (!client) {
      return `
        ${pageHeader('Central de Arquivos', 'Cliente não encontrado', actions)}
        ${renderFileBreadcrumb(arquivosBreadcrumbRoot())}
        ${emptyState('Pasta não encontrada')}`;
    }

    const clientGroup = findClientGroupForName(client.company_name);
    if (!grupoId && clientGroup) grupoId = clientGroup.id;

    const clientFolders = await ensureClientFolders(clientId);
    const clientFiles = (filesByClient[clientId] || []).filter(f => fileMatchesFolder(f, pastaId));

    const clientBreadcrumb = clientGroup
      ? [
          ...arquivosBreadcrumbWithGroup(clientGroup),
          { label: client.company_name, grupo: grupoId, client: clientId, pasta: '' }
        ]
      : [
          ...arquivosBreadcrumbRoot(),
          { label: client.company_name, grupo: '', client: clientId, pasta: '' }
        ];

    if (!pastaId) {
      const categoryFolders = clientFolders.map(folder => {
        const count = (filesByClient[clientId] || []).filter(f => fileMatchesFolder(f, folder.slug)).length;
        return renderDbFolder(folder, count, clientId, { draggable: canManageFolders, grupo: grupoId });
      }).join('');

      const allClientFiles = filesByClient[clientId] || [];

      return `
        ${pageHeader('Central de Arquivos', escapeHtml(client.company_name), actions)}
        ${renderFileBreadcrumb(clientBreadcrumb)}
        <p class="file-section-label">Pastas <span class="file-hint">· arraste para reordenar · clique direito para excluir</span></p>
        <div class="file-grid file-grid-folders" id="file-folder-grid">${categoryFolders}</div>
        ${allClientFiles.length ? `
          <p class="file-section-label">Todos os arquivos <span class="file-hint">· arraste para uma pasta</span></p>
          <div class="file-grid">${allClientFiles.map(f => renderFileCard(f, { canDelete: canManage(profile) })).join('')}</div>
        ` : ''}`;
    }

    const folder = findFolderBySlug(clientFolders, pastaId);
    if (!folder) {
      return `
        ${pageHeader('Central de Arquivos', escapeHtml(client.company_name), actions)}
        ${renderFileBreadcrumb([...clientBreadcrumb, { label: 'Pasta inválida' }])}
        ${emptyState('Pasta não encontrada')}`;
    }

    return `
      ${pageHeader('Central de Arquivos', `${client.company_name} · ${folder.label}`, actions)}
      ${renderFileBreadcrumb([
        ...clientBreadcrumb,
        { label: folder.label, grupo: grupoId, client: clientId, pasta: pastaId }
      ])}
      <div class="file-grid" id="file-list" data-client-id="${clientId}" data-pasta-id="${pastaId}">
        ${clientFiles.length
          ? clientFiles.map(f => renderFileCard(f, { canDelete: canManage(profile) })).join('')
          : `<div class="file-empty-folder">${emptyState(`Nenhum arquivo em ${folder.label}`)}<p class="file-empty-hint">Use <strong>+ Upload</strong> ou <strong>+ Link do Drive</strong> — o Drive não gasta espaço do site.</p></div>`}
      </div>`;
  },

  async 'notas-pessoais'(profile) {
    const notes = await notesApi.list({ order: { column: 'created_at', asc: false } });
    const personalNotes = sortNotes(notes.filter(n => n.note_type === 'personal'));
    const cardsHtml = personalNotes.length
      ? personalNotes.map(n => renderNoteCard(n, { hideTypeBadge: true })).join('')
      : emptyState('Nenhuma nota pessoal');

    return `
      ${pageHeader('Notas Pessoais', 'Somente você pode ver estas notas', '<button class="btn btn-primary" data-create="notes" data-extra=\'{"note_type":"personal"}\'>+ Nova Nota</button>')}
      <div class="grid grid-3">${cardsHtml}</div>`;
  },

  async 'notas-gerais'(profile) {
    const notes = await notesApi.list({ order: { column: 'created_at', asc: false } });
    const generalNotes = sortNotes(notes.filter(n => n.note_type === 'general'));
    const cardsHtml = generalNotes.length
      ? generalNotes.map(n => renderNoteCard(n, { showAuthor: true, showAssignee: true, hideTypeBadge: true })).join('')
      : emptyState('Nenhuma nota geral');

    return `
      ${pageHeader('Notas Gerais', 'Visível para toda a equipe · Atribua um responsável', '<button class="btn btn-primary" data-create="notes" data-extra=\'{"note_type":"general"}\'>+ Nova Nota</button>')}
      <div class="grid grid-3">${cardsHtml}</div>`;
  },

  async producao(profile) {
    const videos = await videosApi.list({ order: { column: 'created_at' } });
    return `
      ${pageHeader('Produção Audiovisual', `${videos.length} produções`)}
      <div class="grid grid-auto">
        ${videos.length ? videos.map(v => `
          <div class="card">
            <div style="font-weight:600;margin-bottom:8px">${escapeHtml(v.title)}</div>
            <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:12px">${escapeHtml(v.clients?.company_name || '')} · ${v.type}</div>
            ${statusBadge(v.status)} ${statusBadge(v.approval_status)}
          </div>`).join('') : emptyState()}
      </div>`;
  },

  async design(profile) {
    const creatives = await creativesApi.list({ order: { column: 'created_at' } });
    return `
      ${pageHeader('Design', `${creatives.length} artes`)}
      <div class="grid grid-auto">
        ${creatives.length ? creatives.map(d => `
          <div class="card">
            <div style="font-weight:600">${escapeHtml(d.title)}</div>
            <div style="font-size:12px;color:var(--text-tertiary)">${d.type} · v${d.version}</div>
            ${statusBadge(d.status)}
          </div>`).join('') : emptyState()}
      </div>`;
  },

  async integracoes(profile) {
    if (!canManage(profile)) return pageHeader('Acesso negado', 'Apenas gestores e admins');

    const [integrations, clients] = await Promise.all([
      integrationsApi.list().catch(() => []),
      clientsApi.list({ order: { column: 'company_name', asc: true } }).catch(() => []),
    ]);

    const byProvider = {};
    integrations.forEach(i => { byProvider[i.provider] = byProvider[i.provider] || []; byProvider[i.provider].push(i); });

    const PROVIDERS = [
      { id: 'meta_ads',          name: 'Meta Ads',          icon: '📘', color: '#1877f2', desc: 'Campanhas, gasto, ROAS e leads do Facebook e Instagram', ready: true },
      { id: 'canva',             name: 'Canva',             icon: '🎨', color: '#00c4cc', desc: 'Pastas e designs por cliente — memória visual do Escritório', ready: true },
      { id: 'google_analytics',  name: 'Google Analytics',  icon: '📊', color: '#e37400', desc: 'Sessões, usuários, conversões e origem do tráfego',       ready: false },
      { id: 'google_ads',        name: 'Google Ads',        icon: '🔍', color: '#4285f4', desc: 'Campanhas de pesquisa, display e YouTube',                 ready: false },
      { id: 'tiktok_ads',        name: 'TikTok Ads',        icon: '🎵', color: '#010101', desc: 'Campanhas e criativos no TikTok',                          ready: false },
      { id: 'whatsapp_business', name: 'WhatsApp Business', icon: '💬', color: '#25d366', desc: 'Conversas, leads e automações via WhatsApp',               ready: false },
      { id: 'google_calendar',   name: 'Google Calendar',   icon: '📅', color: '#0f9d58', desc: 'Sincronize reuniões e eventos com o calendário CDM',       ready: false },
    ];

    const fmtSync = (iso) => {
      if (!iso) return null;
      const d = new Date(iso);
      return d.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    };

    const metaMaster = (byProvider.meta_ads || []).find(
      i => !i.client_id && i.status === 'connected'
    ) || (byProvider.meta_ads || []).find(i => i.settings?.mode === 'business_manager' && i.status === 'connected')
      || (byProvider.meta_ads || []).find(i => !i.client_id && i.status !== 'disconnected');

    const metaConnected = !!metaMaster && metaMaster.status === 'connected';
    const metaSyncing = metaMaster?.status === 'syncing';
    const metaError = metaMaster?.status === 'error';
    const lastSummary = metaMaster?.settings?.last_sync_summary || null;

    const canvaMaster = (byProvider.canva || []).find(i => !i.client_id)
      || (byProvider.canva || [])[0];
    const canvaConnected = !!canvaMaster && canvaMaster.status === 'connected';
    const canvaSyncing = canvaMaster?.status === 'syncing';
    const canvaError = canvaMaster?.status === 'error';
    const canvaSummary = canvaMaster?.settings?.last_sync_summary || null;

    const providerCard = (p) => {
      if (p.id === 'canva') {
        let statusClass = 'disconnected', statusLabel = 'Desconectado';
        if (canvaSyncing) { statusClass = 'syncing'; statusLabel = 'Sincronizando pastas…'; }
        else if (canvaError) { statusClass = 'error'; statusLabel = 'Erro na sincronização'; }
        else if (canvaConnected) { statusClass = 'connected'; statusLabel = 'Conta Canva conectada'; }

        const lastSync = fmtSync(canvaMaster?.last_sync);
        const syncInfo = canvaSummary
          ? `${canvaSummary.designs ?? 0} artes · ${canvaSummary.folders ?? 0} pastas`
          : '';

        return `<div class="int-card ${statusClass}" data-provider="canva">
          <div class="int-card-header">
            <div class="int-card-icon" style="background:${p.color}18;border-color:${p.color}30"><span>${p.icon}</span></div>
            <div class="int-card-info">
              <div class="int-card-name">${p.name}</div>
              <div class="int-card-desc">${p.desc}</div>
            </div>
          </div>
          <div class="int-card-status">
            <span class="int-status-dot ${statusClass}"></span>
            <span class="int-status-label">${statusLabel}</span>
            ${lastSync ? `<span class="int-status-sync">· ${lastSync}</span>` : ''}
            ${syncInfo ? `<span class="int-status-client">· ${syncInfo}</span>` : ''}
          </div>
          <div class="int-card-actions">
            ${canvaConnected
              ? `<button class="btn btn-primary btn-sm" data-int-sync="${canvaMaster.id}"${canvaSyncing ? ' disabled' : ''}>↻ Sincronizar</button>
                 <button class="btn btn-ghost btn-sm" data-int-canva-mappings="${canvaMaster.id}">Vincular pastas</button>
                 <button class="btn btn-ghost btn-sm" data-int-oauth data-provider="canva">Reconectar</button>
                 <button class="btn btn-ghost btn-sm btn-danger-ghost" data-int-disconnect="${canvaMaster.id}">Desconectar</button>`
              : `<button class="btn btn-primary btn-sm" data-int-oauth data-provider="canva">Conectar Canva</button>`
            }
          </div>
        </div>`;
      }

      if (p.id !== 'meta_ads') {
        const list = byProvider[p.id] || [];
        const conn = list.find(i => i.status === 'connected');
        const isConnected = !!conn;
        return `<div class="int-card int-card--soon" data-provider="${p.id}">
          <div class="int-card-header">
            <div class="int-card-icon" style="background:${p.color}18;border-color:${p.color}30"><span>${p.icon}</span></div>
            <div class="int-card-info">
              <div class="int-card-name">${p.name} <span class="int-badge-soon">Em breve</span></div>
              <div class="int-card-desc">${p.desc}</div>
            </div>
          </div>
          <div class="int-card-actions"><button class="btn btn-ghost btn-sm" disabled>Em desenvolvimento</button></div>
        </div>`;
      }

      let statusClass = 'disconnected', statusLabel = 'Desconectado';
      if (metaSyncing) { statusClass = 'syncing'; statusLabel = 'Sincronizando todas as contas…'; }
      else if (metaError) { statusClass = 'error'; statusLabel = 'Erro na sincronização'; }
      else if (metaConnected) { statusClass = 'connected'; statusLabel = 'Conta mãe conectada'; }

      const lastSync = fmtSync(metaMaster?.last_sync);
      const accountsInfo = lastSummary
        ? `${lastSummary.accounts_synced}/${lastSummary.accounts_total} contas · ${lastSummary.records} campanhas`
        : '';

      return `<div class="int-card ${statusClass}" data-provider="meta_ads">
        <div class="int-card-header">
          <div class="int-card-icon" style="background:${p.color}18;border-color:${p.color}30"><span>${p.icon}</span></div>
          <div class="int-card-info">
            <div class="int-card-name">${p.name}</div>
            <div class="int-card-desc">Conecte a conta mãe do Business Manager e sincronize <strong>todas</strong> as contas de anúncios de uma vez.</div>
          </div>
        </div>
        <div class="int-card-status">
          <span class="int-status-dot ${statusClass}"></span>
          <span class="int-status-label">${statusLabel}</span>
          ${lastSync ? `<span class="int-status-sync">· ${lastSync}</span>` : ''}
          ${accountsInfo ? `<span class="int-status-client">· ${accountsInfo}</span>` : ''}
        </div>
        <div class="int-card-actions">
          ${metaConnected
            ? `<button class="btn btn-primary btn-sm" data-int-sync="${metaMaster.id}"${metaSyncing ? ' disabled' : ''}>↻ Sincronizar todas</button>
               <button class="btn btn-ghost btn-sm" data-int-mappings="${metaMaster.id}">Vincular contas</button>
               <button class="btn btn-ghost btn-sm" data-int-connect data-provider="meta_ads" data-edit-mode="1">Atualizar token</button>
               <button class="btn btn-ghost btn-sm btn-danger-ghost" data-int-disconnect="${metaMaster.id}">Desconectar</button>`
            : `<button class="btn btn-primary btn-sm" data-int-connect data-provider="meta_ads">Conectar conta mãe</button>`
          }
        </div>
      </div>`;
    };

    const mappingsPanelHtml = metaMaster ? `
      <div id="int-mappings-panel" class="int-mappings-panel card hidden">
        <div class="int-mappings-header">
          <div>
            <div class="int-guide-title">Vincular contas de anúncios → clientes CDM</div>
            <p class="settings-desc">Contas não vinculadas não entram no sync. O CDM tenta casar automaticamente pelo nome.</p>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" id="int-mappings-close">Fechar</button>
        </div>
        <div id="int-mappings-loading" class="loading" style="padding:24px"><div class="spinner"></div></div>
        <div id="int-mappings-body" class="hidden"></div>
        <div class="int-mappings-footer hidden" id="int-mappings-footer">
          <button type="button" class="btn btn-primary" id="int-mappings-save">Salvar vínculos</button>
        </div>
      </div>` : '';

    const canvaMappingsPanelHtml = canvaMaster ? `
      <div id="int-canva-mappings-panel" class="int-mappings-panel card hidden">
        <div class="int-mappings-header">
          <div>
            <div class="int-guide-title">Vincular marcas Canva → clientes CDM</div>
            <p class="settings-desc">Pastas grandes do time (Phytomaster, RSWF…) <strong>não aparecem sozinhas na API</strong>. Cole o link da pasta abaixo para puxar todas as artes de dentro.</p>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" id="int-canva-mappings-close">Fechar</button>
        </div>
        <div id="int-canva-mappings-loading" class="loading" style="padding:24px"><div class="spinner"></div></div>
        <div id="int-canva-mappings-body" class="hidden"></div>
        <div class="int-mappings-footer hidden" id="int-canva-mappings-footer">
          <button type="button" class="btn btn-primary" id="int-canva-mappings-save">Salvar vínculos</button>
        </div>
      </div>` : '';

    return `
      ${pageHeader('Integrações', 'Conecte suas plataformas ao CDM Central')}

      <div class="int-setup-guide card">
        <div class="int-guide-title">📘 Como conectar a conta mãe (Business Manager)</div>
        <ol class="int-guide-steps">
          <li>Acesse <a href="https://business.facebook.com/settings/system-users" target="_blank" rel="noopener">business.facebook.com → Configurações → Usuários do sistema</a></li>
          <li>Crie ou selecione um <strong>Usuário do Sistema</strong> com acesso a <strong>todas</strong> as contas de anúncios</li>
          <li>Gere o token com permissões: <code>ads_read</code>, <code>ads_management</code>, <code>business_management</code></li>
          <li>Clique em <strong>Conectar conta mãe</strong> abaixo e cole o token — pronto!</li>
          <li>O CDM descobre automaticamente American Cut, Lunarfilm, Antichip e todas as outras contas</li>
        </ol>
      </div>

      <div class="int-setup-guide card" style="margin-top:16px">
        <div class="int-guide-title">🎨 Como conectar o Canva</div>
        <ol class="int-guide-steps">
          <li>Crie um app em <a href="https://www.canva.com/developers/" target="_blank" rel="noopener">Canva Developers</a> e configure as secrets <code>CANVA_CLIENT_ID</code> / <code>CANVA_CLIENT_SECRET</code> no Supabase</li>
          <li>Redirect URI: <code>…/functions/v1/integrations?action=oauth_callback</code></li>
          <li>Clique em <strong>Conectar Canva</strong> com a conta do time, depois <strong>Sincronizar</strong></li>
          <li>Artes do time são ligadas aos clientes pelo <strong>nome no título</strong> (ex.: “Phytomaster 2608”). Em <strong>Vincular pastas</strong> confira os agrupamentos</li>
        </ol>
      </div>

      <div class="int-grid">
        ${PROVIDERS.map(p => providerCard(p)).join('')}
      </div>

      ${mappingsPanelHtml}
      ${canvaMappingsPanelHtml}

      <div id="int-modal" class="int-modal-overlay hidden" role="dialog" aria-modal="true">
        <div class="int-modal-panel card">
          <div class="int-modal-header">
            <h3 id="int-modal-title">Conectar</h3>
            <button type="button" id="int-modal-close" class="panel-close" aria-label="Fechar">×</button>
          </div>
          <div id="int-modal-body"></div>
        </div>
      </div>`;
  },

  async configuracoes(profile) {
    return `
      ${pageHeader('Configurações', `Perfil: ${ROLE_LABELS[profile.role]}`)}
      <div class="settings-section">
        <div class="settings-section-title">Meu Perfil</div>
        <div class="detail-grid">
          <span class="detail-label">Nome</span><span class="detail-value">${escapeHtml(profile.full_name)}</span>
          <span class="detail-label">E-mail</span><span class="detail-value">${escapeHtml(profile.email)}</span>
          <span class="detail-label">Função</span><span class="detail-value">${ROLE_LABELS[profile.role]}</span>
        </div>
      </div>
      <div class="settings-section">
        <div class="settings-section-title">Alterar senha</div>
        <p class="settings-desc" style="margin-bottom:16px">Atualize sua senha de acesso ao CDM Central.</p>
        <form id="change-password-form" class="settings-form card" style="padding:20px;max-width:420px">
          <div class="form-group">
            <label class="form-label" for="current-password">Senha atual</label>
            <input class="form-input" type="password" id="current-password" required autocomplete="current-password">
          </div>
          <div class="form-group">
            <label class="form-label" for="new-password">Nova senha</label>
            <input class="form-input" type="password" id="new-password" required minlength="6" autocomplete="new-password" placeholder="Mínimo 6 caracteres">
          </div>
          <div class="form-group">
            <label class="form-label" for="confirm-password">Confirmar nova senha</label>
            <input class="form-input" type="password" id="confirm-password" required minlength="6" autocomplete="new-password">
          </div>
          <div id="change-password-msg" class="form-error hidden" style="margin-bottom:12px"></div>
          <button type="submit" class="btn btn-primary" id="change-password-btn">Salvar nova senha</button>
        </form>
      </div>`;
  }
};

function navIcon(children) {
  return `<svg class="nav-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${children}</svg>`;
}

export const NAV_ITEMS = [
  { id: 'dashboard', icon: navIcon('<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'), label: 'Dashboard', roles: ['admin','gestor','colaborador','cliente'] },
  { id: 'clientes', icon: navIcon('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'), label: 'Clientes', roles: ['admin','gestor','colaborador'] },
  { id: 'financeiro', icon: navIcon('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'), label: 'Financeiro', roles: ['admin','gestor'] },
  { id: 'boletos', icon: navIcon('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'), label: 'Boletos', roles: ['admin','gestor','cliente'] },
  { id: 'calendario', icon: navIcon('<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'), label: 'Calendário de Conteúdos', roles: ['admin','gestor','colaborador','cliente'] },
  { id: 'escritorio', icon: navIcon('<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/>'), label: 'Escritório', roles: ['admin','gestor','colaborador'] },
  { id: 'trafego', icon: navIcon('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>'), label: 'Tráfego Pago', roles: ['admin','gestor','colaborador'] },
  { id: 'arquivos', icon: navIcon('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'), label: 'Arquivos', roles: ['admin','gestor','colaborador','cliente'] },
  { id: 'notas-pessoais', icon: navIcon('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'), label: 'Notas Pessoais', roles: ['admin','gestor','colaborador'] },
  { id: 'notas-gerais', icon: navIcon('<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>'), label: 'Notas Gerais', roles: ['admin','gestor','colaborador'] },
  { id: 'integracoes', icon: navIcon('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'), label: 'Integrações', roles: ['admin','gestor'] },
  { id: 'configuracoes', icon: navIcon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'), label: 'Configurações', roles: ['admin','gestor','colaborador','cliente'] }
];
