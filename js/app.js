/**
 * UNESCO RS — Painel de Indicadores Educacionais
 * app.js — Carrega JSON e renderiza gráficos Chart.js
 */

// Register datalabels plugin globally
Chart.register(ChartDataLabels);
Chart.defaults.set('plugins.datalabels', { display: false }); // off by default, enable per chart

// Global handler: hide broken icon images gracefully (definitive fix)
document.addEventListener('error', e => {
  if (e.target.tagName === 'IMG' && e.target.src.includes('icons/')) {
    e.target.style.display = 'none';
  }
}, true);

// ══════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════

const S = {
  data: null,
  infra: null,
  doc: null,
  ftl: null,
  fluxo: null,
  inse: null,
  icg: null,       // 4_8_icg.json — Complexidade de Gestão
  afd: null,       // 4_9_afd.json — Adequação da Formação Docente
  geo: null,
  creGeo: null,      // CRE polygons GeoJSON
  creLookup: null,   // { mun_to_cre, cre_list }
  map: null,
  mapLayer: null,
  mapLegend: null,  // Leaflet legend control
  mapMode: 'mun',   // 'mun' | 'cre'
  charts: [],
  anoSel: null,
  depSel: 'Estadual',
  munSel: null,

  creSel: null,      // selected CRE code e.g. '06'
  etapaSel: null,     // selected etapa filter: 'mat_infantil', 'mat_fund_ai', 'mat_fund_af', 'mat_medio', 'mat_eja', or null (all)

  // Multi-rede support
  redeSel: 'estadual',   // current network: estadual, municipal, federal, filantropica, privada, todas
  redeCache: {},         // { estadual: { acesso: data, infra: data }, ... }
};

const FONTE_CENSO = 'Fonte: INEP — Censo Escolar da Educação Básica';

// Paleta Bandeira RS: Verde #00AB4E, Vermelho #EE302F, Amarelo #FFCB04
const COLORS = {
  pri: '#00AB4E', priDark: '#005A32', priLight: '#4DC97A', sec: '#2E7D32',
  red: '#EE302F', redLight: '#F4706F',
  yellow: '#FFCB04', yellowLight: '#FFE066',
  accent: '#FFCB04', accentLight: '#FFE066',
  federal: '#1565C0', estadual: '#00AB4E', municipal: '#EE302F', privada: '#6A1B9A',
  masc: '#1976D2', fem: '#EE302F',
  branca: '#78909C', preta: '#37474F', parda: '#8D6E63', amarela: '#FFCB04', indigena: '#00AB4E', nd: '#B0BEC5',
  infantil: '#FFCB04', fundAI: '#0097A7', fundAF: '#F57C00', fundamental: '#00AB4E', medio: '#EE302F', eja: '#1565C0', especial: '#6A1B9A',
  gridLine: 'rgba(0,0,0,.06)',
};

// Datalabels presets
const DL_BAR = { display: true, anchor: 'end', align: 'end', font: { family: 'Inter', size: 9, weight: '600' }, color: '#444', formatter: v => formatNumChart(v) };
const DL_BAR_PCT = { display: true, anchor: 'end', align: 'end', font: { family: 'Inter', size: 9, weight: '600' }, color: '#444', formatter: v => v.toFixed(1) + '%' };
const DL_LINE = { display: true, anchor: 'end', align: 'top', offset: 3, font: { family: 'Inter', size: 8, weight: '600' }, color: '#555', formatter: v => formatNumChart(v), clamp: true };

const DL_DONUT = { display: true, font: { family: 'Inter', size: 10, weight: '700' }, color: '#fff', formatter: (v, ctx) => { const t = ctx.dataset.data.reduce((a,b) => a+b, 0); const p = (v/t*100); return p >= 5 ? p.toFixed(0) + '%' : ''; } };
const DL_NONE = { display: false };

// Network labels
const REDE_LABELS = {
  estadual: 'Rede Estadual',
  municipal: 'Rede Municipal',
  federal: 'Rede Federal',
  filantropica: 'Rede Filantrópica',
  privada: 'Rede Privada',
  todas: 'Todas as Redes',
};

// Bold presets for rate/score sections (Fluxo, SAEB) — bigger labels for better readability
const DL_LINE_BOLD = { display: true, anchor: 'end', align: 'top', offset: 4, font: { family: 'Inter', size: 11, weight: '700' }, color: '#333', formatter: v => v != null ? v.toFixed(1) + '%' : '', clamp: true };
const DL_BAR_BOLD = { display: true, anchor: 'end', align: 'end', font: { family: 'Inter', size: 11, weight: '700' }, color: '#333', formatter: v => v != null ? v.toFixed(1) + '%' : '' };

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { font: { family: 'Inter', size: 9 }, boxWidth: 8, padding: 6 } },
    tooltip: {
      backgroundColor: '#1A2332', titleFont: { family: 'Inter', size: 11, weight: '600' },
      bodyFont: { family: 'Inter', size: 10 }, padding: 8, cornerRadius: 6,
      callbacks: { label: ctx => ` ${ctx.dataset.label || ''}: ${formatNum(ctx.parsed.y ?? ctx.parsed)}` }
    },
    datalabels: DL_NONE,
  },
  scales: {
    x: { grid: { display: false }, ticks: { font: { family: 'Inter', size: 9 } } },
    y: {
      grid: { color: COLORS.gridLine }, ticks: { font: { family: 'Inter', size: 9 },
      callback: v => formatNumChart(v) }, beginAtZero: true,
    },
  },
};

/** Standard options for line charts with datalabels — includes top padding to prevent label clipping */
const LINE_CHART_OPTS = { ...CHART_DEFAULTS, layout: { padding: { top: 20 } }, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_LINE }, scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, grace: '15%' } } };

// ══════════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════════

/** Hover handler for clickable charts — shows pointer cursor */
const CLICKABLE_HOVER = (evt, elements, chart) => {
  chart.canvas.style.cursor = elements.length > 0 ? 'pointer' : 'default';
};

function formatNum(n) {
  if (n == null) return '—';
  return Math.round(n).toLocaleString('pt-BR');
}

function formatNumChart(n) {
  if (n == null) return '—';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1).replace('.0', '') + 'k';
  return Math.round(n).toLocaleString('pt-BR');
}

function formatPct(n) {
  if (n == null) return '—';
  const sign = n > 0 ? '+' : '';
  return sign + n.toFixed(1) + '%';
}

function deltaClass(n) {
  if (n == null || n === 0) return 'neutral';
  return n > 0 ? 'up' : 'down';
}

function deltaArrow(n) {
  if (n == null || n === 0) return '→';
  return n > 0 ? '↑' : '↓';
}

/**
 * Export chart data as CSV.
 * Finds the Chart.js instance from the canvas inside the same chart-card.
 */
function exportChartCSV(btn) {
  const card = btn.closest('.chart-card');
  if (!card) return;
  const canvas = card.querySelector('canvas');
  if (!canvas) return;
  const chart = Chart.getChart(canvas);
  if (!chart) return;

  const title = card.querySelector('.chart-title')?.textContent || 'dados';
  const labels = chart.data.labels || [];
  const datasets = chart.data.datasets || [];

  // Build CSV
  const header = ['Categoria', ...datasets.map(ds => ds.label || 'Valor')];
  const rows = labels.map((lbl, i) => {
    return [lbl, ...datasets.map(ds => {
      const v = ds.data[i];
      return v != null ? String(v).replace('.', ',') : '';
    })];
  });

  const csv = '\uFEFF' + [header, ...rows].map(r => r.join(';')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = title.replace(/[^a-zA-ZÀ-ú0-9 ]/g, '').trim().replace(/\s+/g, '_') + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function destroyCharts() {
  S.charts.forEach(c => c.destroy());
  S.charts = [];
}

function destroyMap() {
  if (S.map) { S.map.remove(); S.map = null; S.mapLayer = null; }
}

/** Add export CSV buttons to all chart-cards that have a canvas */
function injectExportButtons() {
  document.querySelectorAll('.chart-card canvas').forEach(canvas => {
    const card = canvas.closest('.chart-card');
    if (!card || card.querySelector('.export-btn')) return; // already has one
    const btn = document.createElement('button');
    btn.className = 'export-btn';
    btn.title = 'Exportar dados (CSV)';
    btn.innerHTML = '⬇';
    btn.addEventListener('click', function(e) { e.stopPropagation(); exportChartCSV(this); });
    card.style.position = 'relative';
    card.appendChild(btn);
  });
}
// ══════════════════════════════════════════════════════════
// RENDER — ACESSO E MATRÍCULAS
// ══════════════════════════════════════════════════════════

/** Reusable section banner — with rede toggle for Acesso and Infra */
function sectionBanner(icon, title, subtitle, opts = {}) {
  // Store flag for external use
  sectionBanner._lastShowToggle = opts.redeToggle !== false;

  return `<div class="section-banner">
    <div class="section-banner-bg"></div>
    <div class="section-banner-content">
      <div class="section-banner-left">
        <div class="section-banner-icon"><img src="${icon}" alt=""></div>
        <h2>${title}<span id="rede-subtitle">${subtitle || ''}</span></h2>
        <span id="mun-filter-slot" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-left:12px"></span>
      </div>
      <div class="section-banner-right">
        <div class="banner-filters">
          <div class="banner-filter-group">
            <label class="banner-filter-label">Ano</label>
            <select id="sel-ano" class="banner-filter-select"></select>
          </div>
          <div class="banner-filter-group">
            <label class="banner-filter-label">CRE</label>
            <select id="sel-cre" class="banner-filter-select">
              <option value="">Todas</option>
            </select>
          </div>
          <div class="banner-filter-group">
            <label class="banner-filter-label">Município</label>
            <div class="searchable-select" id="mun-search-wrapper">
              <input type="text" id="mun-search-input" class="banner-filter-select mun-search-input" placeholder="🔍 Pesquisar município..." autocomplete="off">
              <div class="mun-dropdown-list" id="mun-dropdown-list"></div>
            </div>
            <select id="sel-mun" class="banner-filter-select" style="display:none">
              <option value="">Todos</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

/** Returns the rede toggle strip HTML (call after sectionBanner) */
function redeToggleHTML() {
  if (!sectionBanner._lastShowToggle) return '';
  return `<div class="rede-toggle-strip" id="rede-toggle">
    ${Object.entries(REDE_LABELS).map(([k, label]) =>
      `<button class="rede-toggle-btn${k === S.redeSel ? ' active' : ''}" data-rede="${k}">${label.replace('Rede ','')}</button>`
    ).join('')}
  </div>`;
}

function getRedeData(d, ano) {
  // Data is filtered per rede via ETL — just read serie_temporal
  return d.serie_temporal[ano] || {};
}

function getRedeLabel() {
  return REDE_LABELS[S.redeSel] || 'Rede Estadual';
}

/** Lazy-load JSON data for a given rede. Returns cached if already loaded. */
async function loadRedeData(rede) {
  if (S.redeCache[rede]?.acesso && S.redeCache[rede]?.infra) {
    return S.redeCache[rede];
  }
  // Fetch all data sources in parallel; 404s handled gracefully
  const keys = ['acesso', 'infra', 'fluxo', 'saeb', 'inse', 'icg', 'afd', 'ideb'];
  const urls = [
    `dados/4_1_acesso_${rede}.json`,
    `dados/4_5_infra_${rede}.json`,
    `dados/4_3_fluxo_${rede}.json`,
    `dados/4_6_saeb_${rede}.json`,
    `dados/4_7_inse_${rede}.json`,
    `dados/4_8_icg_${rede}.json`,
    `dados/4_9_afd_${rede}.json`,
    `dados/4_7_ideb_${rede}.json`,
  ];
  const responses = await Promise.all(urls.map(u => fetch(u).catch(() => null)));
  const result = {};
  for (let i = 0; i < keys.length; i++) {
    const r = responses[i];
    result[keys[i]] = (r && r.ok) ? await r.json() : null;
  }
  S.redeCache[rede] = result;
  return result;
}

/** Show/hide loading overlay */
function showRedeLoading(rede) {
  let el = document.getElementById('rede-loading');
  if (!el) {
    el = document.createElement('div');
    el.id = 'rede-loading';
    el.className = 'rede-loading-overlay';
    document.body.appendChild(el);
  }
  el.innerHTML = `<div class="rede-loading-box"><div class="spinner"></div><p>Carregando ${REDE_LABELS[rede] || rede}...</p></div>`;
  el.style.display = 'flex';
}
function hideRedeLoading() {
  const el = document.getElementById('rede-loading');
  if (el) el.style.display = 'none';
}

/** Switch to a new network — loads data if needed, swaps pointers, refreshes view */
async function switchRede(rede) {
  if (rede === S.redeSel && S.redeCache[rede]?.acesso) return;
  showRedeLoading(rede);
  try {
    const cached = await loadRedeData(rede);
    S.redeSel = rede;
    if (cached.acesso) {
      S.data = cached.acesso;
      // Re-populate year dropdown for this rede
      const anos = Object.keys(S.data.serie_temporal).sort();
      const selAno = document.getElementById('sel-ano');
      if (selAno) {
        selAno.innerHTML = anos.map(a => `<option value="${a}" ${a === anos[anos.length - 1] ? 'selected' : ''}>${a}</option>`).join('');
        S.anoSel = anos[anos.length - 1];
      }
      // Re-populate municipality dropdown
      populateMunDropdown(S.creSel);
    }
    if (cached.infra) S.infra = cached.infra;
    if (cached.fluxo) S.fluxo = cached.fluxo;
    if (cached.saeb) S.saeb = cached.saeb;
    if (cached.inse) S.inse = cached.inse;
    if (cached.icg) S.icg = cached.icg;
    if (cached.afd) S.afd = cached.afd;
    if (cached.ideb) S.ideb = cached.ideb;
    // Update rede toggle active state
    document.querySelectorAll('.rede-toggle-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.rede === rede);
    });
    // Update subtitle
    const sub = document.getElementById('rede-subtitle');
    if (sub) sub.textContent = getRedeLabel() + ' do RS';
    refreshActiveTab();
  } finally {
    hideRedeLoading();
  }
}

/** Bind rede toggle buttons (called after each section render) */
function bindRedeToggle() {
  const toggle = document.getElementById('rede-toggle');
  if (!toggle) return;
  toggle.addEventListener('click', e => {
    const btn = e.target.closest('.rede-toggle-btn');
    if (!btn || btn.dataset.rede === S.redeSel) return;
    switchRede(btn.dataset.rede);
  });
}

const ETAPA_MAP = { mat_infantil: 'Infantil', mat_fund_ai: 'Fund. AI', mat_fund_af: 'Fund. AF', mat_medio: 'Médio', mat_eja: 'EJA' };

/**
 * Filter awareness system — maps each chart to the filters it responds to.
 * All charts now support geo (CRE/Município) filtering.
 *
 * Chart IDs → which filters affect them:
 *   'geo' = responds to CRE/Município
 *   'year' = responds to year changes
 */
const CHART_FILTER_MAP = {
  'chart-serie':      ['geo','year'],
  'chart-etapa':      ['geo','year'],
  'chart-faixa':      ['geo','year'],
  'chart-integral':   ['geo','year'],
  'chart-noturno':    ['geo','year'],
  'chart-raca':       ['geo','year'],
  'chart-sexo':       ['geo','year'],
  'chart-locdif-bar': ['geo'],
  'chart-esp-evo':    ['geo','year'],
  'chart-esp-tipo':   ['geo','year'],
  'chart-esp-etapa':  ['geo','year'],  // supports municipality/CRE filtering
  'chart-locdif-evo': [],             // state-level only — no filter
  'chart-locdif-sankey': [],          // state-level only
};

function updateFilterAwareness() {
  // All charts now support geo filtering — no badges needed
  document.querySelectorAll('.not-filtered-badge').forEach(b => b.remove());
  document.querySelectorAll('.chart-card.not-filtered').forEach(c => c.classList.remove('not-filtered'));
}

/** Updates the active filter badges inline in the banner header */
function updateActiveFilters() {
  // No-op: filter badges are now managed directly by applyMunFilter/mun-filter-slot
  // Etapa chip is shown inline as well
  const slot = document.getElementById('mun-filter-slot');
  if (!slot) return;
  // Build badges from current state
  let html = '';
  if (S.etapaSel) {
    const name = ETAPA_MAP[S.etapaSel] || S.etapaSel;
    html += `<span class="filter-chip" data-clear="etapa" title="Clique para remover">📊 ${name} <span class="close">✕</span></span>`;
  }
  if (S.creSel) {
    const creName = S.creLookup?.cre_list?.find(c => c.cod_cre === S.creSel)?.nome_cre || `CRE ${S.creSel}`;
    html += `<span class="filter-chip" data-clear="cre" title="Clique para remover">🏫 ${creName} <span class="close">✕</span></span>`;
  }
  if (S.munSel) {
    const munName = S.data?.lookup_municipios?.[S.munSel] || S.munSel;
    html += `<span class="filter-chip" data-clear="mun" title="Clique para remover">📍 ${munName} <span class="close">✕</span></span>`;
  }
  slot.innerHTML = html;
  // Bind clear
  slot.querySelectorAll('.filter-chip').forEach(chip => {
    chip.style.cursor = 'pointer';
    chip.addEventListener('click', () => {
      const type = chip.dataset.clear;
      if (type === 'etapa') S.etapaSel = null;
      if (type === 'cre') { S.creSel = null; const s = document.getElementById('sel-cre'); if (s) s.value = ''; populateMunDropdown(null); }
      if (type === 'mun') { S.munSel = null; const mi = document.getElementById('mun-search-input'); if (mi) mi.value = ''; }
      refreshActiveTab();
    });
  });
}

/** Returns array of municipality codes belonging to a CRE */
function getCreMuns(creCod) {
  if (!S.creLookup || !creCod) return [];
  return Object.entries(S.creLookup.mun_to_cre)
    .filter(([, v]) => v.cod_cre === creCod)
    .map(([cod]) => cod);
}

/** Aggregates municipality data for a CRE (sums numeric keys) */
function aggregateCre(d, ano, creCod) {
  const muns = getCreMuns(creCod);
  const munData = d.por_municipio[ano] || {};
  const result = {};
  for (const cod of muns) {
    const m = munData[cod];
    if (!m) continue;
    for (const [k, v] of Object.entries(m)) {
      if (typeof v === 'number') result[k] = (result[k] || 0) + v;
    }
  }
  return result;
}

function renderAcesso() {
  const d = S.data;
  const anos = Object.keys(d.serie_temporal).sort();
  const anoSel = S.anoSel || anos[anos.length - 1];
  const su = getRedeData(d, anoSel);
  const redeLabel = getRedeLabel();

  const main = document.getElementById('main-content');
  destroyCharts();
  destroyMap();

  main.innerHTML = `
    <div class="section-sticky">
      ${sectionBanner('img/icons/nav_acesso.png', 'Acesso e Matrículas', redeLabel)}
      ${redeToggleHTML()}
      <div class="kpi-strip" id="kpi-strip"></div>
    </div>

    <!-- ═══ EIXO: Panorama da Rede ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/panorama.png" alt=""></span>
      <span class="section-divider-text">Panorama da Rede</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="chart-card d2">
        <div class="chart-title" id="title-serie">Evolução de ${S.etapaSel ? ({'mat_infantil':'Infantil','mat_fund_ai':'Fund. AI','mat_fund_af':'Fund. AF','mat_medio':'Médio','mat_eja':'EJA'}[S.etapaSel]) : 'Matrículas'} — ${redeLabel} (${anos[0]}–${anoSel})</div>
        <div style="height:220px"><canvas id="chart-serie"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card d3">
        <div class="chart-title" id="title-etapa">Matrículas por Etapa — ${anoSel}</div>
        <div style="font-size:9px;color:var(--pri);opacity:.7;margin:-2px 0 2px;font-weight:500">👆 Clique em uma barra deste gráfico para visualizar a evolução de matrículas da referida etapa no gráfico ao lado</div>
        <div style="height:220px"><canvas id="chart-etapa"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title" id="title-integral">Educação Integral — Evolução</div>
        <div id="integral-delta" style="font-size:11px;color:#00AB4E;font-weight:600;margin:2px 0"></div>
        <div style="height:200px"><canvas id="chart-integral"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 2fr;gap:10px">
      <div class="chart-card d4">
        <div class="chart-title" id="title-faixa">Matrículas por Faixa Etária — ${anoSel}</div>
        <div style="height:220px"><canvas id="chart-faixa"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title" id="title-noturno">Matrículas Noturnas — Evolução</div>
        <div style="height:220px"><canvas id="chart-noturno"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
    </div>



    <!-- ═══ EIXO: Recortes Sociais ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/social.png" alt=""></span>
      <span class="section-divider-text">Recortes Sociais</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px">
      <div class="chart-card d5">
        <div class="chart-title" id="title-raca">Evolução por Raça/Cor — ${redeLabel}</div>
        <div id="raca-filters" style="display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 6px 0;font-size:10px"></div>
        <div style="height:210px"><canvas id="chart-raca"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card d6">
        <div class="chart-title" id="title-sexo">Distribuição por Sexo</div>
        <div style="height:220px"><canvas id="chart-sexo"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card d7">
        <div class="chart-title" id="title-locdif">Localização Diferenciada — Matrículas</div>
        <div style="height:220px"><canvas id="chart-locdif-bar"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
    </div>

    <!-- ═══ EIXO: Educação Especial ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/acessibilidade.png" alt=""></span>
      <span class="section-divider-text">Educação Especial</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid g3">
      <div class="chart-card d8">
        <div class="chart-title" id="title-esp-evo">Alunos da Ed. Especial — Evolução</div>
        <div style="height:200px"><canvas id="chart-esp-evo"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card d9">
        <div class="chart-title" id="title-esp-tipo">Classes Comuns vs Exclusivas — ${anoSel}</div>
        <div style="height:200px"><canvas id="chart-esp-tipo"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card d10">
        <div class="chart-title" id="title-esp-etapa">Ed. Especial (Classes Comuns) por Etapa — ${anoSel}</div>
        <div style="height:200px"><canvas id="chart-esp-etapa"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
    </div>

    <!-- ═══ EIXO: Distribuição Territorial ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/territorial.png" alt=""></span>
      <span class="section-divider-text">Distribuição Territorial</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="map-table-row d1">
      <div class="map-container">
        <div class="map-toolbar">
          <h3>Mapa — <span id="map-ano-label">${anoSel}</span></h3>
          <div class="map-layer-toggle">
            <button class="map-layer-btn active" id="btn-layer-mun">Municípios</button>
            <button class="map-layer-btn" id="btn-layer-cre">CREs</button>
          </div>
          <select id="sel-map-metric">
            <option value="mat_total">Matrículas Totais</option>
            <option value="escolas">Escolas</option>
            <option value="mat_fundamental">Fundamental</option>
            <option value="mat_medio">Médio</option>
            <option value="mat_infantil">Infantil</option>
            <option value="mat_eja">EJA</option>
          </select>
        </div>
        <div id="map-leaflet"></div>
      </div>
      <div class="table-wrapper" id="mun-table-wrapper">
        <div class="table-header">
          <h3>Tabela de Municípios</h3>
          <input type="text" class="table-search" id="mun-search" placeholder="Buscar...">
        </div>
        <div style="font-size:10px;color:var(--accent);padding:4px 12px 6px;font-weight:600;background:rgba(255,203,4,.08);border-radius:0 0 6px 6px;border-top:1px dashed rgba(255,203,4,.3)">
          📍 Clique em qualquer município — na tabela ou no mapa — para filtrar <strong>todas as visualizações</strong> desta seção (KPIs, gráficos e recortes). Clique novamente para desfiltrar.
        </div>
        <div style="max-height:400px;overflow-y:auto">
          <table class="data-table" id="mun-table">
            <thead><tr>
              <th>#</th><th>Município</th><th>Esc.</th>
              <th>Mat.</th><th>Fund.</th><th>Méd.</th><th>EJA</th>
            </tr></thead>
            <tbody id="mun-tbody"></tbody>
          </table>
        </div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
    </div>
  `;

  updateKPIs(anoSel, su, d);
  buildCharts(d, anos, anoSel);
  buildFaixaEtaria(d, anoSel);
  buildNoturno(d, anos, anoSel);
  buildEdEspecial(d, anos, anoSel);
  buildIntegralDelta(d);
  buildLocDif();
  buildMap(d, anoSel, 'mat_total');
  buildMunTable(d, anoSel);
  bindMapMetric(d, anos);
  injectExportButtons();

  // Re-populate dropdowns after innerHTML overwrites them
  const selAno = document.getElementById('sel-ano');
  if (selAno) {
    selAno.innerHTML = anos.map(a => `<option value="${a}" ${a === anoSel ? 'selected' : ''}>${a}</option>`).join('');
  }
  populateCreDropdown();
  populateMunDropdown(S.creSel || null);
  // Restore selections
  const selCre = document.getElementById('sel-cre');
  if (selCre && S.creSel) selCre.value = S.creSel;
  const selMun = document.getElementById('sel-mun');
  if (selMun && S.munSel) selMun.value = S.munSel;

  // Re-bind filter event listeners
  bindTopbarFilters();
  bindRedeToggle();
  bindFilters(d, anos);
  updateActiveFilters();
  updateFilterAwareness();
}

function updateKPIs(ano, su, d) {
  const strip = document.getElementById('kpi-strip');
  const anos = Object.keys(d.serie_temporal).sort();
  const idx = anos.indexOf(ano);
  const prev = idx > 0 ? anos[idx - 1] : null;
  const refLabel = prev ? `vs ${prev}` : '';

  const suPrev = prev ? getRedeData(d, prev) : {};
  const pctFn = (cur, old) => (cur != null && old != null && old !== 0) ? ((cur - old) / old * 100) : null;
  const absFn = (cur, old) => (cur != null && old != null) ? (cur - old) : null;

  const kpis = [
    { label: 'Escolas', key: 'total_escolas', altKey: 'escolas', icon: 'img/icons/escola.png', accent: 'green' },
    { label: 'Matrículas', key: 'mat_total', icon: 'img/icons/matriculas.png', accent: 'green' },
    { label: 'Ed. Infantil', key: 'mat_infantil', icon: 'img/icons/infantil.png', accent: 'green' },
    { label: 'Fundamental', key: 'mat_fundamental', icon: 'img/icons/fundamental.png', accent: 'green' },
    { label: 'Ens. Médio', key: 'mat_medio', icon: 'img/icons/medio.png', accent: 'green' },
    { label: 'EJA', key: 'mat_eja', icon: 'img/icons/eja.png', accent: 'green' },
  ];

  // Build sparkline SVG from historical data
  function buildSparkline(key, altKey, color) {
    const vals = anos.map(a => {
      const rd = getRedeData(d, a);
      return rd[key] || rd[altKey] || 0;
    });
    if (vals.every(v => v === 0)) return '';
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    const range = max - min || 1;
    const w = 60, h = 24, pad = 2;
    const points = vals.map((v, i) => {
      const x = pad + (i / (vals.length - 1)) * (w - pad * 2);
      const y = pad + (1 - (v - min) / range) * (h - pad * 2);
      return `${x},${y}`;
    }).join(' ');
    return `<svg class="kpi-sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${points.split(' ').pop().split(',')[0]}" cy="${points.split(' ').pop().split(',')[1]}" r="2.5" fill="${color}"/>
    </svg>`;
  }

  const accentColors = { green: '#00AB4E', yellow: '#FFCB04', red: '#EE302F', blue: '#1565C0' };

  strip.innerHTML = kpis.map((k, i) => {
    const val = su[k.key] || su[k.altKey] || 0;
    const prevVal = suPrev[k.key] || suPrev[k.altKey] || 0;
    const delta = pctFn(val, prevVal);
    const abs = absFn(val, prevVal);
    const sparkSvg = buildSparkline(k.key, k.altKey || k.key, accentColors[k.accent]);
    const sign = abs > 0 ? '+' : '';

    return `
    <div class="kpi-card accent-${k.accent}" style="animation-delay:${i * 80}ms" title="${k.label}: ${formatNum(val)} (${anos[0]}–${ano})">
      <div class="kpi-top">
        <span class="kpi-label">${k.label}</span>
        <img class="kpi-icon" src="${k.icon}" alt="${k.label}">
      </div>
      <div class="kpi-body">
        <span class="kpi-value" data-target="${val}">${formatNum(val)}</span>
        ${sparkSvg}
      </div>
      <div class="kpi-footer">
        ${delta != null ? `
          <span class="kpi-delta ${deltaClass(delta)}">
            ${deltaArrow(delta)} ${formatPct(delta)}
          </span>
          <span class="kpi-abs">${sign}${formatNum(abs)} ${refLabel}</span>
        ` : '<span class="kpi-abs">—</span>'}
      </div>
    </div>`;
  }).join('');

  // Count-up animation
  strip.querySelectorAll('.kpi-value[data-target]').forEach(el => {
    const target = parseInt(el.dataset.target);
    if (!target || target < 10) return;
    const duration = 800;
    const start = performance.now();
    const from = Math.floor(target * 0.7);
    function tick(now) {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3); // easeOutCubic
      el.textContent = formatNum(Math.floor(from + (target - from) * ease));
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

function buildCharts(d, anos, anoSel) {
  destroyCharts();

  // 1. Série temporal (filtered by network + etapa)
  const serieKey = S.etapaSel || 'mat_total';
  const ETAPA_LABELS = { mat_infantil: 'Infantil', mat_fund_ai: 'Fund. AI', mat_fund_af: 'Fund. AF', mat_medio: 'Médio', mat_eja: 'EJA' };
  const serieLabel = S.etapaSel ? ETAPA_LABELS[S.etapaSel] : 'Matrículas';
  const serieColor = S.etapaSel ? (COLORS[{mat_infantil:'infantil', mat_fund_ai:'fundAI', mat_fund_af:'fundAF', mat_medio:'medio', mat_eja:'eja'}[S.etapaSel]] || COLORS.pri) : COLORS.pri;
  S.charts.push(new Chart(document.getElementById('chart-serie'), {
    type: 'line',
    data: {
      labels: anos,
      datasets: [{
        label: serieLabel, data: anos.map(a => getRedeData(d, a)[serieKey] || 0),
        borderColor: serieColor, backgroundColor: serieColor + '18',
        fill: true, tension: .35, pointRadius: 4, pointHoverRadius: 7,
        borderWidth: 2,
      }]
    },
    options: LINE_CHART_OPTS
  }));

  // 2. Por etapa (bar chart no ano selecionado)
  const su = getRedeData(d, anoSel);
  const st = d.serie_temporal; // fallback for sub-fields
  const etapas = ['Fund. AI', 'Fund. AF', 'Médio', 'EJA'];
  const etapaKeys = ['mat_fund_ai', 'mat_fund_af', 'mat_medio', 'mat_eja'];
  const etapaCores = [COLORS.fundAI, COLORS.fundAF, COLORS.medio, COLORS.eja];
  const etapaData = etapaKeys.map(k => su[k] || 0);
  const etapaMax = Math.max(...etapaData);

  S.charts.push(new Chart(document.getElementById('chart-etapa'), {
    type: 'bar',
    data: {
      labels: etapas,
      datasets: [{
        label: `Matrículas ${anoSel}`,
        data: etapaData,
        backgroundColor: etapaKeys.map((k, i) => S.etapaSel && S.etapaSel !== k ? etapaCores[i] + '33' : etapaCores[i] + 'CC'),
        borderColor: etapaKeys.map((k, i) => S.etapaSel && S.etapaSel !== k ? etapaCores[i] + '55' : etapaCores[i]),
        borderWidth: etapaKeys.map(k => S.etapaSel === k ? 3 : 1.5),
        borderRadius: 4,
      }]
    },
    options: { ...CHART_DEFAULTS,
      onHover: CLICKABLE_HOVER,
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const idx = elements[0].index;
        const clickedKey = etapaKeys[idx];
        S.etapaSel = S.etapaSel === clickedKey ? null : clickedKey;
        renderAcesso();
      },
      plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_BAR },
      scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, suggestedMax: etapaMax * 1.15 } } }
  }));

  // Profile data for current year
  const perf = d.perfil_alunos[anoSel];

  // 4. Raça — Temporal evolution with multi-select filter
  const racaKeys = ['branca', 'preta', 'parda', 'amarela', 'indigena', 'nao_declarada'];
  const racaLabels = ['Branca', 'Preta', 'Parda', 'Amarela', 'Indígena', 'Não Decl.'];
  const racaCores = [COLORS.branca, COLORS.preta, COLORS.parda, COLORS.amarela, COLORS.indigena, COLORS.nd];

  const racaEl = document.getElementById('chart-raca');
  const filtersEl = document.getElementById('raca-filters');

  if (racaEl && filtersEl) {
    // Build filter checkboxes
    const activeRacas = new Set(racaKeys);
    filtersEl.innerHTML = racaKeys.map((k, i) => `
      <label style="display:flex;align-items:center;gap:3px;cursor:pointer;padding:2px 6px;border-radius:4px;border:1.5px solid ${racaCores[i]};background:${racaCores[i]}15">
        <input type="checkbox" data-raca="${k}" checked style="accent-color:${racaCores[i]};width:12px;height:12px">
        <span style="color:${racaCores[i]};font-weight:600">${racaLabels[i]}</span>
      </label>
    `).join('');

    const buildRacaChart = () => {
      const existing = Chart.getChart(racaEl);
      if (existing) { existing.destroy(); S.charts = S.charts.filter(c => c !== existing); }
      const datasets = racaKeys.map((k, i) => {
        let data;
        if (S.munSel) {
          data = anos.map(a => d.por_municipio[a]?.[S.munSel]?.[k] || 0);
        } else if (S.creSel) {
          data = anos.map(a => {
            const agg = aggregateCre(d, a, S.creSel);
            return agg[k] || 0;
          });
        } else {
          data = anos.map(a => d.perfil_alunos[a]?.raca?.[k] || 0);
        }
        return {
          label: racaLabels[i],
          data,
          borderColor: racaCores[i], backgroundColor: racaCores[i] + '18',
          fill: false, tension: .35, pointRadius: 3, borderWidth: 2,
          hidden: !activeRacas.has(k),
        };
      });
      S.charts.push(new Chart(racaEl, {
        type: 'line',
        data: { labels: anos, datasets },
        options: { ...CHART_DEFAULTS,
          layout: { padding: { top: 10 } },
          plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: { display: false } },
          scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => formatNum(v) } } }
        }
      }));
    };

    buildRacaChart();

    filtersEl.querySelectorAll('input[data-raca]').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) activeRacas.add(cb.dataset.raca);
        else activeRacas.delete(cb.dataset.raca);
        cb.closest('label').style.opacity = cb.checked ? '1' : '.4';
        buildRacaChart();
      });
    });
  }

  // 5. Sexo
  S.charts.push(new Chart(document.getElementById('chart-sexo'), {
    type: 'doughnut',
    data: {
      labels: ['Masculino', 'Feminino'],
      datasets: [{
        data: [perf.sexo.masculino, perf.sexo.feminino],
        backgroundColor: [COLORS.masc + 'DD', COLORS.fem + 'DD'], borderColor: '#fff', borderWidth: 2.5,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '55%',
      plugins: {
        ...CHART_DEFAULTS.plugins,
        tooltip: {
          ...CHART_DEFAULTS.plugins.tooltip,
          callbacks: {
            label: ctx => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct = ((ctx.parsed / total) * 100).toFixed(1);
              return ` ${ctx.label}: ${formatNum(ctx.parsed)} (${pct}%)`;
            }
          }
        },
        datalabels: DL_DONUT,
      }
    }
  }));

  // 6. Integral (stacked bar — per-municipality when filtered)
  const intCanvas = document.getElementById('chart-integral');
  if (intCanvas) {
    const intAnos = Object.keys(d.integral || {}).sort();
    if (intAnos.length > 0) {
      // Build data per year, using municipality/CRE/state source
      const getIntSrc = (ano) => {
        if (S.munSel) {
          const m = d.por_municipio[ano]?.[S.munSel] || {};
          return { infantil: m.int_infantil || 0, fund_total: m.int_fund_total || 0, medio: m.int_medio || 0 };
        }
        if (S.creSel) {
          const agg = aggregateCre(d, ano, S.creSel);
          return { infantil: agg.int_infantil || 0, fund_total: agg.int_fund_total || 0, medio: agg.int_medio || 0 };
        }
        return d.integral[ano] || { infantil: 0, fund_total: 0, medio: 0 };
      };
      S.charts.push(new Chart(intCanvas, {
        type: 'bar',
        data: {
          labels: intAnos,
          datasets: [
            { label: 'Fundamental', data: intAnos.map(a => getIntSrc(a).fund_total), backgroundColor: COLORS.fundamental + 'CC', borderRadius: 4 },
            { label: 'Médio', data: intAnos.map(a => getIntSrc(a).medio), backgroundColor: COLORS.medio + 'CC', borderRadius: 4 },
          ]
        },
        options: {
          ...CHART_DEFAULTS,
          plugins: {
            ...CHART_DEFAULTS.plugins,
            datalabels: {
              display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0,
              color: '#fff',
              font: { size: 9, weight: '700' },
              anchor: 'center',
              align: 'center',
              formatter: (v) => v > 999 ? (v / 1000).toFixed(1) + 'k' : formatNum(v),
            },
          },
          scales: {
            ...CHART_DEFAULTS.scales,
            x: { ...CHART_DEFAULTS.scales.x, stacked: true },
            y: { ...CHART_DEFAULTS.scales.y, stacked: true },
          }
        }
      }));
    }
  }
}

function buildMunTable(d, ano) {
  const mun = d.por_municipio[ano];
  const lookup = d.lookup_municipios || {};
  const munToCre = S.creLookup?.mun_to_cre || {};
  if (!mun) return;

  // If a CRE is selected, show only its municipalities
  const creFilter = S.creSel;
  const creMuns = creFilter ? new Set(getCreMuns(creFilter)) : null;

  const rows = Object.entries(mun)
    .filter(([cod]) => !creMuns || creMuns.has(cod))
    .map(([cod, v]) => ({ cod, nome: lookup[cod] || `Cód. ${cod}`, ...v }))
    .sort((a, b) => b.mat_total - a.mat_total);

  const tbody = document.getElementById('mun-tbody');
  tbody.innerHTML = rows.map((r, i) => `
    <tr data-cod="${r.cod}" class="${S.munSel === r.cod ? 'selected' : ''}">
      <td>${i + 1}</td>
      <td><strong>${r.nome}</strong></td>
      <td>${formatNum(r.escolas)}</td>
      <td><strong>${formatNum(r.mat_total)}</strong></td>
      <td>${formatNum(r.mat_fundamental)}</td>
      <td>${formatNum(r.mat_medio)}</td>
      <td>${formatNum(r.mat_eja)}</td>
    </tr>
  `).join('');

  // Click to filter
  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => {
      const cod = tr.dataset.cod;
      if (S.munSel === cod) {
        S.munSel = null; // deselect
      } else {
        S.munSel = cod;
      }
      // Update KPIs & charts for the municipality
      const anoSel = S.anoSel || Object.keys(d.serie_temporal).sort().pop();
      applyMunFilter(d, anoSel, lookup);
    });
  });

  // Search
  document.getElementById('mun-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    tbody.querySelectorAll('tr').forEach(tr => {
      const nome = tr.children[1]?.textContent.toLowerCase() || '';
      tr.style.display = nome.includes(q) ? '' : 'none';
    });
  });

  // If already filtered, apply
  if (S.munSel || S.creSel) {
    const anoSel = S.anoSel || Object.keys(d.serie_temporal).sort().pop();
    applyMunFilter(d, anoSel, lookup);
  }
}

/** Apply CRE or municipality filter — update KPIs, charts, map highlight, badge */
function applyMunFilter(d, anoSel, lookup) {
  const anos = Object.keys(d.serie_temporal).sort();
  const tbody = document.getElementById('mun-tbody');

  // Highlight row
  if (tbody) tbody.querySelectorAll('tr').forEach(tr => tr.classList.toggle('selected', tr.dataset.cod === S.munSel));

  // Badge
  const slot = document.getElementById('mun-filter-slot');
  if (slot) updateActiveFilters(); // Rebuild all filter chips

  // ── Specific municipality selected ──
  if (S.munSel) {
    const munData = d.por_municipio[anoSel]?.[S.munSel];
    if (!munData) return;

    // ── Update KPIs ──
    const strip = document.getElementById('kpi-strip');
    const prevAno = anos[anos.indexOf(anoSel) - 1] || null;
    const munPrev = prevAno ? d.por_municipio[prevAno]?.[S.munSel] : null;
    const pctFn = (c, o) => (c != null && o != null && o !== 0) ? ((c - o) / o * 100) : null;
    const absFn = (c, o) => (c != null && o != null) ? (c - o) : null;
    const refLabel = prevAno ? `vs ${prevAno}` : '';

    const kpis = [
      { label: 'Escolas', key: 'escolas', icon: 'img/icons/escola.png', accent: 'green' },
      { label: 'Matrículas', key: 'mat_total', icon: 'img/icons/matriculas.png', accent: 'green' },
      { label: 'Ed. Infantil', key: 'mat_infantil', icon: 'img/icons/infantil.png', accent: 'green' },
      { label: 'Fundamental', key: 'mat_fundamental', icon: 'img/icons/fundamental.png', accent: 'green' },
      { label: 'Ens. Médio', key: 'mat_medio', icon: 'img/icons/medio.png', accent: 'green' },
      { label: 'EJA', key: 'mat_eja', icon: 'img/icons/eja.png', accent: 'green' },
    ];

    strip.innerHTML = kpis.map((k, i) => {
      const val = munData[k.key] ?? 0;
      const prev = munPrev?.[k.key];
      const pct = pctFn(val, prev);
      const abs = absFn(val, prev);
      const cls = deltaClass(pct);
      const arrow = deltaArrow(pct);
      const absStr = abs != null ? (abs >= 0 ? '+' : '') + formatNum(abs) : '';
      return `<div class="kpi-card accent-${k.accent}" style="animation-delay:${i * 80}ms">
        <div class="kpi-top">
          <span class="kpi-label">${k.label}</span>
          <img class="kpi-icon" src="${k.icon}" alt="${k.label}">
        </div>
        <div class="kpi-body">
          <span class="kpi-value">${formatNum(val)}</span>
        </div>
        <div class="kpi-footer">
          <span class="kpi-delta ${cls}">${arrow} ${pct !== null ? (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%' : ''}</span>
          <span class="kpi-abs">${absStr} ${refLabel}</span>
        </div>
      </div>`;
    }).join('');

    // ── Rebuild charts for municipality ──
    destroyCharts();

    // ── Update chart titles to show municipality ──
    const nome = lookup[S.munSel] || S.munSel;
    const setTitle = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    const ETAPA_LABELS_MUN = { mat_infantil: 'Infantil', mat_fund_ai: 'Fund. AI', mat_fund_af: 'Fund. AF', mat_medio: 'Médio', mat_eja: 'EJA' };
    const serieKeyMun = S.etapaSel || 'mat_total';
    const serieLabelMun = S.etapaSel ? ETAPA_LABELS_MUN[S.etapaSel] : 'Matrículas';
    setTitle('title-serie', `Evolução de ${serieLabelMun} — ${nome} (${anos[0]}–${anoSel})`);
    setTitle('title-etapa', `Matrículas por Etapa — ${nome} — ${anoSel}`);
    setTitle('title-raca', `Raça/Cor — ${nome}`);
    setTitle('title-sexo', `Sexo — ${nome}`);
    setTitle('title-faixa', `Faixa Etária — ${nome} — ${anoSel}`);
    setTitle('title-noturno', `Matrículas Noturnas — ${nome}`);
    setTitle('title-integral', `Ed. Integral — ${nome}`);
    setTitle('title-locdif', `Loc. Diferenciada — ${nome}`);
    setTitle('title-esp-evo', `Alunos Ed. Especial — ${nome}`);
    setTitle('title-esp-tipo', `Classes Comuns vs Exclusivas — ${nome} — ${anoSel}`);
    setTitle('title-esp-etapa', `Ed. Especial por Etapa — ${nome} — ${anoSel}`);
    setTitle('title-def', `Tipo de Deficiência — ${nome} — ${anoSel}`);

    // Série temporal do município
    const serieChart = document.getElementById('chart-serie');
    if (serieChart) {
      const serieColorMun = S.etapaSel ? (COLORS[{mat_infantil:'infantil', mat_fund_ai:'fundAI', mat_fund_af:'fundAF', mat_medio:'medio', mat_eja:'eja'}[S.etapaSel]] || COLORS.pri) : COLORS.pri;
      const munSeries = anos.map(a => d.por_municipio[a]?.[S.munSel]?.[serieKeyMun] || 0);
      S.charts.push(new Chart(serieChart, {
        type: 'line',
        data: {
          labels: anos,
          datasets: [{ label: nome, data: munSeries, borderColor: serieColorMun, backgroundColor: serieColorMun + '18', fill: true, tension: .35, pointRadius: 4, borderWidth: 2 }]
        },
        options: LINE_CHART_OPTS
      }));
    }

    // Por etapa (bar)
    const etapaChart = document.getElementById('chart-etapa');
    if (etapaChart) {
      const etapas = ['Fund. AI', 'Fund. AF', 'Médio', 'EJA'];
      const etapaKeys = ['mat_fund_ai', 'mat_fund_af', 'mat_medio', 'mat_eja'];
      const etapaCores = [COLORS.fundAI, COLORS.fundAF, COLORS.medio, COLORS.eja];
      const etapaData = etapaKeys.map(k => munData[k] || 0);
      S.charts.push(new Chart(etapaChart, {
        type: 'bar',
        data: { labels: etapas, datasets: [{ label: `Matrículas ${anoSel}`, data: etapaData,
          backgroundColor: etapaKeys.map((k, i) => S.etapaSel && S.etapaSel !== k ? etapaCores[i] + '33' : etapaCores[i] + 'CC'),
          borderColor: etapaKeys.map((k, i) => S.etapaSel && S.etapaSel !== k ? etapaCores[i] + '55' : etapaCores[i]),
          borderWidth: etapaKeys.map(k => S.etapaSel === k ? 3 : 1.5), borderRadius: 4 }] },
        options: { ...CHART_DEFAULTS,
          onHover: CLICKABLE_HOVER,
          onClick: (evt, elements) => {
            if (!elements.length) return;
            const idx = elements[0].index;
            const clickedKey = etapaKeys[idx];
            S.etapaSel = S.etapaSel === clickedKey ? null : clickedKey;
            applyMunFilter(d, anoSel, lookup);
          },
          plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_BAR },
          scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, suggestedMax: Math.max(...etapaData) * 1.15 } } }
      }));
    }

    // Raça — now has municipality-level data
    buildMunChartsFallback(d, anoSel);
    // New charts with municipality support
    buildFaixaEtaria(d, anoSel);
    buildNoturno(d, anos, anoSel);
    buildEdEspecial(d, anos, anoSel);
    buildIntegralDelta(d);
    buildLocDif();

    // ── Zoom map to municipality ──
    zoomToMunicipality(S.munSel);

  } else if (S.creSel) {
    // ── CRE selected: aggregate all its municipalities ──
    const creData = aggregateCre(d, anoSel, S.creSel);
    const creDataPrev = anos[anos.indexOf(anoSel) - 1]
      ? aggregateCre(d, anos[anos.indexOf(anoSel) - 1], S.creSel) : null;
    const creName = S.creLookup?.cre_list?.find(c => c.cod_cre === S.creSel)?.nome_cre || `CRE ${S.creSel}`;
    const munCount = getCreMuns(S.creSel).length;

    const pctFn = (c, o) => (c != null && o != null && o !== 0) ? ((c - o) / o * 100) : null;
    const absFn = (c, o) => (c != null && o != null) ? (c - o) : null;
    const prevAno = anos[anos.indexOf(anoSel) - 1] || null;
    const refLabel = prevAno ? `vs ${prevAno}` : '';

    // KPIs
    const strip = document.getElementById('kpi-strip');
    const kpis = [
      { label: 'Escolas', key: 'escolas', icon: 'img/icons/escola.png' },
      { label: 'Matrículas', key: 'mat_total', icon: 'img/icons/matriculas.png' },
      { label: 'Ed. Infantil', key: 'mat_infantil', icon: 'img/icons/infantil.png' },
      { label: 'Fundamental', key: 'mat_fundamental', icon: 'img/icons/fundamental.png' },
      { label: 'Ens. Médio', key: 'mat_medio', icon: 'img/icons/medio.png' },
      { label: 'EJA', key: 'mat_eja', icon: 'img/icons/eja.png' },
    ];
    if (strip) {
      strip.innerHTML = kpis.map((k, i) => {
        const val = creData[k.key] ?? 0;
        const prev = creDataPrev?.[k.key];
        const pct = pctFn(val, prev);
        const abs = absFn(val, prev);
        const cls = deltaClass(pct);
        const arrow = deltaArrow(pct);
        const absStr = abs != null ? (abs >= 0 ? '+' : '') + formatNum(abs) : '';
        return `<div class="kpi-card accent-green" style="animation-delay:${i * 80}ms">
          <div class="kpi-top"><span class="kpi-label">${k.label}</span><img class="kpi-icon" src="${k.icon}" alt=""></div>
          <div class="kpi-body"><span class="kpi-value">${formatNum(val)}</span></div>
          <div class="kpi-footer">
            <span class="kpi-delta ${cls}">${arrow} ${pct !== null ? (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%' : ''}</span>
            <span class="kpi-abs">${absStr} ${refLabel}</span>
          </div>
        </div>`;
      }).join('');
    }

    // Charts
    destroyCharts();
    const setTitle = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    const ETAPA_LABELS_CRE = { mat_infantil: 'Infantil', mat_fund_ai: 'Fund. AI', mat_fund_af: 'Fund. AF', mat_medio: 'Médio', mat_eja: 'EJA' };
    const serieKeyCre = S.etapaSel || 'mat_total';
    const serieLabelCre = S.etapaSel ? ETAPA_LABELS_CRE[S.etapaSel] : 'Matrículas';
    const serieColorCre = S.etapaSel ? (COLORS[{mat_infantil:'infantil', mat_fund_ai:'fundAI', mat_fund_af:'fundAF', mat_medio:'medio', mat_eja:'eja'}[S.etapaSel]] || COLORS.pri) : COLORS.pri;
    setTitle('title-serie', `Evolução de ${serieLabelCre} — ${creName} (${anos[0]}–${anoSel})`);
    setTitle('title-etapa', `Matrículas por Etapa — ${creName} — ${anoSel}`);

    // Série temporal CRE
    const serieChart = document.getElementById('chart-serie');
    if (serieChart) {
      const creSeries = anos.map(a => aggregateCre(d, a, S.creSel)[serieKeyCre] || 0);
      S.charts.push(new Chart(serieChart, {
        type: 'line',
        data: { labels: anos, datasets: [{ label: creName, data: creSeries, borderColor: serieColorCre, backgroundColor: serieColorCre + '18', fill: true, tension: .35, pointRadius: 4, borderWidth: 2 }] },
        options: LINE_CHART_OPTS
      }));
    }

    // Por etapa CRE
    const etapaChart = document.getElementById('chart-etapa');
    if (etapaChart) {
      const etapas = ['Fund. AI', 'Fund. AF', 'Médio', 'EJA'];
      const etapaKeys = ['mat_fund_ai', 'mat_fund_af', 'mat_medio', 'mat_eja'];
      const etapaCores = [COLORS.fundAI, COLORS.fundAF, COLORS.medio, COLORS.eja];
      const etapaData = etapaKeys.map(k => creData[k] || 0);
      S.charts.push(new Chart(etapaChart, {
        type: 'bar',
        data: { labels: etapas, datasets: [{ label: `Matrículas ${anoSel}`, data: etapaData,
          backgroundColor: etapaKeys.map((k, i) => S.etapaSel && S.etapaSel !== k ? etapaCores[i] + '33' : etapaCores[i] + 'CC'),
          borderColor: etapaKeys.map((k, i) => S.etapaSel && S.etapaSel !== k ? etapaCores[i] + '55' : etapaCores[i]),
          borderWidth: etapaKeys.map(k => S.etapaSel === k ? 3 : 1.5), borderRadius: 4 }] },
        options: { ...CHART_DEFAULTS,
          onHover: CLICKABLE_HOVER,
          onClick: (evt, elements) => {
            if (!elements.length) return;
            const idx = elements[0].index;
            const clickedKey = etapaKeys[idx];
            S.etapaSel = S.etapaSel === clickedKey ? null : clickedKey;
            applyMunFilter(d, anoSel, lookup);
          },
          plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_BAR },
          scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, suggestedMax: Math.max(...etapaData) * 1.15 } } }
      }));
    }

    buildMunChartsFallback(d, anoSel);
    buildFaixaEtaria(d, anoSel);
    buildNoturno(d, anos, anoSel);
    buildEdEspecial(d, anos, anoSel);
    buildIntegralDelta(d);
    buildLocDif();

  } else {
    // Restore full state
    const su = getRedeData(d, anoSel);
    updateKPIs(anoSel, su, d);
    buildCharts(d, anos, anoSel);
    buildFaixaEtaria(d, anoSel);
    buildNoturno(d, anos, anoSel);
    buildEdEspecial(d, anos, anoSel);
    buildIntegralDelta(d);
    buildLocDif();
    // Reset chart titles
    const setTitle = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    setTitle('title-serie', `Evolução de Matrículas — ${getRedeLabel()} (${anos[0]}–${anoSel})`);
    setTitle('title-etapa', `Matrículas por Etapa — ${anoSel}`);
    setTitle('title-raca', `Evolução por Raça/Cor — ${getRedeLabel()}`);
    setTitle('title-sexo', `Distribuição por Sexo`);
    setTitle('title-faixa', `Matrículas por Faixa Etária — ${anoSel}`);
    setTitle('title-noturno', `Matrículas Noturnas — Evolução`);
    setTitle('title-integral', `Educação Integral — Evolução`);
    setTitle('title-locdif', `Localização Diferenciada — Matrículas`);
    setTitle('title-esp-evo', `Alunos da Ed. Especial — Evolução`);
    setTitle('title-esp-tipo', `Classes Comuns vs Exclusivas — ${anoSel}`);
    setTitle('title-esp-etapa', `Ed. Especial (Classes Comuns) por Etapa — ${anoSel}`);
    // Reset map zoom
    if (S.map && S.mapLayer) {
      S.mapLayer.resetStyle();
      S.map.fitBounds(S.mapLayer.getBounds(), { padding: [20, 20] });
    }
  }
  injectExportButtons();
}

/** Build race/sex/integral/locdif charts — uses municipality data when available */
function buildMunChartsFallback(d, anoSel) {
  const munData = S.munSel ? d.por_municipio[anoSel]?.[S.munSel] : null;
  const perf = d.perfil_alunos?.[anoSel];

  // Raça — use municipality/CRE data when filtered
  const racaEl = document.getElementById('chart-raca');
  if (racaEl && d.perfil_alunos) {
    const racaKeys = ['branca', 'preta', 'parda', 'amarela', 'indigena', 'nao_declarada'];
    const racaLabels = ['Branca', 'Preta', 'Parda', 'Amarela', 'Indígena', 'Não Decl.'];
    const racaCores = [COLORS.branca, COLORS.preta, COLORS.parda, COLORS.amarela, COLORS.indigena, COLORS.nd];
    const anos = Object.keys(d.perfil_alunos).sort();
    const racaDatasets = racaKeys.map((k, i) => {
      let data;
      if (S.munSel) {
        data = anos.map(a => d.por_municipio[a]?.[S.munSel]?.[k] || 0);
      } else if (S.creSel) {
        data = anos.map(a => {
          const agg = aggregateCre(d, a, S.creSel);
          return agg[k] || 0;
        });
      } else {
        data = anos.map(a => d.perfil_alunos[a]?.raca?.[k] || 0);
      }
      return {
        label: racaLabels[i], data,
        borderColor: racaCores[i], backgroundColor: racaCores[i] + '18', fill: false, tension: .35, pointRadius: 3, borderWidth: 2,
      };
    });
    S.charts.push(new Chart(racaEl, {
      type: 'line', data: { labels: anos, datasets: racaDatasets },
      options: { ...CHART_DEFAULTS, layout: { padding: { top: 10 } },
        plugins: { ...CHART_DEFAULTS.plugins, legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { family: 'Inter', size: 9 }, padding: 8, usePointStyle: true } }, datalabels: { display: false } },
        scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => formatNum(v) } } }
      }
    }));
  }

  // Sexo — use municipality data if available
  const sexoEl = document.getElementById('chart-sexo');
  if (sexoEl) {
    const mascVal = munData ? (munData.masc || 0) : (perf?.sexo?.masculino || 0);
    const femVal = munData ? (munData.fem || 0) : (perf?.sexo?.feminino || 0);
    S.charts.push(new Chart(sexoEl, {
      type: 'doughnut', data: { labels: ['Masculino', 'Feminino'], datasets: [{ data: [mascVal, femVal], backgroundColor: [COLORS.masc + 'DD', COLORS.fem + 'DD'], borderColor: '#fff', borderWidth: 2.5 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '55%', plugins: { ...CHART_DEFAULTS.plugins, datalabels: DL_DONUT } }
    }));
  }

  // Integral (municipality/CRE-aware)
  const intEl = document.getElementById('chart-integral');
  if (intEl) {
    const intAnos = Object.keys(d.integral || {}).sort();
    if (intAnos.length > 0) {
      const getIntSrc = (ano) => {
        if (S.munSel) {
          const m = d.por_municipio[ano]?.[S.munSel] || {};
          return { infantil: m.int_infantil || 0, fund_total: m.int_fund_total || 0, medio: m.int_medio || 0 };
        }
        if (S.creSel) {
          const agg = aggregateCre(d, ano, S.creSel);
          return { infantil: agg.int_infantil || 0, fund_total: agg.int_fund_total || 0, medio: agg.int_medio || 0 };
        }
        return d.integral[ano] || { infantil: 0, fund_total: 0, medio: 0 };
      };
      S.charts.push(new Chart(intEl, {
        type: 'bar',
        data: { labels: intAnos, datasets: [
          { label: 'Fundamental', data: intAnos.map(a => getIntSrc(a).fund_total), backgroundColor: COLORS.fundamental + 'CC', borderRadius: 4 },
          { label: 'Médio', data: intAnos.map(a => getIntSrc(a).medio), backgroundColor: COLORS.medio + 'CC', borderRadius: 4 },
        ] },
        options: {
          ...CHART_DEFAULTS,
          plugins: {
            ...CHART_DEFAULTS.plugins,
            datalabels: {
              display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0,
              color: '#fff',
              font: { size: 9, weight: '700' },
              anchor: 'center',
              align: 'center',
              formatter: (v) => v > 999 ? (v / 1000).toFixed(1) + 'k' : formatNum(v),
            },
          },
          scales: {
            ...CHART_DEFAULTS.scales,
            x: { ...CHART_DEFAULTS.scales.x, stacked: true },
            y: { ...CHART_DEFAULTS.scales.y, stacked: true },
          }
        }
      }));
    }
  }
  // LocDif bar (state-level only)
  buildLocDif();
}

/** Zoom Leaflet map to a specific municipality */
function zoomToMunicipality(codMun) {
  if (!S.mapLayer || !S.map) return;
  S.mapLayer.eachLayer(layer => {
    const cod = layer.feature?.properties?.cod_mun?.substring(0, 7);
    if (cod === codMun) {
      S.map.fitBounds(layer.getBounds(), { padding: [40, 40], maxZoom: 10 });
      layer.setStyle({ weight: 3, color: '#FFB300', fillOpacity: 0.95 });
      layer.bringToFront();
    }
  });
}

// ══════════════════════════════════════════════════════════
// MAP — CHOROPLETH LEAFLET
// ══════════════════════════════════════════════════════════

const MAP_SCALE = [
  '#f7fcf5', '#d5efcf', '#9dd898', '#5cba68',
  '#2d974a', '#007A45', '#005A32', '#003D22'
];

const METRIC_LABELS = {
  mat_total: 'Matrículas Totais',
  escolas: 'N° de Escolas',
  mat_fundamental: 'Ens. Fundamental',
  mat_medio: 'Ens. Médio',
  mat_infantil: 'Ed. Infantil',
  mat_eja: 'EJA',
};

function getColor(value, breaks) {
  for (let i = breaks.length - 1; i >= 0; i--) {
    if (value >= breaks[i]) return MAP_SCALE[i];
  }
  return MAP_SCALE[0];
}

function buildMap(d, ano, metric) {
  if (!S.geo) return;

  const mun = d.por_municipio[ano] || {};
  const lookup = d.lookup_municipios || {};

  // Collect values for quantile breaks
  const vals = Object.values(mun).map(v => v[metric] || 0).filter(v => v > 0).sort((a, b) => a - b);
  const breaks = [];
  for (let i = 0; i < MAP_SCALE.length; i++) {
    const idx = Math.floor((i / MAP_SCALE.length) * vals.length);
    breaks.push(vals[Math.min(idx, vals.length - 1)] || 0);
  }

  // Style function
  function style(feature) {
    const cod = feature.properties.cod_mun?.substring(0, 7);
    const munData = mun[cod];
    const value = munData ? (munData[metric] || 0) : 0;
    return {
      fillColor: value > 0 ? getColor(value, breaks) : '#f0f0f0',
      weight: 0.8,
      opacity: 1,
      color: '#fff',
      fillOpacity: 0.85,
    };
  }

  // Destroy existing map
  destroyMap();

  // Create map
  S.map = L.map('map-leaflet', {
    zoomControl: true,
    scrollWheelZoom: true,
    attributionControl: false,
  }).setView([-29.7, -53.5], 6.5);

  // Light basemap
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    maxZoom: 14,
  }).addTo(S.map);

  // Info panel
  const info = L.control({ position: 'topright' });
  info.onAdd = function () {
    this._div = L.DomUtil.create('div', 'map-info-panel');
    this.update();
    return this._div;
  };
  info.update = function (props, munData) {
    if (!props) {
      this._div.innerHTML = '<h4>Passe o mouse sobre um município</h4>';
      return;
    }
    const nome = props.nome || props.cod_mun;
    const regiao = props.regiao_intermediaria || '';
    if (!munData) {
      this._div.innerHTML = `<h4>${nome}</h4><div style="color:#999;font-size:11px">Sem dados para este ano</div>`;
      return;
    }
    this._div.innerHTML = `
      <h4>${nome}</h4>
      <div style="font-size:10px;color:#888;margin-bottom:6px">${regiao}</div>
      <div class="info-row"><span class="info-label">Escolas</span><span class="info-value">${formatNum(munData.escolas)}</span></div>
      <div class="info-row"><span class="info-label">Matrículas</span><span class="info-value">${formatNum(munData.mat_total)}</span></div>
      <div class="info-row"><span class="info-label">Fundamental</span><span class="info-value">${formatNum(munData.mat_fundamental)}</span></div>
      <div class="info-row"><span class="info-label">Médio</span><span class="info-value">${formatNum(munData.mat_medio)}</span></div>
      <div class="info-row"><span class="info-label">EJA</span><span class="info-value">${formatNum(munData.mat_eja)}</span></div>
    `;
  };
  info.addTo(S.map);

  // GeoJSON layer
  S.mapLayer = L.geoJSON(S.geo, {
    style: style,
    onEachFeature: function (feature, layer) {
      const cod = feature.properties.cod_mun?.substring(0, 7);
      const munData = mun[cod];

      layer.on({
        mouseover: function (e) {
          e.target.setStyle({ weight: 2.5, color: '#FFB300', fillOpacity: 0.95 });
          e.target.bringToFront();
          info.update(feature.properties, munData);
        },
        mouseout: function (e) {
          S.mapLayer.resetStyle(e.target);
          info.update();
        },
        click: function (e) {
          const clickedCod = feature.properties.cod_mun?.substring(0, 7);
          if (S.munSel === clickedCod) {
            S.munSel = null;
          } else {
            S.munSel = clickedCod;
          }
          const anoSel = S.anoSel || Object.keys(d.serie_temporal).sort().pop();
          applyMunFilter(d, anoSel, d.lookup_municipios || {});
        },
      });
    }
  }).addTo(S.map);

  // Legend
  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = function () {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = `<h4>${METRIC_LABELS[metric] || metric}</h4>`;
    for (let i = MAP_SCALE.length - 1; i >= 0; i--) {
      const lo = formatNum(breaks[i]);
      const hi = i < MAP_SCALE.length - 1 ? formatNum(breaks[i + 1] - 1) : '+';
      div.innerHTML += `
        <div class="map-legend-row">
          <div class="map-legend-swatch" style="background:${MAP_SCALE[i]}"></div>
          <span>${lo}${hi !== '+' ? ' – ' + hi : '+'}</span>
        </div>`;
    }
    div.innerHTML += `
      <div class="map-legend-row" style="margin-top:4px">
        <div class="map-legend-swatch" style="background:#f0f0f0"></div>
        <span>Sem dados</span>
      </div>`;
    return div;
  };
  legend.addTo(S.map);
  S.mapLegend = legend;  // store so buildCreLayer can remove it

  // Attribution
  L.control.attribution({ prefix: 'Leaflet | IBGE 2025' }).addTo(S.map);

  // Fit bounds
  S.map.fitBounds(S.mapLayer.getBounds(), { padding: [20, 20] });
}

function bindFilters(d, anos) {
  document.getElementById('sel-ano').addEventListener('change', e => {
    const ano = e.target.value;
    const idx = anos.indexOf(ano);
    const prev = idx > 0 ? anos[idx - 1] : null;
    const su = d.serie_temporal[ano];
    const varKey = prev ? `${prev}-${ano}` : null;
    const vr = varKey ? (d.variacao_anual[varKey] || {}) : {};

    updateKPIs(ano, vr, su, d);
    buildCharts(d, anos, ano);
    const metric = document.getElementById('sel-map-metric')?.value || 'mat_total';
    buildMap(d, ano, metric);
    buildMunTable(d, ano);
    buildFunilTurma(ano);
    const mapLabel = document.getElementById('map-ano-label');
    if (mapLabel) mapLabel.textContent = ano;
  });

  document.getElementById('sel-map-metric')?.addEventListener('change', e => {
    const ano = document.getElementById('sel-ano').value;
    buildMap(d, ano, e.target.value);
  });


}

// ══════════════════════════════════════════════════════════
// RENDER — INFRAESTRUTURA & DOCENTES
// ══════════════════════════════════════════════════════════

const INFRA_CAT_COLORS = {
  'Tecnologia': '#1565C0',
  'Espacos Pedagogicos': '#2E7D32',
  'Acessibilidade': '#E65100',
  'Saneamento e Energia': '#00838F',
  'Alimentacao': '#6A1B9A',
  'Climatizacao': '#00838F',
};

function renderInfra() {
  const infra = S.infra;
  const doc = S.doc;
  const main = document.getElementById('main-content');
  destroyCharts();
  destroyMap();

  const anos = Object.keys(infra.serie_temporal).sort();
  const ultimo = anos[anos.length - 1];
  const labels = infra.labels;
  const cats = infra.categorias;
  // Use selected year or last available
  const anoAtual = S.anoSel && infra.serie_temporal[S.anoSel] ? S.anoSel : ultimo;
  const su = infra.serie_temporal[anoAtual];

  main.innerHTML = `
    ${sectionBanner('img/icons/nav_infra.png', 'Infraestrutura', getRedeLabel() + ' do RS')}
    ${redeToggleHTML()}

    <!-- KPIs Premium -->
    <div class="kpi-strip" id="infra-kpis"></div>

    <!-- ═══ EIXO: Infraestrutura — Comparativo ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/sec_infra.png" alt=""></span>
      <span class="section-divider-text">Infraestrutura Escolar — Comparativo Anual</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="infra-cat-tabs" id="infra-cat-tabs">
      <button class="infra-cat-tab active" data-cat="Tecnologia">Tecnologia</button>
      <button class="infra-cat-tab" data-cat="Espacos Pedagogicos">Espaços Pedagógicos</button>
      <button class="infra-cat-tab" data-cat="Acessibilidade">Acessibilidade</button>
      <button class="infra-cat-tab" data-cat="Saneamento e Energia,Alimentacao">Saneamento & Alimentação</button>
      <button class="infra-cat-tab" data-cat="Climatizacao">Climatização</button>
    </div>

    <div class="chart-card" style="margin-bottom:10px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:6px">
        <div id="infra-chart-title" class="chart-title" style="margin:0">Tecnologia — Comparativo</div>
        <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#555">
          <label>Ano base:</label>
          <select id="sel-infra-ano-base" style="font-size:11px;padding:3px 8px;border-radius:4px;border:1px solid #ccc">
            ${anos.map(a => `<option value="${a}" ${a === anos[0] ? 'selected' : ''}>${a}</option>`).join('')}
          </select>
          <label>vs</label>
          <select id="sel-infra-ano-comp" style="font-size:11px;padding:3px 8px;border-radius:4px;border:1px solid #ccc">
            ${anos.map(a => `<option value="${a}" ${a === anoAtual ? 'selected' : ''}>${a}</option>`).join('')}
          </select>
        </div>
      </div>
      <div style="height:380px"><canvas id="chart-infra-main"></canvas></div>
      <div class="chart-source">${FONTE_CENSO}</div>
    </div>

    <!-- ═══ EIXO: Infraestrutura por Município ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/territorial.png" alt=""></span>
      <span class="section-divider-text">Distribuição Territorial</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="chart-card" style="padding:0;overflow:hidden">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(0,90,50,.04);border-bottom:1px solid rgba(0,90,50,.08)">
          <span style="font-weight:600;font-size:12px;color:#333">Mapa — 2024</span>
          <select id="infra-map-metric" style="font-size:11px;padding:3px 8px;border-radius:4px;border:1px solid #ccc">
            <option value="IN_INTERNET">Internet</option>
            <option value="IN_BIBLIOTECA">Biblioteca</option>
            <option value="IN_QUADRA_ESPORTES">Quadra</option>
            <option value="IN_LABORATORIO_INFORMATICA">Lab. Informática</option>
            <option value="IN_ACESSIBILIDADE_RAMPAS">Rampas</option>
            <option value="IN_CLIMATIZACAO">Ar Condicionado</option>
          </select>
        </div>
        <div id="infra-map" style="height:400px;width:100%"></div>
      </div>
      <div class="chart-card">
        <div class="table-header">
          <h3>Indicadores de Infraestrutura por Município — 2024</h3>
          <input type="text" class="table-search" id="infra-mun-search" placeholder="Buscar município...">
        </div>
        <div style="max-height:400px;overflow-y:auto">
          <table class="data-table" id="infra-mun-table">
            <thead><tr>
              <th>#</th><th>Município</th><th>Esc.</th>
              <th>Internet</th><th>Biblioteca</th><th>Quadra</th><th>Lab. Inf.</th><th>Rampas</th><th>Ar Cond.</th>
            </tr></thead>
            <tbody id="infra-mun-tbody"></tbody>
          </table>
        </div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
    </div>

  `;

  buildInfraKPIs(infra, anoAtual, anos);
  buildInfraChart(infra, anoAtual, 'Tecnologia');
  bindInfraCatTabs(infra, anoAtual);
  buildInfraMunTable(infra);
  buildInfraMap(infra, 'IN_INTERNET');
  bindInfraMapMetric(infra);

  // Populate dropdowns (infra has limited years)
  const selAno = document.getElementById('sel-ano');
  if (selAno) {
    selAno.innerHTML = anos.map(a => `<option value="${a}" ${a === anoAtual ? 'selected' : ''}>${a}</option>`).join('');
  }
  populateCreDropdown();
  populateMunDropdown(S.creSel || null);
  const selCre = document.getElementById('sel-cre');
  if (selCre && S.creSel) selCre.value = S.creSel;
  bindTopbarFilters();
  bindRedeToggle();
  injectExportButtons();
}

/* ── Infra Municipality Table ── */
function buildInfraMunTable(infra) {
  const tbody = document.getElementById('infra-mun-tbody');
  if (!tbody) return;
  const lookup = S.data?.lookup_municipios || {};
  const munData = infra.por_municipio?.['2024'] || {};
  const indicators = ['IN_INTERNET', 'IN_BIBLIOTECA', 'IN_QUADRA_ESPORTES', 'IN_LABORATORIO_INFORMATICA', 'IN_ACESSIBILIDADE_RAMPAS', 'IN_CLIMATIZACAO'];

  let entries = Object.entries(munData);
  // Filter by CRE if selected
  if (S.creSel) {
    const creMuns = new Set(getCreMuns(S.creSel));
    entries = entries.filter(([cod]) => creMuns.has(cod));
  }
  
  let rows = entries
    .map(([cod, v]) => ({ cod, nome: lookup[cod] || `Cód. ${cod}`, escolas: v.escolas || 0, inds: v.indicadores || {} }))
    .sort((a, b) => b.escolas - a.escolas);

  const pctCell = (pct) => {
    const cls = pct >= 80 ? 'color:#00AB4E' : pct >= 50 ? 'color:#E6A100' : 'color:#EE302F';
    return `<td style="text-align:center;font-weight:600;${cls}">${pct.toFixed(0)}%</td>`;
  };

  const renderRows = (data) => {
    tbody.innerHTML = data.map((r, i) =>
      `<tr data-cod="${r.cod}" style="cursor:pointer" title="Clique para filtrar por ${r.nome}"><td>${i + 1}</td><td><strong>${r.nome}</strong></td><td>${r.escolas}</td>` +
      indicators.map(k => pctCell(r.inds[k]?.pct || 0)).join('') +
      `</tr>`
    ).join('');
    // Click to filter
    tbody.querySelectorAll('tr').forEach(tr => {
      tr.addEventListener('click', () => {
        const cod = tr.dataset.cod;
        if (S.munSel === cod) { S.munSel = null; } else { S.munSel = cod; }
        refreshActiveTab();
      });
    });
  };

  renderRows(rows);

  // Sortable headers
  const table = document.getElementById('infra-mun-table');
  if (table) {
    let sortCol = -1, sortAsc = true;
    table.querySelectorAll('th').forEach((th, ci) => {
      th.style.cursor = 'pointer';
      th.title = 'Clique para ordenar';
      th.addEventListener('click', () => {
        if (sortCol === ci) sortAsc = !sortAsc; else { sortCol = ci; sortAsc = true; }
        const getVal = (r) => {
          if (ci === 0) return 0; // # column
          if (ci === 1) return r.nome;
          if (ci === 2) return r.escolas;
          const indKey = indicators[ci - 3];
          return r.inds[indKey]?.pct || 0;
        };
        rows.sort((a, b) => {
          const va = getVal(a), vb = getVal(b);
          const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
          return sortAsc ? cmp : -cmp;
        });
        renderRows(rows);
        // Update header arrows
        table.querySelectorAll('th').forEach(h => h.textContent = h.textContent.replace(/ [▲▼]/g, ''));
        th.textContent += sortAsc ? ' ▲' : ' ▼';
      });
    });
  }

  // Search
  const search = document.getElementById('infra-mun-search');
  if (search) search.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    tbody.querySelectorAll('tr').forEach(tr => {
      tr.style.display = tr.children[1].textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
}

/* ── Premium KPIs for Infra ── */
function buildInfraKPIs(infra, ano, anos) {
  const su = infra.serie_temporal[ano];
  const prev = anos.indexOf(ano) > 0 ? anos[anos.indexOf(ano) - 1] : null;
  const suPrev = prev ? infra.serie_temporal[prev] : null;
  const refLabel = prev ? `vs ${prev}` : '';

  // If municipality is selected, override with per-municipality data
  let munMode = false;
  let munSu = null;
  if (S.munSel && infra.por_municipio?.['2024']?.[S.munSel]) {
    munMode = true;
    munSu = infra.por_municipio['2024'][S.munSel];
  } else if (S.creSel) {
    // Aggregate CRE municipalities
    const creMuns = getCreMuns(S.creSel);
    const pm = infra.por_municipio?.['2024'] || {};
    munMode = true;
    munSu = { escolas: 0, indicadores: {} };
    for (const cod of creMuns) {
      const m = pm[cod]; if (!m) continue;
      munSu.escolas += m.escolas || 0;
      for (const [k, v] of Object.entries(m.indicadores || {})) {
        if (!munSu.indicadores[k]) munSu.indicadores[k] = { count: 0 };
        munSu.indicadores[k].count += v.count || 0;
      }
    }
    // Recalculate percentages
    for (const [k, v] of Object.entries(munSu.indicadores)) {
      v.pct = munSu.escolas > 0 ? (v.count / munSu.escolas * 100) : 0;
    }
  }

  const pctFn = (cur, old) => (cur != null && old != null && old !== 0) ? ((cur - old) / old * 100) : null;
  const absFn = (cur, old) => (cur != null && old != null) ? (cur - old) : null;

  const getVal = (key, fmt) => {
    if (munMode && munSu) {
      if (key === 'total_escolas') return munSu.escolas;
      return munSu.indicadores?.[key]?.pct ?? null;
    }
    if (key === 'total_escolas') return su[key];
    return su.indicadores[key]?.pct ?? null;
  };

  const kpis = [
    { label: 'Escolas', key: 'total_escolas', prevVal: suPrev?.total_escolas, icon: 'img/icons/escola.png', accent: 'green', fmt: 'num' },
    { label: 'Internet', key: 'IN_INTERNET', prevVal: suPrev?.indicadores?.IN_INTERNET?.pct, icon: 'img/icons/internet.png', accent: 'green', fmt: 'pct' },
    { label: 'Biblioteca', key: 'IN_BIBLIOTECA', prevVal: suPrev?.indicadores?.IN_BIBLIOTECA?.pct, icon: 'img/icons/biblioteca.png', accent: 'green', fmt: 'pct' },
    { label: 'Quadra', key: 'IN_QUADRA_ESPORTES', prevVal: suPrev?.indicadores?.IN_QUADRA_ESPORTES?.pct, icon: 'img/icons/quadra.png', accent: 'green', fmt: 'pct' },
    { label: 'Lab. Informática', key: 'IN_LABORATORIO_INFORMATICA', prevVal: suPrev?.indicadores?.IN_LABORATORIO_INFORMATICA?.pct, icon: 'img/icons/laboratorio.png', accent: 'green', fmt: 'pct' },
    { label: 'Ar Condicionado', key: 'IN_CLIMATIZACAO', prevVal: suPrev?.indicadores?.IN_CLIMATIZACAO?.pct, icon: 'img/icons/ar_condicionado.png', accent: 'green', fmt: 'pct' },
  ].map(k => ({ ...k, val: getVal(k.key, k.fmt) }));

  // Build sparklines from historical data (only state-level)
  function buildSparkInfra(key, color) {
    if (munMode) return ''; // No sparkline for municipality
    const vals = anos.map(a => {
      if (key === 'total_escolas') return infra.serie_temporal[a]?.[key] || 0;
      return infra.serie_temporal[a]?.indicadores?.[key]?.pct || 0;
    });
    const max = Math.max(...vals, 1);
    const min = Math.min(...vals);
    const range = max - min || 1;
    const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * 58 + 1},${23 - ((v - min) / range) * 20}`).join(' ');
    return `<svg class="kpi-sparkline" viewBox="0 0 60 24" width="60" height="24"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  }

  const sparkKeys = ['total_escolas','IN_INTERNET','IN_BIBLIOTECA','IN_QUADRA_ESPORTES','IN_LABORATORIO_INFORMATICA','IN_CLIMATIZACAO'];
  const sparkColors = ['#00AB4E','#00AB4E','#FFCB04','#EE302F','#1565C0','#00838F'];

  const strip = document.getElementById('infra-kpis');
  strip.innerHTML = kpis.map((k, i) => {
    const val = k.val;
    const displayVal = k.fmt === 'pct' ? (val != null ? val.toFixed(1) + '%' : '—') : formatNum(val);
    const pct = munMode ? null : pctFn(val, k.prevVal);
    const abs = munMode ? null : absFn(val, k.prevVal);
    const cls = pct !== null ? (pct >= 0 ? 'up' : 'down') : '';
    const arrow = pct !== null ? (pct >= 0 ? '↑' : '↓') : '';
    const sparkline = buildSparkInfra(sparkKeys[i], sparkColors[i]);
    const absStr = k.fmt === 'pct' ? (abs !== null ? `${abs >= 0 ? '+' : ''}${abs.toFixed(1)}pp` : '') : (abs !== null ? `${abs >= 0 ? '+' : ''}${formatNum(abs)}` : '');

    return `
    <div class="kpi-card accent-${k.accent}" style="animation-delay:${i * 80}ms" title="${k.label}: ${displayVal}">
      <div class="kpi-top">
        <span class="kpi-label">${k.label}</span>
        <img class="kpi-icon" src="${k.icon}" alt="${k.label}">
      </div>
      <div class="kpi-body">
        <span class="kpi-value">${displayVal}</span>
        ${sparkline}
      </div>
      <div class="kpi-footer">
        <span class="kpi-delta ${cls}">${arrow} ${pct !== null ? (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%' : ''}</span>
        <span class="kpi-abs">${absStr} ${!munMode ? refLabel : ''}</span>
      </div>
    </div>`;
  }).join('');
}

/** Build single infra chart for a given category key */
function buildInfraChart(infra, anoComp, catKey, anoBase) {
  const su = infra.serie_temporal[anoComp];
  const labels = infra.labels;
  const cats = infra.categorias;
  const anos = Object.keys(infra.serie_temporal).sort();
  const baseYear = anoBase || anos[0];
  const suBase = infra.serie_temporal[baseYear];

  // Municipality/CRE override
  let munSu = null;
  if (S.munSel && infra.por_municipio?.['2024']?.[S.munSel]) {
    munSu = infra.por_municipio['2024'][S.munSel];
  } else if (S.creSel) {
    const creMuns = getCreMuns(S.creSel);
    const pm = infra.por_municipio?.['2024'] || {};
    munSu = { escolas: 0, indicadores: {} };
    for (const cod of creMuns) {
      const m = pm[cod]; if (!m) continue;
      munSu.escolas += m.escolas || 0;
      for (const [k, v] of Object.entries(m.indicadores || {})) {
        if (!munSu.indicadores[k]) munSu.indicadores[k] = { count: 0 };
        munSu.indicadores[k].count += v.count || 0;
      }
    }
    for (const [k, v] of Object.entries(munSu.indicadores)) {
      v.pct = munSu.escolas > 0 ? (v.count / munSu.escolas * 100) : 0;
    }
  }

  // Destroy existing infra chart only
  const el = document.getElementById('chart-infra-main');
  if (!el) return;
  const existing = Chart.getChart(el);
  if (existing) { existing.destroy(); S.charts = S.charts.filter(c => c !== existing); }

  // Parse category keys (can be comma-separated)
  const catKeys = catKey.split(',');
  const catNames = { 'Tecnologia': 'Tecnologia', 'Espacos Pedagogicos': 'Espaços Pedagógicos', 'Acessibilidade': 'Acessibilidade', 'Saneamento e Energia': 'Saneamento & Alimentação', 'Alimentacao': 'Alimentação', 'Climatizacao': 'Climatização (Ar Condicionado)' };
  const catLabel = catKeys.length > 1 ? 'Saneamento & Alimentação' : (catNames[catKeys[0]] || catKeys[0]);
  const titleEl = document.getElementById('infra-chart-title');
  if (titleEl) titleEl.textContent = `${catLabel} — ${munSu ? '2024' : baseYear + ' vs ' + anoComp}`;

  const allCols = [];
  catKeys.forEach(cat => { if (cats[cat]) allCols.push(...cats[cat]); });

  const barLabels = allCols.map(c => labels[c] || c);
  // Current data: use municipality if available, else state-level
  const dataAtual = allCols.map(c => munSu ? (munSu.indicadores?.[c]?.pct || 0) : (su.indicadores[c]?.pct || 0));
  const dataBase = allCols.map(c => suBase?.indicadores?.[c]?.pct || 0);

  S.charts.push(new Chart(el, {
    type: 'bar',
    data: {
      labels: barLabels,
      datasets: [
        {
          label: baseYear,
          data: dataBase,
          backgroundColor: '#FFDF00AA',
          borderColor: '#FFDF00',
          borderWidth: 1,
          borderRadius: 4,
          barPercentage: .85,
          categoryPercentage: .7,
        },
        {
          label: anoComp,
          data: dataAtual,
          backgroundColor: '#009C3BCC',
          borderColor: '#009C3B',
          borderWidth: 1,
          borderRadius: 4,
          barPercentage: .85,
          categoryPercentage: .7,
        },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 20 } },
      plugins: {
        legend: { position: 'top', align: 'end', labels: { font: { family: 'Inter', size: 10 }, boxWidth: 10, padding: 8 } },
        tooltip: { ...CHART_DEFAULTS.plugins.tooltip, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%` } },
        datalabels: {
          display: (ctx) => ctx.datasetIndex === 1,
          anchor: 'end', align: 'top', offset: 2,
          font: { family: 'Inter', size: 9, weight: '600' },
          color: '#333',
          formatter: (v, ctx) => {
            const delta = v - ctx.chart.data.datasets[0].data[ctx.dataIndex];
            const sign = delta >= 0 ? '+' : '';
            return `${v.toFixed(0)}% (${sign}${delta.toFixed(0)}pp)`;
          }
        },
      },
      scales: {
        y: { max: 100, grid: { color: COLORS.gridLine }, ticks: { callback: v => v + '%', font: { family: 'Inter', size: 10 } } },
        x: { grid: { display: false }, ticks: { font: { family: 'Inter', size: 9 }, maxRotation: 45, minRotation: 20 } }
      },
    }
  }));
  injectExportButtons();
}

/** Bind infra category tab clicks + year comparison dropdowns */
function bindInfraCatTabs(infra, ano) {
  function getActiveCat() {
    const active = document.querySelector('.infra-cat-tab.active');
    return active ? active.dataset.cat : 'Tecnologia';
  }
  function getSelectedYears() {
    const baseEl = document.getElementById('sel-infra-ano-base');
    const compEl = document.getElementById('sel-infra-ano-comp');
    const base = baseEl ? baseEl.value : Object.keys(infra.serie_temporal).sort()[0];
    const comp = compEl ? compEl.value : ano;
    return { base, comp };
  }
  function rebuild() {
    const { base, comp } = getSelectedYears();
    buildInfraChart(infra, comp, getActiveCat(), base);
  }

  document.querySelectorAll('.infra-cat-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.infra-cat-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      rebuild();
    });
  });

  const baseEl = document.getElementById('sel-infra-ano-base');
  const compEl = document.getElementById('sel-infra-ano-comp');
  if (baseEl) baseEl.addEventListener('change', rebuild);
  if (compEl) compEl.addEventListener('change', rebuild);
}

/** Build infrastructure choropleth map */
function buildInfraMap(infra, metricKey) {
  const mapEl = document.getElementById('infra-map');
  if (!mapEl || !S.geo) return;
  
  destroyMap();
  
  const map = L.map(mapEl, { zoomControl: true, scrollWheelZoom: true, attributionControl: false }).setView([-29.7, -53.5], 6.5);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', { maxZoom: 14 }).addTo(map);
  
  const munData = infra.por_municipio?.['2024'] || {};
  const lookup = S.data?.lookup_municipios || {};
  const label = infra.labels?.[metricKey] || metricKey;
  
  // Simple 3-tier thresholds for % indicators
  const tiers = [
    { min: 80, color: '#005A32', label: '≥ 80%' },
    { min: 50, color: '#5cba68', label: '50% – 79%' },
    { min: 0.1, color: '#d5efcf', label: '< 50%' },
  ];
  const getInfraColor = (pct) => {
    for (const t of tiers) { if (pct >= t.min) return t.color; }
    return '#f0f0f0';
  };
  
  const layer = L.geoJSON(S.geo, {
    style: (feature) => {
      const cod = feature.properties.cod_mun?.substring(0, 7);
      const v = munData[cod]?.indicadores?.[metricKey]?.pct || 0;
      return { fillColor: getInfraColor(v), fillOpacity: 0.85, weight: 0.8, color: '#fff' };
    },
    onEachFeature: (feature, layer) => {
      const cod = feature.properties.cod_mun?.substring(0, 7);
      const nome = lookup[cod] || feature.properties.NM_MUN || cod;
      const d = munData[cod];
      const pct = d?.indicadores?.[metricKey]?.pct || 0;
      const n = d?.indicadores?.[metricKey]?.count || 0;
      layer.bindTooltip(`<strong>${nome}</strong><br>${label}: ${pct.toFixed(1)}% (${n}/${d?.escolas || 0} escolas)`, { sticky: true });
      layer.on({
        mouseover: e => { e.target.setStyle({ weight: 2.5, color: '#FFB300', fillOpacity: 0.95 }); e.target.bringToFront(); },
        mouseout: e => { S.mapLayer.resetStyle(e.target); },
        click: () => {
          if (S.munSel === cod) { S.munSel = null; } else { S.munSel = cod; }
          refreshActiveTab();
        }
      });
    }
  }).addTo(map);
  
  // Legend — 3 tiers
  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = function () {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = `<h4>${label}</h4>`;
    for (const t of tiers) {
      div.innerHTML += `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${t.color}"></div><span>${t.label}</span></div>`;
    }
    div.innerHTML += `<div class="map-legend-row" style="margin-top:4px"><div class="map-legend-swatch" style="background:#f0f0f0"></div><span>Sem dados</span></div>`;
    return div;
  };
  legend.addTo(map);
  
  S.map = map;
  S.mapLayer = layer;
  S.mapLegend = legend;
}

/** Bind infra map metric dropdown */
function bindInfraMapMetric(infra) {
  const sel = document.getElementById('infra-map-metric');
  if (!sel) return;
  sel.addEventListener('change', () => {
    buildInfraMap(infra, sel.value);
  });
}

// ══════════════════════════════════════════════════════════
// DOCÊNCIA — STANDALONE SECTION
// ══════════════════════════════════════════════════════════

function renderDocencia() {
  const doc = S.doc;
  const main = document.getElementById('main-content');
  destroyCharts();
  destroyMap();

  main.innerHTML = `
    ${sectionBanner('img/icons/sec_docentes.png', 'Docência', 'Rede Estadual do RS', {redeToggle: false})}

    <div class="kpi-strip" id="doc-kpis" style="grid-template-columns:repeat(4,1fr)"></div>

    <!-- ═══ Perfil Docente ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/sec_docentes.png" alt=""></span>
      <span class="section-divider-text">Perfil Docente — 2025</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
      <div class="chart-card d1">
        <div class="chart-title">Docentes por Sexo</div>
        <div style="height:240px"><canvas id="chart-doc-sexo"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card d2">
        <div class="chart-title">Escolaridade dos Docentes</div>
        <div style="height:270px"><canvas id="chart-doc-esco"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card d3">
        <div class="chart-title">Faixa Etária</div>
        <div style="height:270px"><canvas id="chart-doc-idade"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card d4">
        <div class="chart-title">Tipo de Vínculo</div>
        <div style="height:240px"><canvas id="chart-doc-vinculo"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
    </div>

    <!-- ═══ Evolução ═══ -->
    <div class="section-divider" style="margin-top:12px">
      <span class="section-divider-icon"><img src="img/icons/nav_acesso.png" alt=""></span>
      <span class="section-divider-text">Evolução</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title">Total de Docentes — Evolução</div>
        <div style="height:260px"><canvas id="chart-doc-evo"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Razão Aluno/Professor — Evolução</div>
        <div style="height:260px"><canvas id="chart-doc-razao"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
    </div>

    <!-- ═══ Distribuição Territorial ═══ -->
    <div class="section-divider" style="margin-top:12px">
      <span class="section-divider-icon"><img src="img/icons/territorial.png" alt=""></span>
      <span class="section-divider-text">Distribuição Territorial</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="chart-card" style="padding:0;overflow:hidden">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(0,90,50,.04);border-bottom:1px solid rgba(0,90,50,.08)">
          <span style="font-weight:600;font-size:12px;color:#333">Mapa — Docentes por Município</span>
        </div>
        <div id="doc-map" style="height:400px;width:100%"></div>
      </div>
      <div class="chart-card">
        <div class="table-header">
          <h3>Docentes por Município — 2025</h3>
          <input type="text" class="table-search" id="doc-mun-search" placeholder="Buscar município...">
        </div>
        <div style="max-height:400px;overflow-y:auto">
          <table class="data-table" id="doc-mun-table">
            <thead><tr>
              <th>#</th><th>Município</th><th>Esc.</th><th>Docentes</th>
            </tr></thead>
            <tbody id="doc-mun-tbody"></tbody>
          </table>
        </div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
    </div>
  `;

  buildDocCharts(doc);
  buildDocMap(doc);
  buildDocMunTable(doc);

  // Populate dropdowns
  const anos = Object.keys(doc.serie_temporal_total || {}).sort();
  const anoSel = S.anoSel || anos[anos.length - 1] || '2025';
  const selAno = document.getElementById('sel-ano');
  if (selAno) {
    selAno.innerHTML = anos.map(a => `<option value="${a}" ${a === anoSel ? 'selected' : ''}>${a}</option>`).join('');
  }
  populateCreDropdown();
  populateMunDropdown(S.creSel || null);
  const selCre = document.getElementById('sel-cre');
  if (selCre && S.creSel) selCre.value = S.creSel;
  bindTopbarFilters();
  bindRedeToggle();
  injectExportButtons();
}

/** Build choropleth map for Docência section */
function buildDocMap(doc) {
  const mapEl = document.getElementById('doc-map');
  if (!mapEl || !S.geo) return;

  destroyMap();

  const map = L.map(mapEl, { zoomControl: true, scrollWheelZoom: true, attributionControl: false }).setView([-29.7, -53.5], 6.5);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    maxZoom: 14
  }).addTo(map);

  const munData = doc.por_municipio_2025 || {};
  const lookup = doc.lookup_municipios || S.data?.lookup_municipios || {};
  const vals = Object.values(munData).map(v => v.docentes).filter(Boolean).sort((a,b)=>a-b);
  
  // Simple 3-tier thresholds for docent counts
  const tiers = [
    { min: 500, color: '#005A32', label: '≥ 500' },
    { min: 100, color: '#5cba68', label: '100 – 499' },
    { min: 1, color: '#d5efcf', label: '< 100' },
  ];
  const getDocColor = (v) => {
    for (const t of tiers) { if (v >= t.min) return t.color; }
    return '#f0f0f0';
  };

  const layer = L.geoJSON(S.geo, {
    style: (feature) => {
      const cod = feature.properties.cod_mun?.substring(0, 7);
      const v = munData[cod]?.docentes || 0;
      return { fillColor: getDocColor(v), fillOpacity: 0.85, weight: 0.8, color: '#fff' };
    },
    onEachFeature: (feature, layer) => {
      const cod = feature.properties.cod_mun?.substring(0, 7);
      const nome = lookup[cod] || feature.properties.NM_MUN || cod;
      const d = munData[cod] || {};
      layer.bindTooltip(`<strong>${nome}</strong><br>Escolas: ${d.escolas || 0}<br>Docentes: ${formatNum(d.docentes || 0)}`, { sticky: true });
      layer.on({
        mouseover: e => { e.target.setStyle({ weight: 2.5, color: '#FFB300', fillOpacity: 0.95 }); e.target.bringToFront(); },
        mouseout: e => { S.mapLayer.resetStyle(e.target); },
        click: () => {
          if (S.munSel === cod) { S.munSel = null; } else { S.munSel = cod; }
          refreshActiveTab();
        }
      });
    }
  }).addTo(map);

  // Legend — 3 tiers
  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = function () {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = `<h4>Docentes</h4>`;
    for (const t of tiers) {
      div.innerHTML += `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${t.color}"></div><span>${t.label}</span></div>`;
    }
    div.innerHTML += `<div class="map-legend-row" style="margin-top:4px"><div class="map-legend-swatch" style="background:#f0f0f0"></div><span>Sem dados</span></div>`;
    return div;
  };
  legend.addTo(map);

  S.map = map;
  S.mapLayer = layer;
  S.mapLegend = legend;
}

/** Build docent municipality table */
function buildDocMunTable(doc) {
  const tbody = document.getElementById('doc-mun-tbody');
  if (!tbody) return;
  const munData = doc.por_municipio_2025 || {};
  const lookup = doc.lookup_municipios || S.data?.lookup_municipios || {};
  
  let entries = Object.entries(munData);
  // Filter by CRE if selected
  if (S.creSel) {
    const creMuns = new Set(getCreMuns(S.creSel));
    entries = entries.filter(([cod]) => creMuns.has(cod));
  }
  
  const rows = entries
    .map(([cod, v]) => ({ cod, nome: lookup[cod] || `Cód. ${cod}`, ...v }))
    .sort((a, b) => b.docentes - a.docentes);

  tbody.innerHTML = rows.map((r, i) => `<tr data-cod="${r.cod}" style="cursor:pointer" title="Clique para filtrar por ${r.nome}">
    <td>${i + 1}</td><td><strong>${r.nome}</strong></td>
    <td>${r.escolas || 0}</td><td>${formatNum(r.docentes || 0)}</td>
  </tr>`).join('');

  // Click to filter
  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => {
      const cod = tr.dataset.cod;
      if (S.munSel === cod) { S.munSel = null; } else { S.munSel = cod; }
      refreshActiveTab();
    });
  });

  // Search
  const search = document.getElementById('doc-mun-search');
  if (search) {
    search.addEventListener('input', () => {
      const q = search.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      tbody.querySelectorAll('tr').forEach(tr => {
        const nome = tr.children[1]?.textContent.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') || '';
        tr.style.display = nome.includes(q) ? '' : 'none';
      });
    });
  }
}

function buildDocCharts(doc) {
  // Use municipality data if filtered, otherwise state-level
  let p;
  if (S.munSel && doc.por_municipio_2025?.[S.munSel]) {
    p = doc.por_municipio_2025[S.munSel];
    // The mun data uses the same structure: { docentes, por_sexo: {...}, por_escolaridade: {...}, ... }
    p.total = p.docentes || 0;
  } else {
    p = doc.perfil_2025;
  }
  if (!p) return;

  // Premium KPIs for Docentes — react to year filter
  const anosDoc = Object.keys(doc.serie_temporal_total || {}).sort();
  const anoSelDoc = S.anoSel && doc.serie_temporal_total?.[S.anoSel] ? S.anoSel : anosDoc[anosDoc.length - 1];
  const docAnoData = doc.serie_temporal_total[anoSelDoc] || {};
  const docTotal = p.total || 0;
  const docTotalAno = docAnoData['QT_DOC_BAS'] || docAnoData['total'] || docTotal;
  const sexoTotal = p.por_sexo ? Object.values(p.por_sexo).reduce((a, b) => a + b, 0) : docTotal;
  const razaoAno = doc.razao_aluno_professor?.[anoSelDoc]?.geral;
  const femPct = p.por_sexo ? (p.por_sexo.Feminino / sexoTotal * 100).toFixed(1) + '%' : '—';
  const supPct = p.por_escolaridade?.Superior ? (p.por_escolaridade.Superior / docTotal * 100).toFixed(1) + '%' : '—';
  const kpis = [
    { label: `Docentes (${anoSelDoc})`, value: formatNum(docTotalAno), icon: 'img/icons/professor.png', accent: 'green' },
    { label: `Aluno/Prof (${anoSelDoc})`, value: razaoAno ? razaoAno.toFixed(1) : '—', icon: 'img/icons/matriculas.png', accent: 'green' },
    { label: '% Feminino (2025)', value: femPct, icon: 'img/icons/social.png', accent: 'green' },
    { label: '% Superior (2025)', value: supPct, icon: 'img/icons/fundamental.png', accent: 'green' },
  ];
  const kpiEl = document.getElementById('doc-kpis');
  if (kpiEl) kpiEl.innerHTML = kpis.map((k, i) => `
    <div class="kpi-card accent-${k.accent}" style="animation-delay:${i * 80}ms">
      <div class="kpi-top">
        <span class="kpi-label">${k.label}</span>
        <img class="kpi-icon" src="${k.icon}" alt="${k.label}">
      </div>
      <div class="kpi-body">
        <span class="kpi-value">${k.value}</span>
      </div>
    </div>
  `).join('');

  // Doughnut helper
  const doughnut = (id, data, colors) => {
    const el = document.getElementById(id);
    if (!el || !data) return;
    S.charts.push(new Chart(el, {
      type: 'doughnut',
      data: { labels: Object.keys(data), datasets: [{ data: Object.values(data), backgroundColor: colors, borderColor: '#fff', borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '50%',
        plugins: { ...CHART_DEFAULTS.plugins, datalabels: DL_DONUT, tooltip: { ...CHART_DEFAULTS.plugins.tooltip,
          callbacks: { label: ctx => { const t = ctx.dataset.data.reduce((a,b)=>a+b,0); return ` ${ctx.label}: ${formatNum(ctx.parsed)} (${(ctx.parsed/t*100).toFixed(1)}%)`; } } } } }
    }));
  };

  doughnut('chart-doc-sexo', p.por_sexo, ['#E91E63CC','#1976D2CC','#9E9E9ECC']);
  // Filter out Terceirizado and CLT from vinculo
  const filteredVinculo = p.por_vinculo ? Object.fromEntries(Object.entries(p.por_vinculo).filter(([k]) => k !== 'Terceirizado' && k !== 'CLT')) : null;
  doughnut('chart-doc-vinculo', filteredVinculo, ['#2E7D32CC','#E65100CC']);

  // Bar for escolaridade
  const escoEl = document.getElementById('chart-doc-esco');
  if (escoEl && p.por_escolaridade) {
    S.charts.push(new Chart(escoEl, {
      type: 'bar',
      data: { labels: Object.keys(p.por_escolaridade), datasets: [{ data: Object.values(p.por_escolaridade), backgroundColor: '#1565C0CC', borderRadius: 6 }] },
      options: { ...CHART_DEFAULTS, layout: { padding: { bottom: 10, top: 20 } },
        plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_BAR },
        scales: { ...CHART_DEFAULTS.scales, x: { ...CHART_DEFAULTS.scales.x, ticks: { ...CHART_DEFAULTS.scales.x?.ticks, font: { family: 'Inter', size: 9 }, maxRotation: 35, minRotation: 15 } } } }
    }));
  }

  // Bar for faixa etaria
  const idadeEl = document.getElementById('chart-doc-idade');
  if (idadeEl && p.por_faixa_etaria) {
    S.charts.push(new Chart(idadeEl, {
      type: 'bar',
      data: { labels: Object.keys(p.por_faixa_etaria), datasets: [{ data: Object.values(p.por_faixa_etaria), backgroundColor: '#2E7D32CC', borderRadius: 6 }] },
      options: { ...CHART_DEFAULTS, layout: { padding: { bottom: 10, top: 20 } },
        plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_BAR },
        scales: { ...CHART_DEFAULTS.scales, x: { ...CHART_DEFAULTS.scales.x, ticks: { ...CHART_DEFAULTS.scales.x?.ticks, font: { family: 'Inter', size: 9 } } } } }
    }));
  }

  // Line: razao aluno/professor — municipality-aware
  const razaoEl = document.getElementById('chart-doc-razao');
  if (razaoEl && doc.razao_aluno_professor) {
    const anos = Object.keys(doc.razao_aluno_professor).sort();
    let razaoData;
    if (S.munSel && doc.serie_temporal_municipio) {
      razaoData = anos.map(a => doc.serie_temporal_municipio?.[a]?.[S.munSel]?.razao ?? null);
    } else if (S.creSel && doc.serie_temporal_municipio) {
      const creMuns = getCreMuns(S.creSel);
      razaoData = anos.map(a => {
        const ym = doc.serie_temporal_municipio?.[a] || {};
        let docT = 0, matT = 0;
        creMuns.forEach(c => { const m = ym[c]; if (m) { docT += m.docentes || 0; matT += m.matriculas || 0; } });
        return docT > 0 ? Math.round(matT / docT * 10) / 10 : null;
      });
    } else {
      razaoData = anos.map(a => doc.razao_aluno_professor[a]?.geral);
    }
    const validR = razaoData.filter(Boolean);
    const razaoMin = validR.length ? Math.floor(Math.min(...validR) - 1) : 0;
    const razaoMax = validR.length ? Math.ceil(Math.max(...validR) + 1) : 20;
    S.charts.push(new Chart(razaoEl, {
      type: 'line',
      data: { labels: anos, datasets: [{ label: 'Alunos por Professor', data: razaoData,
        borderColor: '#005A32', backgroundColor: '#005A3218', fill: true, tension: .35, pointRadius: 5, borderWidth: 2.5 }] },
      options: { ...CHART_DEFAULTS,
        plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false },
          datalabels: { display: true, anchor: 'end', align: 'top', offset: 3, font: { family: 'Inter', size: 10, weight: '700' }, color: '#005A32', formatter: v => v?.toFixed(1) ?? '' } },
        scales: { ...CHART_DEFAULTS.scales,
          y: { ...CHART_DEFAULTS.scales.y, beginAtZero: false, min: razaoMin, max: razaoMax,
            ticks: { ...CHART_DEFAULTS.scales.y.ticks, stepSize: 0.5, callback: v => v.toFixed(1) } } } }
    }));
  }

  // Docentes evolution line chart — municipality-aware
  const docEvoEl = document.getElementById('chart-doc-evo');
  if (docEvoEl && doc.serie_temporal_total) {
    const stt = doc.serie_temporal_total;
    const docAnos = Object.keys(stt).sort();
    let totalVals;
    if (S.munSel && doc.serie_temporal_municipio) {
      totalVals = docAnos.map(a => doc.serie_temporal_municipio?.[a]?.[S.munSel]?.docentes ?? 0);
    } else if (S.creSel && doc.serie_temporal_municipio) {
      const creMuns = getCreMuns(S.creSel);
      totalVals = docAnos.map(a => {
        const ym = doc.serie_temporal_municipio?.[a] || {};
        return creMuns.reduce((s, c) => s + (ym[c]?.docentes || 0), 0);
      });
    } else {
      totalVals = docAnos.map(a => stt[a]?.QT_DOC_BAS || 0);
    }
    S.charts.push(new Chart(docEvoEl, {
      type: 'line',
      data: { labels: docAnos, datasets: [
        { label: 'Total Docentes', data: totalVals, borderColor: COLORS.pri, backgroundColor: COLORS.pri + '18', fill: true, tension: .35, pointRadius: 4, borderWidth: 2 },
      ] },
      options: { ...CHART_DEFAULTS,
        layout: { padding: { top: 25 } },
        plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_LINE } }
    }));
  }
}

// ══════════════════════════════════════════════════════════
// FUNIL + TURMA
// ══════════════════════════════════════════════════════════

const FUNIL_LABELS = {
  '1_ano':'1° Ano','2_ano':'2° Ano','3_ano':'3° Ano','4_ano':'4° Ano','5_ano':'5° Ano',
  '6_ano':'6° Ano','7_ano':'7° Ano','8_ano':'8° Ano','9_ano':'9° Ano',
  'em_1':'1ª EM','em_2':'2ª EM','em_3':'3ª EM','em_4':'4ª EM'
};

function buildFunilTurma(ano) {
  if (!S.ftl) return;
  const ftl = S.ftl;

  // Funil chart
  const funilEl = document.getElementById('chart-funil');
  const funilLabel = document.getElementById('funil-ano-label');
  const turmaLabel = document.getElementById('turma-ano-label');
  if (funilLabel) funilLabel.textContent = ano;
  if (turmaLabel) turmaLabel.textContent = ano;

  if (funilEl && ftl.funil_por_serie[ano]) {
    const fd = ftl.funil_por_serie[ano];
    const keys = Object.keys(fd);
    const labels = keys.map(k => FUNIL_LABELS[k] || k);
    const values = keys.map(k => fd[k]);

    // Color: green for fundamental, blue-purple for EM
    const colors = keys.map(k => k.startsWith('em') ? '#6A1B9ACC' : '#2E7D32CC');

    S.charts.push(new Chart(funilEl, {
      type: 'bar',
      data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 6 }] },
      options: { ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_BAR,
        tooltip: { ...CHART_DEFAULTS.plugins.tooltip } },
        scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: true, suggestedMax: Math.max(...values) * 1.15 } } }
    }));
  }

  // Class size bar
  const turmaEl = document.getElementById('chart-turma');
  if (turmaEl && ftl.tamanho_turma[ano]) {
    const td = ftl.tamanho_turma[ano];
    const etapas = Object.keys(td);
    const medias = etapas.map(e => td[e].media_alunos);
    const turmaColors = ['#005A32CC','#2E7D32CC','#43A047CC','#66BB6ACC','#1565C0CC','#E65100CC'];

    S.charts.push(new Chart(turmaEl, {
      type: 'bar',
      data: { labels: etapas, datasets: [{ label: 'Alunos/Turma', data: medias, backgroundColor: turmaColors, borderRadius: 6 }] },
      options: { ...CHART_DEFAULTS, indexAxis: 'y', plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false },
        datalabels: { display: true, anchor: 'end', align: 'end', font: { family: 'Inter', size: 11, weight: '700' }, color: '#333', formatter: v => v?.toFixed(1) } },
        scales: { x: { grid: { color: COLORS.gridLine }, ticks: { font: { family: 'Inter', size: 10 } } },
                  y: { grid: { display: false }, ticks: { font: { family: 'Inter', size: 11 } } } } }
    }));
  }

  // Class size trend
  const trendEl = document.getElementById('chart-turma-trend');
  if (trendEl) {
    const anos = Object.keys(ftl.tamanho_turma).sort();
    const etapas = ['Ed. Infantil','Fund. Anos Iniciais','Fund. Anos Finais','Ens. Medio','EJA'];
    const tColors = ['#2E7D32','#43A047','#66BB6A','#1565C0','#E65100'];

    S.charts.push(new Chart(trendEl, {
      type: 'line',
      data: { labels: anos, datasets: etapas.map((et, i) => ({
        label: et, data: anos.map(a => ftl.tamanho_turma[a]?.[et]?.media_alunos || null),
        borderColor: tColors[i], backgroundColor: 'transparent', tension: .3, pointRadius: 4, borderWidth: 2,
      }))},
      options: { ...CHART_DEFAULTS, scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: false } } }
    }));
  }
}

// ══════════════════════════════════════════════════════════
// RENDER — DESIGUALDADES EDUCACIONAIS
// ══════════════════════════════════════════════════════════

function renderDesigualdades() {
  const ftl = S.ftl;
  const main = document.getElementById('main-content');
  destroyCharts(); destroyMap();

  const anos = Object.keys(ftl.localizacao_diferenciada).sort();
  const ultimo = anos[anos.length - 1];

  main.innerHTML = `
    ${sectionBanner('img/icons/nav_desigualdades.png', 'Desigualdades', 'Recortes Socioeconômicos', {redeToggle: false})}
    <div class="filter-bar">
      <label>Ano:</label>
      <select id="sel-desig-ano">
        ${anos.map(a => `<option value="${a}" ${a===ultimo?'selected':''}>${a}</option>`).join('')}
      </select>
    </div>

    <div class="kpi-strip" id="desig-kpis"></div>

    <h2 class="section-title">Localização Diferenciada</h2>
    <div class="charts-grid">
      <div class="chart-card d1">
        <div class="chart-title">Escolas em Localização Diferenciada — <span id="desig-ano-label">${ultimo}</span></div>
        <div style="height:300px"><canvas id="chart-desig-escolas"></canvas></div>
      </div>
      <div class="chart-card d2">
        <div class="chart-title">Matrículas em Localização Diferenciada</div>
        <div style="height:300px"><canvas id="chart-desig-mat"></canvas></div>
      </div>
    </div>

    <h2 class="section-title">Evolução Temporal</h2>
    <div class="charts-grid">
      <div class="chart-card full-width d3">
        <div class="chart-title">Escolas em Territórios Diferenciados — Série Histórica</div>
        <div style="height:300px"><canvas id="chart-desig-trend"></canvas></div>
      </div>
    </div>

    <h2 class="section-title">Detalhamento por Tipo</h2>
    <div class="table-wrapper d4">
      <div style="max-height:400px;overflow-y:auto">
        <table class="data-table" id="desig-table">
          <thead><tr><th>Tipo</th><th>Escolas</th><th>Matrículas</th><th>Média Alunos/Escola</th></tr></thead>
          <tbody id="desig-tbody"></tbody>
        </table>
      </div>
    </div>
  `;

  buildDesigCharts(ftl, ultimo);

  document.getElementById('sel-desig-ano').addEventListener('change', e => {
    destroyCharts();
    buildDesigCharts(ftl, e.target.value);
    injectExportButtons();
  });
  injectExportButtons();
}

function buildDesigCharts(ftl, ano) {
  const ld = ftl.localizacao_diferenciada[ano] || {};
  const dif = Object.entries(ld).filter(([k]) => !k.includes('Nenhuma'));
  const tipos = dif.map(([k]) => k);
  const escolas = dif.map(([,v]) => v.escolas);
  const mats = dif.map(([,v]) => v.matriculas);
  const totalEsc = escolas.reduce((a,b) => a+b, 0);
  const totalMat = mats.reduce((a,b) => a+b, 0);

  const label = document.getElementById('desig-ano-label');
  if (label) label.textContent = ano;

  // KPIs
  document.getElementById('desig-kpis').innerHTML = [
    { label: 'Escolas Diferenciadas', value: formatNum(totalEsc) },
    { label: 'Matrículas', value: formatNum(totalMat) },
    { label: 'Terra Indígena', value: formatNum(dif.find(([k])=>k.includes('Indigena'))?.[1]?.escolas || 0) + ' escolas' },
    { label: 'Quilombola', value: formatNum(dif.find(([k])=>k.includes('Quilombola'))?.[1]?.escolas || 0) + ' escolas' },
    { label: 'Assentamento', value: formatNum(dif.find(([k])=>k.includes('Assentamento'))?.[1]?.escolas || 0) + ' escolas' },
  ].map((k,i) => `<div class="kpi-card d${i+1}"><div class="kpi-label">${k.label}</div><div class="kpi-value">${k.value}</div></div>`).join('');

  const difColors = ['#C62828CC','#1565C0CC','#6A1B9ACC','#E65100CC','#00838FCC'];

  // Doughnut escolas
  S.charts.push(new Chart(document.getElementById('chart-desig-escolas'), {
    type: 'doughnut',
    data: { labels: tipos, datasets: [{ data: escolas, backgroundColor: difColors, borderColor: '#fff', borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '45%',
      plugins: { ...CHART_DEFAULTS.plugins, tooltip: { ...CHART_DEFAULTS.plugins.tooltip,
        callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} escolas (${(ctx.parsed/totalEsc*100).toFixed(1)}%)` } } } }
  }));

  // Doughnut matriculas
  S.charts.push(new Chart(document.getElementById('chart-desig-mat'), {
    type: 'doughnut',
    data: { labels: tipos, datasets: [{ data: mats, backgroundColor: difColors, borderColor: '#fff', borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '45%',
      plugins: { ...CHART_DEFAULTS.plugins, tooltip: { ...CHART_DEFAULTS.plugins.tooltip,
        callbacks: { label: ctx => ` ${ctx.label}: ${formatNum(ctx.parsed)} matrículas` } } } }
  }));

  // Trend
  const anos = Object.keys(ftl.localizacao_diferenciada).sort();
  const tiposAll = ['Terra Indigena','Quilombola','Area de Assentamento'];
  const trendColors = ['#C62828','#1565C0','#6A1B9A'];
  S.charts.push(new Chart(document.getElementById('chart-desig-trend'), {
    type: 'line',
    data: { labels: anos, datasets: tiposAll.map((t,i) => ({
      label: t, data: anos.map(a => ftl.localizacao_diferenciada[a]?.[t]?.escolas || 0),
      borderColor: trendColors[i], backgroundColor: 'transparent', tension: .3, pointRadius: 5, borderWidth: 2.5,
    }))},
    options: { ...CHART_DEFAULTS, scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: true } } }
  }));

  // Table
  const tbody = document.getElementById('desig-tbody');
  tbody.innerHTML = dif.map(([tipo, v]) => {
    const media = v.escolas > 0 ? Math.round(v.matriculas / v.escolas) : 0;
    return `<tr><td>${tipo}</td><td>${formatNum(v.escolas)}</td><td>${formatNum(v.matriculas)}</td><td>${media}</td></tr>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════
// IDEB / SAEB
// ══════════════════════════════════════════════════════════

const FONTE_SAEB = 'Fonte: Microdados SAEB — INEP';
const FONTE_IDEB = 'Fonte: IDEB/INEP — Divulgação 2023';

function renderSaeb() {
  const saeb = S.saeb;
  const main = document.getElementById('main-content');
  destroyCharts();
  destroyMap();

  // Guard: no SAEB data for this rede
  if (!saeb || !Object.keys(saeb.serie_temporal || {}).length) {
    main.innerHTML = `
      <div class="section-sticky">
        ${sectionBanner('img/icons/sec_saeb.png', 'SAEB', getRedeLabel() + ' do RS')}
        ${redeToggleHTML()}
      </div>
      <div style="text-align:center;padding:60px 20px;color:var(--text-sec);">
        <p style="font-size:1.1rem;font-weight:600;">Dados SAEB não disponíveis para a Rede ${getRedeLabel()}</p>
        <p style="font-size:0.85rem;margin-top:8px;">Escolas ${getRedeLabel().toLowerCase()} não participaram do SAEB nos anos disponíveis.</p>
      </div>`;
    bindRedeToggle();
    return;
  }

  const anos = Object.keys(saeb.serie_temporal).sort();
  const ultimo = (S.anoSel && anos.includes(S.anoSel)) ? S.anoSel : anos[anos.length - 1];
  const primeiro = anos[0];
  const su = saeb.serie_temporal[ultimo];
  const lookup = saeb.lookup_municipios || {};

  // Geo-aware data for KPIs
  let displaySu = su;
  let geoLabel = getRedeLabel() + ' do RS';
  if (S.munSel && saeb.por_municipio) {
    // Find closest year with mun data
    const munAnos = Object.keys(saeb.por_municipio).sort();
    const munAno = munAnos.includes(ultimo) ? ultimo : munAnos[munAnos.length - 1];
    const md = saeb.por_municipio[munAno]?.[S.munSel];
    if (md) { displaySu = md; geoLabel = lookup[S.munSel] || S.munSel; }
  } else if (S.creSel && saeb.por_municipio) {
    const creMuns = getCreMuns(S.creSel);
    const munAnos = Object.keys(saeb.por_municipio).sort();
    const munAno = munAnos.includes(ultimo) ? ultimo : munAnos[munAnos.length - 1];
    const munYear = saeb.por_municipio[munAno] || {};
    const agg = {};
    let count = 0;
    for (const cod of creMuns) {
      const m = munYear[cod]; if (!m) continue; count++;
      for (const et of ['5EF', '9EF', 'EM']) {
        if (!m[et]) continue;
        if (!agg[et]) agg[et] = { media_lp: 0, media_mt: 0, _n: 0 };
        agg[et].media_lp += m[et].media_lp || 0;
        agg[et].media_mt += m[et].media_mt || 0;
        agg[et]._n++;
      }
    }
    for (const et of Object.keys(agg)) {
      if (agg[et]._n > 0) { agg[et].media_lp = +(agg[et].media_lp / agg[et]._n).toFixed(1); agg[et].media_mt = +(agg[et].media_mt / agg[et]._n).toFixed(1); }
    }
    if (count > 0) { displaySu = agg; geoLabel = (S.creLookup?.cre_list?.find(c => c.cod_cre === S.creSel)?.nome_cre) || `CRE ${S.creSel}`; }
  }

  // KPI data
  const kpis = [];
  if (displaySu['5EF']) kpis.push({ label: '5º EF — LP', val: displaySu['5EF'].media_lp, accent: 'green', icon: 'img/icons/fundamental.png' });
  if (displaySu['5EF']) kpis.push({ label: '5º EF — MT', val: displaySu['5EF'].media_mt, accent: 'green', icon: 'img/icons/fundamental.png' });
  if (displaySu['9EF']) kpis.push({ label: '9º EF — LP', val: displaySu['9EF'].media_lp, accent: 'blue', icon: 'img/icons/fundamental.png' });
  if (displaySu['9EF']) kpis.push({ label: '9º EF — MT', val: displaySu['9EF'].media_mt, accent: 'blue', icon: 'img/icons/fundamental.png' });
  if (displaySu['EM']) kpis.push({ label: 'EM — LP', val: displaySu['EM'].media_lp, accent: 'red', icon: 'img/icons/medio.png' });
  if (displaySu['EM']) kpis.push({ label: 'EM — MT', val: displaySu['EM'].media_mt, accent: 'red', icon: 'img/icons/medio.png' });

  main.innerHTML = `
    <div class="section-sticky">
      ${sectionBanner('img/icons/sec_saeb.png', 'SAEB', geoLabel)}
      ${redeToggleHTML()}
      <div class="kpi-strip" id="saeb-kpis"></div>
    </div>

    <div style="background:var(--card-bg);border-left:3px solid var(--pri);border-radius:0 8px 8px 0;padding:10px 14px;margin:0 8px 10px;font-size:11px;color:var(--text-sec);line-height:1.5">
      <strong style="color:var(--text-pri)">📋 Nota Metodológica</strong><br>
      • <strong>Até 2015</strong>, o SAEB era composto pela <em>ANEB</em> (amostral, incluindo EM) e pela <em>Prova Brasil</em> (censitária, EF). A partir de <strong>2017</strong>, a <em>Portaria INEP nº 447/2017</em> tornou o SAEB <strong>censitário para o EM</strong>.<br>
      • <strong>"Estadual"</strong> neste painel = todas as escolas públicas (estaduais + municipais + federais), pois os microdados SAEB usam apenas a flag IN_PUBLICA (0/1).
    </div>

    <!-- ═══ EIXO: Proficiência — Série Histórica ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/sec_saeb.png" alt=""></span>
      <span class="section-divider-text">Proficiência SAEB — Série Histórica (${primeiro}–${ultimo})</span>
      <span class="section-divider-line"></span>
    </div>


    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title">Língua Portuguesa — Evolução por Etapa</div>
        <div style="height:240px"><canvas id="chart-saeb-lp"></canvas></div>
        <div class="chart-source">${FONTE_SAEB}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Matemática — Evolução por Etapa</div>
        <div style="height:240px"><canvas id="chart-saeb-mt"></canvas></div>
        <div class="chart-source">${FONTE_SAEB}</div>
      </div>
    </div>

    <!-- ═══ EIXO: Comparativo ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/sec_evolucao.png" alt=""></span>
      <span class="section-divider-text">Comparativo entre Edições</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="chart-card">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:6px">
          <div id="saeb-comp-title-lp" class="chart-title" style="margin:0">Língua Portuguesa — Comparativo</div>
          <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#555">
            <label>Ano base:</label>
            <select id="sel-saeb-comp-base" style="font-size:11px;padding:3px 8px;border-radius:4px;border:1px solid #ccc">
              ${anos.map(a => `<option value="${a}" ${a === primeiro ? 'selected' : ''}>${a}</option>`).join('')}
            </select>
            <label>vs</label>
            <select id="sel-saeb-comp-end" style="font-size:11px;padding:3px 8px;border-radius:4px;border:1px solid #ccc">
              ${anos.map(a => `<option value="${a}" ${a === ultimo ? 'selected' : ''}>${a}</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="height:200px"><canvas id="chart-saeb-comp-lp"></canvas></div>
        <div class="chart-source">${FONTE_SAEB}</div>
      </div>
      <div class="chart-card">
        <div id="saeb-comp-title-mt" class="chart-title">Matemática — Comparativo</div>
        <div style="height:200px"><canvas id="chart-saeb-comp-mt"></canvas></div>
        <div class="chart-source">${FONTE_SAEB}</div>
      </div>
    </div>

    <!-- ═══ EIXO: Participação ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/sec_infra.png" alt=""></span>
      <span class="section-divider-text">Escolas Avaliadas por Etapa</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title">Número de Escolas com Dados SAEB — Série Histórica</div>
        <div style="height:200px"><canvas id="chart-saeb-escolas"></canvas></div>
        <div class="chart-source">${FONTE_SAEB}</div>
      </div>
    </div>
  `;

  // ── Build SAEB KPIs ──
  const strip = document.getElementById('saeb-kpis');
  const suPrimo = saeb.serie_temporal[primeiro];
  strip.innerHTML = kpis.map((k, i) => {
    const etapaKey = k.label.includes('5') ? '5EF' : k.label.includes('9') ? '9EF' : 'EM';
    const isLP = k.label.includes('LP');
    const prevVal = isLP ? suPrimo?.[etapaKey]?.media_lp : suPrimo?.[etapaKey]?.media_mt;
    const delta = (k.val != null && prevVal != null) ? (k.val - prevVal) : null;
    const cls = delta !== null ? (delta >= 0 ? 'up' : 'down') : '';
    const arrow = delta !== null ? (delta >= 0 ? '↑' : '↓') : '';

    // Sparkline
    const sparkVals = anos.map(a => {
      const e = saeb.serie_temporal[a]?.[etapaKey];
      return isLP ? (e?.media_lp || 0) : (e?.media_mt || 0);
    }).filter(v => v > 0);
    const sparkMax = Math.max(...sparkVals, 1);
    const sparkMin = Math.min(...sparkVals);
    const sparkRange = sparkMax - sparkMin || 1;
    const sparkPts = sparkVals.map((v, j) => `${(j / Math.max(sparkVals.length - 1, 1)) * 58 + 1},${23 - ((v - sparkMin) / sparkRange) * 20}`).join(' ');
    const sparkColor = k.accent === 'green' ? COLORS.pri : k.accent === 'blue' ? '#1565C0' : COLORS.red;
    const sparkline = `<svg class="kpi-sparkline" viewBox="0 0 60 24" width="60" height="24"><polyline points="${sparkPts}" fill="none" stroke="${sparkColor}" stroke-width="1.5" stroke-linecap="round"/></svg>`;

    return `
    <div class="kpi-card accent-${k.accent}" style="animation-delay:${i * 80}ms">
      <div class="kpi-top">
        <span class="kpi-label">${k.label}</span>
        <img class="kpi-icon" src="${k.icon}" alt="">
      </div>
      <div class="kpi-body">
        <span class="kpi-value">${k.val?.toFixed(1) ?? '—'}</span>
        ${sparkline}
      </div>
      <div class="kpi-footer">
        <span class="kpi-delta ${cls}">${arrow} ${delta !== null ? (delta >= 0 ? '+' : '') + delta.toFixed(1) + 'pts' : ''}</span>
        <span class="kpi-abs">vs ${primeiro}</span>
      </div>
    </div>`;
  }).join('');

  // ── Line charts: LP and MT by etapa ──
  const etapas = ['5EF', '9EF', 'EM'];
  const etapaLabels = ['5º Ano EF', '9º Ano EF', 'Ens. Médio'];
  const etapaCores = [COLORS.pri, '#1565C0', COLORS.red];

  function buildLine(canvasId, field) {
    const el = document.getElementById(canvasId);
    if (!el) return;
    const datasets = etapas.map((et, i) => {
      const data = anos.map(a => saeb.serie_temporal[a]?.[et]?.[field] || null);
      return {
        label: etapaLabels[i],
        data: data,
        borderColor: etapaCores[i],
        backgroundColor: etapaCores[i] + '18',
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        borderWidth: 2.5,
        spanGaps: true,
      };
    });
    S.charts.push(new Chart(el, {
      type: 'line',
      data: { labels: anos, datasets },
      options: {
        ...CHART_DEFAULTS,
        plugins: {
          ...CHART_DEFAULTS.plugins,
          datalabels: {
            display: true,
            anchor: ctx => ctx.datasetIndex === 1 ? 'start' : 'end',
            align: ctx => ctx.datasetIndex === 1 ? 'bottom' : 'top',
            offset: 3,
            font: { family: 'Inter', size: 9.5, weight: '700' },
            color: ctx => etapaCores[ctx.datasetIndex],
            formatter: v => v?.toFixed(1) ?? '',
          },
        },
        scales: {
          ...CHART_DEFAULTS.scales,
          y: { ...CHART_DEFAULTS.scales.y, beginAtZero: false,
            ticks: { ...CHART_DEFAULTS.scales.y.ticks, stepSize: 10 } }
        }
      }
    }));
  }

  buildLine('chart-saeb-lp', 'media_lp');
  buildLine('chart-saeb-mt', 'media_mt');

  // ── Comparison bars: user-selectable years ──
  function buildSaebCompCharts(anoBase, anoComp) {
    // Destroy only comp charts
    S.charts = S.charts.filter(c => {
      if (c.canvas?.id === 'chart-saeb-comp-lp' || c.canvas?.id === 'chart-saeb-comp-mt') { c.destroy(); return false; }
      return true;
    });

    ['media_lp', 'media_mt'].forEach(field => {
      const canvasId = field === 'media_lp' ? 'chart-saeb-comp-lp' : 'chart-saeb-comp-mt';
      const el = document.getElementById(canvasId);
      if (!el) return;

      const etsAvail = etapas.filter(et => saeb.serie_temporal[anoComp]?.[et] || saeb.serie_temporal[anoBase]?.[et]);
      const labels = etsAvail.map(et => etapaLabels[etapas.indexOf(et)]);
      const dataBase = etsAvail.map(et => saeb.serie_temporal[anoBase]?.[et]?.[field] || 0);
      const dataComp = etsAvail.map(et => saeb.serie_temporal[anoComp]?.[et]?.[field] || 0);

      S.charts.push(new Chart(el, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: anoBase, data: dataBase, backgroundColor: 'rgba(180,180,180,.5)', borderColor: '#999', borderWidth: 1, borderRadius: 4, barPercentage: .7 },
            { label: anoComp, data: dataComp, backgroundColor: COLORS.pri + 'CC', borderColor: COLORS.pri, borderWidth: 1, borderRadius: 4, barPercentage: .7 },
          ]
        },
        options: {
          ...CHART_DEFAULTS,
          plugins: {
            ...CHART_DEFAULTS.plugins,
            datalabels: {
              display: true, anchor: 'end', align: 'top', offset: 3,
              font: { family: 'Inter', size: 11, weight: '700' },
              color: '#333',
              formatter: v => v?.toFixed(1) ?? '',
            },
          },
          scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: false,
            ticks: { ...CHART_DEFAULTS.scales.y.ticks, stepSize: 20 } } }
        }
      }));
    });

    // Update titles
    const titleLp = document.getElementById('saeb-comp-title-lp');
    if (titleLp) titleLp.textContent = `Língua Portuguesa — ${anoBase} vs ${anoComp}`;
    const titleMt = document.getElementById('saeb-comp-title-mt');
    if (titleMt) titleMt.textContent = `Matemática — ${anoBase} vs ${anoComp}`;
  }

  buildSaebCompCharts(primeiro, ultimo);

  // Bind year selectors
  const selCompBase = document.getElementById('sel-saeb-comp-base');
  const selCompEnd = document.getElementById('sel-saeb-comp-end');
  if (selCompBase && selCompEnd) {
    const onCompChange = () => buildSaebCompCharts(selCompBase.value, selCompEnd.value);
    selCompBase.addEventListener('change', onCompChange);
    selCompEnd.addEventListener('change', onCompChange);
  }

  // ── Schools evaluated bar chart ──
  const escolasEl = document.getElementById('chart-saeb-escolas');
  if (escolasEl) {
    S.charts.push(new Chart(escolasEl, {
      type: 'bar',
      data: {
        labels: anos,
        datasets: etapas.map((et, i) => ({
          label: etapaLabels[i],
          data: anos.map(a => saeb.serie_temporal[a]?.[et]?.n_escolas || 0),
          backgroundColor: etapaCores[i] + 'CC',
          borderColor: etapaCores[i],
          borderWidth: 1,
          borderRadius: 4,
        }))
      },
      options: {
        ...CHART_DEFAULTS,
        plugins: { ...CHART_DEFAULTS.plugins,
          datalabels: DL_BAR },
      }
    }));
  }

  // ── SAEB Map + Municipality Table (if per-municipality data available) ──
  const saebBuildMunSection = () => {
    const porMun = saeb.por_municipio || {};
    const anosComMun = Object.keys(porMun).sort();
    if (anosComMun.length === 0) return;

    const anoMapa = anosComMun[anosComMun.length - 1]; // most recent with mun data
    const munData = porMun[anoMapa] || {};
    const lookup = saeb.lookup_municipios || {};

    // Insert map + table HTML after existing charts
    const mapSection = document.createElement('div');
    mapSection.innerHTML = `
      <div class="section-divider">
        <span class="section-divider-icon"><img src="img/icons/sec_saeb.png" alt=""></span>
        <span class="section-divider-text">Mapa SAEB por Município — 9º Ano EF LP (${anoMapa})</span>
        <span class="section-divider-line"></span>
      </div>
      <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="chart-card" style="min-height:370px">
          <div id="saeb-map-leaflet" style="height:360px;border-radius:8px"></div>
        </div>
        <div class="chart-card" style="max-height:400px;overflow:auto">
          <div class="chart-title">Ranking Municipal — SAEB ${anoMapa}</div>
          <div style="margin-bottom:6px">
            <input type="text" id="saeb-mun-search" placeholder="Buscar município..." style="width:100%;padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:12px;font-family:Inter">
          </div>
          <table class="data-table" id="saeb-mun-table">
            <thead><tr>
              <th>#</th><th>Município</th><th>LP 5EF</th><th>MT 5EF</th><th>LP 9EF</th><th>MT 9EF</th>
            </tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
      <div style="font-size:10px;color:var(--text-sec);padding:4px 8px;font-style:italic">
        ℹ️ Dados municipais disponíveis apenas para anos com TS_MUNICÍPIO publicado pelo INEP (${anosComMun.join(', ')}).
        2023 usa código de município fictício nos microdados.
      </div>`;
    document.getElementById('main-content').appendChild(mapSection);

    // Build table
    const tbody = document.querySelector('#saeb-mun-table tbody');
    let entries = Object.entries(munData);
    if (S.creSel && S.creLookup?.mun_to_cre) {
      entries = entries.filter(([cod]) => S.creLookup.mun_to_cre[cod]?.cod_cre === S.creSel);
    }
    if (S.munSel) {
      entries = entries.filter(([cod]) => cod === S.munSel);
    }
    entries.sort((a, b) => (b[1]?.['9EF']?.media_lp || 0) - (a[1]?.['9EF']?.media_lp || 0));
    tbody.innerHTML = entries.map(([cod, md], i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${lookup[cod] || cod}</td>
        <td><strong>${md['5EF']?.media_lp?.toFixed(1) ?? '—'}</strong></td>
        <td>${md['5EF']?.media_mt?.toFixed(1) ?? '—'}</td>
        <td><strong>${md['9EF']?.media_lp?.toFixed(1) ?? '—'}</strong></td>
        <td>${md['9EF']?.media_mt?.toFixed(1) ?? '—'}</td>
      </tr>`).join('');

    document.getElementById('saeb-mun-search')?.addEventListener('input', e => {
      const q = e.target.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      tbody.querySelectorAll('tr').forEach(tr => {
        const nome = (tr.children[1]?.textContent || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        tr.style.display = nome.includes(q) ? '' : 'none';
      });
    });

    // Build map
    if (!S.geo) return;
    const SAEB_MAP_BREAKS = [
      { min: 0,   max: 200, color: '#C62828', label: '< 200 (Muito Crítico)' },
      { min: 200, max: 220, color: '#E65100', label: '200–220 (Crítico)' },
      { min: 220, max: 240, color: '#F9A825', label: '220–240 (Atenção)' },
      { min: 240, max: 260, color: '#66BB6A', label: '240–260 (Adequado)' },
      { min: 260, max: 999, color: '#2E7D32', label: '> 260 (Avançado)' },
    ];
    function getSaebColor(v) {
      for (const b of SAEB_MAP_BREAKS) { if (v >= b.min && v < b.max) return b.color; }
      return '#f0f0f0';
    }

    destroyMap();
    S.map = L.map('saeb-map-leaflet', { zoomControl: true, scrollWheelZoom: true, attributionControl: false })
      .setView([-29.7, -53.5], 6.5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', { maxZoom: 14 }).addTo(S.map);

    const info = L.control({ position: 'topright' });
    info.onAdd = function () { this._div = L.DomUtil.create('div', 'map-info-panel'); this.update(); return this._div; };
    info.update = function (props, md) {
      if (!props) { this._div.innerHTML = '<h4>Passe o mouse sobre um município</h4>'; return; }
      const nome = props.nome || props.cod_mun;
      if (!md) { this._div.innerHTML = `<h4>${nome}</h4><div style="color:#999;font-size:11px">Sem dados SAEB</div>`; return; }
      this._div.innerHTML = `
        <h4>${nome}</h4>
        ${md['5EF'] ? `<div class="info-row"><span class="info-label">5EF LP</span><span class="info-value">${md['5EF'].media_lp?.toFixed(1)}</span></div>
        <div class="info-row"><span class="info-label">5EF MT</span><span class="info-value">${md['5EF'].media_mt?.toFixed(1)}</span></div>` : ''}
        ${md['9EF'] ? `<div class="info-row"><span class="info-label">9EF LP</span><span class="info-value">${md['9EF'].media_lp?.toFixed(1)}</span></div>
        <div class="info-row"><span class="info-label">9EF MT</span><span class="info-value">${md['9EF'].media_mt?.toFixed(1)}</span></div>` : ''}
        ${md['EM'] ? `<div class="info-row"><span class="info-label">EM LP</span><span class="info-value">${md['EM'].media_lp?.toFixed(1)}</span></div>
        <div class="info-row"><span class="info-label">EM MT</span><span class="info-value">${md['EM'].media_mt?.toFixed(1)}</span></div>` : ''}`;
    };
    info.addTo(S.map);

    S.mapLayer = L.geoJSON(S.geo, {
      style: feature => {
        const cod = feature.properties.cod_mun?.substring(0, 7);
        const md = munData[cod];
        const v = md?.['9EF']?.media_lp || 0;
        return { fillColor: v > 0 ? getSaebColor(v) : '#f0f0f0', weight: 0.8, opacity: 1, color: '#fff', fillOpacity: 0.85 };
      },
      onEachFeature: (feature, layer) => {
        const cod = feature.properties.cod_mun?.substring(0, 7);
        const md = munData[cod];
        layer.on({
          mouseover: e => { e.target.setStyle({ weight: 2.5, color: '#FFB300', fillOpacity: 0.95 }); e.target.bringToFront(); info.update(feature.properties, md); },
          mouseout: e => { S.mapLayer.resetStyle(e.target); info.update(); },
        });
      }
    }).addTo(S.map);

    const legend = L.control({ position: 'bottomleft' });
    legend.onAdd = function () {
      const div = L.DomUtil.create('div', 'map-legend');
      div.innerHTML = '<h4>SAEB 9º EF LP</h4>' +
        SAEB_MAP_BREAKS.slice().reverse().map(b =>
          `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${b.color}"></div><span>${b.label}</span></div>`
        ).join('') + '<div class="map-legend-row" style="margin-top:4px"><div class="map-legend-swatch" style="background:#f0f0f0"></div><span>Sem dados</span></div>';
      return div;
    };
    legend.addTo(S.map);
  };

  saebBuildMunSection();
  injectExportButtons();

  // Re-populate topbar filters
  const selAno = document.getElementById('sel-ano');
  if (selAno) {
    selAno.innerHTML = anos.map(a => `<option value="${a}" ${a === ultimo ? 'selected' : ''}>${a}</option>`).join('');
  }
  populateCreDropdown();
  populateMunDropdown(S.creSel || null);
  const selCre = document.getElementById('sel-cre');
  if (selCre && S.creSel) selCre.value = S.creSel;
  const selMun = document.getElementById('sel-mun');
  if (selMun && S.munSel) selMun.value = S.munSel;
  bindTopbarFilters();
  bindRedeToggle();
  updateActiveFilters();
}

// ══════════════════════════════════════════════════════════
// IDEB
// ══════════════════════════════════════════════════════════

function renderIdeb() {
  const ideb = S.ideb;
  const main = document.getElementById('main-content');
  destroyCharts();
  destroyMap();

  if (!ideb || !Object.keys(ideb.serie_temporal || {}).length) {
    main.innerHTML = `
      <div class="section-sticky">
        ${sectionBanner('img/icons/nav_ideb.png', 'IDEB', getRedeLabel() + ' do RS')}
        ${redeToggleHTML()}
      </div>
      <div style="text-align:center;padding:60px 20px;color:var(--text-sec);">
        <p style="font-size:1.1rem;font-weight:600;">Dados IDEB não disponíveis para a Rede ${getRedeLabel()}</p>
      </div>`;
    bindRedeToggle();
    return;
  }

  const anos = Object.keys(ideb.serie_temporal).sort();
  const ultimo = anos[anos.length - 1];
  const penultimo = anos.length >= 2 ? anos[anos.length - 2] : null;
  const su = ideb.serie_temporal[ultimo] || {};
  const prev = penultimo ? (ideb.serie_temporal[penultimo] || {}) : {};

  // KPIs
  const etapaMap = { AI: { label: 'Anos Iniciais', icon: 'img/icons/fundamental.png', accent: 'green' }, AF: { label: 'Anos Finais', icon: 'img/icons/fundamental.png', accent: 'blue' }, EM: { label: 'Ensino Médio', icon: 'img/icons/medio.png', accent: 'red' } };
  const kpis = [];
  for (const [ek, cfg] of Object.entries(etapaMap)) {
    const d = su[ek];
    if (!d) continue;
    const p = prev[ek];
    const delta = p ? +(d.ideb - p.ideb).toFixed(2) : null;
    kpis.push({ label: `IDEB ${cfg.label}`, val: d.ideb?.toFixed(1), accent: cfg.accent, icon: cfg.icon, sub: delta !== null ? `${delta >= 0 ? '+' : ''}${delta} vs ${penultimo}` : `${d.n_escolas} escolas`, meta: d.meta });
  }

  const geoLabel = getRedeLabel() + ' do RS';

  main.innerHTML = `
    <div class="section-sticky">
      ${sectionBanner('img/icons/nav_ideb.png', 'IDEB', geoLabel)}
      ${redeToggleHTML()}
      <div class="kpi-strip" id="ideb-kpis"></div>
    </div>

    <div style="background:var(--card-bg);border-left:3px solid var(--pri);border-radius:0 8px 8px 0;padding:10px 14px;margin:0 8px 10px;font-size:11px;color:var(--text-sec);line-height:1.5">
      <strong style="color:var(--text-pri)">📋 Nota Metodológica</strong><br>
      • O <strong>IDEB</strong> é calculado como <strong>N × P</strong> (Nota SAEB padronizada × Indicador de Rendimento/aprovação). Varia de 0 a 10.<br>
      • <strong>Até 2015</strong>, o SAEB era composto pela <em>ANEB</em> (amostral, incluindo EM) e pela <em>Prova Brasil</em> (censitária, EF). A partir de <strong>2017</strong>, a <em>Portaria INEP nº 447/2017</em> tornou o SAEB <strong>censitário para o EM</strong>.<br>
      • A <strong>linha tracejada</strong> nos gráficos indica as <strong>metas projetadas</strong> pelo MEC para cada edição.
    </div>

    <!-- ═══ EIXO: IDEB — Evolução ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/sec_evolucao.png" alt=""></span>
      <span class="section-divider-text">IDEB — Evolução por Etapa (${anos[0]}–${ultimo})</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title">IDEB Observado × Meta Projetada</div>
        <div style="height:280px"><canvas id="chart-ideb-evolucao"></canvas></div>
        <div class="chart-source">${FONTE_IDEB}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Decomposição IDEB — Nota SAEB (N) × Rendimento (P)</div>
        <div style="height:280px"><canvas id="chart-ideb-decomp"></canvas></div>
        <div class="chart-source">${FONTE_IDEB}</div>
      </div>
    </div>
  `;

  // ── Build IDEB KPIs ──
  const strip = document.getElementById('ideb-kpis');
  if (strip) {
    strip.innerHTML = kpis.map((k, i) => {
      const cls = k.sub?.startsWith('+') ? 'up' : k.sub?.startsWith('-') ? 'down' : '';
      return `
      <div class="kpi-card accent-${k.accent}" style="animation-delay:${i * 80}ms">
        <div class="kpi-top">
          <span class="kpi-label">${k.label}</span>
          <img class="kpi-icon" src="${k.icon}" alt="">
        </div>
        <div class="kpi-body">
          <span class="kpi-value">${k.val ?? '—'}</span>
        </div>
        <div class="kpi-footer">
          <span class="kpi-delta ${cls}">${k.sub || ''}</span>
          <span class="kpi-abs">${ultimo}</span>
        </div>
      </div>`;
    }).join('');
  }

  // ── IDEB Charts ──
  const idebEtapas = ['AI', 'AF', 'EM'];
  const idebLabels = ['Anos Iniciais', 'Anos Finais', 'Ens. Médio'];
  const idebCores = [COLORS.pri, '#1565C0', COLORS.red];

  // Chart 1: Evolution with projected targets
  const elEvo = document.getElementById('chart-ideb-evolucao');
  if (elEvo) {
    const datasets = [];
    idebEtapas.forEach((et, i) => {
      const dataObs = anos.map(a => ideb.serie_temporal[a]?.[et]?.ideb ?? null);
      datasets.push({
        label: idebLabels[i], data: dataObs,
        borderColor: idebCores[i], backgroundColor: idebCores[i] + '18',
        borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderWidth: 2,
        tension: .3, spanGaps: true,
      });
      const dataMeta = anos.map(a => ideb.serie_temporal[a]?.[et]?.meta ?? null);
      if (dataMeta.some(v => v != null)) {
        datasets.push({
          label: `Meta ${idebLabels[i]}`, data: dataMeta,
          borderColor: idebCores[i] + '66', borderWidth: 1.5, borderDash: [6, 4],
          pointRadius: 2, pointBackgroundColor: idebCores[i] + '66', tension: .3, spanGaps: true,
        });
      }
    });
    S.charts.push(new Chart(elEvo, {
      type: 'line',
      data: { labels: anos, datasets },
      options: {
        ...CHART_DEFAULTS,
        plugins: {
          ...CHART_DEFAULTS.plugins,
          datalabels: {
            display: ctx => !ctx.dataset.borderDash,
            anchor: ctx => ctx.datasetIndex >= 2 ? 'start' : 'end',
            align: ctx => ctx.datasetIndex >= 2 ? 'bottom' : 'top',
            offset: 3,
            font: { family: 'Inter', size: 10, weight: '700' },
            color: ctx => {
              const idx = ctx.datasetIndex;
              return idx === 0 ? idebCores[0] : idx === 2 ? idebCores[1] : idx === 4 ? idebCores[2] : '#999';
            },
            formatter: v => v?.toFixed(1) ?? '',
          },
        },
        scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: false, min: 2, suggestedMax: 8 } },
      },
    }));
  }

  // Chart 2: Decomposition N × P (grouped bars)
  const elDecomp = document.getElementById('chart-ideb-decomp');
  if (elDecomp) {
    const datasets = [];
    idebEtapas.forEach((et, i) => {
      const dataNota = anos.map(a => {
        const d = ideb.serie_temporal[a]?.[et];
        return d?.nota_saeb ? +(d.nota_saeb / 10).toFixed(2) : null;
      });
      const dataRend = anos.map(a => {
        const d = ideb.serie_temporal[a]?.[et];
        return d?.rendimento ? +(d.rendimento * 10).toFixed(2) : null;
      });
      datasets.push({
        label: `N - ${idebLabels[i]}`, data: dataNota,
        backgroundColor: idebCores[i] + 'AA', borderColor: idebCores[i],
        borderWidth: 1, borderRadius: 3, barPercentage: .7, categoryPercentage: .8,
      });
      datasets.push({
        label: `P - ${idebLabels[i]}`, data: dataRend,
        backgroundColor: idebCores[i] + '44', borderColor: idebCores[i] + '88',
        borderWidth: 1, borderRadius: 3, barPercentage: .7, categoryPercentage: .8,
      });
    });
    S.charts.push(new Chart(elDecomp, {
      type: 'bar',
      data: { labels: anos, datasets },
      options: {
        ...CHART_DEFAULTS,
        plugins: {
          ...CHART_DEFAULTS.plugins,
          datalabels: { display: false },
          legend: { display: true, position: 'bottom', labels: { font: { size: 9 }, boxWidth: 10, padding: 6 } },
        },
        scales: {
          ...CHART_DEFAULTS.scales,
          y: { ...CHART_DEFAULTS.scales.y, beginAtZero: false, min: 3, suggestedMax: 10,
            title: { display: true, text: 'N (÷10) e P (×10)', font: { size: 9 } } },
        },
      },
    }));
  }

  injectExportButtons();
  bindRedeToggle();
  updateActiveFilters();
}

// ══════════════════════════════════════════════════════════
// NAV TABS
// ══════════════════════════════════════════════════════════

function renderHome() {
  const main = document.getElementById('main-content');
  destroyCharts();
  destroyMap();
  document.body.classList.add('sidebar-hidden');
  const sections = [
    { view: 'acesso', icon: 'img/icons/nav_acesso.png', title: 'Acesso e Matrículas',
      desc: 'Evolução de matrículas, escolas e etapas de ensino na rede estadual do RS.',
      status: 'active', statusLabel: 'V1 disponível', accent: '#00AB4E' },
    { view: 'infra', icon: 'img/icons/nav_infra.png', title: 'Infraestrutura',
      desc: 'Infraestrutura escolar — tecnologia, espaços, acessibilidade e saneamento.',
      status: 'active', statusLabel: 'V1 disponível', accent: '#00AB4E' },
    { view: 'icg', icon: 'img/icons/escola.png', title: 'Complexidade de Gestão',
      desc: 'Indicador de complexidade da gestão escolar — porte, turnos, etapas e série histórica 2013–2025.',
      status: 'active', statusLabel: 'V1 disponível', accent: '#00AB4E' },
    { view: 'inse', icon: 'img/icons/nav_desigualdades.png', title: 'Contexto Socioeconômico (INSE)',
      desc: 'Indicador de Nível Socioeconômico — perfil das famílias, distribuição por nível e evolução 2019–2023.',
      status: 'wip', statusLabel: 'Em construção', accent: '#FB8C00' },
    { view: 'docencia', icon: 'img/icons/sec_docentes.png', title: 'Docência',
      desc: 'Perfil docente, escolaridade, vínculo e razão aluno/professor.',
      status: 'active', statusLabel: 'V1 disponível', accent: '#00AB4E' },
    { view: 'afd', icon: 'img/icons/sec_docentes.png', title: 'Formação Docente (AFD)',
      desc: 'Percentual de docentes com formação adequada à disciplina que lecionam, por etapa e grupo.',
      status: 'active', statusLabel: 'V1 disponível', accent: '#00AB4E' },
    { view: 'fluxo', icon: 'img/icons/nav_fluxo.png', title: 'Fluxo e Rendimento',
      desc: 'Taxas de aprovação, reprovação, abandono e distorção idade-série.',
      status: 'active', statusLabel: 'V1 disponível', accent: '#00AB4E' },
    { view: 'saeb', icon: 'img/icons/sec_saeb.png', title: 'SAEB',
      desc: 'Proficiências em Língua Portuguesa e Matemática — série histórica 2013–2023.',
      status: 'active', statusLabel: 'V1 disponível', accent: '#00AB4E' },
    { view: 'ideb', icon: 'img/icons/nav_ideb.png', title: 'IDEB',
      desc: 'Índice de Desenvolvimento da Educação Básica — evolução, metas projetadas e decomposição N×P.',
      status: 'active', statusLabel: 'V1 disponível', accent: '#00AB4E' },
  ];

  main.innerHTML = `
    <div class="home-wrap">
      <div class="home-bg"></div>
      <div class="home-content">

        <div class="home-hero" style="margin-bottom:28px">
          <div class="home-hero-badge">Secretaria da Educação do Rio Grande do Sul</div>
          <h1>Painel de <span>Indicadores Educacionais</span></h1>
          <p class="home-hero-sub">
            Plataforma analítica com dados abertos da rede estadual do Rio Grande do Sul
          </p>
        </div>

        <div class="home-divider" style="margin:20px 0 16px">
          <span class="home-divider-line"></span>
          <span class="home-divider-text">Explorar Seções</span>
          <span class="home-divider-line"></span>
        </div>

        <div class="home-grid" style="grid-template-columns:repeat(4,1fr)">
          ${sections.map(s => `
            <div class="home-card" data-nav="${s.view}" style="--card-accent:${s.accent}">
              <div class="home-card-icon"><img src="${s.icon}" alt=""></div>
              <div class="home-card-title">${s.title}</div>
              <div class="home-card-desc">${s.desc}</div>
              <span class="home-card-status ${s.status}">● ${s.statusLabel}</span>
            </div>
          `).join('')}
        </div>

        <div class="home-footer" style="margin-top:32px">
          <div class="home-footer-text">
            Dados: INEP — Censo Escolar da Educação Básica & Microdados SAEB<br>
            Desenvolvido no âmbito do contrato UNESCO / SEDUC-RS
          </div>
          <div class="home-footer-logos">
            <img src="img/logo_rs.avif" alt="Governo RS" style="height:48px" onerror="this.style.display='none'">
            <img src="img/logo_cebe.png" alt="CEBE" style="height:48px" onerror="this.style.display='none'">
          </div>
        </div>

      </div>
    </div>
  `;

  // Make cards clickable → navigate to section
  main.querySelectorAll('.home-card[data-nav]').forEach(card => {
    card.addEventListener('click', () => {
      const view = card.dataset.nav;
      const tab = document.querySelector(`.sidebar-tab[data-view="${view}"]`);
      if (tab) tab.click();
    });
  });
}

// ══════════════════════════════════════════════════════════
// FLUXO E RENDIMENTO
// ══════════════════════════════════════════════════════════

const FONTE_REND = 'Fonte: INEP — Indicadores Educacionais';

/** Aggregate fluxo rates for a CRE (simple average of municipality percentages) */
function aggregateCreFluxo(f, ano, creCod) {
  const muns = getCreMuns(creCod);
  const munData = f.por_municipio[ano] || {};
  const keys = ['aprov_fund','aprov_fund_ai','aprov_fund_af','aprov_med','reprov_fund','reprov_fund_ai','reprov_fund_af','reprov_med','aband_fund','aband_fund_ai','aband_fund_af','aband_med'];
  const sums = {}; const counts = {};
  for (const cod of muns) {
    const m = munData[cod];
    if (!m) continue;
    for (const k of keys) {
      if (m[k] != null) { sums[k] = (sums[k] || 0) + m[k]; counts[k] = (counts[k] || 0) + 1; }
    }
  }
  const result = {};
  for (const k of keys) { result[k] = counts[k] ? +(sums[k] / counts[k]).toFixed(1) : null; }
  return result;
}

function aggregateCreTdi(f, creCod) {
  const muns = getCreMuns(creCod);
  const tdi = f.tdi_por_municipio || {};
  const keys = ['tdi_fund','tdi_fund_ai','tdi_fund_af','tdi_med'];
  const sums = {}; const counts = {};
  for (const cod of muns) {
    const m = tdi[cod];
    if (!m) continue;
    for (const k of keys) {
      if (m[k] != null) { sums[k] = (sums[k] || 0) + m[k]; counts[k] = (counts[k] || 0) + 1; }
    }
  }
  const result = {};
  for (const k of keys) { result[k] = counts[k] ? +(sums[k] / counts[k]).toFixed(1) : null; }
  return result;
}

/** Fluxo map metric definitions */
const FLUXO_MAP_METRICS = [
  { key: 'aprov_fund', label: 'Aprovação Fund. (%)', higher: true },
  { key: 'aprov_med', label: 'Aprovação Médio (%)', higher: true },
  { key: 'reprov_fund', label: 'Reprovação Fund. (%)', higher: false },
  { key: 'aband_med', label: 'Abandono Médio (%)', higher: false },
  { key: 'tdi_fund', label: 'TDI Fund. (%)', higher: false, tdi: true },
];

function renderFluxo() {
  const f = S.fluxo;
  if (!f || !Object.keys(f.serie_temporal || {}).length) {
    const main = document.getElementById('main-content');
    destroyCharts(); destroyMap();
    main.innerHTML = `
      <div class="section-sticky">
        ${sectionBanner('img/icons/nav_fluxo.png', 'Fluxo e Rendimento', getRedeLabel() + ' do RS')}
        ${redeToggleHTML()}
      </div>
      <div style="text-align:center;padding:60px 20px;color:var(--text-sec);">
        <p style="font-size:1.1rem;font-weight:600;">Dados de Fluxo e Rendimento não disponíveis para a Rede ${getRedeLabel()}</p>
      </div>`;
    bindRedeToggle();
    return;
  }
  const anos = Object.keys(f.serie_temporal).sort();
  const anoSel = anos.includes(S.anoSel) ? S.anoSel : anos[anos.length - 1];
  const lookup = f.lookup_municipios || {};
  const main = document.getElementById('main-content');
  destroyCharts(); destroyMap();

  // Determine current data source (state / CRE / municipality)
  let st, tdiSrc, geoLabel = getRedeLabel();
  if (S.munSel && f.por_municipio[anoSel]?.[S.munSel]) {
    st = f.por_municipio[anoSel][S.munSel];
    tdiSrc = f.tdi_por_municipio?.[S.munSel] || f.tdi_estadual || {};
    geoLabel = lookup[S.munSel] || S.munSel;
  } else if (S.creSel) {
    st = aggregateCreFluxo(f, anoSel, S.creSel);
    tdiSrc = aggregateCreTdi(f, S.creSel);
    const creName = S.creLookup?.cre_list?.find(c => c.cod_cre === S.creSel)?.nome_cre || `CRE ${S.creSel}`;
    geoLabel = creName;
  } else {
    st = f.serie_temporal[anoSel] || {};
    tdiSrc = f.tdi_estadual || {};
  }

  main.innerHTML = `
    <div class="section-sticky">
      ${sectionBanner('img/icons/nav_fluxo.png', 'Fluxo e Rendimento', geoLabel)}
      ${redeToggleHTML()}
      <div id="fluxo-kpi-strip" class="kpi-strip" style="grid-template-columns:repeat(6,1fr)"></div>
    </div>

    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/panorama.png" alt=""></span>
      <span class="section-divider-text">Evolução Temporal</span>
      <span class="section-divider-line"></span>
    </div>
    <div class="charts-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
      <div class="chart-card d1">
        <div class="chart-title">Aprovação Fund. AI (%)</div>
        <div style="height:220px"><canvas id="flx-chart-aprov-ai"></canvas></div>
        <div class="chart-source">${FONTE_REND}</div>
      </div>
      <div class="chart-card d2">
        <div class="chart-title">Aprovação Fund. AF (%)</div>
        <div style="height:220px"><canvas id="flx-chart-aprov-af"></canvas></div>
        <div class="chart-source">${FONTE_REND}</div>
      </div>
      <div class="chart-card d3">
        <div class="chart-title">Aprovação Médio (%)</div>
        <div style="height:220px"><canvas id="flx-chart-aprov-med"></canvas></div>
        <div class="chart-source">${FONTE_REND}</div>
      </div>
    </div>
    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="chart-card d4">
        <div class="chart-title">Reprovação e Abandono — Fundamental (%)</div>
        <div style="height:220px"><canvas id="flx-chart-repab-fund"></canvas></div>
        <div class="chart-source">${FONTE_REND}</div>
      </div>
      <div class="chart-card d5">
        <div class="chart-title">Reprovação e Abandono — Médio (%)</div>
        <div style="height:220px"><canvas id="flx-chart-repab-med"></canvas></div>
        <div class="chart-source">${FONTE_REND}</div>
      </div>
    </div>

    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/social.png" alt=""></span>
      <span class="section-divider-text">Detalhamento por Etapa — ${anoSel}</span>
      <span class="section-divider-line"></span>
    </div>
    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="chart-card d3">
        <div class="chart-title" id="flx-title-etapa">Taxas por Etapa — ${geoLabel} — ${anoSel}</div>
        <div style="height:220px"><canvas id="flx-chart-etapa"></canvas></div>
        <div class="chart-source">${FONTE_REND}</div>
      </div>
      <div class="chart-card d4">
        <div class="chart-title" id="flx-title-tdi">Distorção Idade-Série (%) — ${geoLabel} — ${f.tdi_ano || anoSel}</div>
        <div style="height:220px"><canvas id="flx-chart-tdi"></canvas></div>
        <div class="chart-source">${FONTE_REND}</div>
      </div>
    </div>

    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/territorial.png" alt=""></span>
      <span class="section-divider-text">Distribuição Territorial</span>
      <span class="section-divider-line"></span>
    </div>
    <div class="map-table-row d1">
      <div class="map-container">
        <div class="map-toolbar">
          <h3>Mapa — ${anoSel}</h3>
          <select id="flx-map-metric">
            ${FLUXO_MAP_METRICS.map(m => `<option value="${m.key}">${m.label}</option>`).join('')}
          </select>
        </div>
        <div id="flx-map-leaflet" style="height:480px;width:100%;background:var(--bg)"></div>
      </div>
      <div class="table-wrapper" id="flx-table-wrapper">
        <div class="table-header">
          <h3>Ranking de Municípios</h3>
          <input type="text" class="table-search" id="flx-mun-search" placeholder="Buscar...">
        </div>
        <div style="font-size:10px;color:var(--accent);padding:4px 12px 6px;font-weight:600;background:rgba(255,203,4,.08);border-radius:0 0 6px 6px;border-top:1px dashed rgba(255,203,4,.3)">
          📍 Clique em qualquer município — na tabela ou no mapa — para filtrar <strong>todas as visualizações</strong> desta seção.
        </div>
        <div style="max-height:400px;overflow-y:auto">
          <table class="data-table" id="flx-mun-table">
            <thead><tr>
              <th>#</th><th>Município</th><th>Aprov.F</th><th>Aprov.M</th><th>Reprov.F</th><th>Aband.M</th><th>TDI.F</th>
            </tr></thead>
            <tbody id="flx-mun-tbody"></tbody>
          </table>
        </div>
        <div class="chart-source">${FONTE_REND}</div>
      </div>
    </div>
  `;

  // Build KPIs
  fluxoUpdateKPIs(st, tdiSrc, f, anos, anoSel);
  // Build Charts — need to build per-year data source for time-series
  fluxoBuildCharts(f, anos, anoSel, st, tdiSrc);
  // Build Map
  buildFluxoMap(f, anoSel, 'aprov_fund');
  // Build Table
  fluxoBuildMunTable(f, anoSel, lookup);
  // Bind map metric
  const selMetric = document.getElementById('flx-map-metric');
  if (selMetric) selMetric.addEventListener('change', () => buildFluxoMap(f, anoSel, selMetric.value));

  injectExportButtons();

  // Re-populate banner dropdowns
  const selAno = document.getElementById('sel-ano');
  if (selAno) {
    selAno.innerHTML = anos.map(a => `<option value="${a}" ${a === anoSel ? 'selected' : ''}>${a}</option>`).join('');
  }
  populateCreDropdown();
  populateMunDropdown(S.creSel || null);
  const selCre = document.getElementById('sel-cre');
  if (selCre && S.creSel) selCre.value = S.creSel;
  bindTopbarFilters();
  bindRedeToggle();
  updateActiveFilters();
}

function fluxoUpdateKPIs(st, tdiSrc, f, anos, anoSel) {
  const strip = document.getElementById('fluxo-kpi-strip');
  if (!strip) return;

  // Sparkline data
  const getSparkVals = (key) => {
    if (!anos) return [];
    if (S.munSel) return anos.map(a => f?.por_municipio[a]?.[S.munSel]?.[key] ?? null);
    if (S.creSel) return anos.map(a => aggregateCreFluxo(f, a, S.creSel)?.[key] ?? null);
    return anos.map(a => f?.serie_temporal[a]?.[key] ?? null);
  };

  function buildSparkPct(key, color) {
    const vals = getSparkVals(key).filter(v => v != null);
    if (vals.length < 2) return '';
    const max = Math.max(...vals); const min = Math.min(...vals);
    const range = max - min || 1;
    const w = 60, h = 24, pad = 2;
    const points = vals.map((v, i) => {
      const x = pad + (i / (vals.length - 1)) * (w - pad * 2);
      const y = pad + (1 - (v - min) / range) * (h - pad * 2);
      return `${x},${y}`;
    }).join(' ');
    return `<svg class="kpi-sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  // Previous year delta
  const idx = anos ? anos.indexOf(anoSel) : -1;
  const prev = idx > 0 ? anos[idx - 1] : null;
  let stPrev = {};
  if (prev) {
    if (S.munSel) stPrev = f?.por_municipio[prev]?.[S.munSel] || {};
    else if (S.creSel) stPrev = aggregateCreFluxo(f, prev, S.creSel);
    else stPrev = f?.serie_temporal[prev] || {};
  }

  const kpis = [
    { label: 'Aprovação Fund.', key: 'aprov_fund', value: st.aprov_fund, icon: 'img/icons/fundamental.png', accent: 'green', suffix: '%' },
    { label: 'Aprovação Médio', key: 'aprov_med', value: st.aprov_med, icon: 'img/icons/medio.png', accent: 'green', suffix: '%' },
    { label: 'Reprovação Fund.', key: 'reprov_fund', value: st.reprov_fund, icon: 'img/icons/fundamental.png', accent: 'red', suffix: '%' },
    { label: 'Abandono Médio', key: 'aband_med', value: st.aband_med, icon: 'img/icons/medio.png', accent: 'red', suffix: '%' },
    { label: 'TDI Fund.', key: null, value: tdiSrc?.tdi_fund, icon: 'img/icons/fundamental.png', accent: 'yellow', suffix: '%' },
    { label: 'TDI Médio', key: null, value: tdiSrc?.tdi_med, icon: 'img/icons/medio.png', accent: 'yellow', suffix: '%' },
  ];
  const accentColors = { green: '#00AB4E', yellow: '#FFCB04', red: '#EE302F', blue: '#1565C0' };
  const refLabel = prev ? `vs ${prev}` : '';

  strip.innerHTML = kpis.map((k, i) => {
    const prevVal = k.key ? stPrev[k.key] : null;
    const delta = (k.value != null && prevVal != null) ? +(k.value - prevVal).toFixed(1) : null;
    const cls = delta != null ? (delta >= 0 ? 'up' : 'down') : '';
    // For negative metrics (reprov, aband), down is good
    const isNeg = k.label.includes('Reprov') || k.label.includes('Aband');
    const effectiveCls = isNeg ? (delta != null ? (delta <= 0 ? 'up' : 'down') : '') : cls;
    const arrow = delta != null ? (delta >= 0 ? '↑' : '↓') : '';
    const sign = delta != null && delta > 0 ? '+' : '';
    const sparkSvg = k.key ? buildSparkPct(k.key, accentColors[k.accent]) : '';
    return `
    <div class="kpi-card accent-${k.accent}" style="animation-delay:${i * 80}ms" title="${k.label}">
      <div class="kpi-top"><span class="kpi-label">${k.label}</span><img class="kpi-icon" src="${k.icon}" alt=""></div>
      <div class="kpi-body">
        <span class="kpi-value">${k.value != null ? k.value + k.suffix : '—'}</span>
        ${sparkSvg}
      </div>
      <div class="kpi-footer">
        ${delta != null ? `<span class="kpi-delta ${effectiveCls}">${arrow} ${sign}${delta}pp</span><span class="kpi-abs">${refLabel}</span>` : '<span class="kpi-abs">—</span>'}
      </div>
    </div>`;
  }).join('');
}

function fluxoBuildCharts(f, anos, anoSel, st, tdiSrc) {
  // Get per-year data for the active geo filter
  const getYearData = (ano) => {
    if (S.munSel) return f.por_municipio[ano]?.[S.munSel] || {};
    if (S.creSel) return aggregateCreFluxo(f, ano, S.creSel);
    return f.serie_temporal[ano] || {};
  };

  // Filter out years where all rendimento data is null (e.g. 2019)
  const anosChart = anos.filter(a => {
    const d = getYearData(a);
    return d.aprov_fund != null || d.aprov_fund_ai != null || d.reprov_fund != null || d.aband_fund != null;
  });

  // 1. Approval — 3 separate charts (AI / AF / Médio)
  // Dynamic align: values ≥98 get label below point, otherwise above — avoids clipping at max:100
  const aprovDL = (color) => ({
    ...DL_LINE_BOLD, color, clamp: true,
    anchor: ctx => (ctx.dataset.data[ctx.dataIndex] ?? 0) >= 98 ? 'start' : 'end',
    align:  ctx => (ctx.dataset.data[ctx.dataIndex] ?? 0) >= 98 ? 'bottom' : 'top',
  });
  const aprovLineOpts = (color) => ({
    ...CHART_DEFAULTS, layout: { padding: { top: 20 } },
    plugins: { ...CHART_DEFAULTS.plugins, datalabels: aprovDL(color), legend: { display: false } },
    scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, min: 80, max: 100 } }
  });
  const aprovAI = document.getElementById('flx-chart-aprov-ai');
  if (aprovAI) {
    S.charts.push(new Chart(aprovAI, { type:'line', data:{ labels:anosChart, datasets:[
      { label:'Fund. AI', data:anosChart.map(a => getYearData(a).aprov_fund_ai ?? null), borderColor:COLORS.fundamental, backgroundColor:COLORS.fundamental+'22', fill:true, tension:.3, pointRadius:5, borderWidth:2.5 }
    ]}, options: aprovLineOpts(COLORS.fundamental) }));
  }
  const aprovAF = document.getElementById('flx-chart-aprov-af');
  if (aprovAF) {
    S.charts.push(new Chart(aprovAF, { type:'line', data:{ labels:anosChart, datasets:[
      { label:'Fund. AF', data:anosChart.map(a => getYearData(a).aprov_fund_af ?? null), borderColor:COLORS.priLight, backgroundColor:COLORS.priLight+'22', fill:true, tension:.3, pointRadius:5, borderWidth:2.5 }
    ]}, options: aprovLineOpts(COLORS.priLight) }));
  }
  const aprovMed = document.getElementById('flx-chart-aprov-med');
  if (aprovMed) {
    S.charts.push(new Chart(aprovMed, { type:'line', data:{ labels:anosChart, datasets:[
      { label:'Médio', data:anosChart.map(a => getYearData(a).aprov_med ?? null), borderColor:COLORS.red, backgroundColor:COLORS.red+'22', fill:true, tension:.3, pointRadius:5, borderWidth:2.5 }
    ]}, options: { ...aprovLineOpts(COLORS.red), scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, min: 75, max: 100 } } } }));
  }

  // 2. Reprov + Abandono — 2 charts (Fundamental / Médio)
  // NO datalabels — only rich tooltip on hover
  const repabBaseOpts = { ...CHART_DEFAULTS, layout: { padding: { top: 8 } },
    plugins: { ...CHART_DEFAULTS.plugins,
      datalabels: { display: false },
      tooltip: {
        enabled: true, mode: 'index', intersect: false,
        backgroundColor: 'rgba(30,30,30,.92)', titleFont: { family:'Inter', size:12, weight:'700' },
        bodyFont: { family:'Inter', size:11 }, padding: 10, cornerRadius: 8,
        callbacks: {
          title: items => items[0]?.label || '',
          label: item => {
            const v = item.raw;
            if (v == null) return '';
            return `  ${item.dataset.label}: ${v.toFixed(1)}%`;
          }
        }
      },
      legend: { display: true, labels: { font: { family:'Inter', size:10, weight:'600' }, boxWidth:10, padding:8 } }
    },
    scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, min: 0, suggestedMax: 10, grace: '10%' } }
  };
  const repFund = document.getElementById('flx-chart-repab-fund');
  if (repFund) {
    S.charts.push(new Chart(repFund, { type:'line', data:{ labels:anosChart, datasets:[
      { label:'Reprovação', data:anosChart.map(a => getYearData(a).reprov_fund ?? null), borderColor:COLORS.yellow, borderWidth:2.5, tension:.3, pointRadius:5 },
      { label:'Abandono', data:anosChart.map(a => getYearData(a).aband_fund ?? null), borderColor:'#999', borderDash:[5,5], borderWidth:2.5, tension:.3, pointRadius:5 },
    ]}, options: repabBaseOpts }));
  }
  const repMed = document.getElementById('flx-chart-repab-med');
  if (repMed) {
    S.charts.push(new Chart(repMed, { type:'line', data:{ labels:anosChart, datasets:[
      { label:'Reprovação', data:anosChart.map(a => getYearData(a).reprov_med ?? null), borderColor:COLORS.red, borderWidth:2.5, tension:.3, pointRadius:5 },
      { label:'Abandono', data:anosChart.map(a => getYearData(a).aband_med ?? null), borderColor:'#333', borderDash:[5,5], borderWidth:2.5, tension:.3, pointRadius:5 },
    ]}, options: repabBaseOpts }));
  }

  // 3. Per-stage grouped bars (current year)
  const etapaEl = document.getElementById('flx-chart-etapa');
  if (etapaEl) {
    const labels = ['Fund. AI', 'Fund. AF', 'Médio'];
    S.charts.push(new Chart(etapaEl, {
      type: 'bar',
      data: { labels, datasets: [
        { label: 'Aprovação', data: [st.aprov_fund_ai, st.aprov_fund_af, st.aprov_med], backgroundColor: COLORS.pri+'CC', borderRadius: 4 },
        { label: 'Reprovação', data: [st.reprov_fund_ai, st.reprov_fund_af, st.reprov_med], backgroundColor: COLORS.yellow+'CC', borderRadius: 4 },
        { label: 'Abandono', data: [st.aband_fund_ai, st.aband_fund_af, st.aband_med], backgroundColor: COLORS.red+'CC', borderRadius: 4 },
      ]},
      options: { ...CHART_DEFAULTS,
        plugins: { ...CHART_DEFAULTS.plugins, datalabels: DL_BAR_BOLD, legend: { display: true, labels: { font: { family:'Inter', size:11, weight:'600' }, boxWidth:10 } } },
        scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, min:0, max: 100 } } }
    }));
  }

  // 4. TDI bars
  const tdiEl = document.getElementById('flx-chart-tdi');
  if (tdiEl) {
    const labels = ['Fund. AI', 'Fund. AF', 'Médio'];
    const data = [tdiSrc.tdi_fund_ai, tdiSrc.tdi_fund_af, tdiSrc.tdi_med];
    S.charts.push(new Chart(tdiEl, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'TDI (%)', data, backgroundColor: [COLORS.fundamental+'CC', COLORS.priLight+'CC', COLORS.red+'CC'], borderRadius: 6 }] },
      options: { ...CHART_DEFAULTS,
        plugins: { ...CHART_DEFAULTS.plugins, datalabels: DL_BAR_BOLD, legend: { display: false } },
        scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, min: 0, suggestedMax: Math.max(...data.filter(v=>v!=null))*1.3 || 30 } } }
    }));
  }
}

/** Leaflet choropleth for Fluxo rates */
function buildFluxoMap(f, anoSel, metricKey) {
  const mapEl = document.getElementById('flx-map-leaflet');
  if (!mapEl || !S.geo) return;

  destroyMap();

  const map = L.map(mapEl, { zoomControl: true, scrollWheelZoom: true, attributionControl: false }).setView([-29.7, -53.5], 6.5);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', { maxZoom: 14 }).addTo(map);

  const munData = f.por_municipio[anoSel] || {};
  const tdiData = f.tdi_por_municipio || {};
  const lookup = f.lookup_municipios || {};
  const metricDef = FLUXO_MAP_METRICS.find(m => m.key === metricKey) || FLUXO_MAP_METRICS[0];

  // Color scales — higher=better (approval) vs lower=better (reprov/aband/tdi)
  let tiers;
  if (metricDef.higher) {
    tiers = [
      { min: 95, color: '#005A32', label: '≥ 95%' },
      { min: 90, color: '#5cba68', label: '90% – 94%' },
      { min: 80, color: '#FFDF00', label: '80% – 89%' },
      { min: 0, color: '#EE302F', label: '< 80%' },
    ];
  } else {
    tiers = [
      { min: 0, max: 3, color: '#005A32', label: '< 3%' },
      { min: 3, max: 8, color: '#5cba68', label: '3% – 7%' },
      { min: 8, max: 15, color: '#FFDF00', label: '8% – 14%' },
      { min: 15, max: 999, color: '#EE302F', label: '≥ 15%' },
    ];
    if (metricDef.tdi) {
      tiers = [
        { min: 0, max: 10, color: '#005A32', label: '< 10%' },
        { min: 10, max: 20, color: '#5cba68', label: '10% – 19%' },
        { min: 20, max: 30, color: '#FFDF00', label: '20% – 29%' },
        { min: 30, max: 999, color: '#EE302F', label: '≥ 30%' },
      ];
    }
  }

  const getColor = (v) => {
    if (v == null) return '#f0f0f0';
    if (metricDef.higher) {
      for (const t of tiers) { if (v >= t.min) return t.color; }
      return '#f0f0f0';
    } else {
      for (let i = tiers.length - 1; i >= 0; i--) {
        if (v >= tiers[i].min) return tiers[i].color;
      }
      return '#f0f0f0';
    }
  };

  const getMunVal = (cod) => {
    if (metricDef.tdi) return tdiData[cod]?.[metricKey] ?? null;
    return munData[cod]?.[metricKey] ?? null;
  };

  const layer = L.geoJSON(S.geo, {
    style: (feature) => {
      const cod = feature.properties.cod_mun?.substring(0, 7);
      const v = getMunVal(cod);
      return { fillColor: getColor(v), fillOpacity: 0.85, weight: 0.8, color: '#fff' };
    },
    onEachFeature: (feature, layer) => {
      const cod = feature.properties.cod_mun?.substring(0, 7);
      const nome = lookup[cod] || feature.properties.NM_MUN || cod;
      const v = getMunVal(cod);
      layer.bindTooltip(`<strong>${nome}</strong><br>${metricDef.label}: ${v != null ? v.toFixed(1) + '%' : 'Sem dados'}`, { sticky: true });
      layer.on({
        mouseover: e => { e.target.setStyle({ weight: 2.5, color: '#FFB300', fillOpacity: 0.95 }); e.target.bringToFront(); },
        mouseout: e => { S.mapLayer.resetStyle(e.target); },
        click: () => {
          if (S.munSel === cod) { S.munSel = null; } else { S.munSel = cod; }
          refreshActiveTab();
        }
      });
    }
  }).addTo(map);

  // Legend
  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = function () {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = `<h4>${metricDef.label}</h4>`;
    for (const t of tiers) {
      div.innerHTML += `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${t.color}"></div><span>${t.label}</span></div>`;
    }
    div.innerHTML += `<div class="map-legend-row" style="margin-top:4px"><div class="map-legend-swatch" style="background:#f0f0f0"></div><span>Sem dados</span></div>`;
    return div;
  };
  legend.addTo(map);

  S.map = map;
  S.mapLayer = layer;
  S.mapLegend = legend;
}

/** Proper ranking table for Fluxo with sort/search/click-to-filter */
function fluxoBuildMunTable(f, anoSel, lookup) {
  const muns = f.por_municipio[anoSel] || {};
  const tdi = f.tdi_por_municipio || {};

  let entries = Object.entries(muns);
  // Filter by CRE
  if (S.creSel) {
    const creMuns = new Set(getCreMuns(S.creSel));
    entries = entries.filter(([cod]) => creMuns.has(cod));
  }

  let rows = entries
    .map(([cod, v]) => ({ cod, nome: lookup[cod] || `Cód.${cod}`, ...v, ...(tdi[cod]||{}) }))
    .filter(r => r.aprov_fund != null)
    .sort((a,b) => (b.aprov_fund||0) - (a.aprov_fund||0));

  const pctCell = (val, higher = true) => {
    if (val == null) return '<td style="text-align:center;color:var(--text-light)">—</td>';
    let cls;
    if (higher) { cls = val >= 90 ? 'color:#00AB4E' : val >= 80 ? 'color:#E6A100' : 'color:#EE302F'; }
    else { cls = val < 5 ? 'color:#00AB4E' : val < 10 ? 'color:#E6A100' : 'color:#EE302F'; }
    return `<td style="text-align:center;font-weight:700;${cls}">${val.toFixed(1)}%</td>`;
  };

  const tbody = document.getElementById('flx-mun-tbody');
  const renderRows = (data) => {
    tbody.innerHTML = data.map((r, i) =>
      `<tr data-cod="${r.cod}" style="cursor:pointer" class="${S.munSel === r.cod ? 'selected' : ''}" title="Clique para filtrar por ${r.nome}">
        <td>${i + 1}</td><td><strong>${r.nome}</strong></td>
        ${pctCell(r.aprov_fund, true)}${pctCell(r.aprov_med, true)}
        ${pctCell(r.reprov_fund, false)}${pctCell(r.aband_med, false)}
        ${pctCell(r.tdi_fund, false)}
      </tr>`
    ).join('');
    // Click handler
    tbody.querySelectorAll('tr').forEach(tr => {
      tr.addEventListener('click', () => {
        const cod = tr.dataset.cod;
        if (S.munSel === cod) { S.munSel = null; } else { S.munSel = cod; }
        refreshActiveTab();
      });
    });
  };
  renderRows(rows);

  // Sortable headers
  const table = document.getElementById('flx-mun-table');
  if (table) {
    const colKeys = ['_rank', 'nome', 'aprov_fund', 'aprov_med', 'reprov_fund', 'aband_med', 'tdi_fund'];
    let sortCol = -1, sortAsc = true;
    table.querySelectorAll('th').forEach((th, ci) => {
      th.style.cursor = 'pointer';
      th.title = 'Clique para ordenar';
      th.addEventListener('click', () => {
        if (sortCol === ci) sortAsc = !sortAsc; else { sortCol = ci; sortAsc = ci <= 1; }
        const key = colKeys[ci];
        rows.sort((a, b) => {
          const va = key === 'nome' ? a.nome : key === '_rank' ? 0 : (a[key] ?? -999);
          const vb = key === 'nome' ? b.nome : key === '_rank' ? 0 : (b[key] ?? -999);
          const cmp = typeof va === 'string' ? va.localeCompare(vb, 'pt-BR') : va - vb;
          return sortAsc ? cmp : -cmp;
        });
        renderRows(rows);
        table.querySelectorAll('th').forEach(h => h.textContent = h.textContent.replace(/ [▲▼]/g, ''));
        th.textContent += sortAsc ? ' ▲' : ' ▼';
      });
    });
  }

  // Search
  document.getElementById('flx-mun-search')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    tbody.querySelectorAll('tr').forEach(tr => {
      const nome = (tr.children[1]?.textContent || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      tr.style.display = nome.includes(q) ? '' : 'none';
    });
  });
}

// ══════════════════════════════════════════════════════════
// RENDER — CONTEXTO SOCIOECONÔMICO (INSE)
// ══════════════════════════════════════════════════════════

const FONTE_INSE = 'Fonte: INEP — Indicador de Nível Socioeconômico (INSE/SAEB)';

const INSE_NIVEL_COLORS = {
  'Nível I': '#C62828', 'Nível II': '#E53935', 'Nível III': '#FB8C00',
  'Nível IV': '#FFCB04', 'Nível V': '#66BB6A', 'Nível VI': '#43A047',
  'Nível VII': '#2E7D32', 'Nível VIII': '#1B5E20',
};

function renderInse() {
  const inse = S.inse;
  const main = document.getElementById('main-content');
  destroyCharts();
  destroyMap();

  // Guard: no INSE data for this rede
  if (!inse || !inse.metadata?.anos_disponiveis?.length) {
    main.innerHTML = `
      ${sectionBanner('img/icons/nav_desigualdades.png', 'Contexto Socioeconômico', getRedeLabel() + ' do RS')}
      ${redeToggleHTML()}
      <div style="text-align:center;padding:60px 20px;color:var(--text-sec);">
        <p style="font-size:1.1rem;font-weight:600;">Dados INSE não disponíveis para a Rede ${getRedeLabel()}</p>
        <p style="font-size:0.85rem;margin-top:8px;">O INEP não publica dados INSE para esta categoria de rede.</p>
      </div>`;
    bindRedeToggle();
    return;
  }

  const anos = inse.metadata.anos_disponiveis;
  const ultimo = anos[anos.length - 1];
  const primeiro = anos[0];
  const su = inse.serie_temporal[ultimo];
  const sp = inse.serie_temporal[primeiro];

  // KPI values
  const predominante = Object.entries(su.dist_niveis_escolas)
    .sort((a, b) => b[1].pct - a[1].pct)[0];
  const vulneraveis = Object.entries(su.dist_niveis_escolas)
    .filter(([k]) => ['Nível I','Nível II','Nível III','Nível IV'].includes(k))
    .reduce((s, [, v]) => s + v.count, 0);
  const gapUR = su.urbana?.media && su.rural?.media
    ? Math.abs(su.urbana.media - su.rural.media) : null;
  const gapURPrev = sp?.urbana?.media && sp?.rural?.media
    ? Math.abs(sp.urbana.media - sp.rural.media) : null;

  // Geo label
  let geoLabel = getRedeLabel() + ' do RS';
  if (S.creSel) {
    const creObj = S.creLookup?.cre_list?.find(c => c.cod_cre === S.creSel);
    geoLabel = creObj ? creObj.nome_cre : `CRE ${S.creSel}`;
  }
  if (S.munSel) {
    const nomeMun = inse.lookup_municipios[S.munSel];
    if (nomeMun) geoLabel = nomeMun;
  }

  main.innerHTML = `
    <div class="section-sticky">
      ${sectionBanner('img/icons/nav_desigualdades.png', 'Contexto Socioeconômico', geoLabel)}
      ${redeToggleHTML()}
      <div class="kpi-strip" id="inse-kpis" style="grid-template-columns:repeat(4,1fr)"></div>
    </div>

    <!-- ═══ BLOCO INFORMATIVO: O que é o INSE? ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/nav_desigualdades.png" alt=""></span>
      <span class="section-divider-text">O que é o INSE?</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="chart-card" style="padding:0;overflow:hidden;border:1px solid rgba(0,90,50,.08)">
      <div style="display:grid;grid-template-columns:1fr 1fr">
        <div style="padding:20px 24px;background:linear-gradient(135deg,#f8fdf9 0%,#eef6f0 100%)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
            <img src="img/icons/sec_saeb.png" alt="" style="width:20px;height:20px">
            <span style="font-size:14px;font-weight:700;color:var(--pri)">Definição</span>
          </div>
          <p style="font-size:11.5px;margin:0 0 16px;color:#333;line-height:1.75">
            O <strong>INSE (Indicador de Nível Socioeconômico)</strong> é um índice calculado pelo INEP a partir do
            <strong>questionário socioeconômico do SAEB</strong>, respondido diretamente pelos alunos. Ele posiciona
            cada escola em uma escala contínua que reflete a condição socioeconômica das famílias dos estudantes.
          </p>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <img src="img/icons/sec_evolucao.png" alt="" style="width:20px;height:20px">
            <span style="font-size:14px;font-weight:700;color:var(--pri)">Composição</span>
          </div>
          <p style="font-size:11.5px;margin:0 0 10px;color:#333;line-height:1.75">
            Construído a partir de <strong>17 itens</strong> do questionário do aluno:
          </p>
          <ul style="font-size:11px;margin:0 0 10px;padding-left:18px;color:#444;line-height:1.8">
            <li><strong>Posse de bens</strong> — geladeira, TV, carro, computador, celular com internet, etc.</li>
            <li><strong>Infraestrutura domiciliar</strong> — banheiros, quartos, garagem, Wi-Fi, mesa de estudo</li>
            <li><strong>Escolaridade dos pais</strong> — nível de instrução da mãe e do pai</li>
          </ul>
          <p style="font-size:10.5px;margin:0;color:#666;line-height:1.7">
            As respostas são analisadas por <strong>Teoria de Resposta ao Item (TRI)</strong>,
            gerando um escore contínuo classificado em 8 níveis (I a VIII).
          </p>
        </div>
        <div style="padding:20px 24px;border-left:1px solid rgba(0,90,50,.06)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
            <img src="img/icons/nav_desigualdades.png" alt="" style="width:20px;height:20px">
            <span style="font-size:14px;font-weight:700;color:var(--pri)">Escala de Níveis</span>
          </div>
          <table style="width:100%;font-size:11px;border-collapse:separate;border-spacing:0">
            <thead>
              <tr><th style="padding:6px 8px;text-align:left;background:#f0f4f8;border-bottom:2px solid #ddd;font-weight:700;color:#333">Nível</th><th style="padding:6px 8px;text-align:left;background:#f0f4f8;border-bottom:2px solid #ddd;font-weight:700;color:#333">Faixa</th><th style="padding:6px 8px;text-align:left;background:#f0f4f8;border-bottom:2px solid #ddd;font-weight:700;color:#333">Posição</th></tr>
            </thead>
            <tbody>
              <tr><td style="padding:5px 8px;border-bottom:1px solid #eee"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#C62828;vertical-align:middle;margin-right:6px"></span>I</td><td style="padding:5px 8px;border-bottom:1px solid #eee">< 2,0</td><td style="padding:5px 8px;border-bottom:1px solid #eee;color:#666">Extrema vulnerabilidade</td></tr>
              <tr style="background:#fafbfc"><td style="padding:5px 8px;border-bottom:1px solid #eee"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#E53935;vertical-align:middle;margin-right:6px"></span>II</td><td style="padding:5px 8px;border-bottom:1px solid #eee">2,0 – 3,0</td><td style="padding:5px 8px;border-bottom:1px solid #eee;color:#666">Pobreza</td></tr>
              <tr><td style="padding:5px 8px;border-bottom:1px solid #eee"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#FB8C00;vertical-align:middle;margin-right:6px"></span>III</td><td style="padding:5px 8px;border-bottom:1px solid #eee">3,0 – 4,0</td><td style="padding:5px 8px;border-bottom:1px solid #eee;color:#666">Vulnerável</td></tr>
              <tr style="background:#fafbfc"><td style="padding:5px 8px;border-bottom:1px solid #eee"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#FFCB04;vertical-align:middle;margin-right:6px"></span>IV</td><td style="padding:5px 8px;border-bottom:1px solid #eee">4,0 – 4,5</td><td style="padding:5px 8px;border-bottom:1px solid #eee;color:#666">Baixo-médio</td></tr>
              <tr><td style="padding:5px 8px;border-bottom:1px solid #eee"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#66BB6A;vertical-align:middle;margin-right:6px"></span>V</td><td style="padding:5px 8px;border-bottom:1px solid #eee">4,5 – 5,0</td><td style="padding:5px 8px;border-bottom:1px solid #eee;color:#666">Médio (≈ média nacional)</td></tr>
              <tr style="background:#fafbfc"><td style="padding:5px 8px;border-bottom:1px solid #eee"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#43A047;vertical-align:middle;margin-right:6px"></span>VI</td><td style="padding:5px 8px;border-bottom:1px solid #eee">5,0 – 5,5</td><td style="padding:5px 8px;border-bottom:1px solid #eee;color:#666">Médio-alto</td></tr>
              <tr><td style="padding:5px 8px;border-bottom:1px solid #eee"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#2E7D32;vertical-align:middle;margin-right:6px"></span>VII</td><td style="padding:5px 8px;border-bottom:1px solid #eee">5,5 – 6,0</td><td style="padding:5px 8px;border-bottom:1px solid #eee;color:#666">Alto</td></tr>
              <tr style="background:#fafbfc"><td style="padding:5px 8px"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#1B5E20;vertical-align:middle;margin-right:6px"></span>VIII</td><td style="padding:5px 8px">> 6,0</td><td style="padding:5px 8px;color:#666">Muito alto</td></tr>
            </tbody>
          </table>
          <div style="margin-top:14px;padding:10px 12px;background:linear-gradient(135deg,#FFF3E0,#FFF8E1);border-radius:8px;border-left:3px solid #FB8C00">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
              <img src="img/icons/politicas.png" alt="" style="width:14px;height:14px">
              <span style="font-size:11.5px;font-weight:700;color:#E65100">Nota Metodológica</span>
            </div>
            <p style="font-size:10.5px;margin:0;color:#555;line-height:1.7">
              Este painel apresenta as edições <strong>2019, 2021 e 2023</strong>, que utilizam a mesma escala equalizada
              por TRI e são diretamente comparáveis. As edições <strong>2011, 2013 e 2015</strong> adotaram
              metodologias diferentes (itens, escala e pontos de corte distintos), o que <strong>impede a comparação
              direta</strong> com os ciclos mais recentes.
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ EIXO: Distribuição por Nível ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/sec_evolucao.png" alt=""></span>
      <span class="section-divider-text">Distribuição por Nível Socioeconômico (${ultimo})</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title">Escolas por Nível INSE — ${geoLabel} (${ultimo})</div>
        <div style="height:260px"><canvas id="inse-chart-dist"></canvas></div>
        <div class="chart-source">${FONTE_INSE}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Distribuição dos Alunos por Nível INSE (${ultimo})</div>
        <div style="height:260px"><canvas id="inse-chart-alunos"></canvas></div>
        <div class="chart-source">${FONTE_INSE}</div>
      </div>
    </div>

    <!-- ═══ EIXO: Evolução Temporal ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/sec_evolucao.png" alt=""></span>
      <span class="section-divider-text">Evolução Temporal (${primeiro}–${ultimo})</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title">INSE Médio — Evolução (${primeiro}–${ultimo})</div>
        <div style="height:220px"><canvas id="inse-chart-evol"></canvas></div>
        <div class="chart-source">${FONTE_INSE}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Gap Urbana–Rural — Evolução (${primeiro}–${ultimo})</div>
        <div style="height:220px"><canvas id="inse-chart-gap"></canvas></div>
        <div class="chart-source">${FONTE_INSE}</div>
      </div>
    </div>

    <!-- ═══ EIXO: Mapa + Tabela ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/sec_mapa.png" alt=""></span>
      <span class="section-divider-text">Mapa e Ranking Municipal — INSE (${ultimo})</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="chart-card" style="min-height:400px">
        <div class="chart-title" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          INSE Médio por Município
          <div class="map-layer-toggle">
            <button class="map-layer-btn active" id="inse-btn-layer-mun">Municípios</button>
            <button class="map-layer-btn" id="inse-btn-layer-cre">CREs</button>
          </div>
        </div>
        <div id="inse-map-leaflet" style="height:380px;border-radius:8px"></div>
        <div class="chart-source">${FONTE_INSE}</div>
      </div>
      <div class="chart-card" style="min-height:400px">
        <div class="chart-title">Ranking Municipal — INSE</div>
        <div style="margin:6px 0 4px">
          <input type="text" id="inse-mun-search" placeholder="🔍 Pesquisar município..."
            style="width:100%;padding:6px 10px;font-size:11px;border:1px solid #ddd;border-radius:6px;font-family:Inter">
        </div>
        <div style="max-height:340px;overflow-y:auto">
          <table class="data-table" id="inse-mun-table">
            <thead>
              <tr><th>#</th><th>Município</th><th>INSE</th><th>Nível</th><th>Escolas</th><th>Alunos</th></tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
        <div class="chart-source">${FONTE_INSE}</div>
      </div>
    </div>
  `;

  // ── Build KPIs ──
  const strip = document.getElementById('inse-kpis');
  const kpis = [
    { label: 'INSE Médio', val: su.media?.toFixed(2), accent: 'green', icon: 'img/icons/nav_desigualdades.png',
      delta: sp ? (su.media - sp.media) : null, deltaFmt: v => (v >= 0 ? '+' : '') + v.toFixed(2) + ' pts', vsLabel: `vs ${primeiro}` },
    { label: 'Nível Predominante', val: predominante[0].replace('Nível ',''), accent: 'blue', icon: 'img/icons/sec_evolucao.png',
      delta: null, subtext: `${predominante[1].pct.toFixed(1)}% das escolas` },
    { label: 'Gap Urbana–Rural', val: gapUR?.toFixed(2), accent: gapUR && gapURPrev && gapUR < gapURPrev ? 'green' : 'yellow', icon: 'img/icons/sec_infra.png',
      delta: gapURPrev ? (gapUR - gapURPrev) : null, deltaFmt: v => (v >= 0 ? '+' : '') + v.toFixed(2), vsLabel: `vs ${primeiro}`, invertDelta: true },
    { label: 'Escolas Vulneráveis (≤ Nível IV)', val: vulneraveis, accent: 'red', icon: 'img/icons/nav_fluxo.png',
      delta: null, subtext: `${(vulneraveis / su.n_escolas * 100).toFixed(1)}% do total` },
  ];

  // Sparkline for INSE evolution
  const sparkVals = anos.map(a => inse.serie_temporal[a]?.media || 0);
  const sparkMin = Math.min(...sparkVals); const sparkMax = Math.max(...sparkVals);
  const sparkRange = sparkMax - sparkMin || 0.1;
  const sparkPts = sparkVals.map((v, j) => `${(j / Math.max(sparkVals.length - 1, 1)) * 58 + 1},${23 - ((v - sparkMin) / sparkRange) * 20}`).join(' ');

  strip.innerHTML = kpis.map((k, i) => {
    const cls = k.invertDelta
      ? (k.delta !== null ? (k.delta <= 0 ? 'up' : 'down') : '')
      : (k.delta !== null ? (k.delta >= 0 ? 'up' : 'down') : '');
    const arrow = k.invertDelta
      ? (k.delta !== null ? (k.delta <= 0 ? '↓' : '↑') : '')
      : (k.delta !== null ? (k.delta >= 0 ? '↑' : '↓') : '');
    const sparkline = i === 0
      ? `<svg class="kpi-sparkline" viewBox="0 0 60 24" width="60" height="24"><polyline points="${sparkPts}" fill="none" stroke="${COLORS.pri}" stroke-width="1.5" stroke-linecap="round"/></svg>`
      : '';
    return `
    <div class="kpi-card accent-${k.accent}" style="animation-delay:${i * 80}ms">
      <div class="kpi-top">
        <span class="kpi-label">${k.label}</span>
        <img class="kpi-icon" src="${k.icon}" alt="" onerror="this.style.display='none'">
      </div>
      <div class="kpi-body">
        <span class="kpi-value">${k.val ?? '—'}</span>
        ${sparkline}
      </div>
      <div class="kpi-footer">
        ${k.delta !== null ? `<span class="kpi-delta ${cls}">${arrow} ${k.deltaFmt(k.delta)}</span><span class="kpi-abs">${k.vsLabel}</span>` : ''}
        ${k.subtext ? `<span class="kpi-abs">${k.subtext}</span>` : ''}
      </div>
    </div>`;
  }).join('');

  // ── Chart 1: Distribution by level (horizontal bar) ──
  const inseBuildDistChart = () => {
    const el = document.getElementById('inse-chart-dist');
    if (!el) return;

    // Get data for selected scope
    let dist = su.dist_niveis_escolas;
    if (S.munSel && inse.por_municipio[ultimo]?.[S.munSel]) {
      dist = inse.por_municipio[ultimo][S.munSel].dist_niveis;
    }

    const niveis = Object.keys(INSE_NIVEL_COLORS);
    const counts = niveis.map(n => dist[n]?.count || 0);
    const pcts = niveis.map(n => dist[n]?.pct || 0);
    const colors = niveis.map(n => INSE_NIVEL_COLORS[n]);

    S.charts.push(new Chart(el, {
      type: 'bar',
      data: {
        labels: niveis.map(n => n.replace('Nível ','')),
        datasets: [{ label: 'Escolas', data: counts, backgroundColor: colors, borderRadius: 4 }]
      },
      options: {
        ...CHART_DEFAULTS, indexAxis: 'y', layout: { padding: { right: 50 } },
        plugins: {
          ...CHART_DEFAULTS.plugins, legend: { display: false },
          datalabels: { display: true, anchor: 'end', align: 'end', font: { family: 'Inter', size: 11, weight: '700' },
            color: '#333', formatter: (v, ctx) => v > 0 ? `${v} (${pcts[ctx.dataIndex].toFixed(1)}%)` : '' }
        },
        scales: {
          x: { display: false },
          y: { grid: { display: false }, ticks: { font: { family: 'Inter', size: 11, weight: '600' } } }
        }
      }
    }));
  };

  // ── Chart 2: Student distribution by level (stacked bar) ──
  const inseBuildAlunosChart = () => {
    const el = document.getElementById('inse-chart-alunos');
    if (!el) return;

    const distAl = su.dist_niveis_alunos;
    const niveis = Object.keys(INSE_NIVEL_COLORS);
    const vals = niveis.map(n => distAl[n] || 0);
    const colors = niveis.map(n => INSE_NIVEL_COLORS[n]);

    S.charts.push(new Chart(el, {
      type: 'bar',
      data: {
        labels: niveis.map(n => n.replace('Nível ','')),
        datasets: [{ label: '% dos Alunos', data: vals, backgroundColor: colors, borderRadius: 4 }]
      },
      options: {
        ...CHART_DEFAULTS, layout: { padding: { top: 20 } },
        plugins: {
          ...CHART_DEFAULTS.plugins, legend: { display: false },
          datalabels: { display: true, anchor: 'end', align: 'end', font: { family: 'Inter', size: 11, weight: '700' },
            color: '#333', formatter: v => v > 0 ? v.toFixed(1) + '%' : '' }
        },
        scales: {
          ...CHART_DEFAULTS.scales,
          y: { ...CHART_DEFAULTS.scales.y, beginAtZero: true, grace: '15%',
            ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => v + '%' } }
        }
      }
    }));
  };

  // ── Chart 3: Temporal evolution ──
  const inseBuildEvolChart = () => {
    const el = document.getElementById('inse-chart-evol');
    if (!el) return;

    const brasMedia = { '2019': 5.10, '2021': 5.07, '2023': 5.10 }; // national reference

    S.charts.push(new Chart(el, {
      type: 'line',
      data: {
        labels: anos,
        datasets: [
          { label: 'RS Estadual', data: anos.map(a => inse.serie_temporal[a]?.media), borderColor: COLORS.pri, backgroundColor: COLORS.pri + '22', fill: true, tension: .3, pointRadius: 5, borderWidth: 2.5,
            datalabels: { anchor: 'end', align: 'top' } },
          { label: 'Brasil (ref.)', data: anos.map(a => brasMedia[a] || null), borderColor: '#999', borderDash: [5, 5], tension: .3, pointRadius: 4, borderWidth: 2,
            datalabels: { anchor: 'start', align: 'bottom' } },
        ]
      },
      options: {
        ...CHART_DEFAULTS, layout: { padding: { top: 25, bottom: 20 } },
        plugins: { ...CHART_DEFAULTS.plugins,
          datalabels: { ...DL_LINE_BOLD, formatter: v => v != null ? v.toFixed(2) : '' },
          legend: { display: true, labels: { font: { family: 'Inter', size: 10, weight: '600' }, boxWidth: 10, padding: 8 } }
        },
        scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, min: 4.5, max: 6.0 } }
      }
    }));
  };

  // ── Chart 4: Urban-Rural gap ──
  const inseBuildGapChart = () => {
    const el = document.getElementById('inse-chart-gap');
    if (!el) return;

    S.charts.push(new Chart(el, {
      type: 'line',
      data: {
        labels: anos,
        datasets: [
          { label: 'Urbana', data: anos.map(a => inse.serie_temporal[a]?.urbana?.media), borderColor: COLORS.pri, tension: .3, pointRadius: 5, borderWidth: 2.5,
            datalabels: { anchor: 'end', align: 'top' } },
          { label: 'Rural', data: anos.map(a => inse.serie_temporal[a]?.rural?.media), borderColor: COLORS.red, borderDash: [5, 5], tension: .3, pointRadius: 5, borderWidth: 2.5,
            datalabels: { anchor: 'start', align: 'bottom' } },
        ]
      },
      options: {
        ...CHART_DEFAULTS, layout: { padding: { top: 25, bottom: 20 } },
        plugins: { ...CHART_DEFAULTS.plugins,
          datalabels: { ...DL_LINE_BOLD, formatter: v => v != null ? v.toFixed(2) : '' },
          legend: { display: true, labels: { font: { family: 'Inter', size: 10, weight: '600' }, boxWidth: 10, padding: 8 } }
        },
        scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, min: 4.5, max: 6.0 } }
      }
    }));
  };

  // ── Map: INSE by municipality ──
  const inseBuildMap = () => {
    if (!S.geo) return;
    const mapEl = document.getElementById('inse-map-leaflet');
    if (!mapEl) return;

    const munData = inse.por_municipio[ultimo] || {};

    // Fixed breaks for INSE (not quantile — semantic)
    const INSE_MAP_BREAKS = [
      { min: 0,   max: 5.0, color: '#E53935', label: '< 5.0 (Vulnerável)' },
      { min: 5.0, max: 5.3, color: '#FB8C00', label: '5.0–5.3 (Baixo-médio)' },
      { min: 5.3, max: 5.5, color: '#66BB6A', label: '5.3–5.5 (Médio)' },
      { min: 5.5, max: 99,  color: '#2E7D32', label: '> 5.5 (Alto)' },
    ];

    function getInseColor(v) {
      for (const b of INSE_MAP_BREAKS) {
        if (v >= b.min && v < b.max) return b.color;
      }
      return '#f0f0f0';
    }

    destroyMap();
    S.map = L.map('inse-map-leaflet', { zoomControl: true, scrollWheelZoom: true, attributionControl: false })
      .setView([-29.7, -53.5], 6.5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', { maxZoom: 14 }).addTo(S.map);

    // Info panel
    const info = L.control({ position: 'topright' });
    info.onAdd = function () { this._div = L.DomUtil.create('div', 'map-info-panel'); this.update(); return this._div; };
    info.update = function (props, md) {
      if (!props) { this._div.innerHTML = '<h4>Passe o mouse sobre um município</h4>'; return; }
      const nome = props.nome || props.cod_mun;
      if (!md) { this._div.innerHTML = `<h4>${nome}</h4><div style="color:#999;font-size:11px">Sem dados INSE</div>`; return; }
      this._div.innerHTML = `
        <h4>${nome}</h4>
        <div class="info-row"><span class="info-label">INSE</span><span class="info-value">${md.inse?.toFixed(2) ?? '—'}</span></div>
        <div class="info-row"><span class="info-label">Nível</span><span class="info-value">${md.nivel || '—'}</span></div>
        <div class="info-row"><span class="info-label">Escolas</span><span class="info-value">${md.n_escolas}</span></div>
        <div class="info-row"><span class="info-label">Alunos</span><span class="info-value">${formatNum(md.n_alunos)}</span></div>
      `;
    };
    info.addTo(S.map);

    S.mapLayer = L.geoJSON(S.geo, {
      style: feature => {
        const cod = feature.properties.cod_mun?.substring(0, 7);
        const md = munData[cod];
        const v = md?.inse || 0;
        return { fillColor: v > 0 ? getInseColor(v) : '#f0f0f0', weight: 0.8, opacity: 1, color: '#fff', fillOpacity: 0.85 };
      },
      onEachFeature: (feature, layer) => {
        const cod = feature.properties.cod_mun?.substring(0, 7);
        const md = munData[cod];
        layer.on({
          mouseover: e => { e.target.setStyle({ weight: 2.5, color: '#FFB300', fillOpacity: 0.95 }); e.target.bringToFront(); info.update(feature.properties, md); },
          mouseout: e => { S.mapLayer.resetStyle(e.target); info.update(); },
        });
      }
    }).addTo(S.map);

    // Legend
    const legend = L.control({ position: 'bottomleft' });
    legend.onAdd = function () {
      const div = L.DomUtil.create('div', 'map-legend');
      div.innerHTML = '<h4>INSE Médio</h4>' +
        INSE_MAP_BREAKS.slice().reverse().map(b =>
          `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${b.color}"></div><span>${b.label}</span></div>`
        ).join('') + '<div class="map-legend-row" style="margin-top:4px"><div class="map-legend-swatch" style="background:#f0f0f0"></div><span>Sem dados</span></div>';
      return div;
    };
    legend.addTo(S.map);
    S.mapLegend = legend;
  };

  // ── CRE layer for INSE map ──
  const inseBuildCreMap = () => {
    if (!S.creGeo || !S.map) return;
    if (S.mapLayer) { S.mapLayer.remove(); S.mapLayer = null; }
    if (S.mapLegend) { S.mapLegend.remove(); S.mapLegend = null; }

    const munToCre = S.creLookup?.mun_to_cre || {};
    const munData = inse.por_municipio[ultimo] || {};

    // Aggregate by CRE
    const creData = {};
    for (const [cod, v] of Object.entries(munData)) {
      const cre = munToCre[cod]?.cod_cre;
      if (!cre) continue;
      if (!creData[cre]) creData[cre] = { sumInse: 0, count: 0, nome: munToCre[cod]?.nome_cre || cre };
      if (v.inse) { creData[cre].sumInse += v.inse; creData[cre].count += 1; }
    }
    for (const c of Object.values(creData)) c.avg = c.count > 0 ? c.sumInse / c.count : 0;

    const INSE_MAP_BREAKS = [
      { min: 0,   max: 5.0, color: '#E53935', label: '< 5.0 (Vulnerável)' },
      { min: 5.0, max: 5.3, color: '#FB8C00', label: '5.0–5.3' },
      { min: 5.3, max: 5.5, color: '#66BB6A', label: '5.3–5.5' },
      { min: 5.5, max: 99,  color: '#2E7D32', label: '> 5.5 (Alto)' },
    ];
    function getColor(v) {
      for (const b of INSE_MAP_BREAKS) { if (v >= b.min && v < b.max) return b.color; }
      return '#f0f0f0';
    }

    S.mapLayer = L.geoJSON(S.creGeo, {
      style: feature => {
        const cod = feature.properties.cod_cre;
        const avg = creData[cod]?.avg || 0;
        return { fillColor: avg > 0 ? getColor(avg) : '#f0f0f0', weight: 2, color: '#fff', fillOpacity: 0.8 };
      },
      onEachFeature: (feature, layer) => {
        const cod = feature.properties.cod_cre;
        const nome = feature.properties.nome_cre || cod;
        const d = creData[cod];
        layer.bindTooltip(`<strong>${nome}</strong><br>INSE Médio: ${d?.avg?.toFixed(2) ?? '—'}<br>${d?.count || 0} municípios`, { sticky: true });
        layer.on('click', () => { S.creSel = cod; const selCre = document.getElementById('sel-cre'); if (selCre) selCre.value = cod; populateMunDropdown(cod); refreshActiveTab(); });
      }
    }).addTo(S.map);

    const legend = L.control({ position: 'bottomleft' });
    legend.onAdd = function () {
      const div = L.DomUtil.create('div', 'map-legend');
      div.innerHTML = '<h4>INSE Médio (CREs)</h4>' +
        INSE_MAP_BREAKS.slice().reverse().map(b => `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${b.color}"></div><span>${b.label}</span></div>`).join('');
      return div;
    };
    legend.addTo(S.map);
    S.mapLegend = legend;
  };

  // ── Table: Municipality ranking ──
  const inseBuildMunTable = () => {
    const tbody = document.querySelector('#inse-mun-table tbody');
    if (!tbody) return;

    const munData = inse.por_municipio[ultimo] || {};
    const lookup = inse.lookup_municipios || {};

    // Filter by CRE if selected
    let entries = Object.entries(munData);
    if (S.creSel && S.creLookup?.mun_to_cre) {
      entries = entries.filter(([cod]) => S.creLookup.mun_to_cre[cod]?.cod_cre === S.creSel);
    }
    if (S.munSel) {
      entries = entries.filter(([cod]) => cod === S.munSel);
    }

    entries.sort((a, b) => (b[1].inse || 0) - (a[1].inse || 0));

    tbody.innerHTML = entries.map(([cod, md], i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${lookup[cod] || cod}</td>
        <td><strong>${md.inse?.toFixed(2) ?? '—'}</strong></td>
        <td>${md.nivel || '—'}</td>
        <td>${md.n_escolas}</td>
        <td>${formatNum(md.n_alunos)}</td>
      </tr>
    `).join('');

    document.getElementById('inse-mun-search')?.addEventListener('input', e => {
      const q = e.target.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      tbody.querySelectorAll('tr').forEach(tr => {
        const nome = (tr.children[1]?.textContent || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        tr.style.display = nome.includes(q) ? '' : 'none';
      });
    });
  };

  // Build all
  inseBuildDistChart();
  inseBuildAlunosChart();
  inseBuildEvolChart();
  inseBuildGapChart();
  inseBuildMap();
  inseBuildMunTable();
  injectExportButtons();

  // Bind INSE map layer toggle
  const inseBtnMun = document.getElementById('inse-btn-layer-mun');
  const inseBtnCre = document.getElementById('inse-btn-layer-cre');
  if (inseBtnMun && inseBtnCre) {
    inseBtnMun.addEventListener('click', () => {
      inseBtnMun.classList.add('active'); inseBtnCre.classList.remove('active');
      inseBuildMap();
    });
    inseBtnCre.addEventListener('click', () => {
      inseBtnCre.classList.add('active'); inseBtnMun.classList.remove('active');
      inseBuildCreMap();
    });
  }

  // Re-populate topbar filters (destroyed by innerHTML)
  const selAno = document.getElementById('sel-ano');
  if (selAno) {
    selAno.innerHTML = anos.map(a => `<option value="${a}" ${a === ultimo ? 'selected' : ''}>${a}</option>`).join('');
  }
  populateCreDropdown();
  populateMunDropdown(S.creSel || null);
  const selCre = document.getElementById('sel-cre');
  if (selCre && S.creSel) selCre.value = S.creSel;
  const selMun = document.getElementById('sel-mun');
  if (selMun && S.munSel) selMun.value = S.munSel;
  bindTopbarFilters();
  bindRedeToggle();
}

// ══════════════════════════════════════════════════════════
// COMPLEXIDADE DE GESTÃO (ICG)
// ══════════════════════════════════════════════════════════

const FONTE_ICG = 'Fonte: INEP — Indicador de Complexidade de Gestão da Escola';

const ICG_COLORS = {
  1: '#43A047',  // simples — verde
  2: '#66BB6A',
  3: '#FFCB04',  // médio — amarelo
  4: '#FB8C00',  // complexo — laranja
  5: '#EE302F',  // muito complexo — vermelho
  6: '#C62828',  // extremamente complexo
};
const ICG_LABELS = {
  1: 'Nível 1 — Baixa',
  2: 'Nível 2',
  3: 'Nível 3 — Média',
  4: 'Nível 4',
  5: 'Nível 5 — Alta',
  6: 'Nível 6 — Muito Alta',
};
const ICG_SHORT = { 1: 'Nível 1', 2: 'Nível 2', 3: 'Nível 3', 4: 'Nível 4', 5: 'Nível 5', 6: 'Nível 6' };

function renderIcg() {
  const icg = S.icg;
  const main = document.getElementById('main-content');
  destroyCharts();
  destroyMap();

  // Guard: no ICG data
  if (!icg || !icg.metadata?.anos_disponiveis?.length) {
    main.innerHTML = `
      <div class="section-sticky">
        ${sectionBanner('img/icons/escola.png', 'Complexidade de Gestão', getRedeLabel() + ' do RS')}
        ${redeToggleHTML()}
      </div>
      <div style="text-align:center;padding:60px 20px;color:var(--text-sec);">
        <p style="font-size:1.1rem;font-weight:600;">Dados de Complexidade de Gestão não disponíveis para a ${getRedeLabel()}</p>
      </div>`;
    bindRedeToggle();
    return;
  }

  const anos = icg.metadata.anos_disponiveis;
  const ultimo = anos[anos.length - 1];
  const primeiro = anos[0];
  const su = icg.serie_temporal[ultimo];

  // Geo-aware data
  let displayData = su;
  let geoLabel = getRedeLabel() + ' do RS';
  if (S.munSel && icg.por_municipio?.[ultimo]?.[S.munSel]) {
    displayData = icg.por_municipio[ultimo][S.munSel];
    geoLabel = icg.lookup_municipios[S.munSel] || S.munSel;
  } else if (S.creSel) {
    const creMuns = getCreMuns(S.creSel);
    // Aggregate CRE
    const agg = { total_escolas: 0 };
    for (let n = 1; n <= 6; n++) agg[`nivel_${n}`] = { count: 0, pct: 0 };
    const munYear = icg.por_municipio?.[ultimo] || {};
    for (const cod of creMuns) {
      const m = munYear[cod];
      if (!m) continue;
      agg.total_escolas += m.total_escolas || 0;
      for (let n = 1; n <= 6; n++) agg[`nivel_${n}`].count += m[`nivel_${n}`]?.count || 0;
    }
    if (agg.total_escolas > 0) {
      for (let n = 1; n <= 6; n++) agg[`nivel_${n}`].pct = +(agg[`nivel_${n}`].count / agg.total_escolas * 100).toFixed(1);
      let wSum = 0;
      for (let n = 1; n <= 6; n++) wSum += n * agg[`nivel_${n}`].count;
      agg.nivel_medio = +(wSum / agg.total_escolas).toFixed(2);
      displayData = agg;
    }
    const creObj = S.creLookup?.cre_list?.find(c => c.cod_cre === S.creSel);
    geoLabel = creObj ? creObj.nome_cre : `CRE ${S.creSel}`;
  }

  // KPI helpers
  const predominante = (() => {
    let best = null, bestPct = 0;
    for (let n = 1; n <= 6; n++) {
      const p = displayData[`nivel_${n}`]?.pct || 0;
      if (p > bestPct) { bestPct = p; best = n; }
    }
    return best;
  })();
  const altaComplexidade = (displayData.nivel_5?.count || 0) + (displayData.nivel_6?.count || 0);
  const altaPct = displayData.total_escolas > 0 ? (altaComplexidade / displayData.total_escolas * 100).toFixed(1) : 0;

  main.innerHTML = `
    <div class="section-sticky">
      ${sectionBanner('img/icons/escola.png', 'Complexidade de Gestão', geoLabel)}
      ${redeToggleHTML()}
      <div class="kpi-strip" id="icg-kpis" style="grid-template-columns:repeat(4,1fr)"></div>
    </div>

    <!-- ═══ BLOCO INFORMATIVO: O que é o ICG? ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/escola.png" alt=""></span>
      <span class="section-divider-text">O que é o ICG?</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="chart-card" style="padding:0;overflow:hidden;border:1px solid rgba(0,90,50,.08)">
      <div style="display:grid;grid-template-columns:1fr 1fr">
        <div style="padding:20px 24px;background:linear-gradient(135deg,#f8fdf9 0%,#eef6f0 100%)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
            <img src="img/icons/escola.png" alt="" style="width:20px;height:20px">
            <span style="font-size:14px;font-weight:700;color:var(--pri)">Definição</span>
          </div>
          <p style="font-size:11.5px;margin:0 0 16px;color:#333;line-height:1.75">
            O <strong>ICG (Indicador de Complexidade de Gestão da Escola)</strong> resume, em uma única medida,
            as informações de <strong>porte</strong> (nº de matrículas), <strong>turnos de funcionamento</strong>,
            <strong>quantidade de etapas</strong> e <strong>complexidade das etapas ofertadas</strong>.
          </p>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <img src="img/icons/sec_evolucao.png" alt="" style="width:20px;height:20px">
            <span style="font-size:14px;font-weight:700;color:var(--pri)">Metodologia</span>
          </div>
          <p style="font-size:11.5px;margin:0 0 14px;color:#333;line-height:1.75">
            Calculado por <strong>Teoria de Resposta ao Item (TRI)</strong> a partir de 4 variáveis do Censo Escolar,
            gerando um escore contínuo classificado em <strong>6 níveis</strong> — do Nível 1 (gestão simples)
            ao Nível 6 (gestão muito complexa).
          </p>
          <div style="background:rgba(255,203,4,.1);border:1px solid rgba(255,203,4,.25);border-radius:6px;padding:10px 14px">
            <p style="font-size:11px;margin:0;color:#5D4037;line-height:1.7">
              <strong style="color:#E65100">⚠ Atenção:</strong> Não é um indicador de <em>qualidade</em> — é de <strong>contexto</strong>.
              Uma escola Nível 6 não é "pior" que Nível 1; ela é mais <em>complexa de gerir</em>
              (mais turnos, mais etapas, mais alunos).
            </p>
          </div>
        </div>
        <div style="padding:20px 24px;border-left:1px solid rgba(0,90,50,.06)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
            <img src="img/icons/escola.png" alt="" style="width:20px;height:20px">
            <span style="font-size:14px;font-weight:700;color:var(--pri)">Escala de Níveis</span>
          </div>
          <table style="width:100%;font-size:11px;border-collapse:separate;border-spacing:0">
            <thead>
              <tr><th style="padding:6px 8px;text-align:left;background:#f0f4f8;border-bottom:2px solid #ddd;font-weight:700;color:#333">Nível</th><th style="padding:6px 8px;text-align:left;background:#f0f4f8;border-bottom:2px solid #ddd;font-weight:700;color:#333">Porte</th><th style="padding:6px 8px;text-align:left;background:#f0f4f8;border-bottom:2px solid #ddd;font-weight:700;color:#333">Turnos</th><th style="padding:6px 8px;text-align:left;background:#f0f4f8;border-bottom:2px solid #ddd;font-weight:700;color:#333">Etapa mais alta</th></tr>
            </thead>
            <tbody>
              <tr><td style="padding:5px 8px;border-bottom:1px solid #eee"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${ICG_COLORS[1]};vertical-align:middle;margin-right:6px"></span>1</td><td style="padding:5px 8px;border-bottom:1px solid #eee">< 50</td><td style="padding:5px 8px;border-bottom:1px solid #eee">1</td><td style="padding:5px 8px;border-bottom:1px solid #eee;color:#666">Ed. Infantil / AI</td></tr>
              <tr style="background:#fafbfc"><td style="padding:5px 8px;border-bottom:1px solid #eee"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${ICG_COLORS[2]};vertical-align:middle;margin-right:6px"></span>2</td><td style="padding:5px 8px;border-bottom:1px solid #eee">50–300</td><td style="padding:5px 8px;border-bottom:1px solid #eee">2</td><td style="padding:5px 8px;border-bottom:1px solid #eee;color:#666">Ed. Infantil / AI</td></tr>
              <tr><td style="padding:5px 8px;border-bottom:1px solid #eee"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${ICG_COLORS[3]};vertical-align:middle;margin-right:6px"></span>3</td><td style="padding:5px 8px;border-bottom:1px solid #eee">50–500</td><td style="padding:5px 8px;border-bottom:1px solid #eee">2</td><td style="padding:5px 8px;border-bottom:1px solid #eee;color:#666">Anos Finais</td></tr>
              <tr style="background:#fafbfc"><td style="padding:5px 8px;border-bottom:1px solid #eee"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${ICG_COLORS[4]};vertical-align:middle;margin-right:6px"></span>4</td><td style="padding:5px 8px;border-bottom:1px solid #eee">150–1.000</td><td style="padding:5px 8px;border-bottom:1px solid #eee">2–3</td><td style="padding:5px 8px;border-bottom:1px solid #eee;color:#666">Ens. Médio / Prof.</td></tr>
              <tr><td style="padding:5px 8px;border-bottom:1px solid #eee"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${ICG_COLORS[5]};vertical-align:middle;margin-right:6px"></span>5</td><td style="padding:5px 8px;border-bottom:1px solid #eee">150–1.000</td><td style="padding:5px 8px;border-bottom:1px solid #eee">3</td><td style="padding:5px 8px;border-bottom:1px solid #eee;color:#666">Com EJA</td></tr>
              <tr style="background:#fafbfc"><td style="padding:5px 8px"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${ICG_COLORS[6]};vertical-align:middle;margin-right:6px"></span>6</td><td style="padding:5px 8px">> 500</td><td style="padding:5px 8px">3</td><td style="padding:5px 8px;color:#666">4+ etapas + EJA</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ═══ EIXO: Distribuição por Nível ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/panorama.png" alt=""></span>
      <span class="section-divider-text">Distribuição por Nível — ${ultimo}</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title">Distribuição por Nível de Complexidade — ${ultimo}</div>
        <div style="height:240px"><canvas id="icg-chart-dist"></canvas></div>
        <div class="chart-source">${FONTE_ICG}</div>
      </div>
    </div>

    <!-- ═══ EIXO: Evolução Temporal ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/sec_evolucao.png" alt=""></span>
      <span class="section-divider-text">Evolução Temporal (${primeiro}–${ultimo})</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title">Nível Médio de Complexidade — Evolução</div>
        <div style="height:220px"><canvas id="icg-chart-nivel-medio"></canvas></div>
        <div class="chart-source">${FONTE_ICG}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Distribuição por Nível — Evolução (% empilhado)</div>
        <div style="height:220px"><canvas id="icg-chart-evol"></canvas></div>
        <div class="chart-source">${FONTE_ICG}</div>
      </div>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title">Nível Médio — Urbana vs Rural <span class="badge-estadual">Nível Estadual</span></div>
        <div style="height:220px"><canvas id="icg-chart-urbrur"></canvas></div>
        <div class="chart-source">${FONTE_ICG}</div>
      </div>
    </div>

    <!-- ═══ EIXO: Distribuição Territorial ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/territorial.png" alt=""></span>
      <span class="section-divider-text">Distribuição Territorial — ${ultimo}</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="map-table-row d1">
      <div class="map-container">
        <div class="map-toolbar">
          <h3>Mapa — Nível Médio ICG <span id="icg-map-ano">${ultimo}</span></h3>
          <div class="map-layer-toggle">
            <button class="map-layer-btn active" id="icg-btn-layer-mun">Municípios</button>
            <button class="map-layer-btn" id="icg-btn-layer-cre">CREs</button>
          </div>
        </div>
        <div id="icg-map-leaflet" style="height:380px;border-radius:8px"></div>
      </div>
      <div class="table-wrapper" id="icg-table-wrapper">
        <div class="table-header">
          <h3>Tabela de Municípios — ICG</h3>
          <input type="text" class="table-search" id="icg-mun-search" placeholder="Buscar...">
        </div>
        <div style="max-height:400px;overflow-y:auto">
          <table class="data-table" id="icg-mun-table">
            <thead><tr>
              <th>#</th><th>Município</th><th>Escolas</th>
              <th>Nível Médio</th><th>N1</th><th>N2</th><th>N3</th><th>N4</th><th>N5</th><th>N6</th>
            </tr></thead>
            <tbody></tbody>
          </table>
        </div>
        <div class="chart-source">${FONTE_ICG}</div>
      </div>
    </div>
  `;

  // ── KPIs ──
  const strip = document.getElementById('icg-kpis');
  if (strip) {
    const kpis = [
      { label: `Escolas (${ultimo})`, value: displayData.total_escolas || 0, icon: 'img/icons/escola.png', accent: 'green' },
      { label: 'Nível Médio', value: displayData.nivel_medio?.toFixed(2) || '—', icon: 'img/icons/panorama.png', accent: 'green', noFormat: true },
      { label: 'Nível Predominante', value: predominante ? `Nível ${predominante} (${displayData[`nivel_${predominante}`]?.pct}%)` : '—', icon: 'img/icons/escola.png', accent: predominante && predominante >= 4 ? 'red' : 'green', noFormat: true },
      { label: 'Alta Complexidade (N5+N6)', value: `${altaComplexidade} (${altaPct}%)`, icon: 'img/icons/sec_saeb.png', accent: parseFloat(altaPct) > 20 ? 'red' : 'green', noFormat: true },
    ];
    strip.innerHTML = kpis.map((k, i) => `
      <div class="kpi-card accent-${k.accent}" style="animation-delay:${i * 80}ms">
        <div class="kpi-top">
          <span class="kpi-label">${k.label}</span>
          <img class="kpi-icon" src="${k.icon}" alt="">
        </div>
        <div class="kpi-body">
          <span class="kpi-value">${k.noFormat ? k.value : formatNum(k.value)}</span>
        </div>
      </div>`).join('');
  }

  // ── Chart 1: Distribution bar ──
  const distEl = document.getElementById('icg-chart-dist');
  if (distEl) {
    const niveis = [1,2,3,4,5,6];
    S.charts.push(new Chart(distEl, {
      type: 'bar',
      data: {
        labels: niveis.map(n => ICG_SHORT[n]),
        datasets: [{
          label: 'Escolas',
          data: niveis.map(n => displayData[`nivel_${n}`]?.count || 0),
          backgroundColor: niveis.map(n => ICG_COLORS[n] + 'CC'),
          borderColor: niveis.map(n => ICG_COLORS[n]),
          borderWidth: 1.5, borderRadius: 4,
        }]
      },
      options: { ...CHART_DEFAULTS,
        plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false },
          datalabels: { display: true, anchor: 'end', align: 'end', font: { family: 'Inter', size: 11, weight: '700' }, color: '#333',
            formatter: (v, ctx) => { const t = ctx.dataset.data.reduce((a,b) => a + b, 0); return v > 0 ? `${formatNum(v)} (${(v/t*100).toFixed(0)}%)` : ''; }
          }
        },
        scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, grace: '20%' } }
      }
    }));
  }

  // ── Helper: build geo-aware time series per year ──
  // Returns array of objects like serie_temporal[ano] but filtered by current CRE/mun
  const icgGeoSeries = (anos) => {
    // No filter → use full state-level data
    if (!S.munSel && !S.creSel) return anos.map(a => icg.serie_temporal[a]);

    return anos.map(a => {
      const munYear = icg.por_municipio?.[a] || {};

      // Single municipality
      if (S.munSel) return munYear[S.munSel] || null;

      // CRE: aggregate all municipalities in CRE
      if (S.creSel) {
        const creMuns = getCreMuns(S.creSel);
        const agg = { total_escolas: 0 };
        for (let n = 1; n <= 6; n++) agg[`nivel_${n}`] = { count: 0, pct: 0 };
        for (const cod of creMuns) {
          const m = munYear[cod];
          if (!m) continue;
          agg.total_escolas += m.total_escolas || 0;
          for (let n = 1; n <= 6; n++) agg[`nivel_${n}`].count += m[`nivel_${n}`]?.count || 0;
        }
        if (agg.total_escolas === 0) return null;
        for (let n = 1; n <= 6; n++) agg[`nivel_${n}`].pct = +(agg[`nivel_${n}`].count / agg.total_escolas * 100).toFixed(1);
        let wSum = 0;
        for (let n = 1; n <= 6; n++) wSum += n * agg[`nivel_${n}`].count;
        agg.nivel_medio = +(wSum / agg.total_escolas).toFixed(2);
        return agg;
      }
      return icg.serie_temporal[a];
    });
  };

  const geoTs = icgGeoSeries(anos);
  const geoFilterActive = !!(S.munSel || S.creSel);
  const geoFilterLabel = S.munSel
    ? (icg.lookup_municipios[S.munSel] || S.munSel)
    : (S.creSel ? (S.creLookup?.cre_list?.find(c => c.cod_cre === S.creSel)?.nome_cre || `CRE ${S.creSel}`) : '');

  // ── Chart 3: Nível médio evolução (line) ──
  const nivelMedioEl = document.getElementById('icg-chart-nivel-medio');
  if (nivelMedioEl) {
    const nivelMedioData = geoTs.map(s => s?.nivel_medio || null);
    // Auto-scale y axis
    const validVals = nivelMedioData.filter(v => v != null);
    const yMin = validVals.length ? Math.max(1, Math.floor(Math.min(...validVals) - 0.5)) : 1;
    const yMax = validVals.length ? Math.min(6, Math.ceil(Math.max(...validVals) + 0.5)) : 6;

    S.charts.push(new Chart(nivelMedioEl, {
      type: 'line',
      data: {
        labels: anos,
        datasets: [{
          label: geoFilterActive ? geoFilterLabel : 'Nível Médio',
          data: nivelMedioData,
          borderColor: COLORS.pri, backgroundColor: COLORS.pri + '18',
          fill: true, tension: .35, pointRadius: 5, borderWidth: 2.5,
        }]
      },
      options: { ...CHART_DEFAULTS, layout: { padding: { top: 25 } },
        plugins: { ...CHART_DEFAULTS.plugins,
          legend: { display: geoFilterActive, labels: { font: { family: 'Inter', size: 10, weight: '600' }, boxWidth: 10, padding: 8 } },
          datalabels: { ...DL_LINE_BOLD, formatter: v => v != null ? v.toFixed(2) : '' } },
        scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: false, min: yMin, max: yMax } }
      }
    }));
  }

  // ── Chart 4: Stacked % evolution ──
  const evolEl = document.getElementById('icg-chart-evol');
  if (evolEl) {
    const niveis = [1,2,3,4,5,6];
    S.charts.push(new Chart(evolEl, {
      type: 'bar',
      data: {
        labels: anos,
        datasets: niveis.map(n => ({
          label: ICG_SHORT[n],
          data: geoTs.map(s => s?.[`nivel_${n}`]?.pct || 0),
          backgroundColor: ICG_COLORS[n] + 'CC',
          borderColor: ICG_COLORS[n],
          borderWidth: 0.5,
        }))
      },
      options: { ...CHART_DEFAULTS,
        plugins: { ...CHART_DEFAULTS.plugins,
          legend: { display: true, labels: { font: { family: 'Inter', size: 9 }, boxWidth: 8, padding: 4 } },
          datalabels: { display: false } },
        scales: { x: { stacked: true, grid: { display: false }, ticks: { font: { family: 'Inter', size: 9 } } },
          y: { stacked: true, max: 100, grid: { color: COLORS.gridLine }, ticks: { font: { family: 'Inter', size: 9 }, callback: v => v + '%' } } }
      }
    }));
  }

  // ── Chart 5: Urbana vs Rural (state-level only — breakdown not available sub-state) ──
  const urbRurEl = document.getElementById('icg-chart-urbrur');
  if (urbRurEl) {
    const urbData = anos.map(a => icg.serie_temporal[a]?.urbana?.nivel_medio || null);
    const rurData = anos.map(a => icg.serie_temporal[a]?.rural?.nivel_medio || null);
    S.charts.push(new Chart(urbRurEl, {
      type: 'line',
      data: {
        labels: anos,
        datasets: [
          { label: 'Urbana', data: urbData, borderColor: COLORS.pri, tension: .3, pointRadius: 5, borderWidth: 2.5 },
          { label: 'Rural', data: rurData, borderColor: COLORS.red, borderDash: [5,5], tension: .3, pointRadius: 5, borderWidth: 2.5 },
        ]
      },
      options: { ...CHART_DEFAULTS, layout: { padding: { top: 25, bottom: 20 } },
        plugins: { ...CHART_DEFAULTS.plugins,
          datalabels: { ...DL_LINE_BOLD, formatter: v => v != null ? v.toFixed(2) : '' },
          legend: { display: true, labels: { font: { family: 'Inter', size: 10, weight: '600' }, boxWidth: 10, padding: 8 } } },
        scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: false, min: 1, max: 5 } }
      }
    }));
  }

  // ── Map: ICG by municipality ──
  const icgBuildMap = () => {
    if (!S.geo) return;
    const mapEl = document.getElementById('icg-map-leaflet');
    if (!mapEl) return;

    const munData = icg.por_municipio[ultimo] || {};

    const ICG_MAP_BREAKS = [
      { min: 0,   max: 2.0, color: '#43A047', label: '< 2.0 (Baixa)' },
      { min: 2.0, max: 3.0, color: '#66BB6A', label: '2.0–3.0' },
      { min: 3.0, max: 3.5, color: '#FFCB04', label: '3.0–3.5 (Média)' },
      { min: 3.5, max: 4.0, color: '#FB8C00', label: '3.5–4.0' },
      { min: 4.0, max: 99,  color: '#E53935', label: '> 4.0 (Alta)' },
    ];

    function getColor(v) {
      for (const b of ICG_MAP_BREAKS) {
        if (v >= b.min && v < b.max) return b.color;
      }
      return '#f0f0f0';
    }

    destroyMap();
    S.map = L.map('icg-map-leaflet', { zoomControl: true, scrollWheelZoom: true, attributionControl: false })
      .setView([-29.7, -53.5], 6.5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', { maxZoom: 14 }).addTo(S.map);

    const info = L.control({ position: 'topright' });
    info.onAdd = function () { this._div = L.DomUtil.create('div', 'map-info-panel'); this.update(); return this._div; };
    info.update = function (props, md) {
      if (!props) { this._div.innerHTML = '<h4>Passe o mouse sobre um município</h4>'; return; }
      const nome = props.nome || props.cod_mun;
      if (!md) { this._div.innerHTML = `<h4>${nome}</h4><div style="color:#999;font-size:11px">Sem dados ICG</div>`; return; }
      this._div.innerHTML = `
        <h4>${nome}</h4>
        <div class="info-row"><span class="info-label">Escolas</span><span class="info-value">${md.total_escolas}</span></div>
        <div class="info-row"><span class="info-label">Nível Médio</span><span class="info-value">${md.nivel_medio?.toFixed(2) ?? '—'}</span></div>
        <div class="info-row"><span class="info-label">N5+N6 (%)</span><span class="info-value">${(((md.nivel_5?.count||0)+(md.nivel_6?.count||0))/md.total_escolas*100).toFixed(0)}%</span></div>
      `;
    };
    info.addTo(S.map);

    S.mapLayer = L.geoJSON(S.geo, {
      style: feature => {
        const cod = feature.properties.cod_mun?.substring(0, 7);
        const md = munData[cod];
        const v = md?.nivel_medio || 0;
        return { fillColor: v > 0 ? getColor(v) : '#f0f0f0', weight: 0.8, opacity: 1, color: '#fff', fillOpacity: 0.85 };
      },
      onEachFeature: (feature, layer) => {
        const cod = feature.properties.cod_mun?.substring(0, 7);
        const md = munData[cod];
        layer.on({
          mouseover: e => { e.target.setStyle({ weight: 2.5, color: '#FFB300', fillOpacity: 0.95 }); e.target.bringToFront(); info.update(feature.properties, md); },
          mouseout: e => { S.mapLayer.resetStyle(e.target); info.update(); },
          click: () => { S.munSel = S.munSel === cod ? null : cod; refreshActiveTab(); }
        });
      }
    }).addTo(S.map);

    const legend = L.control({ position: 'bottomleft' });
    legend.onAdd = function () {
      const div = L.DomUtil.create('div', 'map-legend');
      div.innerHTML = '<h4>Nível Médio ICG</h4>' +
        ICG_MAP_BREAKS.slice().reverse().map(b =>
          `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${b.color}"></div><span>${b.label}</span></div>`
        ).join('') + '<div class="map-legend-row" style="margin-top:4px"><div class="map-legend-swatch" style="background:#f0f0f0"></div><span>Sem dados</span></div>';
      return div;
    };
    legend.addTo(S.map);
    S.mapLegend = legend;
  };

  // ── CRE layer for ICG map ──
  const icgBuildCreMap = () => {
    if (!S.creGeo || !S.map) return;
    if (S.mapLayer) { S.mapLayer.remove(); S.mapLayer = null; }
    if (S.mapLegend) { S.mapLegend.remove(); S.mapLegend = null; }

    const munToCre = S.creLookup?.mun_to_cre || {};
    const munData = icg.por_municipio[ultimo] || {};

    const creData = {};
    for (const [cod, v] of Object.entries(munData)) {
      const cre = munToCre[cod]?.cod_cre;
      if (!cre) continue;
      if (!creData[cre]) creData[cre] = { sumNm: 0, totalEsc: 0, nome: munToCre[cod]?.nome_cre || cre };
      if (v.nivel_medio && v.total_escolas) {
        creData[cre].sumNm += v.nivel_medio * v.total_escolas;
        creData[cre].totalEsc += v.total_escolas;
      }
    }
    for (const c of Object.values(creData)) c.avg = c.totalEsc > 0 ? c.sumNm / c.totalEsc : 0;

    const ICG_CRE_BREAKS = [
      { min: 0,   max: 2.0, color: '#43A047', label: '< 2.0 (Baixa)' },
      { min: 2.0, max: 3.0, color: '#66BB6A', label: '2.0–3.0' },
      { min: 3.0, max: 3.5, color: '#FFCB04', label: '3.0–3.5 (Média)' },
      { min: 3.5, max: 4.0, color: '#FB8C00', label: '3.5–4.0' },
      { min: 4.0, max: 99,  color: '#E53935', label: '> 4.0 (Alta)' },
    ];
    function getColor(v) {
      for (const b of ICG_CRE_BREAKS) { if (v >= b.min && v < b.max) return b.color; }
      return '#f0f0f0';
    }

    S.mapLayer = L.geoJSON(S.creGeo, {
      style: feature => {
        const cod = feature.properties.cod_cre;
        const avg = creData[cod]?.avg || 0;
        return { fillColor: avg > 0 ? getColor(avg) : '#f0f0f0', weight: 2, color: '#fff', fillOpacity: 0.8 };
      },
      onEachFeature: (feature, layer) => {
        const cod = feature.properties.cod_cre;
        const nome = feature.properties.nome_cre || cod;
        const d = creData[cod];
        layer.bindTooltip(`<strong>${nome}</strong><br>Nível Médio: ${d?.avg?.toFixed(2) ?? '—'}<br>${d?.totalEsc || 0} escolas`, { sticky: true });
        layer.on('click', () => { S.creSel = cod; const selCre = document.getElementById('sel-cre'); if (selCre) selCre.value = cod; populateMunDropdown(cod); refreshActiveTab(); });
      }
    }).addTo(S.map);

    const creLegend = L.control({ position: 'bottomleft' });
    creLegend.onAdd = function () {
      const div = L.DomUtil.create('div', 'map-legend');
      div.innerHTML = '<h4>Nível Médio ICG (CREs)</h4>' +
        ICG_CRE_BREAKS.slice().reverse().map(b => `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${b.color}"></div><span>${b.label}</span></div>`).join('');
      return div;
    };
    creLegend.addTo(S.map);
    S.mapLegend = creLegend;
  };

  // ── Table: Municipality ranking ──
  const icgBuildMunTable = () => {
    const tbody = document.querySelector('#icg-mun-table tbody');
    if (!tbody) return;
    const munData = icg.por_municipio[ultimo] || {};
    const lookup = icg.lookup_municipios || {};

    let entries = Object.entries(munData);
    if (S.creSel && S.creLookup?.mun_to_cre) {
      entries = entries.filter(([cod]) => S.creLookup.mun_to_cre[cod]?.cod_cre === S.creSel);
    }
    if (S.munSel) {
      entries = entries.filter(([cod]) => cod === S.munSel);
    }
    entries.sort((a, b) => (b[1].nivel_medio || 0) - (a[1].nivel_medio || 0));

    const nivelMedioColor = v => {
      if (v >= 4) return '#C62828';
      if (v >= 3.5) return '#FB8C00';
      if (v >= 3) return '#FFCB04';
      return '#43A047';
    };

    tbody.innerHTML = entries.map(([cod, md], i) => {
      const pcts = [1,2,3,4,5,6].map(n => md.total_escolas > 0 ? (md[`nivel_${n}`]?.count || 0) / md.total_escolas * 100 : 0);
      const pctColor = (v, n) => {
        if (v === 0) return '#ccc';
        return ICG_COLORS[n];
      };
      return `
        <tr style="cursor:pointer" data-cod="${cod}">
          <td>${i + 1}</td>
          <td>${lookup[cod] || cod}</td>
          <td>${md.total_escolas}</td>
          <td><strong style="color:${nivelMedioColor(md.nivel_medio)}">${md.nivel_medio?.toFixed(2) ?? '—'}</strong></td>
          ${pcts.map((p, idx) => `<td style="color:${pctColor(p, idx+1)};font-weight:${p >= 30 ? '700' : '400'}">${p.toFixed(0)}%</td>`).join('')}
        </tr>`;
    }).join('');

    // Click to filter
    tbody.querySelectorAll('tr[data-cod]').forEach(tr => {
      tr.addEventListener('click', () => {
        S.munSel = S.munSel === tr.dataset.cod ? null : tr.dataset.cod;
        refreshActiveTab();
      });
    });

    // Search
    document.getElementById('icg-mun-search')?.addEventListener('input', e => {
      const q = e.target.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      tbody.querySelectorAll('tr').forEach(tr => {
        const nome = (tr.children[1]?.textContent || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        tr.style.display = nome.includes(q) ? '' : 'none';
      });
    });
  };

  // Build everything
  icgBuildMap();
  icgBuildMunTable();
  injectExportButtons();

  // Bind ICG map layer toggle
  const icgBtnMun = document.getElementById('icg-btn-layer-mun');
  const icgBtnCre = document.getElementById('icg-btn-layer-cre');
  if (icgBtnMun && icgBtnCre) {
    icgBtnMun.addEventListener('click', () => {
      icgBtnMun.classList.add('active'); icgBtnCre.classList.remove('active');
      icgBuildMap();
    });
    icgBtnCre.addEventListener('click', () => {
      icgBtnCre.classList.add('active'); icgBtnMun.classList.remove('active');
      icgBuildCreMap();
    });
  }

  // Re-populate topbar filters
  const selAno = document.getElementById('sel-ano');
  if (selAno) {
    selAno.innerHTML = anos.map(a => `<option value="${a}" ${a === ultimo ? 'selected' : ''}>${a}</option>`).join('');
  }
  populateCreDropdown();
  populateMunDropdown(S.creSel || null);
  const selCre = document.getElementById('sel-cre');
  if (selCre && S.creSel) selCre.value = S.creSel;
  const selMunEl = document.getElementById('sel-mun');
  if (selMunEl && S.munSel) selMunEl.value = S.munSel;
  bindTopbarFilters();
  bindRedeToggle();
  updateActiveFilters();
}

// ══════════════════════════════════════════════════════════
// ADEQUAÇÃO DA FORMAÇÃO DOCENTE (AFD)
// ══════════════════════════════════════════════════════════

const FONTE_AFD = 'Fonte: INEP — Indicador de Adequação da Formação Docente';

const AFD_GROUPS = {
  g1: { label: 'G1 — Licenciatura na área', short: 'G1', color: '#43A047' },
  g2: { label: 'G2 — Bacharelado na área', short: 'G2', color: '#66BB6A' },
  g3: { label: 'G3 — Licenciatura em outra área', short: 'G3', color: '#FFCB04' },
  g4: { label: 'G4 — Outra formação superior', short: 'G4', color: '#FB8C00' },
  g5: { label: 'G5 — Sem curso superior', short: 'G5', color: '#E53935' },
};

const AFD_ETAPAS = [
  { key: 'ed_inf', label: 'Ed. Infantil', short: 'Infantil' },
  { key: 'fund_total', label: 'Fundamental (Total)', short: 'Fund.' },
  { key: 'fund_ai', label: 'Fund. Anos Iniciais', short: 'AI' },
  { key: 'fund_af', label: 'Fund. Anos Finais', short: 'AF' },
  { key: 'medio', label: 'Ensino Médio', short: 'Médio' },
  { key: 'eja_fund', label: 'EJA Fundamental', short: 'EJA F' },
  { key: 'eja_medio', label: 'EJA Médio', short: 'EJA M' },
];

function renderAfd() {
  const main = document.getElementById('main-content');
  destroyCharts(); destroyMap();

  const afd = S.afd;
  if (!afd) {
    main.innerHTML = `
      <div class="section-sticky">
        ${sectionBanner('img/icons/sec_docentes.png', 'Adequação da Formação Docente', getRedeLabel() + ' do RS')}
        ${redeToggleHTML()}
      </div>
      <div style="text-align:center;padding:60px 20px;color:var(--text-sec);">
        <p style="font-size:1.1rem;font-weight:600;">Dados de Adequação da Formação Docente não disponíveis para a ${getRedeLabel()}</p>
      </div>`;
    bindRedeToggle();
    return;
  }

  const anos = Object.keys(afd.serie_temporal).sort();
  const ultimo = anos[anos.length - 1];
  const primeiro = anos[0];
  const st = afd.serie_temporal[ultimo];
  const lookup = afd.lookup_municipios || {};

  const displayData = S.munSel
    ? (afd.por_municipio?.[ultimo]?.[S.munSel] || st)
    : (S.creSel ? (() => {
        const creMuns = getCreMuns(S.creSel);
        const agg = { total_escolas: 0 };
        const munYear = afd.por_municipio?.[ultimo] || {};
        for (const cod of creMuns) {
          const m = munYear[cod]; if (!m) continue;
          agg.total_escolas += m.total_escolas || 0;
          for (const et of AFD_ETAPAS) {
            if (!m[et.key]) continue;
            if (!agg[et.key]) agg[et.key] = { g1: 0, g2: 0, g3: 0, g4: 0, g5: 0, _n: 0 };
            for (let g = 1; g <= 5; g++) agg[et.key][`g${g}`] += m[et.key][`g${g}`] || 0;
            agg[et.key]._n++;
          }
        }
        for (const et of AFD_ETAPAS) {
          if (agg[et.key] && agg[et.key]._n > 0) {
            for (let g = 1; g <= 5; g++) agg[et.key][`g${g}`] = +(agg[et.key][`g${g}`] / agg[et.key]._n).toFixed(1);
          }
        }
        return agg;
      })() : st);

  // Geo label
  let geoLabel = getRedeLabel() + ' do RS';
  if (S.munSel && lookup[S.munSel]) geoLabel = lookup[S.munSel];
  else if (S.creSel) geoLabel = (S.creLookup?.cre_list?.find(c => c.cod_cre === S.creSel)?.nome_cre) || `CRE ${S.creSel}`;

  main.innerHTML = `
    <div class="section-sticky">
      ${sectionBanner('img/icons/sec_docentes.png', 'Adequação da Formação Docente', geoLabel)}
      ${redeToggleHTML()}
      <div class="kpi-strip" id="afd-kpis" style="grid-template-columns:repeat(4,1fr)"></div>
    </div>

    <!-- ═══ BLOCO INFORMATIVO: O que é o AFD? ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/sec_docentes.png" alt=""></span>
      <span class="section-divider-text">O que é o AFD?</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="chart-card" style="padding:0;overflow:hidden;border:1px solid rgba(0,90,50,.08)">
      <div style="display:grid;grid-template-columns:1fr 1fr">
        <div style="padding:20px 24px;background:linear-gradient(135deg,#f8fdf9 0%,#eef6f0 100%)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
            <img src="img/icons/sec_docentes.png" alt="" style="width:20px;height:20px">
            <span style="font-size:14px;font-weight:700;color:var(--pri)">Definição</span>
          </div>
          <p style="font-size:11.5px;margin:0 0 16px;color:#333;line-height:1.75">
            Classifica as <strong>docências</strong> (par professor × disciplina) em <strong>5 grupos</strong>
            conforme a adequação da formação do professor à disciplina que leciona.
            Baseado nos dados do <strong>Censo Escolar</strong> (INEP).
          </p>
          <div style="background:rgba(0,171,78,.08);border:1px solid rgba(0,171,78,.2);border-radius:6px;padding:10px 14px">
            <p style="font-size:11px;margin:0;color:#1B5E20;line-height:1.7">
              <strong>Meta 15 do PNE:</strong> 100% dos docentes com formação em licenciatura
              na área em que atuam — <strong>G1 = 100%</strong> é o cenário ideal.
            </p>
          </div>
        </div>
        <div style="padding:20px 24px;border-left:1px solid rgba(0,90,50,.06)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
            <img src="img/icons/panorama.png" alt="" style="width:20px;height:20px">
            <span style="font-size:14px;font-weight:700;color:var(--pri)">Escala de Grupos</span>
          </div>
          <table style="width:100%;font-size:11px;border-collapse:separate;border-spacing:0">
            <thead>
              <tr><th style="padding:6px 8px;text-align:left;background:#f0f4f8;border-bottom:2px solid #ddd;font-weight:700;color:#333">Grupo</th><th style="padding:6px 8px;text-align:left;background:#f0f4f8;border-bottom:2px solid #ddd;font-weight:700;color:#333">Descrição</th></tr>
            </thead>
            <tbody>
              <tr><td style="padding:5px 8px;border-bottom:1px solid #eee"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#43A047;vertical-align:middle;margin-right:6px"></span>G1</td><td style="padding:5px 8px;border-bottom:1px solid #eee">Licenciatura na mesma área que leciona</td></tr>
              <tr style="background:#fafbfc"><td style="padding:5px 8px;border-bottom:1px solid #eee"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#66BB6A;vertical-align:middle;margin-right:6px"></span>G2</td><td style="padding:5px 8px;border-bottom:1px solid #eee">Bacharelado na área, sem licenciatura</td></tr>
              <tr><td style="padding:5px 8px;border-bottom:1px solid #eee"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#FFCB04;vertical-align:middle;margin-right:6px"></span>G3</td><td style="padding:5px 8px;border-bottom:1px solid #eee">Licenciatura em outra área</td></tr>
              <tr style="background:#fafbfc"><td style="padding:5px 8px;border-bottom:1px solid #eee"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#FB8C00;vertical-align:middle;margin-right:6px"></span>G4</td><td style="padding:5px 8px;border-bottom:1px solid #eee">Outra formação superior</td></tr>
              <tr><td style="padding:5px 8px"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#E53935;vertical-align:middle;margin-right:6px"></span>G5</td><td style="padding:5px 8px">Sem curso superior completo</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ═══ EIXO: Distribuição por Grupo ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/panorama.png" alt=""></span>
      <span class="section-divider-text">Distribuição por Grupo — ${ultimo}</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title">Percentual por Grupo de Adequação — por Etapa (${ultimo})</div>
        <div style="height:280px"><canvas id="afd-chart-etapa"></canvas></div>
        <div class="chart-source">${FONTE_AFD}</div>
      </div>
    </div>

    <!-- ═══ EIXO: Evolução Temporal ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/sec_evolucao.png" alt=""></span>
      <span class="section-divider-text">Evolução Temporal (${primeiro}–${ultimo})</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title">Evolução do % G1 (Formação Adequada) — por Etapa</div>
        <div style="height:260px"><canvas id="afd-chart-g1-evol"></canvas></div>
        <div class="chart-source">${FONTE_AFD}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Evolução G5 (Sem Superior) — por Etapa</div>
        <div style="height:260px"><canvas id="afd-chart-g5-evol"></canvas></div>
        <div class="chart-source">${FONTE_AFD}</div>
      </div>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title">Composição — Fundamental (% empilhado)</div>
        <div style="height:220px"><canvas id="afd-chart-stack-fund"></canvas></div>
        <div class="chart-source">${FONTE_AFD}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Composição — Ensino Médio (% empilhado)</div>
        <div style="height:220px"><canvas id="afd-chart-stack-med"></canvas></div>
        <div class="chart-source">${FONTE_AFD}</div>
      </div>
    </div>

    <!-- ═══ EIXO: Distribuição Territorial ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/territorial.png" alt=""></span>
      <span class="section-divider-text">Distribuição Territorial — ${ultimo}</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="map-table-row d1">
      <div class="map-container">
        <div class="map-toolbar">
          <h3>Mapa — % G1 Fundamental <span id="afd-map-ano">${ultimo}</span></h3>
          <div class="map-layer-toggle">
            <button class="map-layer-btn active" id="afd-btn-layer-mun">Municípios</button>
            <button class="map-layer-btn" id="afd-btn-layer-cre">CREs</button>
          </div>
        </div>
        <div id="afd-map-leaflet" style="height:380px;border-radius:8px"></div>
      </div>
      <div class="table-wrapper" id="afd-table-wrapper">
        <div class="table-header">
          <h3>Tabela de Municípios — AFD</h3>
          <input type="text" class="table-search" id="afd-mun-search" placeholder="Buscar...">
        </div>
        <div style="max-height:400px;overflow-y:auto">
          <table class="data-table" id="afd-mun-table">
            <thead><tr>
              <th>#</th><th>Município</th><th>Escolas</th>
              <th>G1</th><th>G2</th><th>G3</th><th>G4</th><th>G5</th>
            </tr></thead>
            <tbody></tbody>
          </table>
        </div>
        <div class="chart-source">${FONTE_AFD}</div>
      </div>
    </div>
  `;

  // ── KPIs (standard kpi-strip pattern) ──
  const strip = document.getElementById('afd-kpis');
  if (strip) {
    const g3General = (() => {
      const etapas = ['fund_total', 'medio'].filter(e => displayData[e]);
      if (!etapas.length) return 0;
      return (etapas.reduce((s, e) => s + (displayData[e].g3 || 0), 0) / etapas.length).toFixed(1);
    })();
    const kpis = [
      { label: `G1 Fundamental (${ultimo})`, value: displayData.fund_total?.g1 != null ? displayData.fund_total.g1.toFixed(1) + '%' : '—', icon: 'img/icons/sec_docentes.png', accent: (displayData.fund_total?.g1 || 0) >= 60 ? 'green' : 'red', noFormat: true },
      { label: `G1 Ens. Médio (${ultimo})`, value: displayData.medio?.g1 != null ? displayData.medio.g1.toFixed(1) + '%' : '—', icon: 'img/icons/sec_docentes.png', accent: (displayData.medio?.g1 || 0) >= 60 ? 'green' : 'red', noFormat: true },
      { label: 'G3 — Outra Licenciatura', value: g3General + '%', icon: 'img/icons/politicas.png', accent: parseFloat(g3General) > 25 ? 'red' : 'green', noFormat: true },
      { label: `Escolas (${ultimo})`, value: displayData.total_escolas || st.total_escolas || 0, icon: 'img/icons/escola.png', accent: 'green' },
    ];
    strip.innerHTML = kpis.map((k, i) => `
      <div class="kpi-card accent-${k.accent}" style="animation-delay:${i * 80}ms">
        <div class="kpi-top">
          <span class="kpi-label">${k.label}</span>
          <img class="kpi-icon" src="${k.icon}" alt="">
        </div>
        <div class="kpi-body">
          <span class="kpi-value">${k.noFormat ? k.value : formatNum(k.value)}</span>
        </div>
      </div>`).join('');
  }

  // ── Chart 1: Stacked bar by etapa (latest year) ──
  const etapaEl = document.getElementById('afd-chart-etapa');
  if (etapaEl) {
    const etapasWithData = AFD_ETAPAS.filter(e => displayData[e.key]);
    const gKeys = ['g1','g2','g3','g4','g5'];
    S.charts.push(new Chart(etapaEl, {
      type: 'bar',
      data: {
        labels: etapasWithData.map(e => e.short),
        datasets: gKeys.map(gk => ({
          label: AFD_GROUPS[gk].short,
          data: etapasWithData.map(e => displayData[e.key]?.[gk] || 0),
          backgroundColor: AFD_GROUPS[gk].color + 'CC',
          borderColor: AFD_GROUPS[gk].color,
          borderWidth: 0.5,
        }))
      },
      options: { ...CHART_DEFAULTS,
        plugins: { ...CHART_DEFAULTS.plugins,
          legend: { display: true, labels: { font: { family: 'Inter', size: 10 }, boxWidth: 10, padding: 6 } },
          datalabels: { display: ctx => ctx.dataset.data[ctx.dataIndex] >= 8, color: '#fff', font: { family: 'Inter', size: 9, weight: '700' }, formatter: v => v.toFixed(0) + '%' } },
        scales: { x: { stacked: true, grid: { display: false }, ticks: { font: { family: 'Inter', size: 10 } } },
          y: { stacked: true, max: 100, grid: { color: COLORS.gridLine }, ticks: { font: { family: 'Inter', size: 9 }, callback: v => v + '%' } } }
      }
    }));
  }

  // ── Geo-aware time series helper ──
  const afdGeoSeries = (anos) => {
    if (!S.munSel && !S.creSel) return anos.map(a => afd.serie_temporal[a]);
    return anos.map(a => {
      const munYear = afd.por_municipio?.[a] || {};
      if (S.munSel) return munYear[S.munSel] || null;
      if (S.creSel) {
        const creMuns = getCreMuns(S.creSel);
        const agg = { total_escolas: 0 };
        for (const cod of creMuns) {
          const m = munYear[cod]; if (!m) continue;
          agg.total_escolas += m.total_escolas || 0;
          for (const et of AFD_ETAPAS) {
            if (!m[et.key]) continue;
            if (!agg[et.key]) agg[et.key] = { g1: 0, g2: 0, g3: 0, g4: 0, g5: 0, _n: 0 };
            for (let g = 1; g <= 5; g++) agg[et.key][`g${g}`] += m[et.key][`g${g}`] || 0;
            agg[et.key]._n++;
          }
        }
        for (const et of AFD_ETAPAS) {
          if (agg[et.key]?._n > 0) {
            for (let g = 1; g <= 5; g++) agg[et.key][`g${g}`] = +(agg[et.key][`g${g}`] / agg[et.key]._n).toFixed(1);
          }
        }
        return agg;
      }
      return afd.serie_temporal[a];
    });
  };
  const geoTs = afdGeoSeries(anos);

  // ── Chart 2: G1 evolution by etapa (line) ──
  const g1El = document.getElementById('afd-chart-g1-evol');
  if (g1El) {
    const mainEtapas = AFD_ETAPAS.filter(e => ['fund_total','fund_af','medio','eja_fund'].includes(e.key));
    const etapaColors = { fund_total: COLORS.pri, fund_af: '#F57C00', medio: COLORS.red, eja_fund: COLORS.federal };
    S.charts.push(new Chart(g1El, {
      type: 'line',
      data: {
        labels: anos,
        datasets: mainEtapas.map(e => ({
          label: e.short,
          data: geoTs.map(s => s?.[e.key]?.g1 ?? null),
          borderColor: etapaColors[e.key] || '#999',
          tension: .3, pointRadius: 3, borderWidth: 2,
        }))
      },
      options: { ...CHART_DEFAULTS, layout: { padding: { top: 20 } },
        plugins: { ...CHART_DEFAULTS.plugins,
          legend: { display: true, labels: { font: { family: 'Inter', size: 10, weight: '600' }, boxWidth: 10, padding: 6 } },
          datalabels: { display: false } },
        scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: false, min: 0, max: 100, ticks: { ...CHART_DEFAULTS.scales.y?.ticks, callback: v => v + '%' } } }
      }
    }));
  }

  // ── Chart 3: G5 evolution by etapa (line) ──
  const g5El = document.getElementById('afd-chart-g5-evol');
  if (g5El) {
    const mainEtapas = AFD_ETAPAS.filter(e => ['fund_total','fund_af','medio','eja_fund'].includes(e.key));
    const etapaColors = { fund_total: COLORS.pri, fund_af: '#F57C00', medio: COLORS.red, eja_fund: COLORS.federal };
    S.charts.push(new Chart(g5El, {
      type: 'line',
      data: {
        labels: anos,
        datasets: mainEtapas.map(e => ({
          label: e.short,
          data: geoTs.map(s => s?.[e.key]?.g5 ?? null),
          borderColor: etapaColors[e.key] || '#999',
          borderDash: [4, 3],
          tension: .3, pointRadius: 3, borderWidth: 2,
        }))
      },
      options: { ...CHART_DEFAULTS, layout: { padding: { top: 20 } },
        plugins: { ...CHART_DEFAULTS.plugins,
          legend: { display: true, labels: { font: { family: 'Inter', size: 10, weight: '600' }, boxWidth: 10, padding: 6 } },
          datalabels: { display: false } },
        scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: true, suggestedMax: 30, ticks: { ...CHART_DEFAULTS.scales.y?.ticks, callback: v => v + '%' } } }
      }
    }));
  }

  // ── Chart 4 & 5: Stacked % evolution for Fund and Medio ──
  ['fund_total', 'medio'].forEach((etKey, idx) => {
    const elId = idx === 0 ? 'afd-chart-stack-fund' : 'afd-chart-stack-med';
    const el = document.getElementById(elId);
    if (!el) return;
    const gKeys = ['g1','g2','g3','g4','g5'];
    S.charts.push(new Chart(el, {
      type: 'bar',
      data: {
        labels: anos,
        datasets: gKeys.map(gk => ({
          label: AFD_GROUPS[gk].short,
          data: geoTs.map(s => s?.[etKey]?.[gk] || 0),
          backgroundColor: AFD_GROUPS[gk].color + 'CC',
          borderColor: AFD_GROUPS[gk].color,
          borderWidth: 0.5,
        }))
      },
      options: { ...CHART_DEFAULTS,
        plugins: { ...CHART_DEFAULTS.plugins,
          legend: { display: true, labels: { font: { family: 'Inter', size: 9 }, boxWidth: 8, padding: 4 } },
          datalabels: { display: false } },
        scales: { x: { stacked: true, grid: { display: false }, ticks: { font: { family: 'Inter', size: 9 } } },
          y: { stacked: true, max: 100, grid: { color: COLORS.gridLine }, ticks: { font: { family: 'Inter', size: 9 }, callback: v => v + '%' } } }
      }
    }));
  });

  // ── Map: AFD by municipality ──
  const AFD_MAP_BREAKS = [
    { min: 0,   max: 30, color: '#E53935', label: '< 30% (Crítico)' },
    { min: 30,  max: 50, color: '#FB8C00', label: '30–50%' },
    { min: 50,  max: 70, color: '#FFCB04', label: '50–70%' },
    { min: 70,  max: 85, color: '#66BB6A', label: '70–85%' },
    { min: 85,  max: 101, color: '#2E7D32', label: '> 85% (Adequado)' },
  ];
  function getAfdColor(v) {
    for (const b of AFD_MAP_BREAKS) { if (v >= b.min && v < b.max) return b.color; }
    return '#f0f0f0';
  }

  const afdBuildMap = () => {
    if (!S.geo) return;
    const mapEl = document.getElementById('afd-map-leaflet');
    if (!mapEl) return;
    const munData = afd.por_municipio[ultimo] || {};

    destroyMap();
    S.map = L.map('afd-map-leaflet', { zoomControl: true, scrollWheelZoom: true, attributionControl: false })
      .setView([-29.7, -53.5], 6.5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', { maxZoom: 14 }).addTo(S.map);

    const info = L.control({ position: 'topright' });
    info.onAdd = function () { this._div = L.DomUtil.create('div', 'map-info-panel'); this.update(); return this._div; };
    info.update = function (props, md) {
      if (!props) { this._div.innerHTML = '<h4>Passe o mouse sobre um município</h4>'; return; }
      const nome = props.nome || props.cod_mun;
      if (!md || !md.fund_total) { this._div.innerHTML = `<h4>${nome}</h4><div style="color:#999;font-size:11px">Sem dados AFD</div>`; return; }
      this._div.innerHTML = `
        <h4>${nome}</h4>
        <div class="info-row"><span class="info-label">Escolas</span><span class="info-value">${md.total_escolas}</span></div>
        <div class="info-row"><span class="info-label">G1 Fund.</span><span class="info-value" style="color:#43A047">${md.fund_total?.g1?.toFixed(1) ?? '—'}%</span></div>
        <div class="info-row"><span class="info-label">G1 Médio</span><span class="info-value" style="color:#43A047">${md.medio?.g1?.toFixed(1) ?? '—'}%</span></div>
        <div class="info-row"><span class="info-label">G5</span><span class="info-value" style="color:#E53935">${md.fund_total?.g5?.toFixed(1) ?? '—'}%</span></div>
      `;
    };
    info.addTo(S.map);

    S.mapLayer = L.geoJSON(S.geo, {
      style: feature => {
        const cod = feature.properties.cod_mun?.substring(0, 7);
        const md = munData[cod];
        const v = md?.fund_total?.g1 || 0;
        return { fillColor: v > 0 ? getAfdColor(v) : '#f0f0f0', weight: 0.8, opacity: 1, color: '#fff', fillOpacity: 0.85 };
      },
      onEachFeature: (feature, layer) => {
        const cod = feature.properties.cod_mun?.substring(0, 7);
        const md = munData[cod];
        layer.on({
          mouseover: e => { e.target.setStyle({ weight: 2.5, color: '#FFB300', fillOpacity: 0.95 }); e.target.bringToFront(); info.update(feature.properties, md); },
          mouseout: e => { S.mapLayer.resetStyle(e.target); info.update(); },
          click: () => { S.munSel = S.munSel === cod ? null : cod; refreshActiveTab(); }
        });
      }
    }).addTo(S.map);

    const legend = L.control({ position: 'bottomleft' });
    legend.onAdd = function () {
      const div = L.DomUtil.create('div', 'map-legend');
      div.innerHTML = '<h4>% G1 Fund. (Adequado)</h4>' +
        AFD_MAP_BREAKS.slice().reverse().map(b =>
          `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${b.color}"></div><span>${b.label}</span></div>`
        ).join('') + '<div class="map-legend-row" style="margin-top:4px"><div class="map-legend-swatch" style="background:#f0f0f0"></div><span>Sem dados</span></div>';
      return div;
    };
    legend.addTo(S.map);
    S.mapLegend = legend;
  };

  // ── CRE layer for AFD map ──
  const afdBuildCreMap = () => {
    if (!S.creGeo || !S.map) return;
    if (S.mapLayer) { S.mapLayer.remove(); S.mapLayer = null; }
    if (S.mapLegend) { S.mapLegend.remove(); S.mapLegend = null; }
    const munToCre = S.creLookup?.mun_to_cre || {};
    const munData = afd.por_municipio[ultimo] || {};
    const creData = {};
    for (const [cod, v] of Object.entries(munData)) {
      const cre = munToCre[cod]?.cod_cre;
      if (!cre) continue;
      if (!creData[cre]) creData[cre] = { sumG1: 0, count: 0, nome: munToCre[cod]?.nome_cre || cre };
      if (v.fund_total?.g1 != null) { creData[cre].sumG1 += v.fund_total.g1; creData[cre].count++; }
    }
    for (const c of Object.values(creData)) c.avg = c.count > 0 ? c.sumG1 / c.count : 0;

    S.mapLayer = L.geoJSON(S.creGeo, {
      style: feature => {
        const cod = feature.properties.cod_cre;
        const avg = creData[cod]?.avg || 0;
        return { fillColor: avg > 0 ? getAfdColor(avg) : '#f0f0f0', weight: 2, color: '#fff', fillOpacity: 0.8 };
      },
      onEachFeature: (feature, layer) => {
        const cod = feature.properties.cod_cre;
        const nome = feature.properties.nome_cre || cod;
        const d = creData[cod];
        layer.bindTooltip(`<strong>${nome}</strong><br>G1 Fund.: ${d?.avg?.toFixed(1) ?? '—'}%<br>${d?.count || 0} municípios`, { sticky: true });
        layer.on('click', () => { S.creSel = cod; const selCre = document.getElementById('sel-cre'); if (selCre) selCre.value = cod; populateMunDropdown(cod); refreshActiveTab(); });
      }
    }).addTo(S.map);

    const creLegend = L.control({ position: 'bottomleft' });
    creLegend.onAdd = function () {
      const div = L.DomUtil.create('div', 'map-legend');
      div.innerHTML = '<h4>% G1 Fund. (CREs)</h4>' +
        AFD_MAP_BREAKS.slice().reverse().map(b => `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${b.color}"></div><span>${b.label}</span></div>`).join('');
      return div;
    };
    creLegend.addTo(S.map);
    S.mapLegend = creLegend;
  };

  // ── Table: Municipality ranking ──
  const afdBuildMunTable = () => {
    const tbody = document.querySelector('#afd-mun-table tbody');
    if (!tbody) return;
    const munData = afd.por_municipio[ultimo] || {};
    let entries = Object.entries(munData);
    if (S.creSel && S.creLookup?.mun_to_cre) entries = entries.filter(([cod]) => S.creLookup.mun_to_cre[cod]?.cod_cre === S.creSel);
    if (S.munSel) entries = entries.filter(([cod]) => cod === S.munSel);
    entries.sort((a, b) => (b[1].fund_total?.g1 || 0) - (a[1].fund_total?.g1 || 0));

    tbody.innerHTML = entries.map(([cod, md], i) => {
      const ft = md.fund_total || {};
      return `
        <tr style="cursor:pointer" data-cod="${cod}">
          <td>${i + 1}</td>
          <td>${lookup[cod] || cod}</td>
          <td>${md.total_escolas}</td>
          ${['g1','g2','g3','g4','g5'].map(gk => {
            const v = ft[gk] ?? 0;
            return `<td style="color:${AFD_GROUPS[gk].color};font-weight:${v >= 30 ? '700' : '400'}">${v.toFixed(0)}%</td>`;
          }).join('')}
        </tr>`;
    }).join('');

    tbody.querySelectorAll('tr[data-cod]').forEach(tr => {
      tr.addEventListener('click', () => { S.munSel = S.munSel === tr.dataset.cod ? null : tr.dataset.cod; refreshActiveTab(); });
    });

    const searchEl = document.getElementById('afd-mun-search');
    if (searchEl) searchEl.addEventListener('input', e => {
      const q = e.target.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      tbody.querySelectorAll('tr').forEach(tr => {
        const nome = (tr.children[1]?.textContent || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        tr.style.display = nome.includes(q) ? '' : 'none';
      });
    });
  };

  // Build everything
  afdBuildMap();
  afdBuildMunTable();
  injectExportButtons();

  // Bind AFD map layer toggle
  const afdBtnMun = document.getElementById('afd-btn-layer-mun');
  const afdBtnCre = document.getElementById('afd-btn-layer-cre');
  if (afdBtnMun && afdBtnCre) {
    afdBtnMun.addEventListener('click', () => {
      afdBtnMun.classList.add('active'); afdBtnCre.classList.remove('active');
      afdBuildMap();
    });
    afdBtnCre.addEventListener('click', () => {
      afdBtnCre.classList.add('active'); afdBtnMun.classList.remove('active');
      afdBuildCreMap();
    });
  }

  // Re-populate topbar filters
  const selAno = document.getElementById('sel-ano');
  if (selAno) {
    selAno.innerHTML = anos.map(a => `<option value="${a}" ${a === ultimo ? 'selected' : ''}>${a}</option>`).join('');
  }
  populateCreDropdown();
  populateMunDropdown(S.creSel || null);
  const selCre = document.getElementById('sel-cre');
  if (selCre && S.creSel) selCre.value = S.creSel;
  const selMunEl = document.getElementById('sel-mun');
  if (selMunEl && S.munSel) selMunEl.value = S.munSel;
  bindTopbarFilters();
  bindRedeToggle();
  updateActiveFilters();
}

function initNav() {
  document.querySelectorAll('.sidebar-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const view = tab.dataset.view;

      if (view === 'home') { renderHome(); return; }

      document.body.classList.remove('sidebar-hidden');

      if (view === 'acesso' && S.data) { renderAcesso(); }
      else if (view === 'fluxo') { renderFluxo(); }
      else if (view === 'infra' && S.infra) { renderInfra(); }
      else if (view === 'docencia' && S.doc) { renderDocencia(); }
      else if (view === 'desempenho') { renderSaeb(); }
      else if (view === 'saeb') { renderSaeb(); }
      else if (view === 'ideb') { renderIdeb(); }
      else if (view === 'inse') { renderInse(); }
      else if (view === 'icg') { renderIcg(); }
      else if (view === 'afd') { renderAfd(); }
      else {
        const main = document.getElementById('main-content');
        destroyCharts(); destroyMap();
        const names = { fluxo:'Fluxo e Rendimento' };
        main.innerHTML = `<div class="placeholder-view">
          <div style="font-size:40px;opacity:.3">📊</div>
          <div style="font-size:15px;font-weight:600">${names[view] || view}</div>
          <div style="font-size:11px;opacity:.7">Dados em preparação — aguardando bases do INEP</div>
        </div>`;
      }
    });
  });
}

// ══════════════════════════════════════════════════════════
// FAIXA ETARIA
// ══════════════════════════════════════════════════════════

function buildFaixaEtaria(d, anoSel) {
  const el = document.getElementById('chart-faixa');
  if (!el) return;
  const fxLabels = ['0–3 anos', '4–5 anos', '6–10 anos', '11–14 anos', '15–17 anos', '18+ anos'];
  const fxKeys = ['fx_0_3', 'fx_4_5', 'fx_6_10', 'fx_11_14', 'fx_15_17', 'fx_18_mais'];
  const fxColors = [COLORS.yellow, COLORS.yellowLight, COLORS.pri, COLORS.priDark, COLORS.red, COLORS.eja];

  let src;
  if (S.munSel) {
    src = d.por_municipio[anoSel]?.[S.munSel] || {};
  } else {
    src = d.serie_temporal[anoSel] || {};
  }
  const data = fxKeys.map(k => src[k] || 0);

  S.charts.push(new Chart(el, {
    type: 'bar',
    data: { labels: fxLabels, datasets: [{ label: 'Matrículas', data, backgroundColor: fxColors.map(c => c + 'CC'), borderColor: fxColors, borderWidth: 1, borderRadius: 6 }] },
    options: { ...CHART_DEFAULTS, indexAxis: 'y',
      plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_BAR,
        tooltip: { ...CHART_DEFAULTS.plugins.tooltip, callbacks: { label: ctx => ` Matrículas: ${formatNum(ctx.parsed.x)}` } }
      },
      scales: { x: { grid: { color: COLORS.gridLine }, ticks: { font: { family: 'Inter', size: 9 }, callback: v => formatNum(v) } }, y: { grid: { display: false }, ticks: { font: { family: 'Inter', size: 10 } } } }
    }
  }));
}

// ══════════════════════════════════════════════════════════
// NOTURNO
// ══════════════════════════════════════════════════════════

function buildNoturno(d, anos, anoSel) {
  const el = document.getElementById('chart-noturno');
  if (!el) return;

  if (S.munSel) {
    // Municipality: single line
    const vals = anos.map(a => d.por_municipio[a]?.[S.munSel]?.mat_noturno || 0);
    S.charts.push(new Chart(el, {
      type: 'line',
      data: { labels: anos, datasets: [{ label: 'Noturno', data: vals, borderColor: '#6A1B9A', backgroundColor: '#6A1B9A18', fill: true, tension: .35, pointRadius: 4, borderWidth: 2 }] },
      options: LINE_CHART_OPTS
    }));
  } else {
    // State: total noturno line
    const vals = anos.map(a => d.serie_temporal[a]?.mat_noturno || 0);
    S.charts.push(new Chart(el, {
      type: 'line',
      data: { labels: anos, datasets: [{ label: 'Matrículas Noturnas', data: vals, borderColor: '#6A1B9A', backgroundColor: '#6A1B9A18', fill: true, tension: .35, pointRadius: 4, borderWidth: 2 }] },
      options: LINE_CHART_OPTS
    }));
  }
}

// ══════════════════════════════════════════════════════════
// EDUCACAO ESPECIAL
// ══════════════════════════════════════════════════════════

function buildEdEspecial(d, anos, anoSel) {
  // 1. Total ESP students evolution (single line)
  const evoEl = document.getElementById('chart-esp-evo');
  if (evoEl) {
    const vals = S.munSel
      ? anos.map(a => d.por_municipio[a]?.[S.munSel]?.esp_total || 0)
      : anos.map(a => d.serie_temporal[a]?.esp_total || 0);
    S.charts.push(new Chart(evoEl, {
      type: 'line',
      data: { labels: anos, datasets: [{ label: 'Alunos Ed. Especial', data: vals, borderColor: '#00897B', backgroundColor: '#00897B18', fill: true, tension: .35, pointRadius: 4, borderWidth: 2 }] },
      options: LINE_CHART_OPTS
    }));
  }

  // 2. CC vs CE doughnut (current year)
  const tipoEl = document.getElementById('chart-esp-tipo');
  if (tipoEl) {
    let cc, ce;
    if (S.munSel) {
      const m = d.por_municipio[anoSel]?.[S.munSel] || {};
      cc = m.esp_cc || 0;
      ce = m.esp_ce || 0;
    } else {
      const st = d.serie_temporal[anoSel] || {};
      cc = st.esp_classes_comuns || 0;
      ce = st.esp_classes_exclusivas || 0;
    }
    S.charts.push(new Chart(tipoEl, {
      type: 'doughnut',
      data: { labels: ['Classes Comuns', 'Classes Exclusivas'], datasets: [{ data: [cc, ce], backgroundColor: ['#00897BDD', '#EE302FDD'], borderColor: '#fff', borderWidth: 2.5 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '55%', plugins: { ...CHART_DEFAULTS.plugins, datalabels: DL_DONUT } }
    }));
  }

  // 3. CC by etapa (current year — now has per-municipality data)
  const etapaEl = document.getElementById('chart-esp-etapa');
  if (etapaEl) {
    let src;
    if (S.munSel) {
      src = d.por_municipio[anoSel]?.[S.munSel] || {};
    } else if (S.creSel) {
      src = aggregateCre(d, anoSel, S.creSel);
    } else {
      src = d.serie_temporal[anoSel] || {};
    }
    const etapas = ['Infantil', 'Fundamental', 'Médio', 'EJA'];
    const ccData = [src.esp_cc_inf || 0, src.esp_cc_fund || 0, src.esp_cc_med || 0, src.esp_cc_eja || 0];
    const etapaCores = [COLORS.infantil, COLORS.fundamental, COLORS.medio, COLORS.eja];
    // Only show if we have data
    if (ccData.some(v => v > 0)) {
      S.charts.push(new Chart(etapaEl, {
        type: 'bar',
        data: { labels: etapas, datasets: [{ label: 'Classes Comuns', data: ccData, backgroundColor: etapaCores.map(c => c + 'CC'), borderColor: etapaCores, borderWidth: 1.5, borderRadius: 4 }] },
        options: { ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_BAR },
          scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, suggestedMax: Math.max(...ccData) * 1.15 } } }
      }));
    }
  }
}

// ══════════════════════════════════════════════════════════
// INTEGRAL DELTA
// ══════════════════════════════════════════════════════════

function buildIntegralDelta(d) {
  const el = document.getElementById('integral-delta');
  if (!el) return;

  const getIntTotal = (ano) => {
    if (S.munSel) {
      const m = d.por_municipio[ano]?.[S.munSel] || {};
      return (m.int_fund_total || 0) + (m.int_medio || 0);
    }
    if (S.creSel) {
      const agg = aggregateCre(d, ano, S.creSel);
      return (agg.int_fund_total || 0) + (agg.int_medio || 0);
    }
    const i = d.integral?.[ano];
    if (!i) return null;
    return (i.fund_total || 0) + (i.medio || 0);
  };

  const total24 = getIntTotal('2024');
  const total25 = getIntTotal('2025');
  if (total24 == null || total25 == null) { el.textContent = ''; return; }

  const delta = total25 - total24;
  const pct = total24 > 0 ? ((delta / total24) * 100).toFixed(1) : 0;
  const arrow = delta > 0 ? '↑' : '↓';
  const sign = delta > 0 ? '+' : '';

  el.innerHTML = `${arrow} ${sign}${formatNum(delta)} vagas integrais (${sign}${pct}%) de 2024 para 2025`;
  el.style.color = delta > 0 ? COLORS.pri : COLORS.red;
}

// ══════════════════════════════════════════════════════════
// LOCALIZAÇÃO DIFERENCIADA
// ══════════════════════════════════════════════════════════

function buildLocDif() {
  const ftl = S.ftl;
  const d = S.data;
  const tipoLabels = ['Terra Indígena', 'Quilombola', 'Assentamento'];
  const tipoCores = [COLORS.pri, COLORS.red, COLORS.yellow];

  // Trend chart: always state-level (from ftl)
  if (ftl?.localizacao_diferenciada) {
    const ld = ftl.localizacao_diferenciada;
    const anos = Object.keys(ld).sort();
    const tipos = ['Terra Indigena', 'Quilombola', 'Area de Assentamento'];
    const canvasTrend = document.getElementById('chart-locdif-trend');
    if (canvasTrend) {
      S.charts.push(new Chart(canvasTrend, {
        type: 'line',
        data: {
          labels: anos,
          datasets: tipos.map((t, i) => ({
            label: tipoLabels[i],
            data: anos.map(a => ld[a]?.[t]?.escolas || 0),
            borderColor: tipoCores[i],
            backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 4, borderWidth: 2,
          }))
        },
        options: { ...CHART_DEFAULTS, scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: true } } }
      }));
    }
  }

  // Bar chart: uses per-municipality data when filtered
  const canvasBar = document.getElementById('chart-locdif-bar');
  if (canvasBar && d) {
    const pmAnos = Object.keys(d.por_municipio || {}).sort();
    const pmUltimo = pmAnos[pmAnos.length - 1];
    let src, labelAno;
    if (S.munSel) {
      src = d.por_municipio[pmUltimo]?.[S.munSel] || {};
      labelAno = pmUltimo;
    } else if (S.creSel) {
      src = aggregateCre(d, pmUltimo, S.creSel);
      labelAno = pmUltimo;
    } else if (ftl?.localizacao_diferenciada) {
      // Fallback to ftl format — use ftl's own latest year (may differ from por_municipio)
      const ld = ftl.localizacao_diferenciada;
      const ftlAnos = Object.keys(ld).sort();
      const ftlUltimo = ftlAnos[ftlAnos.length - 1];
      const ldAno = ld[ftlUltimo] || {};
      src = {
        locdif_terra_indigena_mat: ldAno['Terra Indigena']?.matriculas || 0,
        locdif_quilombola_mat: ldAno['Quilombola']?.matriculas || 0,
        locdif_assentamento_mat: ldAno['Area de Assentamento']?.matriculas || 0,
      };
      labelAno = ftlUltimo;
    }
    if (src) {
      const barData = [
        src.locdif_terra_indigena_mat || 0,
        src.locdif_quilombola_mat || 0,
        src.locdif_assentamento_mat || 0,
      ];
      S.charts.push(new Chart(canvasBar, {
        type: 'bar',
        data: {
          labels: tipoLabels,
          datasets: [{
            label: `Matrículas ${labelAno}`,
            data: barData,
            backgroundColor: tipoCores.map(c => c + 'CC'),
            borderColor: tipoCores, borderWidth: 1.5, borderRadius: 4,
          }]
        },
        options: { ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_BAR },
          scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: true, suggestedMax: Math.max(...barData) * 1.2 || 10 } } }
      }));
    }
  }
}

function buildCreLayer(anoSel, metric) {
  if (!S.creGeo || !S.map) return;
  if (S.mapLayer) { S.mapLayer.remove(); S.mapLayer = null; }
  // Remove old legend and rebuild for CRE scale
  if (S.mapLegend) { S.mapLegend.remove(); S.mapLegend = null; }

  const munToCre = S.creLookup?.mun_to_cre || {};
  const d = S.data;

  // Aggregate municipality data by CRE
  const creData = {};
  const munData = d.por_municipio?.[anoSel] || {};
  for (const [cod, val] of Object.entries(munData)) {
    const cre = munToCre[cod]?.cod_cre;
    if (!cre) continue;
    if (!creData[cre]) creData[cre] = { total: 0, count: 0, nome: munToCre[cod]?.nome_cre || cre };
    creData[cre].total += (val[metric] || 0);
    creData[cre].count += 1;
  }

  const values = Object.values(creData).map(v => v.total).filter(v => v > 0);
  const maxVal = values.length ? Math.max(...values) : 1;
  const CRE_SCALE = ['#C7E9C0', '#74C476', '#41AB5D', '#238B45', '#005A32'];
  const breaks = [0, 0.2, 0.4, 0.6, 0.8].map(t => Math.round(t * maxVal));

  function getColor(v) {
    const t = v / maxVal;
    if (t > 0.8) return CRE_SCALE[4];
    if (t > 0.6) return CRE_SCALE[3];
    if (t > 0.4) return CRE_SCALE[2];
    if (t > 0.2) return CRE_SCALE[1];
    return CRE_SCALE[0];
  }

  S.mapLayer = L.geoJSON(S.creGeo, {
    style: feature => {
      const cod = feature.properties.cod_cre;
      const val = creData[cod]?.total || 0;
      return { fillColor: getColor(val), weight: 2, color: '#fff', fillOpacity: .75 };
    },
    onEachFeature: (feature, layer) => {
      const cod = feature.properties.cod_cre;
      const nome = feature.properties.nome_cre || cod;
      const val = creData[cod]?.total || 0;
      const munCount = creData[cod]?.count || 0;
      layer.bindTooltip(`<strong>${nome}</strong><br>${metric === 'escolas' ? 'Escolas' : 'Matrículas'}: ${val.toLocaleString('pt-BR')}<br>${munCount} municípios`, { sticky: true });
      layer.on('click', () => {
        S.creSel = cod;
        const selCre = document.getElementById('sel-cre');
        if (selCre) selCre.value = cod;
        populateMunDropdown(cod);
        refreshActiveTab();
      });
    }
  }).addTo(S.map);

  // Build CRE legend with correct scale
  const METRIC_LABELS = { mat_total: 'Matrículas', escolas: 'Escolas', mat_fundamental: 'Fundamental', mat_medio: 'Médio', mat_infantil: 'Infantil', mat_eja: 'EJA' };
  const creLegend = L.control({ position: 'bottomleft' });
  creLegend.onAdd = function () {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = `<h4>${METRIC_LABELS[metric] || metric} (CREs)</h4>`;
    for (let i = CRE_SCALE.length - 1; i >= 0; i--) {
      const lo = formatNum(breaks[i]);
      const hi = i < CRE_SCALE.length - 1 ? formatNum(breaks[i + 1] - 1) : '+';
      div.innerHTML += `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${CRE_SCALE[i]}"></div><span>${lo}${hi !== '+' ? ' – ' + hi : '+'}</span></div>`;
    }
    return div;
  };
  creLegend.addTo(S.map);
  S.mapLegend = creLegend;
}

function bindMapMetric(d, anos) {
  const selMetric = document.getElementById('sel-map-metric');
  if (selMetric) {
    selMetric.addEventListener('change', () => {
      const anoSel = S.anoSel || anos[anos.length - 1];
      if (S.mapMode === 'cre') buildCreLayer(anoSel, selMetric.value);
      else buildMap(d, anoSel, selMetric.value);
    });
  }

  // Layer toggle
  const btnMun = document.getElementById('btn-layer-mun');
  const btnCre = document.getElementById('btn-layer-cre');
  if (btnMun && btnCre) {
    btnMun.addEventListener('click', () => {
      S.mapMode = 'mun';
      btnMun.classList.add('active'); btnCre.classList.remove('active');
      buildMap(d, S.anoSel || anos[anos.length - 1], selMetric?.value || 'mat_total');
    });
    btnCre.addEventListener('click', () => {
      S.mapMode = 'cre';
      btnCre.classList.add('active'); btnMun.classList.remove('active');
      buildCreLayer(S.anoSel || anos[anos.length - 1], selMetric?.value || 'mat_total');
    });
  }
}


function bindSidebarFilters() {
  const selAno = document.getElementById('sel-ano');
  if (selAno) {
    selAno.addEventListener('change', e => {
      S.anoSel = e.target.value;
      const activeTab = document.querySelector('.sidebar-tab.active');
      if (activeTab) activeTab.click();
    });
  }
}

/** Populate topbar CRE dropdown */
function populateCreDropdown() {
  const selCre = document.getElementById('sel-cre');
  if (!selCre || !S.creLookup) return;
  const list = S.creLookup.cre_list || [];
  selCre.innerHTML = '<option value="">Todas as CREs</option>' +
    list.map(c => `<option value="${c.cod_cre}">${c.nome_cre}</option>`).join('');
}

/** Populate municipality dropdown, optionally filtered by CRE */
function populateMunDropdown(creCod) {
  const selMun = document.getElementById('sel-mun');
  if (!selMun || !S.data) return;
  const lookup = S.data.lookup_municipios || {};
  const munToCre = S.creLookup?.mun_to_cre || {};

  let entries = Object.entries(lookup).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  if (creCod) {
    entries = entries.filter(([cod]) => munToCre[cod]?.cod_cre === creCod);
  }

  // Keep hidden select in sync (for state)
  selMun.innerHTML = '<option value="">Todos os municípios</option>' +
    entries.map(([cod, nome]) => `<option value="${cod}">${nome}</option>`).join('');

  // Store list for searchable dropdown
  S.munEntries = entries;

  // Update search input display
  const input = document.getElementById('mun-search-input');
  if (input) {
    if (S.munSel) {
      input.value = lookup[S.munSel] || '';
    } else {
      input.value = '';
    }
  }
}

function renderMunDropdownList(filter = '') {
  const list = document.getElementById('mun-dropdown-list');
  if (!list) return;
  const entries = S.munEntries || [];
  const q = filter.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  let filtered = entries;
  if (q) {
    filtered = entries.filter(([, nome]) =>
      nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(q)
    );
  }

  list.innerHTML =
    '<div class="mun-dd-item" data-value="">Todos os municípios</div>' +
    filtered.map(([cod, nome]) =>
      `<div class="mun-dd-item${S.munSel === cod ? ' active' : ''}" data-value="${cod}">${nome}</div>`
    ).join('');
}

/** Bind topbar filter interactions */
function bindTopbarFilters() {
  const selAno = document.getElementById('sel-ano');
  const selCre = document.getElementById('sel-cre');
  const selMun = document.getElementById('sel-mun');
  const munInput = document.getElementById('mun-search-input');
  const munList = document.getElementById('mun-dropdown-list');

  if (selAno) selAno.addEventListener('change', e => {
    S.anoSel = e.target.value;
    S.munSel = null;
    if (selMun) selMun.value = '';
    if (munInput) munInput.value = '';
    refreshActiveTab();
  });

  if (selCre) selCre.addEventListener('change', e => {
    S.creSel = e.target.value || null;
    S.munSel = null;
    if (selMun) selMun.value = '';
    if (munInput) munInput.value = '';
    populateMunDropdown(S.creSel);
    refreshActiveTab();
  });

  // Searchable municipality dropdown
  if (munInput && munList) {
    munInput.addEventListener('focus', () => {
      renderMunDropdownList(munInput.value);
      munList.style.display = 'block';
    });

    munInput.addEventListener('input', () => {
      renderMunDropdownList(munInput.value);
      munList.style.display = 'block';
    });

    munList.addEventListener('click', e => {
      const item = e.target.closest('.mun-dd-item');
      if (!item) return;
      const val = item.dataset.value;
      S.munSel = val || null;
      if (selMun) selMun.value = val;
      munInput.value = val ? item.textContent : '';
      munList.style.display = 'none';
      refreshActiveTab();
      updateActiveFilters();
    updateFilterAwareness();
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', e => {
      if (!e.target.closest('#mun-search-wrapper')) {
        munList.style.display = 'none';
      }
    });
  }

  // Hamburger menu
  const hamburger = document.getElementById('hamburger');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (hamburger && sidebar && overlay) {
    hamburger.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('visible');
    });
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('visible');
    });
    // Close sidebar when a nav tab is clicked on mobile
    document.querySelectorAll('.sidebar-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('visible');
      });
    });
  }
}

function refreshActiveTab() {
  const activeTab = document.querySelector('.sidebar-tab.active');
  if (activeTab) activeTab.click();
}

// ══════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════

async function init() {
  initNav();

  try {
    const [respData, respGeo, respInfra, respDoc, respFtl, respSaeb, respFluxo, respCreGeo, respCreLookup, respInse, respIcg, respAfd, respIdeb] = await Promise.all([
      fetch('dados/4_1_acesso_estadual.json'),
      fetch('dados/rs_municipios.geojson'),
      fetch('dados/4_5_infra_estadual.json'),
      fetch('dados/4_5_docentes.json'),
      fetch('dados/4_1_funil_turma_locdif.json'),
      fetch('dados/4_6_saeb.json'),
      fetch('dados/4_3_fluxo_rendimento.json'),
      fetch('dados/rs_cres.geojson'),
      fetch('dados/rs_cre_lookup.json'),
      fetch('dados/4_7_inse.json'),
      fetch('dados/4_8_icg.json'),
      fetch('dados/4_9_afd.json'),
      fetch('dados/4_7_ideb.json'),
    ]);
    if (!respData.ok) throw new Error(`HTTP ${respData.status}`);
    S.data = await respData.json();
    if (respGeo.ok)       S.geo       = await respGeo.json();
    if (respInfra.ok)     S.infra     = await respInfra.json();
    if (respDoc.ok)       S.doc       = await respDoc.json();
    if (respFtl.ok)       S.ftl       = await respFtl.json();
    if (respSaeb.ok)      S.saeb      = await respSaeb.json();
    if (respFluxo.ok)     S.fluxo     = await respFluxo.json();
    if (respCreGeo.ok)    S.creGeo    = await respCreGeo.json();
    if (respCreLookup.ok) S.creLookup = await respCreLookup.json();
    if (respInse.ok)      S.inse      = await respInse.json();
    if (respIcg.ok)       S.icg       = await respIcg.json();
    if (respAfd.ok)       S.afd       = await respAfd.json();
    if (respIdeb.ok)      S.ideb      = await respIdeb.json();

    // Seed rede cache with initial estadual data
    S.redeCache.estadual = { acesso: S.data, infra: S.infra, fluxo: S.fluxo, saeb: S.saeb, inse: S.inse, icg: S.icg, afd: S.afd, ideb: S.ideb };

    // Populate topbar year select
    const anos = Object.keys(S.data.serie_temporal).sort();
    const selAno = document.getElementById('sel-ano');
    if (selAno) {
      selAno.innerHTML = anos.map(a => `<option value="${a}" ${a === anos[anos.length - 1] ? 'selected' : ''}>${a}</option>`).join('');
      S.anoSel = anos[anos.length - 1];
    }

    // Populate CRE + municipality dropdowns
    populateCreDropdown();
    populateMunDropdown(null);

    bindSidebarFilters();
    bindTopbarFilters();
  bindRedeToggle();
    renderHome();
  } catch (err) {
    document.getElementById('main-content').innerHTML = `
      <div class="loading" style="color:#C62828">
        <span>Erro ao carregar dados: ${err.message}</span>
      </div>
    `;
  }
}

document.addEventListener('DOMContentLoaded', init);
