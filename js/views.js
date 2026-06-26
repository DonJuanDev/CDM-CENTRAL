import {
  formatCurrency, formatDate, formatDateShort, formatDateTime, formatFileSize,
  statusBadge, priorityBadge, escapeHtml, areaTag
} from './utils.js';
import {
  clientsApi, projectsApi, tasksApi, invoicesApi, paymentsApi,
  eventsApi, meetingsApi, notesApi, campaignsApi, filesApi,
  creativesApi, videosApi, notificationsApi, integrationsApi,
  dailyPlansApi,
  getDashboardStats
} from './api/crud.js?v=20260622a';
import { INTEGRATION_PROVIDERS, ROLE_LABELS, TEAM_MEMBERS, inferColorOwner, FILE_CLIENT_GROUPS, findClientGroupForName } from './config.js';
import { canManage } from './auth.js';
import { parseHashQuery } from './router.js';
import { ensureClientFolders, fileMatchesFolder, findFolderBySlug } from './services/file-folders.js?v=20260621a';
import {
  toDateKey, formatDayLabel, formatFullDate, dayHasContent, buildDayList
} from './daily-planning.js?v=20260622a';

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
    const clients = await clientsApi.list({ order: { column: 'company_name', asc: true } });
    const canEdit = canManage(profile);
    const rows = clients.map(c => `
      <tr data-edit="clients" data-id="${c.id}" class="notion-row">
        <td class="notion-cell-name"><span class="client-icon">${escapeHtml(c.icon || '📋')}</span> ${escapeHtml(c.company_name)}</td>
        <td>${areaTag(c.area_atuacao)}</td>
        <td class="notion-cell-muted">${c.notes ? '📎' : '—'}</td>
        <td class="notion-cell-notes">${escapeHtml((c.notes || '').slice(0, 120))}${(c.notes || '').length > 120 ? '…' : ''}</td>
      </tr>`).join('');

    const senhasRows = clients.map(c => `
      <tr data-edit="clients" data-id="${c.id}" class="notion-row">
        <td class="notion-cell-name">${escapeHtml(c.company_name)}</td>
        <td>${escapeHtml(c.instagram || '—')}</td>
        <td>${escapeHtml(c.facebook || '—')}</td>
        <td>${escapeHtml(c.tiktok || '—')}</td>
        <td>${escapeHtml(c.linktree || '—')}</td>
        <td>${escapeHtml(c.claude || '—')}</td>
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
            <thead><tr><th>Clientes</th><th>Área de Atuação</th><th>Arquivos e mídia</th><th>Observações</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="4">${emptyState()}</td></tr>`}</tbody>
          </table>
        </div>
      </div>
      <div id="client-panel-senhas" class="client-panel hidden">
        <div class="table-wrapper notion-table-wrap">
          <table class="notion-table">
            <thead><tr><th>Cliente</th><th>Instagram</th><th>Facebook</th><th>TikTok</th><th>Linktree</th><th>Claude</th></tr></thead>
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
    const { renderCalendarView, highlightPendingTask } = await import('./calendar.js?v=20260622c');
    const html = await renderCalendarView(profile);
    queueMicrotask(() => highlightPendingTask());
    return html;
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
    return `
      ${pageHeader('Tráfego Pago', `${campaigns.length} campanhas`, canManage(profile) ? '<button class="btn btn-primary" data-create="campaigns">+ Nova Campanha</button>' : '')}
      <div class="table-wrapper"><table><thead><tr><th>Campanha</th><th>Cliente</th><th>Plataforma</th><th>Budget</th><th>ROAS</th><th>Leads</th><th>Status</th></tr></thead><tbody>
        ${campaigns.map(c => `<tr data-edit="campaigns" data-id="${c.id}" style="cursor:pointer">
          <td style="font-weight:500">${escapeHtml(c.name)}</td><td>${escapeHtml(c.clients?.company_name || '')}</td>
          <td><span class="tag">${escapeHtml(c.platform)}</span></td>
          <td>${formatCurrency(c.budget)}</td>
          <td style="color:${c.roas >= 3 ? 'var(--success)' : 'var(--danger)'}">${c.roas}x</td>
          <td>${c.leads}</td><td>${statusBadge(c.status)}</td>
        </tr>`).join('') || `<tr><td colspan="7">${emptyState()}</td></tr>`}
      </tbody></table></div>`;
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

  async notas(profile) {
    const notes = await notesApi.list({ order: { column: 'created_at' } });
    return `
      ${pageHeader('Notas', 'Documentação interna', '<button class="btn btn-primary" data-create="notes">+ Nova Nota</button>')}
      <div class="grid grid-3">
        ${notes.length ? notes.map(n => `
          <div class="note-card" data-edit="notes" data-id="${n.id}">
            <div class="note-card-title">${escapeHtml(n.title)}</div>
            <div class="note-card-content">${escapeHtml(n.content || '')}</div>
            <div class="note-tags">${(n.tags || []).map(t => `<span class="note-tag">${escapeHtml(t)}</span>`).join('')}</div>
          </div>`).join('') : emptyState()}
      </div>`;
  },

  async planejamento(profile) {
    const query = parseHashQuery();
    const today = toDateKey(new Date());
    const selectedDate = query.data && /^\d{4}-\d{2}-\d{2}$/.test(query.data) ? query.data : today;

    const [plans, currentPlan] = await Promise.all([
      dailyPlansApi.listForUser(profile.id, { daysBack: 60 }),
      dailyPlansApi.getByDate(profile.id, selectedDate)
    ]);

    const plansByDate = Object.fromEntries(plans.map(p => [p.plan_date, p]));
    if (currentPlan) plansByDate[selectedDate] = currentPlan;

    const dayList = buildDayList(plansByDate, selectedDate);
    const plan = currentPlan || { notes: '', items: [] };
    const items = Array.isArray(plan.items) ? plan.items : [];

    const dayButtons = dayList.map(dateKey => {
      const hasContent = dayHasContent(plansByDate[dateKey]);
      const active = dateKey === selectedDate;
      const todayMark = dateKey === today ? ' is-today' : '';
      return `<button type="button" class="daily-plan-day${active ? ' active' : ''}${hasContent ? ' has-content' : ''}${todayMark}"
        data-plan-day="${dateKey}">
        <span class="daily-plan-day-label">${escapeHtml(formatDayLabel(dateKey))}</span>
        <span class="daily-plan-day-date">${escapeHtml(dateKey.split('-').reverse().slice(0, 2).join('/'))}</span>
      </button>`;
    }).join('');

    const itemsHtml = items.length
      ? items.map(item => `
        <div class="daily-plan-item${item.done ? ' is-done' : ''}" data-item-id="${item.id}">
          <label class="daily-plan-check">
            <input type="checkbox" data-item-toggle="${item.id}" ${item.done ? 'checked' : ''}>
            <span class="daily-plan-checkmark"></span>
          </label>
          <span class="daily-plan-item-text" contenteditable="true" data-item-text="${item.id}">${escapeHtml(item.text || '')}</span>
          <button type="button" class="btn btn-ghost btn-sm daily-plan-item-delete" data-item-delete="${item.id}" title="Remover">×</button>
        </div>`).join('')
      : '<p class="daily-plan-empty">Nenhuma tarefa ainda. Adicione abaixo.</p>';

    return `
      ${pageHeader('Planejamento Diário', 'Suas tarefas e anotações por dia')}
      <div class="daily-plan-layout">
        <aside class="daily-plan-sidebar card">
          <div class="daily-plan-sidebar-title">Dias</div>
          <div class="daily-plan-days">${dayButtons}</div>
        </aside>
        <section class="daily-plan-main card" id="daily-plan-root" data-date="${selectedDate}">
          <div class="daily-plan-toolbar">
            <div class="daily-plan-toolbar-nav">
              <button type="button" class="btn btn-ghost btn-sm" id="daily-plan-prev" title="Dia anterior">‹</button>
              <button type="button" class="btn btn-ghost btn-sm" id="daily-plan-today">Hoje</button>
              <button type="button" class="btn btn-ghost btn-sm" id="daily-plan-next" title="Próximo dia">›</button>
            </div>
            <input type="date" class="form-input daily-plan-date-input" id="daily-plan-date" value="${selectedDate}">
            <span class="daily-plan-status" id="daily-plan-status"></span>
          </div>
          <h2 class="daily-plan-date-title">${escapeHtml(formatFullDate(selectedDate))}</h2>

          <div class="daily-plan-section">
            <div class="daily-plan-section-header">
              <span class="daily-plan-section-title">Tarefas do dia</span>
              <button type="button" class="btn btn-ghost btn-sm" id="daily-plan-add">+ Tarefa</button>
            </div>
            <div id="daily-plan-items" class="daily-plan-items">${itemsHtml}</div>
            <div class="daily-plan-add-row">
              <input type="text" class="form-input" id="daily-plan-add-input" placeholder="Nova tarefa... (Enter para adicionar)">
            </div>
          </div>

          <div class="daily-plan-section">
            <div class="daily-plan-section-title">Anotações</div>
            <textarea class="form-input daily-plan-notes" id="daily-plan-notes" rows="6" placeholder="Observações, lembretes, ideias do dia...">${escapeHtml(plan.notes || '')}</textarea>
          </div>
        </section>
      </div>`;
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
    const connected = await integrationsApi.list();
    const connectedMap = Object.fromEntries(connected.map(i => [i.provider, i]));
    return `
      ${pageHeader('Integrações API', 'Meta Ads, Google, TikTok, WhatsApp, Canva, Calendar')}
      <div class="integration-grid">
        ${INTEGRATION_PROVIDERS.map(p => {
          const c = connectedMap[p.id];
          return `<div class="integration-card ${c?.status === 'connected' ? 'connected' : ''}" data-provider="${p.id}">
            <div style="font-size:28px">${p.icon}</div>
            <div class="integration-name">${p.name}</div>
            <div class="integration-status">${c?.status === 'connected' ? '● Conectado' : '○ Desconectado'}</div>
          </div>`;
        }).join('')}
      </div>
      <p style="margin-top:16px;font-size:13px;color:var(--text-tertiary)">Configure credenciais via Edge Function <code>integrations</code></p>`;
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
  { id: 'trafego', icon: navIcon('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>'), label: 'Tráfego Pago', roles: ['admin','gestor','colaborador'] },
  { id: 'arquivos', icon: navIcon('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'), label: 'Arquivos', roles: ['admin','gestor','colaborador','cliente'] },
  { id: 'notas', icon: navIcon('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'), label: 'Notas', roles: ['admin','gestor','colaborador'] },
  { id: 'planejamento', icon: navIcon('<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M9 16l2 2 4-4"/>'), label: 'Planejamento Diário', roles: ['admin','gestor','colaborador'] },
  { id: 'integracoes', icon: navIcon('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'), label: 'Integrações', roles: ['admin','gestor'] },
  { id: 'configuracoes', icon: navIcon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'), label: 'Configurações', roles: ['admin','gestor','colaborador','cliente'] }
];
