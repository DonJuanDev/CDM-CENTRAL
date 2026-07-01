import {
  formatDate, formatDateShort, formatDateTime,
  statusBadge, priorityBadge, escapeHtml,
  notionStatusBadge, assigneeChips, areaTag, $, showToast, handleError
} from './utils.js';
import { inferColorOwner, OWNER_COLORS, OWNER_HEX, resolveAssigneeColorKeys, parseAssigneeNames } from './config.js';
import {
  tasksApi, eventsApi, meetingsApi, invoicesApi, clientsApi
} from './api/crud.js?v=20260620c';
import { canManage } from './auth.js';
import { cached, invalidatePrefix } from './cache.js';

const TYPE_META = {
  task: { label: 'Conteúdo', icon: '📝', cls: 'type-task' },
  event: { label: 'Evento', icon: '📅', cls: 'type-event' },
  meeting: { label: 'Reunião', icon: '🤝', cls: 'type-meeting' },
  invoice: { label: 'Boleto', icon: '📄', cls: 'type-invoice' }
};

const STATUS_LABELS = {
  pendente: 'A fazer',
  em_progresso: 'Em andamento',
  em_aprovacao: 'Em aprovação',
  concluida: 'Concluído',
  cancelada: 'Cancelado'
};

export const CalendarState = {
  date: new Date(),
  view: localStorage.getItem('cdm-cal-view') || 'semana',
  clientFilter: '',
  typeFilter: 'all',
  statusFilter: '',
  focusDay: null,
  ownerFilter: 'all',
  pendingTaskId: null,
  deepLinkDismissed: false,
  blockItemClick: false,
  _lastItems: []
};

export function prepareCalendarDeepLink() {
  CalendarState.deepLinkDismissed = false;
}

export function clearCalendarDeepLinkHash() {
  const hash = window.location.hash || '';
  if (!hash.includes('calendario')) return;
  const qIndex = hash.indexOf('?');
  if (qIndex === -1) return;
  const base = `${window.location.pathname}#/calendario`;
  window.history.replaceState(null, '', base);
}

export function applyCalendarDeepLink() {
  if (CalendarState.deepLinkDismissed) return null;
  const hash = window.location.hash || '';
  if (!hash.includes('calendario')) return null;
  const qIndex = hash.indexOf('?');
  if (qIndex === -1) return null;
  const params = new URLSearchParams(hash.slice(qIndex + 1));
  const taskId = params.get('task');
  const date = params.get('date');
  if (date) {
    CalendarState.focusDay = date;
    CalendarState.date = parseLocalDate(date);
  }
  if (taskId) CalendarState.pendingTaskId = taskId;
  return { taskId, date };
}

function clearDayFocusUi() {
  document.body.classList.remove('cal-day-open');
  document.querySelectorAll('.is-focused, .is-dimmed').forEach(el => {
    el.classList.remove('is-focused', 'is-dimmed');
  });
  document.querySelectorAll('.has-day-focus').forEach(el => {
    el.classList.remove('has-day-focus');
  });
}

export function closeCalendarDayFocus() {
  CalendarState.focusDay = null;
  CalendarState.pendingTaskId = null;
  CalendarState.deepLinkDismissed = true;
  clearCalendarDeepLinkHash();
  clearDayFocusUi();
  CalendarState._onRefresh?.();
}

export function highlightPendingTask() {
  const taskId = CalendarState.pendingTaskId;
  if (!taskId) return;
  CalendarState.pendingTaskId = null;
  requestAnimationFrame(() => {
    const el = document.querySelector(`[data-cal-item][data-id="${taskId}"]`);
    if (!el) return;
    el.classList.add('cal-item-highlight');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => el.classList.remove('cal-item-highlight'), 5000);
  });
}

const MAX_WEEK_CARDS = 3;
const MAX_MONTH_CARDS = 3;

function toDateKey(d) {
  if (!d) return null;
  const s = typeof d === 'string' ? d : d.toISOString();
  return s.slice(0, 10);
}

function parseLocalDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function resolveTaskColorOwner(t) {
  const fromDb = (t.color_owner || '').trim();
  if (fromDb && OWNER_COLORS[fromDb]) return fromDb;
  const name = t.assignee_name || t.assignee?.full_name || '';
  const inferred = inferColorOwner(name, t.title || '');
  return inferred && OWNER_COLORS[inferred] ? inferred : 'default';
}

function normalizeTask(t) {
  const clientLabel = t.client_names || (t.clients ? `${t.clients.icon || ''} ${t.clients.company_name}`.trim() : '');
  return {
    id: t.id,
    entity: 'tasks',
    type: 'task',
    title: t.title,
    dateKey: toDateKey(t.due_date),
    datetime: t.due_date ? `${t.due_date}T09:00:00` : null,
    allDay: true,
    client: clientLabel,
    clientIcon: t.clients?.icon || '',
    clientId: t.client_id,
    priority: t.priority,
    status: t.status,
    assignee: t.assignee_name || t.assignee?.full_name || '',
    assigneeColorKeys: resolveAssigneeColorKeys(
      t.assignee_name || t.assignee?.full_name || '',
      (t.color_owner || '').trim()
    ),
    colorOwner: resolveTaskColorOwner(t),
    sortKey: t.due_date || '9999-12-31'
  };
}

function normalizeEvent(e) {
  const key = toDateKey(e.start_at);
  return {
    id: e.id,
    entity: 'events',
    type: 'event',
    title: e.title,
    dateKey: key,
    datetime: e.start_at,
    allDay: e.all_day,
    client: e.clients?.company_name || '',
    clientId: e.client_id,
    priority: e.priority,
    status: e.status || 'planejado',
    assignee: '',
    sortKey: e.start_at
  };
}

function normalizeMeeting(m) {
  const key = toDateKey(m.scheduled_at);
  return {
    id: m.id,
    entity: 'meetings',
    type: 'meeting',
    title: m.title,
    dateKey: key,
    datetime: m.scheduled_at,
    allDay: false,
    client: m.clients?.company_name || '',
    clientId: m.client_id,
    priority: 'media',
    status: m.status || 'agendada',
    assignee: '',
    sortKey: m.scheduled_at
  };
}

function normalizeInvoice(i) {
  return {
    id: i.id,
    entity: 'invoices',
    type: 'invoice',
    title: `Boleto — ${i.clients?.company_name || 'Cliente'}`,
    dateKey: toDateKey(i.due_date),
    datetime: i.due_date ? `${i.due_date}T12:00:00` : null,
    allDay: true,
    client: i.clients?.company_name || '',
    clientId: i.client_id,
    priority: i.status === 'atrasado' ? 'alta' : 'media',
    status: i.status,
    assignee: '',
    sortKey: i.due_date
  };
}

export async function fetchCalendarItems(profile, { reload = false } = {}) {
  const key = `calendar:items:${profile.id}`;
  if (reload) invalidatePrefix('calendar:');

  return cached(key, async () => {
    const canSeeFinance = canManage(profile);
    const fetches = [
      tasksApi.list({ order: { column: 'due_date', asc: true } }),
      eventsApi.list({ order: { column: 'start_at', asc: true } }),
      meetingsApi.list({ order: { column: 'scheduled_at', asc: true } })
    ];
    if (canSeeFinance) fetches.push(invoicesApi.list({ order: { column: 'due_date', asc: true } }));

    const [tasks, events, meetings, invoices = []] = await Promise.all(fetches);
    const items = [
      ...tasks.map(normalizeTask),
      ...events.map(normalizeEvent),
      ...meetings.map(normalizeMeeting),
      ...invoices.map(normalizeInvoice)
    ];
    return items.sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey)));
  }, 90_000);
}

function filterItems(items) {
  return items.filter(item => {
    if (CalendarState.typeFilter !== 'all' && item.type !== CalendarState.typeFilter) return false;
    if (CalendarState.clientFilter && item.clientId !== CalendarState.clientFilter) return false;
    if (CalendarState.statusFilter && item.status !== CalendarState.statusFilter) return false;
    if (CalendarState.ownerFilter !== 'all' && !getOwnerColorKeys(item).includes(CalendarState.ownerFilter)) return false;
    return true;
  });
}

function renderOwnerBadges(item) {
  const keys = getOwnerColorKeys(item);
  if (!keys.length) return '';
  return keys.map(key => {
    const o = OWNER_COLORS[key];
    if (!o) return '';
    return `<span class="notion-owner-badge ${o.cls}">${o.label}</span>`;
  }).join('');
}

function getOwnerColorKeys(item) {
  if (item.assigneeColorKeys?.length) return item.assigneeColorKeys;
  if (item.type === 'invoice') return ['boleto'];
  if (item.colorOwner && OWNER_COLORS[item.colorOwner]) return [item.colorOwner];
  return resolveAssigneeColorKeys(item.assignee || '', item.colorOwner || '');
}

function getOwnerColorKey(item) {
  const keys = getOwnerColorKeys(item);
  return keys[0] || 'default';
}

function buildCardColorStyles(colorKeys) {
  const keys = (colorKeys || []).filter(k => k && OWNER_HEX[k]);
  if (!keys.length) {
    return { cardStyle: '', barStyle: '', barClass: 'owner-default' };
  }
  const hexes = keys.map(k => OWNER_HEX[k]);
  if (hexes.length === 1) {
    const hex = hexes[0];
    return {
      cardStyle: `background:${hex}22;border-color:${hex}55`,
      barStyle: `background:${hex}`,
      barClass: OWNER_COLORS[keys[0]].cls
    };
  }
  const barStops = hexes.map((h, i) => {
    const start = ((100 / hexes.length) * i).toFixed(2);
    const end = ((100 / hexes.length) * (i + 1)).toFixed(2);
    return `${h} ${start}%, ${h} ${end}%`;
  }).join(', ');
  const bgStops = hexes.map((h, i) => {
    const start = ((100 / hexes.length) * i).toFixed(2);
    const end = ((100 / hexes.length) * (i + 1)).toFixed(2);
    return `${h}33 ${start}%, ${h}33 ${end}%`;
  }).join(', ');
  return {
    cardStyle: `background: linear-gradient(135deg, ${bgStops}); border-color: ${hexes[0]}88`,
    barStyle: `background: linear-gradient(90deg, ${barStops})`,
    barClass: 'owner-split'
  };
}

function renderOwnerBadge(item) {
  return renderOwnerBadges(item);
}

function ownerClass(item) {
  return OWNER_COLORS[getOwnerColorKey(item)]?.cls || 'owner-default';
}

function ownerStyles(item, compact = false) {
  const { cardStyle } = buildCardColorStyles(getOwnerColorKeys(item));
  if (compact) {
    return `${cardStyle};color:var(--text-primary)`;
  }
  return cardStyle;
}

function compactDotStyle(item) {
  const keys = getOwnerColorKeys(item);
  const hexes = keys.map(k => OWNER_HEX[k]).filter(Boolean);
  if (hexes.length >= 2) {
    return `background: linear-gradient(135deg, ${hexes[0]} 50%, ${hexes[1]} 50%)`;
  }
  return `background:${hexes[0] || OWNER_HEX.default}`;
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status?.replace(/_/g, ' ') || '—';
}

function isItemCompleted(item) {
  const done = new Set([
    'concluida', 'cancelada', 'concluido', 'cancelado',
    'pago', 'realizada', 'cancelada'
  ]);
  return done.has(item.status);
}

/** Tarefas pendentes/em andamento primeiro; concluídas/canceladas por último */
function sortItemsForDisplay(items) {
  return [...items].sort((a, b) => {
    const aDone = isItemCompleted(a) ? 1 : 0;
    const bDone = isItemCompleted(b) ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return String(a.sortKey || '').localeCompare(String(b.sortKey || ''));
  });
}

function calItemAttrs(item) {
  const drag = canManageFlag ? 'draggable="true"' : '';
  const date = item.dateKey ? `data-cal-date="${item.dateKey}"` : '';
  return `data-edit="${item.entity}" data-id="${item.id}" data-cal-item ${drag} ${date}`.trim();
}

function buildMovedDatetime(iso, targetDateKey) {
  if (!iso) return `${targetDateKey}T09:00:00`;
  if (iso.length > 10 && (iso.includes('Z') || iso.includes('+'))) {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) {
      return `${targetDateKey}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;
    }
  }
  return `${targetDateKey}${iso.slice(10)}`;
}

async function moveCalendarItem(entity, id, targetDateKey) {
  const api = CALENDAR_API[entity];
  if (!api) throw new Error('Tipo não suportado para arrastar');

  const cached = CalendarState._allItems?.find(i => i.entity === entity && i.id === id);

  if (entity === 'tasks' || entity === 'invoices') {
    return api.update(id, { due_date: targetDateKey });
  }

  if (entity === 'meetings') {
    const dt = cached?.datetime || (await api.get(id)).scheduled_at;
    return api.update(id, { scheduled_at: buildMovedDatetime(dt, targetDateKey) });
  }

  if (entity === 'events') {
    const record = await api.get(id);
    const start_at = buildMovedDatetime(cached?.datetime || record.start_at, targetDateKey);
    const payload = { start_at };
    if (record.end_at && record.start_at) {
      const duration = new Date(record.end_at).getTime() - new Date(record.start_at).getTime();
      payload.end_at = new Date(new Date(start_at).getTime() + duration).toISOString();
    }
    return api.update(id, payload);
  }

  throw new Error('Este item não pode ser movido no calendário');
}

function clearCalDropHighlights() {
  document.querySelectorAll('.cal-drop-over').forEach(el => el.classList.remove('cal-drop-over'));
}

function renderNotionCard(item, large = false) {
  const attrs = calItemAttrs(item);
  const colorKeys = getOwnerColorKeys(item);
  const { cardStyle, barStyle, barClass } = buildCardColorStyles(colorKeys);
  const owner = ownerClass(item);
  const cls = large ? `notion-card notion-card-lg ${owner}` : `notion-card ${owner}`;

  if (item.type !== 'task') {
    const meta = TYPE_META[item.type];
    return `<div class="${cls} notion-card-${item.type}" style="${cardStyle}" ${attrs}>
      <div class="notion-card-color-bar ${barClass}" style="${barStyle}"></div>
      <div class="notion-card-inner">
        <div class="notion-card-title">${meta.icon} ${escapeHtml(item.title)}</div>
        ${item.client ? `<div class="notion-card-client">${escapeHtml(item.client)}</div>` : ''}
        ${item.priority === 'alta' ? priorityBadge('alta') : ''}
        <div class="notion-card-footer">${renderOwnerBadges(item)}${notionStatusBadge(item.status)}</div>
      </div>
    </div>`;
  }
  return `<div class="${cls}" style="${cardStyle}" ${attrs}>
    <div class="notion-card-color-bar ${barClass}" style="${barStyle}"></div>
    <div class="notion-card-inner">
      <div class="notion-card-title"><span class="notion-doc-icon">📄</span>${escapeHtml(item.title)}</div>
      ${item.client ? `<div class="notion-card-client">${escapeHtml(item.client)}</div>` : ''}
      ${item.assignee ? assigneeChips(item.assignee, colorKeys) : ''}
      <div class="notion-card-footer">${renderOwnerBadges(item)}${notionStatusBadge(item.status)}</div>
    </div>
  </div>`;
}

function daySummary(items) {
  const counts = { concluida: 0, em_progresso: 0, em_aprovacao: 0, pendente: 0, other: 0 };
  items.forEach(i => {
    if (counts[i.status] !== undefined) counts[i.status]++;
    else counts.other++;
  });
  const parts = [];
  if (counts.concluida) parts.push(`${counts.concluida} concluído${counts.concluida > 1 ? 's' : ''}`);
  if (counts.em_aprovacao) parts.push(`${counts.em_aprovacao} em aprovação`);
  if (counts.em_progresso) parts.push(`${counts.em_progresso} em andamento`);
  if (counts.pendente) parts.push(`${counts.pendente} a fazer`);
  return parts.join(' · ') || 'Sem conteúdos';
}

function renderMoreButton(dateKey, count, showCollapse = false) {
  if (showCollapse) {
    return `<button type="button" class="cal-show-more cal-show-less" data-cal-collapse-day="${dateKey}">Recolher</button>`;
  }
  if (count <= 0) return '';
  return `<button type="button" class="cal-show-more" data-cal-show-day="${dateKey}">+${count} mais</button>`;
}

function statusCardClass(status) {
  const map = {
    pendente: 'cal-status-pendente',
    em_progresso: 'cal-status-em_progresso',
    em_aprovacao: 'cal-status-em_aprovacao',
    concluida: 'cal-status-concluida',
    cancelada: 'cal-status-cancelada'
  };
  return map[status] || 'cal-status-pendente';
}

function stripClientLabel(client = '') {
  const trimmed = String(client).trim();
  if (!trimmed) return '';
  return trimmed.replace(/^[\s\p{Extended_Pictographic}\p{Emoji_Presentation}]+/u, '').trim() || trimmed;
}

function renderStatusCardAssignees(item) {
  const names = parseAssigneeNames(item.assignee || '');
  if (!names.length) return '';
  return `<div class="cal-status-card-assignees">${escapeHtml(names.join(', '))}</div>`;
}

function renderStatusCard(item, variant = 'month') {
  const attrs = calItemAttrs(item);
  const statusCls = statusCardClass(item.status);
  const variantCls = variant === 'week' ? ' cal-status-card--week' : ' cal-status-card--month';
  const clientLabel = stripClientLabel(item.client || '');
  const typeIcon = item.type !== 'task' ? `${TYPE_META[item.type]?.icon || ''} ` : '';
  const clientHtml = clientLabel
    ? `<div class="cal-status-card-client">${escapeHtml(clientLabel)}</div>`
    : '';
  const assigneesHtml = renderStatusCardAssignees(item);

  return `<div class="cal-status-card ${statusCls}${variantCls}" ${attrs}>
    ${clientHtml}
    <div class="cal-status-card-title">${typeIcon}${escapeHtml(item.title)}</div>
    ${assigneesHtml}
  </div>`;
}

function renderMonthDayCell({ dateStr, dayNum, items, todayKey, extraClass = '' }) {
  const dayItems = sortItemsForDisplay(items.filter(i => i.dateKey === dateStr));
  const isToday = todayKey === dateStr;
  const isFocused = CalendarState.focusDay === dateStr;
  const limit = isFocused ? dayItems.length : MAX_MONTH_CARDS;
  const visible = dayItems.slice(0, limit);
  const extra = dayItems.length - visible.length;
  const classes = [
    'calendar-day',
    extraClass,
    isToday ? 'today' : '',
    isFocused ? 'is-focused' : '',
    CalendarState.focusDay && !isFocused ? 'is-dimmed' : ''
  ].filter(Boolean).join(' ');

  return `<div class="${classes}" data-date="${dateStr}" data-cal-day role="button" tabindex="0" aria-label="Dia ${dayNum}">
      <div class="calendar-day-header-row">
        <span class="calendar-day-number ${isToday ? 'today-badge' : ''}">${dayNum}</span>
        ${dayItems.length ? `<span class="cal-day-count">${dayItems.length}</span>` : ''}
        ${canManageFlag ? `<button class="cal-day-add" data-add-date="${dateStr}" title="Adicionar">+</button>` : ''}
      </div>
      <div class="calendar-day-events">
        ${visible.map(i => renderStatusCard(i, 'month')).join('')}
        ${isFocused && dayItems.length > MAX_MONTH_CARDS
          ? renderMoreButton(dateStr, 0, true)
          : renderMoreButton(dateStr, extra)}
      </div>
    </div>`;
}

function renderMonthGrid(items) {
  const now = CalendarState.date;
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthName = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();
  const prevMonthRef = new Date(year, month, 0);
  const prevYear = prevMonthRef.getFullYear();
  const prevMonth = prevMonthRef.getMonth();
  const nextMonthRef = new Date(year, month + 1, 1);
  const nextYear = nextMonthRef.getFullYear();
  const nextMonth = nextMonthRef.getMonth();
  const today = new Date();
  const todayKey = toDateKey(today);

  let days = '';
  for (let i = firstDay - 1; i >= 0; i--) {
    const dayNum = daysInPrev - i;
    const dateStr = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    days += renderMonthDayCell({ dateStr, dayNum, items, todayKey, extraClass: 'other-month' });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    days += renderMonthDayCell({ dateStr, dayNum: d, items, todayKey });
  }

  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
  for (let d = 1; d <= totalCells - firstDay - daysInMonth; d++) {
    const dateStr = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    days += renderMonthDayCell({ dateStr, dayNum: d, items, todayKey, extraClass: 'other-month' });
  }

  return { monthName, days };
}

let canManageFlag = false;

function renderWeekView(items) {
  const start = new Date(CalendarState.date);
  start.setDate(start.getDate() - start.getDay());
  const todayKey = toDateKey(new Date());
  const headers = [];
  const cols = [];
  const hasFocus = !!CalendarState.focusDay;

  for (let i = 0; i < 7; i++) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    const key = toDateKey(day);
    const isToday = key === todayKey;
    const isFocused = CalendarState.focusDay === key;
    const dayNum = day.getDate();
    const weekday = day.toLocaleDateString('pt-BR', { weekday: 'long' });
    const dayItems = sortItemsForDisplay(items.filter(it => it.dateKey === key));
    const limit = isFocused ? dayItems.length : MAX_WEEK_CARDS;
    const visible = dayItems.slice(0, limit);
    const extra = dayItems.length - visible.length;

    headers.push(`<div class="notion-week-header ${isToday ? 'today' : ''} ${isFocused ? 'is-focused' : ''}" data-cal-day-header data-cal-day data-date="${key}" role="button" tabindex="0">
      <span class="notion-weekday">${weekday}</span>
      <span class="notion-day-num ${isToday ? 'today-badge' : ''}">${dayNum}</span>
      ${dayItems.length ? `<span class="cal-day-count">${dayItems.length}</span>` : ''}
    </div>`);

    cols.push(`<div class="notion-week-col ${isToday ? 'today' : ''} ${isFocused ? 'is-focused' : ''} ${hasFocus && !isFocused ? 'is-dimmed' : ''}" data-date="${key}" data-cal-day role="button" tabindex="0">
      ${canManageFlag ? `<button class="cal-day-add cal-day-add-week" data-add-date="${key}">+</button>` : ''}
      <div class="notion-week-cards">
        ${visible.map(it => renderStatusCard(it, 'week')).join('')}
        ${isFocused && dayItems.length > MAX_WEEK_CARDS
          ? renderMoreButton(key, 0, true)
          : renderMoreButton(key, extra)}
        ${!dayItems.length ? '<div class="cal-week-empty">Clique para ver o dia</div>' : ''}
      </div>
    </div>`);
  }

  return `<div class="notion-week-board ${hasFocus ? 'has-day-focus' : ''}">
    <div class="notion-week-headers">${headers.join('')}</div>
    <div class="notion-week-cols">${cols.join('')}</div>
  </div>`;
}

function renderTableView(items) {
  const sorted = sortItemsForDisplay(items);
  const rows = sorted.length ? sorted.map(item => {
    const meta = TYPE_META[item.type];
    return `<tr data-edit="${item.entity}" data-id="${item.id}" data-cal-item>
      <td class="cal-table-task">
        <span class="cal-owner-dot ${ownerClass(item)}"></span>
        <span class="cal-table-icon">${meta.icon}</span>
        <span class="cal-table-title">${escapeHtml(item.title)}</span>
      </td>
      <td>${escapeHtml(item.client || '—')}</td>
      <td>${item.priority && item.priority !== 'media' ? priorityBadge(item.priority) : '—'}</td>
      <td>${item.assignee ? assigneeChips(item.assignee, getOwnerColorKeys(item)) : '—'}</td>
      <td>${notionStatusBadge(item.status)}</td>
      <td>${item.dateKey ? formatDate(item.dateKey) : '—'}</td>
      <td><span class="tag cal-type-tag ${meta.cls}">${meta.label}</span></td>
    </tr>`;
  }).join('') : `<tr><td colspan="7"><div class="empty-state" style="padding:32px">Nenhum item no calendário</div></td></tr>`;

  return `<div class="table-wrapper cal-table-wrap">
    <table class="cal-table">
      <thead><tr>
        <th>Tarefa</th><th>Cliente</th><th>Prioridade</th><th>Responsável</th><th>Status</th><th>Data</th><th>Tipo</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderAgendaView(items) {
  const withDate = items.filter(i => i.dateKey);
  const grouped = {};
  withDate.forEach(item => {
    if (!grouped[item.dateKey]) grouped[item.dateKey] = [];
    grouped[item.dateKey].push(item);
  });

  const keys = Object.keys(grouped).sort();
  if (!keys.length) {
    return '<div class="empty-state" style="padding:48px"><div class="empty-state-icon">📅</div><div class="empty-state-title">Nenhum item agendado</div></div>';
  }

  return keys.map(key => {
    const dayLabel = parseLocalDate(key).toLocaleDateString('pt-BR', {
      weekday: 'long', day: 'numeric', month: 'long'
    });
    return `<div class="cal-agenda-day" data-cal-day data-date="${key}">
      <div class="cal-agenda-date">${dayLabel}</div>
      ${grouped[key].sort((a, b) => {
        const aDone = isItemCompleted(a) ? 1 : 0;
        const bDone = isItemCompleted(b) ? 1 : 0;
        return aDone - bDone;
      }).map(item => {
        const meta = TYPE_META[item.type];
        return `<div class="cal-agenda-item ${ownerClass(item)}" ${calItemAttrs(item)}>
          <span class="cal-agenda-color ${ownerClass(item)}"></span>
          <span class="cal-agenda-time">${item.allDay ? 'Dia inteiro' : formatDateTime(item.datetime).split(',')[1]?.trim() || '—'}</span>
          <div class="cal-agenda-body">
            <div class="cal-agenda-title">${meta.icon} ${escapeHtml(item.title)}</div>
            <div class="cal-agenda-meta">
              ${renderOwnerBadge(item)}
              ${item.client ? `<span>${escapeHtml(item.client)}</span>` : ''}
              ${notionStatusBadge(item.status)}
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
}

function renderFilters(clients) {
  const types = [
    { id: 'all', label: 'Todos' },
    { id: 'task', label: 'Conteúdo' },
    { id: 'meeting', label: 'Reuniões' },
    { id: 'event', label: 'Eventos' },
    { id: 'invoice', label: 'Boletos' }
  ];

  const owners = ['all', 'boleto', 'juan', 'mariah', 'wanessa', 'bernardo', 'ney'];

  return `<div class="cal-filters">
    <div class="cal-filter-group">
      ${types.map(t => `<button class="cal-filter-chip ${CalendarState.typeFilter === t.id ? 'active' : ''}" data-cal-type="${t.id}">${t.label}</button>`).join('')}
    </div>
    <div class="cal-filter-group cal-owner-filters">
      <span class="cal-filter-label">Cor:</span>
      ${owners.map(k => {
        const label = k === 'all' ? 'Todos' : OWNER_COLORS[k].label;
        const dot = k === 'all' ? '' : `<span class="cal-filter-dot ${OWNER_COLORS[k].cls}"></span>`;
        return `<button class="cal-filter-chip cal-owner-chip ${CalendarState.ownerFilter === k ? 'active' : ''}" data-cal-owner="${k}">${dot}${label}</button>`;
      }).join('')}
    </div>
    <select class="form-input cal-filter-select" id="cal-client-filter">
      <option value="">Todos os clientes</option>
      ${clients.map(c => `<option value="${c.id}" ${CalendarState.clientFilter === c.id ? 'selected' : ''}>${escapeHtml(c.company_name)}</option>`).join('')}
    </select>
  </div>`;
}

export async function renderCalendarView(profile, { reload = false } = {}) {
  applyCalendarDeepLink();
  canManageFlag = canManage(profile);
  if (!reload && CalendarState._allItems && CalendarState._clients) {
    return buildCalendarHtml(profile, CalendarState._allItems, CalendarState._clients);
  }
  const [allItems, clients] = await Promise.all([
    fetchCalendarItems(profile, { reload }),
    clientsApi.list({ order: { column: 'company_name', asc: true } })
  ]);
  CalendarState._allItems = allItems;
  CalendarState._clients = clients;
  return buildCalendarHtml(profile, allItems, clients);
}

function buildCalendarHtml(profile, allItems, clients) {
  const items = filterItems(allItems);
  const views = ['semana', 'mes', 'tabela', 'agenda'];
  const viewLabels = { mes: 'Mês', semana: 'Semana', tabela: 'Tabela', agenda: 'Agenda' };

  let body = '';
  if (CalendarState.view === 'mes') {
    const { monthName, days } = renderMonthGrid(items);
    body = `
      <div class="calendar-grid notion-calendar ${CalendarState.focusDay ? 'has-day-focus' : ''}">
        ${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(d => `<div class="calendar-day-header">${d}</div>`).join('')}
        ${days}
      </div>`;
    CalendarState._monthName = monthName;
  } else if (CalendarState.view === 'semana') {
    body = renderWeekView(items);
  } else if (CalendarState.view === 'tabela') {
    body = renderTableView(items);
  } else {
    body = `<div class="cal-agenda">${renderAgendaView(items)}</div>`;
  }

  const monthLabel = CalendarState.view === 'semana'
    ? (() => {
        const start = new Date(CalendarState.date);
        start.setDate(start.getDate() - start.getDay());
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        return `${start.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })} — ${end.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })}`;
      })()
    : (CalendarState._monthName ||
      CalendarState.date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));

  const actions = canManage(profile) ? `
    <button class="btn btn-primary" data-create="tasks">+ Conteúdo</button>
    <button class="btn btn-secondary" data-create="events">+ Evento</button>
    <button class="btn btn-secondary" data-create="meetings">+ Reunião</button>
  ` : '';

  return `<div class="cal-page-root">
    <div class="page-header cal-page-header">
      <div>
        <h1 class="page-title">Gestão de Projetos — CDM Marketing</h1>
        <p class="page-subtitle">Calendário de Conteúdos</p>
      </div>
      <div class="page-actions">${actions}</div>
    </div>

    ${renderFilters(clients)}

    <div class="calendar-toolbar notion-toolbar">
      <div class="calendar-nav">
        <button class="btn btn-icon btn-secondary" id="cal-prev" aria-label="Anterior">‹</button>
        <span class="calendar-month" id="cal-month-label">${monthLabel}</span>
        <button class="btn btn-icon btn-secondary" id="cal-next" aria-label="Próximo">›</button>
        <button class="btn btn-sm btn-secondary" id="cal-today">Hoje</button>
      </div>
      <div class="tabs cal-view-tabs">
        ${views.map(v => `<button class="tab ${CalendarState.view === v ? 'active' : ''}" data-cal-view="${v}">${viewLabels[v]}</button>`).join('')}
      </div>
    </div>

    <div class="cal-body" id="cal-body">${body}</div>

    <div class="cal-legend cal-legend-status">
      <span class="cal-legend-item"><span class="cal-legend-dot cal-legend-pendente"></span>A fazer</span>
      <span class="cal-legend-item"><span class="cal-legend-dot cal-legend-em_progresso"></span>Em andamento</span>
      <span class="cal-legend-item"><span class="cal-legend-dot cal-legend-em_aprovacao"></span>Em aprovação</span>
      <span class="cal-legend-item"><span class="cal-legend-dot cal-legend-concluida"></span>Concluído</span>
    </div>
  </div>`;
}

const CALENDAR_API = {
  tasks: tasksApi,
  events: eventsApi,
  meetings: meetingsApi,
  invoices: invoicesApi
};

const CALENDAR_ENTITY_LABEL = {
  tasks: 'conteúdo',
  events: 'evento',
  meetings: 'reunião',
  invoices: 'boleto'
};

function ensureCalContextMenu() {
  let menu = $('#cal-context-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'cal-context-menu';
    menu.className = 'cal-context-menu hidden';
    menu.innerHTML = `
      <button type="button" class="cal-context-item" data-action="edit">✏️ Editar</button>
      <button type="button" class="cal-context-item cal-context-danger" data-action="delete">🗑️ Excluir</button>`;
    document.body.appendChild(menu);
  }
  return menu;
}

function hideCalContextMenu() {
  $('#cal-context-menu')?.classList.add('hidden');
}

async function openCalendarItemEditor(entity, id, onAction) {
  const api = CALENDAR_API[entity];
  if (!api) return;
  try {
    const record = await api.get(id);
    const { openCrudModal } = await import('./forms.js?v=20260628a');
    openCrudModal(entity, record, onAction);
  } catch (err) {
    handleError(err);
  }
}

function showCalContextMenu(x, y, { entity, id }, onAction) {
  const menu = ensureCalContextMenu();
  hideCalContextMenu();

  const left = Math.min(x, window.innerWidth - 180);
  const top = Math.min(y, window.innerHeight - 90);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  menu.classList.remove('hidden');

  menu.querySelector('[data-action="edit"]').onclick = async (e) => {
    e.stopPropagation();
    hideCalContextMenu();
    await openCalendarItemEditor(entity, id, onAction);
  };

  menu.querySelector('[data-action="delete"]').onclick = async (e) => {
    e.stopPropagation();
    hideCalContextMenu();
    const api = CALENDAR_API[entity];
    if (!api) return;
    const label = CALENDAR_ENTITY_LABEL[entity] || 'item';
    if (!confirm(`Excluir este ${label}?`)) return;
    try {
      await api.remove(id);
      if (entity === 'tasks') invalidatePrefix('calendar:');
      showToast('Excluído com sucesso', 'success');
      onAction();
    } catch (err) { handleError(err); }
  };
}

function bindCalContextMenu(onRefresh) {
  hideCalContextMenu();

  if (CalendarState._contextHandler) {
    document.removeEventListener('contextmenu', CalendarState._contextHandler);
  }
  if (CalendarState._contextDismiss) {
    document.removeEventListener('click', CalendarState._contextDismiss);
    document.removeEventListener('scroll', CalendarState._contextDismiss, true);
    document.removeEventListener('keydown', CalendarState._contextDismiss);
  }

  const handler = (e) => {
    const item = e.target.closest('[data-cal-item]');
    const root = document.querySelector('.cal-page-root');
    if (!item || !root?.contains(item)) return;

    e.preventDefault();
    e.stopPropagation();
    if (!canManageFlag) return;

    showCalContextMenu(e.clientX, e.clientY, {
      entity: item.dataset.edit,
      id: item.dataset.id
    }, () => onRefresh({ reload: true }));
  };

  const dismiss = (e) => {
    if (e.type === 'keydown' && e.key !== 'Escape') return;
    if (e.type === 'click' && e.target.closest('#cal-context-menu')) return;
    hideCalContextMenu();
  };

  CalendarState._contextHandler = handler;
  CalendarState._contextDismiss = dismiss;
  document.addEventListener('contextmenu', handler);
  document.addEventListener('click', dismiss);
  document.addEventListener('scroll', dismiss, true);
  document.addEventListener('keydown', dismiss);
}

function bindCalItemClick(onRefresh) {
  const onAction = () => onRefresh({ reload: true });

  document.querySelectorAll('[data-cal-item]').forEach(el => {
    el.addEventListener('click', async (e) => {
      if (!canManageFlag) return;
      if (CalendarState.blockItemClick) {
        CalendarState.blockItemClick = false;
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      await openCalendarItemEditor(el.dataset.edit, el.dataset.id, onAction);
    });
  });
}

export async function refreshCalendarView(profile, { reload = false } = {}) {
  const html = await renderCalendarView(profile, { reload });
  const root = document.querySelector('.cal-page-root');
  if (root) root.outerHTML = html;
  else $('#main-content').innerHTML = html;
  bindCalendarEvents((opts) => refreshCalendarView(profile, opts));
  highlightPendingTask();
}

export function bindCalendarEvents(onRefresh) {
  const refresh = (reload = false) => onRefresh({ reload });
  CalendarState._onRefresh = () => refresh(false);

  function openDay(dateKey) {
    CalendarState.deepLinkDismissed = false;
    CalendarState.focusDay = dateKey;
    refresh(false);
    requestAnimationFrame(() => {
      document.querySelector(`[data-cal-day][data-date="${dateKey}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  function toggleDay(dateKey) {
    if (CalendarState.focusDay === dateKey) {
      closeFocus();
      return;
    }
    openDay(dateKey);
  }

  function closeFocus() {
    closeCalendarDayFocus();
  }

  $('#cal-prev')?.addEventListener('click', () => {
    CalendarState.focusDay = null;
    if (CalendarState.view === 'semana') {
      CalendarState.date.setDate(CalendarState.date.getDate() - 7);
    } else {
      CalendarState.date.setMonth(CalendarState.date.getMonth() - 1);
    }
    refresh(false);
  });

  $('#cal-next')?.addEventListener('click', () => {
    CalendarState.focusDay = null;
    if (CalendarState.view === 'semana') {
      CalendarState.date.setDate(CalendarState.date.getDate() + 7);
    } else {
      CalendarState.date.setMonth(CalendarState.date.getMonth() + 1);
    }
    refresh(false);
  });

  $('#cal-today')?.addEventListener('click', () => {
    CalendarState.date = new Date();
    openDay(toDateKey(new Date()));
  });

  document.querySelectorAll('[data-cal-view]').forEach(tab => {
    tab.addEventListener('click', () => {
      CalendarState.view = tab.dataset.calView;
      CalendarState.focusDay = null;
      localStorage.setItem('cdm-cal-view', CalendarState.view);
      refresh(false);
    });
  });

  document.querySelectorAll('[data-cal-type]').forEach(chip => {
    chip.addEventListener('click', () => {
      CalendarState.typeFilter = chip.dataset.calType;
      refresh(false);
    });
  });

  document.querySelectorAll('[data-cal-owner]').forEach(chip => {
    chip.addEventListener('click', () => {
      CalendarState.ownerFilter = chip.dataset.calOwner;
      refresh(false);
    });
  });

  $('#cal-client-filter')?.addEventListener('change', (e) => {
    CalendarState.clientFilter = e.target.value;
    refresh(false);
  });

  document.querySelectorAll('[data-add-date]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const date = btn.dataset.addDate;
      import('./forms.js?v=20260628a').then(({ openCrudModal }) => {
        openCrudModal('tasks', { due_date: date }, () => refresh(true));
      });
    });
  });

  document.querySelectorAll('[data-cal-show-day]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDay(btn.dataset.calShowDay);
    });
  });

  document.querySelectorAll('[data-cal-collapse-day]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeFocus();
    });
  });

  document.querySelectorAll('[data-cal-day]').forEach(day => {
    day.addEventListener('click', (e) => {
      if (e.target.closest('[data-cal-item]')) return;
      if (e.target.closest('[data-add-date]')) return;
      if (e.target.closest('[data-cal-show-day]')) return;
      if (e.target.closest('[data-cal-collapse-day]')) return;
      toggleDay(day.dataset.date);
    });
    day.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleDay(day.dataset.date);
      }
    });
  });

  document.querySelectorAll('[data-cal-day-header]').forEach(header => {
    header.addEventListener('click', () => toggleDay(header.dataset.date));
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleDay(header.dataset.date);
      }
    });
  });

  const escHandler = (e) => {
    if (e.key !== 'Escape' || !CalendarState.focusDay) return;
    closeFocus();
  };
  if (CalendarState._escHandler) {
    document.removeEventListener('keydown', CalendarState._escHandler);
  }
  CalendarState._escHandler = escHandler;
  document.addEventListener('keydown', escHandler);

  document.querySelectorAll('[data-cal-day]').forEach(day => {
    day.addEventListener('dblclick', (e) => {
      if (e.target.closest('[data-cal-item]')) return;
      if (!canManageFlag) return;
      e.stopPropagation();
      const date = day.dataset.date;
      import('./forms.js?v=20260628a').then(({ openCrudModal }) => {
        openCrudModal('tasks', { due_date: date }, () => refresh(true));
      });
    });
  });

  bindCalItemClick(onRefresh);
  bindCalContextMenu(onRefresh);
  bindCalendarDragDrop(onRefresh);
}

function bindCalendarDragDrop(onRefresh) {
  if (!canManageFlag) return;

  const refresh = () => onRefresh({ reload: true });

  document.querySelectorAll('[data-cal-item][draggable="true"]').forEach(el => {
    el.addEventListener('dragstart', (e) => {
      CalendarState.blockItemClick = false;
      el.classList.add('cal-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/json', JSON.stringify({
        entity: el.dataset.edit,
        id: el.dataset.id,
        fromDate: el.dataset.calDate || ''
      }));
    });

    el.addEventListener('dragend', () => {
      el.classList.remove('cal-dragging');
      clearCalDropHighlights();
    });

    el.addEventListener('click', (e) => {
      if (!CalendarState.blockItemClick) return;
      e.preventDefault();
      e.stopPropagation();
      CalendarState.blockItemClick = false;
    }, true);
  });

  document.querySelectorAll('[data-cal-day]').forEach(zone => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      zone.classList.add('cal-drop-over');
    });

    zone.addEventListener('dragleave', (e) => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('cal-drop-over');
    });

    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('cal-drop-over');

      const targetDate = zone.dataset.date;
      if (!targetDate) return;

      let data;
      try {
        data = JSON.parse(e.dataTransfer.getData('application/json'));
      } catch { return; }

      if (data.fromDate === targetDate) return;

      try {
        await moveCalendarItem(data.entity, data.id, targetDate);
        CalendarState.blockItemClick = true;
        invalidatePrefix('calendar:');
        const label = parseLocalDate(targetDate).toLocaleDateString('pt-BR', {
          weekday: 'short', day: 'numeric', month: 'short'
        });
        showToast(`Movido para ${label}`, 'success');
        refresh();
      } catch (err) {
        handleError(err, 'Erro ao mover item');
      }
    });
  });
}
