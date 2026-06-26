import { requireAuth, signOut, canManage } from './auth.js';
import { $, $$, showToast, handleError, escapeHtml } from './utils.js';
import { readViewFromLocation, writeViewToLocation, writeViewHash, bindRouter } from './router.js';
import { ROLE_LABELS } from './config.js';

const App = {
  profile: null,
  currentView: null,
  theme: localStorage.getItem('cdm-theme') || 'dark',
  Views: null,
  NAV_ITEMS: null
};

let viewsModulePromise = null;

function loadViewsModule() {
  if (!viewsModulePromise) {
    viewsModulePromise = import('./views.js?v=20260626a');
  }
  return viewsModulePromise;
}

async function ensureViews() {
  if (App.Views) return;
  const mod = await loadViewsModule();
  App.Views = mod.Views;
  App.NAV_ITEMS = mod.NAV_ITEMS;
}

export async function initApp() {
  const main = $('#main-content');
  main.innerHTML = '<div class="loading"><div class="spinner"></div><p style="margin-top:12px;color:var(--text-tertiary)">Carregando CDM Central...</p></div>';

  const auth = await requireAuth();
  if (!auth) return;

  App.profile = auth.profile;
  if (!App.profile?.role) {
    throw new Error('Perfil sem permissão definida. Contate o administrador.');
  }

  document.documentElement.setAttribute('data-theme', App.theme);

  $('#user-name').textContent = App.profile.full_name || App.profile.email;
  $('#user-avatar').textContent = (App.profile.full_name || 'U').slice(0, 2).toUpperCase();
  $('#user-role').textContent = ROLE_LABELS[App.profile.role] || App.profile.role;

  if (localStorage.getItem('cdm-sidebar') === 'true') $('#sidebar').classList.add('collapsed');

  await ensureViews();
  renderSidebar();

  bindGlobalEvents();
  bindRouter(async (readView) => {
    await ensureViews();
    const view = readView(App.NAV_ITEMS);
    if (view !== App.currentView) await navigate(view, { skipHistory: true });
  });

  const initialView = readViewFromLocation(App.NAV_ITEMS);
  await Promise.all([
    navigate(initialView, { replace: true, skipHistory: true }),
    loadNotifications()
  ]);
}

function renderSidebar() {
  if (!App.profile?.role || !App.NAV_ITEMS) return;
  const items = App.NAV_ITEMS.filter(n => n.roles.includes(App.profile.role));
  $('#sidebar-nav').innerHTML = items.map(item => `
    <button class="nav-item ${App.currentView === item.id ? 'active' : ''}" data-view="${item.id}">
      <span class="nav-icon">${item.icon}</span>
      <span class="nav-label">${item.label}</span>
    </button>`).join('');
}

export async function navigate(view, opts = {}) {
  const { replace = false, skipHistory = false, force = false } = opts;

  await ensureViews();
  if (!App.NAV_ITEMS.some(n => n.id === view)) view = 'dashboard';

  const viewHash = window.location.hash;
  if (view === App.currentView && !force) {
    if (view !== 'arquivos' || viewHash === App.lastViewHash) return;
  }
  App.lastViewHash = viewHash;

  App.currentView = view;
  if (!skipHistory) writeViewToLocation(view, { replace });
  else if (replace && !window.location.hash.includes('?')) writeViewToLocation(view, { replace: true });

  renderSidebar();

  const main = $('#main-content');
  const hadContent = main.querySelector('.page-header, .cal-page-root, .metric-card');
  if (!hadContent) {
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  } else {
    main.classList.add('is-loading');
  }

  try {
    const renderer = App.Views[view];
    if (renderer) {
      const html = await renderer(App.profile);
      main.innerHTML = html;
      await bindViewEvents(view);
    } else {
      main.innerHTML = '<div class="empty-state"><div class="empty-state-title">Módulo não encontrado</div></div>';
    }
    main.scrollTop = 0;
  } catch (err) {
    handleError(err, 'Erro ao carregar dados');
    main.innerHTML = `<div class="empty-state"><div class="empty-state-title">Erro ao carregar</div><p style="margin-top:8px;font-size:13px;color:var(--danger)">${err.message}</p></div>`;
  } finally {
    main.classList.remove('is-loading');
  }
}

async function bindViewEvents(view) {
  const refresh = () => navigate(view, { force: true, skipHistory: true });

  $$('[data-create]').forEach(btn => {
    btn.onclick = async () => {
      const entity = btn.dataset.create;
      let extra = {};
      try { extra = JSON.parse(btn.dataset.extra || '{}'); } catch {}
      const { openCrudModal } = await import('./forms.js?v=20260621a');
      openCrudModal(entity, Object.keys(extra).length ? extra : null, refresh);
    };
  });

  $$('[data-view-link]').forEach(btn => {
    btn.onclick = () => navigate(btn.dataset.viewLink);
  });

  $$('[data-edit]').forEach(el => {
    el.onclick = async () => {
      const entity = el.dataset.edit;
      const id = el.dataset.id;
      const { clientsApi, projectsApi, tasksApi, invoicesApi, paymentsApi, eventsApi, meetingsApi, notesApi, campaignsApi } = await import('./api/crud.js?v=20260621a');
      const API_MAP = { clients: clientsApi, projects: projectsApi, tasks: tasksApi, invoices: invoicesApi, payments: paymentsApi, events: eventsApi, meetings: meetingsApi, notes: notesApi, campaigns: campaignsApi };
      const api = API_MAP[entity];
      if (!api) return;
      try {
        const record = await api.get(id);
        const { openCrudModal } = await import('./forms.js?v=20260621a');
        openCrudModal(entity, record, refresh);
      } catch (e) { handleError(e); }
    };
  });

  if (view === 'calendario') {
    const { bindCalendarEvents, refreshCalendarView } = await import('./calendar.js?v=20260622c');
    bindCalendarEvents((opts) => refreshCalendarView(App.profile, opts));
  }

  if (view === 'clientes') {
    document.querySelectorAll('[data-client-tab]').forEach(tab => {
      tab.onclick = () => {
        document.querySelectorAll('[data-client-tab]').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const id = tab.dataset.clientTab;
        document.querySelectorAll('.client-panel').forEach(p => p.classList.add('hidden'));
        $(`#client-panel-${id}`)?.classList.remove('hidden');
      };
    });
  }

  if (view === 'arquivos') {
    const refresh = () => navigate('arquivos', { force: true, skipHistory: true });
    const canManageFolders = canManage(App.profile) || App.profile?.role === 'colaborador';
    const { bindArquivosEvents } = await import('./files-browser.js?v=20260621a');
    bindArquivosEvents({ refresh, canManageFolders });
  }

  if (view === 'planejamento') {
    const refresh = () => navigate('planejamento', { force: true, skipHistory: true });
    const { bindDailyPlanningEvents } = await import('./daily-planning.js?v=20260622a');
    bindDailyPlanningEvents({ profile: App.profile, refresh });
  }

  if (view === 'configuracoes') {
    const form = $('#change-password-form');
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const msg = $('#change-password-msg');
        const btn = $('#change-password-btn');
        const current = $('#current-password').value;
        const next = $('#new-password').value;
        const confirm = $('#confirm-password').value;

        msg.classList.add('hidden');
        msg.classList.remove('form-success');

        if (next !== confirm) {
          msg.textContent = 'As senhas não coincidem';
          msg.classList.remove('hidden');
          return;
        }
        if (next.length < 6) {
          msg.textContent = 'A nova senha deve ter pelo menos 6 caracteres';
          msg.classList.remove('hidden');
          return;
        }
        if (current === next) {
          msg.textContent = 'A nova senha deve ser diferente da atual';
          msg.classList.remove('hidden');
          return;
        }

        btn.disabled = true;
        try {
          const { changePassword } = await import('./auth.js');
          await changePassword(App.profile.email, current, next);
          form.reset();
          showToast('Senha alterada com sucesso', 'success');
        } catch (err) {
          msg.textContent = err.message || 'Erro ao alterar senha';
          msg.classList.remove('hidden');
        } finally {
          btn.disabled = false;
        }
      };
    }
  }

  // ── INTEGRAÇÕES ──────────────────────────────────────────────────────
  if (view === 'integracoes') {
    const refresh = () => navigate('integracoes', { force: true, skipHistory: true });

    // Verifica retorno de OAuth (Meta redireciona de volta com ?oauth_connected=...)
    const hash = window.location.hash;
    if (hash.includes('oauth_connected=') || hash.includes('oauth_error=')) {
      const params = new URLSearchParams(hash.split('?')[1] || '');
      if (params.get('oauth_connected')) {
        showToast(`${params.get('oauth_connected')} conectado com sucesso!`, 'success');
      } else if (params.get('oauth_error')) {
        showToast(`Erro OAuth: ${params.get('oauth_error')}`, 'error');
      }
      // Limpa os query params do hash sem recarregar
      window.history.replaceState(null, '', window.location.pathname + '#/integracoes');
    }

    function openIntModal(providerName, bodyHtml) {
      $('#int-modal-title').textContent = providerName;
      $('#int-modal-body').innerHTML = bodyHtml;
      $('#int-modal').classList.remove('hidden');
      $('#overlay').classList.remove('hidden');
    }

    function closeIntModal() {
      $('#int-modal')?.classList.add('hidden');
      $('#overlay').classList.add('hidden');
    }

    $('#int-modal-close')?.addEventListener('click', closeIntModal);

    // ── Botão CONECTAR ────────────────────────────────────────────────
    $$('[data-int-connect]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const provider = btn.dataset.provider;
        const isEdit = btn.dataset.editMode === '1';

        // Busca clientes para o select
        const { clientsApi } = await import('./api/crud.js?v=20260622a');
        const clients = await clientsApi.list({ order: { column: 'company_name', asc: true } }).catch(() => []);
        const clientOptions = clients.map(c => `<option value="${c.id}">${escapeHtml(c.company_name)}</option>`).join('');

        const providerLabels = {
          meta_ads: { name: 'Meta Ads', fieldLabel: 'Access Token', field2Label: 'Ad Account ID', field2Hint: 'Formato: act_XXXXXXXXX ou somente o número' },
        };
        const def = providerLabels[provider] || { name: provider, fieldLabel: 'Access Token', field2Label: 'ID da Conta' };

        const formHtml = `
          <form id="int-connect-form" style="padding:0 0 4px">
            <div class="form-group">
              <label class="form-label">Cliente CDM *</label>
              <select class="form-input" id="int-client-id" required>
                <option value="">Selecione o cliente…</option>
                ${clientOptions}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">${def.fieldLabel} *</label>
              <textarea class="form-input" id="int-token" rows="3" required placeholder="Cole aqui o token gerado no Meta for Developers…" style="font-family:monospace;font-size:12px;resize:vertical"></textarea>
              <span class="form-hint">
                Acesse <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener">Graph API Explorer</a>,
                gere com permissões <code>ads_read</code> e <code>business_management</code>.
              </span>
            </div>
            <div class="form-group">
              <label class="form-label">${def.field2Label} *</label>
              <input class="form-input" id="int-account-id" required placeholder="Ex.: act_123456789">
              ${def.field2Hint ? `<span class="form-hint">${def.field2Hint}</span>` : ''}
            </div>
            <div id="int-connect-error" class="form-error hidden" style="margin-bottom:12px"></div>
            <div style="display:flex;gap:10px;justify-content:flex-end">
              <button type="button" class="btn btn-ghost" id="int-connect-cancel">Cancelar</button>
              <button type="submit" class="btn btn-primary" id="int-connect-submit">
                ${isEdit ? 'Salvar alterações' : 'Conectar e validar'}
              </button>
            </div>
          </form>`;

        openIntModal(`${isEdit ? 'Configurar' : 'Conectar'} ${def.name}`, formHtml);

        $('#int-connect-cancel').addEventListener('click', closeIntModal);
        $('#int-connect-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const errEl = $('#int-connect-error');
          const submitBtn = $('#int-connect-submit');
          const clientId = $('#int-client-id').value;
          const token = $('#int-token').value.trim();
          const accountId = $('#int-account-id').value.trim();

          errEl.classList.add('hidden');
          submitBtn.disabled = true;
          submitBtn.textContent = 'Validando…';

          try {
            const { integrationsService } = await import('./services/integrations.js?v=20260626a');
            await integrationsService.connect(provider, clientId, {
              access_token: token,
              ad_account_id: accountId,
            });
            closeIntModal();
            showToast('Integração conectada com sucesso!', 'success');
            refresh();
          } catch (err) {
            errEl.textContent = err.message || 'Erro ao conectar';
            errEl.classList.remove('hidden');
            submitBtn.disabled = false;
            submitBtn.textContent = isEdit ? 'Salvar alterações' : 'Conectar e validar';
          }
        });
      });
    });

    // ── Botão SINCRONIZAR ─────────────────────────────────────────────
    $$('[data-int-sync]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const integrationId = btn.dataset.intSync;
        const origText = btn.textContent;
        btn.disabled = true;
        btn.textContent = '↻ Sincronizando…';
        try {
          const { integrationsService } = await import('./services/integrations.js?v=20260626a');
          const result = await integrationsService.sync(integrationId);
          showToast(`Sync concluído: ${result.records} campanhas atualizadas (${result.period || ''})`, 'success');
          refresh();
        } catch (err) {
          showToast(err.message || 'Erro na sincronização', 'error');
          btn.disabled = false;
          btn.textContent = origText;
        }
      });
    });

    // ── Botão DESCONECTAR ─────────────────────────────────────────────
    $$('[data-int-disconnect]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const integrationId = btn.dataset.intDisconnect;
        if (!confirm('Tem certeza que deseja desconectar esta integração? Os dados de campanha já sincronizados não serão apagados.')) return;
        try {
          const { integrationsService } = await import('./services/integrations.js?v=20260626a');
          await integrationsService.disconnect(integrationId);
          showToast('Integração desconectada', 'success');
          refresh();
        } catch (err) {
          showToast(err.message || 'Erro ao desconectar', 'error');
        }
      });
    });
  }

  // ── TRÁFEGO PAGO — sync rápido ───────────────────────────────────────
  if (view === 'trafego') {
    const syncBtn = $('#trafego-sync-btn');
    if (syncBtn) {
      syncBtn.addEventListener('click', async () => {
        const msg = $('#trafego-sync-msg');
        syncBtn.disabled = true;
        syncBtn.innerHTML = '↻ Sincronizando…';
        msg.textContent = '';
        try {
          const { integrationsApi } = await import('./api/crud.js?v=20260622a');
          const { integrationsService } = await import('./services/integrations.js?v=20260626a');
          const integrations = await integrationsApi.list();
          const metaConns = integrations.filter(i => i.provider === 'meta_ads' && i.status === 'connected');
          if (!metaConns.length) {
            msg.textContent = 'Nenhuma conta Meta Ads conectada. Vá em Integrações.';
            return;
          }
          let total = 0;
          for (const conn of metaConns) {
            const result = await integrationsService.sync(conn.id);
            total += result.records || 0;
          }
          showToast(`Sync concluído: ${total} campanhas atualizadas`, 'success');
          navigate('trafego', { force: true, skipHistory: true });
        } catch (err) {
          msg.textContent = err.message || 'Erro na sincronização';
          showToast(err.message || 'Erro na sincronização', 'error');
        } finally {
          syncBtn.disabled = false;
          syncBtn.innerHTML = '<span>↻</span> Sincronizar Meta Ads';
        }
      });
    }
  }
}

async function loadNotifications() {
  try {
    const { fetchUnreadNotifications } = await import('./services/notifications.js?v=20260619a');
    const notifs = await fetchUnreadNotifications();

    const badge = $('#notif-badge');
    if (notifs.length) {
      badge.textContent = notifs.length;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
    const toolbar = $('#notifications-toolbar');
    if (notifs.length) {
      toolbar?.classList.remove('hidden');
    } else {
      toolbar?.classList.add('hidden');
    }

    $('#notifications-list').innerHTML = notifs.length ? notifs.map(n => `
      <div class="alert-item notif-item" data-notif-id="${n.id}" data-notif-link="${escapeHtml(n.link || '')}" role="button" tabindex="0">
        <div class="alert-dot ${n.type === 'danger' ? 'danger' : n.type === 'warning' ? 'warning' : 'info'}"></div>
        <div><div style="font-weight:500;font-size:13px">${escapeHtml(n.title)}</div>
        <div style="font-size:12px;color:var(--text-tertiary)">${escapeHtml(n.message || '')}</div></div>
      </div>`).join('') : '<div class="empty-state" style="padding:24px">Sem notificações</div>';

    $$('.notif-item').forEach(item => {
      item.onclick = () => handleNotificationClick(item.dataset.notifId, item.dataset.notifLink);
      item.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleNotificationClick(item.dataset.notifId, item.dataset.notifLink);
        }
      };
    });
  } catch (e) {
    console.warn('Notificações:', e.message);
  }
}

async function handleMarkAllNotifications() {
  const btn = $('#mark-all-notifications');
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  try {
    const { markAllNotificationsRead } = await import('./services/notifications.js?v=20260619a');
    await markAllNotificationsRead();
    await loadNotifications();
    showToast('Todas as notificações foram marcadas como lidas', 'success');
  } catch (e) {
    handleError(e, 'Erro ao marcar notificações');
  } finally {
    btn.disabled = false;
  }
}

async function handleNotificationClick(id, link) {
  try {
    const { markNotificationRead, parseNotificationLink } = await import('./services/notifications.js?v=20260619a');
    const { prepareCalendarDeepLink } = await import('./calendar.js?v=20260622c');
    await markNotificationRead(id);
    closePanels();
    await loadNotifications();

    const parsed = parseNotificationLink(link);
    if (!parsed?.view) return;

    if (parsed.view === 'calendario') prepareCalendarDeepLink();

    if (parsed.hash) {
      window.location.hash = parsed.hash.startsWith('#') ? parsed.hash : `#${parsed.hash}`;
    }

    await navigate(parsed.view, { force: true, skipHistory: true });
  } catch (e) {
    handleError(e, 'Erro ao abrir notificação');
  }
}

function bindGlobalEvents() {
  $('#sidebar-nav').onclick = (e) => {
    const item = e.target.closest('.nav-item');
    if (item) navigate(item.dataset.view);
  };

  $('#theme-toggle').onclick = () => {
    App.theme = App.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', App.theme);
    localStorage.setItem('cdm-theme', App.theme);
  };

  $('#sidebar-toggle').onclick = () => {
    $('#sidebar').classList.toggle('collapsed');
    localStorage.setItem('cdm-sidebar', $('#sidebar').classList.contains('collapsed'));
  };

  $('#mobile-menu').onclick = () => $('#sidebar').classList.toggle('mobile-open');

  $('#user-btn').onclick = () => $('#user-dropdown').classList.toggle('hidden');

  $('#logout-btn').onclick = async () => {
    await signOut();
    window.location.href = 'login.html';
  };

  $('#notifications-btn').onclick = () => {
    $('#notifications-panel').classList.remove('hidden');
    $('#overlay').classList.remove('hidden');
  };

  $('#close-notifications').onclick = closePanels;
  $('#mark-all-notifications').onclick = handleMarkAllNotifications;
  $('#close-detail-modal').onclick = closePanels;
  $('#overlay').onclick = closePanels;

  document.onkeydown = (e) => {
    if (e.key !== 'Escape') return;
    import('./calendar.js?v=20260622c').then(m => {
      if (m.CalendarState?.focusDay) m.closeCalendarDayFocus();
      else closePanels();
    });
    return;
  };
}

function closePanels() {
  $$('.modal-overlay, .notifications-panel').forEach(el => el.classList.add('hidden'));
  $('#overlay').classList.add('hidden');
  $('#user-dropdown')?.classList.add('hidden');
}

function showFatalError(title, detail) {
  const main = $('#main-content');
  if (!main) return;
  main.innerHTML = `
    <div class="empty-state" style="padding:48px">
      <div class="empty-state-icon">⚠️</div>
      <div class="empty-state-title">${title}</div>
      <p style="margin-top:12px;font-size:13px;color:var(--danger);max-width:480px;margin-inline:auto">${detail}</p>
      <button class="btn btn-primary" style="margin-top:20px" onclick="location.reload()">Recarregar</button>
    </div>`;
}

if (!window.supabase?.createClient) {
  showFatalError('Supabase não carregou', 'Recarregue a página. Se persistir, limpe o cache do navegador.');
} else {
  initApp().catch(err => showFatalError('Erro ao iniciar', err.message));
}
