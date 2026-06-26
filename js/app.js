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
    viewsModulePromise = import('./views.js?v=20260622c');
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
