import {
  formatDateShort, statusBadge, escapeHtml, $, $$, showToast, handleError
} from './utils.js';
import { tasksApi } from './api/crud.js?v=20260816a';
import { supabase } from './supabase-client.js';
import { SUPABASE_URL } from './config.js';
import { canManage } from './auth.js';

export const OFFICE_AGENTS = [
  { id: 'ceo', label: 'CEO', desc: 'Prioriza e despacha', icon: '🧠' },
  { id: 'social', label: 'Social', desc: 'Posts e carrosséis', icon: '📱' },
  { id: 'roteirista', label: 'Roteirista', desc: 'Vídeo / videomaker', icon: '🎬' },
  { id: 'roteirista_ads', label: 'Roteirista Ads', desc: 'Anúncios', icon: '📢' },
  { id: 'brand', label: 'Brand', desc: 'Marca e identidade', icon: '🎨' },
  { id: 'qa', label: 'QA', desc: 'Revisão de texto', icon: '✅' },
];

const STATUS_LABEL = {
  idle: 'Ocioso',
  queued: 'Na fila',
  studying: 'Estudando Canva…',
  writing: 'Escrevendo…',
  done: 'Concluído',
  error: 'Erro',
};

function todayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDaysKey(dateKey, days) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

async function loadAgendaTasks() {
  const today = todayKey();
  const horizon = addDaysKey(today, 7);
  const tasks = await tasksApi.list({
    order: { column: 'due_date', asc: true },
    limit: 80,
  });

  return (tasks || []).filter(t => {
    if (['concluida', 'cancelada'].includes(t.status)) return false;
    if (!['pendente', 'em_progresso', 'em_aprovacao'].includes(t.status)) return false;
    if (!t.due_date) return true;
    return t.due_date <= horizon;
  }).slice(0, 20);
}

function classifyTitle(title = '') {
  const t = title.toLowerCase();
  if (/aprova|legenda para apro/.test(t)) return { role: 'qa', content_type: 'aprovacao' };
  if (/marca|identidade|brand|logo/.test(t)) return { role: 'brand', content_type: 'marca' };
  if (/an[uú]ncio|\bads\b|meta ads/.test(t)) return { role: 'roteirista_ads', content_type: 'anuncio' };
  if (/v[ií]deo|reels|institucional|videomaker|roteiro/.test(t)) return { role: 'roteirista', content_type: 'roteiro' };
  if (/carrossel/.test(t)) return { role: 'social', content_type: 'carrossel' };
  if (/\bpost\b/.test(t)) return { role: 'social', content_type: 'post' };
  return { role: 'social', content_type: 'post' };
}

async function callOffice(action, body = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Não autenticado');

  const res = await fetch(`${SUPABASE_URL}/functions/v1/office-run?action=${action}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro no Escritório');
  return data;
}

async function loadJobs(sinceDate) {
  const { data, error } = await supabase
    .from('office_jobs')
    .select('*, tasks(id, title, client_names, clients(company_name, icon), status, due_date)')
    .gte('created_at', `${sinceDate}T00:00:00`)
    .order('created_at', { ascending: false })
    .limit(40);
  if (error) throw error;
  return data || [];
}

async function loadCanvaStatus() {
  const { data } = await supabase
    .from('integrations')
    .select('id, status, last_sync, settings')
    .eq('provider', 'canva')
    .is('client_id', null)
    .maybeSingle();
  return data;
}

function agentDeskHtml(agent, jobs) {
  const active = jobs.find(j =>
    j.agent_role === agent.id && ['queued', 'studying', 'writing'].includes(j.status)
  );
  const last = jobs.find(j => j.agent_role === agent.id);
  const status = active?.status || (last?.status === 'done' || last?.status === 'error' ? last.status : 'idle');
  const taskTitle = active?.tasks?.title || (status === 'done' || status === 'error' ? last?.tasks?.title : '') || '';
  const client = active?.tasks?.clients?.company_name
    || active?.tasks?.client_names
    || last?.tasks?.clients?.company_name
    || last?.tasks?.client_names
    || '';

  return `
    <div class="office-desk status-${status}" data-agent="${agent.id}">
      <div class="office-desk-top">
        <span class="office-desk-icon">${agent.icon}</span>
        <div>
          <div class="office-desk-name">${escapeHtml(agent.label)}</div>
          <div class="office-desk-role">${escapeHtml(agent.desc)}</div>
        </div>
      </div>
      <div class="office-desk-status">
        <span class="office-status-dot ${status}"></span>
        ${STATUS_LABEL[status] || status}
      </div>
      ${taskTitle ? `<div class="office-desk-task">${escapeHtml(taskTitle)}</div>` : ''}
      ${client ? `<div class="office-desk-client">${escapeHtml(client)}</div>` : ''}
    </div>`;
}

function jobCardHtml(job) {
  const title = job.tasks?.title || 'Task removida';
  const client = job.tasks?.clients?.company_name || job.tasks?.client_names || '—';
  const agent = OFFICE_AGENTS.find(a => a.id === job.agent_role);
  const out = job.output || {};
  const preview = out.caption || out.script || out.headline || job.error_message || '';

  return `
    <button type="button" class="office-job-card status-${job.status}" data-job-id="${job.id}">
      <div class="office-job-head">
        <span>${agent?.icon || '🤖'} ${escapeHtml(agent?.label || job.agent_role)}</span>
        <span class="office-job-badge">${escapeHtml(job.status)}</span>
      </div>
      <div class="office-job-title">${escapeHtml(title)}</div>
      <div class="office-job-meta">${escapeHtml(client)} · ${escapeHtml(job.content_type || '')}</div>
      ${preview ? `<div class="office-job-preview">${escapeHtml(String(preview).slice(0, 140))}${String(preview).length > 140 ? '…' : ''}</div>` : ''}
    </button>`;
}

function detailPanelHtml(job) {
  if (!job) return '';
  const out = job.output || {};
  const ctx = job.canva_context || {};
  const designs = Array.isArray(ctx.designs) ? ctx.designs : [];
  const agent = OFFICE_AGENTS.find(a => a.id === job.agent_role);

  return `
    <div class="office-detail-panel card" id="office-detail">
      <div class="office-detail-header">
        <div>
          <div class="office-detail-title">${escapeHtml(job.tasks?.title || 'Job')}</div>
          <div class="office-detail-meta">${agent?.icon || ''} ${escapeHtml(agent?.label || '')} · ${escapeHtml(job.status)}</div>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="office-detail-close">Fechar</button>
      </div>

      ${ctx.warning ? `<p class="office-warning">${escapeHtml(ctx.warning)}</p>` : ''}

      ${designs.length ? `
        <div class="office-section-label">Canva estudado</div>
        <div class="office-canva-grid">
          ${designs.map(d => `
            <div class="office-canva-item">
              ${d.thumbnail_url ? `<img src="${escapeHtml(d.thumbnail_url)}" alt="" loading="lazy">` : '<div class="office-canva-ph">🎨</div>'}
              <div class="office-canva-title">${escapeHtml(d.title || d.design_id)}</div>
            </div>`).join('')}
        </div>` : ''}

      ${job.status === 'done' ? `
        <div class="office-section-label">Entregável</div>
        ${out.headline ? `<div class="office-out-block"><strong>Headline</strong><p>${escapeHtml(out.headline)}</p></div>` : ''}
        ${out.caption ? `<div class="office-out-block"><strong>Legenda / Copy</strong><p>${escapeHtml(out.caption)}</p></div>` : ''}
        ${out.script ? `<div class="office-out-block"><strong>Roteiro</strong><pre>${escapeHtml(out.script)}</pre></div>` : ''}
        ${out.cta ? `<div class="office-out-block"><strong>CTA</strong><p>${escapeHtml(out.cta)}</p></div>` : ''}
        ${out.notes ? `<div class="office-out-block"><strong>Notas QA</strong><p>${escapeHtml(out.notes)}</p></div>` : ''}
        <div class="office-detail-actions">
          <button type="button" class="btn btn-primary" data-apply-job="${job.id}">Aplicar na tarefa</button>
          <button type="button" class="btn btn-ghost" data-rerun-task="${job.task_id || ''}">Rodar de novo</button>
        </div>` : ''}

      ${job.status === 'error' ? `
        <div class="office-out-block office-error"><strong>Erro</strong><p>${escapeHtml(job.error_message || 'Falha desconhecida')}</p></div>
        <button type="button" class="btn btn-primary" data-rerun-task="${job.task_id || ''}">Tentar de novo</button>` : ''}
    </div>`;
}

export async function renderOffice(profile) {
  const today = todayKey();
  const [tasks, jobs, canva] = await Promise.all([
    loadAgendaTasks().catch(() => []),
    loadJobs(today).catch(() => []),
    loadCanvaStatus().catch(() => null),
  ]);

  const canvaOk = canva?.status === 'connected';
  const unmatched = canva?.settings?.last_sync_summary?.unmatched?.length || 0;
  const canRun = canManage(profile) || profile?.role === 'colaborador';

  return `
    <div class="page-header">
      <h1 class="page-title">Escritório</h1>
      <p class="page-subtitle">Agents da CDM · pauta do calendário + Canva + Claude</p>
      <div class="page-actions">
        ${canRun ? `<button class="btn btn-primary" id="office-run-day">Rodar expediente</button>` : ''}
      </div>
    </div>

    <div class="office-toolbar">
      <div class="office-toolbar-date">${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <div class="office-canva-badge ${canvaOk ? 'ok' : 'off'}">
        ${canvaOk ? `Canva conectado${unmatched ? ` · ${unmatched} pastas sem vínculo` : ''}` : 'Canva desconectado — vá em Integrações'}
      </div>
    </div>

    <div class="office-layout">
      <section class="office-section">
        <div class="section-header"><span class="section-title">Mesas</span></div>
        <div class="office-desks" id="office-desks">
          ${OFFICE_AGENTS.map(a => agentDeskHtml(a, jobs)).join('')}
        </div>
      </section>

      <section class="office-section">
        <div class="section-header"><span class="section-title">Pauta da semana</span>
          <span class="kanban-count">${tasks.length}</span>
        </div>
        <div class="card office-agenda" id="office-agenda">
          ${tasks.length ? tasks.map(t => {
            const cls = classifyTitle(t.title);
            const agent = OFFICE_AGENTS.find(a => a.id === cls.role);
            return `<div class="office-agenda-row" data-task-id="${t.id}">
              <div class="office-agenda-main">
                <div class="office-agenda-title">${escapeHtml(t.title)}</div>
                <div class="office-agenda-meta">
                  ${escapeHtml(t.clients?.company_name || t.client_names || 'Sem cliente')}
                  · ${formatDateShort(t.due_date)}
                  · ${agent?.icon || ''} ${escapeHtml(agent?.label || cls.role)}
                </div>
              </div>
              ${statusBadge(t.status)}
              ${canRun ? `<button type="button" class="btn btn-ghost btn-sm" data-run-task="${t.id}">Rodar</button>` : ''}
            </div>`;
          }).join('') : '<div class="empty-state" style="padding:32px"><div class="empty-state-title">Nada na pauta (próximos 7 dias)</div></div>'}
        </div>
      </section>

      <section class="office-section office-feed-section">
        <div class="section-header"><span class="section-title">Feed</span></div>
        <div class="office-feed" id="office-feed">
          ${jobs.length ? jobs.map(jobCardHtml).join('') : '<div class="empty-state" style="padding:24px"><div class="empty-state-title">Nenhum job ainda</div></div>'}
        </div>
        <div id="office-detail-slot"></div>
      </section>
    </div>`;
}

export function bindOfficeEvents({ profile, refresh }) {
  let jobsCache = [];
  let channel = null;
  let pollTimer = null;

  async function refreshJobsUi() {
    try {
      jobsCache = await loadJobs(todayKey());
      const desks = $('#office-desks');
      if (desks) desks.innerHTML = OFFICE_AGENTS.map(a => agentDeskHtml(a, jobsCache)).join('');
      const feed = $('#office-feed');
      if (feed) {
        feed.innerHTML = jobsCache.length
          ? jobsCache.map(jobCardHtml).join('')
          : '<div class="empty-state" style="padding:24px"><div class="empty-state-title">Nenhum job ainda</div></div>';
        bindFeedClicks();
      }
    } catch (e) {
      console.warn('office refresh', e);
    }
  }

  function openDetail(jobId) {
    const job = jobsCache.find(j => j.id === jobId);
    const slot = $('#office-detail-slot');
    if (!slot || !job) return;
    slot.innerHTML = detailPanelHtml(job);
    $('#office-detail-close')?.addEventListener('click', () => { slot.innerHTML = ''; });

    $$('[data-apply-job]', slot).forEach(btn => {
      btn.onclick = async () => {
        try {
          btn.disabled = true;
          await callOffice('apply_job', { job_id: btn.dataset.applyJob });
          showToast('Texto aplicado na descrição da tarefa', 'success');
          refresh?.();
        } catch (err) {
          handleError(err);
          btn.disabled = false;
        }
      };
    });

    $$('[data-rerun-task]', slot).forEach(btn => {
      btn.onclick = async () => {
        if (!btn.dataset.rerunTask) return;
        try {
          btn.disabled = true;
          await callOffice('run_task', { task_id: btn.dataset.rerunTask });
          showToast('Job reenviado', 'success');
          await refreshJobsUi();
        } catch (err) {
          handleError(err);
          btn.disabled = false;
        }
      };
    });
  }

  function bindFeedClicks() {
    $$('[data-job-id]').forEach(btn => {
      btn.onclick = () => openDetail(btn.dataset.jobId);
    });
  }

  $('#office-run-day')?.addEventListener('click', async () => {
    const btn = $('#office-run-day');
    try {
      btn.disabled = true;
      btn.textContent = 'Rodando…';
      const result = await callOffice('run_day', {});
      if ((result.started ?? 0) === 0) {
        showToast(result.message || 'Nenhuma task na pauta da semana', 'info');
      } else {
        showToast(
          `Expediente: ${result.started} job(s) iniciados` +
            (result.failed ? ` · ${result.failed} falha(s)` : ''),
          result.failed ? 'warning' : 'success'
        );
      }
      await refreshJobsUi();
    } catch (err) {
      handleError(err);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Rodar expediente';
    }
  });

  $$('[data-run-task]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        btn.disabled = true;
        await callOffice('run_task', { task_id: btn.dataset.runTask });
        showToast('Job iniciado', 'success');
        await refreshJobsUi();
      } catch (err) {
        handleError(err);
      } finally {
        btn.disabled = false;
      }
    });
  });

  bindFeedClicks();

  // Realtime + poll fallback
  try {
    channel = supabase
      .channel('office_jobs_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'office_jobs' }, () => {
        refreshJobsUi();
      })
      .subscribe();
  } catch {
    // ignore
  }

  pollTimer = setInterval(refreshJobsUi, 5000);

  return () => {
    if (channel) supabase.removeChannel(channel);
    if (pollTimer) clearInterval(pollTimer);
  };
}
