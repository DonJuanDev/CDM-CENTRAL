import { requireAuth, signOut, canManage } from './auth.js';
import { $, $$, showToast, handleError, escapeHtml } from './utils.js';
import { readViewFromLocation, writeViewToLocation, writeViewHash, parseHashQuery, bindRouter } from './router.js';
import { ROLE_LABELS } from './config.js';
import { dismissCrudModal, openCrudModal } from './forms.js?v=20260813b';

const BUILD = '20260816a';

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
    viewsModulePromise = import(`./views.js?v=${BUILD}`);
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
  if (view === 'notas') view = 'notas-pessoais';
  if (!App.NAV_ITEMS.some(n => n.id === view)) view = 'dashboard';

  const viewHash = window.location.hash;
  if (view === App.currentView && !force) {
    if (view !== 'arquivos' || viewHash === App.lastViewHash) return;
  }
  App.lastViewHash = viewHash;

  App.currentView = view;
  if (!skipHistory) writeViewToLocation(view, { replace });
  else if (replace && !window.location.hash.includes('?')) writeViewToLocation(view, { replace: true });

  if (view !== 'escritorio' && App._officeCleanup) {
    try { App._officeCleanup(); } catch {}
    App._officeCleanup = null;
  }

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
        openCrudModal(entity, record, refresh);
      } catch (e) { handleError(e); }
    };
  });

  if (view === 'calendario') {
    const { bindCalendarEvents, refreshCalendarView } = await import(`./calendar.js?v=${BUILD}`);
    bindCalendarEvents((opts) => refreshCalendarView(App.profile, opts));
  }

  if (view === 'escritorio') {
    if (App._officeCleanup) {
      try { App._officeCleanup(); } catch {}
      App._officeCleanup = null;
    }
    const { bindOfficeEvents } = await import(`./office.js?v=${BUILD}`);
    App._officeCleanup = bindOfficeEvents({
      profile: App.profile,
      refresh: () => navigate('escritorio', { force: true, skipHistory: true }),
    });
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

    $$('[data-client-archive]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Remover cliente da lista? As senhas permanecem na aba Senhas Clientes.')) return;
        try {
          const { clientsApi } = await import('./api/crud.js?v=20260621a');
          await clientsApi.update(btn.dataset.clientArchive, { status: 'inativo' });
          showToast('Cliente removido. Senhas mantidas.', 'success');
          navigate('clientes', { force: true, skipHistory: true });
        } catch (err) {
          handleError(err);
        }
      });
    });
  }

  if (view === 'arquivos') {
    const refresh = () => navigate('arquivos', { force: true, skipHistory: true });
    const canManageFolders = canManage(App.profile) || App.profile?.role === 'colaborador';
    const { bindArquivosEvents } = await import('./files-browser.js?v=20260621a');
    bindArquivosEvents({ refresh, canManageFolders });
  }

  if (view === 'notas-pessoais' || view === 'notas-gerais') {
    $$('[data-note-complete]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const { notesApi } = await import(`./api/crud.js?v=${BUILD}`);
          const done = btn.dataset.completed === '1';
          await notesApi.update(btn.dataset.noteComplete, { is_completed: !done });
          showToast(done ? 'Nota reaberta' : 'Nota concluída', 'success');
          navigate(view, { force: true, skipHistory: true });
        } catch (err) {
          handleError(err);
        }
      });
    });

    const query = parseHashQuery();
    if (query.nota) {
      try {
        const { notesApi } = await import(`./api/crud.js?v=${BUILD}`);
        const record = await notesApi.get(query.nota);
        openCrudModal('notes', record, refresh);
      } catch (e) {
        handleError(e);
      }
    }
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

    const hash = window.location.hash;
    if (hash.includes('oauth_connected=') || hash.includes('oauth_error=')) {
      const params = new URLSearchParams(hash.split('?')[1] || '');
      const connected = params.get('oauth_connected');
      if (connected === 'canva') {
        showToast('Canva conectado com sucesso!', 'success');
      } else if (connected) {
        showToast(`${connected === 'meta_ads' ? 'Meta Ads' : connected} conectado com sucesso!`, 'success');
      } else if (params.get('oauth_error')) {
        showToast(`Erro OAuth: ${params.get('oauth_error')}`, 'error');
      }
      window.history.replaceState(null, '', window.location.pathname + '#/integracoes');
    }

    function openIntModal(title, bodyHtml) {
      $('#int-modal-title').textContent = title;
      $('#int-modal-body').innerHTML = bodyHtml;
      $('#int-modal').classList.remove('hidden');
      $('#overlay').classList.remove('hidden');
    }

    function closeIntModal() {
      $('#int-modal')?.classList.add('hidden');
      $('#overlay').classList.add('hidden');
    }

    $('#int-modal-close')?.addEventListener('click', closeIntModal);

    async function loadMappingsPanel(integrationId) {
      const panel = $('#int-mappings-panel');
      const loading = $('#int-mappings-loading');
      const body = $('#int-mappings-body');
      const footer = $('#int-mappings-footer');
      if (!panel) return;

      panel.classList.remove('hidden');
      loading?.classList.remove('hidden');
      body?.classList.add('hidden');
      footer?.classList.add('hidden');

      try {
        const [{ integrationsService }, { clientsApi }] = await Promise.all([
          import('./services/integrations.js?v=20260626c'),
          import('./api/crud.js?v=20260622a'),
        ]);
        const [{ accounts }, clients] = await Promise.all([
          integrationsService.listAdAccounts(integrationId),
          clientsApi.list({ order: { column: 'company_name', asc: true } }),
        ]);

        const clientOptions = clients.map(c =>
          `<option value="${c.id}">${escapeHtml(c.company_name)}</option>`
        ).join('');

        body.innerHTML = `
          <div class="int-mappings-table-wrap">
            <table class="notion-table">
              <thead><tr><th>Conta Meta</th><th>ID</th><th>Cliente CDM</th></tr></thead>
              <tbody>
                ${accounts.map(a => {
                  const selected = a.matched_client_id || '';
                  const autoBadge = a.matched_client_id && !a.manual_mapping
                    ? '<span class="int-map-auto">auto</span>' : '';
                  return `<tr>
                    <td>${escapeHtml(a.name)} ${autoBadge}</td>
                    <td style="font-family:monospace;font-size:11px;color:var(--text-tertiary)">${escapeHtml(a.id)}</td>
                    <td>
                      <select class="form-input int-map-select" data-account-id="${escapeHtml(a.id)}">
                        <option value="">— Não sincronizar —</option>
                        ${clientOptions.replace(
                          `value="${selected}"`,
                          `value="${selected}" selected`
                        )}
                      </select>
                    </td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>`;

        accounts.forEach(a => {
          const sel = body.querySelector(`[data-account-id="${CSS.escape(a.id)}"]`);
          if (sel && a.matched_client_id) sel.value = a.matched_client_id;
        });

        loading?.classList.add('hidden');
        body?.classList.remove('hidden');
        footer?.classList.remove('hidden');

        $('#int-mappings-save').onclick = async () => {
          const mappings = {};
          body.querySelectorAll('.int-map-select').forEach(sel => {
            if (sel.value) mappings[sel.dataset.accountId] = sel.value;
          });
          try {
            await integrationsService.saveMappings(integrationId, mappings);
            showToast('Vínculos salvos!', 'success');
            refresh();
          } catch (err) {
            showToast(err.message || 'Erro ao salvar', 'error');
          }
        };
      } catch (err) {
        loading.innerHTML = `<p style="color:var(--danger);padding:16px">${escapeHtml(err.message)}</p>`;
      }
    }

    $('#int-mappings-close')?.addEventListener('click', () => {
      $('#int-mappings-panel')?.classList.add('hidden');
    });

    $$('[data-int-mappings]').forEach(btn => {
      btn.addEventListener('click', () => loadMappingsPanel(btn.dataset.intMappings));
    });

    async function loadCanvaMappingsPanel(integrationId) {
      const panel = $('#int-canva-mappings-panel');
      const loading = $('#int-canva-mappings-loading');
      const body = $('#int-canva-mappings-body');
      const footer = $('#int-canva-mappings-footer');
      if (!panel) return;

      panel.classList.remove('hidden');
      loading?.classList.remove('hidden');
      body?.classList.add('hidden');
      footer?.classList.add('hidden');

      try {
        const [{ integrationsService }, { clientsApi }] = await Promise.all([
          import('./services/integrations.js?v=20260816a'),
          import('./api/crud.js?v=20260703a'),
        ]);
        const [{ folders }, clients] = await Promise.all([
          integrationsService.listCanvaFolders(integrationId),
          clientsApi.list({ order: { column: 'company_name', asc: true } }),
        ]);

        const clientOptions = clients.map(c =>
          `<option value="${c.id}">${escapeHtml(c.company_name)}</option>`
        ).join('');

        body.innerHTML = `
          <div class="int-mappings-table-wrap">
            <table class="notion-table">
              <thead><tr><th>Pasta Canva</th><th>ID</th><th>Cliente CDM</th></tr></thead>
              <tbody>
                ${(folders || []).map(f => {
                  const selected = f.matched_client_id || '';
                  const autoBadge = f.matched_client_id && !f.manual_mapping
                    ? '<span class="int-map-auto">auto</span>' : '';
                  return `<tr>
                    <td>${escapeHtml(f.name)} ${autoBadge}</td>
                    <td style="font-family:monospace;font-size:11px;color:var(--text-tertiary)">${escapeHtml(f.id)}</td>
                    <td>
                      <select class="form-input int-map-select" data-folder-id="${escapeHtml(f.id)}">
                        <option value="">— Sem vínculo —</option>
                        ${clientOptions}
                      </select>
                    </td>
                  </tr>`;
                }).join('') || '<tr><td colspan="3">Nenhuma pasta sincronizada. Clique em Sincronizar primeiro.</td></tr>'}
              </tbody>
            </table>
          </div>`;

        (folders || []).forEach(f => {
          const sel = body.querySelector(`[data-folder-id="${CSS.escape(f.id)}"]`);
          if (sel && f.matched_client_id) sel.value = f.matched_client_id;
        });

        loading?.classList.add('hidden');
        body?.classList.remove('hidden');
        footer?.classList.remove('hidden');

        $('#int-canva-mappings-save').onclick = async () => {
          const mappings = {};
          body.querySelectorAll('.int-map-select').forEach(sel => {
            if (sel.value) mappings[sel.dataset.folderId] = sel.value;
          });
          try {
            await integrationsService.saveCanvaMappings(integrationId, mappings);
            showToast('Vínculos Canva salvos!', 'success');
            refresh();
          } catch (err) {
            showToast(err.message || 'Erro ao salvar', 'error');
          }
        };
      } catch (err) {
        loading.innerHTML = `<p style="color:var(--danger);padding:16px">${escapeHtml(err.message)}</p>`;
      }
    }

    $('#int-canva-mappings-close')?.addEventListener('click', () => {
      $('#int-canva-mappings-panel')?.classList.add('hidden');
    });

    $$('[data-int-canva-mappings]').forEach(btn => {
      btn.addEventListener('click', () => loadCanvaMappingsPanel(btn.dataset.intCanvaMappings));
    });

    $$('[data-int-oauth]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const provider = btn.dataset.provider;
        const orig = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Abrindo Canva…';
        try {
          const { integrationsService } = await import('./services/integrations.js?v=20260816a');
          const result = await integrationsService.oauthStart(provider);
          if (result.auth_url) {
            window.location.href = result.auth_url;
            return;
          }
          throw new Error('URL de autorização não retornada');
        } catch (err) {
          showToast(err.message || 'Erro ao iniciar OAuth', 'error');
          btn.disabled = false;
          btn.textContent = orig;
        }
      });
    });

    $$('[data-int-connect]').forEach(btn => {
      btn.addEventListener('click', () => {
        const isEdit = btn.dataset.editMode === '1';
        const formHtml = `
          <form id="int-connect-form">
            <p class="settings-desc" style="margin-bottom:16px">
              Cole o token do <strong>Usuário do Sistema</strong> do Business Manager.
              O CDM vai descobrir e sincronizar <strong>todas</strong> as contas de anúncios automaticamente.
            </p>
            <div class="form-group">
              <label class="form-label">Token de acesso *</label>
              <textarea class="form-input" id="int-token" rows="4" required
                placeholder="Cole aqui o token gerado no Business Manager…"
                style="font-family:monospace;font-size:12px;resize:vertical"></textarea>
              <span class="form-hint">
                <a href="https://business.facebook.com/settings/system-users" target="_blank" rel="noopener">
                  business.facebook.com → Usuários do sistema → Gerar token
                </a>
              </span>
            </div>
            <div id="int-connect-error" class="form-error hidden" style="margin-bottom:12px"></div>
            <div style="display:flex;gap:10px;justify-content:flex-end">
              <button type="button" class="btn btn-ghost" id="int-connect-cancel">Cancelar</button>
              <button type="submit" class="btn btn-primary" id="int-connect-submit">
                ${isEdit ? 'Atualizar token' : 'Conectar conta mãe'}
              </button>
            </div>
          </form>`;

        openIntModal(isEdit ? 'Atualizar token Meta Ads' : 'Conectar conta mãe Meta Ads', formHtml);

        $('#int-connect-cancel').addEventListener('click', closeIntModal);
        $('#int-connect-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const errEl = $('#int-connect-error');
          const submitBtn = $('#int-connect-submit');
          const token = $('#int-token').value.trim();

          errEl.classList.add('hidden');
          submitBtn.disabled = true;
          submitBtn.textContent = 'Validando token…';

          try {
            const { integrationsService } = await import('./services/integrations.js?v=20260626c');
            const result = await integrationsService.connectBusinessManager('meta_ads', token);
            closeIntModal();
            const count = result.ad_accounts_found ?? 0;
            showToast(`Conta mãe conectada! ${count} conta(s) de anúncios encontrada(s).`, 'success');
            refresh();
          } catch (err) {
            errEl.textContent = err.message || 'Erro ao conectar';
            errEl.classList.remove('hidden');
            submitBtn.disabled = false;
            submitBtn.textContent = isEdit ? 'Atualizar token' : 'Conectar conta mãe';
          }
        });
      });
    });

    $$('[data-int-sync]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const integrationId = btn.dataset.intSync;
        const origText = btn.textContent;
        btn.disabled = true;
        btn.textContent = '↻ Sincronizando…';
        try {
          const { integrationsService } = await import('./services/integrations.js?v=20260816a');
          const result = await integrationsService.sync(integrationId);
          const unmatched = result.unmatched?.length ?? 0;
          let msg;
          if (result.designs != null) {
            msg = `Canva: ${result.designs} artes · ${result.folders ?? 0} pastas`;
            if (result.warnings?.length) {
              msg += ` (avisos: ${result.warnings.length})`;
            }
          } else {
            msg = `Sync concluído: ${result.accounts_synced}/${result.accounts_total} contas · ${result.records} campanhas`;
          }
          if (unmatched) msg += ` · ${unmatched} sem vínculo`;
          showToast(msg, unmatched ? 'warning' : 'success');
          refresh();
        } catch (err) {
          showToast(err.message || 'Erro na sincronização', 'error');
          btn.disabled = false;
          btn.textContent = origText;
        }
      });
    });

    $$('[data-int-disconnect]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const integrationId = btn.dataset.intDisconnect;
        if (!confirm('Desconectar a conta mãe? Os dados já sincronizados permanecem no Tráfego Pago.')) return;
        try {
          const { integrationsService } = await import('./services/integrations.js?v=20260626c');
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
        syncBtn.innerHTML = '↻ Sincronizando todas…';
        msg.textContent = '';
        try {
          const { integrationsApi } = await import('./api/crud.js?v=20260622a');
          const { integrationsService } = await import('./services/integrations.js?v=20260626c');
          const integrations = await integrationsApi.list();
          const master = integrations.find(i =>
            i.provider === 'meta_ads' && i.status === 'connected' && !i.client_id
          ) || integrations.find(i =>
            i.provider === 'meta_ads' && i.status === 'connected'
          );
          if (!master) {
            msg.textContent = 'Conecte a conta mãe em Integrações primeiro.';
            return;
          }
          const result = await integrationsService.sync(master.id);
          showToast(
            `Sync: ${result.accounts_synced}/${result.accounts_total} contas · ${result.records} campanhas`,
            'success'
          );
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
    const { prepareCalendarDeepLink } = await import(`./calendar.js?v=${BUILD}`);
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
  $('#close-detail-modal').onclick = () => { dismissCrudModal(); };
  $('#overlay').onclick = () => {
    dismissCrudModal().then(dismissed => {
      if (!dismissed) closePanels();
    });
  };

  document.onkeydown = (e) => {
    if (e.key !== 'Escape') return;
    import(`./calendar.js?v=${BUILD}`).then(m => {
      if (m.CalendarState?.focusDay) {
        m.closeCalendarDayFocus();
        return;
      }
      dismissCrudModal().then(dismissed => {
        if (!dismissed) closePanels();
      });
    });
    return;
  };
}

async function closePanels() {
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
