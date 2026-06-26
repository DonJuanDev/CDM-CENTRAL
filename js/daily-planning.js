import { dailyPlansApi } from './api/crud.js?v=20260622a';
import { writeViewHash } from './router.js';
import { $, $$, showToast } from './utils.js';

function toDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date + 'T00:00:00');
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateKey(key) {
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return new Date();
  return new Date(key + 'T00:00:00');
}

function addDays(dateKey, delta) {
  const d = parseDateKey(dateKey);
  d.setDate(d.getDate() + delta);
  return toDateKey(d);
}

function isToday(dateKey) {
  return dateKey === toDateKey(new Date());
}

function isYesterday(dateKey) {
  return dateKey === addDays(toDateKey(new Date()), -1);
}

function formatDayLabel(dateKey) {
  if (isToday(dateKey)) return 'Hoje';
  if (isYesterday(dateKey)) return 'Ontem';
  return parseDateKey(dateKey).toLocaleDateString('pt-BR', {
    weekday: 'short', day: 'numeric', month: 'short'
  });
}

function formatFullDate(dateKey) {
  return parseDateKey(dateKey).toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

function dayHasContent(plan) {
  if (!plan) return false;
  const notes = (plan.notes || '').trim();
  const items = Array.isArray(plan.items) ? plan.items : [];
  return notes.length > 0 || items.some(i => (i.text || '').trim());
}

function buildDayList(plansByDate, selectedDate, daysBack = 21) {
  const keys = new Set();
  const today = toDateKey(new Date());
  for (let i = 0; i <= daysBack; i++) {
    keys.add(addDays(today, -i));
  }
  Object.keys(plansByDate).forEach(k => {
    if (dayHasContent(plansByDate[k])) keys.add(k);
  });
  return [...keys].sort((a, b) => b.localeCompare(a));
}

let saveTimer = null;
let saving = false;

export function bindDailyPlanningEvents({ profile, refresh }) {
  const userId = profile?.id;
  if (!userId) return;

  const root = $('#daily-plan-root');
  if (!root) return;

  let selectedDate = root.dataset.date || toDateKey(new Date());
  let plan = { notes: '', items: [] };

  function readPlanFromDom() {
    plan.items = $$('.daily-plan-item', root).map(el => ({
      id: el.dataset.itemId,
      text: el.querySelector('[data-item-text]')?.textContent.trim() || '',
      done: el.querySelector('[data-item-toggle]')?.checked || false
    }));
    plan.notes = $('#daily-plan-notes')?.value || '';
  }

  readPlanFromDom();

  function setSelectedDate(dateKey) {
    selectedDate = dateKey;
    writeViewHash('planejamento', { data: dateKey }, { replace: true });
    refresh();
  }

  async function persist({ silent = true } = {}) {
    if (saving) return;
    saving = true;
    const status = $('#daily-plan-status');
    if (status) status.textContent = 'Salvando...';

    try {
      const saved = await dailyPlansApi.upsert(userId, selectedDate, {
        notes: plan.notes,
        items: plan.items
      });
      if (status) {
        status.textContent = 'Salvo';
        setTimeout(() => {
          if (status.textContent === 'Salvo') status.textContent = '';
        }, 2000);
      }
      if (!silent) showToast('Planejamento salvo', 'success');
    } catch (e) {
      if (status) status.textContent = 'Erro ao salvar';
      showToast(e.message || 'Erro ao salvar', 'danger');
    } finally {
      saving = false;
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    const status = $('#daily-plan-status');
    if (status) status.textContent = '...';
    saveTimer = setTimeout(() => persist(), 700);
  }

  function renderItems() {
    const list = $('#daily-plan-items');
    if (!list) return;
    list.innerHTML = plan.items.length
      ? plan.items.map(item => `
        <div class="daily-plan-item${item.done ? ' is-done' : ''}" data-item-id="${item.id}">
          <label class="daily-plan-check">
            <input type="checkbox" data-item-toggle="${item.id}" ${item.done ? 'checked' : ''}>
            <span class="daily-plan-checkmark"></span>
          </label>
          <span class="daily-plan-item-text" contenteditable="true" data-item-text="${item.id}">${escapeHtml(item.text || '')}</span>
          <button type="button" class="btn btn-ghost btn-sm daily-plan-item-delete" data-item-delete="${item.id}" title="Remover">×</button>
        </div>`).join('')
      : '<p class="daily-plan-empty">Nenhuma tarefa ainda. Adicione abaixo.</p>';
    bindItemEvents();
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function bindItemEvents() {
    $$('[data-item-toggle]').forEach(cb => {
      cb.onchange = () => {
        const id = cb.dataset.itemToggle;
        plan.items = plan.items.map(i => i.id === id ? { ...i, done: cb.checked } : i);
        renderItems();
        persist();
      };
    });

    $$('[data-item-text]').forEach(el => {
      el.onblur = () => {
        const id = el.dataset.itemText;
        const text = el.textContent.trim();
        plan.items = plan.items.map(i => i.id === id ? { ...i, text } : i);
        if (!text) {
          plan.items = plan.items.filter(i => i.id !== id);
          renderItems();
        }
        scheduleSave();
      };
      el.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          el.blur();
          addItem('');
        }
      };
    });

    $$('[data-item-delete]').forEach(btn => {
      btn.onclick = () => {
        plan.items = plan.items.filter(i => i.id !== btn.dataset.itemDelete);
        renderItems();
        persist();
      };
    });
  }

  function addItem(text = '') {
    const item = { id: crypto.randomUUID(), text, done: false };
    plan.items.push(item);
    renderItems();
    const el = $(`[data-item-text="${item.id}"]`);
    if (el) {
      el.focus();
      if (!text) el.textContent = '';
    }
    if (text) persist();
  }

  $('#daily-plan-prev')?.addEventListener('click', () => setSelectedDate(addDays(selectedDate, -1)));
  $('#daily-plan-next')?.addEventListener('click', () => setSelectedDate(addDays(selectedDate, 1)));
  $('#daily-plan-today')?.addEventListener('click', () => setSelectedDate(toDateKey(new Date())));

  $('#daily-plan-date')?.addEventListener('change', (e) => {
    if (e.target.value) setSelectedDate(e.target.value);
  });

  $$('[data-plan-day]').forEach(btn => {
    btn.onclick = () => setSelectedDate(btn.dataset.planDay);
  });

  $('#daily-plan-add')?.addEventListener('click', () => addItem(''));
  $('#daily-plan-add-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = e.target.value.trim();
      if (!val) return;
      e.target.value = '';
      addItem(val);
    }
  });

  const notesEl = $('#daily-plan-notes');
  if (notesEl) {
    notesEl.oninput = () => {
      plan.notes = notesEl.value;
      scheduleSave();
    };
  }

  bindItemEvents();
}

export {
  toDateKey, parseDateKey, addDays, isToday, isYesterday,
  formatDayLabel, formatFullDate, dayHasContent, buildDayList
};
