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
  tdi: null,       // 4_10_tdi.json — Distorção Idade-Série
  saersData: null,   // 4_saers.json — Avaliação SAERS
  escolasData: null, // escolas_estaduais.json — Visão por Escola
  escolasMap: null,  // Leaflet map instance for escolas
  escolasMarkers: null, // Leaflet layer group for markers
  geo: null,
  creGeo: null,      // CRE polygons GeoJSON
  creLookup: null,   // { mun_to_cre, cre_list }
  map: null,
  mapLayer: null,
  mapLegend: null,  // Leaflet legend control
  mapMode: 'mun',   // 'mun' | 'cre' | 'esc'
  charts: [],
  anoSel: null,
  depSel: 'Estadual',
  munSel: null,

  creSel: null,      // selected CRE code e.g. '06'
  etapaSel: null,     // selected etapa filter: 'mat_infantil', 'mat_fund_ai', 'mat_fund_af', 'mat_medio', 'mat_eja', 'mat_prof_tec', or null (all)
  profSel: null,       // selected profissional sub-filter for evolution chart: 'integrado', 'subsequente', 'concomitante', 'eja_tec', or null (all)

  // Multi-rede support
  redeSel: 'estadual',   // current network: estadual, municipal, federal, filantropica, privada, todas
  redeCache: {},         // { estadual: { acesso: data, infra: data }, ... }
};

const FONTE_CENSO = 'Fonte: INEP — <a href="https://www.gov.br/inep/pt-br/areas-de-atuacao/pesquisas-estatisticas-e-indicadores/censo-escolar" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline dotted;text-underline-offset:2px" title="Acessar Censo Escolar no portal INEP">Censo Escolar da Educação Básica</a> · <a href="https://www.gov.br/inep/pt-br/centrais-de-conteudo/acervo-linha-editorial/publicacoes-institucionais/estatisticas-e-indicadores-educacionais/caderno-de-conceitos-e-orientacoes-do-censo-escolar-2025-1a-etapa-da-coleta" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline dotted;text-underline-offset:2px" title="Acessar o Caderno de Conceitos e Orientações 2025">📘 Caderno do Censo 2025</a>';

// Paleta Bandeira RS: Verde #00AB4E, Vermelho #EE302F, Amarelo #FFCB04
const COLORS = {
  pri: '#2E86C1', priDark: '#0D3B66', priLight: '#5DADE2', sec: '#2874A6',
  red: '#EE302F', redLight: '#F4706F',
  yellow: '#FFCB04', yellowLight: '#FFE066',
  accent: '#FFCB04', accentLight: '#FFE066',
  federal: '#1565C0', estadual: '#2E86C1', municipal: '#EE302F', privada: '#6A1B9A',
  masc: '#1976D2', fem: '#EE302F',
  branca: '#78909C', preta: '#37474F', parda: '#8D6E63', amarela: '#FFCB04', indigena: '#2E86C1', nd: '#B0BEC5',
  infantil: '#FFCB04', fundAI: '#0097A7', fundAF: '#F57C00', fundamental: '#2E86C1', medio: '#EE302F', eja: '#1565C0', especial: '#6A1B9A', blue: '#1565C0',
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

// Etapa labels for filter badges
const ETAPA_MAP = {
  mat_infantil: 'Infantil',
  mat_fund_ai: 'Anos Iniciais',
  mat_fund_af: 'Anos Finais',
  mat_medio: 'Médio',
  mat_eja: 'EJA',
  mat_prof_tec: 'Técnico',
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
  if (S.map) {
    // Close all open tooltips before removing map (prevents "stuck" tooltip bug)
    S.map.eachLayer(l => { if (l.closeTooltip) l.closeTooltip(); if (l.closePopup) l.closePopup(); });
    S.map.remove(); S.map = null; S.mapLayer = null;
  }
  if (S.creOverlay) { S.creOverlay = null; }
  if (S.escolasMap) {
    S.escolasMap.remove(); S.escolasMap = null; S.escolasMarkers = null;
  }
}

/**
 * Add CRE boundary overlay on top of any active Leaflet map.
 * This draws semi-transparent CRE boundaries with labels.
 * Call AFTER the base choropleth layer is added.
 */
function addCreOverlay(map, opts) {
  if (!S.creGeo || !map) return null;
  // Remove previous overlay if exists
  if (S.creOverlay) { try { map.removeLayer(S.creOverlay); } catch(e) {} }
  
  const overlay = L.geoJSON(S.creGeo, {
    style: () => ({
      fillColor: 'transparent',
      fillOpacity: 0,
      weight: 2.5,
      color: 'rgba(0,0,0,0.45)',
      dashArray: '6,4',
    }),
    onEachFeature: (feature, layer) => {
      const nome = feature.properties.nome_cre || feature.properties.cod_cre || '';
      if (!opts?.noLabels) {
        layer.bindTooltip(nome, {
          permanent: true,
          direction: 'center',
          className: 'cre-overlay-label',
        });
      }
    }
  }).addTo(map);
  
  S.creOverlay = overlay;
  return overlay;
}

/** Export a data-table to CSV */
function exportTableCSV(btn) {
  const wrapper = btn.closest('.table-wrapper') || btn.closest('.map-table-row') || btn.closest('.chart-card');
  if (!wrapper) return;
  const table = wrapper.querySelector('table.data-table') || wrapper.querySelector('table');
  if (!table) return;

  const title = wrapper.querySelector('.table-header h3')?.textContent || wrapper.querySelector('.chart-title')?.textContent || 'tabela';

  // Extract headers
  const headers = [];
  table.querySelectorAll('thead th').forEach(th => headers.push(th.textContent.trim()));

  // Extract visible rows
  const rows = [];
  table.querySelectorAll('tbody tr').forEach(tr => {
    if (tr.style.display === 'none') return;
    const cells = [];
    tr.querySelectorAll('td').forEach(td => cells.push(td.textContent.trim()));
    rows.push(cells);
  });

  const csv = '\uFEFF' + [headers, ...rows].map(r => r.map(c => c.replace(/;/g, ',')).join(';')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = title.replace(/[^a-zA-ZÀ-ú0-9 ]/g, '').trim().replace(/\s+/g, '_') + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/** Add export CSV buttons to all chart-cards and data-tables */
function injectExportButtons() {
  // Charts
  document.querySelectorAll('.chart-card canvas').forEach(canvas => {
    const card = canvas.closest('.chart-card');
    if (!card || card.querySelector('.export-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'export-btn';
    btn.title = 'Baixar dados (CSV/Excel)';
    btn.innerHTML = '<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z\"/><polyline points=\"14 2 14 8 20 8\"/><line x1=\"16\" y1=\"13\" x2=\"8\" y2=\"13\"/><line x1=\"16\" y1=\"17\" x2=\"8\" y2=\"17\"/></svg>';
    btn.addEventListener('click', function(e) { e.stopPropagation(); exportChartCSV(this); });
    card.style.position = 'relative';
    card.appendChild(btn);
  });

  // Tables
  document.querySelectorAll('.data-table').forEach(table => {
    const wrapper = table.closest('.table-wrapper') || table.closest('.chart-card');
    if (!wrapper || wrapper.querySelector('.export-table-btn')) return;
    const header = wrapper.querySelector('.table-header');
    if (!header) return;
    const btn = document.createElement('button');
    btn.className = 'export-table-btn';
    btn.title = 'Baixar tabela (CSV)';
    btn.innerHTML = '📥 CSV';
    btn.style.cssText = 'font-size:10px;padding:3px 8px;border-radius:4px;border:1px solid #ccc;background:#fff;cursor:pointer;font-family:Inter;font-weight:600;color:#555;margin-left:auto;transition:all .2s';
    btn.addEventListener('mouseenter', () => { btn.style.background = '#f0f0f0'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = '#fff'; });
    btn.addEventListener('click', function(e) { e.stopPropagation(); exportTableCSV(this); });
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.gap = '8px';
    header.appendChild(btn);
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

/** Returns the rede toggle strip HTML (call after sectionBanner)
 *  @param {string[]} [disabledRedes] - rede keys to disable with tooltip
 *  @param {string} [disabledMsg] - tooltip message for disabled buttons
 */
function redeToggleHTML(disabledRedes, disabledMsg) {
  if (!sectionBanner._lastShowToggle) return '';
  const disabled = new Set(disabledRedes || []);
  return `<div class="rede-toggle-strip" id="rede-toggle">
    ${Object.entries(REDE_LABELS).map(([k, label]) => {
      const isDisabled = disabled.has(k);
      const cls = k === S.redeSel ? ' active' : (isDisabled ? ' disabled' : '');
      const title = isDisabled ? ` title="${disabledMsg || 'Indisponível'}"` : '';
      return `<button class="rede-toggle-btn${cls}" data-rede="${k}"${title}${isDisabled ? ' disabled' : ''}>${label.replace('Rede ','')}</button>`;
    }).join('')}
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
  const keys = ['acesso', 'infra', 'fluxo', 'saeb', 'inse', 'icg', 'afd', 'ideb', 'tdi'];
  const urls = [
    `dados/4_1_acesso_${rede}.json`,
    `dados/4_5_infra_${rede}.json`,
    `dados/4_3_fluxo_${rede}.json`,
    `dados/4_6_saeb_${rede}.json`,
    `dados/4_7_inse_${rede}.json`,
    `dados/4_8_icg_${rede}.json`,
    `dados/4_9_afd_${rede}.json`,
    `dados/4_7_ideb_${rede}.json`,
    `dados/4_10_tdi_${rede}.json`,
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
    // Always assign — null clears old rede data so guards display "not available"
    S.infra = cached.infra;
    S.fluxo = cached.fluxo;
    S.saeb  = cached.saeb;
    S.inse  = cached.inse;
    S.icg   = cached.icg;
    S.afd   = cached.afd;
    S.ideb  = cached.ideb;
    S.tdi   = cached.tdi;
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
  'chart-integral-pct':['geo','year'],
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
  const slot = document.getElementById('mun-filter-slot');
  if (!slot) return;
  // Build badges from current state
  let html = '';
  // Rede badge (always shown, informational — no close button)
  const redeLabel = REDE_LABELS[S.redeSel] || 'Rede Estadual';
  html += `<span class="filter-chip filter-chip-rede" title="Rede selecionada">🏛 ${redeLabel}</span>`;
  if (S.anoSel) {
    html += `<span class="filter-chip filter-chip-ano" data-clear="ano" title="Clique para remover">📅 ${S.anoSel} <span class="close">✕</span></span>`;
  }
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
  if (S.profSel) {
    const PROF_NAMES = { integrado: 'Integrado', subsequente: 'Subsequente', concomitante: 'Concomitante', eja_tec: 'EJA Técnico' };
    html += `<span class="filter-chip" data-clear="prof" title="Clique para remover">🏭 ${PROF_NAMES[S.profSel] || S.profSel} <span class="close">✕</span></span>`;
  }
  slot.innerHTML = html;
  // Bind clear (skip rede chip which has no data-clear)
  slot.querySelectorAll('.filter-chip[data-clear]').forEach(chip => {
    chip.style.cursor = 'pointer';
    chip.addEventListener('click', () => {
      const type = chip.dataset.clear;
      if (type === 'ano') {
        // Reset to latest year available in current section data
        const selAno = document.getElementById('sel-ano');
        if (selAno && selAno.options.length) {
          const lastOpt = selAno.options[selAno.options.length - 1].value;
          S.anoSel = lastOpt;
          selAno.value = lastOpt;
        }
      }
      if (type === 'etapa') S.etapaSel = null;
      if (type === 'prof') S.profSel = null;
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
        <div class="chart-title" id="title-serie">Evolução de ${S.etapaSel ? ({'mat_infantil':'Infantil','mat_fund_ai':'Anos Iniciais','mat_fund_af':'Anos Finais','mat_medio':'Médio','mat_eja':'EJA','mat_prof_tec':'Técnico'}[S.etapaSel]) : 'Matrículas'} — ${redeLabel} (${anos[0]}–${anoSel})</div>
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

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title" id="title-integral-pct">Educação Integral — Proporção do Total de Matrículas (%)</div>
        <div id="integral-pct-filters" style="display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 6px 0;font-size:10px"></div>
        <div style="height:220px"><canvas id="chart-integral-pct"></canvas></div>
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

    <!-- ═══ EIXO: Matrículas por Série ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/fundamental.png" alt=""></span>
      <span class="section-divider-text">Matrículas por Série — ${anoSel}</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title">Ensino Fundamental — Por Ano/Série</div>
        <div style="height:250px"><canvas id="chart-serie-fund"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Ensino Médio — Por Série</div>
        <div style="height:250px"><canvas id="chart-serie-med"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
    </div>

    <!-- ═══ EIXO: Educação Profissional e Técnica ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/medio.png" alt=""></span>
      <span class="section-divider-text">Educação Profissional e Técnica</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:2fr 1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title" id="title-prof-evo">Matrículas na Ed. Profissional — Evolução</div>
        <div style="height:250px"><canvas id="chart-prof-evo"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title" id="title-prof-comp">Composição da Oferta Técnica — ${anoSel}</div>
        <div style="font-size:9px;color:var(--pri);opacity:.7;margin:-2px 0 2px;font-weight:500">👆 Clique em uma barra para filtrar a evolução ao lado</div>
        <div style="height:250px"><canvas id="chart-prof-comp"></canvas></div>
        <div style="background:rgba(255,203,4,.08);border:1px solid rgba(255,203,4,.18);border-radius:5px;padding:6px 10px;margin-top:6px">
          <p style="font-size:9px;margin:0;color:#5D4037;line-height:1.55">
            <strong>⚠ Nota:</strong> A soma destas barras não corresponde ao total de <em>Ed. Profissional</em>
            do gráfico ao lado. O INEP contabiliza o <strong>Integrado ao EM</strong> como matrícula do
            <em>Ensino Médio</em> (QT_MAT_MED_IFTP_CT), e não como matrícula profissional (QT_MAT_PROF).
            Este gráfico reúne todas as modalidades técnicas para dar uma visão completa da oferta.
          </p>
        </div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
    </div>

    <!-- ═══ EIXO: Matrículas por Turno ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/eja.png" alt=""></span>
      <span class="section-divider-text">Matrículas por Turno — ${anoSel}</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title">Diurno vs Noturno — Por Etapa</div>
        <div style="height:280px"><canvas id="chart-turno-etapa"></canvas></div>
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
            ${S.redeSel === 'estadual' ? '<button class="map-layer-btn" id="btn-layer-esc">Escolas</button>' : ''}
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
        ${(S.munSel || S.creSel) ? `<div id="map-filter-warning" style="background:rgba(255,179,0,.12);border:1px solid rgba(255,179,0,.3);border-radius:5px;padding:6px 12px;margin:0 0 4px;display:flex;align-items:center;gap:6px;font-size:10px;color:#8B6914;font-weight:500">
          <span style="font-size:13px">⚠️</span>
          <span>Filtro geográfico ativo. <strong>Remova os filtros de CRE/Município no cabeçalho</strong> para interagir com os controles do mapa.</span>
        </div>` : ''}
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
              <th>Mat.</th><th>Fund.</th><th>Méd.</th><th>EJA</th><th>Téc.</th>
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
  buildIntegralPct(d);
  buildLocDif();
  buildPorSerie(d, anoSel);
  buildProfissional(d, anos, anoSel);
  buildTurnoEtapa(d, anoSel);
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
    ...(S.redeSel !== 'estadual' ? [{ label: 'Ed. Infantil', key: 'mat_infantil', icon: 'img/icons/infantil.png', accent: 'green' }] : []),
    { label: 'Fundamental', key: 'mat_fundamental', icon: 'img/icons/fundamental.png', accent: 'green' },
    { label: 'Ens. Médio', key: 'mat_medio', icon: 'img/icons/medio.png', accent: 'green' },
    { label: 'EJA', key: 'mat_eja', icon: 'img/icons/eja.png', accent: 'green' },
    { label: 'Técnico', key: 'mat_prof_tec', icon: 'img/icons/medio.png', accent: 'blue' },
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

  const accentColors = { green: '#2E86C1', yellow: '#FFCB04', red: '#EE302F', blue: '#1565C0' };

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
  const ETAPA_LABELS = { mat_infantil: 'Infantil', mat_fund_ai: 'Anos Iniciais', mat_fund_af: 'Anos Finais', mat_medio: 'Médio', mat_eja: 'EJA', mat_prof_tec: 'Técnico' };
  const serieLabel = S.etapaSel ? ETAPA_LABELS[S.etapaSel] : 'Matrículas';
  const serieColor = S.etapaSel ? (COLORS[{mat_infantil:'infantil', mat_fund_ai:'fundAI', mat_fund_af:'fundAF', mat_medio:'medio', mat_eja:'eja', mat_prof_tec:'blue'}[S.etapaSel]] || COLORS.pri) : COLORS.pri;
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
  const etapas = S.redeSel !== 'estadual'
    ? ['Infantil', 'Anos Iniciais', 'Anos Finais', 'Médio', 'EJA', 'Técnico']
    : ['Anos Iniciais', 'Anos Finais', 'Médio', 'EJA', 'Técnico'];
  const etapaKeys = S.redeSel !== 'estadual'
    ? ['mat_infantil', 'mat_fund_ai', 'mat_fund_af', 'mat_medio', 'mat_eja', 'mat_prof_tec']
    : ['mat_fund_ai', 'mat_fund_af', 'mat_medio', 'mat_eja', 'mat_prof_tec'];
  const etapaCores = S.redeSel !== 'estadual'
    ? [COLORS.infantil, COLORS.fundAI, COLORS.fundAF, COLORS.medio, COLORS.eja, COLORS.blue]
    : [COLORS.fundAI, COLORS.fundAF, COLORS.medio, COLORS.eja, COLORS.blue];
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
              color: '#333',
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

  // ── CRE MODE: Show CRE aggregated table ──
  if (S.mapMode === 'cre') {
    const titleEl = document.querySelector('#mun-table-wrapper .table-header h3');
    if (titleEl) titleEl.textContent = 'Tabela de CREs';

    // Aggregate data per CRE
    const creAgg = {};
    for (const [cod, val] of Object.entries(mun)) {
      const creInfo = munToCre[cod];
      if (!creInfo) continue;
      const cre = creInfo.cod_cre;
      if (!creAgg[cre]) creAgg[cre] = { cod: cre, nome: creInfo.nome_cre || `CRE ${cre}`, mat_total: 0, escolas: 0, mat_fundamental: 0, mat_medio: 0, mat_eja: 0, mat_prof_tec: 0, muns: 0 };
      creAgg[cre].mat_total += (val.mat_total || 0);
      creAgg[cre].escolas += (val.escolas || 0);
      creAgg[cre].mat_fundamental += (val.mat_fundamental || 0);
      creAgg[cre].mat_medio += (val.mat_medio || 0);
      creAgg[cre].mat_eja += (val.mat_eja || 0);
      creAgg[cre].mat_prof_tec += (val.mat_prof_tec || 0);
      creAgg[cre].muns += 1;
    }
    const rows = Object.values(creAgg).sort((a, b) => b.mat_total - a.mat_total);

    // Update table header
    const thead = document.querySelector('#mun-table thead tr');
    if (thead) thead.innerHTML = '<th>#</th><th>CRE</th><th>Mun.</th><th>Esc.</th><th>Mat.</th><th>Fund.</th><th>Méd.</th><th>EJA</th><th>Téc.</th>';

    const tbody = document.getElementById('mun-tbody');
    tbody.innerHTML = rows.map((r, i) => `
      <tr data-cre="${r.cod}" class="${S.creSel === r.cod ? 'selected' : ''}">
        <td>${i + 1}</td>
        <td><strong>${r.nome}</strong></td>
        <td>${formatNum(r.muns)}</td>
        <td>${formatNum(r.escolas)}</td>
        <td><strong>${formatNum(r.mat_total)}</strong></td>
        <td>${formatNum(r.mat_fundamental)}</td>
        <td>${formatNum(r.mat_medio)}</td>
        <td>${formatNum(r.mat_eja)}</td>
        <td>${formatNum(r.mat_prof_tec)}</td>
      </tr>
    `).join('');

    // Click to filter by CRE
    tbody.querySelectorAll('tr').forEach(tr => {
      tr.addEventListener('click', () => {
        const cod = tr.dataset.cre;
        if (S.creSel === cod) {
          S.creSel = null;
        } else {
          S.creSel = cod;
          S.munSel = null;
        }
        refreshActiveTab();
      });
    });

    // Search
    const searchEl = document.getElementById('mun-search');
    if (searchEl) {
      const newSearch = searchEl.cloneNode(true);
      searchEl.parentNode.replaceChild(newSearch, searchEl);
      newSearch.addEventListener('input', e => {
        const q = e.target.value.toLowerCase();
        tbody.querySelectorAll('tr').forEach(tr => {
          const nome = tr.children[1]?.textContent.toLowerCase() || '';
          tr.style.display = nome.includes(q) ? '' : 'none';
        });
      });
    }
    return;
  }

  // ── MUN MODE: Standard municipality table ──
  const titleEl = document.querySelector('#mun-table-wrapper .table-header h3');
  if (titleEl) titleEl.textContent = 'Tabela de Municípios';

  // Restore table header
  const thead = document.querySelector('#mun-table thead tr');
  if (thead) thead.innerHTML = '<th>#</th><th>Município</th><th>Esc.</th><th>Mat.</th><th>Fund.</th><th>Méd.</th><th>EJA</th><th>Téc.</th>';

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
      <td>${formatNum(r.mat_prof_tec || 0)}</td>
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
      // Highlight municipality on map
      if (S.munSel && S.mapMode !== 'esc') zoomToMunicipality(S.munSel);
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
      ...(S.redeSel !== 'estadual' ? [{ label: 'Ed. Infantil', key: 'mat_infantil', icon: 'img/icons/infantil.png', accent: 'green' }] : []),
      { label: 'Fundamental', key: 'mat_fundamental', icon: 'img/icons/fundamental.png', accent: 'green' },
      { label: 'Ens. Médio', key: 'mat_medio', icon: 'img/icons/medio.png', accent: 'green' },
      { label: 'EJA', key: 'mat_eja', icon: 'img/icons/eja.png', accent: 'green' },
      { label: 'Técnico', key: 'mat_prof_tec', icon: 'img/icons/medio.png', accent: 'blue' },
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
    const ETAPA_LABELS_MUN = { mat_infantil: 'Infantil', mat_fund_ai: 'Anos Iniciais', mat_fund_af: 'Anos Finais', mat_medio: 'Médio', mat_eja: 'EJA', mat_prof_tec: 'Técnico' };
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
      const etapas = ['Anos Iniciais', 'Anos Finais', 'Médio', 'EJA'];
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
    buildPorSerie(d, anoSel);
    buildProfissional(d, anos, anoSel);
    buildTurnoEtapa(d, anoSel);

    // ── Zoom map to municipality ──
    if (S.mapMode === 'esc') {
      buildEscolaLayer(d, anoSel);
    } else {
      zoomToMunicipality(S.munSel);
    }

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
    const ETAPA_LABELS_CRE = { mat_infantil: 'Infantil', mat_fund_ai: 'Anos Iniciais', mat_fund_af: 'Anos Finais', mat_medio: 'Médio', mat_eja: 'EJA', mat_prof_tec: 'Técnico' };
    const serieKeyCre = S.etapaSel || 'mat_total';
    const serieLabelCre = S.etapaSel ? ETAPA_LABELS_CRE[S.etapaSel] : 'Matrículas';
    const serieColorCre = S.etapaSel ? (COLORS[{mat_infantil:'infantil', mat_fund_ai:'fundAI', mat_fund_af:'fundAF', mat_medio:'medio', mat_eja:'eja', mat_prof_tec:'blue'}[S.etapaSel]] || COLORS.pri) : COLORS.pri;
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
      const etapas = ['Anos Iniciais', 'Anos Finais', 'Médio', 'EJA'];
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
    buildPorSerie(d, anoSel);
    buildProfissional(d, anos, anoSel);
    buildTurnoEtapa(d, anoSel);

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
    buildPorSerie(d, anoSel);
    buildProfissional(d, anos, anoSel);
    buildTurnoEtapa(d, anoSel);
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
              color: '#333',
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
  // Integral % proporcional (municipality/CRE-aware)
  buildIntegralPct(d);
  // LocDif bar (state-level only)
  buildLocDif();
  buildPorSerie(d, anoSel);
  buildProfissional(d, Object.keys(d.serie_temporal || {}).sort(), anoSel);
  buildTurnoEtapa(d, anoSel);
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
  '#f0f4f8', '#c5d5e4', '#8fb3d1', '#5a91bd',
  '#3576a9', '#1A5276', '#0D3B66', '#0A2744'
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
  'Espacos Pedagogicos': '#2874A6',
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
  if (!infra || !infra.serie_temporal) {
    main.innerHTML = `
      <div class="section-sticky">
        ${sectionBanner('img/icons/nav_infra.png', 'Infraestrutura', getRedeLabel() + ' do RS')}
        ${redeToggleHTML()}
      </div>
      <div style="text-align:center;padding:60px 20px;color:var(--text-sec);">
        <p style="font-size:1.1rem;font-weight:600;">Dados de Infraestrutura não disponíveis para a Rede ${getRedeLabel()}</p>
      </div>`;
    bindRedeToggle();
    return;
  }

  const anos = Object.keys(infra.serie_temporal).sort();
  const ultimo = anos[anos.length - 1];
  const labels = infra.labels;
  const cats = infra.categorias;
  // Enrich Climatizacao with PCT_SALAS_CLIMATIZADAS if available
  if (!labels['PCT_SALAS_CLIMATIZADAS']) labels['PCT_SALAS_CLIMATIZADAS'] = '% Salas Climatizadas';
  if (cats['Climatizacao'] && !cats['Climatizacao'].includes('PCT_SALAS_CLIMATIZADAS')) {
    cats['Climatizacao'].push('PCT_SALAS_CLIMATIZADAS');
  }
  // Use selected year or last available
  const anoAtual = S.anoSel && infra.serie_temporal[S.anoSel] ? S.anoSel : ultimo;
  const su = infra.serie_temporal[anoAtual];

  main.innerHTML = `
    <div class="section-sticky">
    ${sectionBanner('img/icons/nav_infra.png', 'Infraestrutura', getRedeLabel() + ' do RS')}
    ${redeToggleHTML()}

    <!-- KPIs Premium -->
    <div class="kpi-strip" id="infra-kpis"></div>
    </div>

    <!-- ═══ EIXO: Infraestrutura — Comparativo ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/sec_infra.png" alt=""></span>
      <span class="section-divider-text">Infraestrutura Escolar — Comparativo Anual</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="infra-cat-tabs" id="infra-cat-tabs">
      <button class="infra-cat-tab active" data-cat="Tecnologia">Tecnologia</button>
      <button class="infra-cat-tab" data-cat="Espacos Pedagogicos">Espaços Pedagógicos</button>
      <button class="infra-cat-tab" data-cat="Estrutura Administrativa">Estrutura Administrativa</button>
      <button class="infra-cat-tab" data-cat="Acessibilidade">Acessibilidade</button>
      <button class="infra-cat-tab" data-cat="Saneamento e Energia,Alimentacao">Saneamento & Alimentação</button>
      <button class="infra-cat-tab" data-cat="Sustentabilidade">Sustentabilidade</button>
      <button class="infra-cat-tab" data-cat="Climatizacao,Espacos Adicionais">Climatização & Outros</button>
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
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(0,90,50,.04);border-bottom:1px solid rgba(0,90,50,.08);flex-wrap:wrap;gap:6px">
          <span style="font-weight:600;font-size:12px;color:#333">Mapa — ${anoAtual}</span>
          <div class="map-layer-toggle">
            <button class="map-layer-btn active" id="btn-infra-layer-mun">Municípios</button>
            <button class="map-layer-btn" id="btn-infra-layer-cre">CREs</button>
            <button class="map-layer-btn" id="btn-infra-layer-esc">Escolas</button>
          </div>
          <select id="infra-map-metric" style="font-size:11px;padding:3px 8px;border-radius:4px;border:1px solid #ccc">
            <option value="IN_INTERNET">Internet</option>
            <option value="IN_BIBLIOTECA">Biblioteca</option>
            <option value="IN_QUADRA_ESPORTES">Quadra</option>
            <option value="IN_LABORATORIO_INFORMATICA">Lab. Informática</option>
            <option value="IN_ACESSIBILIDADE_RAMPAS">Rampas</option>
            <option value="IN_CLIMATIZACAO">Ar Condicionado</option>
          </select>
        </div>
        <div id="infra-map" style="height:480px;width:100%"></div>
      </div>
      <div class="chart-card">
        <div class="table-header">
          <h3>Indicadores de Infraestrutura por Município — 2024</h3>
          <input type="text" class="table-search" id="infra-mun-search" placeholder="Buscar município...">
        </div>
        <div style="font-size:10px;color:var(--accent);padding:4px 12px 6px;font-weight:600;background:rgba(255,203,4,.08);border-radius:0 0 6px 6px;border-top:1px dashed rgba(255,203,4,.3)">
          📍 Clique em qualquer município — na tabela ou no mapa — para filtrar <strong>todas as visualizações</strong> desta seção (KPIs, gráficos e recortes). Clique novamente para desfiltrar.
        </div>
        <div style="max-height:400px;overflow-y:auto;overflow-x:auto">
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
  updateActiveFilters();
  updateFilterAwareness();

  // CRE layer toggle for infra map
  const btnMunLayer = document.getElementById('btn-infra-layer-mun');
  const btnCreLayer = document.getElementById('btn-infra-layer-cre');
  const btnEscLayer = document.getElementById('btn-infra-layer-esc');
  const allInfraBtns = [btnMunLayer, btnCreLayer, btnEscLayer].filter(Boolean);
  const clearInfraBtns = () => allInfraBtns.forEach(b => b.classList.remove('active'));

  if (btnMunLayer) btnMunLayer.addEventListener('click', () => {
    clearInfraBtns(); btnMunLayer.classList.add('active');
    const metric = document.getElementById('infra-map-metric')?.value || 'IN_INTERNET';
    buildInfraMap(infra, metric);
    buildInfraMunTable(infra);
  });
  if (btnCreLayer) btnCreLayer.addEventListener('click', () => {
    clearInfraBtns(); btnCreLayer.classList.add('active');
    buildInfraMapCre(infra, document.getElementById('infra-map-metric')?.value || 'IN_INTERNET');
    buildInfraMunTable(infra);
  });
  if (btnEscLayer) btnEscLayer.addEventListener('click', () => {
    clearInfraBtns(); btnEscLayer.classList.add('active');
    buildInfraEscolaLayer(infra);
  });
}

/* ── Infra Escola Layer ── */
function buildInfraEscolaLayer(infra) {
  if (!S.map) return;
  if (S.mapLayer) { S.mapLayer.remove(); S.mapLayer = null; }
  if (S.mapLegend) { S.mapLegend.remove(); S.mapLegend = null; }

  const ed = S.escolasData;
  if (!ed || !ed.escolas) return;
  const escolas = S.creSel ? ed.escolas.filter(e => e.cre === S.creSel) : ed.escolas;
  const withCoords = escolas.filter(e => e.lat && e.lng && e.infra_score != null);
  const lookup = S.data?.lookup_municipios || {};

  // Color by infra_score
  const getColor = (score) => score >= 80 ? '#00AB4E' : score >= 60 ? '#E6A100' : score >= 40 ? '#FF6B00' : '#EE302F';

  const markers = L.featureGroup();
  withCoords.forEach(e => {
    const score = e.infra_score || 0;
    const marker = L.circleMarker([e.lat, e.lng], {
      radius: 4, fillColor: getColor(score), color: '#fff', weight: 1, fillOpacity: 0.85,
    });
    const yesNo = (v) => v ? '<span style="color:#00AB4E">✓</span>' : '<span style="color:#EE302F">✗</span>';
    marker.bindPopup(`
      <div style="font-family:Inter;min-width:220px">
        <strong style="font-size:12px">${e.nome}</strong><br>
        <span style="font-size:10px;color:#666">${e.municipio || lookup[e.cod_mun] || ''} — INEP: ${e.inep}</span>
        <hr style="margin:4px 0;border:none;border-top:1px solid #eee">
        <div style="font-size:10px;margin-bottom:4px">
          <strong>Score Infra:</strong> <span style="color:${getColor(score)};font-weight:700">${score}%</span>
          ${e.salas_total ? ` | Salas: ${e.salas_total} (${e.salas_clim || 0} clim.)` : ''}
        </div>
        <div style="font-size:9px;display:grid;grid-template-columns:1fr 1fr;gap:1px;line-height:1.5">
          <span>${yesNo(e.internet)} Internet</span>
          <span>${yesNo(e.biblioteca)} Biblioteca</span>
          <span>${yesNo(e.lab_info)} Lab. Info</span>
          <span>${yesNo(e.quadra)} Quadra</span>
          <span>${yesNo(e.lab_ciencias)} Lab. Ciências</span>
          <span>${yesNo(e.rampas)} Rampas</span>
          <span>${yesNo(e.refeitorio)} Refeitório</span>
          <span>${yesNo(e.sala_aee)} Sala AEE</span>
        </div>
      </div>
    `, { maxWidth: 280 });
    markers.addLayer(marker);
  });
  markers.addTo(S.map);
  S.mapLayer = markers;
  if (withCoords.length) S.map.fitBounds(markers.getBounds(), { padding: [20, 20] });

  // Update table to show escola infra
  const titleEl = document.querySelector('#infra-mun-table')?.closest('.chart-card')?.querySelector('.table-header h3');
  if (titleEl) titleEl.textContent = 'Infraestrutura por Escola — 2025';

  const thead = document.querySelector('#infra-mun-table thead tr');
  if (thead) thead.innerHTML = '<th style="width:30px">#</th><th style="position:sticky;left:0;z-index:2;background:#f8f9fa;min-width:180px;border-right:2px solid #e0e0e0">Escola</th><th>Município</th><th>Internet</th><th>Banda Larga</th><th>Biblioteca</th><th>Lab.Inf.</th><th>Lab.Ciên.</th><th>Quadra</th><th>Rampas</th><th>Banh.PNE</th><th>Refeitório</th><th>Sala AEE</th><th>Salas</th><th>Climat.</th>';

  const sorted = [...escolas].filter(e => e.infra_score != null).sort((a, b) => (a.infra_score || 0) - (b.infra_score || 0));
  const tbody = document.getElementById('infra-mun-tbody');
  if (!tbody) return;

  const pctBadge = (v) => {
    const cls = v ? 'color:#00AB4E' : 'color:#EE302F';
    return `<td style="text-align:center;font-weight:600;${cls}">${v ? '✓' : '✗'}</td>`;
  };

  tbody.innerHTML = sorted.map((e, i) => `
    <tr data-lat="${e.lat || ''}" data-lng="${e.lng || ''}" style="cursor:pointer" title="${e.nome}">
      <td>${i + 1}</td>
      <td style="position:sticky;left:0;z-index:1;background:#fff;border-right:2px solid #e0e0e0"><strong style="font-size:10px">${e.nome}</strong></td>
      <td style="font-size:10px">${e.municipio || lookup[e.cod_mun] || ''}</td>
      ${pctBadge(e.internet)}
      ${pctBadge(e.banda_larga)}
      ${pctBadge(e.biblioteca)}
      ${pctBadge(e.lab_info)}
      ${pctBadge(e.lab_ciencias)}
      ${pctBadge(e.quadra)}
      ${pctBadge(e.rampas)}
      ${pctBadge(e.banheiro_pne)}
      ${pctBadge(e.refeitorio)}
      ${pctBadge(e.sala_aee)}
      <td style="text-align:center">${e.salas_total || 0}</td>
      <td style="text-align:center">${e.salas_clim || 0}</td>
    </tr>
  `).join('');

  // Click to zoom
  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => {
      const lat = parseFloat(tr.dataset.lat);
      const lng = parseFloat(tr.dataset.lng);
      if (!isNaN(lat) && !isNaN(lng)) {
        S.map.flyTo([lat, lng], 14, { duration: 0.5 });
        markers.eachLayer(m => {
          if (Math.abs(m.getLatLng().lat - lat) < 0.001 && Math.abs(m.getLatLng().lng - lng) < 0.001) m.openPopup();
        });
      }
    });
  });

  // Search
  const searchEl = document.getElementById('infra-mun-search');
  if (searchEl) {
    searchEl.value = '';
    searchEl.placeholder = 'Buscar escola...';
    searchEl.oninput = () => {
      const q = searchEl.value.toLowerCase();
      tbody.querySelectorAll('tr').forEach(tr => {
        tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    };
  }
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
  const sparkColors = ['#2E86C1','#2E86C1','#FFCB04','#EE302F','#1565C0','#00838F'];

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
        tooltip: { ...CHART_DEFAULTS.plugins.tooltip, callbacks: {
          label: ctx => {
            const col = allCols[ctx.dataIndex];
            const yr = ctx.datasetIndex === 0 ? baseYear : anoComp;
            const yrData = ctx.datasetIndex === 0 ? suBase : (munSu || su);
            const ind = yrData?.indicadores?.[col];
            const count = ind?.count || 0;
            return ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}% (${formatNum(count)} escolas)`;
          }
        } },
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
    { min: 80, color: '#0D3B66', label: '≥ 80%' },
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
        mouseout: e => { S.mapLayer.resetStyle(e.target); e.target.closeTooltip(); },
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

  // Fit RS bounds properly (same as Acesso)
  S.map.fitBounds(S.mapLayer.getBounds(), { padding: [20, 20] });
}

/** Build CRE-level choropleth for infra map */
function buildInfraMapCre(infra, metricKey) {
  const mapEl = document.getElementById('infra-map');
  if (!mapEl || !S.creGeo || !S.creLookup) return;

  destroyMap();

  const map = L.map(mapEl, { zoomControl: true, scrollWheelZoom: true, attributionControl: false }).setView([-29.7, -53.5], 6.5);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', { maxZoom: 14 }).addTo(map);

  const munData = infra.por_municipio?.['2024'] || {};
  const label = infra.labels?.[metricKey] || metricKey;

  // Aggregate infra data per CRE
  const creAgg = {};
  for (const cre of (S.creLookup.cre_list || [])) {
    const creMuns = getCreMuns(cre.cod_cre);
    let totalEscolas = 0, totalWithIndicator = 0;
    for (const cod of creMuns) {
      const m = munData[cod];
      if (!m) continue;
      totalEscolas += m.escolas || 0;
      totalWithIndicator += m.indicadores?.[metricKey]?.count || 0;
    }
    creAgg[cre.cod_cre] = { escolas: totalEscolas, pct: totalEscolas > 0 ? (totalWithIndicator / totalEscolas * 100) : 0 };
  }

  const tiers = [
    { min: 80, color: '#0D3B66', label: '\u2265 80%' },
    { min: 50, color: '#5cba68', label: '50% \u2013 79%' },
    { min: 0.1, color: '#d5efcf', label: '< 50%' },
  ];
  const getClr = (pct) => { for (const t of tiers) { if (pct >= t.min) return t.color; } return '#f0f0f0'; };

  const layer = L.geoJSON(S.creGeo, {
    style: (feature) => {
      const cod = feature.properties.cod_cre;
      const pct = creAgg[cod]?.pct || 0;
      return { fillColor: getClr(pct), fillOpacity: 0.75, weight: 2, color: '#fff' };
    },
    onEachFeature: (feature, lyr) => {
      const cod = feature.properties.cod_cre;
      const nome = feature.properties.nome_cre || `CRE ${cod}`;
      const agg = creAgg[cod] || {};
      lyr.bindTooltip(`<strong>${nome}</strong><br>${label}: ${(agg.pct || 0).toFixed(1)}% (${agg.escolas || 0} escolas)`, { sticky: true });
      lyr.on({
        mouseover: e => { e.target.setStyle({ weight: 3, color: '#FFB300', fillOpacity: 0.9 }); e.target.bringToFront(); },
        mouseout: e => { S.mapLayer.resetStyle(e.target); e.target.closeTooltip(); },
        click: () => {
          S.creSel = cod;
          S.munSel = null;
          const selCre = document.getElementById('sel-cre');
          if (selCre) selCre.value = cod;
          populateMunDropdown(cod);
          refreshActiveTab();
        }
      });
    }
  }).addTo(map);

  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = function () {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = `<h4>${label} (CREs)</h4>`;
    for (const t of tiers) { div.innerHTML += `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${t.color}"></div><span>${t.label}</span></div>`; }
    div.innerHTML += `<div class="map-legend-row" style="margin-top:4px"><div class="map-legend-swatch" style="background:#f0f0f0"></div><span>Sem dados</span></div>`;
    return div;
  };
  legend.addTo(map);

  L.control.attribution({ prefix: 'Leaflet | IBGE 2025' }).addTo(map);

  S.map = map;
  S.mapLayer = layer;
  S.mapLegend = legend;
  S.map.fitBounds(S.mapLayer.getBounds(), { padding: [20, 20] });
}

/** Bind infra map metric dropdown */
function bindInfraMapMetric(infra) {
  const sel = document.getElementById('infra-map-metric');
  if (!sel) return;
  sel.addEventListener('change', () => {
    const isCreMode = document.getElementById('btn-infra-layer-cre')?.classList.contains('active');
    if (isCreMode) {
      buildInfraMapCre(infra, sel.value);
    } else {
      buildInfraMap(infra, sel.value);
    }
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
    <div class="section-sticky">
    ${sectionBanner('img/icons/sec_docentes.png', 'Docência', 'Rede Estadual do RS', {redeToggle: false})}

    <div class="kpi-strip" id="doc-kpis" style="grid-template-columns:repeat(4,1fr)"></div>
    </div>

    <!-- ═══ Perfil Docente ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/sec_docentes.png" alt=""></span>
      <span class="section-divider-text">Perfil Docente — 2025</span>
      <span class="section-divider-line"></span>
    </div>

    <div style="background:rgba(25,118,210,.06);border-left:3px solid #1976D2;border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:11px;color:#333;line-height:1.5">
      <strong>ℹ️ Nota:</strong> Os recortes de sexo, raça/cor, escolaridade, faixa etária e vínculo são extraídos da <em>Tabela de Docentes</em> do Censo Escolar, publicada pelo INEP apenas a partir da edição de <strong>2025</strong>. Dessa forma, estes perfis não variam de ano para ano e representam exclusivamente o retrato de 2025.
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
      <div class="chart-card d1">
        <div class="chart-title">Docentes por Sexo</div>
        <div style="height:240px"><canvas id="chart-doc-sexo"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card d2">
        <div class="chart-title">Raça/Cor</div>
        <div style="height:240px"><canvas id="chart-doc-raca"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card d3">
        <div class="chart-title">Tipo de Vínculo</div>
        <div style="height:240px"><canvas id="chart-doc-vinculo"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
    </div>
    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
      <div class="chart-card d4">
        <div class="chart-title">Escolaridade dos Docentes</div>
        <div style="height:270px"><canvas id="chart-doc-esco"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card d5">
        <div class="chart-title">Faixa Etária</div>
        <div style="height:270px"><canvas id="chart-doc-idade"></canvas></div>
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
          <div class="map-layer-toggle">
            <button class="map-layer-btn active" id="doc-btn-layer-mun">Municípios</button>
            <button class="map-layer-btn" id="doc-btn-layer-cre">CREs</button>
            <button class="map-layer-btn" id="doc-btn-layer-esc">Escolas</button>
          </div>
        </div>
        <div id="doc-map" style="height:400px;width:100%"></div>
      </div>
      <div class="chart-card">
        <div class="table-header">
          <h3>Docentes por Município — 2025</h3>
          <input type="text" class="table-search" id="doc-mun-search" placeholder="Buscar município...">
        </div>
        <div style="font-size:10px;color:var(--accent);padding:4px 12px 6px;font-weight:600;background:rgba(255,203,4,.08);border-radius:0 0 6px 6px;border-top:1px dashed rgba(255,203,4,.3)">
          📍 Clique em qualquer município — na tabela ou no mapa — para filtrar <strong>todas as visualizações</strong> desta seção (KPIs, gráficos e recortes). Clique novamente para desfiltrar.
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
  updateActiveFilters();
  updateFilterAwareness();

  // Bind Docência map layer toggle
  const docBtnMun = document.getElementById('doc-btn-layer-mun');
  const docBtnCre = document.getElementById('doc-btn-layer-cre');
  const docBtnEsc = document.getElementById('doc-btn-layer-esc');
  const allDocBtns = [docBtnMun, docBtnCre, docBtnEsc].filter(Boolean);
  const clearDocBtns = () => allDocBtns.forEach(b => b.classList.remove('active'));

  if (docBtnMun) docBtnMun.addEventListener('click', () => {
    clearDocBtns(); docBtnMun.classList.add('active');
    buildDocMap(doc);
    buildDocMunTable(doc);
  });
  if (docBtnCre) docBtnCre.addEventListener('click', () => {
    clearDocBtns(); docBtnCre.classList.add('active');
    buildDocCreMap(doc);
    buildDocMunTable(doc);
  });
  if (docBtnEsc) docBtnEsc.addEventListener('click', () => {
    clearDocBtns(); docBtnEsc.classList.add('active');
    buildDocEscolaLayer(doc);
  });
}

/* ── Docência Escola Layer ── */
function buildDocEscolaLayer(doc) {
  const mapEl = document.getElementById('doc-map');
  if (!mapEl) return;
  destroyMap();

  // Init map
  S.map = L.map(mapEl).setView([-29.5, -53.5], 7);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 18, attribution: '&copy; CARTO'
  }).addTo(S.map);

  const ed = S.escolasData;
  if (!ed || !ed.escolas) return;
  const escolas = S.creSel ? ed.escolas.filter(e => e.cre === S.creSel) : ed.escolas;
  const withCoords = escolas.filter(e => e.lat && e.lng && e.doc_total != null);
  const lookup = S.data?.lookup_municipios || {};

  const markers = L.featureGroup();
  withCoords.forEach(e => {
    const dt = e.doc_total || 0;
    const r = dt > 100 ? 6 : dt > 50 ? 5 : dt > 20 ? 4 : 3;
    const pctConcur = dt > 0 ? Math.round((e.doc_concur || 0) / dt * 100) : 0;
    const color = pctConcur >= 70 ? '#0097A7' : pctConcur >= 40 ? '#E6A100' : '#EE302F';
    const marker = L.circleMarker([e.lat, e.lng], {
      radius: r, fillColor: color, color: '#fff', weight: 1, fillOpacity: 0.85,
    });
    marker.bindPopup(`
      <div style="font-family:Inter;min-width:200px">
        <strong style="font-size:12px">${e.nome}</strong><br>
        <span style="font-size:10px;color:#666">${e.municipio || lookup[e.cod_mun] || ''} — INEP: ${e.inep}</span>
        <hr style="margin:4px 0;border:none;border-top:1px solid #eee">
        <div style="font-size:10px;line-height:1.6">
          <strong>Total Docentes:</strong> ${formatNum(dt)}<br>
          ${e.doc_concur ? `<span style="display:inline-block;background:#0097A722;padding:1px 5px;border-radius:3px;margin:1px">Concurs.: <strong>${formatNum(e.doc_concur)}</strong></span>` : ''}
          ${e.doc_contrat ? `<span style="display:inline-block;background:#EE302F22;padding:1px 5px;border-radius:3px;margin:1px">Contrat.: <strong>${formatNum(e.doc_contrat)}</strong></span>` : ''}
          ${e.doc_sup ? `<br><span style="font-size:9px;color:#666">Superior: ${formatNum(e.doc_sup)} | Licenc.: ${formatNum(e.doc_licen || 0)}</span>` : ''}
          ${e.mat_total ? `<br><span style="font-size:9px;color:#666">Razão aluno/prof: ${dt > 0 ? (e.mat_total / dt).toFixed(1) : 'N/A'}</span>` : ''}
        </div>
      </div>
    `, { maxWidth: 280 });
    markers.addLayer(marker);
  });
  markers.addTo(S.map);
  if (withCoords.length) S.map.fitBounds(markers.getBounds(), { padding: [20, 20] });

  // Update table
  const titleEl = document.querySelector('#doc-mun-table')?.closest('.chart-card')?.querySelector('.table-header h3');
  if (titleEl) titleEl.textContent = 'Docentes por Escola — 2025';

  const thead = document.querySelector('#doc-mun-table thead tr');
  if (thead) thead.innerHTML = '<th>#</th><th>Escola</th><th>Município</th><th>Total</th><th>Concurs.</th><th>Contrat.</th><th>Superior</th><th>Razão A/P</th>';

  const sorted = [...escolas].filter(e => e.doc_total != null).sort((a, b) => (b.doc_total || 0) - (a.doc_total || 0));
  const tbody = document.getElementById('doc-mun-tbody');
  if (!tbody) return;

  tbody.innerHTML = sorted.map((e, i) => {
    const dt = e.doc_total || 0;
    const razao = dt > 0 && e.mat_total ? (e.mat_total / dt).toFixed(1) : '—';
    return `
    <tr data-lat="${e.lat || ''}" data-lng="${e.lng || ''}" style="cursor:pointer">
      <td>${i + 1}</td>
      <td><strong style="font-size:10px">${e.nome}</strong></td>
      <td style="font-size:10px">${e.municipio || lookup[e.cod_mun] || ''}</td>
      <td>${formatNum(dt)}</td>
      <td>${formatNum(e.doc_concur || 0)}</td>
      <td>${formatNum(e.doc_contrat || 0)}</td>
      <td>${formatNum(e.doc_sup || 0)}</td>
      <td style="text-align:center">${razao}</td>
    </tr>`;
  }).join('');

  // Click to zoom
  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => {
      const lat = parseFloat(tr.dataset.lat);
      const lng = parseFloat(tr.dataset.lng);
      if (!isNaN(lat) && !isNaN(lng)) {
        S.map.flyTo([lat, lng], 14, { duration: 0.5 });
        markers.eachLayer(m => {
          if (Math.abs(m.getLatLng().lat - lat) < 0.001 && Math.abs(m.getLatLng().lng - lng) < 0.001) m.openPopup();
        });
      }
    });
  });

  // Search
  const searchEl = document.getElementById('doc-mun-search');
  if (searchEl) {
    searchEl.value = '';
    searchEl.placeholder = 'Buscar escola...';
    searchEl.oninput = () => {
      const q = searchEl.value.toLowerCase();
      tbody.querySelectorAll('tr').forEach(tr => {
        tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    };
  }
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
    { min: 500, color: '#0D3B66', label: '≥ 500' },
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
        mouseout: e => { S.mapLayer.resetStyle(e.target); e.target.closeTooltip(); },
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
  S.map.fitBounds(S.mapLayer.getBounds(), { padding: [20, 20] });
}

/** Build CRE-level choropleth for Docência */
function buildDocCreMap(doc) {
  if (!S.creGeo || !S.map) return;
  if (S.mapLayer) { S.map.removeLayer(S.mapLayer); S.mapLayer = null; }
  if (S.mapLegend) { S.map.removeControl(S.mapLegend); S.mapLegend = null; }

  const munData = doc.por_municipio_2025 || {};
  const munToCre = S.creLookup?.mun_to_cre || {};

  // Aggregate by CRE
  const creData = {};
  for (const [cod, v] of Object.entries(munData)) {
    const cre = munToCre[cod]?.cod_cre;
    if (!cre) continue;
    if (!creData[cre]) creData[cre] = { docentes: 0, escolas: 0, nome: munToCre[cod]?.nome_cre || cre };
    creData[cre].docentes += v.docentes || 0;
    creData[cre].escolas += v.escolas || 0;
  }

  const tiers = [
    { min: 3000, color: '#0D3B66', label: '≥ 3.000' },
    { min: 1000, color: '#5cba68', label: '1.000 – 2.999' },
    { min: 0, color: '#d5efcf', label: '< 1.000' },
  ];
  const getColor = v => { for (const t of tiers) { if (v >= t.min) return t.color; } return '#f0f0f0'; };

  S.mapLayer = L.geoJSON(S.creGeo, {
    style: feature => {
      const cod = feature.properties.cod_cre;
      const v = creData[cod]?.docentes || 0;
      return { fillColor: getColor(v), fillOpacity: 0.8, weight: 2, color: '#fff' };
    },
    onEachFeature: (feature, layer) => {
      const cod = feature.properties.cod_cre;
      const nome = feature.properties.nome_cre || cod;
      const d = creData[cod] || {};
      layer.bindTooltip(`<strong>${nome}</strong><br>Docentes: ${formatNum(d.docentes || 0)}<br>Escolas: ${d.escolas || 0}`, { sticky: true });
      layer.on('click', () => { S.creSel = cod; const selCre = document.getElementById('sel-cre'); if (selCre) selCre.value = cod; populateMunDropdown(cod); refreshActiveTab(); });
    }
  }).addTo(S.map);

  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = function () {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = '<h4>Docentes (CREs)</h4>' +
      tiers.map(t => `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${t.color}"></div><span>${t.label}</span></div>`).join('');
    return div;
  };
  legend.addTo(S.map);
  S.mapLegend = legend;
  if (S.mapLayer) S.map.fitBounds(S.mapLayer.getBounds(), { padding: [20, 20] });
}

/** Build docent municipality table */
let docSortCol = 3, docSortAsc = false; // default: sort by Docentes desc
function buildDocMunTable(doc) {
  const tbody = document.getElementById('doc-mun-tbody');
  const thead = document.querySelector('#doc-mun-table thead');
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
    .map(([cod, v]) => ({ cod, nome: lookup[cod] || `Cód. ${cod}`, ...v }));

  // Sort
  const colKeys = ['#', 'nome', 'escolas', 'docentes'];
  rows.sort((a, b) => {
    const key = colKeys[docSortCol];
    let va, vb;
    if (key === 'nome') { va = a.nome.toLowerCase(); vb = b.nome.toLowerCase(); }
    else if (key === 'escolas') { va = a.escolas || 0; vb = b.escolas || 0; }
    else if (key === 'docentes') { va = a.docentes || 0; vb = b.docentes || 0; }
    else { va = 0; vb = 0; }
    const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return docSortAsc ? cmp : -cmp;
  });

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

  // Sortable headers
  if (thead) {
    const headers = ['#', 'Município', 'Esc.', 'Docentes'];
    thead.innerHTML = '<tr>' + headers.map((h, i) => {
      const arrow = docSortCol === i ? (docSortAsc ? ' ▲' : ' ▼') : ' ⇅';
      return `<th style="cursor:pointer" title="Clique para ordenar">${h}${arrow}</th>`;
    }).join('') + '</tr>';

    thead.querySelectorAll('th').forEach((th, ci) => {
      th.addEventListener('click', () => {
        if (docSortCol === ci) docSortAsc = !docSortAsc;
        else { docSortCol = ci; docSortAsc = ci <= 1; }
        buildDocMunTable(doc);
      });
    });
  }

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
  // Use municipality data if filtered, CRE aggregation if CRE selected, otherwise state-level
  let p;
  if (S.munSel && doc.por_municipio_2025?.[S.munSel]) {
    p = doc.por_municipio_2025[S.munSel];
    p.total = p.docentes || 0;
  } else if (S.creSel) {
    // Aggregate all municipalities within this CRE
    const creMuns = getCreMuns(S.creSel);
    const agg = { total: 0, por_sexo: {}, por_raca: {}, por_escolaridade: {}, por_faixa_etaria: {}, por_vinculo: {} };
    for (const cod of creMuns) {
      const m = doc.por_municipio_2025?.[cod];
      if (!m) continue;
      agg.total += m.docentes || 0;
      for (const [k, v] of Object.entries(m.por_sexo || {})) agg.por_sexo[k] = (agg.por_sexo[k] || 0) + v;
      for (const [k, v] of Object.entries(m.por_escolaridade || {})) agg.por_escolaridade[k] = (agg.por_escolaridade[k] || 0) + v;
      for (const [k, v] of Object.entries(m.por_faixa_etaria || {})) agg.por_faixa_etaria[k] = (agg.por_faixa_etaria[k] || 0) + v;
      for (const [k, v] of Object.entries(m.por_vinculo || {})) agg.por_vinculo[k] = (agg.por_vinculo[k] || 0) + v;
      for (const [k, v] of Object.entries(m.por_raca || {})) agg.por_raca[k] = (agg.por_raca[k] || 0) + v;
    }
    p = agg;
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
  doughnut('chart-doc-raca', p.por_raca, ['#1976D2CC','#333333CC','#8D6E63CC','#FFB300CC','#2E7D32CC']);
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
        borderColor: '#0D3B66', backgroundColor: '#0D3B6618', fill: true, tension: .35, pointRadius: 5, borderWidth: 2.5 }] },
      options: { ...CHART_DEFAULTS,
        plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false },
          datalabels: { display: true, anchor: 'end', align: 'top', offset: 3, font: { family: 'Inter', size: 10, weight: '700' }, color: '#0D3B66', formatter: v => v?.toFixed(1) ?? '' } },
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
    const turmaColors = ['#0D3B66CC','#2874A6CC','#5a91bdCC','#8fb3d1CC','#1565C0CC','#E65100CC'];

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
    const etapas = ['Ed. Infantil','Anos Iniciais','Anos Finais','Ens. Médio','EJA'];
    const tColors = ['#2874A6','#43A047','#66BB6A','#1565C0','#E65100'];

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
    <div class="section-sticky">
    ${sectionBanner('img/icons/nav_desigualdades.png', 'Desigualdades', 'Recortes Socioeconômicos', {redeToggle: false})}
    </div>
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
      ${redeToggleHTML(
        ['municipal', 'federal', 'filantropica'],
        'SAEB só distingue Pública vs Privada (IN_PUBLICA). Não há separação por dependência administrativa.'
      )}
      <div class="kpi-strip" id="saeb-kpis"></div>
    </div>

    <!-- ═══ BLOCO INFORMATIVO: O que é o SAEB? ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/sec_saeb.png" alt=""></span>
      <span class="section-divider-text">O que é o SAEB?</span>
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
            O <strong>SAEB (Sistema de Avaliação da Educação Básica)</strong> é a principal avaliação
            externa da educação brasileira, aplicada pelo INEP a cada 2 anos. Mede a
            <strong>proficiência</strong> dos estudantes em <strong>Língua Portuguesa</strong> e
            <strong>Matemática</strong> em três etapas: 5º e 9º ano do EF e 3ª série do EM.
          </p>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <img src="img/icons/sec_evolucao.png" alt="" style="width:20px;height:20px">
            <span style="font-size:14px;font-weight:700;color:var(--pri)">Metodologia</span>
          </div>
          <p style="font-size:11.5px;margin:0 0 14px;color:#333;line-height:1.75">
            As notas são calculadas pela <strong>Teoria de Resposta ao Item (TRI)</strong>,
            garantindo comparabilidade entre edições. A escala é única e contínua
            (tipicamente <strong>0–500 pontos</strong>), onde cada nível representa habilidades específicas.
          </p>
          <div style="background:rgba(255,203,4,.1);border:1px solid rgba(255,203,4,.25);border-radius:6px;padding:10px 14px">
            <p style="font-size:11px;margin:0;color:#5D4037;line-height:1.7">
              <strong style="color:#E65100">⚠ Nota:</strong> <strong>Até 2015</strong>, o SAEB era composto pela
              <em>ANEB</em> (amostral, incluindo EM) e pela <em>Prova Brasil</em> (censitária, EF).
              A partir de <strong>2017</strong> (<em>Portaria INEP nº 447/2017</em>), tornou-se
              <strong>censitário para o EM</strong>, ampliando significativamente a cobertura.
            </p>
          </div>
          <p style="font-size:9px;margin:10px 0 0;color:#999;line-height:1.5;font-style:italic">
            Fontes: INEP — Portaria nº 447/2017; Escala SAEB/Prova Brasil (INEP, Nota Técnica).
          </p>
        </div>
        <div style="padding:20px 24px;border-left:1px solid rgba(0,90,50,.06)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
            <img src="img/icons/panorama.png" alt="" style="width:20px;height:20px">
            <span style="font-size:14px;font-weight:700;color:var(--pri)">Escala de Proficiência</span>
          </div>
          <table style="width:100%;font-size:10px;border-collapse:separate;border-spacing:0">
            <thead>
              <tr>
                <th style="padding:5px 6px;text-align:left;background:#f0f4f8;border-bottom:2px solid #ddd;font-weight:700;color:#333">Etapa</th>
                <th style="padding:5px 6px;text-align:left;background:#f0f4f8;border-bottom:2px solid #ddd;font-weight:700;color:#333">Disc.</th>
                <th style="padding:5px 6px;text-align:center;background:#C62828;border-bottom:2px solid #ddd;font-weight:700;color:#fff">Insuficiente</th>
                <th style="padding:5px 6px;text-align:center;background:#F9A825;border-bottom:2px solid #ddd;font-weight:700;color:#333">Básico</th>
                <th style="padding:5px 6px;text-align:center;background:#66BB6A;border-bottom:2px solid #ddd;font-weight:700;color:#fff">Proficiente</th>
                <th style="padding:5px 6px;text-align:center;background:#2E7D32;border-bottom:2px solid #ddd;font-weight:700;color:#fff">Avançado</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style="padding:4px 6px;border-bottom:1px solid #eee;font-weight:600">5º EF</td><td style="padding:4px 6px;border-bottom:1px solid #eee">LP</td><td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:center">< 200</td><td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:center">200–249</td><td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:center">250–299</td><td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:center">≥ 300</td></tr>
              <tr style="background:#fafbfc"><td style="padding:4px 6px;border-bottom:1px solid #eee;font-weight:600">5º EF</td><td style="padding:4px 6px;border-bottom:1px solid #eee">MT</td><td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:center">< 225</td><td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:center">225–274</td><td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:center">275–324</td><td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:center">≥ 325</td></tr>
              <tr><td style="padding:4px 6px;border-bottom:1px solid #eee;font-weight:600">9º EF</td><td style="padding:4px 6px;border-bottom:1px solid #eee">LP</td><td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:center">< 225</td><td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:center">225–274</td><td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:center">275–324</td><td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:center">≥ 325</td></tr>
              <tr style="background:#fafbfc"><td style="padding:4px 6px;border-bottom:1px solid #eee;font-weight:600">9º EF</td><td style="padding:4px 6px;border-bottom:1px solid #eee">MT</td><td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:center">< 250</td><td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:center">250–299</td><td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:center">300–349</td><td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:center">≥ 350</td></tr>
              <tr><td style="padding:4px 6px;border-bottom:1px solid #eee;font-weight:600">EM</td><td style="padding:4px 6px;border-bottom:1px solid #eee">LP</td><td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:center">< 275</td><td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:center">275–324</td><td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:center">325–374</td><td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:center">≥ 375</td></tr>
              <tr style="background:#fafbfc"><td style="padding:4px 6px;font-weight:600">EM</td><td style="padding:4px 6px">MT</td><td style="padding:4px 6px;text-align:center">< 300</td><td style="padding:4px 6px;text-align:center">300–349</td><td style="padding:4px 6px;text-align:center">350–399</td><td style="padding:4px 6px;text-align:center">≥ 400</td></tr>
            </tbody>
          </table>
          <p style="font-size:9px;margin:6px 0 0;color:#999;line-height:1.5;font-style:italic">
            Pontos de corte oficiais INEP/MEC. As faixas variam conforme etapa e disciplina.
          </p>
          <div style="margin-top:14px;background:rgba(21,101,192,.06);border:1px solid rgba(21,101,192,.15);border-radius:6px;padding:10px 14px">
            <p style="font-size:11px;margin:0;color:#0D47A1;line-height:1.7">
              <strong>Atenção:</strong> <em>"Estadual"</em> neste painel = todas as escolas <strong>públicas</strong>
              (estaduais + municipais + federais), pois os microdados SAEB usam apenas a flag IN_PUBLICA (0/1).
            </p>
          </div>
          <div style="margin-top:10px;background:rgba(255,203,4,.08);border:1px solid rgba(255,203,4,.18);border-radius:6px;padding:10px 14px">
            <p style="font-size:10.5px;margin:0;color:#5D4037;line-height:1.7">
              <strong>2023:</strong> O INEP <span style="position:relative;cursor:help;border-bottom:1px dotted #8D6E63" title="Leia-Me Microdados SAEB 2023, p. 11 — &quot;As máscaras, entendidas como códigos fictícios, foram utilizadas em todas as bases para evitar a identificação de escolas e municípios atendendo às regras de proteção de dados pessoais estabelecidas pela LGPD. No que diz respeito à padronização da máscara, o código fictício usado para cada escola ou município inicia com o dígito '6' e é o mesmo para todas as bases dos Microdados. O uso das máscaras se dá pela substituição dos códigos reais da escola e do município por códigos fictícios. O mascaramento dos códigos de Escolas e Municípios reduz significativamente a possibilidade de reidentificação dos alunos, professores, gestores escolares e municipais, por meio do cruzamento das bases disponibilizadas.&quot;"><strong>mascarou</strong> ⓘ</span> o código de município nos microdados.
              Dados municipais disponíveis apenas até 2021.
            </p>
          </div>
          <div style="margin-top:10px;background:rgba(0,90,50,.05);border:1px solid rgba(0,90,50,.15);border-radius:6px;padding:10px 14px">
            <p style="font-size:11px;margin:0 0 6px;color:#1B5E20;font-weight:700">
              📋 Critérios de Divulgação Municipal (Art. 19, Portaria INEP nº 250/2021)
            </p>
            <p style="font-size:10.5px;margin:0 0 6px;color:#333;line-height:1.7">
              A divulgação de resultados por <strong>escola</strong> e <strong>município</strong> exige o cumprimento <em>cumulativo</em> de dois critérios:
            </p>
            <table style="width:100%;font-size:10px;border-collapse:separate;border-spacing:0;margin-bottom:6px">
              <thead>
                <tr>
                  <th style="padding:4px 6px;text-align:left;background:#e8f5e9;border-bottom:1px solid #c8e6c9;font-weight:700">Critério</th>
                  <th style="padding:4px 6px;text-align:center;background:#e8f5e9;border-bottom:1px solid #c8e6c9;font-weight:700">Escolas</th>
                  <th style="padding:4px 6px;text-align:center;background:#e8f5e9;border-bottom:1px solid #c8e6c9;font-weight:700">Municípios</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style="padding:4px 6px;border-bottom:1px solid #eee">Nº mínimo de alunos presentes</td>
                  <td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:center;font-weight:600">≥ 10</td>
                  <td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:center;font-weight:600">≥ 10</td>
                </tr>
                <tr style="background:#fafbfc">
                  <td style="padding:4px 6px">Taxa de participação mínima</td>
                  <td style="padding:4px 6px;text-align:center;font-weight:600">≥ 80%</td>
                  <td style="padding:4px 6px;text-align:center;font-weight:600">≥ 50%*</td>
                </tr>
              </tbody>
            </table>
            <p style="font-size:9.5px;margin:0;color:#666;line-height:1.6">
              * Originalmente 80%, reduzido para <strong>50%</strong> pela <em>Portaria nº 399/2022</em> para municípios, visando ampliar o acesso aos dados pós-pandemia (SAEB 2021).
              Municípios/etapas que não atingem estes critérios ficam <strong>sem dados</strong> na desagregação municipal.
            </p>
            <p style="font-size:9px;margin:6px 0 0;color:#999;line-height:1.5;font-style:italic">
              Fontes: Portaria INEP nº 250/2021, Art. 19; Portaria INEP nº 399/2022 (retificação).
            </p>
          </div>
        </div>
      </div>
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
        <div style="height:300px"><canvas id="chart-saeb-lp"></canvas></div>
        <div class="chart-source">${FONTE_SAEB}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Matemática — Evolução por Etapa</div>
        <div style="height:300px"><canvas id="chart-saeb-mt"></canvas></div>
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

  // Helper: get SAEB data for a given year considering geo filters
  // Returns null if geo filter active but no data for that year (no fallback to state level)
  function getSaebYearData(ano) {
    if (S.munSel) {
      return saeb.por_municipio?.[ano]?.[S.munSel] || null;
    }
    if (S.creSel && saeb.por_municipio?.[ano]) {
      const creMuns = getCreMuns(S.creSel);
      const munYear = saeb.por_municipio[ano] || {};
      const agg = {};
      for (const cod of creMuns) {
        const m = munYear[cod]; if (!m) continue;
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
      return Object.keys(agg).length ? agg : null;
    }
    return saeb.serie_temporal[ano];
  }

  function buildLine(canvasId, field) {
    const el = document.getElementById(canvasId);
    if (!el) return;
    const useGeo = S.munSel || S.creSel;
    const datasets = etapas.map((et, i) => {
      const data = anos.map(a => {
        if (useGeo) {
          const geoData = getSaebYearData(a);
          return geoData?.[et]?.[field] || null;
        }
        return saeb.serie_temporal[a]?.[et]?.[field] || null;
      });
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
        layout: { padding: { top: 28 } },
        plugins: {
          ...CHART_DEFAULTS.plugins,
          legend: {
            display: true, position: 'top',
            labels: { font: { family: 'Inter', size: 11, weight: '600' }, boxWidth: 12, padding: 14, usePointStyle: true },
          },
          datalabels: {
            display: true,
            anchor: ctx => ctx.datasetIndex === 1 ? 'start' : 'end',
            align: ctx => ctx.datasetIndex === 1 ? 'bottom' : 'top',
            offset: 6,
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
            legend: {
              display: true,
              labels: { font: { family: 'Inter', size: 11, weight: '600' }, boxWidth: 12, padding: 10 },
            },
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
          legend: { display: true, labels: { font: { family: 'Inter', size: 11, weight: '600' }, boxWidth: 12, padding: 10 } },
          datalabels: DL_BAR },
      }
    }));
  }

  // ── SAEB Map + Municipality Table (if per-municipality data available) ──
  const saebBuildMunSection = () => {
    const porMun = saeb.por_municipio || {};
    const anosComMun = Object.keys(porMun).sort();
    if (anosComMun.length === 0) return;

    const anoMapaDefault = anosComMun[anosComMun.length - 1];
    const lookup = saeb.lookup_municipios || {};

    // SAEB breaks per etapa×disc (official INEP cutoffs)
    const SAEB_BREAKS = {
      '5EF_lp': [{min:0,max:200,color:'#C62828',label:'< 200'},{min:200,max:250,color:'#F9A825',label:'200–249'},{min:250,max:300,color:'#66BB6A',label:'250–299'},{min:300,max:999,color:'#2874A6',label:'≥ 300'}],
      '5EF_mt': [{min:0,max:225,color:'#C62828',label:'< 225'},{min:225,max:275,color:'#F9A825',label:'225–274'},{min:275,max:325,color:'#66BB6A',label:'275–324'},{min:325,max:999,color:'#2874A6',label:'≥ 325'}],
      '9EF_lp': [{min:0,max:225,color:'#C62828',label:'< 225'},{min:225,max:275,color:'#F9A825',label:'225–274'},{min:275,max:325,color:'#66BB6A',label:'275–324'},{min:325,max:999,color:'#2874A6',label:'≥ 325'}],
      '9EF_mt': [{min:0,max:250,color:'#C62828',label:'< 250'},{min:250,max:300,color:'#F9A825',label:'250–299'},{min:300,max:350,color:'#66BB6A',label:'300–349'},{min:350,max:999,color:'#2874A6',label:'≥ 350'}],
      'EM_lp':  [{min:0,max:275,color:'#C62828',label:'< 275'},{min:275,max:325,color:'#F9A825',label:'275–324'},{min:325,max:375,color:'#66BB6A',label:'325–374'},{min:375,max:999,color:'#2874A6',label:'≥ 375'}],
      'EM_mt':  [{min:0,max:300,color:'#C62828',label:'< 300'},{min:300,max:350,color:'#F9A825',label:'300–349'},{min:350,max:400,color:'#66BB6A',label:'350–399'},{min:400,max:999,color:'#2874A6',label:'≥ 400'}],
    };
    const SAEB_BREAK_LABELS = { '5EF': '5º EF', '9EF': '9º EF', 'EM': 'EM' };
    const SAEB_DISC_LABELS = { lp: 'LP', mt: 'MT' };

    // Insert map + table HTML
    const mapSection = document.createElement('div');
    mapSection.innerHTML = `
      <div class="section-divider">
        <span class="section-divider-icon"><img src="img/icons/sec_saeb.png" alt=""></span>
        <span class="section-divider-text" id="saeb-map-title">Mapa SAEB por Município</span>
        <span class="section-divider-line"></span>
      </div>
      <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="chart-card" style="min-height:370px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
            <select id="sel-saeb-map-ano" style="font-size:11px;padding:4px 8px;border-radius:5px;border:1px solid #ddd;font-family:Inter">
              ${anosComMun.map(a => `<option value="${a}" ${a === anoMapaDefault ? 'selected' : ''}>${a}</option>`).join('')}
            </select>
            <select id="sel-saeb-map-etapa" style="font-size:11px;padding:4px 8px;border-radius:5px;border:1px solid #ddd;font-family:Inter">
              <option value="5EF">5º Ano EF</option>
              <option value="9EF" selected>9º Ano EF</option>
              <option value="EM">Ens. Médio</option>
            </select>
            <select id="sel-saeb-map-disc" style="font-size:11px;padding:4px 8px;border-radius:5px;border:1px solid #ddd;font-family:Inter">
              <option value="lp" selected>Língua Portuguesa</option>
              <option value="mt">Matemática</option>
            </select>
            <div class="map-layer-toggle">
              <button class="map-layer-btn active" id="saeb-btn-layer-mun">Municípios</button>
              <button class="map-layer-btn" id="saeb-btn-layer-cre">CREs</button>
            </div>
          </div>
          <div id="saeb-map-leaflet" style="height:340px;border-radius:8px"></div>
        </div>
        <div class="chart-card" style="max-height:400px;overflow:auto">
          <div class="chart-title" id="saeb-table-title">Tabela Municipal — SAEB ${anoMapaDefault}</div>
          <div style="font-size:10px;color:var(--accent);padding:4px 12px 6px;font-weight:600;background:rgba(255,203,4,.08);border-radius:6px;border:1px dashed rgba(255,203,4,.3);margin-bottom:6px">
            📍 Clique em qualquer município — na tabela ou no mapa — para filtrar <strong>todas as visualizações</strong> desta seção. Clique novamente para desfiltrar.
          </div>
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

    // Shared state for map filters
    let mapAno = anoMapaDefault, mapEtapa = '9EF', mapDisc = 'lp';

    // Build/update table
    function updateSaebTable() {
      const tbody = document.querySelector('#saeb-mun-table tbody');
      if (!tbody) return;
      const munData = porMun[mapAno] || {};
      let entries = Object.entries(munData);
      if (S.creSel && S.creLookup?.mun_to_cre) {
        entries = entries.filter(([cod]) => S.creLookup.mun_to_cre[cod]?.cod_cre === S.creSel);
      }
      if (S.munSel) {
        entries = entries.filter(([cod]) => cod === S.munSel);
      }
      entries.sort((a, b) => (b[1]?.['9EF']?.media_lp || 0) - (a[1]?.['9EF']?.media_lp || 0));
      tbody.innerHTML = entries.map(([cod, md], i) => `
        <tr data-cod="${cod}" style="cursor:pointer" class="${S.munSel === cod ? 'selected' : ''}" title="Clique para filtrar por ${lookup[cod] || cod}">
          <td>${i + 1}</td>
          <td><strong>${lookup[cod] || cod}</strong></td>
          <td>${md['5EF']?.media_lp?.toFixed(1) ?? '—'}</td>
          <td>${md['5EF']?.media_mt?.toFixed(1) ?? '—'}</td>
          <td><strong>${md['9EF']?.media_lp?.toFixed(1) ?? '—'}</strong></td>
          <td>${md['9EF']?.media_mt?.toFixed(1) ?? '—'}</td>
        </tr>`).join('');
      // Click handler on table rows
      tbody.querySelectorAll('tr').forEach(tr => {
        tr.addEventListener('click', () => {
          const cod = tr.dataset.cod;
          S.munSel = S.munSel === cod ? null : cod;
          refreshActiveTab();
        });
      });
      // Update table title
      const tt = document.getElementById('saeb-table-title');
      if (tt) tt.textContent = `Tabela Municipal — SAEB ${mapAno}`;
    }

    // Build/update map
    function updateSaebMap() {
      if (!S.geo) return;
      const munData = porMun[mapAno] || {};
      const breakKey = `${mapEtapa}_${mapDisc}`;
      const breaks = SAEB_BREAKS[breakKey] || SAEB_BREAKS['9EF_lp'];
      const field = `media_${mapDisc}`;

      function getColor(v) {
        for (const b of breaks) { if (v >= b.min && v < b.max) return b.color; }
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
        const nome = props.nome || lookup[props.cod_mun?.substring(0,7)] || props.cod_mun;
        if (!md) { this._div.innerHTML = `<h4>${nome}</h4><div style="color:#999;font-size:11px">Sem dados SAEB</div>`; return; }
        this._div.innerHTML = `<h4>${nome}</h4>
          ${md['5EF'] ? `<div class="info-row"><span class="info-label">5EF LP</span><span class="info-value">${md['5EF'].media_lp?.toFixed(1)}</span></div>
          <div class="info-row"><span class="info-label">5EF MT</span><span class="info-value">${md['5EF'].media_mt?.toFixed(1)}</span></div>` : ''}
          ${md['9EF'] ? `<div class="info-row"><span class="info-label">9EF LP</span><span class="info-value">${md['9EF'].media_lp?.toFixed(1)}</span></div>
          <div class="info-row"><span class="info-label">9EF MT</span><span class="info-value">${md['9EF'].media_mt?.toFixed(1)}</span></div>` : ''}
          ${md['EM'] ? `<div class="info-row"><span class="info-label">EM LP</span><span class="info-value">${md['EM'].media_lp?.toFixed(1)}</span></div>
          <div class="info-row"><span class="info-label">EM MT</span><span class="info-value">${md['EM'].media_mt?.toFixed(1)}</span></div>` : ''}`;
      };
      info.addTo(S.map);

      // Determine CRE bounds for zoom
      let creBounds = null;

      S.mapLayer = L.geoJSON(S.geo, {
        style: feature => {
          const cod = feature.properties.cod_mun?.substring(0, 7);
          const md = munData[cod];
          const v = md?.[mapEtapa]?.[field] || 0;
          // Dim municipalities outside selected CRE
          const inCre = !S.creSel || (S.creLookup?.mun_to_cre?.[cod]?.cod_cre === S.creSel);
          return { fillColor: v > 0 ? getColor(v) : '#f0f0f0', weight: 0.8, opacity: 1, color: '#fff', fillOpacity: inCre ? 0.85 : 0.2 };
        },
        onEachFeature: (feature, layer) => {
          const cod = feature.properties.cod_mun?.substring(0, 7);
          const md = munData[cod];
          const inCre = !S.creSel || (S.creLookup?.mun_to_cre?.[cod]?.cod_cre === S.creSel);
          if (inCre && creBounds === null && S.creSel) creBounds = layer.getBounds();
          else if (inCre && S.creSel) creBounds.extend(layer.getBounds());
          layer.on({
            mouseover: e => { e.target.setStyle({ weight: 2.5, color: '#FFB300', fillOpacity: 0.95 }); e.target.bringToFront(); info.update(feature.properties, md); },
            mouseout: e => { S.mapLayer.resetStyle(e.target); e.target.closeTooltip(); info.update(); },
            click: () => { S.munSel = S.munSel === cod ? null : cod; refreshActiveTab(); }
          });
        }
      }).addTo(S.map);

      // Legend
      const legend = L.control({ position: 'bottomleft' });
      const etLabel = SAEB_BREAK_LABELS[mapEtapa] || mapEtapa;
      const discLabel = SAEB_DISC_LABELS[mapDisc] || mapDisc.toUpperCase();
      legend.onAdd = function () {
        const div = L.DomUtil.create('div', 'map-legend');
        div.innerHTML = `<h4>SAEB ${etLabel} ${discLabel}</h4>` +
          breaks.slice().reverse().map(b =>
            `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${b.color}"></div><span>${b.label}</span></div>`
          ).join('') + '<div class="map-legend-row" style="margin-top:4px"><div class="map-legend-swatch" style="background:#f0f0f0"></div><span>Sem dados</span></div>';
        return div;
      };
      legend.addTo(S.map);

      // Zoom to CRE if selected
      if (S.creSel && creBounds) {
        S.map.fitBounds(creBounds, { padding: [30, 30] });
      } else if (S.mapLayer) {
        S.map.fitBounds(S.mapLayer.getBounds(), { padding: [20, 20] });
      }

      // Update title
      const mt = document.getElementById('saeb-map-title');
      if (mt) mt.textContent = `Mapa SAEB por Município — ${etLabel} ${discLabel} (${mapAno})`;
    }

    // Build/update CRE map for SAEB
    function updateSaebCreMap() {
      if (!S.creGeo || !S.map) return;
      if (S.mapLayer) { S.map.removeLayer(S.mapLayer); S.mapLayer = null; }
      // Remove legend controls
      S.map.eachLayer(l => { if (l._container?.classList?.contains('map-legend')) S.map.removeControl(l); });

      const munData = porMun[mapAno] || {};
      const munToCre = S.creLookup?.mun_to_cre || {};
      const breakKey = `${mapEtapa}_${mapDisc}`;
      const breaks = SAEB_BREAKS[breakKey] || SAEB_BREAKS['9EF_lp'];
      const field = `media_${mapDisc}`;

      // Aggregate by CRE
      const creData = {};
      for (const [cod, v] of Object.entries(munData)) {
        const cre = munToCre[cod]?.cod_cre;
        if (!cre) continue;
        if (!creData[cre]) creData[cre] = { sumVal: 0, count: 0, nome: munToCre[cod]?.nome_cre || cre };
        const val = v?.[mapEtapa]?.[field];
        if (val != null) { creData[cre].sumVal += val; creData[cre].count += 1; }
      }
      for (const c of Object.values(creData)) c.avg = c.count > 0 ? c.sumVal / c.count : null;

      function getColor(v) {
        if (v == null || v === 0) return '#f0f0f0';
        for (const b of breaks) { if (v >= b.min && v < b.max) return b.color; }
        return '#f0f0f0';
      }

      // Remove old legend
      S.map.eachLayer(l => { try { if (l.getContainer?.()?.classList?.contains('map-legend')) S.map.removeControl(l); } catch(e) {} });

      S.mapLayer = L.geoJSON(S.creGeo, {
        style: feature => {
          const cod = feature.properties.cod_cre;
          const v = creData[cod]?.avg;
          return { fillColor: getColor(v), fillOpacity: 0.8, weight: 2, color: '#fff' };
        },
        onEachFeature: (feature, layer) => {
          const cod = feature.properties.cod_cre;
          const nome = feature.properties.nome_cre || cod;
          const d = creData[cod];
          const etLabel = SAEB_BREAK_LABELS[mapEtapa] || mapEtapa;
          const discLabel = SAEB_DISC_LABELS[mapDisc] || mapDisc.toUpperCase();
          layer.bindTooltip(`<strong>${nome}</strong><br>${etLabel} ${discLabel}: ${d?.avg != null ? d.avg.toFixed(1) : '—'}<br>${d?.count || 0} municípios`, { sticky: true });
          layer.on('click', () => { S.creSel = cod; const selCre = document.getElementById('sel-cre'); if (selCre) selCre.value = cod; populateMunDropdown(cod); refreshActiveTab(); });
        }
      }).addTo(S.map);

      const etLabel = SAEB_BREAK_LABELS[mapEtapa] || mapEtapa;
      const discLabel = SAEB_DISC_LABELS[mapDisc] || mapDisc.toUpperCase();
      const legend = L.control({ position: 'bottomleft' });
      legend.onAdd = function () {
        const div = L.DomUtil.create('div', 'map-legend');
        div.innerHTML = `<h4>SAEB ${etLabel} ${discLabel} (CREs)</h4>` +
          breaks.slice().reverse().map(b => `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${b.color}"></div><span>${b.label}</span></div>`).join('');
        return div;
      };
      legend.addTo(S.map);
      S.mapLegend = legend;
      if (S.mapLayer) S.map.fitBounds(S.mapLayer.getBounds(), { padding: [20, 20] });

      const mt = document.getElementById('saeb-map-title');
      if (mt) mt.textContent = `Mapa SAEB por CRE — ${etLabel} ${discLabel} (${mapAno})`;
    }

    updateSaebTable();
    updateSaebMap();

    // Helper to update map based on active layer
    const updateSaebActiveMap = () => {
      const saebBtnCre = document.getElementById('saeb-btn-layer-cre');
      if (saebBtnCre?.classList.contains('active')) { updateSaebCreMap(); } else { updateSaebMap(); }
    };

    // Bind map filter selectors
    document.getElementById('sel-saeb-map-ano')?.addEventListener('change', e => { mapAno = e.target.value; updateSaebTable(); updateSaebActiveMap(); });
    document.getElementById('sel-saeb-map-etapa')?.addEventListener('change', e => { mapEtapa = e.target.value; updateSaebActiveMap(); });
    document.getElementById('sel-saeb-map-disc')?.addEventListener('change', e => { mapDisc = e.target.value; updateSaebActiveMap(); });

    // Bind CRE toggle
    const saebBtnMun = document.getElementById('saeb-btn-layer-mun');
    const saebBtnCre = document.getElementById('saeb-btn-layer-cre');
    if (saebBtnMun && saebBtnCre) {
      saebBtnMun.addEventListener('click', () => {
        saebBtnMun.classList.add('active'); saebBtnCre.classList.remove('active');
        updateSaebMap();
      });
      saebBtnCre.addEventListener('click', () => {
        saebBtnCre.classList.add('active'); saebBtnMun.classList.remove('active');
        updateSaebCreMap();
      });
    }

    // Bind search
    document.getElementById('saeb-mun-search')?.addEventListener('input', e => {
      const q = e.target.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      document.querySelectorAll('#saeb-mun-table tbody tr').forEach(tr => {
        const nome = (tr.children[1]?.textContent || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        tr.style.display = nome.includes(q) ? '' : 'none';
      });
    });
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
// ══════════════════════════════════════════════════════════
// IDEB
// ══════════════════════════════════════════════════════════

const IDEB_BREAKS = [
  { min: 7.0, max: 99,  color: '#1B5E20', label: '≥ 7,0 (Excelente)' },
  { min: 6.0, max: 7.0, color: '#43A047', label: '6,0–6,9 (Bom)' },
  { min: 5.0, max: 6.0, color: '#FFCB04', label: '5,0–5,9 (Regular)' },
  { min: 4.0, max: 5.0, color: '#FB8C00', label: '4,0–4,9 (Alerta)' },
  { min: 0,   max: 4.0, color: '#E53935', label: '< 4,0 (Crítico)' },
];

function getIdebColor(v) {
  if (v == null || v === 0) return '#f0f0f0';
  if (v >= 7.0) return '#1B5E20';
  if (v >= 6.0) return '#43A047';
  if (v >= 5.0) return '#FFCB04';
  if (v >= 4.0) return '#FB8C00';
  return '#E53935';
}

function renderIdeb() {
  const ideb = S.ideb;
  const main = document.getElementById('main-content');
  destroyCharts();
  destroyMap();

  // Guard: no IDEB data for this rede
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
  const lookup = ideb.lookup_municipios || {};
  S.idebEtapa = S.idebEtapa || 'AI';

  // ── Geo-aware helper ──
  const getGeoData = (ano) => {
    if (S.munSel && ideb.por_municipio?.[ano]?.[S.munSel]) {
      return ideb.por_municipio[ano][S.munSel];
    }
    if (S.creSel) {
      const creMuns = getCreMuns(S.creSel);
      const munYear = ideb.por_municipio?.[ano] || {};
      const agg = {};
      for (const et of ['AI', 'AF', 'EM']) {
        let sumIdeb = 0, sumEsc = 0;
        for (const cod of creMuns) {
          const m = munYear[cod]?.[et];
          if (m && m.ideb != null) {
            sumIdeb += m.ideb * (m.n_escolas || 1);
            sumEsc += m.n_escolas || 1;
          }
        }
        if (sumEsc > 0) agg[et] = { ideb: +(sumIdeb / sumEsc).toFixed(2), n_escolas: sumEsc };
      }
      return Object.keys(agg).length ? agg : null;
    }
    return ideb.serie_temporal[ano];
  };

  // ── Geo label ──
  let geoLabel = getRedeLabel() + ' do RS';
  const isStateLevel = !S.munSel && !S.creSel;
  if (S.munSel && lookup[S.munSel]) geoLabel = lookup[S.munSel];
  else if (S.creSel) {
    const creObj = S.creLookup?.cre_list?.find(c => c.cod_cre === S.creSel);
    geoLabel = creObj ? creObj.nome_cre : `CRE ${S.creSel}`;
  }

  // ── Year selection (anoSel) ──
  const anoSel = anos.includes(S.anoSel) ? S.anoSel : ultimo;
  const anoIdx = anos.indexOf(anoSel);
  const penultimo = anoIdx > 0 ? anos[anoIdx - 1] : null;

  const lastData = getGeoData(anoSel) || {};
  const prevData = penultimo ? (getGeoData(penultimo) || {}) : {};

  // ── KPIs ──
  const etapaMap = {
    AI: { label: 'Anos Iniciais', icon: 'img/icons/fundamental.png', accent: 'green' },
    AF: { label: 'Anos Finais', icon: 'img/icons/fundamental.png', accent: 'blue' },
    EM: { label: 'Ensino Médio', icon: 'img/icons/medio.png', accent: 'red' },
  };
  const idebEtapas = ['AI', 'AF', 'EM'];
  const idebLabels = ['Anos Iniciais', 'Anos Finais', 'Ens. Médio'];
  const idebCores = [COLORS.pri, '#1565C0', COLORS.red];

  const kpis = [];
  for (const [ek, cfg] of Object.entries(etapaMap)) {
    const d = lastData[ek];
    if (!d) continue;
    const p = prevData[ek];
    const delta = p ? +(d.ideb - p.ideb).toFixed(2) : null;
    // Sparkline
    const sparkVals = anos.map(a => getGeoData(a)?.[ek]?.ideb ?? null).filter(v => v != null);
    const sparkMax = sparkVals.length ? Math.max(...sparkVals) : 1;
    const sparkMin = sparkVals.length ? Math.min(...sparkVals) : 0;
    const sparkRange = sparkMax - sparkMin || 1;
    const sparkColor = cfg.accent === 'green' ? COLORS.pri : cfg.accent === 'blue' ? '#1565C0' : COLORS.red;
    const sparkPts = sparkVals.map((v, j) => `${(j / Math.max(sparkVals.length - 1, 1)) * 58 + 1},${23 - ((v - sparkMin) / sparkRange) * 20}`).join(' ');
    const sparkline = sparkVals.length >= 2 ? `<svg class="kpi-sparkline" viewBox="0 0 60 24" width="60" height="24"><polyline points="${sparkPts}" fill="none" stroke="${sparkColor}" stroke-width="1.5" stroke-linecap="round"/></svg>` : '';
    kpis.push({
      label: `IDEB ${cfg.label}`, val: d.ideb?.toFixed(1), accent: cfg.accent, icon: cfg.icon, sparkline,
      sub: delta !== null ? `${delta >= 0 ? '+' : ''}${delta} vs ${penultimo}` : `${d.n_escolas || 0} escolas`,
    });
  }

  // ── Example calculation from state-level data ──
  const stLast = ideb.serie_temporal[ultimo] || {};
  const exAI = stLast.AI;
  const exEM = stLast.EM;

  // ════════════════════════════════════════════════════════════════
  //  HTML TEMPLATE
  // ════════════════════════════════════════════════════════════════
  main.innerHTML = `
    <div class="section-sticky">
      ${sectionBanner('img/icons/nav_ideb.png', 'IDEB', geoLabel)}
      ${redeToggleHTML()}
      <div class="kpi-strip" id="ideb-kpis" style="grid-template-columns:repeat(3,1fr)"></div>
    </div>

    <!-- ═══ BLOCO INFORMATIVO: O que é o IDEB? ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/nav_ideb.png" alt=""></span>
      <span class="section-divider-text">O que é o IDEB?</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="chart-card" style="padding:0;overflow:hidden;border:1px solid rgba(0,90,50,.08)">
      <div style="display:grid;grid-template-columns:1fr 1fr">
        <div style="padding:20px 24px;background:linear-gradient(135deg,#f8fdf9 0%,#eef6f0 100%)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
            <img src="img/icons/nav_ideb.png" alt="" style="width:20px;height:20px">
            <span style="font-size:14px;font-weight:700;color:var(--pri)">Definição</span>
          </div>
          <p style="font-size:11.5px;margin:0 0 16px;color:#333;line-height:1.75">
            O <strong>IDEB (Índice de Desenvolvimento da Educação Básica)</strong> é o principal indicador
            de qualidade da educação brasileira, calculado pelo INEP a cada 2 anos. Combina informações de
            <strong>desempenho em provas padronizadas</strong> (SAEB) com <strong>fluxo escolar</strong> (aprovação).
          </p>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <img src="img/icons/sec_saeb.png" alt="" style="width:20px;height:20px">
            <span style="font-size:14px;font-weight:700;color:var(--pri)">Componentes</span>
          </div>
          <p style="font-size:11.5px;margin:0 0 8px;color:#333;line-height:1.75">
            <strong>IDEB = N × P</strong>, onde:
          </p>
          <ul style="font-size:11px;margin:0 0 14px;padding-left:18px;color:#444;line-height:1.8">
            <li><strong>N (Nota SAEB padronizada)</strong> — Média das proficiências em Língua Portuguesa e
            Matemática do SAEB, padronizada na escala <strong>0 a 10</strong>.</li>
            <li><strong>P (Indicador de Rendimento)</strong> — Taxa de aprovação média da etapa de ensino,
            variando de <strong>0 a 1</strong>. Quanto maior a aprovação, maior o P.</li>
          </ul>
          ${exAI ? `
          <div style="background:rgba(0,171,78,.08);border:1px solid rgba(0,171,78,.2);border-radius:6px;padding:10px 14px">
            <p style="font-size:11px;margin:0 0 6px;color:#1B5E20;font-weight:700">Exemplo de Cálculo — Rede Estadual RS (${ultimo})</p>
            <p style="font-size:10.5px;margin:0 0 4px;color:#333;line-height:1.7">
              <strong>Anos Iniciais:</strong> N = ${exAI.nota_saeb?.toFixed(2)} · P = ${exAI.rendimento?.toFixed(3)}
              → IDEB = ${exAI.nota_saeb?.toFixed(2)} × ${exAI.rendimento?.toFixed(3)} = <strong>${(exAI.nota_saeb * exAI.rendimento).toFixed(2)}</strong> ≈ ${exAI.ideb?.toFixed(1)}
            </p>
            ${exEM ? `<p style="font-size:10.5px;margin:0;color:#333;line-height:1.7">
              <strong>Ens. Médio:</strong> N = ${exEM.nota_saeb?.toFixed(2)} · P = ${exEM.rendimento?.toFixed(3)}
              → IDEB = ${exEM.nota_saeb?.toFixed(2)} × ${exEM.rendimento?.toFixed(3)} = <strong>${(exEM.nota_saeb * exEM.rendimento).toFixed(2)}</strong> ≈ ${exEM.ideb?.toFixed(1)}
            </p>` : ''}
          </div>` : ''}
          <p style="font-size:10px;margin:10px 0 0;color:#888;line-height:1.6">
            Até 2015, o SAEB era composto pela <em>ANEB</em> (amostral) e <em>Prova Brasil</em> (censitária, EF).
            A partir de 2017 (<em>Portaria INEP nº 447/2017</em>), o SAEB tornou-se censitário também para o EM.
          </p>
          <p style="font-size:10px;margin:6px 0 0;color:#888;line-height:1.6">
            <strong style="color:#666">Rede Privada:</strong> O IDEB do Ensino Fundamental (AI e AF) é calculado
            exclusivamente para escolas <strong>públicas</strong>, pois a Prova Brasil/SAEB censitário abrange
            apenas a rede pública no EF. Escolas privadas possuem IDEB somente para o
            <strong>Ensino Médio</strong> (a partir de 2017).
          </p>
        </div>
        <div style="padding:20px 24px;border-left:1px solid rgba(0,90,50,.06)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
            <img src="img/icons/panorama.png" alt="" style="width:20px;height:20px">
            <span style="font-size:14px;font-weight:700;color:var(--pri)">Escala e Referências</span>
          </div>
          <table style="width:100%;font-size:11px;border-collapse:separate;border-spacing:0">
            <thead>
              <tr>
                <th style="padding:6px 8px;text-align:left;background:#f0f4f8;border-bottom:2px solid #ddd;font-weight:700;color:#333">Faixa</th>
                <th style="padding:6px 8px;text-align:left;background:#f0f4f8;border-bottom:2px solid #ddd;font-weight:700;color:#333">Classificação</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style="padding:5px 8px;border-bottom:1px solid #eee"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#1B5E20;vertical-align:middle;margin-right:6px"></span>≥ 7,0</td><td style="padding:5px 8px;border-bottom:1px solid #eee">Excelente</td></tr>
              <tr style="background:#fafbfc"><td style="padding:5px 8px;border-bottom:1px solid #eee"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#43A047;vertical-align:middle;margin-right:6px"></span>6,0 – 6,9</td><td style="padding:5px 8px;border-bottom:1px solid #eee">Bom</td></tr>
              <tr><td style="padding:5px 8px;border-bottom:1px solid #eee"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#FFCB04;vertical-align:middle;margin-right:6px"></span>5,0 – 5,9</td><td style="padding:5px 8px;border-bottom:1px solid #eee">Regular</td></tr>
              <tr style="background:#fafbfc"><td style="padding:5px 8px;border-bottom:1px solid #eee"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#FB8C00;vertical-align:middle;margin-right:6px"></span>4,0 – 4,9</td><td style="padding:5px 8px;border-bottom:1px solid #eee">Alerta</td></tr>
              <tr><td style="padding:5px 8px"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#E53935;vertical-align:middle;margin-right:6px"></span>< 4,0</td><td style="padding:5px 8px">Crítico</td></tr>
            </tbody>
          </table>
          <p style="font-size:9px;margin:8px 0 0;color:#999;line-height:1.5;font-style:italic">
            * Classificação adotada para fins de visualização — não corresponde a faixas oficiais do INEP.
          </p>
          <div style="margin-top:14px;background:rgba(21,101,192,.06);border:1px solid rgba(21,101,192,.15);border-radius:6px;padding:10px 14px">
            <p style="font-size:11px;margin:0;color:#0D47A1;line-height:1.7">
              <strong>Metas do PNE (Plano Nacional de Educação):</strong><br>
              Anos Iniciais: <strong>6,0</strong> · Anos Finais: <strong>5,5</strong> · Ensino Médio: <strong>5,2</strong>
            </p>
          </div>
          <div style="margin-top:10px;background:rgba(255,203,4,.08);border:1px solid rgba(255,203,4,.18);border-radius:6px;padding:10px 14px">
            <p style="font-size:10.5px;margin:0;color:#5D4037;line-height:1.7">
              <strong>Linha tracejada</strong> nos gráficos = <strong>meta projetada</strong> pelo MEC para cada edição.
            </p>
          </div>
          <p style="font-size:9px;margin:10px 0 0;color:#999;line-height:1.5;font-style:italic">
            Fontes: INEP — Nota Técnica do IDEB; PNE — Lei nº 13.005/2014, art. 1º, Anexo (Meta 7).
          </p>
        </div>
      </div>
    </div>

    <!-- ═══ EIXO: Evolução ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/sec_evolucao.png" alt=""></span>
      <span class="section-divider-text">IDEB — Evolução por Etapa (${anos[0]}–${ultimo})</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title">IDEB Observado × Meta Projetada — ${geoLabel}</div>
        <div style="height:360px"><canvas id="chart-ideb-evolucao"></canvas></div>
        <div class="chart-source">${FONTE_IDEB}</div>
      </div>
    </div>

    ${isStateLevel ? `
    <!-- ═══ EIXO: Decomposição N × P ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/sec_saeb.png" alt=""></span>
      <span class="section-divider-text">Decomposição — Nota SAEB (N) × Aprovação (P)</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title">Anos Iniciais</div>
        <div style="height:280px"><canvas id="chart-decomp-ai"></canvas></div>
        <div class="chart-source">${FONTE_IDEB}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Anos Finais</div>
        <div style="height:280px"><canvas id="chart-decomp-af"></canvas></div>
        <div class="chart-source">${FONTE_IDEB}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Ensino Médio</div>
        <div style="height:280px"><canvas id="chart-decomp-em"></canvas></div>
        <div class="chart-source">${FONTE_IDEB}</div>
      </div>
    </div>
    ` : ''}

    <!-- ═══ EIXO: Distribuição Territorial ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/territorial.png" alt=""></span>
      <span class="section-divider-text">Distribuição Territorial — ${anoSel}</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="map-table-row d1">
      <div class="map-container">
        <div class="map-toolbar">
          <h3>Mapa — IDEB <span id="ideb-map-ano">${anoSel}</span></h3>
          <div class="map-layer-toggle">
            <button class="map-layer-btn active" id="ideb-btn-layer-mun">Municípios</button>
            <button class="map-layer-btn" id="ideb-btn-layer-cre">CREs</button>
          </div>
          <select id="sel-ideb-map-etapa" style="font-size:11px;padding:3px 8px;border-radius:4px;border:1px solid #ccc">
            <option value="AI" ${S.idebEtapa === 'AI' ? 'selected' : ''}>Anos Iniciais</option>
            <option value="AF" ${S.idebEtapa === 'AF' ? 'selected' : ''}>Anos Finais</option>
            <option value="EM" ${S.idebEtapa === 'EM' ? 'selected' : ''}>Ensino Médio</option>
          </select>
        </div>
        <div style="font-size:9.5px;color:#888;padding:4px 0 2px;line-height:1.4;font-style:italic">Municípios sem escolas na etapa selecionada aparecem em cinza. Alterne a etapa acima para visualizar outros níveis.</div>
        <div id="ideb-map-leaflet" style="height:370px;border-radius:8px"></div>
      </div>
      <div class="table-wrapper" id="ideb-table-wrapper">
        <div class="table-header">
          <h3>Tabela de Municípios — IDEB ${anoSel}</h3>
          <input type="text" class="table-search" id="ideb-mun-search" placeholder="Buscar...">
        </div>
        <div style="font-size:10px;color:var(--accent);padding:4px 12px 6px;font-weight:600;background:rgba(255,203,4,.08);border-radius:0 0 6px 6px;border-top:1px dashed rgba(255,203,4,.3)">
          📍 Clique em qualquer município — na tabela ou no mapa — para filtrar <strong>todas as visualizações</strong> desta seção (KPIs, gráficos e recortes). Clique novamente para desfiltrar.
        </div>
        <div style="max-height:400px;overflow-y:auto">
          <table class="data-table" id="ideb-mun-table">
            <thead><tr>
              <th>#</th><th>Município</th>
              <th>AI</th><th>AF</th><th>EM</th>
            </tr></thead>
            <tbody></tbody>
          </table>
        </div>
        <div class="chart-source">${FONTE_IDEB}</div>
      </div>
    </div>
  `;

  // ════════════════════════════════════════════════════════════════
  //  BUILD KPIs
  // ════════════════════════════════════════════════════════════════
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
          ${k.sparkline}
        </div>
        <div class="kpi-footer">
          <span class="kpi-delta ${cls}">${k.sub || ''}</span>
          <span class="kpi-abs">${anoSel}</span>
        </div>
      </div>`;
    }).join('');
  }

  // ════════════════════════════════════════════════════════════════
  //  CHART 1: Evolution with projected targets (full-width, 360px)
  // ════════════════════════════════════════════════════════════════
  const elEvo = document.getElementById('chart-ideb-evolucao');
  if (elEvo) {
    const datasets = [];
    idebEtapas.forEach((et, etIdx) => {
      const dataObs = anos.map(a => getGeoData(a)?.[et]?.ideb ?? null);
      datasets.push({
        label: idebLabels[etIdx], data: dataObs, _isMeta: false, _etIdx: etIdx,
        borderColor: idebCores[etIdx], backgroundColor: idebCores[etIdx] + '18',
        borderWidth: 2.5, pointRadius: 5, pointBackgroundColor: '#fff', pointBorderWidth: 2,
        tension: .3, spanGaps: true,
      });
      // Metas only at state level
      if (isStateLevel) {
        const dataMeta = anos.map(a => ideb.serie_temporal[a]?.[et]?.meta ?? null);
        if (dataMeta.some(v => v != null)) {
          datasets.push({
            label: `Meta ${idebLabels[etIdx]}`, data: dataMeta, _isMeta: true, _etIdx: etIdx,
            borderColor: idebCores[etIdx] + '55', borderWidth: 1.5, borderDash: [6, 4],
            pointRadius: 2, pointBackgroundColor: idebCores[etIdx] + '55', tension: .3, spanGaps: true,
          });
        }
      }
    });
    S.charts.push(new Chart(elEvo, {
      type: 'line',
      data: { labels: anos, datasets },
      options: {
        ...CHART_DEFAULTS, layout: { padding: { top: 25 } },
        plugins: {
          ...CHART_DEFAULTS.plugins,
          legend: {
            display: true, position: 'bottom',
            labels: { font: { family: 'Inter', size: 11, weight: '600' }, boxWidth: 12, padding: 10, usePointStyle: true },
          },
          datalabels: {
            display: ctx => !ctx.dataset._isMeta,
            anchor: ctx => ctx.dataset._etIdx === 2 ? 'start' : 'end',
            align: ctx => ctx.dataset._etIdx === 2 ? 'bottom' : 'top',
            offset: 4,
            font: { family: 'Inter', size: 10, weight: '700' },
            color: ctx => idebCores[ctx.dataset._etIdx] || '#999',
            formatter: v => v?.toFixed(1) ?? '',
          },
        },
        scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: false, min: 2, suggestedMax: 8 } },
      },
    }));
  }

  // ════════════════════════════════════════════════════════════════
  //  CHARTS 2-4: Decomposition N × P (3 separate cards, dual axis)
  // ════════════════════════════════════════════════════════════════
  if (isStateLevel) {
    const decompIds = ['chart-decomp-ai', 'chart-decomp-af', 'chart-decomp-em'];
    idebEtapas.forEach((et, etIdx) => {
      const el = document.getElementById(decompIds[etIdx]);
      if (!el) return;
      const anosEt = anos.filter(a => ideb.serie_temporal[a]?.[et]?.nota_saeb != null);
      if (anosEt.length === 0) return;

      const dataN = anosEt.map(a => ideb.serie_temporal[a][et].nota_saeb);
      const dataP = anosEt.map(a => +(ideb.serie_temporal[a][et].rendimento * 100).toFixed(1));

      S.charts.push(new Chart(el, {
        type: 'bar',
        data: {
          labels: anosEt,
          datasets: [
            {
              type: 'bar', label: 'Nota SAEB (N)', data: dataN, yAxisID: 'yN',
              backgroundColor: idebCores[etIdx] + 'AA', borderColor: idebCores[etIdx],
              borderWidth: 1.5, borderRadius: 4, barPercentage: .65, categoryPercentage: .8,
            },
            {
              type: 'line', label: 'Aprovação (P%)', data: dataP, yAxisID: 'yP',
              borderColor: idebCores[etIdx] + '88', borderWidth: 2, borderDash: [5, 3],
              pointRadius: 3, pointBackgroundColor: '#fff', pointBorderWidth: 2,
              tension: 0.3, fill: false,
            }
          ]
        },
        options: {
          ...CHART_DEFAULTS,
          layout: { padding: { top: 20 } },
          plugins: {
            ...CHART_DEFAULTS.plugins,
            legend: { display: true, labels: { font: { family: 'Inter', size: 10, weight: '600' }, boxWidth: 10, padding: 6 } },
            datalabels: {
              display: ctx => ctx.datasetIndex === 0,
              anchor: 'end', align: 'end', offset: 2,
              font: { family: 'Inter', size: 9, weight: '700' },
              color: idebCores[etIdx],
              formatter: v => v?.toFixed(1) ?? '',
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { font: { family: 'Inter', size: 9 } } },
            yN: {
              type: 'linear', position: 'left', min: 3, max: 8, grace: '5%',
              title: { display: true, text: 'Nota SAEB (N)', font: { family: 'Inter', size: 9 }, color: '#666' },
              grid: { color: COLORS.gridLine }, ticks: { font: { family: 'Inter', size: 9 } },
            },
            yP: {
              type: 'linear', position: 'right', min: 75, max: 100,
              title: { display: true, text: 'Aprovação (%)', font: { family: 'Inter', size: 9 }, color: '#666' },
              grid: { drawOnChartArea: false }, ticks: { font: { family: 'Inter', size: 9 }, callback: v => v + '%' },
            },
          },
        },
      }));
    });
  }

  // ════════════════════════════════════════════════════════════════
  //  MAP: IDEB by municipality (choropleth)
  // ════════════════════════════════════════════════════════════════
  const idebBuildMap = () => {
    if (!S.geo) return;
    const mapEl = document.getElementById('ideb-map-leaflet');
    if (!mapEl) return;

    const munData = ideb.por_municipio?.[anoSel] || {};
    const mapEtapa = S.idebEtapa || 'AI';

    destroyMap();
    S.map = L.map('ideb-map-leaflet', { zoomControl: true, scrollWheelZoom: true, attributionControl: false })
      .setView([-29.7, -53.5], 6.5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', { maxZoom: 14 }).addTo(S.map);

    const info = L.control({ position: 'topright' });
    info.onAdd = function () { this._div = L.DomUtil.create('div', 'map-info-panel'); this.update(); return this._div; };
    info.update = function (props, md) {
      if (!props) { this._div.innerHTML = '<h4>Passe o mouse sobre um município</h4>'; return; }
      const nome = props.nome || props.cod_mun;
      if (!md) { this._div.innerHTML = `<h4>${nome}</h4><div style="color:#999;font-size:11px">Sem dados IDEB</div>`; return; }
      this._div.innerHTML = `
        <h4>${nome}</h4>
        ${md.AI ? `<div class="info-row"><span class="info-label">IDEB Anos Iniciais</span><span class="info-value" style="color:${getIdebColor(md.AI.ideb)};font-weight:700">${md.AI.ideb?.toFixed(1)}</span></div>` : ''}
        ${md.AF ? `<div class="info-row"><span class="info-label">IDEB Anos Finais</span><span class="info-value" style="color:${getIdebColor(md.AF.ideb)};font-weight:700">${md.AF.ideb?.toFixed(1)}</span></div>` : ''}
        ${md.EM ? `<div class="info-row"><span class="info-label">IDEB EM</span><span class="info-value" style="color:${getIdebColor(md.EM.ideb)};font-weight:700">${md.EM.ideb?.toFixed(1)}</span></div>` : ''}`;
    };
    info.addTo(S.map);

    S.mapLayer = L.geoJSON(S.geo, {
      style: feature => {
        const cod = feature.properties.cod_mun?.substring(0, 7);
        const md = munData[cod];
        const v = md?.[mapEtapa]?.ideb || 0;
        return { fillColor: v > 0 ? getIdebColor(v) : '#f0f0f0', weight: 0.8, opacity: 1, color: '#fff', fillOpacity: 0.85 };
      },
      onEachFeature: (feature, layer) => {
        const cod = feature.properties.cod_mun?.substring(0, 7);
        const md = munData[cod];
        layer.on({
          mouseover: e => { e.target.setStyle({ weight: 2.5, color: '#FFB300', fillOpacity: 0.95 }); e.target.bringToFront(); info.update(feature.properties, md); },
          mouseout: e => { S.mapLayer.resetStyle(e.target); e.target.closeTooltip(); info.update(); },
          click: () => { S.munSel = S.munSel === cod ? null : cod; refreshActiveTab(); }
        });
      }
    }).addTo(S.map);

    const legend = L.control({ position: 'bottomleft' });
    legend.onAdd = function () {
      const div = L.DomUtil.create('div', 'map-legend');
      div.innerHTML = '<h4>IDEB ' + mapEtapa + '</h4>' +
        IDEB_BREAKS.map(b =>
          `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${b.color}"></div><span>${b.label}</span></div>`
        ).join('') + '<div class="map-legend-row" style="margin-top:4px"><div class="map-legend-swatch" style="background:#f0f0f0"></div><span>Sem dados</span></div>';
      return div;
    };
    legend.addTo(S.map);
    S.mapLegend = legend;
    if (S.mapLayer) S.map.fitBounds(S.mapLayer.getBounds(), { padding: [20, 20] });
  };

  // ── CRE layer for IDEB map ──
  const idebBuildCreMap = () => {
    if (!S.creGeo || !S.map) return;
    if (S.mapLayer) { S.mapLayer.remove(); S.mapLayer = null; }
    if (S.mapLegend) { S.mapLegend.remove(); S.mapLegend = null; }

    const munToCre = S.creLookup?.mun_to_cre || {};
    const munData = ideb.por_municipio?.[anoSel] || {};
    const mapEtapa = S.idebEtapa || 'AI';

    const creData = {};
    for (const [cod, v] of Object.entries(munData)) {
      const cre = munToCre[cod]?.cod_cre;
      if (!cre) continue;
      if (!creData[cre]) creData[cre] = { sum: 0, totalEsc: 0, nome: munToCre[cod]?.nome_cre || cre };
      const etData = v?.[mapEtapa];
      if (etData?.ideb && etData?.n_escolas) {
        creData[cre].sum += etData.ideb * etData.n_escolas;
        creData[cre].totalEsc += etData.n_escolas;
      }
    }
    for (const c of Object.values(creData)) c.avg = c.totalEsc > 0 ? c.sum / c.totalEsc : 0;

    S.mapLayer = L.geoJSON(S.creGeo, {
      style: feature => {
        const cod = feature.properties.cod_cre;
        const avg = creData[cod]?.avg || 0;
        return { fillColor: avg > 0 ? getIdebColor(avg) : '#f0f0f0', weight: 2, color: '#fff', fillOpacity: 0.8 };
      },
      onEachFeature: (feature, layer) => {
        const cod = feature.properties.cod_cre;
        const nome = feature.properties.nome_cre || cod;
        const d = creData[cod];
        layer.bindTooltip(`<strong>${nome}</strong><br>IDEB ${mapEtapa}: ${d?.avg?.toFixed(1) ?? '—'}<br>${d?.totalEsc || 0} escolas`, { sticky: true });
        layer.on('click', () => { S.creSel = cod; const selCre = document.getElementById('sel-cre'); if (selCre) selCre.value = cod; populateMunDropdown(cod); refreshActiveTab(); });
      }
    }).addTo(S.map);

    const creLegend = L.control({ position: 'bottomleft' });
    creLegend.onAdd = function () {
      const div = L.DomUtil.create('div', 'map-legend');
      div.innerHTML = '<h4>IDEB ' + mapEtapa + ' (CREs)</h4>' +
        IDEB_BREAKS.map(b => `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${b.color}"></div><span>${b.label}</span></div>`).join('');
      return div;
    };
    creLegend.addTo(S.map);
    S.mapLegend = creLegend;
  };

  // ════════════════════════════════════════════════════════════════
  //  TABLE: Municipality ranking
  // ════════════════════════════════════════════════════════════════
  const idebBuildMunTable = () => {
    const tbody = document.querySelector('#ideb-mun-table tbody');
    if (!tbody) return;
    const munData = ideb.por_municipio?.[anoSel] || {};

    let entries = Object.entries(munData);
    if (S.creSel && S.creLookup?.mun_to_cre) {
      entries = entries.filter(([cod]) => S.creLookup.mun_to_cre[cod]?.cod_cre === S.creSel);
    }
    if (S.munSel) {
      entries = entries.filter(([cod]) => cod === S.munSel);
    }
    // Sort by AI IDEB descending (fallback to AF, then EM)
    entries.sort((a, b) => (b[1]?.AI?.ideb || b[1]?.AF?.ideb || b[1]?.EM?.ideb || 0) - (a[1]?.AI?.ideb || a[1]?.AF?.ideb || a[1]?.EM?.ideb || 0));

    const colorCell = v => {
      if (v == null) return '<td style="color:#ccc">—</td>';
      return `<td><strong style="color:${getIdebColor(v)}">${v.toFixed(1)}</strong></td>`;
    };

    tbody.innerHTML = entries.map(([cod, md], i) => `
      <tr style="cursor:pointer" data-cod="${cod}">
        <td>${i + 1}</td>
        <td>${lookup[cod] || cod}</td>
        ${colorCell(md.AI?.ideb)}
        ${colorCell(md.AF?.ideb)}
        ${colorCell(md.EM?.ideb)}
      </tr>`).join('');

    // Click to filter
    tbody.querySelectorAll('tr[data-cod]').forEach(tr => {
      tr.addEventListener('click', () => {
        S.munSel = S.munSel === tr.dataset.cod ? null : tr.dataset.cod;
        refreshActiveTab();
      });
    });

    // Search
    document.getElementById('ideb-mun-search')?.addEventListener('input', e => {
      const q = e.target.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      tbody.querySelectorAll('tr').forEach(tr => {
        const nome = (tr.children[1]?.textContent || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        tr.style.display = nome.includes(q) ? '' : 'none';
      });
    });
  };

  // ════════════════════════════════════════════════════════════════
  //  BUILD ALL + BIND CONTROLS
  // ════════════════════════════════════════════════════════════════
  idebBuildMap();
  idebBuildMunTable();
  injectExportButtons();

  // Map layer toggle
  const idebBtnMun = document.getElementById('ideb-btn-layer-mun');
  const idebBtnCre = document.getElementById('ideb-btn-layer-cre');
  if (idebBtnMun && idebBtnCre) {
    idebBtnMun.addEventListener('click', () => {
      idebBtnMun.classList.add('active'); idebBtnCre.classList.remove('active');
      idebBuildMap();
    });
    idebBtnCre.addEventListener('click', () => {
      idebBtnCre.classList.add('active'); idebBtnMun.classList.remove('active');
      idebBuildCreMap();
    });
  }

  // Map etapa selector
  document.getElementById('sel-ideb-map-etapa')?.addEventListener('change', e => {
    S.idebEtapa = e.target.value;
    // Rebuild active layer
    if (idebBtnCre?.classList.contains('active')) idebBuildCreMap();
    else idebBuildMap();
  });

  // ── Populate topbar filters with IDEB years ──
  const selAno = document.getElementById('sel-ano');
  if (selAno) {
    selAno.innerHTML = anos.map(a => `<option value="${a}" ${a === anoSel ? 'selected' : ''}>${a}</option>`).join('');
  }
  populateCreDropdown();
  populateMunDropdown(S.creSel || null);
  const selCre = document.getElementById('sel-cre');
  if (selCre && S.creSel) selCre.value = S.creSel;
  const selMunEl = document.getElementById('sel-mun');
  if (selMunEl && S.munSel) selMunEl.value = S.munSel;
  if (S.munSel) {
    const munInput = document.getElementById('mun-search-input');
    if (munInput) munInput.value = lookup[S.munSel] || S.munSel;
  }
  bindTopbarFilters();
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
    { view: 'acesso', icon: 'img/icons/nav_acesso.png', title: 'Acesso e Matrículas', desc: 'Evolução, etapas e recortes demográficos' },
    { view: 'infra', icon: 'img/icons/nav_infra.png', title: 'Infraestrutura', desc: 'Recursos físicos e tecnológicos das escolas' },
    { view: 'icg', icon: 'img/icons/escola.png', title: 'Complexidade de Gestão', desc: 'Níveis de complexidade por escola' },
    { view: 'inse', icon: 'img/icons/nav_desigualdades.png', title: 'Contexto Socioeconômico', desc: 'Indicador INSE por escola e município' },
    { view: 'docencia', icon: 'img/icons/sec_docentes.png', title: 'Docência', desc: 'Perfil, vínculo e distribuição docente' },
    { view: 'afd', icon: 'img/icons/professor.png', title: 'Formação Docente', desc: 'Adequação da formação por etapa' },
    { view: 'fluxo', icon: 'img/icons/sec_evolucao.png', title: 'Fluxo e Rendimento', desc: 'Aprovação, reprovação e abandono' },
    { view: 'saers', icon: 'img/icons/sec_saeb.png', title: 'SAERS', desc: 'Avaliação Estadual — Proficiência e Padrão de Desempenho' },
    { view: 'saeb', icon: 'img/icons/sec_saeb.png', title: 'SAEB', desc: 'Proficiência em Língua Portuguesa e Matemática' },
    { view: 'ideb', icon: 'img/icons/nav_ideb.png', title: 'IDEB', desc: 'Índice de Desenvolvimento da Educação Básica' },
    { view: 'tdi', icon: 'img/icons/politicas.png', title: 'Distorção Idade-Série', desc: 'Taxa de defasagem escolar por etapa' },
    { view: 'escolas', icon: 'img/icons/escola.png', title: 'Visão por Escola', desc: 'Mapa georreferenciado com indicadores por escola' },
  ];

  main.innerHTML = `
    <div class="home-wrap">
      <div class="home-bg"></div>
      <div class="home-particles">
        <div class="home-particle"></div>
        <div class="home-particle"></div>
        <div class="home-particle"></div>
        <div class="home-particle"></div>
        <div class="home-particle"></div>
        <div class="home-particle"></div>
      </div>
      <div class="home-content">

        <div class="home-hero" style="margin-bottom:28px">
          <div class="home-hero-badge">Secretaria de Estado da Educação do Rio Grande do Sul</div>
          <h1>Painel de <span>Indicadores Educacionais</span></h1>
          <p class="home-hero-sub">
            Plataforma analítica com dados abertos do Censo Escolar, SAEB e indicadores educacionais da rede estadual do Rio Grande do Sul
          </p>
        </div>

        <div class="home-divider" style="margin:20px 0 16px">
          <span class="home-divider-line"></span>
          <span class="home-divider-text">Explorar Seções</span>
          <span class="home-divider-line"></span>
        </div>

        <div class="home-grid" style="grid-template-columns:repeat(3,1fr)">
          ${sections.map((s, i) => `
            <div class="home-card" data-nav="${s.view}" style="animation: fadeSlideUp .5s ease ${.2 + i * .06}s both">
              <div class="home-card-icon"><img src="${s.icon}" alt=""></div>
              <div class="home-card-text">
                <div class="home-card-title">${s.title}</div>
                <div class="home-card-desc">${s.desc}</div>
              </div>
              <span class="home-card-arrow">›</span>
            </div>
          `).join('')}
        </div>

        <div class="home-footer" style="margin-top:32px">
          <div class="home-footer-text">
            Dados: INEP — Censo Escolar da Educação Básica & Microdados SAEB<br>
            Desenvolvido no âmbito do contrato UNESCO / SEDUC-RS
          </div>
          <div class="home-footer-logos">
            <img src="img/logo_rs.avif" alt="Governo RS" style="height:56px" onerror="this.style.display='none'">
            <img src="img/UNESCO_logo_white.png" alt="UNESCO" style="height:52px;filter:none" onerror="this.style.display='none'">
            <img src="img/logo_cebe.png" alt="CEBE" style="height:56px" onerror="this.style.display='none'">
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
  { key: 'aprov_fund_ai', label: 'Aprovação Anos Iniciais (%)', higher: true },
  { key: 'aprov_fund_af', label: 'Aprovação Anos Finais (%)', higher: true },
  { key: 'aprov_med', label: 'Aprovação Médio (%)', higher: true },
  { key: 'reprov_fund_ai', label: 'Reprovação Anos Iniciais (%)', higher: false },
  { key: 'reprov_fund_af', label: 'Reprovação Anos Finais (%)', higher: false },
  { key: 'reprov_med', label: 'Reprovação Médio (%)', higher: false },
  { key: 'aband_fund_ai', label: 'Abandono Anos Iniciais (%)', higher: false },
  { key: 'aband_fund_af', label: 'Abandono Anos Finais (%)', higher: false },
  { key: 'aband_med', label: 'Abandono Médio (%)', higher: false },
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
      <div id="fluxo-kpi-strip" class="kpi-strip" style="grid-template-columns:repeat(4,1fr)"></div>
    </div>

    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/panorama.png" alt=""></span>
      <span class="section-divider-text">Evolução Temporal</span>
      <span class="section-divider-line"></span>
    </div>
    <div class="charts-grid" style="display:grid;grid-template-columns:1fr;gap:10px">
      <div class="chart-card d1">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:4px">
          <div class="chart-title" style="margin:0">Aprovação por Etapa (%)</div>
          <div class="flx-toggle-pills" id="flx-aprov-pills">
            <button class="flx-pill" data-key="aprov_fund_ai" style="--pill-color:${COLORS.fundamental}">Anos Iniciais</button>
            <button class="flx-pill" data-key="aprov_fund_af" style="--pill-color:${COLORS.priLight}">Anos Finais</button>
            <button class="flx-pill active" data-key="aprov_med" style="--pill-color:${COLORS.red}">Médio</button>
          </div>
        </div>
        <div style="height:340px"><canvas id="flx-chart-aprov"></canvas></div>
        <div class="chart-source">${FONTE_REND}</div>
      </div>
    </div>
    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="chart-card d2">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:4px">
          <div class="chart-title" style="margin:0">Reprovação (%)</div>
          <div class="flx-toggle-pills" id="flx-reprov-pills">
            <button class="flx-pill active" data-key="fund_ai" style="--pill-color:${COLORS.pri}">Anos Iniciais</button>
            <button class="flx-pill active" data-key="fund_af" style="--pill-color:${COLORS.priLight}">Anos Finais</button>
            <button class="flx-pill active" data-key="med" style="--pill-color:${COLORS.red}">Médio</button>
          </div>
        </div>
        <div style="height:340px"><canvas id="flx-chart-reprov"></canvas></div>
        <div class="chart-source">${FONTE_REND}</div>
      </div>
      <div class="chart-card d3">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:4px">
          <div class="chart-title" style="margin:0">Abandono (%)</div>
          <div class="flx-toggle-pills" id="flx-aband-pills">
            <button class="flx-pill active" data-key="fund_ai" style="--pill-color:${COLORS.pri}">Anos Iniciais</button>
            <button class="flx-pill active" data-key="fund_af" style="--pill-color:${COLORS.priLight}">Anos Finais</button>
            <button class="flx-pill active" data-key="med" style="--pill-color:${COLORS.red}">Médio</button>
          </div>
        </div>
        <div style="height:340px"><canvas id="flx-chart-aband"></canvas></div>
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
          <div class="map-layer-toggle">
            <button class="map-layer-btn active" id="flx-btn-layer-mun">Municípios</button>
            <button class="map-layer-btn" id="flx-btn-layer-cre">CREs</button>
          </div>
        </div>
        <div id="flx-map-leaflet" style="height:480px;width:100%;background:var(--bg)"></div>
      </div>
      <div class="table-wrapper" id="flx-table-wrapper">
        <div class="table-header">
          <h3>Tabela de Municípios</h3>
          <input type="text" class="table-search" id="flx-mun-search" placeholder="Buscar...">
        </div>
        <div style="font-size:10px;color:var(--accent);padding:4px 12px 6px;font-weight:600;background:rgba(255,203,4,.08);border-radius:0 0 6px 6px;border-top:1px dashed rgba(255,203,4,.3)">
          📍 Clique em qualquer município — na tabela ou no mapa — para filtrar <strong>todas as visualizações</strong> desta seção.
        </div>
        <div style="max-height:400px;overflow-y:auto">
          <table class="data-table" id="flx-mun-table">
            <thead><tr>
              <th>#</th><th>Município</th><th>Aprov.F</th><th>Aprov.M</th><th>Reprov.F</th><th>Aband.M</th>
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
  const flxBtnMun = document.getElementById('flx-btn-layer-mun');
  const flxBtnCre = document.getElementById('flx-btn-layer-cre');
  
  if (selMetric) {
    selMetric.addEventListener('change', () => {
      if (flxBtnCre?.classList.contains('active')) {
        buildFluxoCreMap(f, anoSel, selMetric.value);
      } else {
        buildFluxoMap(f, anoSel, selMetric.value);
      }
    });
  }

  if (flxBtnMun && flxBtnCre) {
    flxBtnMun.addEventListener('click', () => {
      flxBtnMun.classList.add('active'); flxBtnCre.classList.remove('active');
      buildFluxoMap(f, anoSel, selMetric?.value || 'aprov_fund');
    });
    flxBtnCre.addEventListener('click', () => {
      flxBtnCre.classList.add('active'); flxBtnMun.classList.remove('active');
      buildFluxoCreMap(f, anoSel, selMetric?.value || 'aprov_fund');
    });
  }

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
  ];
  const accentColors = { green: '#2E86C1', yellow: '#FFCB04', red: '#EE302F', blue: '#1565C0' };
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

  // Filter out years where all rendimento data is null
  const anosChart = anos.filter(a => {
    const d = getYearData(a);
    return d.aprov_fund != null || d.aprov_fund_ai != null || d.reprov_fund != null || d.aband_fund != null;
  });

  // ── 1. APPROVAL — single chart with toggleable series ──
  const APROV_SERIES = {
    aprov_fund_ai: { label: 'Anos Iniciais', color: COLORS.fundamental },
    aprov_fund_af: { label: 'Anos Finais', color: COLORS.priLight },
    aprov_med:     { label: 'Médio',    color: COLORS.red },
  };

  const aprovEl = document.getElementById('flx-chart-aprov');
  if (aprovEl) {
    // Build all datasets, but only show 'Médio' initially
    const aprovDatasets = Object.entries(APROV_SERIES).map(([key, cfg]) => ({
      label: cfg.label,
      data: anosChart.map(a => getYearData(a)[key] ?? null),
      borderColor: cfg.color,
      backgroundColor: cfg.color + '18',
      fill: true,
      tension: .35,
      pointRadius: 5,
      borderWidth: 2.5,
      hidden: key !== 'aprov_med',  // Only Médio visible by default
      _flxKey: key,
    }));

    const aprovChart = new Chart(aprovEl, {
      type: 'line',
      data: { labels: anosChart, datasets: aprovDatasets },
      options: {
        ...CHART_DEFAULTS,
        layout: { padding: { top: 38 } },
        plugins: {
          ...CHART_DEFAULTS.plugins,
          legend: { display: false },
          datalabels: {
            ...DL_LINE_BOLD,
            clamp: true,
            anchor: ctx => (ctx.dataset.data[ctx.dataIndex] ?? 0) >= 98 ? 'start' : 'end',
            align:  ctx => (ctx.dataset.data[ctx.dataIndex] ?? 0) >= 98 ? 'bottom' : 'top',
            color: ctx => ctx.dataset.borderColor,
          },
          tooltip: {
            enabled: true, mode: 'index', intersect: false,
            backgroundColor: 'rgba(30,30,30,.92)', titleFont: { family:'Inter', size:12, weight:'700' },
            bodyFont: { family:'Inter', size:11 }, padding: 10, cornerRadius: 8,
            callbacks: {
              title: items => items[0]?.label || '',
              label: item => item.raw != null ? `  ${item.dataset.label}: ${item.raw.toFixed(1)}%` : '',
            }
          },
        },
        scales: {
          ...CHART_DEFAULTS.scales,
          y: { ...CHART_DEFAULTS.scales.y, min: 60, max: 100, grace: '5%' }
        },
      },
    });
    S.charts.push(aprovChart);

    // Bind pill toggles for approval chart
    document.querySelectorAll('#flx-aprov-pills .flx-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        pill.classList.toggle('active');
        const key = pill.dataset.key;
        const dsIdx = aprovChart.data.datasets.findIndex(ds => ds._flxKey === key);
        if (dsIdx >= 0) {
          aprovChart.data.datasets[dsIdx].hidden = !pill.classList.contains('active');
          aprovChart.update();
        }
      });
    });
  }

  // ── 2. REPROVAÇÃO — chart with AI / AF / Médio ──
  const REPROV_SERIES = [
    { label: 'Anos Iniciais', color: COLORS.pri, key: 'reprov_fund_ai', group: 'fund_ai' },
    { label: 'Anos Finais', color: COLORS.priLight, key: 'reprov_fund_af', group: 'fund_af' },
    { label: 'Médio', color: COLORS.red, key: 'reprov_med', group: 'med' },
  ];

  const reprovEl = document.getElementById('flx-chart-reprov');
  if (reprovEl) {
    const reprovDatasets = REPROV_SERIES.map(cfg => ({
      label: cfg.label,
      data: anosChart.map(a => getYearData(a)[cfg.key] ?? null),
      borderColor: cfg.color,
      borderWidth: 2.5,
      tension: .35,
      pointRadius: 5,
      _flxGroup: cfg.group,
    }));

    const reprovChart = new Chart(reprovEl, {
      type: 'line',
      data: { labels: anosChart, datasets: reprovDatasets },
      options: {
        ...CHART_DEFAULTS,
        layout: { padding: { top: 8 } },
        plugins: {
          ...CHART_DEFAULTS.plugins,
          datalabels: { display: false },
          tooltip: {
            enabled: true, mode: 'index', intersect: false,
            backgroundColor: 'rgba(30,30,30,.92)', titleFont: { family:'Inter', size:12, weight:'700' },
            bodyFont: { family:'Inter', size:11 }, padding: 10, cornerRadius: 8,
            callbacks: {
              title: items => items[0]?.label || '',
              label: item => item.raw != null ? `  ${item.dataset.label}: ${item.raw.toFixed(1)}%` : '',
            }
          },
          legend: { display: true, onClick: (e, legendItem, legend) => { const idx = legendItem.datasetIndex; const ci = legend.chart; ci.getDatasetMeta(idx).hidden = !ci.getDatasetMeta(idx).hidden; ci.update(); }, labels: { font: { family:'Inter', size:10, weight:'600' }, boxWidth:10, padding:8 } },
        },
        scales: {
          ...CHART_DEFAULTS.scales,
          y: { ...CHART_DEFAULTS.scales.y, min: 0, suggestedMax: 15, grace: '10%' }
        },
      },
    });
    S.charts.push(reprovChart);

    // Bind pill toggles for reprov chart
    document.querySelectorAll('#flx-reprov-pills .flx-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        pill.classList.toggle('active');
        const group = pill.dataset.key;
        const isActive = pill.classList.contains('active');
        reprovChart.data.datasets.forEach(ds => {
          if (ds._flxGroup === group) ds.hidden = !isActive;
        });
        reprovChart.update();
      });
    });
  }

  // ── 3. ABANDONO — chart with AI / AF / Médio ──
  const ABAND_SERIES = [
    { label: 'Anos Iniciais', color: COLORS.pri, key: 'aband_fund_ai', group: 'fund_ai' },
    { label: 'Anos Finais', color: COLORS.priLight, key: 'aband_fund_af', group: 'fund_af' },
    { label: 'Médio', color: COLORS.red, key: 'aband_med', group: 'med' },
  ];

  const abandEl = document.getElementById('flx-chart-aband');
  if (abandEl) {
    const abandDatasets = ABAND_SERIES.map(cfg => ({
      label: cfg.label,
      data: anosChart.map(a => getYearData(a)[cfg.key] ?? null),
      borderColor: cfg.color,
      borderWidth: 2.5,
      tension: .35,
      pointRadius: 5,
      _flxGroup: cfg.group,
    }));

    const abandChart = new Chart(abandEl, {
      type: 'line',
      data: { labels: anosChart, datasets: abandDatasets },
      options: {
        ...CHART_DEFAULTS,
        layout: { padding: { top: 8 } },
        plugins: {
          ...CHART_DEFAULTS.plugins,
          datalabels: { display: false },
          tooltip: {
            enabled: true, mode: 'index', intersect: false,
            backgroundColor: 'rgba(30,30,30,.92)', titleFont: { family:'Inter', size:12, weight:'700' },
            bodyFont: { family:'Inter', size:11 }, padding: 10, cornerRadius: 8,
            callbacks: {
              title: items => items[0]?.label || '',
              label: item => item.raw != null ? `  ${item.dataset.label}: ${item.raw.toFixed(1)}%` : '',
            }
          },
          legend: { display: true, onClick: (e, legendItem, legend) => { const idx = legendItem.datasetIndex; const ci = legend.chart; ci.getDatasetMeta(idx).hidden = !ci.getDatasetMeta(idx).hidden; ci.update(); }, labels: { font: { family:'Inter', size:10, weight:'600' }, boxWidth:10, padding:8 } },
        },
        scales: {
          ...CHART_DEFAULTS.scales,
          y: { ...CHART_DEFAULTS.scales.y, min: 0, suggestedMax: 15, grace: '10%' }
        },
      },
    });
    S.charts.push(abandChart);

    // Bind pill toggles for aband chart
    document.querySelectorAll('#flx-aband-pills .flx-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        pill.classList.toggle('active');
        const group = pill.dataset.key;
        const isActive = pill.classList.contains('active');
        abandChart.data.datasets.forEach(ds => {
          if (ds._flxGroup === group) ds.hidden = !isActive;
        });
        abandChart.update();
      });
    });
  }

  // 4. (Taxas por Etapa removed)
  // 5. (TDI removed — now has its own section)
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
      { min: 95, color: '#0D3B66', label: '≥ 95%' },
      { min: 90, color: '#5cba68', label: '90% – 94%' },
      { min: 80, color: '#FFDF00', label: '80% – 89%' },
      { min: 0, color: '#EE302F', label: '< 80%' },
    ];
  } else {
    tiers = [
      { min: 0, max: 3, color: '#0D3B66', label: '< 3%' },
      { min: 3, max: 8, color: '#5cba68', label: '3% – 7%' },
      { min: 8, max: 15, color: '#FFDF00', label: '8% – 14%' },
      { min: 15, max: 999, color: '#EE302F', label: '≥ 15%' },
    ];
    if (metricDef.tdi) {
      tiers = [
        { min: 0, max: 10, color: '#0D3B66', label: '< 10%' },
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
        mouseout: e => { S.mapLayer.resetStyle(e.target); e.target.closeTooltip(); },
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
  S.map.fitBounds(S.mapLayer.getBounds(), { padding: [20, 20] });
}

/** Build CRE-level choropleth for Fluxo */
function buildFluxoCreMap(f, anoSel, metricKey) {
  if (!S.creGeo || !S.map) return;
  if (S.mapLayer) { S.map.removeLayer(S.mapLayer); S.mapLayer = null; }
  if (S.mapLegend) { S.map.removeControl(S.mapLegend); S.mapLegend = null; }

  const munData = f.por_municipio[anoSel] || {};
  const tdiData = f.tdi_por_municipio || {};
  const munToCre = S.creLookup?.mun_to_cre || {};
  const metricDef = FLUXO_MAP_METRICS.find(m => m.key === metricKey) || FLUXO_MAP_METRICS[0];

  // Aggregate by CRE
  const creData = {};
  for (const [cod, v] of Object.entries(munData)) {
    const cre = munToCre[cod]?.cod_cre;
    if (!cre) continue;
    if (!creData[cre]) creData[cre] = { sumVal: 0, count: 0, nome: munToCre[cod]?.nome_cre || cre };
    const val = metricDef.tdi ? (tdiData[cod]?.[metricKey] ?? null) : (v[metricKey] ?? null);
    if (val != null) { creData[cre].sumVal += val; creData[cre].count += 1; }
  }
  for (const c of Object.values(creData)) c.avg = c.count > 0 ? c.sumVal / c.count : null;

  let tiers;
  if (metricDef.higher) {
    tiers = [
      { min: 95, color: '#0D3B66', label: '≥ 95%' },
      { min: 90, color: '#5cba68', label: '90% – 94%' },
      { min: 80, color: '#FFDF00', label: '80% – 89%' },
      { min: 0, color: '#EE302F', label: '< 80%' },
    ];
  } else if (metricDef.tdi) {
    tiers = [
      { min: 0, max: 10, color: '#0D3B66', label: '< 10%' },
      { min: 10, max: 20, color: '#5cba68', label: '10% – 19%' },
      { min: 20, max: 30, color: '#FFDF00', label: '20% – 29%' },
      { min: 30, max: 999, color: '#EE302F', label: '≥ 30%' },
    ];
  } else {
    tiers = [
      { min: 0, max: 3, color: '#0D3B66', label: '< 3%' },
      { min: 3, max: 8, color: '#5cba68', label: '3% – 7%' },
      { min: 8, max: 15, color: '#FFDF00', label: '8% – 14%' },
      { min: 15, max: 999, color: '#EE302F', label: '≥ 15%' },
    ];
  }

  const getColor = v => {
    if (v == null) return '#f0f0f0';
    if (metricDef.higher) { for (const t of tiers) { if (v >= t.min) return t.color; } return '#f0f0f0'; }
    for (let i = tiers.length - 1; i >= 0; i--) { if (v >= tiers[i].min) return tiers[i].color; }
    return '#f0f0f0';
  };

  S.mapLayer = L.geoJSON(S.creGeo, {
    style: feature => {
      const cod = feature.properties.cod_cre;
      const v = creData[cod]?.avg;
      return { fillColor: getColor(v), fillOpacity: 0.8, weight: 2, color: '#fff' };
    },
    onEachFeature: (feature, layer) => {
      const cod = feature.properties.cod_cre;
      const nome = feature.properties.nome_cre || cod;
      const d = creData[cod];
      layer.bindTooltip(`<strong>${nome}</strong><br>${metricDef.label}: ${d?.avg != null ? d.avg.toFixed(1) + '%' : '—'}<br>${d?.count || 0} municípios`, { sticky: true });
      layer.on('click', () => { S.creSel = cod; const selCre = document.getElementById('sel-cre'); if (selCre) selCre.value = cod; populateMunDropdown(cod); refreshActiveTab(); });
    }
  }).addTo(S.map);

  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = function () {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = `<h4>${metricDef.label} (CREs)</h4>` +
      tiers.slice().reverse().map(t => `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${t.color}"></div><span>${t.label}</span></div>`).join('');
    return div;
  };
  legend.addTo(S.map);
  S.mapLegend = legend;
  if (S.mapLayer) S.map.fitBounds(S.mapLayer.getBounds(), { padding: [20, 20] });
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
    const colKeys = ['_rank', 'nome', 'aprov_fund', 'aprov_med', 'reprov_fund', 'aband_med'];
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
  'Nível VII': '#2874A6', 'Nível VIII': '#1B5E20',
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
  // Respect year filter: use S.anoSel if it's valid for INSE, otherwise use ultimo
  const anoAtual = (S.anoSel && anos.includes(S.anoSel)) ? S.anoSel : ultimo;
  const su = inse.serie_temporal[anoAtual];
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
          <p style="font-size:9px;margin:10px 0 0;color:#999;line-height:1.5;font-style:italic">
            Fonte: INEP — Indicador de Nível Socioeconômico das Escolas (Nota Técnica INEP, 2023). Disponível em: gov.br/inep.
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
      <span class="section-divider-text">Distribuição por Nível Socioeconômico (${anoAtual})</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title">Escolas por Nível INSE — ${geoLabel} (${anoAtual})</div>
        <div style="height:260px"><canvas id="inse-chart-dist"></canvas></div>
        <div class="chart-source">${FONTE_INSE}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Nº de Alunos por Nível INSE — ${geoLabel} (${anoAtual})</div>
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
        <div style="height:240px"><canvas id="inse-chart-evol"></canvas></div>
        <div class="chart-source">${FONTE_INSE}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Gap Urbana–Rural — Evolução (${primeiro}–${ultimo})</div>
        <div style="height:240px"><canvas id="inse-chart-gap"></canvas></div>
        <div class="chart-source">${FONTE_INSE}</div>
      </div>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title">Evolução dos Níveis INSE — Proporção de Escolas (${primeiro}–${ultimo})</div>
        <div style="height:260px"><canvas id="inse-chart-stacked"></canvas></div>
        <div class="chart-source">${FONTE_INSE}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Urbana × Rural — INSE Médio por Edição (${primeiro}–${ultimo})</div>
        <div style="height:260px"><canvas id="inse-chart-ur-detail"></canvas></div>
        <div class="chart-source">${FONTE_INSE}</div>
      </div>
    </div>



    <!-- ═══ EIXO: Mapa + Tabela ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/sec_mapa.png" alt=""></span>
      <span class="section-divider-text">Mapa e Tabela Municipal — INSE (${anoAtual})</span>
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
        <div class="chart-title">Tabela Municipal — INSE</div>
        <div style="font-size:10px;color:var(--accent);padding:4px 12px 6px;font-weight:600;background:rgba(255,203,4,.08);border-radius:6px;border:1px dashed rgba(255,203,4,.3);margin-bottom:6px">
          📍 Clique em qualquer município — na tabela ou no mapa — para filtrar <strong>todas as visualizações</strong> desta seção (KPIs, gráficos e recortes). Clique novamente para desfiltrar.
        </div>
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
    if (S.munSel && inse.por_municipio[anoAtual]?.[S.munSel]) {
      dist = inse.por_municipio[anoAtual][S.munSel].dist_niveis;
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

  // ── Chart 2: Student distribution by level (bar with absolute numbers) ──
  const inseBuildAlunosChart = () => {
    const el = document.getElementById('inse-chart-alunos');
    if (!el) return;

    const distAl = su.dist_niveis_alunos;
    const nTotal = su.n_alunos || 0;
    const niveis = Object.keys(INSE_NIVEL_COLORS);
    const pcts = niveis.map(n => distAl[n] || 0);
    const absolutos = pcts.map(p => Math.round(p * nTotal / 100));
    const colors = niveis.map(n => INSE_NIVEL_COLORS[n]);

    S.charts.push(new Chart(el, {
      type: 'bar',
      data: {
        labels: niveis.map(n => n.replace('Nível ','')),
        datasets: [{ label: 'Alunos', data: absolutos, backgroundColor: colors, borderRadius: 4 }]
      },
      options: {
        ...CHART_DEFAULTS, layout: { padding: { top: 20 } },
        plugins: {
          ...CHART_DEFAULTS.plugins, legend: { display: false },
          datalabels: { display: true, anchor: 'end', align: 'end', font: { family: 'Inter', size: 10, weight: '700' },
            color: '#333', formatter: v => v > 0 ? formatNum(v) : '' },
          tooltip: {
            enabled: true, backgroundColor: 'rgba(30,30,30,.92)',
            titleFont: { family:'Inter', size:12, weight:'700' },
            bodyFont: { family:'Inter', size:11 }, padding: 10, cornerRadius: 8,
            callbacks: {
              label: item => {
                const idx = item.dataIndex;
                return `  ${formatNum(item.raw)} alunos (${pcts[idx].toFixed(1)}%)`;
              }
            }
          }
        },
        scales: {
          ...CHART_DEFAULTS.scales,
          y: { ...CHART_DEFAULTS.scales.y, beginAtZero: true, grace: '15%',
            ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => formatNum(v) } }
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

    const munData = inse.por_municipio[anoAtual] || {};

    // Fixed breaks for INSE (not quantile — semantic)
    const INSE_MAP_BREAKS = [
      { min: 0,   max: 5.0, color: '#E53935', label: '< 5.0 (Vulnerável)' },
      { min: 5.0, max: 5.3, color: '#FB8C00', label: '5.0–5.3 (Baixo-médio)' },
      { min: 5.3, max: 5.5, color: '#66BB6A', label: '5.3–5.5 (Médio)' },
      { min: 5.5, max: 99,  color: '#2874A6', label: '> 5.5 (Alto)' },
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
          mouseout: e => { S.mapLayer.resetStyle(e.target); e.target.closeTooltip(); info.update(); },
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
    if (S.mapLayer) S.map.fitBounds(S.mapLayer.getBounds(), { padding: [20, 20] });
  };

  // ── CRE layer for INSE map ──
  const inseBuildCreMap = () => {
    if (!S.creGeo || !S.map) return;
    if (S.mapLayer) { S.mapLayer.remove(); S.mapLayer = null; }
    if (S.mapLegend) { S.mapLegend.remove(); S.mapLegend = null; }

    const munToCre = S.creLookup?.mun_to_cre || {};
    const munData = inse.por_municipio[anoAtual] || {};

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
      { min: 5.5, max: 99,  color: '#2874A6', label: '> 5.5 (Alto)' },
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
    if (S.mapLayer) S.map.fitBounds(S.mapLayer.getBounds(), { padding: [20, 20] });
  };

  // ── Table: Municipality table ──
  let inseSortCol = 2, inseSortAsc = false; // default: sort by INSE desc
  const inseBuildMunTable = () => {
    const tbody = document.querySelector('#inse-mun-table tbody');
    const thead = document.querySelector('#inse-mun-table thead');
    if (!tbody) return;

    const munData = inse.por_municipio[anoAtual] || {};
    const lookup = inse.lookup_municipios || {};

    // Filter by CRE if selected
    let entries = Object.entries(munData);
    if (S.creSel && S.creLookup?.mun_to_cre) {
      entries = entries.filter(([cod]) => S.creLookup.mun_to_cre[cod]?.cod_cre === S.creSel);
    }
    if (S.munSel) {
      entries = entries.filter(([cod]) => cod === S.munSel);
    }

    // Sort
    const colKeys = ['#', 'nome', 'inse', 'nivel', 'n_escolas', 'n_alunos'];
    entries.sort((a, b) => {
      const key = colKeys[inseSortCol];
      let va, vb;
      if (key === 'nome') { va = (lookup[a[0]] || '').toLowerCase(); vb = (lookup[b[0]] || '').toLowerCase(); }
      else if (key === 'inse') { va = a[1].inse || 0; vb = b[1].inse || 0; }
      else if (key === 'nivel') { va = a[1].nivel || ''; vb = b[1].nivel || ''; }
      else if (key === 'n_escolas') { va = a[1].n_escolas || 0; vb = b[1].n_escolas || 0; }
      else if (key === 'n_alunos') { va = a[1].n_alunos || 0; vb = b[1].n_alunos || 0; }
      else { va = 0; vb = 0; }
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return inseSortAsc ? cmp : -cmp;
    });

    tbody.innerHTML = entries.map(([cod, md], i) => `
      <tr data-cod="${cod}" style="cursor:pointer" title="Clique para filtrar">
        <td>${i + 1}</td>
        <td>${lookup[cod] || cod}</td>
        <td><strong>${md.inse?.toFixed(2) ?? '—'}</strong></td>
        <td>${md.nivel || '—'}</td>
        <td>${md.n_escolas}</td>
        <td>${formatNum(md.n_alunos)}</td>
      </tr>
    `).join('');

    // Click-to-filter
    tbody.querySelectorAll('tr').forEach(tr => {
      tr.addEventListener('click', () => {
        const cod = tr.dataset.cod;
        if (S.munSel === cod) { S.munSel = null; } else { S.munSel = cod; }
        refreshActiveTab();
      });
    });

    // Sortable headers
    if (thead) {
      const headers = ['#', 'Município', 'INSE', 'Nível', 'Escolas', 'Alunos'];
      thead.innerHTML = '<tr>' + headers.map((h, i) => {
        const arrow = inseSortCol === i ? (inseSortAsc ? ' ▲' : ' ▼') : ' ⇅';
        return `<th style="cursor:pointer" title="Clique para ordenar">${h}${arrow}</th>`;
      }).join('') + '</tr>';

      thead.querySelectorAll('th').forEach((th, ci) => {
        th.addEventListener('click', () => {
          if (inseSortCol === ci) inseSortAsc = !inseSortAsc;
          else { inseSortCol = ci; inseSortAsc = ci <= 1; }
          inseBuildMunTable();
        });
      });
    }

    // Search
    document.getElementById('inse-mun-search')?.addEventListener('input', e => {
      const q = e.target.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      tbody.querySelectorAll('tr').forEach(tr => {
        const nome = (tr.children[1]?.textContent || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        tr.style.display = nome.includes(q) ? '' : 'none';
      });
    });
  };


  // ── Chart 5: Stacked level evolution ──
  const inseBuildStackedChart = () => {
    const el = document.getElementById('inse-chart-stacked');
    if (!el) return;
    const niveis = Object.keys(INSE_NIVEL_COLORS);
    const datasets = niveis.map(n => ({
      label: n.replace('Nível ', ''),
      data: anos.map(a => {
        const d = inse.serie_temporal[a]?.dist_niveis_escolas?.[n];
        return d ? d.pct : 0;
      }),
      backgroundColor: INSE_NIVEL_COLORS[n],
      borderRadius: 2,
    }));
    S.charts.push(new Chart(el, {
      type: 'bar',
      data: { labels: anos, datasets },
      options: {
        ...CHART_DEFAULTS,
        layout: { padding: { top: 10 } },
        plugins: { ...CHART_DEFAULTS.plugins,
          legend: { display: true, position: 'bottom', labels: { font: { family: 'Inter', size: 9, weight: '600' }, boxWidth: 10, padding: 6 } },
          datalabels: { display: ctx => ctx.dataset.data[ctx.dataIndex] > 5, color: '#fff', font: { family: 'Inter', size: 9, weight: '700' }, formatter: v => v.toFixed(0) + '%' }
        },
        scales: {
          x: { ...CHART_DEFAULTS.scales.x, stacked: true },
          y: { ...CHART_DEFAULTS.scales.y, stacked: true, max: 100, ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => v + '%' } }
        }
      }
    }));
  };

  // ── Chart 6: Urban × Rural INSE by year (grouped bars) ──
  const inseBuildUrbanRuralDetail = () => {
    const el = document.getElementById('inse-chart-ur-detail');
    if (!el) return;
    const urbVals = anos.map(a => inse.serie_temporal[a]?.urbana?.media || null);
    const rurVals = anos.map(a => inse.serie_temporal[a]?.rural?.media || null);
    S.charts.push(new Chart(el, {
      type: 'bar',
      data: {
        labels: anos,
        datasets: [
          { label: 'Urbana', data: urbVals, backgroundColor: COLORS.pri + 'CC', borderRadius: 6, barPercentage: 0.6, categoryPercentage: 0.7 },
          { label: 'Rural', data: rurVals, backgroundColor: COLORS.red + 'CC', borderRadius: 6, barPercentage: 0.6, categoryPercentage: 0.7 },
        ]
      },
      options: {
        ...CHART_DEFAULTS,
        layout: { padding: { top: 25 } },
        plugins: { ...CHART_DEFAULTS.plugins,
          legend: { display: true, labels: { font: { family: 'Inter', size: 11, weight: '600' }, boxWidth: 12, padding: 10 } },
          datalabels: { display: true, anchor: 'end', align: 'end', font: { family: 'Inter', size: 11, weight: '700' }, color: '#333', formatter: v => v != null ? v.toFixed(2) : '' }
        },
        scales: {
          ...CHART_DEFAULTS.scales,
          y: { ...CHART_DEFAULTS.scales.y, min: 4.0, max: 6.0, grace: '5%' }
        }
      }
    }));
  };


  // Build all
  inseBuildDistChart();
  inseBuildAlunosChart();
  inseBuildEvolChart();
  inseBuildGapChart();
  inseBuildStackedChart();
  inseBuildUrbanRuralDetail();
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
    selAno.innerHTML = anos.map(a => `<option value="${a}" ${a === anoAtual ? 'selected' : ''}>${a}</option>`).join('');
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
  updateFilterAwareness();
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
  // Respect year filter: use S.anoSel if valid for ICG, otherwise use ultimo
  const anoAtual = (S.anoSel && anos.includes(S.anoSel)) ? S.anoSel : ultimo;
  const su = icg.serie_temporal[anoAtual];

  // Geo-aware data
  let displayData = su;
  let geoLabel = getRedeLabel() + ' do RS';
  if (S.munSel && icg.por_municipio?.[anoAtual]?.[S.munSel]) {
    displayData = icg.por_municipio[anoAtual][S.munSel];
    geoLabel = icg.lookup_municipios[S.munSel] || S.munSel;
  } else if (S.creSel) {
    const creMuns = getCreMuns(S.creSel);
    // Aggregate CRE
    const agg = { total_escolas: 0 };
    for (let n = 1; n <= 6; n++) agg[`nivel_${n}`] = { count: 0, pct: 0 };
    const munYear = icg.por_municipio?.[anoAtual] || {};
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
      <div style="padding:20px 24px;background:linear-gradient(135deg,#f8fdf9 0%,#eef6f0 100%)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          <img src="img/icons/escola.png" alt="" style="width:20px;height:20px">
          <span style="font-size:14px;font-weight:700;color:var(--pri)">Definição</span>
        </div>
        <p style="font-size:11.5px;margin:0 0 16px;color:#333;line-height:1.75">
          O <strong>ICG (Indicador de Complexidade de Gestão da Escola)</strong> resume, em uma única medida,
          as informações de <strong>porte</strong> (nº de matrículas), <strong>turnos de funcionamento</strong>,
          <strong>quantidade de etapas</strong> e <strong>complexidade das etapas ofertadas</strong>.
          Calculado por <strong>Teoria de Resposta ao Item (TRI)</strong> a partir de 4 variáveis do Censo Escolar,
          gerando um escore contínuo classificado em <strong>6 níveis</strong> — do Nível 1 (gestão simples)
          ao Nível 6 (gestão muito complexa).
        </p>
        <div style="background:rgba(255,203,4,.1);border:1px solid rgba(255,203,4,.25);border-radius:6px;padding:10px 14px;margin-bottom:16px">
          <p style="font-size:11px;margin:0;color:#5D4037;line-height:1.7">
            <strong style="color:#E65100">⚠ Atenção:</strong> Não é um indicador de <em>qualidade</em> — é de <strong>contexto</strong>.
            Uma escola Nível 6 não é "pior" que Nível 1; ela é mais <em>complexa de gerir</em>
            (mais turnos, mais etapas, mais alunos).
          </p>
        </div>
        <details id="icg-saiba-mais" style="cursor:pointer">
          <summary style="font-size:13px;font-weight:700;color:var(--pri);padding:8px 0;user-select:none;list-style:none;display:flex;align-items:center;gap:6px">
            <span style="display:inline-block;transition:transform .2s" id="icg-chevron">▶</span> Saiba mais — Descrição dos 6 Níveis
          </summary>
          <div style="padding:12px 0 0;animation:fadeSlideUp .3s ease">
            <table style="width:100%;font-size:11.5px;border-collapse:separate;border-spacing:0;line-height:1.7">
              <tbody>
                <tr><td style="padding:8px 10px;border-bottom:1px solid #eee;vertical-align:top"><span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${ICG_COLORS[1]};vertical-align:middle;margin-right:8px"></span><strong>Nível 1</strong></td><td style="padding:8px 10px;border-bottom:1px solid #eee;color:#444">Até 50 matrículas, único turno, uma única etapa, Educação Infantil ou Anos Iniciais como etapa mais elevada.</td></tr>
                <tr style="background:#fafbfc"><td style="padding:8px 10px;border-bottom:1px solid #eee;vertical-align:top"><span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${ICG_COLORS[2]};vertical-align:middle;margin-right:8px"></span><strong>Nível 2</strong></td><td style="padding:8px 10px;border-bottom:1px solid #eee;color:#444">50 a 300 matrículas, dois turnos, até duas etapas de ensino, Educação Infantil ou Anos Iniciais como etapa mais elevada.</td></tr>
                <tr><td style="padding:8px 10px;border-bottom:1px solid #eee;vertical-align:top"><span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${ICG_COLORS[3]};vertical-align:middle;margin-right:8px"></span><strong>Nível 3</strong></td><td style="padding:8px 10px;border-bottom:1px solid #eee;color:#444">50 a 500 matrículas, dois turnos, duas ou três etapas de ensino, sendo Anos Finais a etapa mais elevada.</td></tr>
                <tr style="background:#fafbfc"><td style="padding:8px 10px;border-bottom:1px solid #eee;vertical-align:top"><span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${ICG_COLORS[4]};vertical-align:middle;margin-right:8px"></span><strong>Nível 4</strong></td><td style="padding:8px 10px;border-bottom:1px solid #eee;color:#444">150 a 1.000 matrículas, dois ou três turnos, duas ou três etapas de ensino, sendo Ensino Médio/profissional ou EJA como etapa mais elevada.</td></tr>
                <tr><td style="padding:8px 10px;border-bottom:1px solid #eee;vertical-align:top"><span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${ICG_COLORS[5]};vertical-align:middle;margin-right:8px"></span><strong>Nível 5</strong></td><td style="padding:8px 10px;border-bottom:1px solid #eee;color:#444">150 a 1.000 matrículas, três turnos, duas ou três etapas, sendo EJA a etapa mais elevada.</td></tr>
                <tr style="background:#fafbfc"><td style="padding:8px 10px;vertical-align:top"><span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${ICG_COLORS[6]};vertical-align:middle;margin-right:8px"></span><strong>Nível 6</strong></td><td style="padding:8px 10px;color:#444">Mais de 500 matrículas, três turnos, quatro ou mais etapas, sendo EJA a etapa mais elevada.</td></tr>
              </tbody>
            </table>
          </div>
        </details>
        <p style="font-size:9px;margin:12px 0 0;color:#999;line-height:1.5;font-style:italic">
          Fonte: INEP — Nota Técnica nº 40/2014 (Indicador de Complexidade de Gestão da Escola).
        </p>
      </div>
    </div>

    <!-- ═══ EIXO: Distribuição por Nível ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/panorama.png" alt=""></span>
      <span class="section-divider-text">Distribuição por Nível — ${anoAtual}</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title">Distribuição por Nível de Complexidade — ${anoAtual}</div>
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
      <span class="section-divider-text">Distribuição Territorial — ${anoAtual}</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="map-table-row d1">
      <div class="map-container">
        <div class="map-toolbar">
          <h3>Mapa — Nível Médio ICG <span id="icg-map-ano">${anoAtual}</span></h3>
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
        <div style="font-size:10px;color:var(--accent);padding:4px 12px 6px;font-weight:600;background:rgba(255,203,4,.08);border-radius:0 0 6px 6px;border-top:1px dashed rgba(255,203,4,.3)">
          📍 Clique em qualquer município — na tabela ou no mapa — para filtrar <strong>todas as visualizações</strong> desta seção (KPIs, gráficos e recortes). Clique novamente para desfiltrar.
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
      { label: `Escolas (${anoAtual})`, value: displayData.total_escolas || 0, icon: 'img/icons/escola.png', accent: 'green' },
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

    const munData = icg.por_municipio[anoAtual] || {};

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
          mouseout: e => { S.mapLayer.resetStyle(e.target); e.target.closeTooltip(); info.update(); },
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
    if (S.mapLayer) S.map.fitBounds(S.mapLayer.getBounds(), { padding: [20, 20] });
  };

  // ── CRE layer for ICG map ──
  const icgBuildCreMap = () => {
    if (!S.creGeo || !S.map) return;
    if (S.mapLayer) { S.mapLayer.remove(); S.mapLayer = null; }
    if (S.mapLegend) { S.mapLegend.remove(); S.mapLegend = null; }

    const munToCre = S.creLookup?.mun_to_cre || {};
    const munData = icg.por_municipio[anoAtual] || {};

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
    const munData = icg.por_municipio[anoAtual] || {};
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
    selAno.innerHTML = anos.map(a => `<option value="${a}" ${a === anoAtual ? 'selected' : ''}>${a}</option>`).join('');
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

  // Bind chevron animation for "Saiba mais" ICG
  const icgDetails = document.getElementById('icg-saiba-mais');
  if (icgDetails) {
    icgDetails.addEventListener('toggle', () => {
      const chevron = document.getElementById('icg-chevron');
      if (chevron) chevron.style.transform = icgDetails.open ? 'rotate(90deg)' : 'rotate(0deg)';
    });
  }
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
  { key: 'fund_ai', label: 'Anos Iniciais', short: 'Anos Iniciais' },
  { key: 'fund_af', label: 'Anos Finais', short: 'Anos Finais' },
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
  const anoSel = (S.anoSel && afd.serie_temporal[S.anoSel]) ? S.anoSel : ultimo;
  const st = afd.serie_temporal[anoSel];
  const lookup = afd.lookup_municipios || {};

  const displayData = S.munSel
    ? (afd.por_municipio?.[anoSel]?.[S.munSel] || st)
    : (S.creSel ? (() => {
        const creMuns = getCreMuns(S.creSel);
        const agg = { total_escolas: 0 };
        const munYear = afd.por_municipio?.[anoSel] || {};
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

    <!-- ═══ BLOCO INFORMATIVO: O que é a AFD? ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/sec_docentes.png" alt=""></span>
      <span class="section-divider-text">O que é a AFD?</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="chart-card" style="padding:0;overflow:hidden;border:1px solid rgba(0,90,50,.08)">
      <div style="display:grid;grid-template-columns:1fr 1fr">
        <div style="padding:20px 24px;background:linear-gradient(135deg,#f8fdf9 0%,#eef6f0 100%)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
            <img src="img/icons/sec_docentes.png" alt="" style="width:20px;height:20px">
            <span style="font-size:14px;font-weight:700;color:var(--pri)">Definição</span>
          </div>
          <p style="font-size:11.5px;margin:0 0 12px;color:#333;line-height:1.75">
            Classifica as <strong>docências</strong> (par professor × disciplina) em <strong>5 grupos</strong>
            conforme a adequação da formação do professor à disciplina que leciona.
            Baseado nos dados do <strong>Censo Escolar</strong> (INEP).
          </p>
          <p style="font-size:10.5px;margin:0 0 16px;color:#555;line-height:1.7">
            <strong>Unidade de análise:</strong> cada <em>docência</em> (professor + disciplina + turma).
            Um mesmo professor pode ser classificado em grupos diferentes se lecionar mais de uma disciplina.
          </p>
          <div style="background:rgba(0,171,78,.08);border:1px solid rgba(0,171,78,.2);border-radius:6px;padding:10px 14px">
            <p style="font-size:11px;margin:0;color:#1B5E20;line-height:1.7">
              <strong>Meta 15 do PNE</strong> (Lei nº 13.005/2014, art. 1º, Anexo — Meta 15): 100% dos docentes com formação em licenciatura
              na área em que atuam — <strong>G1 = 100%</strong> é o cenário ideal.
            </p>
          </div>
          <p style="font-size:9px;margin:10px 0 0;color:#999;line-height:1.5;font-style:italic">
            Fontes: INEP — Nota Técnica nº 20/2014 (definição dos 5 grupos); atualizada pela Nota Técnica nº 1/2024.<br>
            PNE — Lei nº 13.005/2014 (Meta 15). LDB — Lei nº 9.394/1996, art. 62.
          </p>
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
      <span class="section-divider-text">Distribuição por Grupo — ${anoSel}</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title">Percentual por Grupo de Adequação — por Etapa (${anoSel})</div>
        <div style="height:300px"><canvas id="afd-chart-etapa"></canvas></div>
        <div class="chart-source">${FONTE_AFD}</div>
      </div>
    </div>

    <!-- ═══ EIXO: Evolução Temporal ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/sec_evolucao.png" alt=""></span>
      <span class="section-divider-text">Evolução Temporal (${primeiro}–${ultimo})</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title" id="afd-evol-title">Evolução por Grupo — Selecione abaixo</div>
        <div id="afd-evol-group-pills" style="display:flex;flex-wrap:wrap;gap:5px;margin:6px 0"></div>
        <p style="font-size:10px;color:var(--text-sec);margin:0 0 6px;font-style:italic">💡 Clique na legenda do gráfico para filtrar por etapa</p>
        <div style="height:280px"><canvas id="afd-chart-evol-unified"></canvas></div>
        <div class="chart-source">${FONTE_AFD}</div>
      </div>
    </div>

    <!-- ═══ EIXO: Distribuição Territorial ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/territorial.png" alt=""></span>
      <span class="section-divider-text">Distribuição Territorial — ${anoSel}</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="map-table-row d1">
      <div class="map-container">
        <div class="map-toolbar">
          <h3>Mapa AFD — <span id="afd-map-ano">${anoSel}</span></h3>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <select id="sel-afd-map-grupo" style="font-size:11px;padding:3px 8px;border-radius:5px;border:1px solid #ddd;font-family:Inter">
              <option value="g1" selected>Grupo 1 (Adequado)</option>
              <option value="g2">Grupo 2</option>
              <option value="g3">Grupo 3</option>
              <option value="g4">Grupo 4</option>
              <option value="g5">Grupo 5 (Inadequado)</option>
            </select>
            <select id="sel-afd-map-etapa" style="font-size:11px;padding:3px 8px;border-radius:5px;border:1px solid #ddd;font-family:Inter">
              <option value="fund_total" selected>Fund. Total</option>
              <option value="fund_ai">Anos Iniciais</option>
              <option value="fund_af">Anos Finais</option>
              <option value="medio">Médio</option>
              <option value="eja_fund">EJA Fund.</option>
              <option value="eja_medio">EJA Médio</option>
            </select>
            <div class="map-layer-toggle">
              <button class="map-layer-btn active" id="afd-btn-layer-mun">Municípios</button>
              <button class="map-layer-btn" id="afd-btn-layer-cre">CREs</button>
            </div>
          </div>
        </div>
        <div id="afd-map-leaflet" style="height:380px;border-radius:8px"></div>
      </div>
      <div class="table-wrapper" id="afd-table-wrapper">
        <div class="table-header">
          <h3>Tabela de Municípios — AFD</h3>
          <input type="text" class="table-search" id="afd-mun-search" placeholder="Buscar...">
        </div>
        <div style="font-size:10px;color:var(--accent);padding:4px 12px 6px;font-weight:600;background:rgba(255,203,4,.08);border-radius:0 0 6px 6px;border-top:1px dashed rgba(255,203,4,.3)">
          📍 Clique em qualquer município — na tabela ou no mapa — para filtrar <strong>todas as visualizações</strong> desta seção (KPIs, gráficos e recortes). Clique novamente para desfiltrar.
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
      { label: `G1 Fundamental (${anoSel})`, value: displayData.fund_total?.g1 != null ? displayData.fund_total.g1.toFixed(1) + '%' : '—', icon: 'img/icons/sec_docentes.png', accent: (displayData.fund_total?.g1 || 0) >= 60 ? 'green' : 'red', noFormat: true },
      { label: `G1 Ens. Médio (${anoSel})`, value: displayData.medio?.g1 != null ? displayData.medio.g1.toFixed(1) + '%' : '—', icon: 'img/icons/sec_docentes.png', accent: (displayData.medio?.g1 || 0) >= 60 ? 'green' : 'red', noFormat: true },
      { label: 'G3 — Outra Licenciatura', value: g3General + '%', icon: 'img/icons/politicas.png', accent: parseFloat(g3General) > 25 ? 'red' : 'green', noFormat: true },
      { label: `Escolas (${anoSel})`, value: displayData.total_escolas || st.total_escolas || 0, icon: 'img/icons/escola.png', accent: 'green' },
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

  // ── Chart 1: Grouped bar by etapa (uses header year filter) ──
  const etapaEl = document.getElementById('afd-chart-etapa');
  if (etapaEl) {
    const chartEtapas = AFD_ETAPAS.filter(e => e.key !== 'fund_total' && e.key !== 'eja_medio' && displayData[e.key]);
    const ejaF = displayData['eja_fund'];
    const ejaM = displayData['eja_medio'];
    const mergedEjaLabel = (ejaF && ejaM) ? 'EJA' : null;
    const labels = chartEtapas.map(e => e.key === 'eja_fund' && mergedEjaLabel ? mergedEjaLabel : e.short);
    const gKeys = ['g1','g2','g3','g4','g5'];
    S.charts.push(new Chart(etapaEl, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: gKeys.map(gk => ({
          label: AFD_GROUPS[gk].short,
          data: chartEtapas.map(e => {
            if (e.key === 'eja_fund' && mergedEjaLabel && ejaF && ejaM) {
              return +((ejaF[gk] + ejaM[gk]) / 2).toFixed(1);
            }
            return displayData[e.key]?.[gk] || 0;
          }),
          backgroundColor: AFD_GROUPS[gk].color + 'CC',
          borderColor: AFD_GROUPS[gk].color,
          borderWidth: 0.5,
          borderRadius: 3,
        }))
      },
      options: { ...CHART_DEFAULTS,
        plugins: { ...CHART_DEFAULTS.plugins,
          legend: { display: true, labels: { font: { family: 'Inter', size: 10 }, boxWidth: 10, padding: 6 } },
          datalabels: { display: ctx => ctx.dataset.data[ctx.dataIndex] > 0, color: '#333', font: { family: 'Inter', size: 8, weight: '700' }, anchor: 'end', align: 'top', formatter: v => v.toFixed(0) + '%' } },
        scales: { x: { grid: { display: false }, ticks: { font: { family: 'Inter', size: 10, weight: '600' } } },
          y: { max: 100, grid: { color: COLORS.gridLine }, ticks: { font: { family: 'Inter', size: 9 }, callback: v => v + '%' }, grace: '5%' } }
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

  // ── Chart 2: Unified evolution with group + etapa pills ──
  const evolContainer = document.getElementById('afd-chart-evol-unified');
  if (evolContainer) {
    const evolEtapas = [
      { key: 'fund_ai', label: 'Anos Iniciais', color: COLORS.pri },
      { key: 'fund_af', label: 'Anos Finais', color: '#F57C00' },
      { key: 'medio', label: 'Ensino Médio', color: COLORS.red },
      { key: 'eja_fund', label: 'EJA', color: COLORS.federal },
    ];
    const evolGroups = ['g1','g2','g3','g4','g5'];
    let selGroup = 'g1';
    let evolChart = null;

    const buildEvolChart = () => {
      if (evolChart) { evolChart.destroy(); S.charts = S.charts.filter(c => c !== evolChart); }
      const title = document.getElementById('afd-evol-title');
      if (title) title.textContent = `Evolução ${AFD_GROUPS[selGroup].short} (${AFD_GROUPS[selGroup].label.split('—')[1]?.trim() || ''}) — por Etapa`;
      evolChart = new Chart(evolContainer, {
        type: 'line',
        data: {
          labels: anos,
          datasets: evolEtapas.map(e => ({
            label: e.label,
            data: geoTs.map(s => s?.[e.key]?.[selGroup] ?? null),
            borderColor: e.color,
            backgroundColor: e.color + '22',
            tension: .3, pointRadius: 3, borderWidth: 2.5, fill: false,
          }))
        },
        options: { ...CHART_DEFAULTS, layout: { padding: { top: 20 } },
          plugins: { ...CHART_DEFAULTS.plugins,
            legend: { display: true, labels: { font: { family: 'Inter', size: 10, weight: '600' }, boxWidth: 10, padding: 6, usePointStyle: false }, onClick: Chart.defaults.plugins.legend.onClick },
            datalabels: { display: false } },
          scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: true, suggestedMax: selGroup === 'g1' ? 100 : 40, ticks: { ...CHART_DEFAULTS.scales.y?.ticks, callback: v => v + '%' } } }
        }
      });
      S.charts.push(evolChart);
    };

    // Build group pills
    const groupPillsEl = document.getElementById('afd-evol-group-pills');
    if (groupPillsEl) {
      groupPillsEl.innerHTML = '<span style="font-size:10px;font-weight:700;color:#555;margin-right:4px">Grupo:</span>' +
        evolGroups.map(gk => {
          const g = AFD_GROUPS[gk];
          return `<button class="flx-pill${gk === selGroup ? ' active' : ''}" data-gk="${gk}" style="--pill-color:${g.color};font-size:10px;padding:3px 10px;border-radius:12px;border:1.5px solid ${g.color};background:${gk === selGroup ? g.color : 'transparent'};color:${gk === selGroup ? '#fff' : g.color};cursor:pointer;font-weight:600;font-family:Inter;transition:all .15s">${g.short}</button>`;
        }).join('');
      groupPillsEl.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          selGroup = btn.dataset.gk;
          groupPillsEl.querySelectorAll('button').forEach(b => {
            const c = AFD_GROUPS[b.dataset.gk].color;
            b.style.background = b.dataset.gk === selGroup ? c : 'transparent';
            b.style.color = b.dataset.gk === selGroup ? '#fff' : c;
            b.classList.toggle('active', b.dataset.gk === selGroup);
          });
          buildEvolChart();
        });
      });
    }

    buildEvolChart();
  }

  // ── Map: AFD by municipality ──
  const AFD_MAP_BREAKS = [
    { min: 0,   max: 30, color: '#E53935', label: '< 30% (Crítico)' },
    { min: 30,  max: 50, color: '#FB8C00', label: '30–50%' },
    { min: 50,  max: 70, color: '#FFCB04', label: '50–70%' },
    { min: 70,  max: 85, color: '#66BB6A', label: '70–85%' },
    { min: 85,  max: 101, color: '#2874A6', label: '> 85% (Adequado)' },
  ];
  function getAfdColor(v) {
    for (const b of AFD_MAP_BREAKS) { if (v >= b.min && v < b.max) return b.color; }
    return '#f0f0f0';
  }

  const afdBuildMap = () => {
    if (!S.geo) return;
    const mapEl = document.getElementById('afd-map-leaflet');
    if (!mapEl) return;
    const munData = afd.por_municipio[anoSel] || {};
    const grp = document.getElementById('sel-afd-map-grupo')?.value || 'g1';
    const etapa = document.getElementById('sel-afd-map-etapa')?.value || 'fund_total';
    const ETAPA_LABELS = { fund_total: 'Fund.', fund_ai: 'Anos Iniciais', fund_af: 'Anos Finais', medio: 'Médio', eja_fund: 'EJA Fund.', eja_medio: 'EJA Médio' };
    const GRP_LABELS = { g1: 'G1', g2: 'G2', g3: 'G3', g4: 'G4', g5: 'G5' };

    destroyMap();
    S.map = L.map('afd-map-leaflet', { zoomControl: true, scrollWheelZoom: true, attributionControl: false })
      .setView([-29.7, -53.5], 6.5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', { maxZoom: 14 }).addTo(S.map);

    const info = L.control({ position: 'topright' });
    info.onAdd = function () { this._div = L.DomUtil.create('div', 'map-info-panel'); this.update(); return this._div; };
    info.update = function (props, md) {
      if (!props) { this._div.innerHTML = '<h4>Passe o mouse sobre um município</h4>'; return; }
      const nome = props.nome || props.cod_mun;
      const etd = md?.[etapa];
      if (!etd) { this._div.innerHTML = `<h4>${nome}</h4><div style="color:#999;font-size:11px">Sem dados AFD</div>`; return; }
      this._div.innerHTML = `
        <h4>${nome}</h4>
        <div class="info-row"><span class="info-label">Escolas</span><span class="info-value">${md.total_escolas}</span></div>
        ${['g1','g2','g3','g4','g5'].map(g => `<div class="info-row"><span class="info-label">${GRP_LABELS[g]} ${ETAPA_LABELS[etapa]}</span><span class="info-value" style="color:${AFD_GROUPS[g]?.color || '#333'}">${etd[g]?.toFixed(1) ?? '—'}%</span></div>`).join('')}
      `;
    };
    info.addTo(S.map);

    S.mapLayer = L.geoJSON(S.geo, {
      style: feature => {
        const cod = feature.properties.cod_mun?.substring(0, 7);
        const md = munData[cod];
        const v = md?.[etapa]?.[grp] || 0;
        return { fillColor: v > 0 ? getAfdColor(v) : '#f0f0f0', weight: 0.8, opacity: 1, color: '#fff', fillOpacity: 0.85 };
      },
      onEachFeature: (feature, layer) => {
        const cod = feature.properties.cod_mun?.substring(0, 7);
        const md = munData[cod];
        layer.on({
          mouseover: e => { e.target.setStyle({ weight: 2.5, color: '#FFB300', fillOpacity: 0.95 }); e.target.bringToFront(); info.update(feature.properties, md); },
          mouseout: e => { S.mapLayer.resetStyle(e.target); e.target.closeTooltip(); info.update(); },
          click: () => { S.munSel = S.munSel === cod ? null : cod; refreshActiveTab(); }
        });
      }
    }).addTo(S.map);

    const legend = L.control({ position: 'bottomleft' });
    legend.onAdd = function () {
      const div = L.DomUtil.create('div', 'map-legend');
      div.innerHTML = `<h4>% ${GRP_LABELS[grp]} ${ETAPA_LABELS[etapa]}</h4>` +
        AFD_MAP_BREAKS.slice().reverse().map(b =>
          `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${b.color}"></div><span>${b.label}</span></div>`
        ).join('') + '<div class="map-legend-row" style="margin-top:4px"><div class="map-legend-swatch" style="background:#f0f0f0"></div><span>Sem dados</span></div>';
      return div;
    };
    legend.addTo(S.map);
    S.mapLegend = legend;
    if (S.mapLayer) S.map.fitBounds(S.mapLayer.getBounds(), { padding: [20, 20] });
  };

  // ── CRE layer for AFD map ──
  const afdBuildCreMap = () => {
    if (!S.creGeo || !S.map) return;
    if (S.mapLayer) { S.mapLayer.remove(); S.mapLayer = null; }
    if (S.mapLegend) { S.mapLegend.remove(); S.mapLegend = null; }
    const grp = document.getElementById('sel-afd-map-grupo')?.value || 'g1';
    const etapa = document.getElementById('sel-afd-map-etapa')?.value || 'fund_total';
    const ETAPA_LABELS = { fund_total: 'Fund.', fund_ai: 'Anos Iniciais', fund_af: 'Anos Finais', medio: 'Médio', eja_fund: 'EJA Fund.', eja_medio: 'EJA Médio' };
    const GRP_LABELS = { g1: 'G1', g2: 'G2', g3: 'G3', g4: 'G4', g5: 'G5' };
    const munToCre = S.creLookup?.mun_to_cre || {};
    const munData = afd.por_municipio[anoSel] || {};
    const creData = {};
    for (const [cod, v] of Object.entries(munData)) {
      const cre = munToCre[cod]?.cod_cre;
      if (!cre) continue;
      if (!creData[cre]) creData[cre] = { sumVal: 0, count: 0, nome: munToCre[cod]?.nome_cre || cre };
      const val = v?.[etapa]?.[grp];
      if (val != null) { creData[cre].sumVal += val; creData[cre].count++; }
    }
    for (const c of Object.values(creData)) c.avg = c.count > 0 ? c.sumVal / c.count : 0;

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
        layer.bindTooltip(`<strong>${nome}</strong><br>${GRP_LABELS[grp]} ${ETAPA_LABELS[etapa]}: ${d?.avg?.toFixed(1) ?? '—'}%<br>${d?.count || 0} municípios`, { sticky: true });
        layer.on('click', () => { S.creSel = cod; const selCre = document.getElementById('sel-cre'); if (selCre) selCre.value = cod; populateMunDropdown(cod); refreshActiveTab(); });
      }
    }).addTo(S.map);

    const creLegend = L.control({ position: 'bottomleft' });
    creLegend.onAdd = function () {
      const div = L.DomUtil.create('div', 'map-legend');
      div.innerHTML = `<h4>% ${GRP_LABELS[grp]} ${ETAPA_LABELS[etapa]} (CREs)</h4>` +
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
    const munData = afd.por_municipio[anoSel] || {};
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

  // Bind AFD map selects
  const afdUpdateActiveMap = () => {
    const afdBtnCre2 = document.getElementById('afd-btn-layer-cre');
    if (afdBtnCre2?.classList.contains('active')) { afdBuildCreMap(); } else { afdBuildMap(); }
  };
  document.getElementById('sel-afd-map-grupo')?.addEventListener('change', afdUpdateActiveMap);
  document.getElementById('sel-afd-map-etapa')?.addEventListener('change', afdUpdateActiveMap);

  // Re-populate topbar filters
  const selAno = document.getElementById('sel-ano');
  if (selAno) {
    selAno.innerHTML = anos.map(a => `<option value="${a}" ${a === anoSel ? 'selected' : ''}>${a}</option>`).join('');
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
// DISTORÇÃO IDADE-SÉRIE (TDI)
// ══════════════════════════════════════════════════════════

const FONTE_TDI = 'Fonte: INEP — Indicador de Distorção Idade-Série';

function renderTdi() {
  const main = document.getElementById('main-content');
  destroyCharts(); destroyMap();

  const tdi = S.tdi;
  if (!tdi) {
    main.innerHTML = `
      <div class="section-sticky">
        ${sectionBanner('img/icons/politicas.png', 'Distorção Idade-Série', getRedeLabel() + ' do RS')}
        ${redeToggleHTML()}
      </div>
      <div style="text-align:center;padding:60px 20px;color:var(--text-sec);">
        <p style="font-size:1.1rem;font-weight:600;">Dados de Distorção Idade-Série não disponíveis para a ${getRedeLabel()}</p>
      </div>`;
    bindRedeToggle();
    return;
  }

  const anos = Object.keys(tdi.serie_temporal).sort();
  const ultimo = anos[anos.length - 1];
  const primeiro = anos[0];
  const anoSel = (S.anoSel && tdi.serie_temporal[S.anoSel]) ? S.anoSel : ultimo;
  const st = tdi.serie_temporal[anoSel];
  const lookup = tdi.lookup_municipios || {};

  // Geo-aware display data
  const displayData = S.munSel
    ? (tdi.por_municipio?.[anoSel]?.[S.munSel] || st)
    : (S.creSel ? (() => {
        const creMuns = getCreMuns(S.creSel);
        const munYear = tdi.por_municipio?.[anoSel] || {};
        const agg = { tdi_fund: [], tdi_ai: [], tdi_af: [], tdi_med: [], n_escolas: 0 };
        for (const cod of creMuns) {
          const m = munYear[cod]; if (!m) continue;
          if (m.tdi_fund != null) agg.tdi_fund.push(m.tdi_fund);
          if (m.tdi_ai != null) agg.tdi_ai.push(m.tdi_ai);
          if (m.tdi_af != null) agg.tdi_af.push(m.tdi_af);
          if (m.tdi_med != null) agg.tdi_med.push(m.tdi_med);
          agg.n_escolas += m.n_escolas || 0;
        }
        const med = arr => arr.length ? +(arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1) : null;
        return { tdi_fund: med(agg.tdi_fund), tdi_ai: med(agg.tdi_ai), tdi_af: med(agg.tdi_af), tdi_med: med(agg.tdi_med), n_escolas: agg.n_escolas };
      })() : st);

  // Geo label
  let geoLabel = getRedeLabel() + ' do RS';
  if (S.munSel && lookup[S.munSel]) geoLabel = lookup[S.munSel];
  else if (S.creSel) geoLabel = (S.creLookup?.cre_list?.find(c => c.cod_cre === S.creSel)?.nome_cre) || `CRE ${S.creSel}`;

  // Previous year for delta
  const anoIdx = anos.indexOf(anoSel);
  const anoPrev = anoIdx > 0 ? anos[anoIdx - 1] : null;
  const stPrev = anoPrev ? tdi.serie_temporal[anoPrev] : null;

  main.innerHTML = `
    <div class="section-sticky">
      ${sectionBanner('img/icons/politicas.png', 'Distorção Idade-Série', geoLabel)}
      ${redeToggleHTML()}
      <div class="kpi-strip" id="tdi-kpis" style="grid-template-columns:repeat(3,1fr)"></div>
    </div>

    <!-- ═══ BLOCO INFORMATIVO: O que é a TDI? ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/politicas.png" alt=""></span>
      <span class="section-divider-text">O que é a TDI?</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="chart-card" style="padding:0;overflow:hidden;border:1px solid rgba(0,90,50,.08)">
      <div style="padding:20px 24px;background:linear-gradient(135deg,#f8fdf9 0%,#eef6f0 100%)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          <img src="img/icons/politicas.png" alt="" style="width:20px;height:20px">
          <span style="font-size:14px;font-weight:700;color:var(--pri)">Definição</span>
        </div>
        <p style="font-size:11.5px;margin:0 0 12px;color:#333;line-height:1.75">
          A <strong>Taxa de Distorção Idade-Série (TDI)</strong> indica o percentual de alunos com <strong>idade superior à recomendada</strong>
          para a série que frequentam. Um aluno é considerado em situação de distorção quando sua idade é
          <strong>2 anos ou mais</strong> acima da idade ideal para a série.
        </p>
        <p style="font-size:9px;margin:10px 0 0;color:#999;line-height:1.5;font-style:italic">
          Fonte: INEP — Censo Escolar da Educação Básica.
        </p>
      </div>
    </div>

    <!-- ═══ EIXO: Evolução Temporal ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/politicas.png" alt=""></span>
      <span class="section-divider-text">Evolução Temporal (${primeiro}–${ultimo})</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title" id="tdi-evol-title">Taxa de Distorção Idade-Série — Evolução</div>
        <p style="font-size:10px;color:#777;margin:4px 0 2px;font-style:italic">💡 Clique na legenda para ocultar/exibir etapas</p>
        <div style="height:300px"><canvas id="tdi-chart-evol"></canvas></div>
        <div class="chart-source">${FONTE_TDI}</div>
      </div>
    </div>



    <!-- ═══ EIXO: Distribuição Territorial ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/territorial.png" alt=""></span>
      <span class="section-divider-text">Distribuição Territorial — ${anoSel}</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="map-table-row d1">
      <div class="map-container">
        <div class="map-toolbar">
          <h3>Mapa — TDI Fundamental <span id="tdi-map-ano">${anoSel}</span></h3>
          <div class="map-layer-toggle">
            <button class="map-layer-btn active" id="tdi-btn-layer-mun">Municípios</button>
            <button class="map-layer-btn" id="tdi-btn-layer-cre">CREs</button>
          </div>
        </div>
        <div id="tdi-map-leaflet" style="height:380px;border-radius:8px"></div>
      </div>
      <div class="table-wrapper" id="tdi-table-wrapper">
        <div class="table-header">
          <h3>Tabela de Municípios — TDI</h3>
          <input type="text" class="table-search" id="tdi-mun-search" placeholder="Buscar...">
        </div>
        <div style="font-size:10px;color:var(--accent);padding:4px 12px 6px;font-weight:600;background:rgba(255,203,4,.08);border-radius:0 0 6px 6px;border-top:1px dashed rgba(255,203,4,.3)">
          📍 Clique em qualquer município — na tabela ou no mapa — para filtrar <strong>todas as visualizações</strong> desta seção.
        </div>
        <div style="max-height:400px;overflow-y:auto">
          <table class="data-table" id="tdi-mun-table">
            <thead><tr>
              <th style="cursor:pointer" data-sort-key="rank"># ↕</th><th style="cursor:pointer" data-sort-key="nome">Município ↕</th><th style="cursor:pointer" data-sort-key="n_escolas">Esc. ↕</th>
              <th style="cursor:pointer" data-sort-key="tdi_fund">Fund. ↕</th><th style="cursor:pointer" data-sort-key="tdi_ai">AI ↕</th><th style="cursor:pointer" data-sort-key="tdi_af">AF ↕</th><th style="cursor:pointer" data-sort-key="tdi_med">Médio ↕</th>
            </tr></thead>
            <tbody></tbody>
          </table>
        </div>
        <div class="chart-source">${FONTE_TDI}</div>
      </div>
    </div>
  `;

  // ── KPIs ──
  const strip = document.getElementById('tdi-kpis');
  if (strip) {
    const deltaFn = (cur, prev) => (cur != null && prev != null) ? +(cur - prev).toFixed(1) : null;
    const kpis = [
      { label: `TDI Anos Iniciais (${anoSel})`, value: displayData.tdi_ai, delta: deltaFn(displayData.tdi_ai, stPrev?.tdi_ai), icon: 'img/icons/infantil.png' },
      { label: `TDI Anos Finais (${anoSel})`, value: displayData.tdi_af, delta: deltaFn(displayData.tdi_af, stPrev?.tdi_af), icon: 'img/icons/fundamental.png' },
      { label: `TDI Ens. Médio (${anoSel})`, value: displayData.tdi_med, delta: deltaFn(displayData.tdi_med, stPrev?.tdi_med), icon: 'img/icons/medio.png' },
    ];
    strip.innerHTML = kpis.map((k, i) => {
      const val = k.value != null ? k.value.toFixed(1) + '%' : '—';
      const accent = k.value == null ? 'green' : k.value > 20 ? 'red' : k.value > 10 ? 'yellow' : 'green';
      const dSign = k.delta > 0 ? '+' : '';
      // For TDI, decrease is good (invert arrow logic)
      const dClass = k.delta == null ? 'neutral' : k.delta > 0 ? 'down' : k.delta < 0 ? 'up' : 'neutral';
      const dArrow = k.delta == null ? '' : k.delta > 0 ? '↑' : k.delta < 0 ? '↓' : '→';
      return `
      <div class="kpi-card accent-${accent}" style="animation-delay:${i * 80}ms">
        <div class="kpi-top">
          <span class="kpi-label">${k.label}</span>
          <img class="kpi-icon" src="${k.icon}" alt="">
        </div>
        <div class="kpi-body"><span class="kpi-value">${val}</span></div>
        ${k.delta != null ? `<div class="kpi-footer"><span class="kpi-delta ${dClass}">${dArrow} ${dSign}${k.delta.toFixed(1)}pp</span><span class="kpi-abs">vs ${anoPrev}</span></div>` : ''}
      </div>`;
    }).join('');
  }

  // ── Geo-aware time series helper ──
  const tdiGeoSeries = (anos) => {
    if (!S.munSel && !S.creSel) return anos.map(a => tdi.serie_temporal[a]);
    return anos.map(a => {
      const munYear = tdi.por_municipio?.[a] || {};
      if (S.munSel) return munYear[S.munSel] || null;
      if (S.creSel) {
        const creMuns = getCreMuns(S.creSel);
        const vals = { tdi_fund: [], tdi_ai: [], tdi_af: [], tdi_med: [] };
        for (const cod of creMuns) {
          const m = munYear[cod]; if (!m) continue;
          for (const k of Object.keys(vals)) if (m[k] != null) vals[k].push(m[k]);
        }
        const med = arr => arr.length ? +(arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1) : null;
        return { tdi_fund: med(vals.tdi_fund), tdi_ai: med(vals.tdi_ai), tdi_af: med(vals.tdi_af), tdi_med: med(vals.tdi_med) };
      }
      return tdi.serie_temporal[a];
    });
  };
  const geoTs = tdiGeoSeries(anos);

  // ── Chart 1: Evolution (clickable legend to filter) ──
  const evolEl = document.getElementById('tdi-chart-evol');
  if (evolEl) {
    const metrics = [
      { key: 'tdi_ai', label: 'Anos Iniciais', color: COLORS.fundAI },
      { key: 'tdi_af', label: 'Anos Finais', color: '#F57C00' },
      { key: 'tdi_med', label: 'Ensino Médio', color: COLORS.red },
    ];

    S.charts.push(new Chart(evolEl, {
      type: 'line',
      data: {
        labels: anos,
        datasets: metrics.map(m => ({
          label: m.label,
          data: geoTs.map(s => s?.[m.key] ?? null),
          borderColor: m.color,
          backgroundColor: m.color + '22',
          tension: .3, pointRadius: 4, borderWidth: 2.5, fill: false,
          pointHoverRadius: 7,
        }))
      },
      options: { ...CHART_DEFAULTS, layout: { padding: { top: 22 } },
        plugins: { ...CHART_DEFAULTS.plugins,
          legend: {
            display: true,
            onClick: (e, legendItem, legend) => {
              const idx = legendItem.datasetIndex;
              const ci = legend.chart;
              ci.getDatasetMeta(idx).hidden = !ci.getDatasetMeta(idx).hidden;
              ci.update();
            },
            labels: { font: { family: 'Inter', size: 11, weight: '600' }, boxWidth: 12, padding: 8, usePointStyle: false }
          },
          datalabels: { display: true, anchor: 'end', align: 'top', offset: 4, font: { family: 'Inter', size: 10, weight: '700' }, color: '#333', formatter: v => v != null ? v.toFixed(1) + '%' : '', clamp: true }
        },
        scales: { ...CHART_DEFAULTS.scales,
          y: { ...CHART_DEFAULTS.scales.y, beginAtZero: true, suggestedMax: 35, ticks: { ...CHART_DEFAULTS.scales.y?.ticks, callback: v => v + '%' }, grace: '10%' }
        }
      }
    }));
  }

  // ── Map: TDI by municipality ──
  const TDI_MAP_BREAKS = [
    { min: 0,   max: 5,  color: '#2874A6', label: '< 5% (Excelente)' },
    { min: 5,   max: 10, color: '#66BB6A', label: '5–10%' },
    { min: 10,  max: 15, color: '#FFCB04', label: '10–15%' },
    { min: 15,  max: 20, color: '#FB8C00', label: '15–20%' },
    { min: 20,  max: 100, color: '#E53935', label: '> 20% (Crítico)' },
  ];
  function getTdiColor(v) {
    for (const b of TDI_MAP_BREAKS) { if (v >= b.min && v < b.max) return b.color; }
    return '#f0f0f0';
  }

  const tdiBuildMap = () => {
    if (!S.geo) return;
    const mapEl = document.getElementById('tdi-map-leaflet');
    if (!mapEl) return;
    const munData = tdi.por_municipio[anoSel] || {};

    destroyMap();
    S.map = L.map('tdi-map-leaflet', { zoomControl: true, scrollWheelZoom: true, attributionControl: false })
      .setView([-29.7, -53.5], 6.5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', { maxZoom: 14 }).addTo(S.map);

    const info = L.control({ position: 'topright' });
    info.onAdd = function () { this._div = L.DomUtil.create('div', 'map-info-panel'); this.update(); return this._div; };
    info.update = function (props, md) {
      if (!props) { this._div.innerHTML = '<h4>Passe o mouse sobre um município</h4>'; return; }
      const nome = props.nome || props.cod_mun;
      if (!md) { this._div.innerHTML = `<h4>${nome}</h4><div style="color:#999;font-size:11px">Sem dados TDI</div>`; return; }
      this._div.innerHTML = `
        <h4>${nome}</h4>
        <div class="info-row"><span class="info-label">TDI Fund.</span><span class="info-value" style="color:${getTdiColor(md.tdi_fund||0)}">${md.tdi_fund?.toFixed(1) ?? '—'}%</span></div>
        <div class="info-row"><span class="info-label">TDI Anos Iniciais</span><span class="info-value">${md.tdi_ai?.toFixed(1) ?? '—'}%</span></div>
        <div class="info-row"><span class="info-label">TDI Anos Finais</span><span class="info-value">${md.tdi_af?.toFixed(1) ?? '—'}%</span></div>
        <div class="info-row"><span class="info-label">TDI Médio</span><span class="info-value" style="color:${getTdiColor(md.tdi_med||0)}">${md.tdi_med?.toFixed(1) ?? '—'}%</span></div>
        <div class="info-row"><span class="info-label">Escolas</span><span class="info-value">${md.n_escolas || '—'}</span></div>
      `;
    };
    info.addTo(S.map);

    S.mapLayer = L.geoJSON(S.geo, {
      style: feature => {
        const cod = feature.properties.cod_mun?.substring(0, 7);
        const md = munData[cod];
        const v = md?.tdi_fund ?? -1;
        return { fillColor: v >= 0 ? getTdiColor(v) : '#f0f0f0', weight: 0.8, opacity: 1, color: '#fff', fillOpacity: 0.85 };
      },
      onEachFeature: (feature, layer) => {
        const cod = feature.properties.cod_mun?.substring(0, 7);
        const md = munData[cod];
        layer.on({
          mouseover: e => { e.target.setStyle({ weight: 2.5, color: '#FFB300', fillOpacity: 0.95 }); e.target.bringToFront(); info.update(feature.properties, md); },
          mouseout: e => { S.mapLayer.resetStyle(e.target); e.target.closeTooltip(); info.update(); },
          click: () => { S.munSel = S.munSel === cod ? null : cod; refreshActiveTab(); }
        });
      }
    }).addTo(S.map);

    const legend = L.control({ position: 'bottomleft' });
    legend.onAdd = function () {
      const div = L.DomUtil.create('div', 'map-legend');
      div.innerHTML = '<h4>TDI Fundamental (%)</h4>' +
        TDI_MAP_BREAKS.slice().reverse().map(b =>
          `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${b.color}"></div><span>${b.label}</span></div>`
        ).join('') + '<div class="map-legend-row" style="margin-top:4px"><div class="map-legend-swatch" style="background:#f0f0f0"></div><span>Sem dados</span></div>';
      return div;
    };
    legend.addTo(S.map);
    S.mapLegend = legend;
    if (S.mapLayer) S.map.fitBounds(S.mapLayer.getBounds(), { padding: [20, 20] });
  };

  // ── CRE layer ──
  const tdiBuildCreMap = () => {
    if (!S.creGeo || !S.map) return;
    if (S.mapLayer) { S.mapLayer.remove(); S.mapLayer = null; }
    if (S.mapLegend) { S.mapLegend.remove(); S.mapLegend = null; }
    const munToCre = S.creLookup?.mun_to_cre || {};
    const munData = tdi.por_municipio[anoSel] || {};
    const creData = {};
    for (const [cod, v] of Object.entries(munData)) {
      const cre = munToCre[cod]?.cod_cre;
      if (!cre) continue;
      if (!creData[cre]) creData[cre] = { sum: 0, count: 0, nome: munToCre[cod]?.nome_cre || cre };
      if (v.tdi_fund != null) { creData[cre].sum += v.tdi_fund; creData[cre].count++; }
    }
    for (const c of Object.values(creData)) c.avg = c.count > 0 ? c.sum / c.count : 0;

    S.mapLayer = L.geoJSON(S.creGeo, {
      style: feature => {
        const cod = feature.properties.cod_cre;
        const avg = creData[cod]?.avg || 0;
        return { fillColor: avg > 0 ? getTdiColor(avg) : '#f0f0f0', weight: 2, color: '#fff', fillOpacity: 0.8 };
      },
      onEachFeature: (feature, layer) => {
        const cod = feature.properties.cod_cre;
        const nome = feature.properties.nome_cre || cod;
        const d = creData[cod];
        layer.bindTooltip(`<strong>${nome}</strong><br>TDI Fund.: ${d?.avg?.toFixed(1) ?? '—'}%<br>${d?.count || 0} municípios`, { sticky: true });
        layer.on('click', () => { S.creSel = cod; const selCre = document.getElementById('sel-cre'); if (selCre) selCre.value = cod; populateMunDropdown(cod); refreshActiveTab(); });
      }
    }).addTo(S.map);

    const creLegend = L.control({ position: 'bottomleft' });
    creLegend.onAdd = function () {
      const div = L.DomUtil.create('div', 'map-legend');
      div.innerHTML = '<h4>TDI Fund. (CREs)</h4>' +
        TDI_MAP_BREAKS.slice().reverse().map(b => `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${b.color}"></div><span>${b.label}</span></div>`).join('');
      return div;
    };
    creLegend.addTo(S.map);
    S.mapLegend = creLegend;
  };

  // ── Table ──
  let tdiSortCol = 'tdi_fund', tdiSortAsc = false;
  const tdiBuildMunTable = () => {
    const tbody = document.querySelector('#tdi-mun-table tbody');
    if (!tbody) return;
    const munData = tdi.por_municipio[anoSel] || {};
    let entries = Object.entries(munData).map(([cod, md]) => ({ cod, nome: lookup[cod] || cod, ...md }));
    if (S.creSel && S.creLookup?.mun_to_cre) entries = entries.filter(e => S.creLookup.mun_to_cre[e.cod]?.cod_cre === S.creSel);
    if (S.munSel) entries = entries.filter(e => e.cod === S.munSel);
    entries.sort((a, b) => {
      let va = a[tdiSortCol], vb = b[tdiSortCol];
      if (tdiSortCol === 'nome') { va = (va||'').toLowerCase(); vb = (vb||'').toLowerCase(); return tdiSortAsc ? va.localeCompare(vb) : vb.localeCompare(va); }
      va = va ?? -Infinity; vb = vb ?? -Infinity;
      return tdiSortAsc ? va - vb : vb - va;
    });

    const colorFn = v => v == null ? '#999' : v > 20 ? '#E53935' : v > 15 ? '#FB8C00' : v > 10 ? '#FFCB04' : v > 5 ? '#66BB6A' : '#2874A6';

    tbody.innerHTML = entries.map((md, i) => `
      <tr style="cursor:pointer" data-cod="${md.cod}">
        <td>${i + 1}</td>
        <td>${md.nome}</td>
        <td>${md.n_escolas || '—'}</td>
        <td style="color:${colorFn(md.tdi_fund)};font-weight:700">${md.tdi_fund?.toFixed(1) ?? '—'}%</td>
        <td style="color:${colorFn(md.tdi_ai)}">${md.tdi_ai?.toFixed(1) ?? '—'}%</td>
        <td style="color:${colorFn(md.tdi_af)}">${md.tdi_af?.toFixed(1) ?? '—'}%</td>
        <td style="color:${colorFn(md.tdi_med)};font-weight:700">${md.tdi_med?.toFixed(1) ?? '—'}%</td>
      </tr>`
    ).join('');

    tbody.querySelectorAll('tr[data-cod]').forEach(tr => {
      tr.addEventListener('click', () => { S.munSel = S.munSel === tr.dataset.cod ? null : tr.dataset.cod; refreshActiveTab(); });
    });

    const searchEl = document.getElementById('tdi-mun-search');
    if (searchEl) searchEl.addEventListener('input', e => {
      const q = e.target.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      tbody.querySelectorAll('tr').forEach(tr => {
        const nome = (tr.children[1]?.textContent || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        tr.style.display = nome.includes(q) ? '' : 'none';
      });
    });
  };
  // Sortable headers
  document.querySelectorAll('#tdi-mun-table thead th[data-sort-key]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sortKey;
      if (tdiSortCol === key) tdiSortAsc = !tdiSortAsc; else { tdiSortCol = key; tdiSortAsc = key === 'nome'; }
      document.querySelectorAll('#tdi-mun-table thead th[data-sort-key]').forEach(h => {
        const base = h.textContent.replace(/[\s\u2195\u2191\u2193]/g, '');
        h.textContent = base + ' ' + (h.dataset.sortKey === tdiSortCol ? (tdiSortAsc ? '\u2191' : '\u2193') : '\u2195');
      });
      tdiBuildMunTable();
    });
  });

  // Build everything
  tdiBuildMap();
  tdiBuildMunTable();
  injectExportButtons();

  // Bind map layer toggle
  const tdiBtnMun = document.getElementById('tdi-btn-layer-mun');
  const tdiBtnCre = document.getElementById('tdi-btn-layer-cre');
  if (tdiBtnMun && tdiBtnCre) {
    tdiBtnMun.addEventListener('click', () => { tdiBtnMun.classList.add('active'); tdiBtnCre.classList.remove('active'); tdiBuildMap(); });
    tdiBtnCre.addEventListener('click', () => { tdiBtnCre.classList.add('active'); tdiBtnMun.classList.remove('active'); tdiBuildCreMap(); });
  }

  // Re-populate topbar filters
  const selAno = document.getElementById('sel-ano');
  if (selAno) {
    selAno.innerHTML = anos.map(a => `<option value="${a}" ${a === anoSel ? 'selected' : ''}>${a}</option>`).join('');
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

      // Reset geo/etapa filters ONLY on actual page transition (not refreshActiveTab re-click)
      if (S._currentView && S._currentView !== view) {
        S.munSel = null;
        S.creSel = null;
        S.etapaSel = null;
        S.anoSel = null;  // Reset to latest year
        S.mapMode = 'mun';
        S.saersMapMode = null;
      }
      S._currentView = view;

      if (view === 'home') { renderHome(); return; }

      document.body.classList.remove('sidebar-hidden');

      if (view === 'acesso' && S.data) { renderAcesso(); }
      else if (view === 'fluxo') { renderFluxo(); }
      else if (view === 'infra' && S.infra) { renderInfra(); }
      else if (view === 'docencia' && S.doc) { renderDocencia(); }
      else if (view === 'desempenho') { renderSaeb(); }
      else if (view === 'saeb') { renderSaeb(); }
      else if (view === 'saers' && S.saersData) { renderSaers(); }
      else if (view === 'ideb') { renderIdeb(); }
      else if (view === 'inse') { renderInse(); }
      else if (view === 'icg') { renderIcg(); }
      else if (view === 'afd') { renderAfd(); }
      else if (view === 'tdi') { renderTdi(); }
      else if (view === 'escolas') { renderEscolas(); }
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
    } else {
      etapaEl.parentElement.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;color:#888;font-size:12px;text-align:center;gap:6px"><span style="font-size:20px">📋</span><span>Desagregação da Ed. Especial por etapa<br>disponível apenas a partir de <strong>2025</strong></span><span style="font-size:10px;color:#aaa">INEP — Tabela de Matrículas</span></div>`;
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

/** Build proportional integral chart (% of total enrollments) with filter checkboxes */
function buildIntegralPct(d) {
  const canvas = document.getElementById('chart-integral-pct');
  const filtersEl = document.getElementById('integral-pct-filters');
  if (!canvas || !filtersEl) return;

  const intAnos = Object.keys(d.integral || {}).sort();
  if (intAnos.length === 0) return;

  // Series config
  const seriesConfig = [
    { key: 'agregado', label: 'Fund. + Médio', color: '#0D3B66' },
    { key: 'fundamental', label: 'Fundamental', color: COLORS.fundAI },
    { key: 'medio', label: 'Médio', color: COLORS.medio || '#FF6F00' },
  ];
  const activeSeries = new Set(['agregado']);

  // Build filter checkboxes
  filtersEl.innerHTML = seriesConfig.map(s => `
    <label style="display:flex;align-items:center;gap:3px;cursor:pointer;padding:2px 6px;border-radius:4px;border:1.5px solid ${s.color};background:${s.color}15${s.key === 'agregado' ? '' : ';opacity:.4'}">
      <input type="checkbox" data-int-series="${s.key}" ${s.key === 'agregado' ? 'checked' : ''} style="accent-color:${s.color};width:12px;height:12px">
      <span style="color:${s.color};font-weight:600">${s.label}</span>
    </label>
  `).join('');

  const buildChart = () => {
    const existing = Chart.getChart(canvas);
    if (existing) { existing.destroy(); S.charts = S.charts.filter(c => c !== existing); }

    // Helper to get integral source (municipality/CRE/state)
    const getIntSrc = (ano) => {
      if (S.munSel) {
        const m = d.por_municipio[ano]?.[S.munSel] || {};
        return { fund_total: m.int_fund_total || 0, medio: m.int_medio || 0 };
      }
      if (S.creSel) {
        const agg = aggregateCre(d, ano, S.creSel);
        return { fund_total: agg.int_fund_total || 0, medio: agg.int_medio || 0 };
      }
      const i = d.integral[ano];
      return i ? { fund_total: i.fund_total || 0, medio: i.medio || 0 } : { fund_total: 0, medio: 0 };
    };

    // Helper to get total enrollments
    const getTotalSrc = (ano) => {
      if (S.munSel) {
        const m = d.por_municipio[ano]?.[S.munSel] || {};
        return { mat_fundamental: m.mat_fundamental || 0, mat_medio: m.mat_medio || 0, mat_total: m.mat_total || 0 };
      }
      if (S.creSel) {
        const agg = aggregateCre(d, ano, S.creSel);
        return { mat_fundamental: agg.mat_fundamental || 0, mat_medio: agg.mat_medio || 0, mat_total: agg.mat_total || 0 };
      }
      const st = d.serie_temporal[ano] || {};
      return { mat_fundamental: st.mat_fundamental || 0, mat_medio: st.mat_medio || 0, mat_total: st.mat_total || 0 };
    };

    const datasets = seriesConfig.map(s => {
      const data = intAnos.map(ano => {
        const intSrc = getIntSrc(ano);
        const totalSrc = getTotalSrc(ano);
        if (s.key === 'agregado') {
          const intTotal = intSrc.fund_total + intSrc.medio;
          const matTotal = totalSrc.mat_fundamental + totalSrc.mat_medio;
          return matTotal > 0 ? parseFloat(((intTotal / matTotal) * 100).toFixed(1)) : 0;
        } else if (s.key === 'fundamental') {
          return totalSrc.mat_fundamental > 0 ? parseFloat(((intSrc.fund_total / totalSrc.mat_fundamental) * 100).toFixed(1)) : 0;
        } else {
          return totalSrc.mat_medio > 0 ? parseFloat(((intSrc.medio / totalSrc.mat_medio) * 100).toFixed(1)) : 0;
        }
      });
      return {
        label: s.label, data,
        borderColor: s.color, backgroundColor: s.color + '18',
        fill: false, tension: .35, pointRadius: 4, pointHoverRadius: 7,
        borderWidth: 2.5,
        hidden: !activeSeries.has(s.key),
      };
    });

    S.charts.push(new Chart(canvas, {
      type: 'line',
      data: { labels: intAnos, datasets },
      options: {
        ...CHART_DEFAULTS,
        layout: { padding: { top: 25 } },
        plugins: {
          ...CHART_DEFAULTS.plugins,
          legend: { display: false },
          datalabels: {
            display: (ctx) => !ctx.dataset.hidden && ctx.dataset.data[ctx.dataIndex] > 0,
            color: (ctx) => ctx.dataset.borderColor,
            font: { size: 10, weight: '700', family: 'Inter' },
            anchor: 'end', align: 'top', offset: 2,
            formatter: v => v.toFixed(1) + '%',
          },
          tooltip: {
            ...CHART_DEFAULTS.plugins.tooltip,
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`
            }
          },
        },
        scales: {
          ...CHART_DEFAULTS.scales,
          y: {
            ...CHART_DEFAULTS.scales.y,
            grace: '15%',
            ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => v.toFixed(0) + '%' },
          },
        }
      }
    }));
  };

  buildChart();

  // Bind checkbox filters
  filtersEl.querySelectorAll('input[data-int-series]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) activeSeries.add(cb.dataset.intSeries);
      else activeSeries.delete(cb.dataset.intSeries);
      cb.closest('label').style.opacity = cb.checked ? '1' : '.4';
      buildChart();
    });
  });
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

// ══════════════════════════════════════════════════════════
// MATRÍCULAS POR SÉRIE
// ══════════════════════════════════════════════════════════
function buildPorSerie(d, anoSel) {
  // Get data source considering geo-filters (municipality > CRE > state)
  let ps = null;
  if (S.munSel) {
    ps = d.por_municipio?.[anoSel]?.[S.munSel]?.por_serie;
  } else if (S.creSel) {
    // Aggregate por_serie across CRE municipalities
    const creMuns = getCreMuns(S.creSel);
    const munYear = d.por_municipio?.[anoSel];
    if (munYear) {
      const agg = {};
      for (const cod of creMuns) {
        const munPs = munYear[cod]?.por_serie;
        if (!munPs) continue;
        for (const [k, v] of Object.entries(munPs)) {
          agg[k] = (agg[k] || 0) + (v || 0);
        }
      }
      if (Object.keys(agg).length > 0) ps = agg;
    }
  } else {
    ps = d.serie_temporal?.[anoSel]?.por_serie;
  }

  const c1 = document.getElementById('chart-serie-fund');
  const c2 = document.getElementById('chart-serie-med');

  // Fallback: data not available for this year (pre-2023)
  if (!ps) {
    const anoNum = parseInt(anoSel);
    if (c1) c1.parentElement.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:250px;color:var(--text-sec);font-size:12px;text-align:center;padding:20px">
      <div><span style="font-size:24px;opacity:.4">📊</span><br><strong>Dados por série</strong> disponíveis apenas a partir de <strong>2023</strong>.<br><span style="font-size:10px;opacity:.7">Os microdados do Censo Escolar ${anoNum <= 2022 ? anoNum : ''} não incluem essa desagregação.</span></div>
    </div>`;
    if (c2) c2.parentElement.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:250px;color:var(--text-sec);font-size:12px;text-align:center;padding:20px">
      <div><span style="font-size:24px;opacity:.4">📊</span><br><strong>Dados por série</strong> disponíveis apenas a partir de <strong>2023</strong>.</div>
    </div>`;
    return;
  }

  // Fundamental
  const fundCols = ['QT_MAT_FUND_AI_1','QT_MAT_FUND_AI_2','QT_MAT_FUND_AI_3','QT_MAT_FUND_AI_4','QT_MAT_FUND_AI_5',
                    'QT_MAT_FUND_AF_6','QT_MAT_FUND_AF_7','QT_MAT_FUND_AF_8','QT_MAT_FUND_AF_9'];
  const fundLabels = ['1º Ano','2º Ano','3º Ano','4º Ano','5º Ano','6º Ano','7º Ano','8º Ano','9º Ano'];
  const fundData = fundCols.map(c => ps[c] || 0);
  const fundColors = fundCols.map((c, i) => i < 5 ? COLORS.pri + 'CC' : COLORS.estadual + '99');

  if (c1 && fundData.some(v => v > 0)) {
    S.charts.push(new Chart(c1, {
      type: 'bar',
      data: {
        labels: fundLabels,
        datasets: [{
          label: 'Matrículas',
          data: fundData,
          backgroundColor: fundColors,
          borderColor: fundCols.map((c, i) => i < 5 ? COLORS.pri : COLORS.estadual),
          borderWidth: 1.5, borderRadius: 4,
        }]
      },
      options: {
        ...CHART_DEFAULTS,
        plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_BAR },
        scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: true, suggestedMax: Math.max(...fundData) * 1.18 } }
      }
    }));
  }

  // Médio
  const medCols = ['QT_MAT_MED_PROP_1','QT_MAT_MED_PROP_2','QT_MAT_MED_PROP_3','QT_MAT_MED_PROP_4'];
  const medLabels = ['1ª Série','2ª Série','3ª Série','4ª Série'];
  const medData = medCols.map(c => ps[c] || 0);

  if (c2 && medData.some(v => v > 0)) {
    S.charts.push(new Chart(c2, {
      type: 'bar',
      data: {
        labels: medLabels,
        datasets: [{
          label: 'Matrículas',
          data: medData,
          backgroundColor: [COLORS.red + 'CC', COLORS.red + 'AA', COLORS.red + '88', COLORS.red + '66'],
          borderColor: COLORS.red,
          borderWidth: 1.5, borderRadius: 4,
        }]
      },
      options: {
        ...CHART_DEFAULTS,
        plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_BAR },
        scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: true, suggestedMax: Math.max(...medData) * 1.18 } }
      }
    }));
  }
}

// ══════════════════════════════════════════════════════════
// EDUCAÇÃO PROFISSIONAL E TÉCNICA
// ══════════════════════════════════════════════════════════
function buildProfissional(d, anos, anoSel) {
  // Profissional sub-categories with keys matching detalhes_prof
  const PROF_KEYS = ['integrado', 'subsequente', 'concomitante', 'eja_tec'];
  const PROF_LABELS = { integrado: 'Integrado ao EM', subsequente: 'Subsequente', concomitante: 'Concomitante', eja_tec: 'EJA Técnico' };
  const PROF_QT = { integrado: 'QT_MAT_MED_IFTP_CT', subsequente: 'QT_MAT_PROF_TEC_SUBS', concomitante: 'QT_MAT_PROF_TEC_CONC', eja_tec: 'QT_MAT_EJA_MED_TEC' };
  const PROF_COLORS = { integrado: COLORS.pri, subsequente: COLORS.red, concomitante: COLORS.yellow, eja_tec: '#6A1B9A' };

  // Helper: get profissional data for a year considering geo-filter
  function getProfYearData(a) {
    if (S.munSel) {
      return d.por_municipio?.[a]?.[S.munSel] || null;
    } else if (S.creSel) {
      const creMuns = getCreMuns(S.creSel);
      const munYear = d.por_municipio?.[a];
      if (!munYear) return null;
      const agg = { mat_prof: 0, mat_prof_tec: 0, detalhes_prof: {} };
      for (const cod of creMuns) {
        const md = munYear[cod];
        if (!md) continue;
        agg.mat_prof += (md.mat_prof || 0);
        agg.mat_prof_tec += (md.mat_prof_tec || 0);
        if (md.detalhes_prof) {
          for (const [k, v] of Object.entries(md.detalhes_prof)) {
            agg.detalhes_prof[k] = (agg.detalhes_prof[k] || 0) + (v || 0);
          }
        }
      }
      return agg;
    }
    return d.serie_temporal?.[a] || null;
  }

  // Evolução temporal (filtered by profSel)
  const c1 = document.getElementById('chart-prof-evo');
  if (c1) {
    let datasets;
    const titleEl = document.getElementById('title-prof-evo');
    if (S.profSel && PROF_LABELS[S.profSel]) {
      // Show only the selected sub-category over time
      const qtKey = PROF_QT[S.profSel];
      const selData = anos.map(a => getProfYearData(a)?.detalhes_prof?.[qtKey] || 0);
      datasets = [{
        label: PROF_LABELS[S.profSel],
        data: selData,
        borderColor: PROF_COLORS[S.profSel],
        backgroundColor: PROF_COLORS[S.profSel] + '22',
        fill: true, tension: 0.3, pointRadius: 3, borderWidth: 2.5,
      }];
      if (titleEl) titleEl.textContent = `${PROF_LABELS[S.profSel]} — Evolução`;
    } else {
      // Default: Ed. Profissional Total + Cursos Técnicos
      const profData = anos.map(a => getProfYearData(a)?.mat_prof || 0);
      const tecData = anos.map(a => getProfYearData(a)?.mat_prof_tec || 0);
      datasets = [
        {
          label: 'Ed. Profissional — INEP (QT_MAT_PROF)',
          data: profData,
          borderColor: COLORS.pri,
          backgroundColor: COLORS.pri + '22',
          fill: true, tension: 0.3, pointRadius: 3, borderWidth: 2.5,
        },
        {
          label: 'Cursos Técnicos — INEP (QT_MAT_PROF_TEC)',
          data: tecData,
          borderColor: COLORS.red,
          backgroundColor: 'transparent',
          tension: 0.3, pointRadius: 3, borderWidth: 2, borderDash: [5, 3],
        }
      ];
      if (titleEl) titleEl.textContent = 'Matrículas na Ed. Profissional — Evolução';
    }
    if (datasets[0].data.some(v => v > 0)) {
      S.charts.push(new Chart(c1, {
        type: 'line',
        data: { labels: anos, datasets },
        options: {
          ...CHART_DEFAULTS,
          scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: true } }
        }
      }));
    }
  }

  // Composição (bar chart with click-to-filter) - ano selecionado
  const c2 = document.getElementById('chart-prof-comp');
  const dp = getProfYearData(anoSel)?.detalhes_prof;
  if (c2 && dp) {
    const conc = dp.QT_MAT_PROF_TEC_CONC || 0;
    const subs = dp.QT_MAT_PROF_TEC_SUBS || 0;
    const integrado = dp.QT_MAT_MED_IFTP_CT || 0;
    const ejaTec = dp.QT_MAT_EJA_MED_TEC || 0;

    const labels = ['Integrado ao EM', 'Subsequente', 'Concomitante', 'EJA Técnico'];
    const data = [integrado, subs, conc, ejaTec];
    const keys = ['integrado', 'subsequente', 'concomitante', 'eja_tec'];
    const colors = [COLORS.pri, COLORS.red, COLORS.yellow, '#6A1B9A'];

    if (data.some(v => v > 0)) {
      S.charts.push(new Chart(c2, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: `Composição ${anoSel}`,
            data: data,
            backgroundColor: keys.map((k, i) => S.profSel && S.profSel !== k ? colors[i] + '33' : colors[i] + 'CC'),
            borderColor: keys.map((k, i) => S.profSel && S.profSel !== k ? colors[i] + '55' : colors[i]),
            borderWidth: keys.map(k => S.profSel === k ? 3 : 1.5),
            borderRadius: 4,
          }]
        },
        options: {
          ...CHART_DEFAULTS,
          onHover: CLICKABLE_HOVER,
          onClick: (evt, elements) => {
            if (!elements.length) return;
            const idx = elements[0].index;
            const clickedKey = keys[idx];
            S.profSel = S.profSel === clickedKey ? null : clickedKey;
            renderAcesso();
          },
          plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_BAR },
          scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, suggestedMax: Math.max(...data) * 1.18 } }
        }
      }));
    } else {
      c2.parentElement.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:250px;color:#888;font-size:12px;text-align:center;gap:6px"><span style="font-size:20px">🏭</span><span>Composição da Ed. Profissional<br>disponível a partir de <strong>2023</strong></span><span style="font-size:10px;color:#aaa">INEP — Microdados do Censo Escolar</span></div>`;
    }
  } else if (c2 && !dp) {
    c2.parentElement.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:250px;color:#888;font-size:12px;text-align:center;gap:6px"><span style="font-size:20px">🏭</span><span>Composição da Ed. Profissional<br>disponível a partir de <strong>2023</strong></span><span style="font-size:10px;color:#aaa">INEP — Microdados do Censo Escolar</span></div>`;
  }
}

// ══════════════════════════════════════════════════════════
// MATRÍCULAS POR TURNO POR ETAPA
// ══════════════════════════════════════════════════════════
function buildTurnoEtapa(d, anoSel) {
  // Get data source considering geo-filters
  let pt = null;
  if (S.munSel) {
    pt = d.por_municipio?.[anoSel]?.[S.munSel]?.por_turno;
  } else if (S.creSel) {
    const creMuns = getCreMuns(S.creSel);
    const munYear = d.por_municipio?.[anoSel];
    if (munYear) {
      const agg = {};
      for (const cod of creMuns) {
        const munPt = munYear[cod]?.por_turno;
        if (!munPt) continue;
        for (const [k, v] of Object.entries(munPt)) {
          agg[k] = (agg[k] || 0) + (v || 0);
        }
      }
      if (Object.keys(agg).length > 0) pt = agg;
    }
  } else {
    pt = d.serie_temporal?.[anoSel]?.por_turno;
  }
  const c = document.getElementById('chart-turno-etapa');
  if (!c) return;
  if (!pt) {
    c.parentElement.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:280px;color:#999;font-size:12px">Dados indisponíveis para ${anoSel}</div>`;
    return;
  }

  const etapas = ['Fund. AI', 'Fund. AF', 'Ensino Médio', 'Ed. Profissional', 'EJA'];
  const diurnoCols = ['QT_MAT_FUND_AI_D', 'QT_MAT_FUND_AF_D', 'QT_MAT_MED_D', 'QT_MAT_PROF_D', 'QT_MAT_EJA_D'];
  const noturnoCols = ['QT_MAT_FUND_AI_N', 'QT_MAT_FUND_AF_N', 'QT_MAT_MED_N', 'QT_MAT_PROF_N', 'QT_MAT_EJA_N'];

  const diurnoData = diurnoCols.map(c => pt[c] || 0);
  const noturnoData = noturnoCols.map(c => pt[c] || 0);

  if (diurnoData.some(v => v > 0) || noturnoData.some(v => v > 0)) {
    S.charts.push(new Chart(c, {
      type: 'bar',
      data: {
        labels: etapas,
        datasets: [
          {
            label: 'Diurno',
            data: diurnoData,
            backgroundColor: COLORS.yellow + 'CC',
            borderColor: COLORS.yellow,
            borderWidth: 1.5, borderRadius: 4,
          },
          {
            label: 'Noturno',
            data: noturnoData,
            backgroundColor: '#1A237E' + 'CC',
            borderColor: '#1A237E',
            borderWidth: 1.5, borderRadius: 4,
          }
        ]
      },
      options: {
        ...CHART_DEFAULTS,
        plugins: {
          ...CHART_DEFAULTS.plugins,
          datalabels: DL_BAR,
        },
        scales: {
          ...CHART_DEFAULTS.scales,
          y: { ...CHART_DEFAULTS.scales.y, beginAtZero: true, suggestedMax: Math.max(...diurnoData, ...noturnoData) * 1.18 }
        }
      }
    }));
  } else {
    c.parentElement.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:280px;color:#888;font-size:12px;text-align:center;gap:6px"><span style="font-size:20px">🕐</span><span>Desagregação Diurno vs Noturno por etapa<br>disponível apenas a partir de <strong>2025</strong></span><span style="font-size:10px;color:#aaa">INEP — Tabela de Matrículas</span></div>`;
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
  const CRE_SCALE = ['#c5d5e4', '#8fb3d1', '#5a91bd', '#3576a9', '#0D3B66'];
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
      else {
        buildMap(d, anoSel, selMetric.value);
        // Re-highlight selected municipality after redraw
        if (S.munSel) zoomToMunicipality(S.munSel);
      }
    });
  }

  // Layer toggle
  const btnMun = document.getElementById('btn-layer-mun');
  const btnCre = document.getElementById('btn-layer-cre');
  if (btnMun && btnCre) {
    btnMun.addEventListener('click', () => {
      S.mapMode = 'mun';
      btnMun.classList.add('active'); btnCre.classList.remove('active');
      const btnEsc = document.getElementById('btn-layer-esc');
      if (btnEsc) btnEsc.classList.remove('active');
      const anoSel = S.anoSel || anos[anos.length - 1];
      buildMap(d, anoSel, selMetric?.value || 'mat_total');
      buildMunTable(d, anoSel);
    });
    btnCre.addEventListener('click', () => {
      S.mapMode = 'cre';
      btnCre.classList.add('active'); btnMun.classList.remove('active');
      const btnEsc = document.getElementById('btn-layer-esc');
      if (btnEsc) btnEsc.classList.remove('active');
      const anoSel = S.anoSel || anos[anos.length - 1];
      buildCreLayer(anoSel, selMetric?.value || 'mat_total');
      buildMunTable(d, anoSel);
    });

    // Escolas button
    const btnEsc = document.getElementById('btn-layer-esc');
    if (btnEsc) {
      btnEsc.addEventListener('click', () => {
        S.mapMode = 'esc';
        btnMun.classList.remove('active'); btnCre.classList.remove('active'); btnEsc.classList.add('active');
        const anoSel = S.anoSel || anos[anos.length - 1];
        buildEscolaLayer(d, anoSel);
      });
    }
  }
}

/** Renders school points on the existing Leaflet map and school table */
function buildEscolaLayer(d, anoSel) {
  if (!S.map) return;
  // Remove existing layers
  if (S.mapLayer) { S.mapLayer.remove(); S.mapLayer = null; }
  if (S.mapLegend) { S.mapLegend.remove(); S.mapLegend = null; }

  // Load escola data
  const ed = S.escolasData;
  if (!ed || !ed.escolas || !ed.escolas.length) {
    // Show message in table
    const titleEl = document.querySelector('#mun-table-wrapper .table-header h3');
    if (titleEl) titleEl.textContent = 'Tabela de Escolas';
    const tbody = document.getElementById('mun-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:#999">Dados de escolas não carregados</td></tr>';
    return;
  }

  const escolas = ed.escolas;
  const lookup = d.lookup_municipios || {};

  // Filter by CRE and/or Municipality
  let filtered = escolas;
  if (S.creSel) filtered = filtered.filter(e => e.cre === S.creSel);
  if (S.munSel) filtered = filtered.filter(e => String(e.cod_mun) === String(S.munSel));

  const withCoords = filtered.filter(e => e.lat && e.lng);

  // Add CircleMarkers
  const markers = L.featureGroup();
  withCoords.forEach(e => {
    const marker = L.circleMarker([e.lat, e.lng], {
      radius: 4, fillColor: COLORS.pri, color: '#fff', weight: 1, fillOpacity: 0.8,
    });
    marker.bindPopup(`
      <div style="font-family:Inter;min-width:220px">
        <strong style="font-size:12px">${e.nome}</strong><br>
        <span style="font-size:10px;color:#666">${e.municipio || lookup[e.cod_mun] || ''} — INEP: ${e.inep || ''}</span>
        <hr style="margin:4px 0;border:none;border-top:1px solid #eee">
        <div style="font-size:10px;line-height:1.6">
          ${e.mat_total != null ? `<div><strong>Total Matrículas:</strong> ${formatNum(e.mat_total)}</div>` : ''}
          ${e.mat_fund != null && e.mat_fund > 0 ? `<span style="display:inline-block;background:#0097A722;padding:1px 5px;border-radius:3px;margin:1px">Fund: <strong>${formatNum(e.mat_fund)}</strong></span>` : ''}
          ${e.mat_medio != null && e.mat_medio > 0 ? `<span style="display:inline-block;background:#EE302F22;padding:1px 5px;border-radius:3px;margin:1px">Médio: <strong>${formatNum(e.mat_medio)}</strong></span>` : ''}
          ${e.mat_eja != null && e.mat_eja > 0 ? `<span style="display:inline-block;background:#1565C022;padding:1px 5px;border-radius:3px;margin:1px">EJA: <strong>${formatNum(e.mat_eja)}</strong></span>` : ''}
          ${e.mat_tecnico != null && e.mat_tecnico > 0 ? `<span style="display:inline-block;background:#6A1B9A22;padding:1px 5px;border-radius:3px;margin:1px">Técnico: <strong>${formatNum(e.mat_tecnico)}</strong></span>` : ''}
        </div>
        ${(e.ideb_af != null || e.icg_nivel != null || e.tdi_fund != null) ? `
        <hr style="margin:4px 0;border:none;border-top:1px solid #eee">
        <div style="font-size:9px;display:grid;grid-template-columns:1fr 1fr;gap:2px;color:#666">
          ${e.icg_nivel != null ? `<span>ICG: <strong>${e.icg_nivel}</strong></span>` : ''}
          ${e.ideb_af != null ? `<span>IDEB AF: <strong>${e.ideb_af}</strong></span>` : ''}
          ${e.tdi_fund != null ? `<span>TDI: <strong>${(e.tdi_fund).toFixed(1)}%</strong></span>` : ''}
        </div>` : ''}
      </div>
    `, { maxWidth: 280 });
    markers.addLayer(marker);
  });
  markers.addTo(S.map);
  S.mapLayer = markers;

  // Fit bounds
  if (withCoords.length > 0) {
    S.map.fitBounds(markers.getBounds(), { padding: [20, 20] });
  }

  // Build escola table
  const titleEl = document.querySelector('#mun-table-wrapper .table-header h3');
  if (titleEl) titleEl.textContent = 'Tabela de Escolas';

  const thead = document.querySelector('#mun-table thead tr');
  if (thead) thead.innerHTML = '<th>#</th><th>Escola</th><th>Município</th><th>Total</th><th>Fund.</th><th>Médio</th><th>EJA</th><th>Técnico</th>';

  const sorted = [...filtered].sort((a, b) => (b.mat_total || 0) - (a.mat_total || 0));
  const tbody = document.getElementById('mun-tbody');
  tbody.innerHTML = sorted.map((e, i) => `
    <tr data-lat="${e.lat || ''}" data-lng="${e.lng || ''}" data-inep="${e.inep || ''}" data-cod-mun="${e.cod_mun || ''}" style="cursor:pointer">
      <td>${i + 1}</td>
      <td><strong style="font-size:10px">${e.nome}</strong></td>
      <td style="font-size:10px">${e.municipio || lookup[e.cod_mun] || ''}</td>
      <td>${formatNum(e.mat_total || 0)}</td>
      <td>${formatNum(e.mat_fund || 0)}</td>
      <td>${formatNum(e.mat_medio || 0)}</td>
      <td>${formatNum(e.mat_eja || 0)}</td>
      <td>${formatNum(e.mat_tecnico || 0)}</td>
    </tr>
  `).join('');

  // Click escola row → zoom to school and open popup
  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => {
      const lat = parseFloat(tr.dataset.lat);
      const lng = parseFloat(tr.dataset.lng);
      if (!isNaN(lat) && !isNaN(lng) && S.map) {
        S.map.flyTo([lat, lng], 14, { duration: 0.5 });
        // Find matching marker and open popup
        markers.eachLayer(m => {
          if (Math.abs(m.getLatLng().lat - lat) < 0.001 && Math.abs(m.getLatLng().lng - lng) < 0.001) {
            m.openPopup();
          }
        });
      }
    });
  });

  // Search
  const searchEl = document.getElementById('mun-search');
  if (searchEl) {
    const newSearch = searchEl.cloneNode(true);
    searchEl.parentNode.replaceChild(newSearch, searchEl);
    newSearch.addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      tbody.querySelectorAll('tr').forEach(tr => {
        const nome = tr.children[1]?.textContent.toLowerCase() || '';
        const mun = tr.children[2]?.textContent.toLowerCase() || '';
        tr.style.display = (nome.includes(q) || mun.includes(q)) ? '' : 'none';
      });
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
  if (!selMun) return;

  // Build universal municipality lookup from creLookup + all section lookups
  const lookup = {};
  // 1. From creLookup mun_to_cre (has all ~496 municipalities but no names)
  //    Names come from the GeoJSON or section lookups
  // 2. Merge all available section lookups for names
  const sources = [
    S.data?.lookup_municipios,
    S.fluxo?.lookup_municipios,
    S.saeb?.lookup_municipios,
    S.inse?.lookup_municipios,
    S.icg?.lookup_municipios,
    S.afd?.lookup_municipios,
    S.ideb?.lookup_municipios,
    S.tdi?.lookup_municipios,
    S._universalMunLookup,
  ];
  for (const src of sources) {
    if (src) Object.assign(lookup, src);
  }

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

    // Close dropdown when clicking outside (register only once)
    if (!bindTopbarFilters._munCloseRegistered) {
      bindTopbarFilters._munCloseRegistered = true;
      document.addEventListener('click', e => {
        const list = document.getElementById('mun-dropdown-list');
        if (list && !e.target.closest('#mun-search-wrapper')) {
          list.style.display = 'none';
        }
      });
    }
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
// VISÃO POR ESCOLA
// ══════════════════════════════════════════════════════════

const ESCOLA_INDICATORS = [
  { key: 'ideb_ai', label: 'IDEB Anos Iniciais', higher: true, fmt: v => v.toFixed(1), unit: '' },
  { key: 'ideb_af', label: 'IDEB Anos Finais', higher: true, fmt: v => v.toFixed(1), unit: '' },
  { key: 'ideb_em', label: 'IDEB Ensino Médio', higher: true, fmt: v => v.toFixed(1), unit: '' },
  { key: 'tdi_fund', label: 'TDI Fundamental (%)', higher: false, fmt: v => v.toFixed(1) + '%', unit: '%' },
  { key: 'tdi_ai', label: 'TDI Anos Iniciais (%)', higher: false, fmt: v => v.toFixed(1) + '%', unit: '%' },
  { key: 'tdi_af', label: 'TDI Anos Finais (%)', higher: false, fmt: v => v.toFixed(1) + '%', unit: '%' },
  { key: 'tdi_med', label: 'TDI Ensino Médio (%)', higher: false, fmt: v => v.toFixed(1) + '%', unit: '%' },
  { key: 'inse_media', label: 'INSE (Média)', higher: true, fmt: v => v.toFixed(1), unit: '' },
  { key: 'icg_nivel', label: 'ICG (Nível 1-6)', higher: false, fmt: v => v.toFixed(0), unit: '' },
];

function getEscolaColor(value, indicator) {
  if (value == null) return '#B0BEC5';
  const cfg = ESCOLA_INDICATORS.find(i => i.key === indicator);
  if (!cfg) return '#B0BEC5';

  // IDEB
  if (indicator.startsWith('ideb_')) {
    if (value >= 7.0) return '#1B5E20';
    if (value >= 6.0) return '#43A047';
    if (value >= 5.0) return '#FFCB04';
    if (value >= 4.0) return '#F57C00';
    return '#C62828';
  }
  // TDI (lower is better)
  if (indicator.startsWith('tdi_')) {
    if (value <= 10) return '#1B5E20';
    if (value <= 20) return '#43A047';
    if (value <= 30) return '#FFCB04';
    if (value <= 40) return '#F57C00';
    return '#C62828';
  }
  // INSE
  if (indicator === 'inse_media') {
    if (value >= 6.0) return '#1B5E20';
    if (value >= 5.0) return '#43A047';
    if (value >= 4.0) return '#FFCB04';
    if (value >= 3.0) return '#F57C00';
    return '#C62828';
  }
  // ICG (higher = more complex)
  if (indicator === 'icg_nivel') {
    const colors = { 1: '#1B5E20', 2: '#43A047', 3: '#66BB6A', 4: '#FFCB04', 5: '#F57C00', 6: '#C62828' };
    return colors[value] || '#B0BEC5';
  }
  return '#00AB4E';
}

function getEscolaLegend(indicator) {
  if (indicator.startsWith('ideb_')) {
    return [
      { color: '#1B5E20', label: '≥ 7,0' }, { color: '#43A047', label: '6,0–6,9' },
      { color: '#FFCB04', label: '5,0–5,9' }, { color: '#F57C00', label: '4,0–4,9' },
      { color: '#C62828', label: '< 4,0' }, { color: '#B0BEC5', label: 'Sem dado' },
    ];
  }
  if (indicator.startsWith('tdi_')) {
    return [
      { color: '#1B5E20', label: '≤ 10%' }, { color: '#43A047', label: '10–20%' },
      { color: '#FFCB04', label: '20–30%' }, { color: '#F57C00', label: '30–40%' },
      { color: '#C62828', label: '> 40%' }, { color: '#B0BEC5', label: 'Sem dado' },
    ];
  }
  if (indicator === 'inse_media') {
    return [
      { color: '#1B5E20', label: '≥ 6,0' }, { color: '#43A047', label: '5,0–5,9' },
      { color: '#FFCB04', label: '4,0–4,9' }, { color: '#F57C00', label: '3,0–3,9' },
      { color: '#C62828', label: '< 3,0' }, { color: '#B0BEC5', label: 'Sem dado' },
    ];
  }
  if (indicator === 'icg_nivel') {
    return [
      { color: '#1B5E20', label: 'Nível 1' }, { color: '#43A047', label: 'Nível 2' },
      { color: '#66BB6A', label: 'Nível 3' }, { color: '#FFCB04', label: 'Nível 4' },
      { color: '#F57C00', label: 'Nível 5' }, { color: '#C62828', label: 'Nível 6' },
    ];
  }
  return [];
}

function renderEscolas() {
  const main = document.getElementById('main-content');
  destroyCharts();
  destroyMap();
  // Destroy previous escola map
  if (S.escolasMap) { S.escolasMap.remove(); S.escolasMap = null; S.escolasMarkers = null; }

  document.body.classList.remove('sidebar-hidden');
  const ed = S.escolasData;
  if (!ed || !ed.escolas || !ed.escolas.length) {
    main.innerHTML = `<div class="placeholder-view">
      <div style="font-size:40px;opacity:.3">🏫</div>
      <div style="font-size:15px;font-weight:600">Visão por Escola</div>
      <div style="font-size:11px;opacity:.7">Dados não disponíveis</div>
    </div>`;
    return;
  }

  const escolas = ed.escolas;
  const withCoords = escolas.filter(e => e.lat && e.lng);

  // Build CRE list
  const creSet = new Set(escolas.map(e => e.cre));
  const creList = [...creSet].sort((a, b) => parseInt(a) - parseInt(b));

  const defaultIndicator = 'ideb_af';

  main.innerHTML = `
    <div class="section-content" style="padding:10px 16px 50px">
      ${sectionBanner('img/icons/escola.png', 'Visão por Escola', 'Rede Estadual do RS', { redeToggle: false })}

      <!-- Filters Row -->
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin:14px 0;align-items:center">
        <div style="display:flex;align-items:center;gap:6px">
          <label style="font-size:11px;font-weight:600;color:#555">Indicador:</label>
          <select id="escola-indicator" style="padding:5px 10px;border-radius:6px;border:1px solid #ddd;font-size:11px;font-family:Inter;background:#fff;cursor:pointer">
            ${ESCOLA_INDICATORS.map(i => `<option value="${i.key}" ${i.key === defaultIndicator ? 'selected' : ''}>${i.label}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <label style="font-size:11px;font-weight:600;color:#555">CRE:</label>
          <select id="escola-cre-filter" style="padding:5px 10px;border-radius:6px;border:1px solid #ddd;font-size:11px;font-family:Inter;background:#fff;cursor:pointer">
            <option value="">Todas as CREs</option>
            ${creList.map(c => `<option value="${c}">${c}ª CRE</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex:1;max-width:300px">
          <label style="font-size:11px;font-weight:600;color:#555">Buscar:</label>
          <input type="text" id="escola-search" placeholder="Nome da escola ou município..." style="padding:5px 10px;border-radius:6px;border:1px solid #ddd;font-size:11px;font-family:Inter;width:100%;background:#fff">
        </div>
      </div>

      <!-- KPIs -->
      <div id="escola-kpis" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px"></div>

      <!-- Map -->
      <div class="chart-card" style="padding:0;overflow:hidden;border-radius:10px;margin-bottom:16px">
        <div style="padding:10px 14px 6px;display:flex;justify-content:space-between;align-items:center">
          <div class="chart-title" id="escola-map-title">Mapa das Escolas Estaduais — IDEB Anos Finais</div>
          <div id="escola-legend" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"></div>
        </div>
        <div id="escola-map" style="height:520px;width:100%;background:#f0f4f8"></div>
      </div>

      <!-- Table -->
      <div class="chart-card" style="padding:12px 16px">
        <div class="chart-title" style="margin-bottom:8px">Tabela de Escolas</div>
        <div id="escola-table-wrap" style="max-height:450px;overflow:auto">
          <table id="escola-table" style="width:100%;border-collapse:separate;border-spacing:0;font-size:10.5px;table-layout:fixed;min-width:900px">
            <thead id="escola-table-head"></thead>
            <tbody id="escola-table-body"></tbody>
          </table>
        </div>
      </div>

      <div style="text-align:right;margin-top:8px;font-size:9px;color:#aaa">
        Fonte: Censo Escolar 2025 / INEP — Indicadores por escola | ${withCoords.length} escolas georreferenciadas
      </div>
    </div>
  `;

  // Initialize map
  const mapEl = document.getElementById('escola-map');
  const map = L.map(mapEl, { zoomControl: true, scrollWheelZoom: true }).setView([-29.5, -53.5], 7);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap © CARTO', subdomains: 'abcd', maxZoom: 18
  }).addTo(map);
  S.escolasMap = map;
  S.escolasMarkers = L.layerGroup().addTo(map);

  // Sort state for table (persists across filter changes)
  let escolaSortState = null;

  // Update function
  function updateEscolas() {
    const indicator = document.getElementById('escola-indicator').value;
    const creFilter = document.getElementById('escola-cre-filter').value;
    const search = (document.getElementById('escola-search').value || '').toUpperCase().trim();
    const cfg = ESCOLA_INDICATORS.find(i => i.key === indicator);

    // Filter schools
    let filtered = escolas;
    if (creFilter) filtered = filtered.filter(e => e.cre === creFilter);
    if (search) filtered = filtered.filter(e =>
      (e.nome || '').toUpperCase().includes(search) ||
      (e.municipio || '').toUpperCase().includes(search) ||
      (e.inep || '').includes(search)
    );

    const withVal = filtered.filter(e => e[indicator] != null);
    const vals = withVal.map(e => e[indicator]);
    const avg = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    const minV = vals.length ? Math.min(...vals) : null;
    const maxV = vals.length ? Math.max(...vals) : null;

    // KPIs
    document.getElementById('escola-kpis').innerHTML = `
      <div class="kpi-card" style="text-align:center;padding:12px">
        <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Escolas</div>
        <div style="font-size:24px;font-weight:800;color:#0D47A1">${filtered.length.toLocaleString('pt-BR')}</div>
      </div>
      <div class="kpi-card" style="text-align:center;padding:12px">
        <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Média ${cfg ? cfg.label.split(' ')[0] : ''}</div>
        <div style="font-size:24px;font-weight:800;color:#00AB4E">${avg != null ? cfg.fmt(avg) : '—'}</div>
        <div style="font-size:9px;color:#999">${withVal.length} com dado</div>
      </div>
      <div class="kpi-card" style="text-align:center;padding:12px">
        <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Melhor</div>
        <div style="font-size:24px;font-weight:800;color:#1B5E20">${maxV != null && cfg ? cfg.fmt(cfg.higher ? maxV : minV) : '—'}</div>
      </div>
      <div class="kpi-card" style="text-align:center;padding:12px">
        <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Pior</div>
        <div style="font-size:24px;font-weight:800;color:#C62828">${minV != null && cfg ? cfg.fmt(cfg.higher ? minV : maxV) : '—'}</div>
      </div>
    `;

    // Map title
    document.getElementById('escola-map-title').textContent = `Mapa das Escolas Estaduais — ${cfg ? cfg.label : ''}`;

    // Legend
    const legendEl = document.getElementById('escola-legend');
    const legendItems = getEscolaLegend(indicator);
    legendEl.innerHTML = legendItems.map(l =>
      `<span style="display:inline-flex;align-items:center;gap:3px;font-size:9px;color:#666">
        <span style="width:10px;height:10px;border-radius:50%;background:${l.color};display:inline-block"></span>${l.label}
      </span>`
    ).join('');

    // Map markers
    S.escolasMarkers.clearLayers();
    const filteredWithCoords = filtered.filter(e => e.lat && e.lng);
    for (const e of filteredWithCoords) {
      const val = e[indicator];
      const color = getEscolaColor(val, indicator);
      const marker = L.circleMarker([e.lat, e.lng], {
        radius: 5, fillColor: color, fillOpacity: 0.85, color: '#fff', weight: 1, opacity: 0.9,
      });

      // Build popup
      let popupContent = `
        <div style="font-family:Inter,sans-serif;min-width:240px">
          <div style="font-weight:700;font-size:12px;color:#0D47A1;margin-bottom:4px">${e.nome}</div>
          <div style="font-size:10px;color:#666;margin-bottom:8px">${e.municipio} · ${e.cre}ª CRE · INEP ${e.inep}</div>
          <table style="font-size:10px;width:100%;border-collapse:collapse">
      `;
      const rows = [
        { label: 'IDEB Anos Iniciais', val: e.ideb_ai, fmt: v => v.toFixed(1) },
        { label: 'IDEB Anos Finais', val: e.ideb_af, fmt: v => v.toFixed(1) },
        { label: 'IDEB Ensino Médio', val: e.ideb_em, fmt: v => v.toFixed(1) },
        { label: 'TDI Fund.', val: e.tdi_fund, fmt: v => v.toFixed(1) + '%' },
        { label: 'TDI Anos Iniciais', val: e.tdi_ai, fmt: v => v.toFixed(1) + '%' },
        { label: 'TDI Anos Finais', val: e.tdi_af, fmt: v => v.toFixed(1) + '%' },
        { label: 'TDI Ensino Médio', val: e.tdi_med, fmt: v => v.toFixed(1) + '%' },
        { label: 'INSE', val: e.inse_media, fmt: v => v.toFixed(1), extra: e.inse_nivel ? ` (${e.inse_nivel})` : '' },
        { label: 'ICG', val: e.icg_nivel, fmt: v => `Nível ${v}` },
        { label: 'Salas', val: e.salas, fmt: v => v },
      ];
      for (const r of rows) {
        if (r.val != null) {
          popupContent += `<tr><td style="padding:2px 6px;color:#555">${r.label}</td><td style="padding:2px 6px;font-weight:600;text-align:right">${r.fmt(r.val)}${r.extra || ''}</td></tr>`;
        }
      }
      popupContent += '</table></div>';
      marker.bindPopup(popupContent, { maxWidth: 320 });
      S.escolasMarkers.addLayer(marker);
    }

    // Fit bounds if CRE filtered
    if (creFilter && filteredWithCoords.length > 0) {
      const bounds = L.latLngBounds(filteredWithCoords.map(e => [e.lat, e.lng]));
      map.fitBounds(bounds.pad(0.1));
    }

    // Table columns definition
    const TABLE_COLS = [
      { key: '_rank', label: '#', align: 'left', fmt: null, w: '30px' },
      { key: 'nome', label: 'Escola', align: 'left', fmt: v => v, w: null, text: true },
      { key: 'municipio', label: 'Município', align: 'left', fmt: v => v, w: null, text: true },
      { key: 'cre', label: 'CRE', align: 'center', fmt: v => v + 'ª', w: '44px' },
      { key: 'ideb_ai', label: 'IDEB Anos Iniciais', align: 'center', fmt: v => v?.toFixed(1), w: '56px', higher: true },
      { key: 'ideb_af', label: 'IDEB Anos Finais', align: 'center', fmt: v => v?.toFixed(1), w: '56px', higher: true },
      { key: 'ideb_em', label: 'IDEB Ensino Médio', align: 'center', fmt: v => v?.toFixed(1), w: '56px', higher: true },
      { key: 'tdi_ai', label: 'TDI Anos Iniciais', align: 'center', fmt: v => v?.toFixed(1) + '%', w: '56px', higher: false },
      { key: 'tdi_af', label: 'TDI Anos Finais', align: 'center', fmt: v => v?.toFixed(1) + '%', w: '56px', higher: false },
      { key: 'tdi_med', label: 'TDI Ensino Médio', align: 'center', fmt: v => v?.toFixed(1) + '%', w: '58px', higher: false },
      { key: 'inse_media', label: 'INSE', align: 'center', fmt: v => v?.toFixed(1), w: '48px', higher: true },
      { key: 'icg_nivel', label: 'ICG', align: 'center', fmt: v => 'N' + v, w: '40px', higher: false },
    ];

    // Sort state
    if (!escolaSortState) escolaSortState = { key: indicator, asc: cfg && !cfg.higher };
    const sortKey = escolaSortState.key;
    const sortAsc = escolaSortState.asc;

    // Sort
    const sorted = [...filtered].sort((a, b) => {
      let av, bv;
      if (sortKey === 'nome' || sortKey === 'municipio') {
        av = (a[sortKey] || '').toUpperCase();
        bv = (b[sortKey] || '').toUpperCase();
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      if (sortKey === 'cre') {
        av = parseInt(a.cre) || 99; bv = parseInt(b.cre) || 99;
      } else {
        av = a[sortKey]; bv = b[sortKey];
      }
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortAsc ? av - bv : bv - av;
    });

    // Header
    const thStyle = 'padding:4px 5px;background:#f0f4f8;border-bottom:2px solid #ddd;font-weight:700;font-size:9px;position:sticky;top:0;cursor:pointer;user-select:none;white-space:nowrap;z-index:2';
    const thead = document.getElementById('escola-table-head');
    thead.innerHTML = `<tr>${TABLE_COLS.map(c => {
      const arrow = sortKey === c.key ? (sortAsc ? ' ▲' : ' ▼') : '';
      const isActive = sortKey === c.key;
      const extra = isActive ? 'color:#0D47A1;' : 'color:#555;';
      const widthStyle = c.w ? `width:${c.w};min-width:${c.w};max-width:${c.w};` : '';
      return `<th data-sort-key="${c.key}" style="${thStyle};text-align:${c.align};${extra}${widthStyle}">${c.label}${arrow}</th>`;
    }).join('')}</tr>`;

    // Bind sort on headers
    thead.querySelectorAll('th[data-sort-key]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sortKey;
        if (key === '_rank') return;
        if (escolaSortState.key === key) {
          escolaSortState.asc = !escolaSortState.asc;
        } else {
          escolaSortState.key = key;
          // Default sort direction: text=asc, numbers depend on higher
          const col = TABLE_COLS.find(c => c.key === key);
          escolaSortState.asc = col?.text ? true : (col?.higher === false);
        }
        updateEscolas();
      });
    });

    // Body
    const tbody = document.getElementById('escola-table-body');
    const maxRows = 300;
    const display = sorted.slice(0, maxRows);
    const totalCols = TABLE_COLS.length;

    tbody.innerHTML = display.map((e, i) => {
      const rowBg = i % 2 === 0 ? '#fff' : '#fafbfc';
      const cells = TABLE_COLS.map(c => {
        const tdBase = `padding:3px 5px;border-bottom:1px solid #eee;font-size:9.5px;text-align:${c.align};white-space:nowrap;`;
        if (c.key === '_rank') return `<td style="${tdBase}color:#bbb">${i + 1}</td>`;
        if (c.key === 'nome') return `<td style="${tdBase}font-weight:600;max-width:200px;overflow:hidden;text-overflow:ellipsis" title="${e.nome}">${e.nome}</td>`;
        if (c.key === 'municipio') return `<td style="${tdBase}max-width:120px;overflow:hidden;text-overflow:ellipsis" title="${e.municipio}">${e.municipio}</td>`;
        if (c.key === 'cre') return `<td style="${tdBase}">${e.cre}ª</td>`;

        // Numeric indicator columns
        const val = e[c.key];
        if (val == null) return `<td style="${tdBase}color:#ddd">—</td>`;
        const color = getEscolaColor(val, c.key);
        const formatted = c.fmt(val);
        const isSortCol = sortKey === c.key;
        const fw = isSortCol ? 'font-weight:700;' : '';
        return `<td style="${tdBase}${fw}"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${color};margin-right:3px;vertical-align:middle"></span>${formatted}</td>`;
      }).join('');

      return `<tr style="background:${rowBg};cursor:pointer" onclick="if(S.escolasMap && ${e.lat ? 'true' : 'false'}) { S.escolasMap.setView([${e.lat || 0},${e.lng || 0}], 14); }">${cells}</tr>`;
    }).join('');

    if (sorted.length > maxRows) {
      tbody.innerHTML += `<tr><td colspan="${totalCols}" style="padding:8px;text-align:center;color:#999;font-size:10px">... e mais ${sorted.length - maxRows} escolas</td></tr>`;
    }
  }

  // Bind events
  document.getElementById('escola-indicator').addEventListener('change', updateEscolas);
  document.getElementById('escola-cre-filter').addEventListener('change', updateEscolas);
  let searchTimeout;
  document.getElementById('escola-search').addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(updateEscolas, 300);
  });

  // Initial render
  updateEscolas();
}

// ══════════════════════════════════════════════════════════
// SEÇÃO: SAERS — Avaliação Estadual do RS
// ══════════════════════════════════════════════════════════

function renderSaers() {
  const main = document.getElementById('main-content');
  destroyCharts(); destroyMap();
  document.body.classList.remove('sidebar-hidden');

  const sd = S.saersData;
  if (!sd || !sd.anos || !sd.anos.length) {
    main.innerHTML = `<div class="placeholder-view">
      <div style="font-size:40px;opacity:.3">📝</div>
      <div style="font-size:15px;font-weight:600">SAERS</div>
      <div style="font-size:11px;opacity:.7">Dados não disponíveis</div>
    </div>`;
    return;
  }

  const ETAPAS = ['2_EF', '5_EF', '9_EF', '3_EM'];
  const ETAPA_LABELS = sd.etapa_labels;
  const DISCS = ['LP', 'MT'];
  const DISC_LABELS = sd.disc_labels;
  const PADRAO_KEYS = ['avancado', 'adequado', 'basico', 'abaixo'];
  const PADRAO_LABELS = sd.padrao_labels;
  const PADRAO_DESC = sd.padrao_desc;
  const PADRAO_COLORS = { avancado: '#00AB4E', adequado: '#0097A7', basico: '#FFCB04', abaixo: '#EE302F' };
  const ETAPA_COLORS = { '2_EF': '#FFCB04', '5_EF': '#0097A7', '9_EF': '#F57C00', '3_EM': '#EE302F' };

  const anos = sd.anos.map(a => a.ano);
  const anoSel = S.anoSel && anos.includes(parseInt(S.anoSel)) ? parseInt(S.anoSel) : anos[anos.length - 1];

  const FONTE_SAERS = 'Fonte: SAERS/CAED — Avaliação do Estado do Rio Grande do Sul';

  // Helper: get geral data
  const getGeral = (yearData, etapa, disc) => yearData?.geral?.[`${etapa}_${disc}`] || {};

  // Helper: get SAERS year data considering geo filters
  function getSaersYearData(ano) {
    const yd = sd.anos.find(a => a.ano === ano);
    if (!yd) return null;
    if (S.munSel && yd.por_municipio) {
      const munData = yd.por_municipio[S.munSel];
      if (!munData) return null;
      // Build a geral-like object from municipality data
      const result = { geral: {} };
      ETAPAS.forEach(etapa => {
        DISCS.forEach(disc => {
          const key = `${etapa}_${disc}`;
          if (munData[key]) result.geral[key] = munData[key];
        });
      });
      return result;
    }
    if (S.creSel && yd.por_cre) {
      const creData = yd.por_cre[S.creSel];
      if (!creData) return null;
      const result = { geral: {} };
      ETAPAS.forEach(etapa => {
        DISCS.forEach(disc => {
          const key = `${etapa}_${disc}`;
          if (creData[key]) result.geral[key] = creData[key];
        });
      });
      return result;
    }
    return yd;
  }

  main.innerHTML = `
    <div class="section-sticky">
      ${sectionBanner('img/icons/sec_saeb.png', 'SAERS', 'Sistema de Avaliação do Rendimento Escolar do RS', { redeToggle: false })}
      <div class="kpi-strip" id="saers-kpis"></div>
    </div>

    <!-- ═══ BLOCO INFORMATIVO: O que é o SAERS? ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/sec_saeb.png" alt=""></span>
      <span class="section-divider-text">O que é o SAERS?</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="chart-card" style="padding:0;overflow:hidden;border:1px solid rgba(13,59,102,.08)">
      <div style="display:grid;grid-template-columns:1fr 1fr">
        <div style="padding:20px 24px;background:linear-gradient(135deg,#f6f9fc 0%,#eef2f7 100%)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
            <img src="img/icons/sec_saeb.png" alt="" style="width:20px;height:20px">
            <span style="font-size:14px;font-weight:700;color:var(--pri)">Definição</span>
          </div>
          <p style="font-size:11.5px;margin:0 0 16px;color:#333;line-height:1.75">
            O <strong>SAERS (Sistema de Avaliação do Rendimento Escolar do RS)</strong> é um conjunto de
            instrumentos que visa a fornecer evidências sobre a educação pública gaúcha, com o objetivo
            de <strong>qualificar a educação básica</strong> e subsidiar ações pedagógicas e de gestão.
          </p>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <img src="img/icons/sec_evolucao.png" alt="" style="width:20px;height:20px">
            <span style="font-size:14px;font-weight:700;color:var(--pri)">Abrangência</span>
          </div>
          <p style="font-size:11.5px;margin:0 0 14px;color:#333;line-height:1.75">
            O SAERS avalia o desempenho dos estudantes da rede pública estadual e das redes públicas
            municipais do Rio Grande do Sul, nos componentes curriculares de <strong>Língua Portuguesa</strong>
            e de <strong>Matemática</strong>, abrangendo os <strong>497 municípios</strong> do RS, nas jurisdições
            das <strong>30 Coordenadorias Regionais de Educação (CRE)</strong>.
          </p>
          <div style="background:rgba(255,203,4,.1);border:1px solid rgba(255,203,4,.25);border-radius:6px;padding:10px 14px">
            <p style="font-size:11px;margin:0;color:#5D4037;line-height:1.7">
              <strong style="color:#E65100">📋 Instrumentos:</strong> Os principais instrumentos de coleta de
              evidências no SAERS são <strong>testes cognitivos</strong> de Língua Portuguesa e Matemática e
              <strong>questionários contextuais</strong> — perfil escola, diretor, professor e estudante.
            </p>
          </div>
          <p style="font-size:9px;margin:10px 0 0;color:#999;line-height:1.5;font-style:italic">
            Fonte: SAERS/CAED — Avaliação do Estado do Rio Grande do Sul.
          </p>
        </div>
        <div style="padding:20px 24px;border-left:1px solid rgba(13,59,102,.06)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
            <img src="img/icons/panorama.png" alt="" style="width:20px;height:20px">
            <span style="font-size:14px;font-weight:700;color:var(--pri)">Padrões de Desempenho</span>
          </div>
          <p style="font-size:11px;margin:0 0 10px;color:#555;line-height:1.6">
            O SAERS classifica os estudantes em 4 padrões de desempenho conforme sua proficiência:
          </p>
          <table style="width:100%;font-size:10px;border-collapse:separate;border-spacing:0;margin-bottom:12px">
            <thead>
              <tr>
                <th style="padding:6px 8px;text-align:left;background:#f0f4f8;border-bottom:2px solid #ddd;font-weight:700;color:#333">Padrão</th>
                <th style="padding:6px 8px;text-align:left;background:#f0f4f8;border-bottom:2px solid #ddd;font-weight:700;color:#333">Descrição</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="padding:5px 8px;border-bottom:1px solid #eee"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#00AB4E;margin-right:5px;vertical-align:middle"></span><strong>Avançado</strong></td>
                <td style="padding:5px 8px;border-bottom:1px solid #eee;color:#555">Desenvolvimento além do esperado. Precisam de estímulos para continuar avançando.</td>
              </tr>
              <tr style="background:#fafbfc">
                <td style="padding:5px 8px;border-bottom:1px solid #eee"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#0097A7;margin-right:5px;vertical-align:middle"></span><strong>Adequado</strong></td>
                <td style="padding:5px 8px;border-bottom:1px solid #eee;color:#555">Consolidaram habilidades previstas. Requerem ações para aprofundar a aprendizagem.</td>
              </tr>
              <tr>
                <td style="padding:5px 8px;border-bottom:1px solid #eee"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#FFCB04;margin-right:5px;vertical-align:middle"></span><strong>Básico</strong></td>
                <td style="padding:5px 8px;border-bottom:1px solid #eee;color:#555">Ainda não desenvolveram adequadamente as habilidades essenciais. Demandam reforço.</td>
              </tr>
              <tr style="background:#fafbfc">
                <td style="padding:5px 8px"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#EE302F;margin-right:5px;vertical-align:middle"></span><strong>Abaixo do Básico</strong></td>
                <td style="padding:5px 8px;color:#555">Carência de aprendizagem para habilidades mínimas. Necessitam recuperação.</td>
              </tr>
            </tbody>
          </table>
          <div style="background:rgba(13,59,102,.05);border:1px solid rgba(13,59,102,.12);border-radius:6px;padding:10px 14px">
            <p style="font-size:10.5px;margin:0;color:#0D3B66;line-height:1.7">
              <strong>Nota:</strong> O SAERS utiliza a <strong>Teoria de Resposta ao Item (TRI)</strong> para o
              cálculo da proficiência, garantindo comparabilidade entre edições. Os padrões de desempenho
              são definidos pelo <strong>CAED/UFJF</strong> com base nos pontos de corte estabelecidos para cada etapa.
            </p>
          </div>
          <div style="margin-top:10px;background:rgba(255,203,4,.08);border:1px solid rgba(255,203,4,.18);border-radius:6px;padding:10px 14px">
            <p style="font-size:10.5px;margin:0;color:#5D4037;line-height:1.7">
              <strong>Etapas avaliadas:</strong> 2º ano EF (alfabetização), 5º ano EF, 9º ano EF e
              3ª série do Ensino Médio.
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ EIXO: Proficiência Média por Etapa ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/sec_saeb.png" alt=""></span>
      <span class="section-divider-text">Proficiência Média por Etapa — <span id="saers-kpi-ano">${anoSel}</span></span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px" id="saers-kpi-cards"></div>

    <!-- ═══ EIXO: Proficiência — Série Histórica ═══ -->
    <div class="section-divider" style="margin-top:20px">
      <span class="section-divider-icon"><img src="img/icons/sec_evolucao.png" alt=""></span>
      <span class="section-divider-text">Proficiência SAERS — Série Histórica (${anos[0]}–${anos[anos.length-1]})</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div style="grid-column:1/-1;font-size:10px;color:var(--text-sec);font-style:italic;margin:-4px 0 2px;padding-left:2px">💡 Clique na legenda para mostrar / ocultar os referidos dados.</div>
      <div class="chart-card">
        <div class="chart-title">2º ano EF — Evolução LP e MT</div>
        <div style="height:260px"><canvas id="chart-saers-2ef"></canvas></div>
        <div class="chart-source">${FONTE_SAERS}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title">5º ano EF — Evolução LP e MT</div>
        <div style="height:260px"><canvas id="chart-saers-5ef"></canvas></div>
        <div class="chart-source">${FONTE_SAERS}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title">9º ano EF — Evolução LP e MT</div>
        <div style="height:260px"><canvas id="chart-saers-9ef"></canvas></div>
        <div class="chart-source">${FONTE_SAERS}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title">3ª série EM — Evolução LP e MT</div>
        <div style="height:260px"><canvas id="chart-saers-3em"></canvas></div>
        <div class="chart-source">${FONTE_SAERS}</div>
      </div>
    </div>

    <!-- ═══ EIXO: Comparativo entre Edições ═══ -->
    <div class="section-divider" style="margin-top:20px">
      <span class="section-divider-icon"><img src="img/icons/sec_evolucao.png" alt=""></span>
      <span class="section-divider-text">Comparativo entre Edições</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="chart-card">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:6px">
          <div id="saers-comp-title-lp" class="chart-title" style="margin:0">Língua Portuguesa — Comparativo</div>
          <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#555">
            <label>Ano base:</label>
            <select id="sel-saers-comp-base" style="font-size:11px;padding:3px 8px;border-radius:4px;border:1px solid #ccc">
              ${anos.map(a => `<option value="${a}" ${a === anos[0] ? 'selected' : ''}>${a}</option>`).join('')}
            </select>
            <label>vs</label>
            <select id="sel-saers-comp-end" style="font-size:11px;padding:3px 8px;border-radius:4px;border:1px solid #ccc">
              ${anos.map(a => `<option value="${a}" ${a === anos[anos.length-1] ? 'selected' : ''}>${a}</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="height:220px"><canvas id="chart-saers-comp-lp"></canvas></div>
        <div class="chart-source">${FONTE_SAERS}</div>
      </div>
      <div class="chart-card">
        <div id="saers-comp-title-mt" class="chart-title">Matemática — Comparativo</div>
        <div style="height:220px"><canvas id="chart-saers-comp-mt"></canvas></div>
        <div class="chart-source">${FONTE_SAERS}</div>
      </div>
    </div>

    <!-- ═══ EIXO: Padrão de Desempenho ═══ -->
    <div class="section-divider" style="margin-top:20px">
      <span class="section-divider-icon"><img src="img/icons/nav_ideb.png" alt=""></span>
      <span class="section-divider-text">Padrão de Desempenho — <span id="saers-padrao-ano">${anoSel}</span></span>
      <span class="section-divider-line"></span>
    </div>



    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title" id="saers-padrao-lp-title">Distribuição — Língua Portuguesa — ${anoSel}</div>
        <div style="height:250px"><canvas id="chart-saers-padrao-lp"></canvas></div>
        <div class="chart-source">${FONTE_SAERS}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title" id="saers-padrao-mt-title">Distribuição — Matemática — ${anoSel}</div>
        <div style="height:250px"><canvas id="chart-saers-padrao-mt"></canvas></div>
        <div class="chart-source">${FONTE_SAERS}</div>
      </div>
    </div>

    <!-- ═══ EIXO: Distribuição Territorial ═══ -->
    <div class="section-divider" style="margin-top:20px">
      <span class="section-divider-icon"><img src="img/icons/territorial.png" alt=""></span>
      <span class="section-divider-text">Distribuição Territorial</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="map-table-row">
      <div class="map-container">
        <div class="map-toolbar">
          <h3>Mapa SAERS — <span id="saers-map-ano">${anoSel}</span></h3>
          <div class="map-layer-toggle">
            <button class="map-layer-btn active" id="saers-btn-layer-mun">Municípios</button>
            <button class="map-layer-btn" id="saers-btn-layer-cre">CREs</button>
          </div>
          <select id="sel-saers-map-metric" style="font-size:10px;padding:4px 8px;border-radius:4px;border:1px solid #ccc">
            <option value="LP">Proficiência LP</option>
            <option value="MT">Proficiência MT</option>
            <option value="pctLP">% Adeq.+Av. LP</option>
            <option value="pctMT">% Adeq.+Av. MT</option>
          </select>
          <select id="sel-saers-map-etapa" style="font-size:10px;padding:4px 8px;border-radius:4px;border:1px solid #ccc">
            ${ETAPAS.map(e => `<option value="${e}">${ETAPA_LABELS[e]}</option>`).join('')}
          </select>
        </div>
        <div id="map-leaflet"></div>
      </div>
      <div class="table-wrapper" id="saers-table-wrapper">
        <div class="table-header">
          <h3>Tabela por Município</h3>
          <input type="text" class="table-search" id="saers-mun-search" placeholder="Buscar...">
        </div>
        <div style="max-height:500px;overflow-y:auto">
          <table class="data-table" id="saers-mun-table">
            <thead><tr>
              <th>#</th><th>Município</th><th>Prof. LP</th><th>Prof. MT</th><th>% Adeq.+Av. LP</th><th>% Adeq.+Av. MT</th><th>Avaliados</th>
            </tr></thead>
            <tbody id="saers-mun-tbody"></tbody>
          </table>
        </div>
        <div class="chart-source">${FONTE_SAERS}</div>
      </div>
    </div>



  `;

  // ── Populate banner filters ──
  const selAno = document.getElementById('sel-ano');
  if (selAno) {
    selAno.innerHTML = anos.map(a => `<option value="${a}" ${a === anoSel ? 'selected' : ''}>${a}</option>`).join('');
    S.anoSel = String(anoSel);
  }
  // Populate CRE dropdown
  const selCre = document.getElementById('sel-cre');
  if (selCre && sd.anos[0]?.cre_lookup) {
    selCre.innerHTML = '<option value="">Todas</option>' +
      Object.entries(sd.anos[0].cre_lookup)
        .sort(([a],[b]) => a.localeCompare(b))
        .map(([cod, nome]) => `<option value="${cod}" ${S.creSel === cod ? 'selected' : ''}>${nome}</option>`).join('');
  }
  // Populate municipality dropdown from SAERS data
  if (sd.anos[0]?.mun_lookup) {
    const munInput = document.getElementById('mun-search-input');
    const munDd = document.getElementById('mun-dropdown-list');
    if (munInput && munDd) {
      const munEntries = Object.entries(sd.anos[0].mun_lookup).sort((a,b) => a[1].localeCompare(b[1]));
      munDd.innerHTML = munEntries.map(([cod, nome]) => `<div class="mun-dropdown-item" data-cod="${cod}">${nome}</div>`).join('');
      munInput.addEventListener('focus', () => { munDd.style.display = 'block'; });
      munInput.addEventListener('input', e => {
        const q = e.target.value.toLowerCase();
        munDd.querySelectorAll('.mun-dropdown-item').forEach(item => {
          item.style.display = item.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
        munDd.style.display = 'block';
      });
      munDd.addEventListener('click', e => {
        const item = e.target.closest('.mun-dropdown-item');
        if (!item) return;
        S.munSel = item.dataset.cod;
        munInput.value = item.textContent;
        munDd.style.display = 'none';
        buildSaersAll(sd);
      });
      document.addEventListener('click', e => {
        if (!e.target.closest('#mun-search-wrapper')) munDd.style.display = 'none';
      });
      if (S.munSel) {
        munInput.value = sd.anos[0].mun_lookup[S.munSel] || '';
      }
    }
  }

  // ── Bind banner filter events ──
  selAno?.addEventListener('change', e => {
    S.anoSel = e.target.value;
    buildSaersAll(sd);
  });
  selCre?.addEventListener('change', e => {
    S.creSel = e.target.value || null;
    S.munSel = null;
    const mi = document.getElementById('mun-search-input');
    if (mi) mi.value = '';
    buildSaersAll(sd);
  });

  // Search in table
  document.getElementById('saers-mun-search')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('#saers-mun-tbody tr').forEach(tr => {
      const nome = tr.children[1]?.textContent.toLowerCase() || '';
      tr.style.display = nome.includes(q) ? '' : 'none';
    });
  });

  // Bind map metric/etapa selects
  document.getElementById('sel-saers-map-metric')?.addEventListener('change', () => buildSaersMap(sd));
  document.getElementById('sel-saers-map-etapa')?.addEventListener('change', () => buildSaersMap(sd));

  // Map layer toggle (Municípios / CREs)
  const saersBtnMun = document.getElementById('saers-btn-layer-mun');
  const saersBtnCre = document.getElementById('saers-btn-layer-cre');
  if (saersBtnMun && saersBtnCre) {
    saersBtnMun.addEventListener('click', () => {
      S.saersMapMode = 'mun';
      saersBtnMun.classList.add('active'); saersBtnCre.classList.remove('active');
      buildSaersMap(sd);
    });
    saersBtnCre.addEventListener('click', () => {
      S.saersMapMode = 'cre';
      saersBtnCre.classList.add('active'); saersBtnMun.classList.remove('active');
      buildSaersMap(sd);
    });
  }

  // ── Build all ──
  updateActiveFilters();
  buildSaersAll(sd);
}

function buildSaersAll(sd) {
  destroyCharts();
  destroyMap();

  const ETAPAS = ['2_EF', '5_EF', '9_EF', '3_EM'];
  const ETAPA_LABELS = sd.etapa_labels;
  const DISCS = ['LP', 'MT'];
  const DISC_LABELS = sd.disc_labels;
  const PADRAO_KEYS = ['avancado', 'adequado', 'basico', 'abaixo'];
  const PADRAO_LABELS = sd.padrao_labels;
  const PADRAO_COLORS = { avancado: '#00AB4E', adequado: '#0097A7', basico: '#FFCB04', abaixo: '#EE302F' };
  const ETAPA_COLORS = { '2_EF': '#FFCB04', '5_EF': '#0097A7', '9_EF': '#F57C00', '3_EM': '#EE302F' };

  const anos = sd.anos.map(a => a.ano);
  const anoSel = S.anoSel ? parseInt(S.anoSel) : anos[anos.length - 1];
  const yearData = sd.anos.find(a => a.ano === anoSel) || sd.anos[sd.anos.length - 1];
  const getGeral = (yd, etapa, disc) => yd?.geral?.[`${etapa}_${disc}`] || {};
  const etapaFilt = '';  // No separate etapa filter in SAERS (we show all)

  // ── Helper: get SAERS year data considering geo ──
  function getSaersYearData(ano) {
    const yd = sd.anos.find(a => a.ano === ano);
    if (!yd) return null;
    if (S.munSel && yd.por_municipio) {
      const munData = yd.por_municipio[S.munSel];
      if (!munData) return null;
      const result = { geral: {} };
      ETAPAS.forEach(etapa => { DISCS.forEach(disc => {
        const key = `${etapa}_${disc}`;
        if (munData[key]) result.geral[key] = munData[key];
      }); });
      return result;
    }
    if (S.creSel && yd.por_cre) {
      const creData = yd.por_cre[S.creSel];
      if (!creData) return null;
      const result = { geral: {} };
      ETAPAS.forEach(etapa => { DISCS.forEach(disc => {
        const key = `${etapa}_${disc}`;
        if (creData[key]) result.geral[key] = creData[key];
      }); });
      return result;
    }
    return yd;
  }

  // ── Update year labels ──
  const kpiAnoLabel = document.getElementById('saers-kpi-ano');
  if (kpiAnoLabel) kpiAnoLabel.textContent = anoSel;
  const padraoAnoLabel = document.getElementById('saers-padrao-ano');
  if (padraoAnoLabel) padraoAnoLabel.textContent = anoSel;
  const mapAnoLabel = document.getElementById('saers-map-ano');
  if (mapAnoLabel) mapAnoLabel.textContent = anoSel;

  // ── 1. KPI Cards (like SAEB: with delta vs previous year) ──
  const curYearData = getSaersYearData(anoSel);
  // Find previous year
  const anoIdx = anos.indexOf(anoSel);
  const prevAno = anoIdx > 0 ? anos[anoIdx - 1] : null;
  const prevYearData = prevAno ? getSaersYearData(prevAno) : null;

  const kpis = [];
  const etapaAccents = { '2_EF': 'green', '5_EF': 'blue', '9_EF': 'green', '3_EM': 'red' };
  const etapaIcons = { '2_EF': 'img/icons/fundamental.png', '5_EF': 'img/icons/fundamental.png', '9_EF': 'img/icons/fundamental.png', '3_EM': 'img/icons/medio.png' };
  // Reorder KPIs: LP row first (top), MT row second (bottom) × 4 etapas columns
  // Layout: 4 columns × 2 rows = [2EF-LP, 5EF-LP, 9EF-LP, 3EM-LP, 2EF-MT, 5EF-MT, 9EF-MT, 3EM-MT]
  ['LP', 'MT'].forEach(disc => {
    ETAPAS.forEach(etapa => {
      const cur = curYearData?.geral?.[`${etapa}_${disc}`];
      const prev = prevYearData?.geral?.[`${etapa}_${disc}`];
      if (!cur?.proficiencia) return;
      kpis.push({
        label: `${ETAPA_LABELS[etapa]} — ${DISC_LABELS[disc]}`,
        val: cur.proficiencia,
        pctAA: cur.padrao?.pct_adequado_avancado,
        prevVal: prev?.proficiencia || null,
        accent: disc === 'LP' ? 'green' : 'blue',
        icon: etapaIcons[etapa],
        etapa, disc,
      });
    });
  });

  const kpiContainer = document.getElementById('saers-kpi-cards');
  if (kpiContainer) {
    kpiContainer.innerHTML = kpis.map((k, i) => {
      const delta = (k.val != null && k.prevVal != null) ? (k.val - k.prevVal) : null;
      const cls = delta !== null ? (delta >= 0 ? 'up' : 'down') : '';
      const arrow = delta !== null ? (delta >= 0 ? '↑' : '↓') : '';
      // Sparkline across all years
      const sparkVals = anos.map(a => {
        const yd = getSaersYearData(a);
        return yd?.geral?.[`${k.etapa}_${k.disc}`]?.proficiencia || 0;
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
          <span class="kpi-abs">${prevAno ? 'vs ' + prevAno : ''}</span>
        </div>
      </div>`;
    }).join('');
  }

  // ── 2. Line Charts: one per etapa with LP + MT lines ──
  const DISC_COLORS = { LP: '#0D47A1', MT: '#EE302F' };
  const ETAPA_CANVASES = { '2_EF': 'chart-saers-2ef', '5_EF': 'chart-saers-5ef', '9_EF': 'chart-saers-9ef', '3_EM': 'chart-saers-3em' };

  function buildSaersEtapaChart(etapa) {
    const el = document.getElementById(ETAPA_CANVASES[etapa]);
    if (!el) return;
    const datasets = DISCS.map(disc => {
      const data = anos.map(a => {
        const yd = getSaersYearData(a);
        return yd?.geral?.[`${etapa}_${disc}`]?.proficiencia || null;
      });
      return {
        label: DISC_LABELS[disc],
        data: data,
        borderColor: DISC_COLORS[disc],
        backgroundColor: DISC_COLORS[disc] + '18',
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
        layout: { padding: { top: 28 } },
        plugins: {
          ...CHART_DEFAULTS.plugins,
          legend: {
            display: true, position: 'top',
            labels: { font: { family: 'Inter', size: 11, weight: '600' }, boxWidth: 12, padding: 14, usePointStyle: true },
          },
          datalabels: {
            display: true,
            anchor: ctx => ctx.datasetIndex === 0 ? 'end' : 'start',
            align: ctx => ctx.datasetIndex === 0 ? 'top' : 'bottom',
            offset: 6,
            font: { family: 'Inter', size: 10, weight: '700' },
            color: ctx => Object.values(DISC_COLORS)[ctx.datasetIndex],
            formatter: v => v?.toFixed(1) ?? '',
          },
        },
        scales: {
          ...CHART_DEFAULTS.scales,
          y: { ...CHART_DEFAULTS.scales.y, beginAtZero: false,
            ticks: { ...CHART_DEFAULTS.scales.y.ticks, stepSize: 20 } }
        }
      }
    }));
  }

  ETAPAS.forEach(et => buildSaersEtapaChart(et));

  // Aliases for compatibility with comparativo/padrão sections
  const etapas = ETAPAS;
  const etapaLabels = ETAPAS.map(e => ETAPA_LABELS[e]);
  const etapaCores = ETAPAS.map(e => ETAPA_COLORS[e]);

  // ── 3. Comparativo entre Edições (like SAEB) ──
  function buildSaersCompCharts(anoBase, anoComp) {
    S.charts = S.charts.filter(c => {
      if (c.canvas?.id === 'chart-saers-comp-lp' || c.canvas?.id === 'chart-saers-comp-mt') { c.destroy(); return false; }
      return true;
    });

    const ydBase = getSaersYearData(anoBase);
    const ydComp = getSaersYearData(anoComp);

    ['LP', 'MT'].forEach(disc => {
      const canvasId = disc === 'LP' ? 'chart-saers-comp-lp' : 'chart-saers-comp-mt';
      const el = document.getElementById(canvasId);
      if (!el) return;

      const labels = etapaLabels;
      const dataBase = etapas.map(et => ydBase?.geral?.[`${et}_${disc}`]?.proficiencia || 0);
      const dataComp = etapas.map(et => ydComp?.geral?.[`${et}_${disc}`]?.proficiencia || 0);
      const deltas = dataComp.map((v, i) => v > 0 && dataBase[i] > 0 ? v - dataBase[i] : null);

      S.charts.push(new Chart(el, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: String(anoBase), data: dataBase, backgroundColor: 'rgba(180,180,180,.5)', borderColor: '#999', borderWidth: 1, borderRadius: 4, barPercentage: .7 },
            { label: String(anoComp), data: dataComp, backgroundColor: COLORS.pri + 'CC', borderColor: COLORS.pri, borderWidth: 1, borderRadius: 4, barPercentage: .7 },
          ]
        },
        options: {
          ...CHART_DEFAULTS,
          layout: { padding: { top: 24 } },
          plugins: {
            ...CHART_DEFAULTS.plugins,
            legend: {
              display: true,
              labels: { font: { family: 'Inter', size: 11, weight: '600' }, boxWidth: 12, padding: 10 },
            },
            datalabels: {
              display: true, anchor: 'end', align: 'top', offset: 3,
              font: { family: 'Inter', size: 11, weight: '700' },
              color: (ctx) => {
                if (ctx.datasetIndex === 1 && deltas[ctx.dataIndex] !== null) {
                  return deltas[ctx.dataIndex] >= 0 ? '#2874A6' : '#C62828';
                }
                return '#333';
              },
              formatter: (v, ctx) => {
                if (ctx.datasetIndex === 1 && deltas[ctx.dataIndex] !== null) {
                  const d = deltas[ctx.dataIndex];
                  return v.toFixed(0) + ' (' + (d >= 0 ? '+' : '') + d.toFixed(1) + ')';
                }
                return v > 0 ? v.toFixed(0) : '';
              },
            },
          },
          scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: false,
            ticks: { ...CHART_DEFAULTS.scales.y.ticks, stepSize: 20 } } }
        }
      }));
    });

    // Update titles
    const titleLp = document.getElementById('saers-comp-title-lp');
    if (titleLp) titleLp.textContent = `Língua Portuguesa — ${anoBase} vs ${anoComp}`;
    const titleMt = document.getElementById('saers-comp-title-mt');
    if (titleMt) titleMt.textContent = `Matemática — ${anoBase} vs ${anoComp}`;
  }

  buildSaersCompCharts(anos[0], anos[anos.length - 1]);

  // Bind comparativo selectors
  const selCompBase = document.getElementById('sel-saers-comp-base');
  const selCompEnd = document.getElementById('sel-saers-comp-end');
  if (selCompBase && selCompEnd) {
    const onCompChange = () => buildSaersCompCharts(parseInt(selCompBase.value), parseInt(selCompEnd.value));
    selCompBase.addEventListener('change', onCompChange);
    selCompEnd.addEventListener('change', onCompChange);
  }

  // ── 4. Padrão de Desempenho LP and MT ──
  const padraoLpTitle = document.getElementById('saers-padrao-lp-title');
  if (padraoLpTitle) padraoLpTitle.textContent = `Distribuição — Língua Portuguesa — ${anoSel}`;
  const padraoMtTitle = document.getElementById('saers-padrao-mt-title');
  if (padraoMtTitle) padraoMtTitle.textContent = `Distribuição — Matemática — ${anoSel}`;

  ['LP', 'MT'].forEach(disc => {
    const elId = disc === 'LP' ? 'chart-saers-padrao-lp' : 'chart-saers-padrao-mt';
    const el = document.getElementById(elId);
    if (!el) return;

    const labels = etapaLabels;
    const datasets = PADRAO_KEYS.map(p => ({
      label: PADRAO_LABELS[p],
      data: etapas.map(e => {
        const g = curYearData?.geral?.[`${e}_${disc}`];
        if (!g?.padrao) return 0;
        const total = PADRAO_KEYS.reduce((s, k) => s + (g.padrao[k] || 0), 0);
        return total > 0 ? round2((g.padrao[p] || 0) / total * 100) : 0;
      }),
      backgroundColor: PADRAO_COLORS[p] + 'CC',
      borderColor: PADRAO_COLORS[p],
      borderWidth: 1,
      borderRadius: 2,
    }));

    S.charts.push(new Chart(el, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        ...CHART_DEFAULTS,
        scales: {
          x: { ...CHART_DEFAULTS.scales.x, stacked: true },
          y: { ...CHART_DEFAULTS.scales.y, stacked: true, max: 100, ticks: { callback: v => v + '%' } },
        },
        plugins: {
          ...CHART_DEFAULTS.plugins,
          legend: { display: true, position: 'bottom', labels: { font: { size: 9 }, boxWidth: 12, padding: 6 } },
          datalabels: {
            display: true, color: '#fff', font: { size: 9, weight: 700, family: 'Inter' },
            formatter: v => v >= 5 ? v.toFixed(0) + '%' : '',
          },
        }
      }
    }));
  });

  // ── 5. Municipality Table ──
  buildSaersMunTable(yearData, '');

  // ── 6. Map ──
  buildSaersMap(sd);

  // ── Inject export buttons ──
  injectExportButtons();
  updateActiveFilters();
}

function buildSaersMap(sd) {
  if (S.map) { S.map.remove(); S.map = null; S.mapLayer = null; }
  if (S.mapLegend) { S.mapLegend.remove(); S.mapLegend = null; }

  const mapEl = document.getElementById('map-leaflet');
  if (!mapEl || !S.geo) return;

  const anos = sd.anos.map(a => a.ano);
  const anoSel = S.anoSel ? parseInt(S.anoSel) : anos[anos.length - 1];
  const yearData = sd.anos.find(a => a.ano === anoSel) || sd.anos[sd.anos.length - 1];
  if (!yearData?.por_municipio) return;

  const ETAPAS = ['2_EF', '5_EF', '9_EF', '3_EM'];
  const metric = document.getElementById('sel-saers-map-metric')?.value || 'LP';
  const etapa = document.getElementById('sel-saers-map-etapa')?.value || '5_EF';
  const disc = (metric === 'LP' || metric === 'pctLP') ? 'LP' : 'MT';
  const key = `${etapa}_${disc}`;
  const isPct = metric.startsWith('pct');

  const ETAPA_LABELS = sd.etapa_labels;
  const metricLabel = isPct ? '% Adeq.+Av.' : 'Proficiência';
  const discLabel = disc;

  const isCre = S.saersMapMode === 'cre';

  // Build data map: cod -> value
  const dataMap = {};
  const vals = [];

  if (isCre && yearData.por_cre) {
    // CRE mode: use por_cre data directly (pad codes to match GeoJSON)
    for (const [codCre, creData] of Object.entries(yearData.por_cre)) {
      const d = creData[key];
      if (!d) continue;
      const val = isPct ? d.padrao?.pct_adequado_avancado : d.proficiencia;
      const paddedCode = codCre.padStart(2, '0');
      if (val != null) { dataMap[paddedCode] = val; vals.push(val); }
    }
  } else {
    // Municipality mode
    for (const [cod, munData] of Object.entries(yearData.por_municipio)) {
      const d = munData[key];
      if (!d) continue;
      const val = isPct ? d.padrao?.pct_adequado_avancado : d.proficiencia;
      if (val != null) { dataMap[cod] = val; vals.push(val); }
    }
  }

  if (vals.length === 0) return;

  // Use the standard MAP_SCALE from the Acesso section (8 levels)
  vals.sort((a, b) => a - b);
  const breaks = [];
  for (let i = 0; i < MAP_SCALE.length; i++) {
    const idx = Math.min(Math.floor((i / MAP_SCALE.length) * vals.length), vals.length - 1);
    breaks.push(vals[idx]);
  }

  function getClr(v) {
    if (v == null) return '#f0f0f0';
    for (let i = breaks.length - 1; i >= 0; i--) {
      if (v >= breaks[i]) return MAP_SCALE[i];
    }
    return MAP_SCALE[0];
  }

  S.map = L.map(mapEl).setView([-29.8, -53.5], 6);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '© CartoDB © OSM',
    maxZoom: 18,
  }).addTo(S.map);

  const lookup = yearData.mun_lookup || {};
  const creLookupRaw = yearData.cre_lookup || {};
  const creLookup = {};
  for (const [k, v] of Object.entries(creLookupRaw)) {
    creLookup[k.padStart(2, '0')] = v;
  }

  if (isCre && S.creGeo) {
    // CRE layer
    S.mapLayer = L.geoJSON(S.creGeo, {
      style: feature => {
        const codCre = String(feature.properties.cod_cre || feature.properties.CD_GEOCODR || '');
        const val = dataMap[codCre];
        return { fillColor: getClr(val), weight: 1.5, color: '#fff', fillOpacity: 0.8 };
      },
      onEachFeature: (feature, layer) => {
        const codCre = String(feature.properties.cod_cre || feature.properties.CD_GEOCODR || '');
        const nome = creLookup[codCre] || feature.properties.nome || codCre;
        const val = dataMap[codCre];
        layer.bindTooltip(`<strong>${nome}</strong><br>${metricLabel} ${discLabel} (${ETAPA_LABELS[etapa]}): ${val != null ? (isPct ? val.toFixed(1) + '%' : val.toFixed(1)) : 'Sem dados'}`, {
          sticky: true, className: 'map-tooltip',
        });
      }
    }).addTo(S.map);
  } else {
    // Municipality layer (no labels on polygons)
    S.mapLayer = L.geoJSON(S.geo, {
      style: feature => {
        const cod = String(feature.properties.cod_mun);
        const val = dataMap[cod];
        return { fillColor: getClr(val), weight: 0.8, color: '#fff', fillOpacity: 0.85 };
      },
      onEachFeature: (feature, layer) => {
        const cod = String(feature.properties.cod_mun);
        const nome = lookup[cod] || feature.properties.nome || cod;
        const val = dataMap[cod];
        layer.bindTooltip(`<strong>${nome}</strong><br>${metricLabel} ${discLabel} (${ETAPA_LABELS[etapa]}): ${val != null ? (isPct ? val.toFixed(1) + '%' : val.toFixed(1)) : 'Sem dados'}`, {
          sticky: true, className: 'map-tooltip',
        });
        layer.on('click', () => {
          S.munSel = cod;
          const mi = document.getElementById('mun-search-input');
          if (mi) mi.value = nome;
          buildSaersAll(sd);
        });
      }
    }).addTo(S.map);
  }

  // Legend
  S.mapLegend = L.control({ position: 'bottomright' });
  S.mapLegend.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = `<strong>${metricLabel} ${discLabel}</strong><br>` +
      MAP_SCALE.map((c, i) => {
        const from = i === 0 ? 'Menor' : breaks[i]?.toFixed(isPct ? 1 : 0);
        const to = i < MAP_SCALE.length - 1 ? breaks[i + 1]?.toFixed(isPct ? 1 : 0) : 'Maior';
        return `<i style="background:${c}"></i> ${from}–${to}`;
      }).join('<br>') +
      `<br><i style="background:#f0f0f0"></i> Sem dados`;
    return div;
  };
  S.mapLegend.addTo(S.map);

  // No CRE overlay on SAERS municipality map (cleaner visualization)
}


function round2(v) { return Math.round(v * 100) / 100; }

function buildSaersMunTable(yearData, etapaFilt) {
  const ETAPAS = ['2_EF', '5_EF', '9_EF', '3_EM'];
  const etapas = etapaFilt ? [etapaFilt] : ETAPAS;
  const tbody = document.getElementById('saers-mun-tbody');
  if (!tbody || !yearData.por_municipio) return;

  // Aggregate LP and MT across selected etapas per municipality
  const rows = Object.entries(yearData.por_municipio).map(([cod, munData]) => {
    let lpSum = 0, lpN = 0, mtSum = 0, mtN = 0;
    let lpAA = 0, lpTotal = 0, mtAA = 0, mtTotal = 0;
    let avaliados = 0;

    etapas.forEach(etapa => {
      const lp = munData[`${etapa}_LP`];
      if (lp) {
        if (lp.proficiencia != null) { lpSum += lp.proficiencia * lp.n_proficiencia; lpN += lp.n_proficiencia; }
        if (lp.padrao) {
          lpAA += (lp.padrao.avancado || 0) + (lp.padrao.adequado || 0);
          lpTotal += (lp.padrao.avancado || 0) + (lp.padrao.adequado || 0) + (lp.padrao.basico || 0) + (lp.padrao.abaixo || 0);
        }
        avaliados += lp.avaliados || 0;
      }
      const mt = munData[`${etapa}_MT`];
      if (mt) {
        if (mt.proficiencia != null) { mtSum += mt.proficiencia * mt.n_proficiencia; mtN += mt.n_proficiencia; }
        if (mt.padrao) {
          mtAA += (mt.padrao.avancado || 0) + (mt.padrao.adequado || 0);
          mtTotal += (mt.padrao.avancado || 0) + (mt.padrao.adequado || 0) + (mt.padrao.basico || 0) + (mt.padrao.abaixo || 0);
        }
      }
    });

    return {
      cod, nome: yearData.mun_lookup?.[cod] || cod,
      profLP: lpN > 0 ? round2(lpSum / lpN) : null,
      profMT: mtN > 0 ? round2(mtSum / mtN) : null,
      pctLP: lpTotal > 0 ? round2(lpAA / lpTotal * 100) : null,
      pctMT: mtTotal > 0 ? round2(mtAA / mtTotal * 100) : null,
      avaliados,
    };
  }).filter(r => r.profLP != null || r.profMT != null)
    .sort((a, b) => (b.profLP || 0) - (a.profLP || 0));

  tbody.innerHTML = rows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${r.nome}</strong></td>
      <td>${r.profLP != null ? r.profLP.toFixed(1) : '—'}</td>
      <td>${r.profMT != null ? r.profMT.toFixed(1) : '—'}</td>
      <td>${r.pctLP != null ? r.pctLP.toFixed(1) + '%' : '—'}</td>
      <td>${r.pctMT != null ? r.pctMT.toFixed(1) + '%' : '—'}</td>
      <td>${formatNum(r.avaliados)}</td>
    </tr>
  `).join('');

  // Make table sortable
  const table = document.getElementById('saers-mun-table');
  if (table) {
    table.querySelectorAll('thead th').forEach((th, colIdx) => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const rows = [...tbody.querySelectorAll('tr')];
        const isNum = colIdx >= 2;
        const dir = th.dataset.sort === 'asc' ? 'desc' : 'asc';
        th.dataset.sort = dir;
        rows.sort((a, b) => {
          let va = a.children[colIdx]?.textContent.replace(/[%.,]/g, '') || '';
          let vb = b.children[colIdx]?.textContent.replace(/[%.,]/g, '') || '';
          if (isNum) { va = parseFloat(va) || 0; vb = parseFloat(vb) || 0; }
          return dir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
        });
        rows.forEach(r => tbody.appendChild(r));
      });
    });
  }
}

// ══════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════

async function init() {
  initNav();

  try {
    const [respData, respGeo, respInfra, respDoc, respFtl, respSaeb, respFluxo, respCreGeo, respCreLookup, respInse, respIcg, respAfd, respIdeb, respTdi, respEscolas, respSaers] = await Promise.all([
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
      fetch('dados/4_10_tdi.json'),
      fetch('dados/escolas_estaduais.json'),
      fetch('dados/4_saers.json'),
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
    if (respTdi.ok)       S.tdi       = await respTdi.json();
    if (respEscolas.ok)   S.escolasData = await respEscolas.json();
    if (respSaers.ok)     S.saersData   = await respSaers.json();

    // Seed rede cache with initial estadual data
    S.redeCache.estadual = { acesso: S.data, infra: S.infra, fluxo: S.fluxo, saeb: S.saeb, inse: S.inse, icg: S.icg, afd: S.afd, ideb: S.ideb, tdi: S.tdi };

    // Build universal municipality lookup (persists across rede changes)
    S._universalMunLookup = { ...(S.data?.lookup_municipios || {}) };

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
