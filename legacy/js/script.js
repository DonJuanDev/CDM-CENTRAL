/* ============================================
   CDM CENTRAL - Application Core
   ============================================ */

'use strict';

// --- State ---
const App = {
  data: null,
  currentView: 'dashboard',
  theme: localStorage.getItem('cdm-theme') || 'dark',
  sidebarCollapsed: localStorage.getItem('cdm-sidebar') === 'true',
  calendarDate: new Date(),
  calendarView: 'mes',
  tasksView: 'kanban',
  metricsPeriod: '30d',
  chatHistory: [],
  searchIndex: []
};

// --- Navigation Config ---
const NAV_ITEMS = [
  { id: 'dashboard', icon: '🏠', label: 'Dashboard' },
  { id: 'metricas', icon: '📊', label: 'Métricas' },
  { id: 'financeiro', icon: '💰', label: 'Financeiro' },
  { id: 'boletos', icon: '📄', label: 'Boletos' },
  { id: 'calendario', icon: '📅', label: 'Calendário' },
  { id: 'clientes', icon: '👥', label: 'Clientes' },
  { id: 'trafego', icon: '🎯', label: 'Tráfego Pago' },
  { id: 'redes', icon: '📱', label: 'Redes Sociais' },
  { id: 'producao', icon: '🎥', label: 'Produção Audiovisual' },
  { id: 'design', icon: '🎨', label: 'Design' },
  { id: 'arquivos', icon: '📁', label: 'Arquivos' },
  { id: 'notas', icon: '📝', label: 'Notas' },
  { id: 'tarefas', icon: '✅', label: 'Tarefas' },
  { id: 'comercial', icon: '📞', label: 'Comercial' },
  { id: 'relatorios', icon: '📈', label: 'Relatórios' },
  { id: 'executivo', icon: '👔', label: 'Área Executiva' },
  { id: 'ia', icon: '🤖', label: 'IA CDM' },
  { id: 'configuracoes', icon: '⚙️', label: 'Configurações' }
];

// --- Utilities ---
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

const formatCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const formatNumber = (v) => new Intl.NumberFormat('pt-BR').format(v);
const formatPercent = (v) => `${v}%`;

const formatDate = (d) => {
  const date = new Date(d + 'T00:00:00');
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatDateShort = (d) => {
  const date = new Date(d + 'T00:00:00');
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
};

const statusBadge = (status) => {
  const map = {
    pago: 'success', pendente: 'warning', atrasado: 'danger', cancelado: 'neutral',
    futuro: 'info', ativo: 'success', risco: 'danger', concluida: 'success',
    em_progresso: 'info', pendente_t: 'warning', confirmado: 'success',
    planejado: 'neutral', em_andamento: 'info', aprovado: 'success',
    revisao: 'warning', gravacao: 'info', em_edicao: 'info', ativa: 'success',
    gerado: 'success', lead: 'neutral', contato: 'info', reuniao: 'accent',
    proposta: 'warning', negociacao: 'warning', fechado: 'success', perdido: 'danger'
  };
  const labels = {
    em_progresso: 'Em Progresso', a_fazer: 'A Fazer', concluido: 'Concluído',
    em_edicao: 'Em Edição', nao_iniciada: 'Não Iniciada', pendente_t: 'Pendente'
  };
  const cls = map[status] || 'neutral';
  const label = labels[status] || status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
  return `<span class="badge badge-${cls}">${label}</span>`;
};

const priorityBadge = (p) => {
  const map = { alta: 'danger', media: 'warning', baixa: 'success' };
  return `<span class="badge badge-${map[p] || 'neutral'}">${p.charAt(0).toUpperCase() + p.slice(1)}</span>`;
};

const showToast = (msg, type = 'info') => {
  const container = $('#toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
};

// --- Chart Engine (Canvas) ---
const Charts = {
  drawLine(canvas, labels, datasets, options = {}) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width, H = rect.height;
    const pad = { top: 20, right: 20, bottom: 40, left: 60 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top - pad.bottom;

    ctx.clearRect(0, 0, W, H);

    const allValues = datasets.flatMap(d => d.data);
    const maxVal = Math.max(...allValues) * 1.1 || 1;
    const minVal = Math.min(0, Math.min(...allValues));
    const range = maxVal - minVal || 1;

    const style = getComputedStyle(document.documentElement);
    const gridColor = style.getPropertyValue('--border-color').trim();
    const textColor = style.getPropertyValue('--text-tertiary').trim();

    // Grid
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(W - pad.right, y);
      ctx.stroke();

      const val = maxVal - (range / 4) * i;
      ctx.fillStyle = textColor;
      ctx.font = '11px Inter, sans-serif';
      ctx.textAlign = 'right';
      const display = options.currency ? formatCurrency(val).replace('R$', 'R$') : formatNumber(Math.round(val));
      ctx.fillText(display.length > 10 ? `${Math.round(val / 1000)}k` : display, pad.left - 8, y + 4);
    }

    // Labels
    labels.forEach((label, i) => {
      const x = pad.left + (chartW / (labels.length - 1 || 1)) * i;
      ctx.fillStyle = textColor;
      ctx.font = '11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, x, H - 10);
    });

    // Lines
    const colors = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444'];
    datasets.forEach((ds, di) => {
      ctx.strokeStyle = ds.color || colors[di % colors.length];
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();

      ds.data.forEach((val, i) => {
        const x = pad.left + (chartW / (ds.data.length - 1 || 1)) * i;
        const y = pad.top + chartH - ((val - minVal) / range) * chartH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Area fill
      if (options.fill) {
        const lastX = pad.left + chartW;
        ctx.lineTo(lastX, pad.top + chartH);
        ctx.lineTo(pad.left, pad.top + chartH);
        ctx.closePath();
        ctx.fillStyle = (ds.color || colors[di % colors.length]) + '18';
        ctx.fill();
      }

      // Dots
      ds.data.forEach((val, i) => {
        const x = pad.left + (chartW / (ds.data.length - 1 || 1)) * i;
        const y = pad.top + chartH - ((val - minVal) / range) * chartH;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = ds.color || colors[di % colors.length];
        ctx.fill();
      });
    });
  },

  drawBar(canvas, labels, data, options = {}) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width, H = rect.height;
    const pad = { top: 20, right: 20, bottom: 40, left: 60 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top - pad.bottom;

    ctx.clearRect(0, 0, W, H);

    const maxVal = Math.max(...data) * 1.1 || 1;
    const barW = (chartW / data.length) * 0.6;
    const gap = chartW / data.length;

    const style = getComputedStyle(document.documentElement);
    const textColor = style.getPropertyValue('--text-tertiary').trim();

    data.forEach((val, i) => {
      const barH = (val / maxVal) * chartH;
      const x = pad.left + gap * i + (gap - barW) / 2;
      const y = pad.top + chartH - barH;

      const gradient = ctx.createLinearGradient(x, y, x, pad.top + chartH);
      gradient.addColorStop(0, options.color || '#6366f1');
      gradient.addColorStop(1, (options.color || '#6366f1') + '66');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, [4, 4, 0, 0]);
      ctx.fill();

      ctx.fillStyle = textColor;
      ctx.font = '11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(labels[i], x + barW / 2, H - 10);
    });
  }
};

// --- Search Index ---
function buildSearchIndex() {
  const d = App.data;
  if (!d) return;
  App.searchIndex = [];

  d.clientes?.forEach(c => App.searchIndex.push({ type: 'Cliente', icon: '👥', title: c.empresa, desc: c.responsavel, view: 'clientes', id: c.id }));
  d.tarefas?.forEach(t => App.searchIndex.push({ type: 'Tarefa', icon: '✅', title: t.titulo, desc: t.responsavel, view: 'tarefas', id: t.id }));
  d.boletos?.forEach(b => App.searchIndex.push({ type: 'Boleto', icon: '📄', title: `${b.cliente} - ${formatCurrency(b.valor)}`, desc: b.status, view: 'boletos', id: b.id }));
  d.calendario?.forEach(e => App.searchIndex.push({ type: 'Evento', icon: '📅', title: e.titulo, desc: formatDate(e.data), view: 'calendario', id: e.id }));
  d.comercial?.funil?.forEach(l => App.searchIndex.push({ type: 'Lead', icon: '📞', title: l.nome, desc: l.etapa, view: 'comercial', id: l.id }));
  d.trafegoPago?.campanhas?.forEach(c => App.searchIndex.push({ type: 'Campanha', icon: '🎯', title: c.nome, desc: c.cliente, view: 'trafego', id: c.id }));
  d.notas?.forEach(n => App.searchIndex.push({ type: 'Nota', icon: '📝', title: n.titulo, desc: n.autor, view: 'notas', id: n.id }));
}

function search(query) {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  return App.searchIndex.filter(item =>
    item.title.toLowerCase().includes(q) ||
    item.desc.toLowerCase().includes(q) ||
    item.type.toLowerCase().includes(q)
  ).slice(0, 10);
}

// --- View Renderers ---
const Views = {
  dashboard() {
    const d = App.data.dashboard;
    const meta = App.data.config.metaMensal;
    return `
      <div class="page-header">
        <h1 class="page-title">Dashboard</h1>
        <p class="page-subtitle">Visão geral da operação — ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
      </div>

      <div class="grid grid-auto" style="margin-bottom:24px">
        ${metricCard('Receita do Mês', formatCurrency(d.receitaMes), '💰', 'green', '+12% vs mês anterior')}
        ${metricCard('Lucro do Mês', formatCurrency(d.lucroMes), '📈', 'purple', '+8% vs mês anterior')}
        ${metricCard('Boletos Pendentes', d.boletosPendentes, '📄', 'yellow')}
        ${metricCard('Clientes Ativos', d.clientesAtivos, '👥', 'blue')}
        ${metricCard('Clientes em Risco', d.clientesRisco, '⚠️', 'red')}
        ${metricCard('Projetos em Andamento', d.projetosAndamento, '🚀', 'purple')}
        ${metricCard('Campanhas Ativas', d.campanhasAtivas, '🎯', 'blue')}
        ${metricCard('Leads Gerados', formatNumber(d.leadsGerados), '📊', 'green')}
        ${metricCard('ROAS Médio', `${d.roasMedio}x`, '📈', 'green')}
        ${metricCard('ROI Médio', formatPercent(d.roiMedio), '💹', 'purple')}
        ${metricCard('Investimento Ads', formatCurrency(d.investimentoAnuncios), '💸', 'yellow')}
      </div>

      <div class="widget-grid" style="margin-bottom:24px">
        <div class="widget-wide">
          <div class="chart-container">
            <div class="chart-header">
              <span class="chart-title">Receita vs Investimento</span>
            </div>
            <canvas class="chart-canvas" id="chart-receita"></canvas>
          </div>
        </div>
        <div class="widget">
          <div class="card" style="height:100%">
            <div class="card-header"><span class="card-title">Meta Mensal</span></div>
            <div class="card-value">${formatCurrency(meta)}</div>
            <div class="card-change positive">${d.percentualMeta}% atingido</div>
            <div class="progress-bar"><div class="progress-fill" style="width:${d.percentualMeta}%"></div></div>
            <p style="margin-top:12px;font-size:13px;color:var(--text-secondary)">Faltam ${formatCurrency(meta - d.receitaMes)} para a meta</p>
          </div>
        </div>
      </div>

      <div class="two-col">
        <div>
          <div class="section">
            <div class="section-header"><span class="section-title">Alertas Importantes</span></div>
            <div class="card" style="padding:0">
              ${App.data.alertas.map(a => `
                <div class="alert-item" style="border:none;border-radius:0;border-bottom:1px solid var(--border-color)">
                  <div class="alert-dot ${a.tipo}"></div>
                  <div>
                    <div style="font-weight:500;font-size:13px">${a.titulo}</div>
                    <div style="font-size:12px;color:var(--text-tertiary);margin-top:2px">${a.descricao}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
          <div class="section">
            <div class="section-header"><span class="section-title">Últimas Tarefas</span></div>
            <div class="card" style="padding:0">
              ${App.data.tarefasRecentes.map(t => `
                <div class="list-item" data-view="tarefas">
                  <div class="list-item-icon" style="background:var(--accent-subtle)">✅</div>
                  <div class="list-item-content">
                    <div class="list-item-title">${t.titulo}</div>
                    <div class="list-item-desc">${t.responsavel} · ${formatDateShort(t.prazo)}</div>
                  </div>
                  ${statusBadge(t.status === 'pendente' ? 'pendente_t' : t.status)}
                </div>
              `).join('')}
            </div>
          </div>
        </div>
        <div>
          <div class="section">
            <div class="section-header"><span class="section-title">Calendário do Dia</span></div>
            <div class="card" style="padding:0">
              ${App.data.reunioes.map(r => `
                <div class="list-item">
                  <div class="list-item-icon" style="background:var(--info-subtle)">📅</div>
                  <div class="list-item-content">
                    <div class="list-item-title">${r.titulo}</div>
                    <div class="list-item-desc">${r.cliente} · ${r.tipo}</div>
                  </div>
                  <div class="list-item-meta">${r.hora}</div>
                </div>
              `).join('')}
            </div>
          </div>
          <div class="section">
            <div class="chart-container">
              <div class="chart-header"><span class="chart-title">Leads por Mês</span></div>
              <canvas class="chart-canvas" id="chart-leads" style="height:180px"></canvas>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  metricas() {
    const m = App.data.metricas.dados[App.metricsPeriod] || App.data.metricas.dados['30d'];
    const metrics = [
      ['Impressões', formatNumber(m.impressoes)], ['Alcance', formatNumber(m.alcance)],
      ['Cliques', formatNumber(m.cliques)], ['CTR', `${m.ctr}%`],
      ['CPM', formatCurrency(m.cpm)], ['CPC', formatCurrency(m.cpc)],
      ['CPA', formatCurrency(m.cpa)], ['Leads', formatNumber(m.leads)],
      ['Conversões', formatNumber(m.conversoes)], ['ROAS', `${m.roas}x`],
      ['ROI', formatPercent(m.roi)], ['Faturamento', formatCurrency(m.faturamento)],
      ['Custo', formatCurrency(m.custo)], ['Lucro', formatCurrency(m.lucro)],
      ['Engajamento', `${m.engajamento}%`], ['Seguidores', formatNumber(m.seguidores)],
      ['Visualizações', formatNumber(m.visualizacoes)], ['Tempo Sessão', m.tempoSessao],
      ['Taxa Rejeição', `${m.taxaRejeicao}%`], ['Taxa Conversão', `${m.taxaConversao}%`]
    ];
    return `
      <div class="page-header">
        <h1 class="page-title">Central de Métricas</h1>
        <p class="page-subtitle">Dados consolidados de todas as integrações</p>
        <div class="tabs" id="metrics-tabs">
          ${['hoje','ontem','7d','30d','90d','1a'].map(p => `
            <button class="tab ${App.metricsPeriod === p ? 'active' : ''}" data-period="${p}">${{hoje:'Hoje',ontem:'Ontem','7d':'7 dias','30d':'30 dias','90d':'90 dias','1a':'1 ano'}[p]}</button>
          `).join('')}
        </div>
      </div>

      <div class="grid grid-auto" style="margin-bottom:24px">
        ${metrics.map(([label, val]) => metricCard(label, val, '', 'purple')).join('')}
      </div>

      <div class="widget-grid" style="margin-bottom:24px">
        <div class="widget-wide">
          <div class="chart-container">
            <div class="chart-header"><span class="chart-title">Evolução de Receita</span></div>
            <canvas class="chart-canvas" id="chart-metric-receita"></canvas>
          </div>
        </div>
        <div class="widget-wide">
          <div class="chart-container">
            <div class="chart-header"><span class="chart-title">ROAS Mensal</span></div>
            <canvas class="chart-canvas" id="chart-metric-roas"></canvas>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-header"><span class="section-title">Integrações Conectadas</span></div>
        <div class="integration-grid">
          ${App.data.metricas.integracoes.map(name => `
            <div class="integration-card connected">
              <div style="font-size:24px">${integrationIcon(name)}</div>
              <div class="integration-name">${name}</div>
              <div class="integration-status">● Conectado</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  },

  financeiro() {
    const f = App.data.financeiro;
    const totalReceitas = f.receitas.reduce((s, r) => s + r.valor, 0);
    const totalDespesas = f.despesas.reduce((s, r) => s + r.valor, 0);
    return `
      <div class="page-header">
        <h1 class="page-title">Financeiro</h1>
        <p class="page-subtitle">Gestão financeira completa da agência</p>
        <div class="page-actions">
          <button class="btn btn-primary">+ Nova Receita</button>
          <button class="btn btn-secondary">+ Nova Despesa</button>
        </div>
      </div>

      <div class="grid grid-4" style="margin-bottom:24px">
        ${metricCard('Receitas', formatCurrency(totalReceitas), '💰', 'green')}
        ${metricCard('Despesas', formatCurrency(totalDespesas), '💸', 'red')}
        ${metricCard('Saldo', formatCurrency(totalReceitas - totalDespesas), '📊', 'purple')}
        ${metricCard('Lucro Líquido', formatCurrency(f.dre.lucroLiquido), '📈', 'green')}
      </div>

      <div class="widget-grid" style="margin-bottom:24px">
        <div class="widget-wide">
          <div class="chart-container">
            <div class="chart-header"><span class="chart-title">Fluxo de Caixa</span></div>
            <canvas class="chart-canvas" id="chart-fluxo"></canvas>
          </div>
        </div>
        <div class="widget-wide">
          <div class="card">
            <div class="card-header"><span class="card-title">DRE Simplificada</span></div>
            ${dreRow('Receita Bruta', f.dre.receitaBruta)}
            ${dreRow('(-) Deduções', f.dre.deducoes, true)}
            ${dreRow('Receita Líquida', f.dre.receitaLiquida)}
            ${dreRow('(-) Custos Variáveis', f.dre.custosVariaveis, true)}
            ${dreRow('Margem de Contribuição', f.dre.margemContribuicao)}
            ${dreRow('(-) Custos Fixos', f.dre.custosFixos, true)}
            ${dreRow('Lucro Operacional', f.dre.lucroOperacional)}
            ${dreRow('Lucro Líquido', f.dre.lucroLiquido, false, true)}
          </div>
        </div>
      </div>

      <div class="tabs" id="fin-tabs">
        <button class="tab active" data-fin="receitas">Receitas</button>
        <button class="tab" data-fin="despesas">Despesas</button>
        <button class="tab" data-fin="mensalidades">Mensalidades</button>
        <button class="tab" data-fin="comissoes">Comissões</button>
        <button class="tab" data-fin="prolabore">Pró-labore</button>
      </div>
      <div id="fin-content">
        ${finTable('receitas', f.receitas, ['descricao','valor','data','categoria','cliente'])}
      </div>
    `;
  },

  boletos() {
    const b = App.data.boletos;
    const counts = { pago: 0, pendente: 0, atrasado: 0, futuro: 0, cancelado: 0 };
    b.forEach(x => counts[x.status] = (counts[x.status] || 0) + 1);
    return `
      <div class="page-header">
        <h1 class="page-title">Boletos</h1>
        <p class="page-subtitle">Gestão de cobranças e boletos bancários</p>
        <div class="page-actions">
          <button class="btn btn-primary" id="btn-novo-boleto">+ Emitir Boleto</button>
        </div>
      </div>

      <div class="grid grid-5" style="margin-bottom:24px">
        ${metricCard('Emitidos', b.length, '📄', 'blue')}
        ${metricCard('Pagos', counts.pago, '✅', 'green')}
        ${metricCard('Pendentes', counts.pendente, '⏳', 'yellow')}
        ${metricCard('Vencidos', counts.atrasado, '⚠️', 'red')}
        ${metricCard('Futuros', counts.futuro, '📅', 'purple')}
      </div>

      <div class="filter-bar">
        <button class="btn btn-sm btn-secondary filter-boleto active" data-filter="all">Todos</button>
        ${['pago','pendente','atrasado','futuro','cancelado'].map(s => `
          <button class="btn btn-sm btn-ghost filter-boleto" data-filter="${s}">${s.charAt(0).toUpperCase() + s.slice(1)}</button>
        `).join('')}
      </div>

      <div class="table-wrapper">
        <table>
          <thead><tr><th>Cliente</th><th>Valor</th><th>Vencimento</th><th>Status</th><th>Ações</th></tr></thead>
          <tbody id="boletos-tbody">
            ${b.map(x => boletoRow(x)).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  calendario() {
    const events = App.data.calendario;
    const now = App.calendarDate;
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthName = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrev = new Date(year, month, 0).getDate();

    let days = '';
    for (let i = firstDay - 1; i >= 0; i--) {
      days += `<div class="calendar-day other-month"><div class="calendar-day-number">${daysInPrev - i}</div></div>`;
    }
    const today = new Date();
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayEvents = events.filter(e => e.data === dateStr);
      const isToday = today.getDate() === d && today.getMonth() === month && today.getFullYear() === year;
      days += `<div class="calendar-day ${isToday ? 'today' : ''}" data-date="${dateStr}">
        <div class="calendar-day-number">${d}</div>
        ${dayEvents.map(e => `<div class="calendar-event ${e.prioridade === 'alta' ? 'alta' : ''}" data-event="${e.id}">${e.titulo}</div>`).join('')}
      </div>`;
    }
    const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
    for (let d = 1; d <= totalCells - firstDay - daysInMonth; d++) {
      days += `<div class="calendar-day other-month"><div class="calendar-day-number">${d}</div></div>`;
    }

    return `
      <div class="page-header">
        <h1 class="page-title">Calendário</h1>
        <p class="page-subtitle">Estilo Notion — eventos, tarefas e reuniões</p>
      </div>

      <div class="calendar-toolbar">
        <div class="calendar-nav">
          <button class="btn btn-icon btn-secondary" id="cal-prev">‹</button>
          <span class="calendar-month">${monthName}</span>
          <button class="btn btn-icon btn-secondary" id="cal-next">›</button>
          <button class="btn btn-sm btn-secondary" id="cal-today">Hoje</button>
        </div>
        <div class="tabs">
          ${['mes','semana','dia','agenda'].map(v => `
            <button class="tab ${App.calendarView === v ? 'active' : ''}" data-cal-view="${v}">${v.charAt(0).toUpperCase() + v.slice(1)}</button>
          `).join('')}
        </div>
        <button class="btn btn-primary">+ Novo Evento</button>
      </div>

      <div class="calendar-grid">
        ${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(d => `<div class="calendar-day-header">${d}</div>`).join('')}
        ${days}
      </div>
    `;
  },

  clientes() {
    return `
      <div class="page-header">
        <h1 class="page-title">CRM de Clientes</h1>
        <p class="page-subtitle">${App.data.clientes.length} clientes cadastrados</p>
        <div class="page-actions">
          <button class="btn btn-primary">+ Novo Cliente</button>
        </div>
      </div>

      <div class="grid grid-auto">
        ${App.data.clientes.map(c => `
          <div class="card cliente-card" data-cliente="${c.id}" style="cursor:pointer">
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px">
              <div>
                <div style="font-size:16px;font-weight:600">${c.empresa}</div>
                <div style="font-size:13px;color:var(--text-secondary);margin-top:2px">${c.responsavel}</div>
              </div>
              ${statusBadge(c.status)}
            </div>
            <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">
              📧 ${c.email}<br>📱 ${c.telefone}
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:18px;font-weight:700;color:var(--accent)">${formatCurrency(c.mensalidade)}<span style="font-size:11px;font-weight:400;color:var(--text-tertiary)">/mês</span></span>
              <span class="tag">${c.contrato}</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  },

  trafego() {
    const camps = App.data.trafegoPago.campanhas;
    return `
      <div class="page-header">
        <h1 class="page-title">Tráfego Pago</h1>
        <p class="page-subtitle">${camps.length} campanhas ativas</p>
        <div class="page-actions"><button class="btn btn-primary">+ Nova Campanha</button></div>
      </div>

      <div class="table-wrapper">
        <table>
          <thead><tr><th>Campanha</th><th>Cliente</th><th>Plataforma</th><th>Budget</th><th>Gasto</th><th>ROAS</th><th>Leads</th><th>CPA</th><th>Status</th></tr></thead>
          <tbody>
            ${camps.map(c => `
              <tr>
                <td style="font-weight:500">${c.nome}</td>
                <td>${c.cliente}</td>
                <td><span class="tag">${c.plataforma}</span></td>
                <td>${formatCurrency(c.budget)}</td>
                <td>${formatCurrency(c.gasto)}</td>
                <td style="font-weight:600;color:${c.roas >= 3 ? 'var(--success)' : 'var(--danger)'}">${c.roas}x</td>
                <td>${c.leads}</td>
                <td>${formatCurrency(c.cpa)}</td>
                <td>${statusBadge(c.status)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  redes() {
    return `
      <div class="page-header">
        <h1 class="page-title">Redes Sociais</h1>
        <p class="page-subtitle">Performance consolidada por cliente</p>
      </div>
      ${App.data.redesSociais.contas.map(conta => `
        <div class="card" style="margin-bottom:16px">
          <div class="card-header"><span class="card-title" style="font-size:16px;font-weight:600;color:var(--text-primary)">${conta.cliente}</span></div>
          <div class="grid grid-3">
            ${Object.entries(conta).filter(([k]) => k !== 'cliente').map(([rede, data]) => `
              <div style="padding:12px;background:var(--bg-tertiary);border-radius:var(--radius-md)">
                <div style="font-weight:600;text-transform:capitalize;margin-bottom:8px">${rede}</div>
                <div class="stat-row"><span class="stat-row-label">Seguidores</span><span class="stat-row-value">${formatNumber(data.seguidores)}</span></div>
                <div class="stat-row"><span class="stat-row-label">Engajamento</span><span class="stat-row-value">${data.engajamento}%</span></div>
                ${data.posts ? `<div class="stat-row"><span class="stat-row-label">Posts</span><span class="stat-row-value">${data.posts}</span></div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    `;
  },

  producao() {
    const tipos = { reels: '🎬', stories: '📱', anuncio: '📺', institucional: '🏢', gravacao: '🎥', edicao: '✂️' };
    return `
      <div class="page-header">
        <h1 class="page-title">Produção Audiovisual</h1>
        <p class="page-subtitle">Gravações, edições e aprovações</p>
        <div class="page-actions"><button class="btn btn-primary">+ Nova Produção</button></div>
      </div>
      <div class="grid grid-auto">
        ${App.data.producao.map(p => `
          <div class="card" style="cursor:pointer">
            <div style="display:flex;justify-content:space-between;margin-bottom:12px">
              <span style="font-size:24px">${tipos[p.tipo] || '🎥'}</span>
              ${statusBadge(p.status)}
            </div>
            <div style="font-size:15px;font-weight:600;margin-bottom:4px">${p.titulo}</div>
            <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:12px">${p.cliente} · ${p.tipo}</div>
            <div class="stat-row"><span class="stat-row-label">Responsável</span><span class="stat-row-value">${p.responsavel}</span></div>
            <div class="stat-row"><span class="stat-row-label">Versões</span><span class="stat-row-value">${p.versoes}</span></div>
            <div class="stat-row"><span class="stat-row-label">Prazo</span><span class="stat-row-value">${formatDateShort(p.prazo)}</span></div>
            <div class="stat-row"><span class="stat-row-label">Aprovação</span><span class="stat-row-value">${statusBadge(p.aprovacao === 'nao_iniciada' ? 'pendente_t' : p.aprovacao)}</span></div>
          </div>
        `).join('')}
      </div>
    `;
  },

  design() {
    const tipos = { carrossel: '🎠', banner: '🖼️', landing: '🌐', post: '📸', criativo: '🎨', miniatura: '▶️' };
    return `
      <div class="page-header">
        <h1 class="page-title">Design</h1>
        <p class="page-subtitle">Posts, carrosséis, banners e landing pages</p>
        <div class="page-actions">
          <button class="btn btn-primary">+ Novo Design</button>
          <button class="btn btn-secondary">Abrir Canva</button>
        </div>
      </div>
      <div class="grid grid-auto">
        ${App.data.design.map(d => `
          <div class="card" style="cursor:pointer">
            <div style="height:120px;background:var(--bg-tertiary);border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;font-size:48px;margin-bottom:12px">${tipos[d.tipo] || '🎨'}</div>
            <div style="font-weight:600;margin-bottom:4px">${d.titulo}</div>
            <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:8px">${d.cliente} · ${d.tipo} · v${d.versoes}</div>
            <div style="display:flex;justify-content:space-between;align-items:center">
              ${statusBadge(d.status)}
              ${d.canva ? '<span class="tag">Canva</span>' : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  },

  arquivos() {
    return `
      <div class="page-header">
        <h1 class="page-title">Central de Arquivos</h1>
        <p class="page-subtitle">Pastas por cliente — PDF, vídeo, imagem, ZIP</p>
        <div class="page-actions">
          <button class="btn btn-primary">+ Upload</button>
          <button class="btn btn-secondary">Nova Pasta</button>
        </div>
      </div>
      ${renderFileTree(App.data.arquivos)}
    `;
  },

  notas() {
    return `
      <div class="page-header">
        <h1 class="page-title">Notas</h1>
        <p class="page-subtitle">Anotações e documentação interna</p>
        <div class="page-actions"><button class="btn btn-primary">+ Nova Nota</button></div>
      </div>
      <div class="grid grid-3">
        ${App.data.notas.map(n => `
          <div class="note-card">
            <div class="note-card-title">${n.titulo}</div>
            <div class="note-card-content">${n.conteudo}</div>
            <div class="note-tags">${n.tags.map(t => `<span class="note-tag">${t}</span>`).join('')}</div>
            <div style="margin-top:12px;font-size:11px;color:var(--text-tertiary)">${n.autor} · ${formatDateShort(n.data)}</div>
          </div>
        `).join('')}
      </div>
    `;
  },

  tarefas() {
    const cols = {
      a_fazer: { title: 'A Fazer', color: 'var(--text-tertiary)' },
      em_progresso: { title: 'Em Progresso', color: 'var(--info)' },
      concluido: { title: 'Concluído', color: 'var(--success)' }
    };
    return `
      <div class="page-header">
        <h1 class="page-title">Tarefas</h1>
        <p class="page-subtitle">Gestão estilo ClickUp + Notion</p>
        <div class="page-actions">
          <button class="btn btn-primary">+ Nova Tarefa</button>
        </div>
      </div>
      <div class="tabs" id="tasks-tabs">
        <button class="tab ${App.tasksView === 'kanban' ? 'active' : ''}" data-task-view="kanban">Kanban</button>
        <button class="tab ${App.tasksView === 'lista' ? 'active' : ''}" data-task-view="lista">Lista</button>
        <button class="tab" data-task-view="cronograma">Cronograma</button>
        <button class="tab" data-task-view="calendario">Calendário</button>
      </div>
      <div id="tasks-content">
        ${App.tasksView === 'kanban' ? `
          <div class="kanban">
            ${Object.entries(cols).map(([key, col]) => {
              const tasks = App.data.tarefas.filter(t => t.coluna === key);
              return `
                <div class="kanban-column">
                  <div class="kanban-column-header">
                    <span class="kanban-column-title"><span class="priority-dot ${key === 'concluido' ? 'baixa' : key === 'em_progresso' ? 'media' : 'alta'}" style="background:${col.color}"></span> ${col.title}</span>
                    <span class="kanban-count">${tasks.length}</span>
                  </div>
                  ${tasks.map(t => `
                    <div class="kanban-card" data-task="${t.id}">
                      <div class="kanban-card-title">${t.titulo}</div>
                      <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:8px">${t.cliente}</div>
                      <div class="kanban-card-meta">
                        <span>${priorityBadge(t.prioridade)}</span>
                        <span>${formatDateShort(t.prazo)}</span>
                      </div>
                    </div>
                  `).join('')}
                </div>
              `;
            }).join('')}
          </div>
        ` : renderTasksList()}
      </div>
    `;
  },

  comercial() {
    const etapas = App.data.comercial.etapas;
    const labels = { lead: 'Lead', contato: 'Contato', reuniao: 'Reunião', proposta: 'Proposta', negociacao: 'Negociação', fechado: 'Fechado', perdido: 'Perdido' };
    return `
      <div class="page-header">
        <h1 class="page-title">Comercial</h1>
        <p class="page-subtitle">Funil de vendas e pipeline</p>
        <div class="page-actions"><button class="btn btn-primary">+ Novo Lead</button></div>
      </div>
      <div class="pipeline">
        ${etapas.map(etapa => {
          const leads = App.data.comercial.funil.filter(l => l.etapa === etapa);
          const total = leads.reduce((s, l) => s + l.valor, 0);
          return `
            <div class="pipeline-stage">
              <div class="pipeline-stage-header">${labels[etapa]} (${leads.length}) — ${formatCurrency(total)}</div>
              ${leads.map(l => `
                <div class="pipeline-card">
                  <div class="pipeline-card-name">${l.nome}</div>
                  <div style="font-size:12px;color:var(--text-tertiary);margin:4px 0">${l.contato}</div>
                  <div class="pipeline-card-value">${formatCurrency(l.valor)}</div>
                  <div style="font-size:10px;color:var(--text-tertiary);margin-top:4px">${l.origem}</div>
                </div>
              `).join('')}
            </div>
          `;
        }).join('')}
      </div>
    `;
  },

  relatorios() {
    return `
      <div class="page-header">
        <h1 class="page-title">Relatórios</h1>
        <p class="page-subtitle">Geração automática de PDF, Excel, CSV e PowerPoint</p>
        <div class="page-actions">
          <button class="btn btn-primary" id="btn-gerar-relatorio">Gerar Relatório</button>
        </div>
      </div>
      <div class="table-wrapper">
        <table>
          <thead><tr><th>Título</th><th>Tipo</th><th>Cliente</th><th>Data</th><th>Formato</th><th>Status</th><th>Ações</th></tr></thead>
          <tbody>
            ${App.data.relatorios.map(r => `
              <tr>
                <td style="font-weight:500">${r.titulo}</td>
                <td><span class="tag">${r.tipo}</span></td>
                <td>${r.cliente}</td>
                <td>${formatDateShort(r.data)}</td>
                <td><span class="badge badge-neutral">${r.formato.toUpperCase()}</span></td>
                <td>${statusBadge(r.status)}</td>
                <td>
                  <button class="btn btn-sm btn-ghost btn-download" data-format="${r.formato}">Download</button>
                  <button class="btn btn-sm btn-ghost btn-share">Compartilhar</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  executivo() {
    const e = App.data.executivo;
    return `
      <div class="page-header">
        <h1 class="page-title">Área Executiva</h1>
        <p class="page-subtitle">Painel exclusivo para diretoria</p>
      </div>

      <div class="grid grid-auto" style="margin-bottom:24px">
        ${metricCard('Receita Total', formatCurrency(e.receitaTotal), '💰', 'green')}
        ${metricCard('MRR', formatCurrency(e.mrr), '📊', 'purple')}
        ${metricCard('Lucro Líquido', formatCurrency(e.lucroLiquido), '📈', 'green')}
        ${metricCard('Clientes Ativos', e.clientesAtivos, '👥', 'blue')}
        ${metricCard('Churn', `${e.churn}%`, '📉', 'red')}
        ${metricCard('LTV', formatCurrency(e.ltv), '💎', 'purple')}
        ${metricCard('CAC', formatCurrency(e.cac), '🎯', 'yellow')}
        ${metricCard('ROI Geral', formatPercent(e.roiGeral), '💹', 'green')}
      </div>

      <div class="grid grid-3">
        <div class="card">
          <div class="card-header"><span class="card-title">Ranking de Clientes</span></div>
          ${e.rankingClientes.map((c, i) => rankingItem(i + 1, c.nome, `ROAS ${c.roas}x`, formatCurrency(c.receita))).join('')}
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Ranking de Campanhas</span></div>
          ${e.rankingCampanhas.map((c, i) => rankingItem(i + 1, c.nome, `${c.leads} leads`, `${c.roas}x ROAS`)).join('')}
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Ranking de Colaboradores</span></div>
          ${e.rankingColaboradores.map((c, i) => rankingItem(i + 1, c.nome, `${c.tarefas} tarefas`, `${c.satisfacao}%`)).join('')}
        </div>
      </div>
    `;
  },

  ia() {
    const suggestions = [
      'Criar copy para anúncio Meta Ads',
      'Analisar métricas do mês',
      'Gerar roteiro para Reels',
      'Sugerir melhorias de ROAS',
      'Criar relatório executivo'
    ];
    return `
      <div class="page-header">
        <h1 class="page-title">IA CDM</h1>
        <p class="page-subtitle">Assistente inteligente de marketing</p>
      </div>
      <div class="card chat-container">
        <div class="chat-messages" id="chat-messages">
          ${App.chatHistory.map(m => `
            <div class="chat-message ${m.role}">${m.content}</div>
          `).join('')}
        </div>
        <div class="chat-suggestions">
          ${suggestions.map(s => `<button class="chat-suggestion" data-suggestion="${s}">${s}</button>`).join('')}
        </div>
        <div class="chat-input-area">
          <textarea class="chat-input" id="chat-input" placeholder="Pergunte qualquer coisa sobre marketing..." rows="1"></textarea>
          <button class="btn btn-primary" id="chat-send">Enviar</button>
        </div>
      </div>
    `;
  },

  configuracoes() {
    return `
      <div class="page-header">
        <h1 class="page-title">Configurações</h1>
        <p class="page-subtitle">Preferências do sistema</p>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Aparência</div>
        <div class="settings-row">
          <div><div class="settings-label">Tema escuro</div><div class="settings-desc">Alternar entre dark e light mode</div></div>
          <div class="toggle ${App.theme === 'dark' ? 'active' : ''}" id="settings-theme"></div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Notificações</div>
        ${['Boletos vencendo', 'Campanhas com queda', 'ROAS abaixo da meta', 'Cliente sem atendimento', 'Prazo próximo', 'Reunião próxima'].map(n => `
          <div class="settings-row">
            <div><div class="settings-label">${n}</div></div>
            <div class="toggle active"></div>
          </div>
        `).join('')}
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Usuários e Permissões</div>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>Nome</th><th>Email</th><th>Função</th><th>Status</th></tr></thead>
            <tbody>
              ${App.data.usuarios.map(u => `
                <tr>
                  <td><div style="display:flex;align-items:center;gap:8px"><span class="user-avatar" style="width:28px;height:28px;font-size:10px">${u.avatar}</span>${u.nome}</td>
                  <td>${u.email}</td>
                  <td><span class="badge badge-accent">${u.role}</span></td>
                  <td><span class="badge badge-success">Ativo</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Sistema</div>
        <div class="settings-row">
          <div><div class="settings-label">Backup automático</div><div class="settings-desc">Último backup: hoje às 03:00</div></div>
          <div class="toggle active"></div>
        </div>
        <div class="settings-row">
          <div><div class="settings-label">API própria</div><div class="settings-desc">Endpoint: api.cdmcentral.com/v1</div></div>
          <button class="btn btn-sm btn-secondary">Ver documentação</button>
        </div>
        <div class="settings-row">
          <div><div class="settings-label">Logs do sistema</div><div class="settings-desc">Registro completo de atividades</div></div>
          <button class="btn btn-sm btn-secondary">Ver logs</button>
        </div>
      </div>
    `;
  }
};

// --- Helper Render Functions ---
function metricCard(label, value, icon, colorClass, change) {
  return `
    <div class="metric-card">
      ${icon ? `<div class="metric-icon ${colorClass}">${icon}</div>` : ''}
      <div class="metric-label">${label}</div>
      <div class="metric-value">${value}</div>
      ${change ? `<div class="card-change ${change.startsWith('+') ? 'positive' : 'negative'}">${change}</div>` : ''}
    </div>
  `;
}

function dreRow(label, value, negative = false, highlight = false) {
  return `
    <div class="stat-row" ${highlight ? 'style="font-weight:700;font-size:15px;padding-top:16px"' : ''}>
      <span class="stat-row-label">${label}</span>
      <span class="stat-row-value ${negative ? 'negative' : highlight ? 'positive' : ''}">${negative ? '- ' : ''}${formatCurrency(value)}</span>
    </div>
  `;
}

function boletoRow(b) {
  return `
    <tr data-status="${b.status}" class="boleto-row">
      <td style="font-weight:500">${b.cliente}</td>
      <td>${formatCurrency(b.valor)}</td>
      <td>${formatDate(b.vencimento)}</td>
      <td>${statusBadge(b.status === 'atrasado' ? 'atrasado' : b.status)}</td>
      <td>
        <button class="btn btn-sm btn-ghost btn-view-boleto" data-id="${b.id}">Ver</button>
        <button class="btn btn-sm btn-ghost btn-send-wpp">WhatsApp</button>
        <button class="btn btn-sm btn-ghost btn-send-email">Email</button>
      </td>
    </tr>
  `;
}

function finTable(type, data, cols) {
  const headers = { descricao: 'Descrição', valor: 'Valor', data: 'Data', categoria: 'Categoria', cliente: 'Cliente', centroCusto: 'Centro de Custo', colaborador: 'Colaborador', tipo: 'Tipo', status: 'Status', vencimento: 'Vencimento', socio: 'Sócio' };
  return `
    <div class="table-wrapper">
      <table>
        <thead><tr>${cols.map(c => `<th>${headers[c] || c}</th>`).join('')}</tr></thead>
        <tbody>
          ${data.map(row => `
            <tr>${cols.map(c => `<td>${c === 'valor' ? formatCurrency(row[c]) : c === 'data' || c === 'vencimento' ? formatDateShort(row[c]) : c === 'status' ? statusBadge(row[c]) : row[c] || ''}</td>`).join('')}</tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function rankingItem(pos, name, detail, value) {
  return `
    <div class="ranking-item">
      <div class="ranking-position ${pos <= 3 ? 'top' : ''}">${pos}</div>
      <div class="ranking-info">
        <div class="ranking-name">${name}</div>
        <div class="ranking-detail">${detail}</div>
      </div>
      <div class="ranking-value">${value}</div>
    </div>
  `;
}

function integrationIcon(name) {
  const icons = {
    'Google Analytics 4': '📊', 'Google Ads': '🔍', 'Meta Ads': '📘',
    'Instagram': '📸', 'Facebook': '👤', 'TikTok Ads': '🎵',
    'YouTube': '▶️', 'LinkedIn Ads': '💼', 'WhatsApp Business': '💬',
    'RD Station': '📧', 'Hubspot': '🟠', 'Pipedrive': '🔵'
  };
  return icons[name] || '🔗';
}

function renderFileTree(folders, depth = 0) {
  let html = `<div class="file-grid" style="margin-bottom:${depth === 0 ? 24 : 0}px">`;
  folders.forEach(f => {
    const icons = { pasta: '📁', pdf: '📄', zip: '📦', video: '🎬', imagem: '🖼️' };
    html += `
      <div class="file-item">
        <div class="file-icon">${icons[f.tipo] || '📄'}</div>
        <div class="file-name">${f.nome}</div>
        ${f.tamanho ? `<div class="file-meta">${f.tamanho}</div>` : `<div class="file-meta">${f.cliente || ''}</div>`}
      </div>
    `;
    if (f.filhos) html += renderFileTree(f.filhos, depth + 1);
  });
  html += '</div>';
  return html;
}

function renderTasksList() {
  return `
    <div class="table-wrapper">
      <table>
        <thead><tr><th>Tarefa</th><th>Cliente</th><th>Responsável</th><th>Prioridade</th><th>Prazo</th><th>Status</th></tr></thead>
        <tbody>
          ${App.data.tarefas.map(t => `
            <tr>
              <td style="font-weight:500">${t.titulo}</td>
              <td>${t.cliente}</td>
              <td>${t.responsavel}</td>
              <td>${priorityBadge(t.prioridade)}</td>
              <td>${formatDateShort(t.prazo)}</td>
              <td>${statusBadge(t.status === 'pendente' ? 'pendente_t' : t.status)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// --- Navigation ---
function renderSidebar() {
  const nav = $('#sidebar-nav');
  nav.innerHTML = NAV_ITEMS.map(item => `
    <button class="nav-item ${App.currentView === item.id ? 'active' : ''}" data-view="${item.id}">
      <span class="nav-icon">${item.icon}</span>
      <span class="nav-label">${item.label}</span>
    </button>
  `).join('');
}

function navigate(view) {
  App.currentView = view;
  renderSidebar();
  const main = $('#main-content');
  main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  requestAnimationFrame(() => {
    const renderer = Views[view];
    if (renderer) {
      main.innerHTML = renderer();
      initViewEvents(view);
      initCharts(view);
    } else {
      main.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🚧</div><div class="empty-state-title">Módulo em desenvolvimento</div></div>';
    }
    main.scrollTop = 0;
  });
}

// --- Chart Initialization ---
function initCharts(view) {
  const hist = App.data.metricas.historico;
  const fluxo = App.data.financeiro.fluxoCaixa;

  if (view === 'dashboard') {
    drawChart('chart-receita', hist.labels, [
      { data: hist.receita, color: '#6366f1' },
      { data: hist.investimento, color: '#f59e0b' }
    ], { fill: true, currency: true });
    drawChart('chart-leads', hist.labels, [{ data: hist.leads, color: '#22c55e' }]);
  }

  if (view === 'metricas') {
    drawChart('chart-metric-receita', hist.labels, [{ data: hist.receita, color: '#6366f1' }], { fill: true, currency: true });
    const roasCanvas = $('#chart-metric-roas');
    if (roasCanvas) Charts.drawBar(roasCanvas, hist.labels, hist.roas, { color: '#22c55e' });
  }

  if (view === 'financeiro') {
    drawChart('chart-fluxo', fluxo.labels, [
      { data: fluxo.entrada, color: '#22c55e' },
      { data: fluxo.saida, color: '#ef4444' }
    ], { currency: true });
  }
}

function drawChart(id, labels, datasets, options) {
  const canvas = $(`#${id}`);
  if (canvas) Charts.drawLine(canvas, labels, datasets, options);
}

// --- View Event Handlers ---
function initViewEvents(view) {
  // Metrics period tabs
  $$('#metrics-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      App.metricsPeriod = tab.dataset.period;
      navigate('metricas');
    });
  });

  // Finance tabs
  $$('#fin-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('#fin-tabs .tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const type = tab.dataset.fin;
      const f = App.data.financeiro;
      const colsMap = {
        receitas: ['descricao','valor','data','categoria','cliente'],
        despesas: ['descricao','valor','data','categoria','centroCusto'],
        mensalidades: ['cliente','valor','vencimento','status'],
        comissoes: ['colaborador','valor','tipo','status'],
        prolabore: ['socio','valor','data','status']
      };
      $('#fin-content').innerHTML = finTable(type, f[type], colsMap[type]);
    });
  });

  // Boleto filters
  $$('.filter-boleto').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.filter-boleto').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const filter = btn.dataset.filter;
      $$('.boleto-row').forEach(row => {
        row.style.display = filter === 'all' || row.dataset.status === filter ? '' : 'none';
      });
    });
  });

  // View boleto
  $$('.btn-view-boleto').forEach(btn => {
    btn.addEventListener('click', () => {
      const b = App.data.boletos.find(x => x.id === +btn.dataset.id);
      if (b) showDetailModal(`Boleto — ${b.cliente}`, `
        <div class="detail-grid">
          <span class="detail-label">Cliente</span><span class="detail-value">${b.cliente}</span>
          <span class="detail-label">Valor</span><span class="detail-value">${formatCurrency(b.valor)}</span>
          <span class="detail-label">Vencimento</span><span class="detail-value">${formatDate(b.vencimento)}</span>
          <span class="detail-label">Status</span><span class="detail-value">${statusBadge(b.status)}</span>
        </div>
        <div class="boleto-barcode">${b.codigo}</div>
        <div style="display:flex;gap:8px;margin-top:16px">
          <button class="btn btn-primary btn-send-wpp">Enviar WhatsApp</button>
          <button class="btn btn-secondary btn-send-email">Enviar Email</button>
          <button class="btn btn-secondary">Upload PDF</button>
        </div>
      `);
    });
  });

  $$('.btn-send-wpp').forEach(btn => {
    btn.addEventListener('click', () => showToast('Boleto enviado via WhatsApp!', 'success'));
  });
  $$('.btn-send-email').forEach(btn => {
    btn.addEventListener('click', () => showToast('Boleto enviado por email!', 'success'));
  });

  // Calendar navigation
  const calPrev = $('#cal-prev');
  const calNext = $('#cal-next');
  const calToday = $('#cal-today');
  if (calPrev) calPrev.addEventListener('click', () => { App.calendarDate.setMonth(App.calendarDate.getMonth() - 1); navigate('calendario'); });
  if (calNext) calNext.addEventListener('click', () => { App.calendarDate.setMonth(App.calendarDate.getMonth() + 1); navigate('calendario'); });
  if (calToday) calToday.addEventListener('click', () => { App.calendarDate = new Date(); navigate('calendario'); });

  $$('[data-cal-view]').forEach(tab => {
    tab.addEventListener('click', () => { App.calendarView = tab.dataset.calView; navigate('calendario'); });
  });

  $$('[data-event]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const ev = App.data.calendario.find(x => x.id === +el.dataset.event);
      if (ev) showDetailModal(ev.titulo, renderEventDetail(ev));
    });
  });

  // Cliente cards
  $$('.cliente-card').forEach(card => {
    card.addEventListener('click', () => {
      const c = App.data.clientes.find(x => x.id === +card.dataset.cliente);
      if (c) showDetailModal(c.empresa, renderClienteDetail(c));
    });
  });

  // Tasks view tabs
  $$('#tasks-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      App.tasksView = tab.dataset.taskView;
      navigate('tarefas');
    });
  });

  $$('[data-task]').forEach(card => {
    card.addEventListener('click', () => {
      const t = App.data.tarefas.find(x => x.id === +card.dataset.task);
      if (t) showDetailModal(t.titulo, renderTaskDetail(t));
    });
  });

  // IA Chat
  const chatSend = $('#chat-send');
  const chatInput = $('#chat-input');
  if (chatSend) chatSend.addEventListener('click', sendChatMessage);
  if (chatInput) chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
  });
  $$('.chat-suggestion').forEach(btn => {
    btn.addEventListener('click', () => {
      if (chatInput) { chatInput.value = btn.dataset.suggestion; sendChatMessage(); }
    });
  });

  // Reports
  const btnRelatorio = $('#btn-gerar-relatorio');
  if (btnRelatorio) btnRelatorio.addEventListener('click', () => showToast('Relatório gerado com sucesso!', 'success'));
  $$('.btn-download').forEach(btn => {
    btn.addEventListener('click', () => showToast(`Download ${btn.dataset.format.toUpperCase()} iniciado`, 'info'));
  });
  $$('.btn-share').forEach(btn => {
    btn.addEventListener('click', () => showToast('Link de compartilhamento copiado!', 'success'));
  });

  // Settings theme toggle
  const settingsTheme = $('#settings-theme');
  if (settingsTheme) settingsTheme.addEventListener('click', toggleTheme);

  // Generic data-view navigation
  $$('[data-view]').forEach(el => {
    if (el.classList.contains('nav-item')) return;
    el.addEventListener('click', () => navigate(el.dataset.view));
  });
}

function renderEventDetail(ev) {
  return `
    <div class="detail-grid">
      <span class="detail-label">Data</span><span class="detail-value">${formatDate(ev.data)}</span>
      <span class="detail-label">Horário</span><span class="detail-value">${ev.horaInicio} — ${ev.horaFim}</span>
      <span class="detail-label">Status</span><span class="detail-value">${statusBadge(ev.status)}</span>
      <span class="detail-label">Prioridade</span><span class="detail-value">${priorityBadge(ev.prioridade)}</span>
      <span class="detail-label">Clientes</span><span class="detail-value">${ev.clientes.join(', ')}</span>
      <span class="detail-label">Responsáveis</span><span class="detail-value">${ev.responsaveis.join(', ')}</span>
    </div>
    <p style="margin:16px 0;font-size:14px;color:var(--text-secondary)">${ev.descricao}</p>
    ${ev.checklist.length ? `<div style="margin-top:16px"><strong style="font-size:13px">Checklist</strong>${ev.checklist.map(c => `<div style="padding:4px 0;font-size:13px">${c.concluido ? '✅' : '⬜'} ${c.texto}</div>`).join('')}</div>` : ''}
    <div style="margin-top:12px">${ev.tags.map(t => `<span class="tag">${t}</span>`).join(' ')}</div>
  `;
}

function renderClienteDetail(c) {
  return `
    <div class="detail-grid">
      <span class="detail-label">Responsável</span><span class="detail-value">${c.responsavel}</span>
      <span class="detail-label">Telefone</span><span class="detail-value">${c.telefone}</span>
      <span class="detail-label">Email</span><span class="detail-value">${c.email}</span>
      <span class="detail-label">Instagram</span><span class="detail-value">${c.instagram}</span>
      <span class="detail-label">Website</span><span class="detail-value">${c.website}</span>
      <span class="detail-label">Contrato</span><span class="detail-value">${c.contrato}</span>
      <span class="detail-label">Mensalidade</span><span class="detail-value">${formatCurrency(c.mensalidade)}</span>
      <span class="detail-label">Status</span><span class="detail-value">${statusBadge(c.status)}</span>
    </div>
    <p style="margin:16px 0;font-size:14px;color:var(--text-secondary)">${c.observacoes}</p>
    ${c.historico.length ? `<div style="margin-top:16px"><strong style="font-size:13px">Histórico</strong>${c.historico.map(h => `<div class="list-item" style="padding:8px 0"><div><div style="font-size:13px">${h.acao}</div><div style="font-size:11px;color:var(--text-tertiary)">${formatDateShort(h.data)} · ${h.usuario}</div></div></div>`).join('')}</div>` : ''}
    ${c.anexos.length ? `<div style="margin-top:12px"><strong style="font-size:13px">Anexos</strong><div style="margin-top:8px">${c.anexos.map(a => `<span class="tag" style="margin-right:4px">📄 ${a}</span>`).join('')}</div></div>` : ''}
  `;
}

function renderTaskDetail(t) {
  return `
    <div class="detail-grid">
      <span class="detail-label">Cliente</span><span class="detail-value">${t.cliente}</span>
      <span class="detail-label">Responsável</span><span class="detail-value">${t.responsavel}</span>
      <span class="detail-label">Prazo</span><span class="detail-value">${formatDate(t.prazo)}</span>
      <span class="detail-label">Prioridade</span><span class="detail-value">${priorityBadge(t.prioridade)}</span>
      <span class="detail-label">Status</span><span class="detail-value">${statusBadge(t.status === 'pendente' ? 'pendente_t' : t.status)}</span>
    </div>
    <p style="margin:16px 0;font-size:14px;color:var(--text-secondary)">${t.descricao}</p>
    ${t.subtarefas.length ? `<div><strong style="font-size:13px">Subtarefas</strong>${t.subtarefas.map(s => `<div style="padding:4px 0;font-size:13px">${s.concluida ? '✅' : '⬜'} ${s.titulo}</div>`).join('')}</div>` : ''}
    <div style="margin-top:12px;font-size:12px;color:var(--text-tertiary)">💬 ${t.comentarios} comentários · 📎 ${t.anexos} anexos</div>
  `;
}

// --- IA Chat ---
function sendChatMessage() {
  const input = $('#chat-input');
  const msg = input?.value.trim();
  if (!msg) return;

  App.chatHistory.push({ role: 'user', content: msg });
  input.value = '';

  const messages = $('#chat-messages');
  if (messages) {
    messages.innerHTML = App.chatHistory.map(m => `<div class="chat-message ${m.role}">${m.content}</div>`).join('');
    messages.scrollTop = messages.scrollHeight;
  }

  setTimeout(() => {
    const response = generateIAResponse(msg);
    App.chatHistory.push({ role: 'assistant', content: response });
    if (messages) {
      messages.innerHTML = App.chatHistory.map(m => `<div class="chat-message ${m.role}">${m.content}</div>`).join('');
      messages.scrollTop = messages.scrollHeight;
    }
  }, 800);
}

function generateIAResponse(msg) {
  const lower = msg.toLowerCase();
  const d = App.data.dashboard;

  if (lower.includes('métrica') || lower.includes('analisar')) {
    return `📊 Análise do período:\n\n• Receita: ${formatCurrency(d.receitaMes)} (${d.percentualMeta}% da meta)\n• ROAS médio: ${d.roasMedio}x\n• ${d.leadsGerados} leads gerados\n• ${d.campanhasAtivas} campanhas ativas\n\n⚠️ Atenção: Campanha Black Friday com ROAS abaixo da meta (1.8x). Recomendo revisar criativos e segmentação.`;
  }
  if (lower.includes('copy') || lower.includes('anúncio')) {
    return `✍️ Copy sugerida para Meta Ads:\n\n**Headline:** Transforme seu negócio com marketing digital de verdade\n\n**Texto principal:** Cansado de investir em anúncios sem retorno? A CDM Central já ajudou +200 empresas a multiplicar seus resultados. ROAS médio de 4.2x comprovado.\n\n**CTA:** Agende uma consultoria gratuita\n\nQuer que eu crie variações para teste A/B?`;
  }
  if (lower.includes('roteiro') || lower.includes('reels')) {
    return `🎬 Roteiro para Reels (30s):\n\n**Hook (0-3s):** "Você sabia que 80% das empresas perdem dinheiro em ads?"\n\n**Problema (3-10s):** Mostrar dashboard com métricas ruins\n\n**Solução (10-20s):** Transição para dashboard CDM Central com resultados positivos\n\n**CTA (20-30s):** "Link na bio para consultoria gratuita"\n\n**Música:** Trending audio fitness/motivação\n**Hashtags:** #marketingdigital #trafegopago #agencia`;
  }
  if (lower.includes('relatório')) {
    return `📈 Relatório Executivo — Junho 2026:\n\n• Receita: ${formatCurrency(d.receitaMes)}\n• Lucro: ${formatCurrency(d.lucroMes)}\n• Clientes ativos: ${d.clientesAtivos}\n• Churn: 2.8%\n• LTV/CAC: 38x\n\nRanking: Grupo Alpha lidera com ROAS 5.2x.\n\nDeseja que eu exporte em PDF ou PowerPoint?`;
  }
  if (lower.includes('roas') || lower.includes('melhoria')) {
    return `💡 Sugestões para melhorar ROAS:\n\n1. **Moda Express** (ROAS 1.8x): Pausar criativos com CTR < 1%, testar UGC\n2. **Segmentação**: Criar lookalike 1% dos compradores\n3. **Landing page**: Taxa de conversão em 2.8% — otimizar above the fold\n4. **Budget**: Realocar 20% do budget de awareness para retargeting\n\nImplementando essas ações, estimo ROAS de 3.2x em 14 dias.`;
  }
  return `Entendi sua solicitação sobre "${msg}". Como assistente CDM, posso ajudar com:\n\n• Criação de campanhas e copies\n• Análise de métricas e insights\n• Roteiros e legendas para conteúdo\n• Relatórios executivos\n• Detecção de problemas e sugestões\n\nPode me dar mais detalhes sobre o que precisa?`;
}

// --- Modal ---
function showDetailModal(title, body) {
  $('#detail-modal-title').textContent = title;
  $('#detail-modal-body').innerHTML = body;
  $('#detail-modal').classList.remove('hidden');
  $('#overlay').classList.remove('hidden');
  initViewEvents(App.currentView);
}

function closeModals() {
  $$('.modal-overlay').forEach(m => m.classList.add('hidden'));
  $('#overlay').classList.add('hidden');
  $('#notifications-panel').classList.add('hidden');
}

// --- Theme ---
function toggleTheme() {
  App.theme = App.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', App.theme);
  localStorage.setItem('cdm-theme', App.theme);
  initCharts(App.currentView);
}

// --- Notifications ---
function renderNotifications() {
  const list = $('#notifications-list');
  list.innerHTML = App.data.alertas.map(a => `
    <div class="alert-item">
      <div class="alert-dot ${a.tipo}"></div>
      <div>
        <div style="font-weight:500;font-size:13px">${a.titulo}</div>
        <div style="font-size:12px;color:var(--text-tertiary);margin-top:2px">${a.descricao}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${formatDateShort(a.data)}</div>
      </div>
    </div>
  `).join('');
}

// --- Search Modal ---
function openSearch() {
  $('#search-modal').classList.remove('hidden');
  const input = $('#search-modal-input');
  input.value = '';
  input.focus();
  $('#search-results').innerHTML = '';
}

function renderSearchResults(results) {
  const container = $('#search-results');
  if (!results.length) {
    container.innerHTML = '<div class="empty-state" style="padding:24px"><div class="empty-state-title">Nenhum resultado</div></div>';
    return;
  }
  container.innerHTML = results.map((r, i) => `
    <div class="search-result-item ${i === 0 ? 'active' : ''}" data-nav-view="${r.view}">
      <span style="font-size:18px">${r.icon}</span>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:500">${r.title}</div>
        <div style="font-size:12px;color:var(--text-tertiary)">${r.desc}</div>
      </div>
      <span class="search-result-type">${r.type}</span>
    </div>
  `).join('');

  $$('.search-result-item').forEach(item => {
    item.addEventListener('click', () => {
      closeModals();
      navigate(item.dataset.navView);
    });
  });
}

// --- Keyboard Shortcuts ---
function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      openSearch();
    }
    if (e.key === 'Escape') closeModals();
    if (e.key === 'f' && !e.ctrlKey && !e.metaKey && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      document.querySelector('#app').classList.toggle('fullscreen');
    }
  });
}

// --- Init ---
async function init() {
  document.documentElement.setAttribute('data-theme', App.theme);

  if (App.sidebarCollapsed) $('#sidebar').classList.add('collapsed');

  try {
    const res = await fetch('data/database.json');
    App.data = await res.json();
    App.chatHistory = [...App.data.iaHistorico];
    buildSearchIndex();
  } catch (err) {
    console.error('Erro ao carregar dados:', err);
    showToast('Erro ao carregar database.json', 'error');
    return;
  }

  renderSidebar();
  renderNotifications();
  navigate('dashboard');

  // Sidebar nav
  $('#sidebar-nav').addEventListener('click', (e) => {
    const item = e.target.closest('.nav-item');
    if (item) navigate(item.dataset.view);
  });

  // Theme toggle
  $('#theme-toggle').addEventListener('click', toggleTheme);

  // Sidebar collapse
  $('#sidebar-toggle').addEventListener('click', () => {
    $('#sidebar').classList.toggle('collapsed');
    localStorage.setItem('cdm-sidebar', $('#sidebar').classList.contains('collapsed'));
  });

  // Mobile menu
  $('#mobile-menu').addEventListener('click', () => {
    $('#sidebar').classList.toggle('mobile-open');
  });

  // Search
  $('#global-search').addEventListener('focus', openSearch);
  $('#search-modal-input').addEventListener('input', (e) => {
    renderSearchResults(search(e.target.value));
  });

  // Notifications
  $('#notifications-btn').addEventListener('click', () => {
    $('#notifications-panel').classList.remove('hidden');
    $('#overlay').classList.remove('hidden');
  });
  $('#close-notifications').addEventListener('click', closeModals);
  $('#close-detail-modal').addEventListener('click', closeModals);
  $('#overlay').addEventListener('click', closeModals);

  // Fullscreen
  $('#fullscreen-btn').addEventListener('click', () => {
    document.querySelector('#app').classList.toggle('fullscreen');
  });

  // Resize charts
  window.addEventListener('resize', () => initCharts(App.currentView));

  initKeyboard();
}

document.addEventListener('DOMContentLoaded', init);
