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
  loaded: false,
  pendingView: null,
  _currentView: 'home',
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
  saersEscolasData: null, // 4_saers_escolas.json — SAERS por escola estadual
  escolasData: null, // escolas_estaduais.json — Visão por Escola
  escolasMap: null,  // Leaflet map instance for escolas
  escolasMarkers: null, // Leaflet layer group for markers
  escolasCreOverlay: null, // CRE boundaries on escolas map
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

// ── Hiperlinks de fonte/conceito (caderno conceitual e notas técnicas) ──
const LINK_FONTE = 'color:inherit;text-decoration:underline dotted;text-underline-offset:2px';
/** Monta um link de fonte/conceito padronizado para os rodapés dos gráficos. */
function fonteLink(url, label, title) {
  return `<a href="${url}" target="_blank" rel="noopener" style="${LINK_FONTE}" title="${(title || '').replace(/"/g, '&quot;')}">${label}</a>`;
}

// URLs institucionais de referência conceitual (INEP / CAEd)
const URL_CENSO = 'https://www.gov.br/inep/pt-br/areas-de-atuacao/pesquisas-estatisticas-e-indicadores/censo-escolar';
const URL_CADERNO_CENSO = 'https://download.inep.gov.br/publicacoes/institucionais/estatisticas_e_indicadores/cadernos_de_conceitos_2025.pdf';
const URL_INDICADORES = 'https://www.gov.br/inep/pt-br/acesso-a-informacao/dados-abertos/indicadores-educacionais';
const URL_SAEB = 'https://www.gov.br/inep/pt-br/areas-de-atuacao/avaliacao-e-exames-educacionais/saeb';
const URL_IDEB = 'https://www.gov.br/inep/pt-br/areas-de-atuacao/pesquisas-estatisticas-e-indicadores/ideb';
const URL_IDEB_NOTA = 'http://download.inep.gov.br/educacao_basica/portal_ideb/o_que_e_o_ideb/Nota_Tecnica_n1_concepcaoIDEB.pdf';
const URL_SAERS = 'https://saers.caeddigital.net/';

const FONTE_CENSO = 'Fonte: INEP — ' +
  fonteLink(URL_CENSO, 'Censo Escolar da Educação Básica', 'Acessar Censo Escolar no portal INEP') + ' · ' +
  fonteLink(URL_CADERNO_CENSO, '📘 Caderno de Conceitos do Censo', 'Acessar o Caderno de Conceitos e Orientações (INEP)');

// Paleta Bandeira RS: Verde #00AB4E, Vermelho #EE302F, Amarelo #FFCB04
const COLORS = {
  pri: '#1d71b9', priDark: '#14507F', priLight: '#5AADE2', sec: '#3A8CC7',
  red: '#EE302F', redLight: '#F4706F',
  yellow: '#FFCB04', yellowLight: '#FFE066',
  accent: '#FFCB04', accentLight: '#FFE066',
  federal: '#1565C0', estadual: '#1d71b9', municipal: '#EE302F', privada: '#6A1B9A',
  masc: '#1976D2', fem: '#EE302F',
  branca: '#78909C', preta: '#37474F', parda: '#8D6E63', amarela: '#FFCB04', indigena: '#1d71b9', nd: '#B0BEC5',
  infantil: '#FFCB04', fundAI: '#0097A7', fundAF: '#F57C00', fundamental: '#1d71b9', medio: '#EE302F', eja: '#1565C0', especial: '#6A1B9A', blue: '#1565C0',
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

/** Returns the correct data source attribution for the active section */
function getExportSource() {
  const v = S._currentView || '';
  const sources = {
    acesso: 'Censo Escolar, INEP',
    infra: 'Censo Escolar, INEP',
    docencia: 'Censo Escolar, INEP',
    escolas: 'Censo Escolar, INEP',
    fluxo: 'INEP — Indicadores de Rendimento Escolar',
    saeb: 'Microdados SAEB — INEP',
    desempenho: 'Microdados SAEB — INEP',
    ideb: 'IDEB/INEP',
    inse: 'INEP — Indicador de Nível Socioeconômico (INSE/SAEB)',
    icg: 'INEP — Indicador de Complexidade de Gestão da Escola',
    afd: 'INEP — Indicador de Adequação da Formação Docente',
    tdi: 'INEP — Indicador de Distorção Idade-Série',
    saers: 'SAERS/CAED — Avaliação do Estado do Rio Grande do Sul',
    desigualdades: 'INEP — Indicadores Educacionais',
  };
  return (sources[v] || 'INEP') + ', extraído e tratado pela equipe SEDUC / Unesco';
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
  const metaRows = [
    ['Fonte', getExportSource()],
    ['Rede', getRedeLabel()],
    ['Recorte geográfico', getExportGeoLabel()],
    ['Ano/Edicao', S.anoSel || 'Geral'],
    ['Tabela', title],
    []
  ];
  const header = ['Categoria', ...datasets.map(ds => ds.label || 'Valor')];
  const rows = labels.map((lbl, i) => {
    return [lbl, ...datasets.map(ds => {
      const v = ds.data[i];
      return v != null ? String(v).replace('.', ',') : '';
    })];
  });

  const csv = '\uFEFF' + [...metaRows, header, ...rows].map(r => r.join(';')).join('\n');
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
    S.escolasMap.remove(); S.escolasMap = null; S.escolasMarkers = null; S.escolasCreOverlay = null;
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

  // Extract headers — handle multi-row thead (rowspan/colspan)
  const headers = [];
  const theadRows = table.querySelectorAll('thead tr');
  if (theadRows.length > 1) {
    // Multi-row: build a grid and flatten
    const nCols = [...theadRows[0].querySelectorAll('th')].reduce((s, th) => s + (parseInt(th.colSpan) || 1), 0);
    const grid = Array.from({ length: theadRows.length }, () => new Array(nCols).fill(''));
    theadRows.forEach((tr, ri) => {
      let ci = 0;
      tr.querySelectorAll('th').forEach(th => {
        while (grid[ri][ci]) ci++;
        const rs = parseInt(th.rowSpan) || 1, cs = parseInt(th.colSpan) || 1;
        const txt = th.textContent.trim().replace(/[⇅↑↓]/g, '').trim();
        for (let r = 0; r < rs; r++) for (let c = 0; c < cs; c++) {
          if (grid[ri + r]) grid[ri + r][ci + c] = grid[ri + r][ci + c] || txt;
        }
        ci += cs;
      });
    });
    // Flatten: combine top row + bottom row labels
    for (let c = 0; c < nCols; c++) {
      const parts = [...new Set(grid.map(row => row[c]).filter(Boolean))];
      headers.push(parts.join(' — '));
    }
  } else {
    table.querySelectorAll('thead th').forEach(th => headers.push(th.textContent.trim()));
  }

  // Extract visible rows
  const rows = [];
  table.querySelectorAll('tbody tr').forEach(tr => {
    if (tr.style.display === 'none') return;
    const cells = [];
    tr.querySelectorAll('td').forEach(td => cells.push(td.textContent.trim()));
    rows.push(cells);
  });

  const metaRows = [
    ['Fonte', getExportSource()],
    ['Rede', getRedeLabel()],
    ['Recorte geográfico', getExportGeoLabel()],
    ['Ano/Edicao', S.anoSel || 'Geral'],
    ['Tabela', title],
    []
  ];

  const csv = '\uFEFF' + [...metaRows, headers, ...rows].map(r => r.map(c => c.replace(/;/g, ',')).join(';')).join('\n');
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
  // Charts — botão no rodapé (chart-source) para não sobrepor filtros/legendas do cabeçalho
  document.querySelectorAll('.chart-card canvas').forEach(canvas => {
    const card = canvas.closest('.chart-card');
    if (!card) return;
    card.querySelectorAll('.export-btn').forEach(b => b.remove());
    const btn = document.createElement('button');
    btn.className = 'export-btn';
    btn.title = 'Baixar dados (CSV/Excel)';
    btn.innerHTML = '<svg width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z\"/><polyline points=\"14 2 14 8 20 8\"/><line x1=\"16\" y1=\"13\" x2=\"8\" y2=\"13\"/><line x1=\"16\" y1=\"17\" x2=\"8\" y2=\"17\"/></svg><span>CSV</span>';
    btn.addEventListener('click', function(e) { e.stopPropagation(); exportChartCSV(this); });
    const source = card.querySelector('.chart-source');
    if (source) {
      btn.classList.add('export-btn--footer');
      source.classList.add('chart-source--with-export');
      let wrap = source.querySelector('.chart-source-actions');
      if (!wrap) {
        wrap = document.createElement('span');
        wrap.className = 'chart-source-actions';
        source.appendChild(wrap);
      } else {
        wrap.innerHTML = '';
      }
      wrap.appendChild(btn);
    } else {
      card.style.position = 'relative';
      card.appendChild(btn);
    }
  });

  // Tables
  document.querySelectorAll('.data-table').forEach(table => {
    const wrapper = table.closest('.table-wrapper') || table.closest('.chart-card');
    if (!wrapper) return;
    wrapper.querySelectorAll('.export-table-btn').forEach(b => b.remove());
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
        <button class="hamburger" onclick="document.getElementById('sidebar').classList.toggle('open'); document.getElementById('sidebar-overlay').classList.toggle('visible');">
          <span></span><span></span><span></span>
        </button>
        <div class="section-banner-icon"><img src="${icon}" alt=""></div>
        <h2>${title}<span id="rede-subtitle">${subtitle || ''}</span></h2>
        <span id="mun-filter-slot" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-left:12px"></span>
      </div>
      <div class="section-banner-right" style="flex-direction:column;align-items:flex-end;gap:4px">
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
        <div style="font-size:9px;color:rgba(255,255,255,.6);text-align:right;font-weight:500;letter-spacing:.3px;padding-right:4px;">
          💡 Dica: Ajuste o zoom do painel<br>(Ctrl - ou Ctrl +) para sua preferência
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

/** Rótulo geográfico ativo para exportação (município / CRE / estado) */
function getExportGeoLabel() {
  if (S.munSel) {
    return S.data?.lookup_municipios?.[S.munSel] || S._universalMunLookup?.[S.munSel] || S.munSel;
  }
  if (S.creSel) {
    return S.creLookup?.cre_list?.find(c => c.cod_cre === S.creSel)?.nome_cre || `CRE ${S.creSel}`;
  }
  return 'Rio Grande do Sul (estado)';
}

/** Texto do separador "Distribuição Territorial" com rótulo dinâmico da rede + popup informativo */
function territorialDividerText() {
  const rede = getRedeLabel();
  const tip = `Esta subseção (mapas e tabela de municípios) reflete os dados da rede atualmente selecionada no seletor de rede: ${rede}. A Rede Estadual é o foco analítico e a visão padrão deste painel.`;
  return `Distribuição Territorial — Visão da ${rede}<span class="info-tooltip" title="${tip.replace(/"/g, '&quot;')}">ⓘ</span>`;
}

/** Lazy-load JSON data for a given rede. Returns cached if already loaded. */
async function loadRedeData(rede) {
  if (S.redeCache[rede]?.acesso && S.redeCache[rede]?.infra) {
    return S.redeCache[rede];
  }
  // Fetch all data sources in parallel; 404s handled gracefully
  const keys = ['acesso', 'infra', 'fluxo', 'saeb', 'inse', 'icg', 'afd', 'ideb', 'tdi', 'saers', 'saersEscolas', 'docentes'];
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
    `dados/4_saers_${rede}.json`,
    rede === 'estadual' ? `dados/4_saers_escolas.json`
      : rede === 'municipal' ? `dados/4_saers_escolas_municipal.json`
      : `dados/4_saers_escolas_${rede}.json`, // will 404 gracefully for other redes
    `dados/4_5_docentes_${rede}.json`
  ];
  const cb = '_cb=' + Date.now();
  const responses = await Promise.all(urls.map(u => fetch(u + '?' + cb).catch(() => null)));
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
    S.saersData = cached.saers;
    S.saersEscolasData = cached.saersEscolas;
    S.doc   = cached.docentes;
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
  // Remove previous handler to prevent listener accumulation across re-renders
  if (toggle._redeHandler) {
    toggle.removeEventListener('click', toggle._redeHandler);
  }
  toggle._redeHandler = e => {
    const btn = e.target.closest('.rede-toggle-btn');
    if (!btn || btn.disabled || btn.dataset.rede === S.redeSel) return;
    switchRede(btn.dataset.rede);
  };
  toggle.addEventListener('click', toggle._redeHandler);
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

function getInseScope(inse, ano) {
  if (!inse.serie_temporal[ano]) return null;
  if (S.munSel && inse.por_municipio?.[ano]?.[S.munSel]) {
    const m = inse.por_municipio[ano][S.munSel];
    return {
      media: m.inse,
      n_escolas: m.n_escolas,
      n_alunos: m.n_alunos,
      dist_niveis_escolas: m.dist_niveis || {},
      dist_niveis_alunos: m.dist_niveis || {},
      urbana: { media: m.urbana },
      rural: { media: m.rural },
    };
  } else if (S.creSel && inse.por_municipio?.[ano]) {
    const muns = getCreMuns(S.creSel);
    let sumInse = 0, sumEsc = 0, sumAlu = 0, uSum = 0, uCnt = 0, rSum = 0, rCnt = 0;
    const distEsc = {};
    for (const cod of muns) {
      const m = inse.por_municipio[ano][cod];
      if (!m) continue;
      if (m.inse && m.n_escolas) { sumInse += (m.inse * m.n_escolas); sumEsc += m.n_escolas; }
      if (m.n_alunos) sumAlu += m.n_alunos;
      if (typeof m.urbana === 'number') { uSum += m.urbana; uCnt++; }
      if (typeof m.rural === 'number') { rSum += m.rural; rCnt++; }
      if (m.dist_niveis) {
        for (const [niv, v] of Object.entries(m.dist_niveis)) {
          if (!distEsc[niv]) distEsc[niv] = { count: 0 };
          distEsc[niv].count += (v.count || 0);
        }
      }
    }
    for (const niv of Object.keys(distEsc)) {
      distEsc[niv].pct = sumEsc ? (distEsc[niv].count / sumEsc * 100) : 0;
    }
    return {
      media: sumEsc ? (sumInse / sumEsc) : null,
      n_escolas: sumEsc,
      n_alunos: sumAlu,
      dist_niveis_escolas: distEsc,
      dist_niveis_alunos: distEsc,
      urbana: uCnt ? { media: uSum / uCnt } : {},
      rural: rCnt ? { media: rSum / rCnt } : {},
    };
  }
  return inse.serie_temporal[ano];
}

/** Returns a suffix string for chart titles when a geo filter is active */
function geoSuffix() {
  if (S.munSel) {
    const name = S.data?.lookup_municipios?.[S.munSel] || S.munSel;
    return ` — ${name}`;
  }
  if (S.creSel) {
    const name = S.creLookup?.cre_list?.find(c => c.cod_cre === S.creSel)?.nome_cre || `CRE ${S.creSel}`;
    return ` — ${name}`;
  }
  return '';
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
        <div class="chart-title" id="title-serie">Evolução de ${S.etapaSel ? ({'mat_infantil':'Infantil','mat_fund_ai':'Anos Iniciais','mat_fund_af':'Anos Finais','mat_medio':'Médio','mat_eja':'EJA','mat_prof_tec':'Técnico'}[S.etapaSel]) : 'Matrículas'} — ${redeLabel} (${anos[0]}–${anoSel})${geoSuffix()}</div>
        <div style="height:220px"><canvas id="chart-serie"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card d3">
        <div class="chart-title" id="title-etapa">Matrículas por Etapa — ${anoSel}${geoSuffix()}</div>
        <div style="font-size:9px;color:var(--pri);opacity:.7;margin:-2px 0 2px;font-weight:500">👆 Clique em uma barra deste gráfico para visualizar a evolução de matrículas da referida etapa no gráfico ao lado</div>
        <div style="height:220px"><canvas id="chart-etapa"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title" id="title-integral">Educação Integral — Evolução${geoSuffix()}</div>
        <div id="integral-delta" style="font-size:11px;color:#00AB4E;font-weight:600;margin:2px 0"></div>
        <div style="height:200px"><canvas id="chart-integral"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title" id="title-integral-pct">Educação Integral — Proporção do Total de Matrículas (%)${geoSuffix()}</div>
        <div id="integral-pct-filters" style="display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 6px 0;font-size:10px"></div>
        <div style="height:220px"><canvas id="chart-integral-pct"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 2fr;gap:10px">
      <div class="chart-card d4">
        <div class="chart-title" id="title-faixa">Matrículas por Faixa Etária — ${anoSel}${geoSuffix()}</div>
        <div style="height:220px"><canvas id="chart-faixa"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title" id="title-noturno">Matrículas Noturnas — Evolução${geoSuffix()}</div>
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
        <div class="chart-title" id="title-raca">Evolução por Raça/Cor — ${redeLabel}${geoSuffix()}</div>
        <div id="raca-filters" style="display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 6px 0;font-size:10px"></div>
        <div style="height:210px"><canvas id="chart-raca"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card d6">
        <div class="chart-title" id="title-sexo">Distribuição por Sexo${geoSuffix()}</div>
        <div style="height:220px"><canvas id="chart-sexo"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card d7">
        <div class="chart-title" id="title-locdif">Localização Diferenciada — Matrículas${geoSuffix()}</div>
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
        <div class="chart-title" id="title-esp-evo">Alunos da Ed. Especial — Evolução${geoSuffix()}</div>
        <div style="height:200px"><canvas id="chart-esp-evo"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card d9">
        <div class="chart-title" id="title-esp-tipo">Classes Comuns vs Exclusivas — ${anoSel}${geoSuffix()}</div>
        <div style="height:200px"><canvas id="chart-esp-tipo"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card d10">
        <div class="chart-title" id="title-esp-etapa">Ed. Especial (Classes Comuns) por Etapa — ${anoSel}${geoSuffix()}</div>
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
        <div class="chart-title">Ensino Fundamental — Por Ano/Série${geoSuffix()}</div>
        <div style="height:250px"><canvas id="chart-serie-fund"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Ensino Médio — Por Série${geoSuffix()}</div>
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
        <div class="chart-title" id="title-prof-evo">Matrículas na Ed. Profissional — Evolução${geoSuffix()}
          <span class="info-tooltip" title="Ed. Profissional (QT_MAT_PROF): total de matrículas em educação profissional, incluindo cursos técnicos, FIC e qualificação profissional.&#10;&#10;Cursos Técnicos (QT_MAT_PROF_TEC): subconjunto da Ed. Profissional — apenas cursos técnicos de nível médio (concomitante, subsequente e integrado ao EM).">ⓘ</span>
        </div>
        <div style="height:250px"><canvas id="chart-prof-evo"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title" id="title-prof-comp">Composição da Oferta Técnica — ${anoSel}${geoSuffix()}
          <span class="info-tooltip" title="Integrado ao EM: aluno cursa ensino médio e curso técnico em currículo unificado (3–4 anos).&#10;&#10;Subsequente: aluno já concluiu o ensino médio e cursa apenas o técnico.&#10;&#10;Concomitante: aluno cursa ensino médio e técnico simultaneamente, mas em matrículas separadas.&#10;&#10;EJA Técnico: Educação de Jovens e Adultos integrada a curso técnico de nível médio.">ⓘ</span>
        </div>
        <div style="font-size:9px;color:var(--pri);opacity:.7;margin:-2px 0 2px;font-weight:500">👆 Clique em uma barra para filtrar a evolução ao lado</div>
        <div style="height:250px"><canvas id="chart-prof-comp"></canvas></div>
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
        <div class="chart-title">Diurno vs Noturno — Por Etapa${geoSuffix()}</div>
        <div style="height:280px"><canvas id="chart-turno-etapa"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
    </div>

    <!-- ═══ EIXO: Distribuição Territorial ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/territorial.png" alt=""></span>
      <span class="section-divider-text">${territorialDividerText()}</span>
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

  // Populate dropdowns IMMEDIATELY after innerHTML creates them
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

  // Bind filter event listeners EARLY — before build* functions —
  // so the rede toggle stays functional even if a chart build throws
  bindTopbarFilters();
  bindRedeToggle();

  try {
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
  } catch (err) {
    console.warn('[renderAcesso] build error (munSel=' + S.munSel + '):', err);
  }
  // Re-populate and restore ALL dropdown selections after build
  // (applyMunFilter inside buildMunTable may have destroyed/rebuilt parts)
  if (selAno) {
    if (!selAno.options.length) {
      selAno.innerHTML = anos.map(a => `<option value="${a}" ${a === anoSel ? 'selected' : ''}>${a}</option>`).join('');
    }
    selAno.value = anoSel;
  }
  populateCreDropdown();
  populateMunDropdown(S.creSel || null);
  {
    const sc = document.getElementById('sel-cre');
    if (sc && S.creSel) sc.value = S.creSel;
    const mi = document.getElementById('mun-search-input');
    if (mi && S.munSel) {
      const lookup = S.data?.lookup_municipios || {};
      mi.value = lookup[S.munSel] || '';
    }
  }

  bindFilters(d, anos);
  updateActiveFilters();
  updateFilterAwareness();
  // Garantir botões CSV após filtro município/CRE (applyMunFilter recria gráficos)
  injectExportButtons();
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

  const accentColors = { green: '#1d71b9', yellow: '#FFCB04', red: '#EE302F', blue: '#1565C0' };

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
    if (!munData) {
      injectExportButtons();
      return;
    }

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
    setTitle('title-integral-pct', `Educação Integral — Proporção do Total (%) — ${nome}`);
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
    buildIntegralPct(d);
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
    buildIntegralPct(d);
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
    buildIntegralPct(d);
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
  // Reforço após paint dos gráficos (filtro município destrói/recria canvas)
  requestAnimationFrame(() => injectExportButtons());
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
  '#edf3fa', '#c7dbed', '#8fb8da', '#5a96c7',
  '#3578b3', '#1d71b9', '#14507F', '#0B2A47'
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
  // Note: sel-ano listener is handled by bindTopbarFilters (supports geo filters)
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
        <div id="infra-chart-title" class="chart-title" style="margin:0">Tecnologia — Comparativo${geoSuffix()}</div>
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
      <span class="section-divider-text">${territorialDividerText()}</span>
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
            <option value="IN_BANDA_LARGA">Banda Larga</option>
            <option value="IN_BIBLIOTECA">Biblioteca</option>
            <option value="IN_QUADRA_ESPORTES">Quadra</option>
            <option value="IN_LABORATORIO_INFORMATICA">Lab. Informática</option>
            <option value="IN_LABORATORIO_CIENCIAS">Lab. Ciências</option>
            <option value="IN_SALA_ATENDIMENTO_ESPECIAL">Sala AEE</option>
            <option value="IN_REFEITORIO">Refeitório</option>
            <option value="IN_ACESSIBILIDADE_RAMPAS">Rampas</option>
            <option value="IN_BANHEIRO_PNE">Banh. PNE</option>
            <option value="IN_AGUA_POTAVEL">Água Potável</option>
            <option value="IN_ALIMENTACAO">Alimentação</option>
            <option value="IN_SALA_DIRETORIA">Sala Diretoria</option>
            <option value="IN_SALA_PROFESSOR">Sala Professor</option>
            <option value="IN_CLIMATIZACAO">Climatização</option>
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
              <th style="position:sticky;left:0;z-index:3;background:#f8f9fa;width:30px">#</th>
              <th style="position:sticky;left:30px;z-index:3;background:#f8f9fa;min-width:140px;border-right:2px solid #e0e0e0">Município</th>
              <th>Esc.</th>
              <th>Internet</th><th>Banda L.</th><th>Biblioteca</th><th>Quadra</th><th>Lab.Inf.</th><th>Lab.Ciên.</th><th>Sala AEE</th><th>Refeitório</th><th>Rampas</th><th>Banh.PNE</th><th>Água Pot.</th><th>Climatiz.</th>
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
      <div style="font-family:Inter;min-width:260px">
        <strong style="font-size:12px">${e.nome}</strong><br>
        <span style="font-size:10px;color:#666">${e.municipio || lookup[e.cod_mun] || ''} — INEP: ${e.inep}</span>
        <hr style="margin:4px 0;border:none;border-top:1px solid #eee">
        <div style="font-size:10px;margin-bottom:4px">
          ${e.salas_total ? `Salas: ${e.salas_total} (${e.salas_clim || 0} clim.)` : ''}
        </div>
        <div style="font-size:9px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;line-height:1.5">
          <span>${yesNo(e.internet)} Internet</span>
          <span>${yesNo(e.banda_larga)} Banda Larga</span>
          <span>${yesNo(e.computador)} Computador</span>
          <span>${yesNo(e.biblioteca || e.bib_sala_leit)} Biblioteca</span>
          <span>${yesNo(e.lab_info)} Lab. Info</span>
          <span>${yesNo(e.lab_ciencias)} Lab. Ciências</span>
          <span>${yesNo(e.quadra || e.quadra_coberta)} Quadra</span>
          <span>${yesNo(e.sala_diretoria)} S. Diretoria</span>
          <span>${yesNo(e.sala_professor)} S. Professor</span>
          <span>${yesNo(e.rampas)} Rampas</span>
          <span>${yesNo(e.banheiro_pne)} Banh. PNE</span>
          <span>${yesNo(e.sala_aee)} Sala AEE</span>
          <span>${yesNo(e.refeitorio)} Refeitório</span>
          <span>${yesNo(e.agua_potavel)} Água Pot.</span>
          <span>${yesNo(e.alimentacao)} Alimentação</span>
        </div>
      </div>
    `, { maxWidth: 320 });
    markers.addLayer(marker);
  });
  markers.addTo(S.map);
  S.mapLayer = markers;
  if (withCoords.length) S.map.fitBounds(markers.getBounds(), { padding: [20, 20] });

  // Update table to show escola infra
  const titleEl = document.querySelector('#infra-mun-table')?.closest('.chart-card')?.querySelector('.table-header h3');
  if (titleEl) titleEl.textContent = 'Infraestrutura por Escola — 2025';

  const thead = document.querySelector('#infra-mun-table thead tr');
  if (thead) thead.innerHTML = '<th style="width:30px">#</th><th style="position:sticky;left:0;z-index:2;background:#f8f9fa;min-width:180px;border-right:2px solid #e0e0e0">Escola</th><th>Município</th><th>Internet</th><th>Banda Larga</th><th>Computador</th><th>Biblioteca</th><th>Lab.Inf.</th><th>Lab.Ciên.</th><th>Quadra</th><th>S.Diretoria</th><th>S.Professor</th><th>Rampas</th><th>Banh.PNE</th><th>Refeitório</th><th>Sala AEE</th><th>Água</th><th>Aliment.</th><th>Salas</th><th>Climat.</th>';

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
      ${pctBadge(e.computador)}
      ${pctBadge(e.biblioteca || e.bib_sala_leit)}
      ${pctBadge(e.lab_info)}
      ${pctBadge(e.lab_ciencias)}
      ${pctBadge(e.quadra || e.quadra_coberta)}
      ${pctBadge(e.sala_diretoria)}
      ${pctBadge(e.sala_professor)}
      ${pctBadge(e.rampas)}
      ${pctBadge(e.banheiro_pne)}
      ${pctBadge(e.refeitorio)}
      ${pctBadge(e.sala_aee)}
      ${pctBadge(e.agua_potavel)}
      ${pctBadge(e.alimentacao)}
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

/** Latest year available in infra.por_municipio (was hardcoded to 2024) */
function infraLatestMunYear(infra) {
  const keys = Object.keys(infra?.por_municipio || {});
  return keys.length ? keys.sort().pop() : null;
}

/* ── Infra Municipality Table ── */
function buildInfraMunTable(infra) {
  const tbody = document.getElementById('infra-mun-tbody');
  if (!tbody) return;
  const lookup = S.data?.lookup_municipios || {};
  const munData = infra.por_municipio?.[infraLatestMunYear(infra)] || {};
  const indicators = ['IN_INTERNET', 'IN_BANDA_LARGA', 'IN_BIBLIOTECA', 'IN_QUADRA_ESPORTES', 'IN_LABORATORIO_INFORMATICA', 'IN_LABORATORIO_CIENCIAS', 'IN_SALA_ATENDIMENTO_ESPECIAL', 'IN_REFEITORIO', 'IN_ACESSIBILIDADE_RAMPAS', 'IN_BANHEIRO_PNE', 'IN_AGUA_POTAVEL', 'IN_CLIMATIZACAO'];

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
      `<tr data-cod="${r.cod}" style="cursor:pointer" title="Clique para filtrar por ${r.nome}"><td style="position:sticky;left:0;z-index:1;background:#fff">${i + 1}</td><td style="position:sticky;left:30px;z-index:1;background:#fff;border-right:2px solid #e0e0e0"><strong>${r.nome}</strong></td><td>${r.escolas}</td>` +
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
  const pmYear = infraLatestMunYear(infra);
  let munMode = false;
  let munSu = null;
  if (S.munSel && infra.por_municipio?.[pmYear]?.[S.munSel]) {
    munMode = true;
    munSu = infra.por_municipio[pmYear][S.munSel];
  } else if (S.creSel) {
    // Aggregate CRE municipalities
    const creMuns = getCreMuns(S.creSel);
    const pm = infra.por_municipio?.[pmYear] || {};
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
    { label: 'Climatização', key: 'IN_CLIMATIZACAO', prevVal: suPrev?.indicadores?.IN_CLIMATIZACAO?.pct, icon: 'img/icons/ar_condicionado.png', accent: 'green', fmt: 'pct', info: 'Percentual de escolas com ao menos uma sala climatizada (ar-condicionado, aquecedor ou climatizadores), conforme o Censo Escolar (QT_SALAS_UTILIZA_CLIMATIZADAS).' },
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
  const sparkColors = ['#1d71b9','#1d71b9','#FFCB04','#EE302F','#1565C0','#00838F'];

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
        <span class="kpi-label">${k.label}${k.info ? `<span class="info-tooltip" title="${k.info.replace(/"/g, '&quot;')}">ⓘ</span>` : ''}</span>
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
  const pmYear = infraLatestMunYear(infra);
  let munSu = null;
  if (S.munSel && infra.por_municipio?.[pmYear]?.[S.munSel]) {
    munSu = infra.por_municipio[pmYear][S.munSel];
  } else if (S.creSel) {
    const creMuns = getCreMuns(S.creSel);
    const pm = infra.por_municipio?.[pmYear] || {};
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
  const catNames = { 'Tecnologia': 'Tecnologia', 'Espacos Pedagogicos': 'Espaços Pedagógicos', 'Estrutura Administrativa': 'Estrutura Administrativa', 'Acessibilidade': 'Acessibilidade', 'Saneamento e Energia': 'Saneamento & Alimentação', 'Alimentacao': 'Alimentação', 'Sustentabilidade': 'Sustentabilidade', 'Climatizacao': 'Climatização', 'Espacos Adicionais': 'Espaços Adicionais' };
  const comboNames = { 'Saneamento e Energia,Alimentacao': 'Saneamento & Alimentação', 'Climatizacao,Espacos Adicionais': 'Climatização & Outros' };
  const catLabel = comboNames[catKey] || (catKeys.length > 1 ? catKeys.map(c => catNames[c] || c).join(' & ') : (catNames[catKeys[0]] || catKeys[0]));
  const titleEl = document.getElementById('infra-chart-title');
  if (titleEl) {
    const titleTxt = `${catLabel} — ${munSu ? pmYear : baseYear + ' vs ' + anoComp}${geoSuffix()}`;
    if (catKeys.includes('Climatizacao')) {
      titleEl.innerHTML = `${titleTxt} <span class="info-tooltip" title="Climatização: percentual de escolas com ao menos uma sala climatizada (ar-condicionado, aquecedor ou climatizadores), conforme definição do Censo Escolar (QT_SALAS_UTILIZA_CLIMATIZADAS).&#10;&#10;% Salas Climatizadas: razão entre salas climatizadas e o total de salas utilizadas.">ⓘ</span>`;
    } else {
      titleEl.textContent = titleTxt;
    }
  }

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
            if (col === 'PCT_SALAS_CLIMATIZADAS') {
              const clim = ind?.total_clim || 0;
              const total = ind?.total_salas || 0;
              return ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}% (${formatNum(clim)} de ${formatNum(total)} salas)`;
            }
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
  
  const munData = infra.por_municipio?.[infraLatestMunYear(infra)] || {};
  const lookup = S.data?.lookup_municipios || {};
  const label = infra.labels?.[metricKey] || metricKey;
  
  // Simple 3-tier thresholds for % indicators
  const tiers = [
    { min: 80, color: '#14507F', label: '≥ 80%' },
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

  const munData = infra.por_municipio?.[infraLatestMunYear(infra)] || {};
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
    { min: 80, color: '#14507F', label: '\u2265 80%' },
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
    ${sectionBanner('img/icons/sec_docentes.png', 'Docência')}
    ${redeToggleHTML()}

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
        <div class="chart-title">Docentes por Sexo${geoSuffix()}</div>
        <div style="height:240px"><canvas id="chart-doc-sexo"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card d2">
        <div class="chart-title">Raça/Cor${geoSuffix()}</div>
        <div style="height:240px"><canvas id="chart-doc-raca"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card d3">
        <div class="chart-title">Tipo de Vínculo${geoSuffix()}</div>
        <div style="height:240px"><canvas id="chart-doc-vinculo"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
    </div>
    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
      <div class="chart-card d4">
        <div class="chart-title">Escolaridade dos Docentes${geoSuffix()}</div>
        <div style="height:270px"><canvas id="chart-doc-esco"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card d5">
        <div class="chart-title">Faixa Etária${geoSuffix()}</div>
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
        <div class="chart-title">Total de Docentes — Evolução${geoSuffix()}</div>
        <div style="height:260px"><canvas id="chart-doc-evo"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Razão Aluno/Professor — Evolução${geoSuffix()}</div>
        <div style="height:260px"><canvas id="chart-doc-razao"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
    </div>

    <!-- ═══ Distribuição Territorial ═══ -->
    <div class="section-divider" style="margin-top:12px">
      <span class="section-divider-icon"><img src="img/icons/territorial.png" alt=""></span>
      <span class="section-divider-text">${territorialDividerText()}</span>
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
      <div style="font-family:Inter;min-width:220px">
        <strong style="font-size:12px">${e.nome}</strong><br>
        <span style="font-size:10px;color:#666">${e.municipio || lookup[e.cod_mun] || ''}</span>
        <hr style="margin:4px 0;border:none;border-top:1px solid #eee">
        <div style="font-size:10px;line-height:1.7">
          <strong>Total Docentes:</strong> ${formatNum(dt)}<br>
          <div style="display:flex;gap:4px;flex-wrap:wrap;margin:3px 0">
            ${e.doc_concur ? `<span style="display:inline-block;background:#0097A722;padding:1px 5px;border-radius:3px">Concurs.: <strong>${formatNum(e.doc_concur)}</strong> (${Math.round(e.doc_concur/dt*100)}%)</span>` : ''}
            ${e.doc_contrat ? `<span style="display:inline-block;background:#EE302F22;padding:1px 5px;border-radius:3px">Contrat.: <strong>${formatNum(e.doc_contrat)}</strong> (${Math.round(e.doc_contrat/dt*100)}%)</span>` : ''}
          </div>
          <div style="margin-top:3px;font-size:9.5px;color:#555">
            ${e.doc_fund_ai ? `AI: ${e.doc_fund_ai}` : ''}${e.doc_fund_af ? ` · AF: ${e.doc_fund_af}` : ''}${e.doc_medio ? ` · EM: ${e.doc_medio}` : ''}${e.doc_eja ? ` · EJA: ${e.doc_eja}` : ''}
          </div>
          <div style="margin-top:3px;font-size:9.5px;color:#555">
            Fem.: ${e.doc_fem || 0} (${dt > 0 ? Math.round((e.doc_fem||0)/dt*100) : 0}%)
            · Sup.: ${e.doc_sup || 0} (${dt > 0 ? Math.round((e.doc_sup||0)/dt*100) : 0}%)
            · Lic.: ${e.doc_licen || 0} (${dt > 0 ? Math.round((e.doc_licen||0)/dt*100) : 0}%)
          </div>
          ${e.mat_total ? `<div style="margin-top:3px;font-size:9.5px;color:#555">Razão aluno/prof: <strong>${dt > 0 ? (e.mat_total / dt).toFixed(1) : 'N/A'}</strong></div>` : ''}
        </div>
      </div>
    `, { maxWidth: 300 });
    markers.addLayer(marker);
  });
  markers.addTo(S.map);
  if (withCoords.length) S.map.fitBounds(markers.getBounds(), { padding: [20, 20] });

  // Update table
  const titleEl = document.querySelector('#doc-mun-table')?.closest('.chart-card')?.querySelector('.table-header h3');
  if (titleEl) titleEl.textContent = 'Docentes por Escola — 2025';

  const thead = document.querySelector('#doc-mun-table thead tr');
  if (thead) thead.innerHTML = '<th>#</th><th>Escola</th><th>Município</th><th>Total</th><th>Fem. %</th><th>Sup. %</th><th>Lic. %</th><th>Conc.</th><th>Cont.</th><th>AI</th><th>AF</th><th>EM</th><th>EJA</th><th>A/P</th>';

  const sorted = [...escolas].filter(e => e.doc_total != null).sort((a, b) => (b.doc_total || 0) - (a.doc_total || 0));
  const tbody = document.getElementById('doc-mun-tbody');
  if (!tbody) return;

  tbody.innerHTML = sorted.map((e, i) => {
    const dt = e.doc_total || 0;
    const razao = dt > 0 && e.mat_total ? (e.mat_total / dt).toFixed(1) : '—';
    const pct = (v) => dt > 0 ? Math.round((v||0)/dt*100) + '%' : '—';
    const pctColor = (v, good=70) => { const p = dt > 0 ? (v||0)/dt*100 : 0; return p >= good ? '#43A047' : p >= 40 ? '#F57C00' : '#E53935'; };
    return `
    <tr data-lat="${e.lat || ''}" data-lng="${e.lng || ''}" style="cursor:pointer">
      <td>${i + 1}</td>
      <td><strong style="font-size:10px">${e.nome}</strong></td>
      <td style="font-size:10px">${e.municipio || lookup[e.cod_mun] || ''}</td>
      <td><strong>${formatNum(dt)}</strong></td>
      <td style="color:#666">${pct(e.doc_fem)}</td>
      <td style="color:${pctColor(e.doc_sup)};font-weight:600">${pct(e.doc_sup)}</td>
      <td style="color:${pctColor(e.doc_licen)};font-weight:600">${pct(e.doc_licen)}</td>
      <td style="color:#0097A7">${formatNum(e.doc_concur || 0)}</td>
      <td style="color:#EE302F">${formatNum(e.doc_contrat || 0)}</td>
      <td style="font-size:10px;color:#666">${e.doc_fund_ai || 0}</td>
      <td style="font-size:10px;color:#666">${e.doc_fund_af || 0}</td>
      <td style="font-size:10px;color:#666">${e.doc_medio || 0}</td>
      <td style="font-size:10px;color:#666">${e.doc_eja || 0}</td>
      <td style="text-align:center;font-weight:600">${razao}</td>
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
    { min: 500, color: '#14507F', label: '≥ 500' },
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
    { min: 3000, color: '#14507F', label: '≥ 3.000' },
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
  let razaoAno = null;
  let matT = 0, docTAno = 0;
  if (S.munSel) {
      matT = S.data?.por_municipio?.[anoSelDoc]?.[S.munSel]?.mat_total || doc.serie_temporal_municipio?.[anoSelDoc]?.[S.munSel]?.matriculas || 0;
      docTAno = (anoSelDoc === '2025' ? doc.por_municipio_2025?.[S.munSel]?.docentes : doc.serie_temporal_municipio?.[anoSelDoc]?.[S.munSel]?.docentes) || 0;
  } else if (S.creSel) {
      const creMuns = getCreMuns(S.creSel);
      const ym_doc = anoSelDoc === '2025' ? doc.por_municipio_2025 : doc.serie_temporal_municipio?.[anoSelDoc] || {};
      const ym_mat = S.data?.por_municipio?.[anoSelDoc] || {};
      creMuns.forEach(c => {
          docTAno += ym_doc?.[c]?.docentes || 0;
          matT += ym_mat[c]?.mat_total || ym_doc?.[c]?.matriculas || 0;
      });
  } else {
      matT = S.data?.serie_temporal?.[anoSelDoc]?.mat_total || 0;
      docTAno = doc.serie_temporal_total?.[anoSelDoc]?.QT_DOC_BAS || docTotalAno || 0;
  }
  if (docTAno > 0 && matT > 0) razaoAno = Math.round(matT / docTAno * 10) / 10;
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
  if (razaoEl && doc.serie_temporal_total) {
    const anos = Object.keys(doc.serie_temporal_total).sort();
    let razaoData = anos.map(a => {
        let matT = 0, docT = 0;
        if (S.munSel) {
            matT = S.data?.por_municipio?.[a]?.[S.munSel]?.mat_total || doc.serie_temporal_municipio?.[a]?.[S.munSel]?.matriculas || 0;
            docT = (a === '2025' ? doc.por_municipio_2025?.[S.munSel]?.docentes : doc.serie_temporal_municipio?.[a]?.[S.munSel]?.docentes) || 0;
        } else if (S.creSel) {
            const creMuns = getCreMuns(S.creSel);
            const ym_doc = a === '2025' ? doc.por_municipio_2025 : doc.serie_temporal_municipio?.[a] || {};
            const ym_mat = S.data?.por_municipio?.[a] || {};
            creMuns.forEach(c => {
                docT += ym_doc?.[c]?.docentes || 0;
                matT += ym_mat[c]?.mat_total || ym_doc?.[c]?.matriculas || 0;
            });
        } else {
            matT = S.data?.serie_temporal?.[a]?.mat_total || 0;
            docT = doc.serie_temporal_total?.[a]?.QT_DOC_BAS || 0;
        }
        return docT > 0 && matT > 0 ? Math.round(matT / docT * 10) / 10 : null;
    });
    const validR = razaoData.filter(Boolean);
    const razaoMin = validR.length ? Math.floor(Math.min(...validR) - 1) : 0;
    const razaoMax = validR.length ? Math.ceil(Math.max(...validR) + 1) : 20;
    S.charts.push(new Chart(razaoEl, {
      type: 'line',
      data: { labels: anos, datasets: [{ label: 'Alunos por Professor', data: razaoData,
        borderColor: '#14507F', backgroundColor: '#14507F18', fill: true, tension: .35, pointRadius: 5, borderWidth: 2.5 }] },
      options: { ...CHART_DEFAULTS,
        plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false },
          datalabels: { display: true, anchor: 'end', align: 'top', offset: 3, font: { family: 'Inter', size: 10, weight: '700' }, color: '#14507F', formatter: v => v?.toFixed(1) ?? '' } },
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
    if (S.munSel) {
      totalVals = docAnos.map(a => (a === '2025' ? doc.por_municipio_2025?.[S.munSel]?.docentes : doc.serie_temporal_municipio?.[a]?.[S.munSel]?.docentes) ?? null);
    } else if (S.creSel) {
      const creMuns = getCreMuns(S.creSel);
      totalVals = docAnos.map(a => {
        const ym = a === '2025' ? doc.por_municipio_2025 : doc.serie_temporal_municipio?.[a];
        if (!ym) return null;
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

  bindRedeToggle();
  updateActiveFilters();
  updateFilterAwareness();
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
    const turmaColors = ['#14507FCC','#3A8CC7CC','#5a96c7CC','#8fb8daCC','#1565C0CC','#E65100CC'];

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
// IDEB / SAEB
// ══════════════════════════════════════════════════════════

const FONTE_SAEB = 'Fonte: ' + fonteLink(URL_SAEB, 'Microdados SAEB — INEP', 'Acessar o SAEB no portal INEP');
const FONTE_IDEB = 'Fonte: ' + fonteLink(URL_IDEB, 'IDEB/INEP — Divulgação 2023', 'Acessar o IDEB no portal INEP') + ' · ' + fonteLink(URL_IDEB_NOTA, '📘 Nota Técnica do IDEB', 'Nota Técnica nº 1 — Concepção do IDEB (INEP)');

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
        <div class="chart-title">Língua Portuguesa — Evolução por Etapa${geoSuffix()}</div>
        <div style="height:300px"><canvas id="chart-saeb-lp"></canvas></div>
        <div class="chart-source">${FONTE_SAEB}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Matemática — Evolução por Etapa${geoSuffix()}</div>
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
        <div class="chart-title">Número de Escolas com Dados SAEB — Série Histórica${geoSuffix()}</div>
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
              <th>#</th>
              <th data-col="nome" class="sortable" style="cursor:pointer">Município \u25b2\u25bc</th>
              <th data-col="lp5" class="sortable" style="cursor:pointer">LP 5EF \u25b2\u25bc</th>
              <th data-col="mt5" class="sortable" style="cursor:pointer">MT 5EF \u25b2\u25bc</th>
              <th data-col="lp9" class="sortable" style="cursor:pointer">LP 9EF \u25b2\u25bc</th>
              <th data-col="mt9" class="sortable" style="cursor:pointer">MT 9EF \u25b2\u25bc</th>
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
    let saebSortCol = 'lp9', saebSortAsc = false, saebSearchStr = '';

    const saebSearchInput = document.getElementById('saeb-mun-search');
    if (saebSearchInput) {
      saebSearchInput.addEventListener('input', e => {
        saebSearchStr = e.target.value.toLowerCase();
        updateSaebTable();
      });
    }

    const saebTableHead = document.querySelector('#saeb-mun-table thead');
    if (saebTableHead) {
      saebTableHead.addEventListener('click', e => {
        const th = e.target.closest('th.sortable');
        if (!th) return;
        const col = th.dataset.col;
        if (saebSortCol === col) saebSortAsc = !saebSortAsc;
        else { saebSortCol = col; saebSortAsc = false; }
        updateSaebTable();
      });
    }

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
      if (saebSearchStr) {
        entries = entries.filter(([cod]) => {
          const name = lookup[cod] || cod;
          return name.toLowerCase().includes(saebSearchStr);
        });
      }
      entries.sort((a, b) => {
        const ma = a[1] || {}, mb = b[1] || {};
        let va, vb;
        if (saebSortCol === 'nome') {
          va = lookup[a[0]] || a[0]; vb = lookup[b[0]] || b[0];
          return saebSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
        } else if (saebSortCol === 'lp5') { va = ma['5EF']?.media_lp || 0; vb = mb['5EF']?.media_lp || 0; }
        else if (saebSortCol === 'mt5') { va = ma['5EF']?.media_mt || 0; vb = mb['5EF']?.media_mt || 0; }
        else if (saebSortCol === 'lp9') { va = ma['9EF']?.media_lp || 0; vb = mb['9EF']?.media_lp || 0; }
        else if (saebSortCol === 'mt9') { va = ma['9EF']?.media_mt || 0; vb = mb['9EF']?.media_mt || 0; }
        else { va = ma['9EF']?.media_lp || 0; vb = mb['9EF']?.media_lp || 0; } // default
        return saebSortAsc ? va - vb : vb - va;
      });
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

// Metas IDEB projetadas pela SEDUC-RS (2023–2035) — destrinchadas por etapa
const METAS_SEDUC = {
  AI: { 2023: 5.8, 2024: 6.0, 2025: 6.11, 2026: 6.20, 2027: 6.26, 2028: 6.34, 2029: 6.43, 2030: 6.52, 2031: 6.58, 2032: 6.63, 2033: 6.66, 2034: 6.68, 2035: 6.69 },
  AF: { 2023: 4.7, 2024: 4.9, 2025: 5.16, 2026: 5.39, 2027: 5.50, 2028: 5.65, 2029: 5.81, 2030: 5.96, 2031: 6.09, 2032: 6.17, 2033: 6.23, 2034: 6.26, 2035: 6.28 },
  EM: { 2023: 3.9, 2024: 4.3, 2025: 4.72, 2026: 4.90, 2027: 4.97, 2028: 5.07, 2029: 5.18, 2030: 5.28, 2031: 5.36, 2032: 5.41, 2033: 5.45, 2034: 5.47, 2035: 5.48 },
};

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
          <div style="margin-top:14px;background:rgba(29,113,185,.06);border:1px solid rgba(29,113,185,.15);border-radius:6px;padding:10px 14px">
            <p style="font-size:11px;margin:0 0 8px;color:#14507F;line-height:1.7">
              <strong>Metas SEDUC-RS (próximas edições):</strong>
            </p>
            <table style="width:100%;font-size:10.5px;border-collapse:separate;border-spacing:0;margin-bottom:6px">
              <thead>
                <tr>
                  <th style="padding:4px 6px;text-align:left;background:#f0f4f8;border-bottom:1px solid #ddd;font-weight:700;color:#333"></th>
                  <th style="padding:4px 6px;text-align:center;background:#f0f4f8;border-bottom:1px solid #ddd;font-weight:700;color:#333">2025</th>
                  <th style="padding:4px 6px;text-align:center;background:#f0f4f8;border-bottom:1px solid #ddd;font-weight:700;color:#333">2027</th>
                </tr>
              </thead>
              <tbody>
                <tr><td style="padding:3px 6px;font-weight:600;color:${idebCores[0]}">Anos Iniciais</td><td style="padding:3px 6px;text-align:center;font-weight:700">${METAS_SEDUC.AI[2025]?.toFixed(2)}</td><td style="padding:3px 6px;text-align:center;font-weight:700">${METAS_SEDUC.AI[2027]?.toFixed(2)}</td></tr>
                <tr style="background:#fafbfc"><td style="padding:3px 6px;font-weight:600;color:${idebCores[1]}">Anos Finais</td><td style="padding:3px 6px;text-align:center;font-weight:700">${METAS_SEDUC.AF[2025]?.toFixed(2)}</td><td style="padding:3px 6px;text-align:center;font-weight:700">${METAS_SEDUC.AF[2027]?.toFixed(2)}</td></tr>
                <tr><td style="padding:3px 6px;font-weight:600;color:${idebCores[2]}">Ensino Médio</td><td style="padding:3px 6px;text-align:center;font-weight:700">${METAS_SEDUC.EM[2025]?.toFixed(2)}</td><td style="padding:3px 6px;text-align:center;font-weight:700">${METAS_SEDUC.EM[2027]?.toFixed(2)}</td></tr>
              </tbody>
            </table>
            <details style="margin-top:6px">
              <summary style="font-size:10px;font-weight:600;color:#14507F;cursor:pointer;user-select:none;padding:4px 0">
                📋 Ver projeção completa (2023–2035)
              </summary>
              <div style="margin-top:6px;overflow-x:auto">
                <table style="width:100%;font-size:9.5px;border-collapse:separate;border-spacing:0;white-space:nowrap">
                  <thead>
                    <tr>
                      <th style="padding:4px 5px;text-align:left;background:#f0f4f8;border-bottom:1px solid #ddd;font-weight:700;color:#333;position:sticky;left:0;z-index:1">Etapa</th>
                      ${Object.keys(METAS_SEDUC.AI).map(y => `<th style="padding:4px 5px;text-align:center;background:#f0f4f8;border-bottom:1px solid #ddd;font-weight:600;color:#555">${y}</th>`).join('')}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style="padding:3px 5px;font-weight:600;color:${idebCores[0]};position:sticky;left:0;background:#fff;z-index:1">Anos Iniciais</td>
                      ${Object.values(METAS_SEDUC.AI).map(v => `<td style="padding:3px 5px;text-align:center">${v.toFixed(2)}</td>`).join('')}
                    </tr>
                    <tr style="background:#fafbfc">
                      <td style="padding:3px 5px;font-weight:600;color:${idebCores[1]};position:sticky;left:0;background:#fafbfc;z-index:1">Anos Finais</td>
                      ${Object.values(METAS_SEDUC.AF).map(v => `<td style="padding:3px 5px;text-align:center">${v.toFixed(2)}</td>`).join('')}
                    </tr>
                    <tr>
                      <td style="padding:3px 5px;font-weight:600;color:${idebCores[2]};position:sticky;left:0;background:#fff;z-index:1">Ensino Médio</td>
                      ${Object.values(METAS_SEDUC.EM).map(v => `<td style="padding:3px 5px;text-align:center">${v.toFixed(2)}</td>`).join('')}
                    </tr>
                  </tbody>
                </table>
              </div>
              <p style="font-size:8.5px;margin:4px 0 0;color:#999;font-style:italic">Fonte: SEDUC-RS — Projeção de metas IDEB por etapa de ensino.</p>
            </details>
          </div>
          <div style="margin-top:8px;background:rgba(255,203,4,.08);border:1px solid rgba(255,203,4,.18);border-radius:6px;padding:8px 14px">
            <p style="font-size:10px;margin:0;color:#5D4037;line-height:1.7">
              <strong>Metas do PNE:</strong> AI: <strong>6,0</strong> · AF: <strong>5,5</strong> · EM: <strong>5,2</strong><br>
              <strong>Linha tracejada</strong> nos gráficos = <strong>meta projetada pela SEDUC-RS</strong> para cada edição.
            </p>
          </div>
          <p style="font-size:9px;margin:10px 0 0;color:#999;line-height:1.5;font-style:italic">
            Fontes: INEP — Nota Técnica do IDEB; PNE — Lei nº 13.005/2014 (Meta 7); SEDUC-RS — Projeção de metas.
          </p>
        </div>
      </div>
    </div>

    <!-- ═══ EIXO: Evolução ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/sec_evolucao.png" alt=""></span>
      <span class="section-divider-text">IDEB — Evolução por Etapa (${anos[0]}–2027)</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title">IDEB Observado × Meta SEDUC-RS — ${geoLabel}</div>
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
      <span class="section-divider-text">${territorialDividerText()}</span>
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
              <th>#</th>
              <th data-col="nome" class="sortable" style="cursor:pointer">Município \u25b2\u25bc</th>
              <th data-col="ai" class="sortable" style="cursor:pointer">AI \u25b2\u25bc</th>
              <th data-col="af" class="sortable" style="cursor:pointer">AF \u25b2\u25bc</th>
              <th data-col="em" class="sortable" style="cursor:pointer">EM \u25b2\u25bc</th>
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
    // Extended labels: observed years + future SEDUC meta years (up to 2027)
    const metaYears = isStateLevel ? ['2025', '2027'].filter(y => !anos.includes(y)) : [];
    const chartLabels = [...anos, ...metaYears];

    const datasets = [];
    idebEtapas.forEach((et, etIdx) => {
      // Observed data (fill observed years, null for future)
      const dataObs = chartLabels.map(a => {
        const gd = getGeoData(a);
        return gd?.[et]?.ideb ?? null;
      });
      datasets.push({
        label: idebLabels[etIdx], data: dataObs, _isMeta: false, _etIdx: etIdx, _isSeduc: false,
        borderColor: idebCores[etIdx], backgroundColor: idebCores[etIdx] + '18',
        borderWidth: 2.5, pointRadius: 5, pointBackgroundColor: '#fff', pointBorderWidth: 2,
        tension: .3, spanGaps: true,
      });
      // Metas SEDUC (dashed line, at state level)
      if (isStateLevel) {
        const dataMeta = chartLabels.map(a => METAS_SEDUC[et]?.[parseInt(a)] ?? null);
        if (dataMeta.some(v => v != null)) {
          datasets.push({
            label: `Meta SEDUC ${idebLabels[etIdx]}`, data: dataMeta, _isMeta: true, _etIdx: etIdx, _isSeduc: true,
            borderColor: idebCores[etIdx] + '70', borderWidth: 1.8, borderDash: [6, 4],
            pointRadius: 3, pointBackgroundColor: idebCores[etIdx] + '55',
            pointStyle: 'triangle', tension: .3, spanGaps: true,
          });
        }
      }
    });
    S.charts.push(new Chart(elEvo, {
      type: 'line',
      data: { labels: chartLabels, datasets },
      options: {
        ...CHART_DEFAULTS, layout: { padding: { top: 25 } },
        plugins: {
          ...CHART_DEFAULTS.plugins,
          legend: {
            display: true, position: 'bottom',
            labels: {
              font: { family: 'Inter', size: 11, weight: '600' }, boxWidth: 12, padding: 10, usePointStyle: true,
              filter: item => {
                // Show meta only once in legend (not per-etapa)
                return true;
              },
            },
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
  let idebSortCol = 'ai', idebSortAsc = false, idebSearchStr = '';

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
    if (idebSearchStr) {
      const q = idebSearchStr.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      entries = entries.filter(([cod]) => {
        const name = (lookup[cod] || cod).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return name.includes(q);
      });
    }

    entries.sort((a, b) => {
      const ma = a[1] || {}, mb = b[1] || {};
      let va, vb;
      if (idebSortCol === 'nome') {
        va = lookup[a[0]] || a[0]; vb = lookup[b[0]] || b[0];
        return idebSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      } else if (idebSortCol === 'ai') {
        va = ma.AI?.ideb || 0; vb = mb.AI?.ideb || 0;
      } else if (idebSortCol === 'af') {
        va = ma.AF?.ideb || 0; vb = mb.AF?.ideb || 0;
      } else if (idebSortCol === 'em') {
        va = ma.EM?.ideb || 0; vb = mb.EM?.ideb || 0;
      }
      return idebSortAsc ? va - vb : vb - va;
    });

    const colorCell = v => {
      if (v == null) return '<td style="color:#ccc">—</td>';
      return `<td><strong style="color:${getIdebColor(v)}">${v.toFixed(1)}</strong></td>`;
    };

    tbody.innerHTML = entries.map(([cod, md], i) => `
      <tr style="cursor:pointer" class="${S.munSel === cod ? 'selected' : ''}" data-cod="${cod}">
        <td>${i + 1}</td>
        <td><strong>${lookup[cod] || cod}</strong></td>
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
  };

  const idebSearchInput = document.getElementById('ideb-mun-search');
  if (idebSearchInput) {
    idebSearchInput.addEventListener('input', e => {
      idebSearchStr = e.target.value;
      idebBuildMunTable();
    });
  }

  const idebTableHead = document.querySelector('#ideb-mun-table thead');
  if (idebTableHead) {
    idebTableHead.addEventListener('click', e => {
      const th = e.target.closest('th.sortable');
      if (!th) return;
      const col = th.dataset.col;
      if (idebSortCol === col) idebSortAsc = !idebSortAsc;
      else { idebSortCol = col; idebSortAsc = false; }
      idebBuildMunTable();
    });
  }

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
    { view: 'desigualdades', icon: 'img/icons/nav_desigualdades.png', title: 'Desigualdades', desc: 'Desigualdades no desempenho por raça, sexo, localização e outros recortes' },
    { view: 'saeb', icon: 'img/icons/sec_saeb.png', title: 'SAEB', desc: 'Proficiência em Língua Portuguesa e Matemática' },
    { view: 'ideb', icon: 'img/icons/nav_ideb.png', title: 'IDEB', desc: 'Índice de Desenvolvimento da Educação Básica' },
    { view: 'tdi', icon: 'img/icons/politicas.png', title: 'Distorção Idade-Série', desc: 'Taxa de defasagem escolar por etapa' },
    { view: 'escolas', icon: 'img/icons/escola.png', title: 'Visão por Escola', desc: 'Mapa georreferenciado com indicadores por escola' },
  ];

  main.innerHTML = `
    <div class="home-wrap">
      <div class="home-bg"></div>
      <p class="home-photo-credit">Foto: Filipe Karam/PMPA</p>
      <div class="home-particles" aria-hidden="true" style="display:none">
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

        <div class="home-grid">
          ${sections.map((s, i) => `
            <div class="home-card ${s.view === 'escolas' ? 'col-span-4' : ''}" data-nav="${s.view}" style="animation: fadeSlideUp .5s ease ${.2 + i * .06}s both">
              <div class="home-card-icon"><img src="${s.icon}" alt=""></div>
              <div class="home-card-text">
                <div class="home-card-title">${s.title}</div>
                <div class="home-card-desc">${s.desc}</div>
              </div>
              <span class="home-card-arrow">›</span>
            </div>
          `).join('')}
        </div>

        <div class="home-divider" style="margin:28px 0 16px">
          <span class="home-divider-line"></span>
          <span class="home-divider-text">Documentos e Recursos</span>
          <span class="home-divider-line"></span>
        </div>

        <div class="home-grid" style="grid-template-columns:repeat(3,1fr)">
          <div class="home-card" data-nav="dados" style="cursor:pointer">
            <div class="home-card-icon"><img src="img/icons/territorial.png" alt=""></div>
            <div class="home-card-text">
              <div class="home-card-title">Central de Dados Abertos</div>
              <div class="home-card-desc">Baixe as bases do painel em planilha (.xlsx), por tema</div>
            </div>
            <span class="home-card-arrow">›</span>
          </div>
          <a class="home-card" href="${URL_CADERNO_CENSO}" target="_blank" rel="noopener" style="text-decoration:none">
            <div class="home-card-icon"><img src="img/icons/politicas.png" alt=""></div>
            <div class="home-card-text">
              <div class="home-card-title">Caderno de Conceitos do Censo</div>
              <div class="home-card-desc">Definições e orientações oficiais dos indicadores (INEP) — PDF</div>
            </div>
            <span class="home-card-arrow">↗</span>
          </a>
          <a class="home-card" href="${URL_CENSO}" target="_blank" rel="noopener" style="text-decoration:none">
            <div class="home-card-icon"><img src="img/icons/panorama.png" alt=""></div>
            <div class="home-card-text">
              <div class="home-card-title">Portal do Censo Escolar (INEP)</div>
              <div class="home-card-desc">Microdados, notas técnicas e indicadores educacionais</div>
            </div>
            <span class="home-card-arrow">↗</span>
          </a>
        </div>

        <div class="home-footer" style="margin-top:32px">
          <div class="home-footer-text">
            Secretaria da Educação do Estado do Rio Grande do Sul<br>
            Centro de Educação Baseada em Evidências (CEBE)
          </div>
          <div class="home-footer-logos">
            <img src="img/brasao_rs.png" alt="Brasão RS" style="height:64px" onerror="this.style.display='none'">
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
// CENTRAL DE DADOS ABERTOS (download de planilhas)
// ══════════════════════════════════════════════════════════

const DADOS_TEMAS = [
  { id: 'acesso', icon: 'img/icons/nav_acesso.png', nome: 'Acesso e Matrículas',
    arquivo: 'dados_acesso_matriculas.xlsx',
    desc: 'Matrículas por etapa, dependência, localização, perfil dos alunos, ensino integral e funil de fluxo.',
    fonte: 'INEP — Censo Escolar' },
  { id: 'infra', icon: 'img/icons/nav_infra.png', nome: 'Infraestrutura',
    arquivo: 'dados_infraestrutura.xlsx',
    desc: 'Indicadores de infraestrutura escolar: tecnologia, espaços pedagógicos, acessibilidade e saneamento.',
    fonte: 'INEP — Censo Escolar' },
  { id: 'icg', icon: 'img/icons/escola.png', nome: 'Complexidade de Gestão',
    arquivo: 'dados_complexidade_gestao.xlsx',
    desc: 'Indicador de Complexidade de Gestão das escolas (ICG), por nível e por município.',
    fonte: 'INEP — Complexidade de Gestão (ICG)' },
  { id: 'inse', icon: 'img/icons/social.png', nome: 'Contexto Socioeconômico (INSE)',
    arquivo: 'dados_inse.xlsx',
    desc: 'Nível socioeconômico médio dos estudantes (INSE), por rede e por município.',
    fonte: 'INEP — Nível Socioeconômico (INSE)' },
  { id: 'docencia', icon: 'img/icons/sec_docentes.png', nome: 'Docência',
    arquivo: 'dados_docencia.xlsx',
    desc: 'Perfil docente: escolaridade, vínculo, faixa etária e razão aluno-professor.',
    fonte: 'INEP — Censo Escolar' },
  { id: 'afd', icon: 'img/icons/nav_afd.png', nome: 'Formação Docente (AFD)',
    arquivo: 'dados_afd.xlsx',
    desc: 'Adequação da Formação Docente (AFD) por etapa de ensino e por município.',
    fonte: 'INEP — Adequação da Formação Docente' },
  { id: 'fluxo', icon: 'img/icons/nav_fluxo.png', nome: 'Fluxo e Rendimento',
    arquivo: 'dados_fluxo_rendimento.xlsx',
    desc: 'Taxas de aprovação, reprovação e abandono, por etapa e por série (2010–2025).',
    fonte: 'INEP — Indicadores Educacionais' },
  { id: 'tdi', icon: 'img/icons/politicas.png', nome: 'Distorção Idade-Série',
    arquivo: 'dados_tdi.xlsx',
    desc: 'Taxa de distorção idade-série (TDI) por etapa de ensino e por município.',
    fonte: 'INEP — Distorção Idade-Série' },
  { id: 'saers', icon: 'img/icons/sec_saeb.png', nome: 'SAERS',
    arquivo: 'dados_saers.xlsx',
    desc: 'Proficiências médias e padrões de desempenho do SAERS/RS por etapa e disciplina.',
    fonte: 'SEDUC-RS / CAED — SAERS' },
  { id: 'desigualdades', icon: 'img/icons/nav_desigualdades.png', nome: 'Desigualdades',
    arquivo: 'dados_desigualdades.xlsx',
    desc: 'Resultados do SAERS por recortes de equidade: sexo, raça/cor, deficiência, localização e turno.',
    fonte: 'SEDUC-RS / CAED — SAERS' },
  { id: 'saeb', icon: 'img/icons/sec_saeb.png', nome: 'SAEB',
    arquivo: 'dados_saeb.xlsx',
    desc: 'Proficiências do SAEB em Língua Portuguesa e Matemática, por rede, etapa e município.',
    fonte: 'INEP — SAEB' },
  { id: 'ideb', icon: 'img/icons/nav_ideb.png', nome: 'IDEB',
    arquivo: 'dados_ideb.xlsx',
    desc: 'IDEB observado e metas, por rede, etapa de ensino e por município.',
    fonte: 'INEP — IDEB' },
];

function renderDados() {
  const main = document.getElementById('main-content');
  destroyCharts(); destroyMap();
  document.body.classList.remove('sidebar-hidden');

  const cardsHTML = DADOS_TEMAS.map((t, i) => `
    <div class="dados-card" style="animation: fadeSlideUp .5s ease ${.05 + i * .06}s both">
      <div class="dados-card-head">
        <div class="dados-card-icon"><img src="${t.icon}" alt="" onerror="this.style.display='none'"></div>
        <div class="dados-card-title">${t.nome}</div>
      </div>
      <div class="dados-card-desc">${t.desc}</div>
      <div class="dados-card-meta">
        <span class="dados-chip" id="chip-abas-${t.id}">planilha .xlsx</span>
        <span class="dados-chip" id="chip-size-${t.id}">${t.fonte}</span>
      </div>
      <a class="dados-btn" href="dados/downloads/${t.arquivo}" download>
        <span>Baixar planilha</span>
        <span class="dados-btn-ico">↓</span>
      </a>
    </div>
  `).join('');

  main.innerHTML = `
    <div class="section-sticky">
      ${sectionBanner('img/icons/territorial.png', 'Central de Dados Abertos', 'Extraia as bases do painel em planilha (.xlsx)')}
    </div>

    <div class="dados-intro">
      <p>Todas as bases que alimentam este painel estão disponíveis para download em planilhas <strong>.xlsx</strong>,
      organizadas por tema. Cada arquivo traz <strong>abas separadas por rede</strong> (Estadual, Municipal, Federal, Privada e Todas),
      com a <strong>série histórica</strong> (nível estado/rede) e a <strong>base por município com coluna Ano</strong>
      (todos os anos disponíveis — use o autofiltro do Excel para selecionar município e período). A aba <em>"Sobre"</em> de cada planilha descreve o conteúdo e a fonte.</p>
    </div>

    <div class="dados-grid">
      ${cardsHTML}
    </div>
  `;

  // Enriquecer chips com nº de abas e tamanho (best-effort via manifest)
  fetch('dados/downloads/manifest.json')
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(man => {
      man.forEach(m => {
        const abas = document.getElementById(`chip-abas-${m.id}`);
        const size = document.getElementById(`chip-size-${m.id}`);
        if (abas) abas.textContent = `${m.abas} abas · ${m.tamanho_kb >= 1024 ? (m.tamanho_kb / 1024).toFixed(1) + ' MB' : m.tamanho_kb + ' KB'}`;
        if (size) size.textContent = m.fonte;
      });
    })
    .catch(() => {});
}

// ══════════════════════════════════════════════════════════
// FLUXO E RENDIMENTO
// ══════════════════════════════════════════════════════════

const FONTE_REND = 'Fonte: INEP — ' + fonteLink(URL_INDICADORES, 'Indicadores Educacionais (Taxas de Rendimento)', 'Acessar Indicadores Educacionais no portal INEP') + ' · ' + fonteLink(URL_CADERNO_CENSO, '📘 Caderno de Conceitos', 'Caderno de Conceitos e Orientações (INEP)');

/** Aggregate fluxo rates for a CRE (simple average of municipality percentages) */
// Sufixos de série (Fund. 1º-9º + Médio 1ª-4ª) usados em chaves aprov_/reprov_/aband_
const FLX_SERIE_SUFIXOS = ['fund_01','fund_02','fund_03','fund_04','fund_05','fund_06','fund_07','fund_08','fund_09','med_01','med_02','med_03','med_04'];

function aggregateCreFluxo(f, ano, creCod) {
  const muns = getCreMuns(creCod);
  const munData = f.por_municipio[ano] || {};
  const keys = ['aprov_fund','aprov_fund_ai','aprov_fund_af','aprov_med','reprov_fund','reprov_fund_ai','reprov_fund_af','reprov_med','aband_fund','aband_fund_ai','aband_fund_af','aband_med',
    ...['aprov','reprov','aband'].flatMap(r => FLX_SERIE_SUFIXOS.map(s => `${r}_${s}`))];
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
      <div id="fluxo-kpi-strip" class="kpi-strip" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))"></div>
    </div>

    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/panorama.png" alt=""></span>
      <span class="section-divider-text">Evolução Temporal</span>
      <span class="section-divider-line"></span>
    </div>
    <div class="charts-grid" style="display:grid;grid-template-columns:1fr;gap:10px">
      <div class="chart-card d1">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:4px">
          <div class="chart-title" style="margin:0">Aprovação por Etapa (%)${geoSuffix()}</div>
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
          <div class="chart-title" style="margin:0">Reprovação (%)${geoSuffix()}</div>
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
          <div class="chart-title" style="margin:0">Abandono (%)${geoSuffix()}</div>
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
      <span class="section-divider-icon"><img src="img/icons/panorama.png" alt=""></span>
      <span class="section-divider-text">Rendimento por Série</span>
      <span class="section-divider-line"></span>
    </div>
    <div class="charts-grid" style="display:grid;grid-template-columns:1fr;gap:10px">
      <div class="chart-card d2">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:4px">
          <div class="chart-title" style="margin:0">Taxa por Série — <span id="flx-serie-ano">${anoSel}</span> (%)${geoSuffix()}</div>
          <div class="flx-toggle-pills" id="flx-serie-pills">
            <button class="flx-pill active" data-rate="aprov" style="--pill-color:#2E9B6B">Aprovação</button>
            <button class="flx-pill" data-rate="reprov" style="--pill-color:#F57C00">Reprovação</button>
            <button class="flx-pill" data-rate="aband" style="--pill-color:${COLORS.red}">Abandono</button>
          </div>
        </div>
        <div style="height:320px"><canvas id="flx-chart-serie"></canvas></div>
        <div class="chart-source">${FONTE_REND} · Recorte por série disponível de 2012 em diante, via arquivos oficiais por município do INEP.</div>
      </div>
    </div>

    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/territorial.png" alt=""></span>
      <span class="section-divider-text">${territorialDividerText()}</span>
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
            <button class="map-layer-btn" id="flx-btn-layer-esc">Escolas</button>
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
              <th>#</th><th>Município</th><th>Aprovação Fund.</th><th>Aprovação Médio</th><th>Reprovação Fund.</th><th>Reprovação Médio</th><th>Abandono Fund.</th><th>Abandono Médio</th>
            </tr></thead>
            <tbody id="flx-mun-tbody"></tbody>
          </table>
        </div>
        <div class="chart-source">${FONTE_REND}</div>
      </div>
      <div class="table-wrapper" id="flx-cre-wrapper" style="display:none">
        <div class="table-header">
          <h3>Tabela de CREs</h3>
          <input type="text" class="table-search" id="flx-cre-search" placeholder="Buscar CRE...">
        </div>
        <div style="max-height:400px;overflow-y:auto">
          <table class="data-table" id="flx-cre-table">
            <thead><tr>
              <th>#</th><th>CRE</th><th>Aprovação Fund.</th><th>Aprovação Médio</th><th>Reprovação Fund.</th><th>Reprovação Médio</th><th>Abandono Fund.</th><th>Abandono Médio</th>
            </tr></thead>
            <tbody id="flx-cre-tbody"></tbody>
          </table>
        </div>
        <div class="chart-source">${FONTE_REND}</div>
      </div>
      <div class="table-wrapper" id="flx-escola-wrapper" style="display:none">
        <div class="table-header">
          <h3>Tabela de Escolas (${f.ano_escola_recente || '2025'})</h3>
          <input type="text" class="table-search" id="flx-escola-search" placeholder="Buscar escola...">
        </div>
        <div style="max-height:400px;overflow-y:auto">
          <table class="data-table" id="flx-escola-table">
            <thead><tr>
              <th>#</th><th>Escola</th><th>Município</th><th>Aprovação Fund.</th><th>Aprovação Médio</th><th>Reprovação Fund.</th><th>Reprovação Médio</th><th>Abandono Fund.</th><th>Abandono Médio</th>
            </tr></thead>
            <tbody></tbody>
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
  // Build Série chart (rendimento por série, ano selecionado + geo atual)
  fluxoBuildSerieChart(st);
  // Build Map
  buildFluxoMap(f, anoSel, 'aprov_fund');
  // Build Table
  fluxoBuildMunTable(f, anoSel, lookup);
  // Bind map metric
  const selMetric = document.getElementById('flx-map-metric');
  const flxBtnMun = document.getElementById('flx-btn-layer-mun');
  const flxBtnCre = document.getElementById('flx-btn-layer-cre');
  const flxBtnEsc = document.getElementById('flx-btn-layer-esc');

  const clearFlxMapBtns = () => [flxBtnMun, flxBtnCre, flxBtnEsc].forEach(b => b?.classList.remove('active'));

  if (selMetric) {
    selMetric.addEventListener('change', () => {
      if (flxBtnCre?.classList.contains('active')) buildFluxoCreMap(f, anoSel, selMetric.value);
      else if (flxBtnEsc?.classList.contains('active')) fluxoBuildEscMap(f, anoSel, selMetric.value);
      else buildFluxoMap(f, anoSel, selMetric.value);
    });
  }

  if (flxBtnMun && flxBtnCre && flxBtnEsc) {
    flxBtnMun.addEventListener('click', () => {
      clearFlxMapBtns(); flxBtnMun.classList.add('active');
      document.getElementById('flx-table-wrapper').style.display = '';
      document.getElementById('flx-cre-wrapper').style.display = 'none';
      document.getElementById('flx-escola-wrapper').style.display = 'none';
      buildFluxoMap(f, anoSel, selMetric?.value || 'aprov_fund');
    });
    flxBtnCre.addEventListener('click', () => {
      clearFlxMapBtns(); flxBtnCre.classList.add('active');
      document.getElementById('flx-table-wrapper').style.display = 'none';
      document.getElementById('flx-cre-wrapper').style.display = '';
      document.getElementById('flx-escola-wrapper').style.display = 'none';
      buildFluxoCreMap(f, anoSel, selMetric?.value || 'aprov_fund');
      fluxoBuildCreTable(f, anoSel);
    });
    flxBtnEsc.addEventListener('click', () => {
      clearFlxMapBtns(); flxBtnEsc.classList.add('active');
      document.getElementById('flx-table-wrapper').style.display = 'none';
      document.getElementById('flx-cre-wrapper').style.display = 'none';
      document.getElementById('flx-escola-wrapper').style.display = '';
      fluxoBuildEscMap(f, anoSel, selMetric?.value || 'aprov_fund');
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
    { label: 'Reprovação Médio', key: 'reprov_med', value: st.reprov_med, icon: 'img/icons/medio.png', accent: 'red', suffix: '%' },
    { label: 'Abandono Fund.', key: 'aband_fund', value: st.aband_fund, icon: 'img/icons/fundamental.png', accent: 'red', suffix: '%' },
    { label: 'Abandono Médio', key: 'aband_med', value: st.aband_med, icon: 'img/icons/medio.png', accent: 'red', suffix: '%' },
  ];
  const accentColors = { green: '#1d71b9', yellow: '#FFCB04', red: '#EE302F', blue: '#1565C0' };
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

/** Definição das séries (ordem e rótulos) para o gráfico por série */
const FLX_SERIE_DEFS = [
  { suf: 'fund_01', label: '1º Ano' }, { suf: 'fund_02', label: '2º Ano' },
  { suf: 'fund_03', label: '3º Ano' }, { suf: 'fund_04', label: '4º Ano' },
  { suf: 'fund_05', label: '5º Ano' }, { suf: 'fund_06', label: '6º Ano' },
  { suf: 'fund_07', label: '7º Ano' }, { suf: 'fund_08', label: '8º Ano' },
  { suf: 'fund_09', label: '9º Ano' },
  { suf: 'med_01', label: '1ª Série EM' }, { suf: 'med_02', label: '2ª Série EM' },
  { suf: 'med_03', label: '3ª Série EM' }, { suf: 'med_04', label: '4ª Série EM' },
];

const FLX_SERIE_RATE_CFG = {
  aprov:  { color: '#2E9B6B', label: 'Aprovação' },
  reprov: { color: '#F57C00', label: 'Reprovação' },
  aband:  { color: COLORS.red, label: 'Abandono' },
};

/** Barras de taxa (aprov/reprov/aband) por série, para o ano + recorte geográfico atuais */
function fluxoBuildSerieChart(st) {
  const el = document.getElementById('flx-chart-serie');
  if (!el) return;
  st = st || {};

  const labels = FLX_SERIE_DEFS.map(s => s.label);
  // Cor mais clara entre Fund. (1-9) e Médio (10-13) para diferenciar etapa
  const isMed = FLX_SERIE_DEFS.map(s => s.suf.startsWith('med'));

  const buildData = (rate) => FLX_SERIE_DEFS.map(s => st[`${rate}_${s.suf}`] ?? null);

  // Sem dados por série (anos anteriores a 2020 ou recorte sem dado): estado vazio amigável
  const temSerie = ['aprov', 'reprov', 'aband'].some(r => buildData(r).some(v => v != null));
  if (!temSerie) {
    const host = el.parentElement;
    if (host) {
      host.innerHTML = `
        <div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:var(--text-sec);gap:6px;padding:20px">
          <img src="img/icons/panorama.png" alt="" style="width:34px;height:34px;opacity:.35">
          <div style="font-size:13px;font-weight:600;color:var(--text)">Recorte por série indisponível para este ano</div>
          <div style="font-size:11.5px;max-width:420px;line-height:1.5">As taxas por série (1º–9º ano e 1ª–4ª série EM) estão disponíveis de <strong>2012 em diante</strong>, conforme os arquivos oficiais por município do INEP. Selecione 2012 ou um ano posterior para visualizar.</div>
        </div>`;
    }
    return;
  }

  const colorFor = (rate) => {
    const base = FLX_SERIE_RATE_CFG[rate].color;
    return FLX_SERIE_DEFS.map((s, i) => isMed[i] ? base : base + 'B3');
  };

  const initialRate = 'aprov';
  const data0 = buildData(initialRate);

  const serieChart = new Chart(el, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: FLX_SERIE_RATE_CFG[initialRate].label,
        data: data0,
        backgroundColor: colorFor(initialRate),
        borderRadius: 4,
        maxBarThickness: 46,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      layout: { padding: { top: 26 } },
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: { display: false },
        datalabels: {
          ...DL_BAR_PCT,
          anchor: 'end', align: 'end',
          display: ctx => ctx.dataset.data[ctx.dataIndex] != null,
          formatter: v => (v == null ? '' : v.toFixed(1) + '%'),
        },
        tooltip: {
          enabled: true, mode: 'index', intersect: false,
          backgroundColor: 'rgba(30,30,30,.92)', titleFont: { family: 'Inter', size: 12, weight: '700' },
          bodyFont: { family: 'Inter', size: 11 }, padding: 10, cornerRadius: 8,
          callbacks: {
            title: items => items[0]?.label || '',
            label: item => item.raw != null ? `  ${item.dataset.label}: ${item.raw.toFixed(1)}%` : '  Sem dado',
          },
        },
      },
      scales: {
        ...CHART_DEFAULTS.scales,
        x: { ...CHART_DEFAULTS.scales.x, grid: { display: false } },
        y: { ...CHART_DEFAULTS.scales.y, min: 0, suggestedMax: 100, grace: '12%' },
      },
    },
  });
  S.charts.push(serieChart);

  const applyRate = (rate) => {
    const cfg = FLX_SERIE_RATE_CFG[rate];
    const ds = serieChart.data.datasets[0];
    ds.label = cfg.label;
    ds.data = buildData(rate);
    ds.backgroundColor = colorFor(rate);
    // Aprovação fica perto de 100; demais perto de 0 — ajusta o eixo
    serieChart.options.scales.y.suggestedMax = rate === 'aprov' ? 100 : Math.max(15, Math.ceil(Math.max(0, ...ds.data.filter(v => v != null)) * 1.2));
    serieChart.options.scales.y.min = rate === 'aprov' ? 50 : 0;
    serieChart.update();
  };
  applyRate(initialRate);

  document.querySelectorAll('#flx-serie-pills .flx-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#flx-serie-pills .flx-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      applyRate(pill.dataset.rate);
    });
  });
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
      { min: 95, color: '#14507F', label: '≥ 95%' },
      { min: 90, color: '#5cba68', label: '90% – 94%' },
      { min: 80, color: '#FFDF00', label: '80% – 89%' },
      { min: 0, color: '#EE302F', label: '< 80%' },
    ];
  } else {
    tiers = [
      { min: 0, max: 3, color: '#14507F', label: '< 3%' },
      { min: 3, max: 8, color: '#5cba68', label: '3% – 7%' },
      { min: 8, max: 15, color: '#FFDF00', label: '8% – 14%' },
      { min: 15, max: 999, color: '#EE302F', label: '≥ 15%' },
    ];
    if (metricDef.tdi) {
      tiers = [
        { min: 0, max: 10, color: '#14507F', label: '< 10%' },
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

/** Helper: remove all Fluxo map layers (GeoJSON + marker groups) */
function fluxoClearMapLayers() {
  if (S.mapLayer) {
    if (S.mapLayer.markers) { S.map.removeLayer(S.mapLayer.markers); }
    S.map.removeLayer(S.mapLayer); S.mapLayer = null;
  }
  if (S.mapLegend) { S.map.removeControl(S.mapLegend); S.mapLegend = null; }
}

/** Build CRE-level choropleth for Fluxo */
function buildFluxoCreMap(f, anoSel, metricKey) {
  if (!S.creGeo || !S.map) return;
  fluxoClearMapLayers();

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
      { min: 95, color: '#14507F', label: '≥ 95%' },
      { min: 90, color: '#5cba68', label: '90% – 94%' },
      { min: 80, color: '#FFDF00', label: '80% – 89%' },
      { min: 0, color: '#EE302F', label: '< 80%' },
    ];
  } else if (metricDef.tdi) {
    tiers = [
      { min: 0, max: 10, color: '#14507F', label: '< 10%' },
      { min: 10, max: 20, color: '#5cba68', label: '10% – 19%' },
      { min: 20, max: 30, color: '#FFDF00', label: '20% – 29%' },
      { min: 30, max: 999, color: '#EE302F', label: '≥ 30%' },
    ];
  } else {
    tiers = [
      { min: 0, max: 3, color: '#14507F', label: '< 3%' },
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
        ${pctCell(r.reprov_fund, false)}${pctCell(r.reprov_med, false)}
        ${pctCell(r.aband_fund, false)}${pctCell(r.aband_med, false)}
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
    const colKeys = ['_rank', 'nome', 'aprov_fund', 'aprov_med', 'reprov_fund', 'reprov_med', 'aband_fund', 'aband_med'];
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

/** Build CRE-level ranking table for Fluxo */
function fluxoBuildCreTable(f, anoSel) {
  const munData = f.por_municipio[anoSel] || {};
  const munToCre = S.creLookup?.mun_to_cre || {};
  const creList = S.creLookup?.cre_list || [];

  // Aggregate by CRE
  const creAgg = {};
  for (const [cod, v] of Object.entries(munData)) {
    const creInfo = munToCre[cod];
    if (!creInfo) continue;
    const cre = creInfo.cod_cre;
    if (!creAgg[cre]) creAgg[cre] = { nome: creInfo.nome_cre || `CRE ${cre}`, cod: cre, vals: {} };
    for (const k of ['aprov_fund','aprov_med','reprov_fund','reprov_med','aband_fund','aband_med']) {
      if (v[k] != null) {
        if (!creAgg[cre].vals[k]) creAgg[cre].vals[k] = { sum: 0, n: 0 };
        creAgg[cre].vals[k].sum += v[k];
        creAgg[cre].vals[k].n += 1;
      }
    }
  }

  let rows = Object.values(creAgg).map(c => {
    const r = { cod: c.cod, nome: c.nome };
    for (const k of ['aprov_fund','aprov_med','reprov_fund','reprov_med','aband_fund','aband_med']) {
      r[k] = c.vals[k] ? +(c.vals[k].sum / c.vals[k].n).toFixed(1) : null;
    }
    return r;
  }).sort((a,b) => (b.aprov_fund||0) - (a.aprov_fund||0));

  const pctCell = (val, higher = true) => {
    if (val == null) return '<td style="text-align:center;color:var(--text-light)">—</td>';
    let cls;
    if (higher) { cls = val >= 90 ? 'color:#00AB4E' : val >= 80 ? 'color:#E6A100' : 'color:#EE302F'; }
    else { cls = val < 5 ? 'color:#00AB4E' : val < 10 ? 'color:#E6A100' : 'color:#EE302F'; }
    return `<td style="text-align:center;font-weight:700;${cls}">${val.toFixed(1)}%</td>`;
  };

  const tbody = document.getElementById('flx-cre-tbody');
  if (!tbody) return;

  const renderRows = (data) => {
    tbody.innerHTML = data.map((r, i) =>
      `<tr data-cod="${r.cod}" style="cursor:pointer" class="${S.creSel === r.cod ? 'selected' : ''}" title="Clique para filtrar por ${r.nome}">
        <td>${i + 1}</td><td><strong>${r.nome}</strong></td>
        ${pctCell(r.aprov_fund, true)}${pctCell(r.aprov_med, true)}
        ${pctCell(r.reprov_fund, false)}${pctCell(r.reprov_med, false)}
        ${pctCell(r.aband_fund, false)}${pctCell(r.aband_med, false)}
      </tr>`
    ).join('');
    tbody.querySelectorAll('tr').forEach(tr => {
      tr.addEventListener('click', () => {
        const cod = tr.dataset.cod;
        S.creSel = S.creSel === cod ? null : cod;
        const selCre = document.getElementById('sel-cre');
        if (selCre) selCre.value = S.creSel || '';
        populateMunDropdown(S.creSel || null);
        refreshActiveTab();
      });
    });
  };
  renderRows(rows);

  // Sortable
  const table = document.getElementById('flx-cre-table');
  if (table) {
    const colKeys = ['_rank','nome','aprov_fund','aprov_med','reprov_fund','reprov_med','aband_fund','aband_med'];
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
  document.getElementById('flx-cre-search')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    tbody.querySelectorAll('tr').forEach(tr => {
      const nome = (tr.children[1]?.textContent || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      tr.style.display = nome.includes(q) ? '' : 'none';
    });
  });
}

/** Escolas Map for Fluxo (snapshot do ano mais recente disponível — 2025) */
function fluxoBuildEscMap(f, anoSel, metricKey) {
  const mapEl = document.getElementById('flx-map-leaflet');
  if (!mapEl || !S.geo || !S.escolasData?.escolas) return;
  destroyMap();

  const escData = f.por_escola_recente || f.por_escola_2025 || f.por_escola_2024 || [];
  const metricDef = FLUXO_MAP_METRICS.find(m => m.key === metricKey) || FLUXO_MAP_METRICS[0];

  // Build coords lookup from escolas_estaduais.json (inep field = cod_escola)
  const coordsMap = {};
  S.escolasData.escolas.forEach(e => {
    if (e.lat && e.lng) coordsMap[e.inep] = { lat: e.lat, lng: e.lng, nome: e.nome, cod_mun: e.cod_mun };
  });

  // Merge ETL data with coordinates
  let escolas = escData
    .filter(md => md.cod_escola && coordsMap[md.cod_escola] && md[metricKey] != null)
    .map(md => ({ ...md, lat: coordsMap[md.cod_escola].lat, lng: coordsMap[md.cod_escola].lng }));
  if (S.munSel) escolas = escolas.filter(e => e.cod_mun === S.munSel);
  const creMuns = S.creSel ? getCreMuns(S.creSel) : null;
  if (creMuns) escolas = escolas.filter(e => creMuns.includes(e.cod_mun));

  let tiers;
  if (metricDef.higher) {
    tiers = [
      { min: 95, color: '#14507F', label: '≥ 95%' },
      { min: 90, color: '#5cba68', label: '90% – 94%' },
      { min: 80, color: '#FFDF00', label: '80% – 89%' },
      { min: 0, color: '#EE302F', label: '< 80%' },
    ];
  } else if (metricDef.tdi) {
    tiers = [
      { min: 0, max: 10, color: '#14507F', label: '< 10%' },
      { min: 10, max: 20, color: '#5cba68', label: '10% – 19%' },
      { min: 20, max: 30, color: '#FFDF00', label: '20% – 29%' },
      { min: 30, max: 999, color: '#EE302F', label: '≥ 30%' },
    ];
  } else {
    tiers = [
      { min: 0, max: 3, color: '#14507F', label: '< 3%' },
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

  // Create fresh map
  const map = L.map(mapEl, { zoomControl: true, scrollWheelZoom: true, attributionControl: false }).setView([-29.7, -53.5], 6.5);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', { maxZoom: 14 }).addTo(map);

  // Background polygons (faint)
  S.mapLayer = L.geoJSON(S.geo, {
    style: () => ({ fillColor: '#f4f6f9', fillOpacity: 0.4, weight: 0.8, color: '#d0d5dc' })
  }).addTo(map);

  // Circle markers
  const markers = L.layerGroup().addTo(map);
  escolas.forEach(e => {
    const val = e[metricKey];
    const color = getColor(val);
    const circle = L.circleMarker([e.lat, e.lng], {
      radius: 4, fillColor: color, fillOpacity: 0.9, color: '#fff', weight: 0.5
    });
    circle.bindTooltip(`<strong>${e.nome_escola}</strong><br>${e.nome_mun}<br>${metricDef.label}: ${val != null ? val.toFixed(1) + '%' : 'Sem dados'}`);
    circle.addTo(markers);
  });
  S.mapLayer.markers = markers;

  // Legend
  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = function () {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = `<h4>${metricDef.label} (Escolas ${f.ano_escola_recente || '2025'})</h4>` +
      tiers.slice().reverse().map(t => `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${t.color}"></div><span>${t.label}</span></div>`).join('');
    div.innerHTML += `<div class="map-legend-row" style="margin-top:4px"><div class="map-legend-swatch" style="background:#f0f0f0"></div><span>Sem dados</span></div>`;
    return div;
  };
  legend.addTo(map);
  S.map = map;
  S.mapLegend = legend;
  if (S.mapLayer) map.fitBounds(S.mapLayer.getBounds(), { padding: [20, 20] });

  // ── Escolas Table ──
  const tbody = document.querySelector('#flx-escola-table tbody');
  if (tbody) {
    escolas.sort((a, b) => {
      const va = a[metricKey] || 0; const vb = b[metricKey] || 0;
      return metricDef.higher ? vb - va : va - vb;
    });

    const pctCell = (val, higher = true) => {
      if (val == null) return '<td style="text-align:center;color:var(--text-light)">—</td>';
      let cls;
      if (higher) { cls = val >= 90 ? 'color:#00AB4E' : val >= 80 ? 'color:#E6A100' : 'color:#EE302F'; }
      else { cls = val < 5 ? 'color:#00AB4E' : val < 10 ? 'color:#E6A100' : 'color:#EE302F'; }
      return `<td style="text-align:center;font-weight:700;${cls}">${val.toFixed(1)}%</td>`;
    };

    tbody.innerHTML = escolas.map((e, i) => `
      <tr style="cursor:pointer" data-lat="${e.lat}" data-lng="${e.lng}">
        <td>${i+1}</td>
        <td>${e.nome_escola}</td>
        <td>${e.nome_mun}</td>
        ${pctCell(e.aprov_fund, true)}${pctCell(e.aprov_med, true)}
        ${pctCell(e.reprov_fund, false)}${pctCell(e.reprov_med, false)}
        ${pctCell(e.aband_fund, false)}${pctCell(e.aband_med, false)}
      </tr>
    `).join('');

    tbody.querySelectorAll('tr').forEach(tr => {
      tr.addEventListener('click', () => {
        const lat = tr.dataset.lat, lng = tr.dataset.lng;
        if (lat && lng && S.map) S.map.setView([parseFloat(lat), parseFloat(lng)], 14);
      });
    });

    const searchEl = document.getElementById('flx-escola-search');
    if (searchEl) {
      const newEl = searchEl.cloneNode(true);
      searchEl.parentNode.replaceChild(newEl, searchEl);
      newEl.addEventListener('input', ev => {
        const q = ev.target.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        tbody.querySelectorAll('tr').forEach(tr => {
          const text = tr.innerText.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          tr.style.display = text.includes(q) ? '' : 'none';
        });
      });
    }

    const table = document.getElementById('flx-escola-table');
    if (table) {
      delete table.dataset.sortBound;
      afdBindTableSort('flx-escola-table', 3);
    }
  }
}

// ══════════════════════════════════════════════════════════
// RENDER — CONTEXTO SOCIOECONÔMICO (INSE)
// ══════════════════════════════════════════════════════════

const FONTE_INSE = 'Fonte: INEP — ' + fonteLink(URL_INDICADORES, 'Indicador de Nível Socioeconômico (INSE/SAEB)', 'Acessar o INSE / Indicadores Educacionais no portal INEP');

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
  const su = getInseScope(inse, anoAtual) || inse.serie_temporal[anoAtual];
  const sp = getInseScope(inse, primeiro) || inse.serie_temporal[primeiro];

  // KPI values
  const predominante = Object.entries(su.dist_niveis_escolas)
    .sort((a, b) => b[1].pct - a[1].pct)[0];
  const vulneraveis = Object.entries(su.dist_niveis_escolas)
    .filter(([k]) => ['Nível I','Nível II','Nível III','Nível IV'].includes(k))
    .reduce((s, [, v]) => s + (v.count || 0), 0);
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
        <div class="chart-title">Escolas por Nível INSE — ${geoLabel} (${anoAtual})${geoSuffix()}</div>
        <div style="height:260px"><canvas id="inse-chart-dist"></canvas></div>
        <div class="chart-source">${FONTE_INSE}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Nº de Alunos por Nível INSE — ${geoLabel} (${anoAtual})${geoSuffix()}</div>
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
            ${S.escolasData ? '<button class="map-layer-btn" id="inse-btn-layer-escola">Escolas</button>' : ''}
          </div>
        </div>
        <div id="inse-map-leaflet" style="height:380px;border-radius:8px"></div>
        <div class="chart-source">${FONTE_INSE}</div>
      </div>
      <div class="chart-card" style="min-height:400px" id="inse-table-wrapper">
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
              <tr>
                <th style="width:30px">#</th>
                <th data-sort-key="nome" style="cursor:pointer;position:sticky;left:0;z-index:2;background:#f8f9fa;min-width:140px;border-right:2px solid #e0e0e0">Município <span class="sort-icon" style="opacity:0.3;margin-left:4px">↕</span></th>
                <th data-sort-key="inse" style="cursor:pointer">INSE <span class="sort-icon" style="opacity:0.3;margin-left:4px">↕</span></th>
                <th data-sort-key="nivel" style="cursor:pointer">Nível <span class="sort-icon" style="opacity:0.3;margin-left:4px">↕</span></th>
                <th data-sort-key="escolas" style="cursor:pointer">Escolas <span class="sort-icon" style="opacity:0.3;margin-left:4px">↕</span></th>
                <th data-sort-key="alunos" style="cursor:pointer">Alunos <span class="sort-icon" style="opacity:0.3;margin-left:4px">↕</span></th>
              </tr>
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
  const sparkVals = anos.map(a => getInseScope(inse, a)?.media || 0);
  const sparkMin = Math.min(...sparkVals.filter(v => v > 0)); 
  const sparkMax = Math.max(...sparkVals);
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

    // A série "RS Estadual (ref.)" é idêntica à série principal quando o recorte
    // é a própria Rede Estadual (sem CRE/município filtrado). Nesse caso ela é
    // omitida para evitar legenda duplicada.
    const mostraRefEstadual = (geoLabel !== getRedeLabel() + ' do RS');
    const evolDatasets = [
      { label: geoLabel, data: anos.map(a => getInseScope(inse, a)?.media), borderColor: COLORS.pri, backgroundColor: COLORS.pri + '22', fill: true, tension: .3, pointRadius: 5, borderWidth: 2.5,
        datalabels: { anchor: 'end', align: 'top' } },
      { label: 'Brasil (ref.)', data: anos.map(a => brasMedia[a] || null), borderColor: '#999', borderDash: [5, 5], tension: .3, pointRadius: 4, borderWidth: 2,
        datalabels: { anchor: 'start', align: 'bottom' }, hidden: true }
    ];
    if (mostraRefEstadual) {
      evolDatasets.push({ label: 'RS Estadual (ref.)', data: anos.map(a => inse.serie_temporal[a]?.media), borderColor: '#B0BEC5', borderDash: [5, 5], tension: .3, pointRadius: 0, borderWidth: 2,
        datalabels: { display: false } });
    }

    S.charts.push(new Chart(el, {
      type: 'line',
      data: {
        labels: anos,
        datasets: evolDatasets
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
          { label: 'Urbana', data: anos.map(a => getInseScope(inse, a)?.urbana?.media), borderColor: COLORS.pri, tension: .3, pointRadius: 5, borderWidth: 2.5,
            datalabels: { anchor: 'end', align: 'top' } },
          { label: 'Rural', data: anos.map(a => getInseScope(inse, a)?.rural?.media), borderColor: COLORS.red, borderDash: [5, 5], tension: .3, pointRadius: 5, borderWidth: 2.5,
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
        <td style="position:sticky;left:0;z-index:1;background:#fff">${i + 1}</td>
        <td style="position:sticky;left:30px;z-index:1;background:#fff;border-right:2px solid #e0e0e0">${lookup[cod] || cod}</td>
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
      const headers = [
        { label: '#', style: 'width:30px' },
        { label: 'Município', style: 'position:sticky;left:0;z-index:2;background:#f8f9fa;min-width:140px;border-right:2px solid #e0e0e0' },
        { label: 'INSE', style: '' },
        { label: 'Nível', style: '' },
        { label: 'Escolas', style: '' },
        { label: 'Alunos', style: '' }
      ];
      thead.innerHTML = '<tr>' + headers.map((h, i) => {
        const arrow = inseSortCol === i ? (inseSortAsc ? ' ▲' : ' ▼') : ' ⇅';
        return `<th style="cursor:pointer;${h.style}" title="Clique para ordenar">${h.label} <span style="opacity:0.4">${arrow}</span></th>`;
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
        const d = getInseScope(inse, a)?.dist_niveis_escolas?.[n];
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
    const urbVals = anos.map(a => getInseScope(inse, a)?.urbana?.media || null);
    const rurVals = anos.map(a => getInseScope(inse, a)?.rural?.media || null);
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

  // ── Escola layer for INSE map ──
  const inseBuildEscolaLayer = () => {
    if (!S.escolasData?.escolas || !S.map) return;
    if (S.mapLayer) { S.mapLayer.remove(); S.mapLayer = null; }
    if (S.mapLegend) { S.mapLegend.remove(); S.mapLegend = null; }
    if (S.escolasMarkers) { S.escolasMarkers.remove(); S.escolasMarkers = null; }

    const markers = L.layerGroup();
    const creMuns = S.creSel ? getCreMuns(S.creSel) : null;
    const lookup = inse.lookup_municipios || {};

    S.escolasData.escolas.forEach(e => {
      if (!e.lat || !e.lng || e.inse_media == null) return;
      if (S.munSel && e.cod_mun !== S.munSel) return;
      if (creMuns && !creMuns.includes(e.cod_mun)) return;
      const nivel = e.inse_nivel || '—';
      const cor = INSE_NIVEL_COLORS[nivel] || '#999';
      const m = L.circleMarker([e.lat, e.lng], {
        radius: 5, fillColor: cor, color: '#fff', weight: 1, fillOpacity: 0.85
      });
      m.bindPopup(`<div style="font-size:11px;min-width:200px">
        <strong>${e.nome}</strong><br>
        <span style="color:#888">${lookup[e.cod_mun] || e.municipio || e.cod_mun}</span><br>
        <div style="margin-top:6px">
          <span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${cor};vertical-align:middle;margin-right:6px"></span>
          <strong>INSE: ${e.inse_media?.toFixed(2)}</strong> — ${nivel}
        </div>
        ${e.mat_total ? `<div style="margin-top:4px;color:#555">Matrículas: ${formatNum(e.mat_total)}</div>` : ''}
      </div>`, { maxWidth: 280 });
      markers.addLayer(m);
    });
    markers.addTo(S.map);
    S.escolasMarkers = markers;

    // Escola table
    const wrapper = document.getElementById('inse-table-wrapper');
    if (wrapper) {
      wrapper.innerHTML = `
        <div class="chart-title">Tabela de Escolas — INSE</div>
        <div style="margin:6px 0 4px">
          <input type="text" id="inse-escola-search" placeholder="🔍 Pesquisar escola..."
            style="width:100%;padding:6px 10px;font-size:11px;border:1px solid #ddd;border-radius:6px;font-family:Inter">
        </div>
        <div style="max-height:380px;overflow-y:auto">
          <table class="data-table" id="inse-escola-table">
            <thead><tr>
              <th>#</th><th>Escola</th><th>Município</th><th>INSE</th><th style="min-width:90px">Nível</th><th>Matrículas</th>
            </tr></thead>
            <tbody></tbody>
          </table>
        </div>
        <div class="chart-source">${FONTE_INSE}</div>`;

      let escolas = S.escolasData.escolas.filter(e => e.inse_media != null);
      if (S.munSel) escolas = escolas.filter(e => e.cod_mun === S.munSel);
      if (creMuns) escolas = escolas.filter(e => creMuns.includes(e.cod_mun));
      escolas.sort((a, b) => (b.inse_media || 0) - (a.inse_media || 0));

      const tbody = wrapper.querySelector('tbody');
      tbody.innerHTML = escolas.map((e, i) => {
        const cor = INSE_NIVEL_COLORS[e.inse_nivel] || '#999';
        return `<tr style="cursor:pointer" data-lat="${e.lat}" data-lng="${e.lng}">
          <td>${i+1}</td>
          <td>${e.nome}</td>
          <td>${lookup[e.cod_mun] || e.municipio || e.cod_mun}</td>
          <td><strong>${e.inse_media?.toFixed(2) || '—'}</strong></td>
          <td style="white-space:nowrap"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${cor};vertical-align:middle;margin-right:4px"></span><strong style="color:${cor}">${e.inse_nivel || '—'}</strong></td>
          <td>${e.mat_total ? formatNum(e.mat_total) : '—'}</td>
        </tr>`;
      }).join('');

      // Click-to-zoom
      tbody.querySelectorAll('tr[data-lat]').forEach(tr => {
        tr.addEventListener('click', () => {
          const lat = parseFloat(tr.dataset.lat), lng = parseFloat(tr.dataset.lng);
          if (lat && lng && S.map) S.map.setView([lat, lng], 14);
        });
      });

      // Search
      document.getElementById('inse-escola-search')?.addEventListener('input', ev => {
        const q = ev.target.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        tbody.querySelectorAll('tr').forEach(tr => {
          const nome = (tr.children[1]?.textContent || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          tr.style.display = nome.includes(q) ? '' : 'none';
        });
      });

      injectExportButtons();
    }

    // Legend
    const legend = L.control({ position: 'bottomleft' });
    legend.onAdd = () => {
      const div = L.DomUtil.create('div', 'leaflet-legend');
      const niveis = Object.entries(INSE_NIVEL_COLORS);
      div.innerHTML = '<div style="font-weight:700;margin-bottom:4px;font-size:10px">Nível INSE</div>' +
        niveis.map(([n, c]) => `<div style="display:flex;align-items:center;gap:5px;font-size:9px;margin:2px 0">
          <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${c}"></span>${n}
        </div>`).join('');
      return div;
    };
    legend.addTo(S.map);
    S.mapLegend = legend;
  };

  // Bind INSE map layer toggle
  const inseBtnMun = document.getElementById('inse-btn-layer-mun');
  const inseBtnCre = document.getElementById('inse-btn-layer-cre');
  const inseBtnEsc = document.getElementById('inse-btn-layer-escola');
  if (inseBtnMun && inseBtnCre) {
    const restoreInseTableWrapper = () => {
      const wrapper = document.getElementById('inse-table-wrapper');
      if (wrapper && !wrapper.querySelector('#inse-mun-table')) {
        wrapper.innerHTML = `
          <div class="chart-title">Tabela Municipal — INSE</div>
          <div style="font-size:10px;color:var(--accent);padding:4px 12px 6px;font-weight:600;background:rgba(255,203,4,.08);border-radius:6px;border:1px dashed rgba(255,203,4,.3);margin-bottom:6px">
            📍 Clique em qualquer município — na tabela ou no mapa — para filtrar <strong>todas as visualizações</strong> desta seção. Clique novamente para desfiltrar.
          </div>
          <div style="margin:6px 0 4px">
            <input type="text" id="inse-mun-search" placeholder="🔍 Pesquisar município..."
              style="width:100%;padding:6px 10px;font-size:11px;border:1px solid #ddd;border-radius:6px;font-family:Inter">
          </div>
          <div style="max-height:340px;overflow-y:auto">
            <table class="data-table" id="inse-mun-table">
              <thead><tr><th>#</th><th>Município</th><th>INSE</th><th>Nível</th><th>Escolas</th><th>Alunos</th></tr></thead>
              <tbody></tbody>
            </table>
          </div>
          <div class="chart-source">${FONTE_INSE}</div>`;
      }
    };
    inseBtnMun.addEventListener('click', () => {
      inseBtnMun.classList.add('active'); inseBtnCre.classList.remove('active'); inseBtnEsc?.classList.remove('active');
      if (S.escolasMarkers) { S.escolasMarkers.remove(); S.escolasMarkers = null; }
      restoreInseTableWrapper();
      inseBuildMap(); inseBuildMunTable();
    });
    inseBtnCre.addEventListener('click', () => {
      inseBtnCre.classList.add('active'); inseBtnMun.classList.remove('active'); inseBtnEsc?.classList.remove('active');
      if (S.escolasMarkers) { S.escolasMarkers.remove(); S.escolasMarkers = null; }
      restoreInseTableWrapper();
      inseBuildCreMap(); inseBuildMunTable();
    });
    if (inseBtnEsc) {
      inseBtnEsc.addEventListener('click', () => {
        inseBtnEsc.classList.add('active'); inseBtnMun.classList.remove('active'); inseBtnCre.classList.remove('active');
        inseBuildEscolaLayer();
      });
    }
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

const FONTE_ICG = 'Fonte: INEP — ' + fonteLink(URL_INDICADORES, 'Indicador de Complexidade de Gestão da Escola', 'Acessar o ICG / Indicadores Educacionais no portal INEP');

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
        <div class="chart-title">Distribuição por Nível de Complexidade — ${anoAtual}${geoSuffix()}</div>
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
        <div class="chart-title">Nível Médio de Complexidade — Evolução${geoSuffix()}</div>
        <div style="height:220px"><canvas id="icg-chart-nivel-medio"></canvas></div>
        <div class="chart-source">${FONTE_ICG}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Distribuição por Nível — Evolução (% empilhado)${geoSuffix()}</div>
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
      <span class="section-divider-text">${territorialDividerText()}</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="map-table-row d1">
      <div class="map-container">
        <div class="map-toolbar">
          <h3>Mapa — Nível Médio ICG <span id="icg-map-ano">${anoAtual}</span></h3>
          <div class="map-layer-toggle">
            <button class="map-layer-btn active" id="icg-btn-layer-mun">Municípios</button>
            <button class="map-layer-btn" id="icg-btn-layer-cre">CREs</button>
            ${S.escolasData ? '<button class="map-layer-btn" id="icg-btn-layer-escola">Escolas</button>' : ''}
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
  const icgBtnEsc = document.getElementById('icg-btn-layer-escola');
  if (icgBtnMun && icgBtnCre) {
    icgBtnMun.addEventListener('click', () => {
      icgBtnMun.classList.add('active'); icgBtnCre.classList.remove('active'); icgBtnEsc?.classList.remove('active');
      if (S.escolasMarkers) { S.escolasMarkers.remove(); S.escolasMarkers = null; }
      icgBuildMap(); icgBuildMunTable();
    });
    icgBtnCre.addEventListener('click', () => {
      icgBtnCre.classList.add('active'); icgBtnMun.classList.remove('active'); icgBtnEsc?.classList.remove('active');
      if (S.escolasMarkers) { S.escolasMarkers.remove(); S.escolasMarkers = null; }
      icgBuildCreMap(); icgBuildMunTable();
    });
    if (icgBtnEsc) {
      icgBtnEsc.addEventListener('click', () => {
        icgBtnEsc.classList.add('active'); icgBtnMun.classList.remove('active'); icgBtnCre.classList.remove('active');
        icgBuildEscolaLayer();
      });
    }
  }

  // ── Escola layer for ICG map ──
  const icgBuildEscolaLayer = () => {
    if (!S.escolasData?.escolas || !S.map) return;
    if (S.mapLayer) { S.mapLayer.remove(); S.mapLayer = null; }
    if (S.mapLegend) { S.mapLegend.remove(); S.mapLegend = null; }
    if (S.escolasMarkers) { S.escolasMarkers.remove(); S.escolasMarkers = null; }

    const markers = L.layerGroup();
    const creMuns = S.creSel ? getCreMuns(S.creSel) : null;
    const lookup = icg.lookup_municipios || {};

    S.escolasData.escolas.forEach(e => {
      if (!e.lat || !e.lng || e.icg_nivel == null) return;
      if (S.munSel && e.cod_mun !== S.munSel) return;
      if (creMuns && !creMuns.includes(e.cod_mun)) return;
      const nivel = e.icg_nivel;
      const cor = ICG_COLORS[nivel] || '#999';
      const m = L.circleMarker([e.lat, e.lng], {
        radius: 5, fillColor: cor, color: '#fff', weight: 1, fillOpacity: 0.85
      });
      m.bindPopup(`<div style="font-size:11px;min-width:180px">
        <strong>${e.nome}</strong><br>
        <span style="color:#888">${lookup[e.cod_mun] || e.cod_mun}</span><br>
        <div style="margin-top:6px">
          <span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${cor};vertical-align:middle;margin-right:6px"></span>
          <strong>Nível ${nivel}</strong> — ${ICG_SHORT[nivel] || ''}
        </div>
        ${e.mat_total ? `<div style="margin-top:4px;color:#555">Matrículas: ${formatNum(e.mat_total)}</div>` : ''}
      </div>`, { maxWidth: 260 });
      markers.addLayer(m);
    });
    markers.addTo(S.map);
    S.escolasMarkers = markers;

    // Escola table
    const wrapper = document.getElementById('icg-table-wrapper');
    if (wrapper) {
      wrapper.innerHTML = `
        <div class="table-header">
          <h3>Tabela de Escolas — ICG</h3>
          <input type="text" class="table-search" id="icg-escola-search" placeholder="Buscar escola...">
        </div>
        <div style="max-height:400px;overflow-y:auto">
          <table class="data-table" id="icg-escola-table">
            <thead><tr>
              <th>#</th><th>INEP</th><th>Escola</th><th>Município</th><th>Nível ICG</th><th>Matrículas</th>
            </tr></thead>
            <tbody></tbody>
          </table>
        </div>
        <div class="chart-source">${FONTE_ICG}</div>`;

      let escolas = S.escolasData.escolas.filter(e => e.icg_nivel != null);
      if (S.munSel) escolas = escolas.filter(e => e.cod_mun === S.munSel);
      if (creMuns) escolas = escolas.filter(e => creMuns.includes(e.cod_mun));
      escolas.sort((a, b) => (b.icg_nivel || 0) - (a.icg_nivel || 0));

      const tbody = wrapper.querySelector('tbody');
      tbody.innerHTML = escolas.map((e, i) => {
        const cor = ICG_COLORS[e.icg_nivel] || '#999';
        return `<tr style="cursor:pointer" data-lat="${e.lat}" data-lng="${e.lng}">
          <td>${i+1}</td>
          <td style="font-size:10px;color:#888">${e.inep || ''}</td>
          <td>${e.nome}</td>
          <td>${lookup[e.cod_mun] || e.cod_mun}</td>
          <td><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${cor};vertical-align:middle;margin-right:4px"></span><strong style="color:${cor}">Nível ${e.icg_nivel}</strong></td>
          <td>${e.mat_total ? formatNum(e.mat_total) : '—'}</td>
        </tr>`;
      }).join('');

      // Click-to-zoom
      tbody.querySelectorAll('tr[data-lat]').forEach(tr => {
        tr.addEventListener('click', () => {
          const lat = parseFloat(tr.dataset.lat), lng = parseFloat(tr.dataset.lng);
          if (lat && lng && S.map) S.map.setView([lat, lng], 14);
        });
      });

      // Search
      document.getElementById('icg-escola-search')?.addEventListener('input', ev => {
        const q = ev.target.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        tbody.querySelectorAll('tr').forEach(tr => {
          const nome = (tr.children[2]?.textContent || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          tr.style.display = nome.includes(q) ? '' : 'none';
        });
      });

      injectExportButtons();
    }

    // Legend
    const legend = L.control({ position: 'bottomleft' });
    legend.onAdd = function () {
      const div = L.DomUtil.create('div', 'map-legend');
      div.innerHTML = '<h4>Nível ICG (Escolas)</h4>' +
        [6,5,4,3,2,1].map(n => `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${ICG_COLORS[n]}"></div><span>${ICG_SHORT[n]}</span></div>`).join('');
      return div;
    };
    legend.addTo(S.map);
    S.mapLegend = legend;
  };

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

const FONTE_AFD = 'Fonte: INEP — ' + fonteLink(URL_INDICADORES, 'Indicador de Adequação da Formação Docente', 'Acessar o AFD / Indicadores Educacionais no portal INEP');

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
        <div class="chart-title">Percentual por Grupo de Adequação — por Etapa (${anoSel})${geoSuffix()}</div>
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
        <div class="chart-title" id="afd-evol-title">Evolução por Grupo — Selecione abaixo${geoSuffix()}</div>
        <div style="display:flex;align-items:center;gap:16px;margin:8px 0 12px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:11px;font-weight:700;color:#555">Etapa:</span>
            <select id="afd-evol-etapa-select" style="font-size:11px;padding:4px 8px;border-radius:5px;border:1px solid #bbb;font-family:Inter;background:#fff;cursor:pointer;font-weight:600;color:var(--pri)">
              <option value="medio" selected>Ensino Médio</option>
              <option value="fund_ai">Anos Iniciais</option>
              <option value="fund_af">Anos Finais</option>
              <option value="eja_fund">EJA</option>
            </select>
          </div>
          <div style="width:1px;height:20px;background:#e0e0e0"></div>
          <div id="afd-evol-group-pills" style="display:flex;align-items:center;flex-wrap:wrap;gap:5px"></div>
        </div>
        <p style="font-size:10px;color:var(--text-sec);margin:0 0 6px;font-style:italic">💡 Clique na legenda do gráfico para filtrar por grupo</p>
        <div style="height:280px"><canvas id="afd-chart-evol-unified"></canvas></div>
        <div class="chart-source">${FONTE_AFD}</div>
      </div>
    </div>

    <!-- ═══ EIXO: Distribuição Territorial ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/territorial.png" alt=""></span>
      <span class="section-divider-text">${territorialDividerText()}</span>
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
              <button class="map-layer-btn" id="afd-btn-layer-esc">Escolas</button>
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
    let selGroups = ['g1'];
    let selEtapa = 'medio';
    let evolChart = null;

    const buildEvolChart = () => {
      if (evolChart) { evolChart.destroy(); S.charts = S.charts.filter(c => c !== evolChart); }
      const title = document.getElementById('afd-evol-title');
      const titleGroups = selGroups.map(gk => AFD_GROUPS[gk].short).join(' + ');
      const e = evolEtapas.find(et => et.key === selEtapa);
      if (title) title.textContent = `Evolução ${titleGroups} — ${e.label}${geoSuffix()}`;
      evolChart = new Chart(evolContainer, {
        type: 'line',
        data: {
          labels: anos,
          datasets: selGroups.map(g => ({
            label: AFD_GROUPS[g].label,
            data: geoTs.map(s => {
              if (!s || !s[e.key]) return null;
              return +(s[e.key][g] || 0).toFixed(1);
            }),
            borderColor: AFD_GROUPS[g].color,
            backgroundColor: AFD_GROUPS[g].color + '22',
            tension: .3, pointRadius: 4, borderWidth: 2.5, fill: false
          }))
        },
        options: { ...CHART_DEFAULTS, layout: { padding: { top: 20 } },
          plugins: { ...CHART_DEFAULTS.plugins,
            legend: { display: true, labels: { font: { family: 'Inter', size: 10, weight: '600' }, boxWidth: 10, padding: 6, usePointStyle: false }, onClick: null },
            datalabels: { display: ctx => ctx.dataset.data[ctx.dataIndex] > 0, color: '#333', font: { family: 'Inter', size: 9, weight: '700' }, anchor: 'end', align: 'top', formatter: v => v ? v.toFixed(1) + '%' : '' } },
          scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: true, suggestedMax: selGroups.length === 1 && selGroups[0] === 'g1' ? 100 : 40, ticks: { ...CHART_DEFAULTS.scales.y?.ticks, callback: v => v + '%' } } }
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
          const isActive = selGroups.includes(gk);
          return `<button class="flx-pill${isActive ? ' active' : ''}" data-gk="${gk}" style="--pill-color:${g.color};font-size:10px;padding:3px 10px;border-radius:12px;border:1.5px solid ${g.color};background:${isActive ? g.color : 'transparent'};color:${isActive ? '#fff' : g.color};cursor:pointer;font-weight:600;font-family:Inter;transition:all .15s">${g.short}</button>`;
        }).join('');
      groupPillsEl.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          const gk = btn.dataset.gk;
          if (selGroups.includes(gk)) {
            if (selGroups.length > 1) selGroups = selGroups.filter(x => x !== gk);
          } else {
            selGroups.push(gk);
          }
          groupPillsEl.querySelectorAll('button').forEach(b => {
            const c = AFD_GROUPS[b.dataset.gk].color;
            const isAct = selGroups.includes(b.dataset.gk);
            b.style.background = isAct ? c : 'transparent';
            b.style.color = isAct ? '#fff' : c;
            b.classList.toggle('active', isAct);
          });
          buildEvolChart();
        });
      });
    }

    const etapaSelEl = document.getElementById('afd-evol-etapa-select');
    if (etapaSelEl) {
      etapaSelEl.addEventListener('change', (ev) => {
        selEtapa = ev.target.value;
        buildEvolChart();
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

  const AFD_GRADIENTS = {
    g1: ['#E53935', '#FB8C00', '#FFCB04', '#66BB6A', '#2874A6'], // Custom mapped from original breaks
    g2: ['#E8F5E9', '#C8E6C9', '#A5D6A7', '#66BB6A', '#2E7D32'], // Greens
    g3: ['#FFFDE7', '#FFF59D', '#FFEE58', '#FFCB04', '#F57F17'], // Yellows
    g4: ['#FFF3E0', '#FFE0B2', '#FFB74D', '#FB8C00', '#E65100'], // Oranges
    g5: ['#FFEBEE', '#FFCDD2', '#EF9A9A', '#E53935', '#B71C1C']  // Reds
  };

  function getAfdColor(v, grp = 'g1') {
    if (grp === 'g1') {
      for (const b of AFD_MAP_BREAKS) { if (v >= b.min && v < b.max) return b.color; }
      return '#f0f0f0';
    }
    const pal = AFD_GRADIENTS[grp] || AFD_GRADIENTS.g5;
    if (v >= 80) return pal[4];
    if (v >= 60) return pal[3];
    if (v >= 40) return pal[2];
    if (v >= 20) return pal[1];
    return pal[0];
  }

  function getAfdLegendHTML(grp, title) {
    if (grp === 'g1') {
      return `<h4>${title}</h4>` +
        AFD_MAP_BREAKS.slice().reverse().map(b =>
          `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${b.color}"></div><span>${b.label}</span></div>`
        ).join('') + '<div class="map-legend-row" style="margin-top:4px"><div class="map-legend-swatch" style="background:#f0f0f0"></div><span>Sem dados</span></div>';
    }
    const pal = AFD_GRADIENTS[grp] || AFD_GRADIENTS.g5;
    return `<h4>${title}</h4>` +
      `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${pal[4]}"></div><span>≥ 80%</span></div>` +
      `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${pal[3]}"></div><span>60 – 80%</span></div>` +
      `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${pal[2]}"></div><span>40 – 60%</span></div>` +
      `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${pal[1]}"></div><span>20 – 40%</span></div>` +
      `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${pal[0]}"></div><span>< 20%</span></div>` +
      `<div class="map-legend-row" style="margin-top:4px"><div class="map-legend-swatch" style="background:#f0f0f0"></div><span>Sem dados</span></div>`;
  }

  const afdBindTableSort = (tableId, numColStart) => {
    const table = document.getElementById(tableId);
    if (!table || table.dataset.sortBound) return;
    table.dataset.sortBound = 'true';
    table.querySelectorAll('thead th').forEach((th, colIdx) => {
      th.style.cursor = 'pointer';
      th.title = 'Clique para ordenar';
      th.addEventListener('click', () => {
        const tbody = table.querySelector('tbody');
        const rows = Array.from(tbody.querySelectorAll('tr'));
        if (!rows.length) return;
        const dir = th.dataset.sort === 'asc' ? 'desc' : 'asc';
        th.dataset.sort = dir;
        
        table.querySelectorAll('thead th').forEach(t => t.textContent = t.textContent.replace(/[▼▲]/g, '').trim());
        th.textContent = th.textContent + (dir === 'asc' ? ' ▲' : ' ▼');

        rows.sort((a, b) => {
          let va = a.children[colIdx]?.textContent.replace(/[%.,]/g, '').trim() || '';
          let vb = b.children[colIdx]?.textContent.replace(/[%.,]/g, '').trim() || '';
          if (colIdx >= numColStart) {
            va = parseFloat(va) || 0;
            vb = parseFloat(vb) || 0;
          }
          if (va === vb) return 0;
          return dir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
        });
        tbody.append(...rows);
        
        Array.from(tbody.querySelectorAll('tr')).forEach((tr, i) => {
          if (tr.children[0]) tr.children[0].textContent = i + 1;
        });
      });
    });
  };

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
        return { fillColor: v > 0 ? getAfdColor(v, grp) : '#f0f0f0', weight: 0.8, opacity: 1, color: '#fff', fillOpacity: 0.85 };
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
      div.innerHTML = getAfdLegendHTML(grp, `% ${GRP_LABELS[grp]} ${ETAPA_LABELS[etapa]}`);
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
        return { fillColor: avg > 0 ? getAfdColor(avg, grp) : '#f0f0f0', weight: 2, color: '#fff', fillOpacity: 0.8 };
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
      div.innerHTML = getAfdLegendHTML(grp, `% ${GRP_LABELS[grp]} ${ETAPA_LABELS[etapa]} (CREs)`);
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
  afdBindTableSort('afd-mun-table', 2);
  injectExportButtons();

  const afdBuildEscMap = () => {
    const mapEl = document.getElementById('afd-map-leaflet');
    if (!mapEl || !S.geo) return;
    const escData = afd.por_escola_2025 || [];
    const grp = document.getElementById('sel-afd-map-grupo')?.value || 'g1';
    const etapa = document.getElementById('sel-afd-map-etapa')?.value || 'fund_total';
    const ETAPA_LABELS = { fund_total: 'Fund.', fund_ai: 'Anos Iniciais', fund_af: 'Anos Finais', medio: 'Médio', eja_fund: 'EJA Fund.', eja_medio: 'EJA Médio' };
    const GRP_LABELS = { g1: 'G1', g2: 'G2', g3: 'G3', g4: 'G4', g5: 'G5' };

    destroyMap();
    S.map = L.map('afd-map-leaflet', { zoomControl: true, scrollWheelZoom: true, attributionControl: false })
      .setView([-29.7, -53.5], 6.5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', { maxZoom: 14 }).addTo(S.map);

    // Add polygon outline for RS
    L.geoJSON(S.geo, {
      style: { fillColor: '#f8f9fa', weight: 1, color: '#ccc', fillOpacity: 0.5 },
      interactive: false
    }).addTo(S.map);

    const info = L.control({ position: 'topright' });
    info.onAdd = function () { this._div = L.DomUtil.create('div', 'map-info-panel'); this.update(); return this._div; };
    info.update = function (props, md) {
      if (!props) { this._div.innerHTML = '<h4>Passe o mouse sobre uma escola</h4>'; return; }
      const etd = md?.[etapa];
      if (!etd) { this._div.innerHTML = `<h4 style="margin-bottom:2px">${props.nome}</h4><div style="color:#777;font-size:10px">${props.municipio}</div><div style="color:#999;font-size:11px;margin-top:6px">Sem dados AFD</div>`; return; }
      this._div.innerHTML = `
        <h4 style="margin-bottom:2px">${props.nome}</h4>
        <div style="color:#777;font-size:10px;margin-bottom:8px">${props.municipio}</div>
        ${['g1','g2','g3','g4','g5'].map(g => `<div class="info-row"><span class="info-label">${GRP_LABELS[g]} ${ETAPA_LABELS[etapa]}</span><span class="info-value" style="color:${AFD_GROUPS[g]?.color || '#333'}">${etd[g]?.toFixed(1) ?? '-'}%</span></div>`).join('')}
      `;
    };
    info.addTo(S.map);

    S.mapLayer = L.featureGroup().addTo(S.map);
    
    const coordsMap = {};
    if (S.escolasData && S.escolasData.escolas) {
      S.escolasData.escolas.forEach(e => {
        if (e.inep && e.lat && e.lng) coordsMap[e.inep] = { lat: e.lat, lng: e.lng, nome: e.nome, municipio: e.municipio };
      });
    }

    escData.forEach(md => {
      if (!md.cod_escola || !coordsMap[md.cod_escola]) return;
      const c = coordsMap[md.cod_escola];
      const v = md?.[etapa]?.[grp];
      if (v == null) return;
      
      const color = getAfdColor(v, grp);
      const marker = L.circleMarker([c.lat, c.lng], { radius: 4.5, fillColor: color, color: '#fff', weight: 1, fillOpacity: 0.85 });
      marker.on({
        mouseover: e => { e.target.setStyle({ weight: 2, radius: 6, fillOpacity: 1 }); info.update(c, md); },
        mouseout: e => { e.target.setStyle({ weight: 1, radius: 4.5, fillOpacity: 0.85 }); info.update(); }
      });
      marker.addTo(S.mapLayer);
    });

    const legend = L.control({ position: 'bottomleft' });
    legend.onAdd = function () {
      const div = L.DomUtil.create('div', 'map-legend');
      div.innerHTML = getAfdLegendHTML(grp, `% ${GRP_LABELS[grp]} ${ETAPA_LABELS[etapa]}`);
      return div;
    };
    legend.addTo(S.map);

    // Escola table
    const wrapper = document.getElementById('afd-table-wrapper');
    if (wrapper) {
      wrapper.innerHTML = `
        <div class="table-header">
          <h3>Tabela de Escolas — AFD</h3>
          <input type="text" class="table-search" id="afd-escola-search" placeholder="Buscar escola...">
        </div>
        <div style="max-height:400px;overflow-y:auto">
          <table class="data-table" id="afd-escola-table">
            <thead><tr>
              <th>#</th><th>INEP</th><th>Escola</th><th>Município</th>
              <th>G1</th><th>G2</th><th>G3</th><th>G4</th><th>G5</th>
            </tr></thead>
            <tbody></tbody>
          </table>
        </div>
        <div class="chart-source">${FONTE_AFD}</div>`;

      let escolas = escData.filter(md => md.cod_escola && coordsMap[md.cod_escola] && md[etapa] && md[etapa][grp] != null);
      if (S.munSel) escolas = escolas.filter(e => e.cod_mun === S.munSel);
      const creMuns = S.creSel ? getCreMuns(S.creSel) : null;
      if (creMuns) escolas = escolas.filter(e => creMuns.includes(e.cod_mun));
      escolas.sort((a, b) => (b[etapa]?.[grp] || 0) - (a[etapa]?.[grp] || 0));

      const tbody = wrapper.querySelector('tbody');
      tbody.innerHTML = escolas.map((e, i) => {
        const etd = e[etapa] || {};
        const v = etd[grp] || 0;
        return `<tr style="cursor:pointer" data-lat="${coordsMap[e.cod_escola].lat}" data-lng="${coordsMap[e.cod_escola].lng}">
          <td>${i+1}</td>
          <td>${e.cod_escola}</td>
          <td>${e.nome_escola}</td>
          <td>${e.nome_mun}</td>
          ${['g1','g2','g3','g4','g5'].map(gk => {
            const val = etd[gk] ?? 0;
            return `<td style="color:${AFD_GROUPS[gk].color};font-weight:${val >= 30 ? '700' : '400'}">${val.toFixed(0)}%</td>`;
          }).join('')}
        </tr>`;
      }).join('');

      tbody.querySelectorAll('tr').forEach(tr => {
        tr.addEventListener('click', () => {
          const lat = tr.dataset.lat, lng = tr.dataset.lng;
          if (lat && lng && S.map) S.map.setView([parseFloat(lat), parseFloat(lng)], 13);
        });
      });

      const searchEl = document.getElementById('afd-escola-search');
      if (searchEl) searchEl.addEventListener('input', ev => {
        const q = ev.target.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        tbody.querySelectorAll('tr').forEach(tr => {
          const text = tr.innerText.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          tr.style.display = text.includes(q) ? '' : 'none';
        });
      });

      // Re-bind table sort after recreating table HTML
      const table = document.getElementById('afd-escola-table');
      if (table) delete table.dataset.sortBound;
      afdBindTableSort('afd-escola-table', 4);
    }
  };

  // Bind AFD map layer toggle
  const afdBtnMun = document.getElementById('afd-btn-layer-mun');
  const afdBtnCre = document.getElementById('afd-btn-layer-cre');
  const afdBtnEsc = document.getElementById('afd-btn-layer-esc');

  const clearAfdMapBtns = () => [afdBtnMun, afdBtnCre, afdBtnEsc].forEach(b => b?.classList.remove('active'));

  if (afdBtnMun && afdBtnCre) {
    afdBtnMun.addEventListener('click', () => { clearAfdMapBtns(); afdBtnMun.classList.add('active'); afdBuildMap(); afdBuildMunTable(); });
    afdBtnCre.addEventListener('click', () => { clearAfdMapBtns(); afdBtnCre.classList.add('active'); afdBuildCreMap(); afdBuildMunTable(); });
    if (afdBtnEsc) {
      afdBtnEsc.addEventListener('click', () => { clearAfdMapBtns(); afdBtnEsc.classList.add('active'); afdBuildEscMap(); });
    }
  }

  const afdUpdateActiveMap = () => {
    if (afdBtnEsc?.classList.contains('active')) { afdBuildEscMap(); }
    else if (afdBtnCre?.classList.contains('active')) { afdBuildCreMap(); } 
    else { afdBuildMap(); }
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

const FONTE_TDI = 'Fonte: INEP — ' + fonteLink(URL_INDICADORES, 'Indicador de Distorção Idade-Série', 'Acessar a TDI / Indicadores Educacionais no portal INEP');

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
  const TDI_MET_LABELS = { tdi_fund: 'Fundamental', tdi_ai: 'Anos Iniciais', tdi_af: 'Anos Finais', tdi_med: 'Ensino Médio' };
  const getTdiMetrica = () => document.getElementById('tdi-map-metrica')?.value || 'tdi_fund';

  // Geo-aware display data
  const displayData = S.munSel
    ? (tdi.por_municipio?.[anoSel]?.[S.munSel] || st)
    : (S.creSel ? (() => {
        const creMuns = getCreMuns(S.creSel);
        const munYear = tdi.por_municipio?.[anoSel] || {};
        const agg = { tdi_fund: [], tdi_ai: [], tdi_af: [], tdi_med: [], n_escolas: 0 };
        const serieAgg = {};
        const locAgg = { urbana: { tdi_ai: [], tdi_af: [], tdi_med: [], tdi_fund: [] }, rural: { tdi_ai: [], tdi_af: [], tdi_med: [], tdi_fund: [] } };
        for (const cod of creMuns) {
          const m = munYear[cod]; if (!m) continue;
          if (m.tdi_fund != null) agg.tdi_fund.push(m.tdi_fund);
          if (m.tdi_ai != null) agg.tdi_ai.push(m.tdi_ai);
          if (m.tdi_af != null) agg.tdi_af.push(m.tdi_af);
          if (m.tdi_med != null) agg.tdi_med.push(m.tdi_med);
          agg.n_escolas += m.n_escolas || 0;
          // Aggregate per-series
          if (m.por_serie) {
            for (const [sk, sv] of Object.entries(m.por_serie)) {
              if (sv != null) { if (!serieAgg[sk]) serieAgg[sk] = []; serieAgg[sk].push(sv); }
            }
          }
          // Aggregate per-location
          if (m.por_loc) {
            for (const loc of ['urbana', 'rural']) {
              const ld = m.por_loc[loc];
              if (ld) { for (const k of ['tdi_ai','tdi_af','tdi_med','tdi_fund']) { if (ld[k] != null) locAgg[loc][k].push(ld[k]); } }
            }
          }
        }
        const med = arr => arr.length ? +(arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1) : null;
        const result = { tdi_fund: med(agg.tdi_fund), tdi_ai: med(agg.tdi_ai), tdi_af: med(agg.tdi_af), tdi_med: med(agg.tdi_med), n_escolas: agg.n_escolas };
        // Build aggregated por_serie
        const ps = {};
        for (const [sk, arr] of Object.entries(serieAgg)) { ps[sk] = med(arr); }
        if (Object.keys(ps).length) result.por_serie = ps;
        // Build aggregated por_loc
        const pl = {};
        for (const loc of ['urbana', 'rural']) {
          const ld = locAgg[loc];
          const vals = { tdi_ai: med(ld.tdi_ai), tdi_af: med(ld.tdi_af), tdi_med: med(ld.tdi_med), tdi_fund: med(ld.tdi_fund) };
          if (Object.values(vals).some(v => v != null)) pl[loc] = vals;
        }
        if (Object.keys(pl).length) result.por_loc = pl;
        return result;
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
        <div class="chart-title" id="tdi-evol-title">Taxa de Distorção Idade-Série — Evolução${geoSuffix()}</div>
        <p style="font-size:10px;color:#777;margin:4px 0 2px;font-style:italic">💡 Clique na legenda para ocultar/exibir etapas</p>
        <div style="height:300px"><canvas id="tdi-chart-evol"></canvas></div>
        <div class="chart-source">${FONTE_TDI}</div>
      </div>
    </div>

    <!-- ═══ EIXO: Desagregações ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/politicas.png" alt=""></span>
      <span class="section-divider-text">Desagregações — ${anoSel}</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title" id="tdi-serie-title">TDI por Série — ${anoSel}${geoSuffix()}</div>
        <div style="height:340px"><canvas id="tdi-chart-serie"></canvas></div>
        <div class="chart-source">${FONTE_TDI}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title" id="tdi-loc-title">TDI Urbana vs Rural — ${anoSel}${geoSuffix()}</div>
        <div style="height:340px"><canvas id="tdi-chart-loc"></canvas></div>
        <div class="chart-source">${FONTE_TDI}</div>
      </div>
    </div>

    <!-- ═══ EIXO: Distribuição Territorial ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/territorial.png" alt=""></span>
      <span class="section-divider-text">${territorialDividerText()}</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="map-table-row d1">
      <div class="map-container">
        <div class="map-toolbar">
          <h3>Mapa — TDI <span id="tdi-map-metrica-label">Fundamental</span> <span id="tdi-map-ano">${anoSel}</span></h3>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <select id="tdi-map-metrica" class="map-select" style="font-size:11px;padding:4px 8px;border-radius:6px;border:1px solid #ddd;background:#fff;cursor:pointer;font-family:Inter">
              <option value="tdi_fund">Fundamental</option>
              <option value="tdi_ai">Anos Iniciais</option>
              <option value="tdi_af">Anos Finais</option>
              <option value="tdi_med">Ensino Médio</option>
            </select>
            <div class="map-layer-toggle">
              <button class="map-layer-btn active" id="tdi-btn-layer-mun">Municípios</button>
              <button class="map-layer-btn" id="tdi-btn-layer-cre">CREs</button>
              ${S.escolasData && S.redeSel === 'estadual' ? '<button class="map-layer-btn" id="tdi-btn-layer-escola">Escolas</button>' : ''}
            </div>
          </div>
        </div>
        <div id="tdi-map-leaflet" style="height:380px;border-radius:8px"></div>
      </div>
      <div class="table-wrapper" id="tdi-table-wrapper">
        <div class="table-header">
          <h3 id="tdi-table-title">Tabela de Municípios — TDI</h3>
          <input type="text" class="table-search" id="tdi-mun-search" placeholder="Buscar...">
        </div>
        <div style="font-size:10px;color:var(--accent);padding:4px 12px 6px;font-weight:600;background:rgba(255,203,4,.08);border-radius:0 0 6px 6px;border-top:1px dashed rgba(255,203,4,.3)">
          📍 Clique em qualquer município — na tabela ou no mapa — para filtrar <strong>todas as visualizações</strong> desta seção.
        </div>
        <div style="max-height:400px;overflow-y:auto" id="tdi-table-scroll">
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

  // ── Chart 2: TDI by Grade/Série (horizontal bar) ──
  const serieEl = document.getElementById('tdi-chart-serie');
  if (serieEl) {
    const porSerie = displayData.por_serie || {};
    const SERIE_LABELS = {
      f1: '1º ano', f2: '2º ano', f3: '3º ano', f4: '4º ano', f5: '5º ano',
      f6: '6º ano', f7: '7º ano', f8: '8º ano', f9: '9º ano',
      m1: '1ª EM', m2: '2ª EM', m3: '3ª EM', m4: '4ª EM',
    };
    const SERIE_COLORS = {
      f1: '#4FC3F7', f2: '#29B6F6', f3: '#03A9F4', f4: '#039BE5', f5: '#0288D1',
      f6: '#0277BD', f7: '#01579B', f8: '#0D47A1', f9: '#1A237E',
      m1: '#FF7043', m2: '#F4511E', m3: '#E64A19', m4: '#BF360C',
    };
    const serieKeys = Object.keys(SERIE_LABELS);
    const serieData = serieKeys.map(k => porSerie[k] ?? null);
    const serieColors = serieKeys.map(k => SERIE_COLORS[k]);
    const hasData = serieData.some(v => v !== null);

    if (hasData) {
      S.charts.push(new Chart(serieEl, {
        type: 'bar',
        data: {
          labels: serieKeys.map(k => SERIE_LABELS[k]),
          datasets: [{
            label: 'TDI (%)',
            data: serieData,
            backgroundColor: serieColors.map(c => c + 'CC'),
            borderColor: serieColors,
            borderWidth: 1.5,
            borderRadius: 4,
          }]
        },
        options: {
          ...CHART_DEFAULTS,
          indexAxis: 'y',
          plugins: {
            ...CHART_DEFAULTS.plugins,
            legend: { display: false },
            datalabels: {
              display: (ctx) => ctx.dataset.data[ctx.dataIndex] != null,
              anchor: 'end', align: 'right', offset: 4,
              font: { family: 'Inter', size: 10, weight: '700' },
              color: '#333',
              formatter: v => v != null ? v.toFixed(1) + '%' : '',
            }
          },
          scales: {
            ...CHART_DEFAULTS.scales,
            x: { ...CHART_DEFAULTS.scales.x, beginAtZero: true, suggestedMax: 40, ticks: { callback: v => v + '%' } },
            y: { ...CHART_DEFAULTS.scales.y, ticks: { font: { size: 11, weight: '600' } } },
          }
        }
      }));
    } else {
      serieEl.parentElement.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:300px;color:#888;font-size:12px;text-align:center;gap:6px"><span style="font-size:20px">📋</span><span>Desagregação por série<br>disponível apenas a partir de <strong>2019</strong></span></div>`;
    }
  }

  // ── Chart 3: TDI Urbana vs Rural (grouped bars by etapa) ──
  const locEl = document.getElementById('tdi-chart-loc');
  if (locEl) {
    const porLoc = displayData.por_loc || {};
    const urbana = porLoc.urbana || {};
    const rural = porLoc.rural || {};
    const hasLocData = Object.keys(porLoc).length > 0;

    if (hasLocData) {
      const etapas = ['Anos Iniciais', 'Anos Finais', 'Ens. Médio'];
      const etapaKeys = ['tdi_ai', 'tdi_af', 'tdi_med'];
      S.charts.push(new Chart(locEl, {
        type: 'bar',
        data: {
          labels: etapas,
          datasets: [
            {
              label: 'Urbana',
              data: etapaKeys.map(k => urbana[k] ?? null),
              backgroundColor: '#42A5F5CC',
              borderColor: '#1E88E5',
              borderWidth: 1.5,
              borderRadius: 4,
            },
            {
              label: 'Rural',
              data: etapaKeys.map(k => rural[k] ?? null),
              backgroundColor: '#66BB6ACC',
              borderColor: '#43A047',
              borderWidth: 1.5,
              borderRadius: 4,
            },
          ]
        },
        options: {
          ...CHART_DEFAULTS,
          plugins: {
            ...CHART_DEFAULTS.plugins,
            legend: { display: true, labels: { font: { family: 'Inter', size: 11, weight: '600' }, boxWidth: 12, padding: 10 } },
            datalabels: {
              display: (ctx) => ctx.dataset.data[ctx.dataIndex] != null,
              anchor: 'end', align: 'top', offset: 4,
              font: { family: 'Inter', size: 11, weight: '700' },
              color: '#333',
              formatter: v => v != null ? v.toFixed(1) + '%' : '',
            }
          },
          scales: {
            ...CHART_DEFAULTS.scales,
            y: { ...CHART_DEFAULTS.scales.y, beginAtZero: true, suggestedMax: 40, ticks: { callback: v => v + '%' }, grace: '15%' },
          }
        }
      }));
    } else {
      locEl.parentElement.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:300px;color:#888;font-size:12px;text-align:center;gap:6px"><span style="font-size:20px">📋</span><span>Desagregação Urbana vs Rural<br>disponível apenas a partir de <strong>2019</strong></span></div>`;
    }
  }

  // ── Map: TDI by municipality ──
  const TDI_MAP_BREAKS = [
    { min: 0,   max: 5,  color: '#2874A6', label: '< 5% (Excelente)' },
    { min: 5,   max: 10, color: '#66BB6A', label: '5–10%' },
    { min: 10,  max: 15, color: '#FFCB04', label: '10–15%' },
    { min: 15,  max: 20, color: '#FB8C00', label: '15–20%' },
    { min: 20,  max: 101, color: '#E53935', label: '> 20% (Crítico)' },
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
    const metrica = getTdiMetrica();
    const metLabel = TDI_MET_LABELS[metrica];

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
      const _tdiR = (lbl, key) => { const v = md[key]; const sel = key === metrica; return '<div class="info-row"><span class="info-label"' + (sel ? ' style="font-weight:700"' : '') + '>' + lbl + '</span><span class="info-value" style="color:' + getTdiColor(v||0) + ';' + (sel ? 'font-weight:700;font-size:13px' : '') + '">' + (v != null ? v.toFixed(1) + '%' : '—') + '</span></div>'; };
      this._div.innerHTML = `
        <h4>${nome}</h4>
        ${_tdiR('TDI Fund.','tdi_fund')}
        ${_tdiR('TDI Anos Iniciais','tdi_ai')}
        ${_tdiR('TDI Anos Finais','tdi_af')}
        ${_tdiR('TDI Médio','tdi_med')}
        <div class="info-row"><span class="info-label">Escolas</span><span class="info-value">${md.n_escolas || '—'}</span></div>
      `;
    };
    info.addTo(S.map);

    S.mapLayer = L.geoJSON(S.geo, {
      style: feature => {
        const cod = feature.properties.cod_mun?.substring(0, 7);
        const md = munData[cod];
        const v = md?.[metrica] ?? -1;
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
      div.innerHTML = '<h4>TDI ' + metLabel + ' (%)</h4>' +
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
    const metrica = getTdiMetrica();
    const metLabel = TDI_MET_LABELS[metrica];
    const munToCre = S.creLookup?.mun_to_cre || {};
    const munData = tdi.por_municipio[anoSel] || {};
    const creData = {};
    for (const [cod, v] of Object.entries(munData)) {
      const cre = munToCre[cod]?.cod_cre;
      if (!cre) continue;
      if (!creData[cre]) creData[cre] = { sum: 0, count: 0, nome: munToCre[cod]?.nome_cre || cre };
      if (v[metrica] != null) { creData[cre].sum += v[metrica]; creData[cre].count++; }
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
        layer.bindTooltip(`<strong>${nome}</strong><br>TDI ${metLabel}: ${d?.avg?.toFixed(1) ?? '—'}%<br>${d?.count || 0} municípios`, { sticky: true });
        layer.on('click', () => { S.creSel = cod; const selCre = document.getElementById('sel-cre'); if (selCre) selCre.value = cod; populateMunDropdown(cod); refreshActiveTab(); });
      }
    }).addTo(S.map);

    const creLegend = L.control({ position: 'bottomleft' });
    creLegend.onAdd = function () {
      const div = L.DomUtil.create('div', 'map-legend');
      div.innerHTML = '<h4>TDI ' + metLabel + ' (CREs)</h4>' +
        TDI_MAP_BREAKS.slice().reverse().map(b => `<div class="map-legend-row"><div class="map-legend-swatch" style="background:${b.color}"></div><span>${b.label}</span></div>`).join('');
      return div;
    };
    creLegend.addTo(S.map);
    S.mapLegend = creLegend;
  };

  // ── Table ──
  let tdiSortCol = 'tdi_fund', tdiSortAsc = false;
  const tdiBuildMunTable = () => {
    const titleEl = document.getElementById('tdi-table-title');
    if (titleEl) titleEl.textContent = 'Tabela de Municípios — TDI';
    const searchInput = document.getElementById('tdi-mun-search');
    if (searchInput) { searchInput.value = ''; searchInput.placeholder = 'Buscar...'; }
    // Restore original table structure if escola replaced it
    const scrollEl = document.getElementById('tdi-table-scroll');
    if (scrollEl && !scrollEl.querySelector('#tdi-mun-table tbody')) {
      scrollEl.innerHTML = `
        <table class="data-table" id="tdi-mun-table">
          <thead><tr>
            <th style="cursor:pointer" data-sort-key="rank"># ↕</th><th style="cursor:pointer" data-sort-key="nome">Município ↕</th><th style="cursor:pointer" data-sort-key="n_escolas">Esc. ↕</th>
            <th style="cursor:pointer" data-sort-key="tdi_fund">Fund. ↕</th><th style="cursor:pointer" data-sort-key="tdi_ai">AI ↕</th><th style="cursor:pointer" data-sort-key="tdi_af">AF ↕</th><th style="cursor:pointer" data-sort-key="tdi_med">Médio ↕</th>
          </tr></thead>
          <tbody></tbody>
        </table>`;
    }
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
  // ── School map builder (reuses tdi-map-leaflet container) ──
  const tdiBuildEscolaMap = () => {
    if (!S.escolasData) return;
    destroyMap();
    const mapEl = document.getElementById('tdi-map-leaflet');
    if (!mapEl) return;
    const metrica = getTdiMetrica();
    const metLabel = TDI_MET_LABELS[metrica];
    const ed = S.escolasData;
    let escolas = ed.escolas || [];
    if (S.creSel) escolas = escolas.filter(e => e.cre === S.creSel);
    if (S.munSel) escolas = escolas.filter(e => e.cod_mun === S.munSel);
    const withCoords = escolas.filter(e => e.lat && e.lng && e[metrica] != null);

    S.map = L.map('tdi-map-leaflet', { zoomControl: true, scrollWheelZoom: true, attributionControl: false })
      .setView([-29.7, -53.5], 6.5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', { maxZoom: 14 }).addTo(S.map);

    const markers = L.featureGroup();
    withCoords.forEach(e => {
      const tdiVal = e[metrica] || 0;
      const marker = L.circleMarker([e.lat, e.lng], {
        radius: 4, fillColor: getTdiColor(tdiVal), color: '#fff', weight: 1, fillOpacity: 0.85,
      });
      const fmtTdi = v => v != null ? v.toFixed(1) + '%' : '—';
      marker.bindPopup(`
        <div style="font-family:Inter;min-width:220px">
          <strong style="font-size:12px">${e.nome}</strong><br>
          <span style="font-size:10px;color:#666">${e.municipio || ''} — INEP: ${e.inep}</span>
          <hr style="margin:4px 0;border:none;border-top:1px solid #eee">
          <div style="font-size:10px;display:grid;grid-template-columns:1fr 1fr;gap:2px">
            <span${metrica==='tdi_fund'?' style="font-weight:800"':''}>TDI Fund.: <b style="color:${getTdiColor(e.tdi_fund||0)}">${fmtTdi(e.tdi_fund)}</b></span>
            <span${metrica==='tdi_ai'?' style="font-weight:800"':''}>TDI AI: <b style="color:${getTdiColor(e.tdi_ai||0)}">${fmtTdi(e.tdi_ai)}</b></span>
            <span${metrica==='tdi_af'?' style="font-weight:800"':''}>TDI AF: <b style="color:${getTdiColor(e.tdi_af||0)}">${fmtTdi(e.tdi_af)}</b></span>
            <span${metrica==='tdi_med'?' style="font-weight:800"':''}>TDI Médio: <b style="color:${getTdiColor(e.tdi_med||0)}">${fmtTdi(e.tdi_med)}</b></span>
          </div>
        </div>
      `);
      marker.addTo(markers);
    });
    markers.addTo(S.map);
    if (withCoords.length) S.map.fitBounds(markers.getBounds().pad(0.05));

    // Legend
    S.mapLegend = L.control({ position: 'bottomright' });
    S.mapLegend.onAdd = function () {
      const div = L.DomUtil.create('div', 'map-legend');
      div.innerHTML = '<strong style="font-size:10px">TDI ' + metLabel + '</strong>' +
        TDI_MAP_BREAKS.map(b => `<div style="display:flex;align-items:center;gap:4px;font-size:9px"><span style="width:12px;height:12px;border-radius:50%;background:${b.color};display:inline-block"></span>${b.label}</div>`).join('');
      return div;
    };
    S.mapLegend.addTo(S.map);

    // Update table
    const tableCont = document.getElementById('desig-table-container');
    const tableBody = document.querySelector('#desig-table tbody');
    if (isEsc && tableCont && tableBody) {
      tableCont.style.display = 'block';
      
      const escRows = [];
      const escolasLookup = yearData.escolas_lookup || S._universalEscolaLookup || {};
      for (const [codEsc, escData] of Object.entries(yearData.por_escola || {})) {
        const kData = escData?.geral?.[key];
        if (kData?.media != null) {
          const mRaca = escData?.dimensoes?.raca || {};
          const mSexo = escData?.dimensoes?.sexo || {};
          escRows.push({
            nome: escolasLookup[codEsc]?.nome || codEsc,
            media: kData.media,
            branca: mRaca['Branca']?.[key]?.media,
            preta: mRaca['Preta']?.[key]?.media,
            parda: mRaca['Parda']?.[key]?.media,
            fem: mSexo['Feminino']?.[key]?.media,
            masc: mSexo['Masculino']?.[key]?.media
          });
        }
      }
      escRows.sort((a, b) => (b.media || 0) - (a.media || 0));

      tableBody.innerHTML = escRows.map(d => `
        <tr>
          <td style="text-align:left;font-weight:500">${d.nome}</td>
          <td style="text-align:right;font-weight:600;color:var(--pri)">${d.media != null ? d.media.toFixed(1) : '-'}</td>
          <td style="text-align:right;color:#1d71b9">${d.branca != null ? d.branca.toFixed(1) : '-'}</td>
          <td style="text-align:right;color:#333">${d.preta != null ? d.preta.toFixed(1) : '-'}</td>
          <td style="text-align:right;color:#FFCB04">${d.parda != null ? d.parda.toFixed(1) : '-'}</td>
          <td style="text-align:right;color:#E91E63">${d.fem != null ? d.fem.toFixed(1) : '-'}</td>
          <td style="text-align:right;color:#1d71b9">${d.masc != null ? d.masc.toFixed(1) : '-'}</td>
        </tr>
      `).join('');
    } else if (tableCont) {
      tableCont.style.display = 'none';
    }
  };

  // ── School table builder (reuses tdi-mun-table container) ──
  const tdiBuildEscolaTable = () => {
    if (!S.escolasData) return;
    const titleEl = document.getElementById('tdi-table-title');
    if (titleEl) titleEl.textContent = 'Tabela de Escolas — TDI';
    const searchEl = document.getElementById('tdi-mun-search');
    if (searchEl) { searchEl.value = ''; searchEl.placeholder = 'Buscar escola...'; }

    const ed = S.escolasData;
    let escolas = ed.escolas || [];
    if (S.creSel) escolas = escolas.filter(e => e.cre === S.creSel);
    if (S.munSel) escolas = escolas.filter(e => e.cod_mun === S.munSel);

    const metrica = getTdiMetrica();
    const escolasSorted = [...escolas].filter(e => e[metrica] != null);
    let sortCol = metrica, sortAsc = false; // default: highest TDI first
    escolasSorted.sort((a, b) => (b[metrica] || 0) - (a[metrica] || 0));

    const scrollEl = document.getElementById('tdi-table-scroll');
    if (!scrollEl) return;
    const fmtV = v => v != null ? v.toFixed(1) + '%' : '—';

    const cols = [
      { key: 'rank', label: '#' },
      { key: 'nome', label: 'Escola' },
      { key: 'municipio', label: 'Município' },
      { key: 'tdi_fund', label: 'Fund.' },
      { key: 'tdi_ai', label: 'AI' },
      { key: 'tdi_af', label: 'AF' },
      { key: 'tdi_med', label: 'Médio' },
    ];

    const renderRows = () => {
      const tbody = scrollEl.querySelector('tbody');
      if (!tbody) return;
      tbody.innerHTML = escolasSorted.map((e, i) => `
        <tr>
          <td>${i + 1}</td>
          <td style="font-size:10px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${e.nome}">${e.nome}</td>
          <td style="font-size:10px">${e.municipio || ''}</td>
          <td style="color:${getTdiColor(e.tdi_fund||0)};font-weight:700">${fmtV(e.tdi_fund)}</td>
          <td style="color:${getTdiColor(e.tdi_ai||0)};font-weight:700">${fmtV(e.tdi_ai)}</td>
          <td style="color:${getTdiColor(e.tdi_af||0)};font-weight:700">${fmtV(e.tdi_af)}</td>
          <td style="color:${getTdiColor(e.tdi_med||0)};font-weight:700">${fmtV(e.tdi_med)}</td>
        </tr>
      `).join('');
    };

    scrollEl.innerHTML = `
      <table class="data-table" id="tdi-mun-table">
        <thead><tr>
          ${cols.map(c => `<th style="cursor:pointer" data-col="${c.key}">${c.label} ${c.key === sortCol ? (sortAsc ? '▲' : '▼') : '↕'}</th>`).join('')}
        </tr></thead>
        <tbody></tbody>
      </table>`;
    renderRows();

    // Sortable headers
    scrollEl.querySelectorAll('th[data-col]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.col;
        if (key === 'rank') return;
        if (sortCol === key) sortAsc = !sortAsc;
        else { sortCol = key; sortAsc = (key === 'nome' || key === 'municipio'); }
        escolasSorted.sort((a, b) => {
          const va = key === 'nome' || key === 'municipio' ? (a[key] || '') : (a[key] ?? -1);
          const vb = key === 'nome' || key === 'municipio' ? (b[key] || '') : (b[key] ?? -1);
          const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
          return sortAsc ? cmp : -cmp;
        });
        renderRows();
        scrollEl.querySelectorAll('th[data-col]').forEach(h => {
          const k = h.dataset.col;
          const base = cols.find(c => c.key === k)?.label || '';
          h.textContent = base + ' ' + (k === sortCol ? (sortAsc ? '▲' : '▼') : '↕');
        });
      });
    });

    // Re-bind search for escola mode
    if (searchEl) {
      searchEl.addEventListener('input', () => {
        const q = searchEl.value.toLowerCase();
        scrollEl.querySelectorAll('tbody tr').forEach(tr => {
          const nome = (tr.children[1]?.textContent || '').toLowerCase();
          const mun = (tr.children[2]?.textContent || '').toLowerCase();
          tr.style.display = (nome.includes(q) || mun.includes(q)) ? '' : 'none';
        });
      });
    }
  };

  // Build everything
  tdiBuildMap();
  tdiBuildMunTable();
  injectExportButtons();

  // Bind map layer toggle (Municípios / CREs / Escolas)
  const tdiBtnMun = document.getElementById('tdi-btn-layer-mun');
  const tdiBtnCre = document.getElementById('tdi-btn-layer-cre');
  const tdiBtnEsc = document.getElementById('tdi-btn-layer-escola');
  const tdiToggleBtns = [tdiBtnMun, tdiBtnCre, tdiBtnEsc].filter(Boolean);
  const tdiSetActive = (btn) => tdiToggleBtns.forEach(b => b.classList.toggle('active', b === btn));

  if (tdiBtnMun) {
    tdiBtnMun.addEventListener('click', () => { tdiSetActive(tdiBtnMun); tdiBuildMap(); tdiBuildMunTable(); });
  }
  if (tdiBtnCre) {
    tdiBtnCre.addEventListener('click', () => { tdiSetActive(tdiBtnCre); tdiBuildCreMap(); tdiBuildMunTable(); });
  }
  if (tdiBtnEsc) {
    tdiBtnEsc.addEventListener('click', () => {
      tdiSetActive(tdiBtnEsc);
      tdiBuildEscolaMap();
      tdiBuildEscolaTable();
    });
  }

  // Bind TDI metric dropdown change
  const tdiMetricSel = document.getElementById('tdi-map-metrica');
  if (tdiMetricSel) {
    tdiMetricSel.addEventListener('change', () => {
      const label = tdiMetricSel.options[tdiMetricSel.selectedIndex]?.text || 'Fundamental';
      const titleEl = document.getElementById('tdi-map-metrica-label');
      if (titleEl) titleEl.textContent = label;
      if (tdiBtnEsc?.classList.contains('active')) { tdiBuildEscolaMap(); tdiBuildEscolaTable(); }
      else if (tdiBtnCre?.classList.contains('active')) { tdiBuildCreMap(); }
      else { tdiBuildMap(); }
    });
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

      if (view === 'home') {
        S.pendingView = null;
        renderHome();
        return;
      }

      if (view === 'dados') {
        S.pendingView = null;
        document.body.classList.remove('sidebar-hidden');
        renderDados();
        return;
      }

      if (!S.loaded) {
        S.pendingView = view;
        const main = document.getElementById('main-content');
        destroyCharts();
        destroyMap();
        document.body.classList.remove('sidebar-hidden');
        main.innerHTML = `
          <div class="loading" id="loading">
            <div class="spinner"></div>
            <span>Carregando dados do Censo Escolar...</span>
          </div>
        `;
        return;
      }

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
      else if (view === 'desigualdades') { ensureDesig(); }
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
      : S.creSel
        ? anos.map(a => aggregateCre(d, a, S.creSel).esp_total || 0)
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
    } else if (S.creSel) {
      const agg = aggregateCre(d, anoSel, S.creSel);
      cc = agg.esp_cc || 0;
      ce = agg.esp_ce || 0;
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
    { key: 'agregado', label: 'Fund. + Médio', color: '#14507F' },
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
    } else {
      // Aggregate locdif from all municipalities in current rede data
      const munData = d.por_municipio?.[pmUltimo] || {};
      const agg = { locdif_terra_indigena_mat: 0, locdif_quilombola_mat: 0, locdif_assentamento_mat: 0 };
      for (const m of Object.values(munData)) {
        agg.locdif_terra_indigena_mat += m.locdif_terra_indigena_mat || 0;
        agg.locdif_quilombola_mat += m.locdif_quilombola_mat || 0;
        agg.locdif_assentamento_mat += m.locdif_assentamento_mat || 0;
      }
      src = agg;
      labelAno = pmUltimo;
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
      datasets = [
        {
          label: 'Ed. Profissional',
          data: profData,
          borderColor: COLORS.pri,
          backgroundColor: COLORS.pri + '22',
          fill: true, tension: 0.3, pointRadius: 3, borderWidth: 2.5,
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
  const CRE_SCALE = ['#c7dbed', '#8fb8da', '#5a96c7', '#3578b3', '#14507F'];
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
  const main = document.getElementById('main-content');
  if (!main) return;

  // Remove old delegated handler to avoid duplicates
  if (bindTopbarFilters._handler) {
    main.removeEventListener('change', bindTopbarFilters._handler);
  }

  // Single delegated change handler for all topbar selects
  bindTopbarFilters._handler = function(e) {
    const t = e.target;
    if (t.id === 'sel-ano') {
      S.anoSel = t.value;
      refreshActiveTab();
    } else if (t.id === 'sel-cre') {
      S.creSel = t.value || null;
      S.munSel = null;
      const mi = document.getElementById('mun-search-input');
      if (mi) mi.value = '';
      populateMunDropdown(S.creSel);
      refreshActiveTab();
    }
  };
  main.addEventListener('change', bindTopbarFilters._handler);

  // Searchable municipality dropdown (click delegation)
  const munInput = document.getElementById('mun-search-input');
  const munList = document.getElementById('mun-dropdown-list');

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
      const selMun = document.getElementById('sel-mun');
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

  // Sidebar mobile events (register only once since these elements persist)
  if (!bindTopbarFilters._sidebarMobileEventsRegistered) {
    bindTopbarFilters._sidebarMobileEventsRegistered = true;
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar && overlay) {
      overlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('visible');
      });
      document.querySelectorAll('.sidebar-tab, .sidebar-brand').forEach(tab => {
        tab.addEventListener('click', () => {
          sidebar.classList.remove('open');
          overlay.classList.remove('visible');
        });
      });
    }
  }
}

function refreshActiveTab() {
  const view = S._currentView;
  if (!view) return;
  // Highlight the correct sidebar tab
  document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
  const activeTab = document.querySelector(`.sidebar-tab[data-view="${view}"]`);
  if (activeTab) activeTab.classList.add('active');
  // Render directly (avoids .click() which can trigger initNav reset logic)
  if (view === 'home') renderHome();
  else if (view === 'dados') renderDados();
  else if (view === 'acesso' && S.data) renderAcesso();
  else if (view === 'fluxo') renderFluxo();
  else if (view === 'infra' && S.infra) renderInfra();
  else if (view === 'docencia' && S.doc) renderDocencia();
  else if (view === 'saeb') renderSaeb();
  else if (view === 'saers' && S.saersData) renderSaers();
  else if (view === 'ideb') renderIdeb();
  else if (view === 'inse') renderInse();
  else if (view === 'icg') renderIcg();
  else if (view === 'afd') renderAfd();
  else if (view === 'tdi') renderTdi();
  else if (view === 'desigualdades') ensureDesig();
  else if (view === 'escola') renderEscola();
}


// ══════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════
// DESIGUALDADES EDUCACIONAIS (SAERS)
// ══════════════════════════════════════════════════════════

/**
 * Carrega sob demanda o arquivo grande de Desigualdades (~100 MB) e então renderiza.
 * Evita travar o boot do painel (esse arquivo é servido lentamente no GitHub Pages).
 */
async function ensureDesig() {
  if (S.desig) { renderDesigualdades(); return; }
  if (S._desigLoading) return;
  S._desigLoading = true;
  const main = document.getElementById('main-content');
  if (main) {
    main.innerHTML = `
      <div class="loading">
        <div class="spinner"></div>
        <span>Carregando dados de Desigualdades (arquivo grande, pode levar alguns segundos)...</span>
      </div>`;
  }
  try {
    const resp = await fetch('dados/4_11_desigualdades.json?_cb=' + Date.now());
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    S.desig = await resp.json();
    renderDesigualdades();
  } catch (err) {
    if (main) {
      main.innerHTML = `
        <div class="loading" style="color:#C62828;text-align:center;padding:40px">
          <span>Não foi possível carregar os dados de Desigualdades.<br>${err.message}</span>
          <button onclick="ensureDesig()" style="margin-top:14px;padding:8px 18px;border-radius:6px;border:1px solid #C62828;background:#fff;color:#C62828;cursor:pointer;font-weight:600">Tentar novamente</button>
        </div>`;
    }
  } finally {
    S._desigLoading = false;
  }
}

function renderDesigualdades() {
  const main = document.getElementById('main-content');
  destroyCharts(); destroyMap();
  document.body.classList.remove('sidebar-hidden');

  const dd = S.desig;
  if (!dd) { ensureDesig(); return; }

  const meta = dd.metadata;
  const anos = dd.anos.map(a => a.ano);
  const ETAPA_LABELS = meta.etapa_labels;
  const ETAPAS = Object.keys(ETAPA_LABELS);
  const FONTE = 'Fonte: ' + meta.fonte;
  const defaultEtapa = ETAPAS.includes('5_EF') ? '5_EF' : ETAPAS[0];

  const anoSel0 = S.anoSel ? parseInt(S.anoSel) : anos[anos.length - 1];
  S.anoSel = String(anoSel0);

  main.innerHTML = `
    <div class="section-sticky">
      ${sectionBanner('img/icons/nav_desigualdades.png', 'Desigualdades Educacionais', geoSuffix('Desigualdades no desempenho por recortes sociodemográficos — SAERS'))}

      <div class="kpi-strip" style="position:relative" id="desig-kpis"></div>
    </div>

    <!-- ═══ BLOCO INFORMATIVO ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/nav_desigualdades.png" alt=""></span>
      <span class="section-divider-text">Sobre esta Se\u00e7\u00e3o</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="chart-card" style="padding:0;overflow:hidden;border:1px solid rgba(13,59,102,.08)">
      <div style="display:grid;grid-template-columns:1fr 1fr">
        <div style="padding:20px 24px;background:linear-gradient(135deg,#f6f9fc 0%,#eef2f7 100%)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
            <img src="img/icons/nav_desigualdades.png" alt="" style="width:20px;height:20px">
            <span style="font-size:14px;font-weight:700;color:var(--pri)">Desigualdades Educacionais</span>
          </div>
          <p style="font-size:11.5px;margin:0 0 16px;color:#333;line-height:1.75">
            Esta se\u00e7\u00e3o analisa os <strong>desigualdades no desempenho</strong> entre grupos sociodemogr\u00e1ficos
            a partir dos <strong>microdados do SAERS</strong> (Sistema de Avalia\u00e7\u00e3o do Rendimento Escolar do RS).
            S\u00e3o investigadas <strong>7 dimens\u00f5es de desigualdade</strong>: ra\u00e7a/cor, sexo, localiza\u00e7\u00e3o
            (urbana/rural), defici\u00eancia, turno, CRE e intersec\u00e7\u00f5es.
          </p>
          <div style="background:rgba(255,203,4,.1);border:1px solid rgba(255,203,4,.25);border-radius:6px;padding:10px 14px">
            <p style="font-size:11px;margin:0;color:#5D4037;line-height:1.7">
              <strong style="color:#E65100">\u26A0 Nota:</strong> O <strong>2\u00ba ano do Ensino Fundamental</strong>
              n\u00e3o possui dados de ra\u00e7a e sexo, pois o question\u00e1rio contextual do SAERS n\u00e3o \u00e9
              aplicado a esta faixa et\u00e1ria.
            </p>
          </div>
        </div>
        <div style="padding:20px 24px;border-left:1px solid rgba(13,59,102,.06)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
            <img src="img/icons/sec_saeb.png" alt="" style="width:20px;height:20px">
            <span style="font-size:14px;font-weight:700;color:var(--pri)">Dados Utilizados</span>
          </div>
          <p style="font-size:11.5px;margin:0 0 14px;color:#333;line-height:1.75">
            Os dados foram extra\u00eddos dos <strong>microdados individuais do SAERS</strong> de
            <strong>${anos[0]} a ${anos[anos.length-1]}</strong>, totalizando mais de
            <strong>2,6 milh\u00f5es</strong> de registros de alunos avaliados em
            <strong>L\u00edngua Portuguesa</strong> e <strong>Matem\u00e1tica</strong>.
          </p>
          <table style="width:100%;font-size:10px;border-collapse:separate;border-spacing:0;margin-bottom:10px">
            <thead>
              <tr>
                <th style="padding:6px 8px;text-align:left;background:#f0f4f8;border-bottom:2px solid #ddd;font-weight:700;color:#333">Dimens\u00e3o</th>
                <th style="padding:6px 8px;text-align:left;background:#f0f4f8;border-bottom:2px solid #ddd;font-weight:700;color:#333">Recortes</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style="padding:5px 8px;border-bottom:1px solid #eee"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#1d71b9;margin-right:5px;vertical-align:middle"></span><strong>Ra\u00e7a/Cor</strong></td><td style="padding:5px 8px;border-bottom:1px solid #eee;color:#555">Branca, Parda, Preta, Ind\u00edgena, Amarela</td></tr>
              <tr style="background:#fafbfc"><td style="padding:5px 8px;border-bottom:1px solid #eee"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#E91E63;margin-right:5px;vertical-align:middle"></span><strong>Sexo</strong></td><td style="padding:5px 8px;border-bottom:1px solid #eee;color:#555">Feminino, Masculino</td></tr>
              <tr><td style="padding:5px 8px;border-bottom:1px solid #eee"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#43A047;margin-right:5px;vertical-align:middle"></span><strong>Localiza\u00e7\u00e3o</strong></td><td style="padding:5px 8px;border-bottom:1px solid #eee;color:#555">Urbana, Rural</td></tr>
              <tr style="background:#fafbfc"><td style="padding:5px 8px;border-bottom:1px solid #eee"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#E53935;margin-right:5px;vertical-align:middle"></span><strong>Defici\u00eancia</strong></td><td style="padding:5px 8px;border-bottom:1px solid #eee;color:#555">Com, Sem</td></tr>
              <tr><td style="padding:5px 8px;border-bottom:1px solid #eee"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#F57C00;margin-right:5px;vertical-align:middle"></span><strong>Turno</strong></td><td style="padding:5px 8px;border-bottom:1px solid #eee;color:#555">Manh\u00e3, Tarde, Integral, Noite</td></tr>
              <tr style="background:#fafbfc"><td style="padding:5px 8px"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#6A1B9A;margin-right:5px;vertical-align:middle"></span><strong>CRE</strong></td><td style="padding:5px 8px;color:#555">30 Coordenadorias Regionais</td></tr>
            </tbody>
          </table>
          <p style="font-size:9px;margin:10px 0 0;color:#999;line-height:1.5;font-style:italic">${FONTE}</p>
        </div>
      </div>
    </div>

    <!-- ═══ 1. Gap Racial ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/nav_desigualdades.png" alt=""></span>
      <span class="section-divider-text">Recorte Racial</span>
      <span class="section-divider-line"></span>
    </div>
    <div class="charts-grid">
      <div class="chart-card"><div class="chart-title">Profici\u00eancia M\u00e9dia por Ra\u00e7a/Cor</div><div style="height:280px"><canvas id="chart-desig-raca-bar"></canvas></div><div class="chart-source">${FONTE}</div></div>
      <div class="chart-card"><div class="chart-title">Padr\u00f5es de Desempenho (Defasagem)</div><div style="height:280px"><canvas id="chart-desig-raca-padrao"></canvas></div><div class="chart-source">${FONTE}</div></div>
    </div>
    <div class="charts-grid" style="grid-template-columns:1fr 1fr">
      <div class="chart-card full-width"><div class="chart-title">Evolu\u00e7\u00e3o Temporal por Ra\u00e7a/Cor</div><div style="height:320px"><canvas id="chart-desig-raca-line"></canvas></div><div class="chart-source">${FONTE}</div></div>
      <div class="chart-card full-width"><div class="chart-title">Evolu\u00e7\u00e3o da Defasagem por Ra\u00e7a/Cor (%)</div><div style="height:320px"><canvas id="chart-desig-raca-defasagem-line"></canvas></div><div class="chart-source">${FONTE}</div></div>
    </div>
    <div class="charts-grid" style="grid-template-columns:1fr">
      <div class="chart-card full-width"><div class="chart-title">Desigualdade Racial \u2014 Todas as Etapas e Disciplinas</div><div style="height:300px"><canvas id="chart-desig-panorama"></canvas></div><div class="chart-source">${FONTE}</div></div>
    </div>

    <!-- ═══ 2. Gap de G\u00eanero ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/sec_docentes.png" alt=""></span>
      <span class="section-divider-text">Recorte de G\u00eanero</span>
      <span class="section-divider-line"></span>
    </div>
    <div class="charts-grid">
      <div class="chart-card"><div class="chart-title">Profici\u00eancia M\u00e9dia por Sexo</div><div style="height:280px"><canvas id="chart-desig-sexo-bar"></canvas></div><div class="chart-source">${FONTE}</div></div>
      <div class="chart-card"><div class="chart-title">Padr\u00f5es de Desempenho (Defasagem)</div><div style="height:280px"><canvas id="chart-desig-sexo-padrao"></canvas></div><div class="chart-source">${FONTE}</div></div>
    </div>
    <div class="charts-grid" style="grid-template-columns:1fr">
      <div class="chart-card full-width"><div class="chart-title">Evolu\u00e7\u00e3o Temporal por Sexo</div><div style="height:320px"><canvas id="chart-desig-sexo-line"></canvas></div><div class="chart-source">${FONTE}</div></div>
    </div>

    <!-- ═══ 3B. Interseccionalidade Raça x Gênero ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/icon_interseccionalidade.png" alt="" onerror="this.src='img/icons/nav_desigualdades.png'"></span>
      <span class="section-divider-text">Interseccionalidade: Ra\u00e7a x G\u00eanero</span>
      <span class="section-divider-line"></span>
    </div>
    <div class="charts-grid" style="grid-template-columns:1fr 1fr">
      <div class="chart-card full-width"><div class="chart-title">Profici\u00eancia M\u00e9dia: Ra\u00e7a x G\u00eanero</div><div style="height:320px"><canvas id="chart-desig-raca-sexo-bar"></canvas></div><div class="chart-source">${FONTE}</div></div>
      <div class="chart-card full-width"><div class="chart-title">Padr\u00f5es de Desempenho: Ra\u00e7a x G\u00eanero</div><div style="height:320px"><canvas id="chart-desig-raca-sexo-padrao"></canvas></div><div class="chart-source">${FONTE}</div></div>
    </div>

    <!-- ═══ 3. Urbana vs Rural ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/nav_acesso.png" alt=""></span>
      <span class="section-divider-text">Recorte por Localiza\u00e7\u00e3o</span>
      <span class="section-divider-line"></span>
    </div>
    <div class="charts-grid">
      <div class="chart-card"><div class="chart-title">Profici\u00eancia: Urbana vs Rural</div><div style="height:280px"><canvas id="chart-desig-loc-bar"></canvas></div><div class="chart-source">${FONTE}</div></div>
      <div class="chart-card"><div class="chart-title">Evolu\u00e7\u00e3o Temporal Urbana vs Rural</div><div style="height:280px"><canvas id="chart-desig-loc-line"></canvas></div><div class="chart-source">${FONTE}</div></div>
    </div>

    <div id="desig-section-def">
    <!-- ═══ 4. Deficiência ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/politicas.png" alt=""></span>
      <span class="section-divider-text">Recorte por Defici\u00eancia</span>
      <span class="section-divider-line"></span>
    </div>
    <div class="charts-grid">
      <div class="chart-card"><div class="chart-title">Profici\u00eancia: Com vs Sem Defici\u00eancia</div><div style="height:280px"><canvas id="chart-desig-def-bar"></canvas></div><div class="chart-source">${FONTE}</div></div>
      <div class="chart-card"><div class="chart-title">% Adequado + Avan\u00e7ado: Com vs Sem Defici\u00eancia</div><div style="height:280px"><canvas id="chart-desig-def-pct"></canvas></div><div class="chart-source">${FONTE}</div></div>
    </div>
    </div>

    <!-- ═══ 5. Interseccionalidade ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/nav_desigualdades.png" alt=""></span>
      <span class="section-divider-text">Interseccionalidade: Ra\u00e7a \u00d7 Localiza\u00e7\u00e3o</span>
      <span class="section-divider-line"></span>
    </div>
    <div class="charts-grid">
      <div class="chart-card full-width"><div class="chart-title">Profici\u00eancia M\u00e9dia \u2014 Ra\u00e7a/Cor \u00d7 Localiza\u00e7\u00e3o</div><div style="height:350px"><canvas id="chart-desig-inter"></canvas></div><div class="chart-source">${FONTE}</div></div>
    </div>

    <div id="desig-section-turno">
    <!-- ═══ 6. Turno ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/sec_evolucao.png" alt=""></span>
      <span class="section-divider-text">Recorte por Turno</span>
      <span class="section-divider-line"></span>
    </div>
    <div class="charts-grid">
      <div class="chart-card"><div class="chart-title">Profici\u00eancia por Turno</div><div style="height:280px"><canvas id="chart-desig-turno-bar"></canvas></div><div class="chart-source">${FONTE}</div></div>
      <div class="chart-card"><div class="chart-title">% Adequado + Avan\u00e7ado por Turno</div><div style="height:280px"><canvas id="chart-desig-turno-pct"></canvas></div><div class="chart-source">${FONTE}</div></div>
    </div>
    </div>



    <!-- ═══ 8. Ranking CRE ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/escola.png" alt=""></span>
      <span class="section-divider-text">Ranking por CRE</span>
      <span class="section-divider-line"></span>
    </div>
    <div class="charts-grid" style="grid-template-columns:1fr">
      <div class="chart-card full-width"><div class="chart-title">Profici\u00eancia por CRE</div><div style="height:440px"><canvas id="chart-desig-cre"></canvas></div><div class="chart-source">${FONTE}</div></div>
    </div>

    <!-- ═══ 9. Recortes Sociais por Escola ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/escola.png" alt=""></span>
      <span class="section-divider-text">Recortes Sociais por Escola</span>
      <span class="section-divider-line"></span>
    </div>
    <div id="desig-table-container" style="margin-top:10px">
      <div class="chart-card full-width">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
            <div class="chart-title" id="desig-table-title">Profici\u00eancias M\u00e9dias por Escola e Recortes Sociodemogr\u00e1ficos</div>
            <input type="text" id="desig-escola-search" placeholder="\ud83d\udd0d Buscar escola..." style="padding:5px 12px;border:1px solid #ddd;border-radius:6px;font-size:11px;font-family:Inter,sans-serif;width:220px;outline:none" />
          </div>
          <button id="desig-export-csv" style="background:var(--pri);color:#fff;border:none;padding:6px 16px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;font-family:Inter,sans-serif" title="Exportar tabela como CSV">
            <span style="font-size:14px">📥</span> Exportar CSV
          </button>
        </div>
        <div style="overflow-x:auto;max-height:500px;overflow-y:auto;margin-top:10px">
          <table id="desig-table" class="data-table" style="font-size:10.5px">
            <thead style="position:sticky;top:0;background:#f0f4f8;z-index:2">
              <tr>
                <th rowspan="2" data-col="nome" class="sortable" style="min-width:220px;cursor:pointer;vertical-align:bottom">Escola \u25b2\u25bc</th>
                <th colspan="2" style="text-align:center;border-bottom:2px solid var(--pri);font-size:10px;color:var(--pri)">Geral</th>
                <th colspan="5" style="text-align:center;border-bottom:2px solid #1d71b9;font-size:10px;color:#1d71b9">Ra\u00e7a/Cor</th>
                <th colspan="2" style="text-align:center;border-bottom:2px solid #E91E63;font-size:10px;color:#E91E63">Sexo</th>
                <th colspan="2" style="text-align:center;border-bottom:2px solid #2E7D32;font-size:10px;color:#2E7D32">Local.</th>
              </tr>
              <tr>
                <th data-col="media_lp" class="sortable" style="text-align:right;cursor:pointer;font-size:10px">LP \u25b2\u25bc</th>
                <th data-col="media_mt" class="sortable" style="text-align:right;cursor:pointer;font-size:10px">MT \u25b2\u25bc</th>
                <th data-col="branca" class="sortable" style="text-align:right;cursor:pointer;font-size:10px">Branca \u25b2\u25bc</th>
                <th data-col="preta" class="sortable" style="text-align:right;cursor:pointer;font-size:10px">Preta \u25b2\u25bc</th>
                <th data-col="parda" class="sortable" style="text-align:right;cursor:pointer;font-size:10px">Parda \u25b2\u25bc</th>
                <th data-col="indigena" class="sortable" style="text-align:right;cursor:pointer;font-size:10px">Ind\u00edg. \u25b2\u25bc</th>
                <th data-col="amarela" class="sortable" style="text-align:right;cursor:pointer;font-size:10px">Amarela \u25b2\u25bc</th>
                <th data-col="fem" class="sortable" style="text-align:right;cursor:pointer;font-size:10px">Fem. \u25b2\u25bc</th>
                <th data-col="masc" class="sortable" style="text-align:right;cursor:pointer;font-size:10px">Masc. \u25b2\u25bc</th>
                <th data-col="urbana" class="sortable" style="text-align:right;cursor:pointer;font-size:10px">Urb. \u25b2\u25bc</th>
                <th data-col="rural" class="sortable" style="text-align:right;cursor:pointer;font-size:10px">Rural \u25b2\u25bc</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
        <div class="chart-source">${FONTE}</div>
      </div>
    </div>
  `;

  // Re-populate topbar filters
  const selAnoGlobal = document.getElementById('sel-ano');
  if (selAnoGlobal) {
    selAnoGlobal.innerHTML = anos.map(a => `<option value="${a}" ${a === anoSel0 ? 'selected' : ''}>${a}</option>`).join('');
  }
  
  const bannerFilters = main.querySelector('.banner-filters');
  if (bannerFilters) {
    bannerFilters.insertAdjacentHTML('beforeend', `
      <div class="banner-filter-group">
        <label class="banner-filter-label">Etapa de Ensino</label>
        <select id="desig-sel-etapa" class="banner-filter-select">
          ${ETAPAS.map(e => '<option value="' + e + '"' + (e===defaultEtapa?' selected':'') + '>' + ETAPA_LABELS[e] + '</option>').join('')}
        </select>
      </div>
      <div class="banner-filter-group">
        <label class="banner-filter-label">Componente Curricular</label>
        <select id="desig-sel-disc" class="banner-filter-select">
          <option value="LP">Língua Portuguesa</option>
          <option value="MT">Matemática</option>
        </select>
      </div>
    `);
  }
  populateCreDropdown();
  populateMunDropdown(S.creSel || null);
  const selCre = document.getElementById('sel-cre');
  if (selCre) selCre.value = S.creSel || '';
  const selMun = document.getElementById('sel-mun');
  if (selMun) selMun.value = S.munSel || '';

  function buildCharts() {
      destroyCharts();
    const anoSel = parseInt(document.getElementById('sel-ano')?.value || S.anoSel);
    const etapa = document.getElementById('desig-sel-etapa').value;
    const disc = document.getElementById('desig-sel-disc').value;
    const key = etapa + '_' + disc;

    // Dynamic title suffix
    const etapaLabel = ETAPA_LABELS[etapa] || etapa;
    const discLabel = disc === 'LP' ? 'Língua Portuguesa' : 'Matemática';
    const titleSuffix = ` — ${etapaLabel} · ${discLabel}${geoSuffix()}`;

    // Update chart titles dynamically
    const titleMap = {
      'chart-desig-raca-bar': `Proficiência Média por Raça/Cor${titleSuffix}`,
      'chart-desig-raca-padrao': `Padrões de Desempenho por Raça/Cor${titleSuffix}`,
      'chart-desig-raca-line': `Evolução Temporal por Raça/Cor — ${discLabel}${geoSuffix()}`,
      'chart-desig-raca-defasagem-line': `Evolução da Defasagem por Raça/Cor (%) — ${discLabel}${geoSuffix()}`,
      'chart-desig-sexo-bar': `Proficiência Média por Sexo${titleSuffix}`,
      'chart-desig-sexo-padrao': `Padrões de Desempenho por Sexo${titleSuffix}`,
      'chart-desig-sexo-line': `Evolução Temporal por Sexo — ${discLabel}${geoSuffix()}`,
      'chart-desig-raca-sexo-bar': `Proficiência Média: Raça × Gênero${titleSuffix}`,
      'chart-desig-raca-sexo-padrao': `Padrões de Desempenho: Raça × Gênero${titleSuffix}`,
      'chart-desig-loc-bar': `Proficiência: Urbana vs Rural${titleSuffix}`,
      'chart-desig-loc-line': `Evolução Temporal: Urbana vs Rural — ${discLabel}${geoSuffix()}`,
      'chart-desig-def-bar': `Proficiência: Com vs Sem Deficiência${titleSuffix}`,
      'chart-desig-def-pct': `% Adequado+Avançado: Com vs Sem Deficiência${titleSuffix}`,
      'chart-desig-turno-bar': `Proficiência por Turno${titleSuffix}`,
      'chart-desig-turno-pct': `% Adequado+Avançado por Turno${titleSuffix}`,
      'chart-desig-cre': `Proficiência por CRE${titleSuffix}`,
      'chart-desig-panorama': `Desigualdade Racial — Todas as Etapas e Disciplinas${geoSuffix()}`,
    };
    for (const [canvasId, title] of Object.entries(titleMap)) {
      const canvas = document.getElementById(canvasId);
      if (canvas) {
        const titleEl = canvas.closest('.chart-card')?.querySelector('.chart-title');
        if (titleEl) titleEl.textContent = title;
      }
    }

    function getDesigYearData(ano) {
      const yd = dd.anos.find(a => a.ano === ano);
      if (!yd) return null;
      if (S.munSel && yd.por_municipio) {
        const m = yd.por_municipio[S.munSel];
        if (m) return m;
      }
      if (S.creSel && yd.por_cre) {
        const c = yd.por_cre[S.creSel];
        if (c) return c;
      }
      return yd;
    }

    const yearData = getDesigYearData(anoSel);
    if (!yearData || !yearData.dimensoes) {
      document.getElementById('desig-kpis').innerHTML = `<div style="padding:20px;text-align:center;color:#E65100;font-weight:600;font-size:14px;width:100%">Sem dados suficientes (N < 10) para os filtros selecionados.</div>`;
      return;
    }
    const dims = yearData.dimensoes;
    const geral = yearData.geral?.[key] || null;

    // Warning for 2_EF
    const avisoEl = document.getElementById('desig-aviso');
    if (avisoEl) {
      if (etapa === '2_EF') {
        avisoEl.style.display = 'inline';
        avisoEl.textContent = '\u26A0 O 2\u00ba ano EF n\u00e3o possui dados de ra\u00e7a e sexo (question\u00e1rio n\u00e3o aplicado).';
      } else { avisoEl.style.display = 'none'; }
    }

    const getVal = (dim, group, k) => dims[dim]?.[group]?.[k || key]?.media;
    const getPct = (dim, group, prop, k) => dims[dim]?.[group]?.[k || key]?.[prop || 'pct_adeq_av'];
    const getPadrao = (dim, group, prop, k) => {
      const p = dims[dim]?.[group]?.[k || key];
      if (!p || !p.padrao || !p.n_padrao) return null;
      return (p.padrao[prop] / p.n_padrao) * 100;
    };

    // ── Premium KPIs ──
    const kpiDiv = document.getElementById('desig-kpis');
    const branca = getVal('raca','Branca');
    const preta = getVal('raca','Preta');
    const urbana = getVal('localizacao','Urbana');
    const rural = getVal('localizacao','Rural');
    const fem = getVal('sexo','Feminino');
    const masc = getVal('sexo','Masculino');
    const semDef = getVal('deficiencia','Sem Defici\u00eancia');
    const comDef = getVal('deficiencia','Com Defici\u00eancia');
    const gapRacial = branca != null && preta != null ? (branca - preta) : null;
    const gapLoc = urbana != null && rural != null ? (urbana - rural) : null;
    const gapSexo = fem != null && masc != null ? (fem - masc) : null;
    const gapDef = semDef != null && comDef != null ? (semDef - comDef) : null;

    const kpis = [
      { label: 'M\u00e9dia Geral', val: geral?.media?.toFixed(1) || '\u2014', accent: 'blue', icon: 'img/icons/sec_saeb.png',
        subtext: (geral?.pct_adeq_av != null ? geral.pct_adeq_av.toFixed(1) + '% adequado+avan\u00e7ado' : '') },
      { label: 'Desig. Racial (Branca\u2013Preta)', val: gapRacial != null ? gapRacial.toFixed(1) + ' pts' : 'N/D', accent: 'red', icon: 'img/icons/nav_desigualdades.png',
        subtext: gapRacial != null ? 'Branca ' + branca?.toFixed(0) + ' \u00d7 Preta ' + preta?.toFixed(0) : '' },
      { label: 'Desig. Urbana\u2013Rural', val: gapLoc != null ? gapLoc.toFixed(1) + ' pts' : 'N/D', accent: 'yellow', icon: 'img/icons/nav_acesso.png',
        subtext: gapLoc != null ? 'Urb. ' + urbana?.toFixed(0) + ' \u00d7 Rur. ' + rural?.toFixed(0) : '' },
      { label: 'Desig. de G\u00eanero', val: gapSexo != null ? Math.abs(gapSexo).toFixed(1) + ' pts' : 'N/D', accent: 'green', icon: 'img/icons/sec_docentes.png',
        subtext: gapSexo != null ? (gapSexo > 0 ? 'Feminino acima' : 'Masculino acima') : '' },
      { label: 'Alunos Avaliados', val: geral?.n?.toLocaleString('pt-BR') || '\u2014', accent: 'blue', icon: 'img/icons/escola.png',
        subtext: ETAPA_LABELS[etapa] + ' \u2014 ' + (disc === 'LP' ? 'L\u00edngua Portuguesa' : 'Matem\u00e1tica') },
    ];

    kpiDiv.innerHTML = kpis.map((k, i) => `
      <div class="kpi-card accent-${k.accent}" style="animation-delay:${i * 80}ms">
        <div class="kpi-top">
          <span class="kpi-label">${k.label}</span>
          <img class="kpi-icon" src="${k.icon}" alt="" onerror="this.style.display='none'">
        </div>
        <div class="kpi-body">
          <span class="kpi-value">${k.val}</span>
        </div>
        <div class="kpi-footer">
          ${k.subtext ? '<span class="kpi-abs">' + k.subtext + '</span>' : ''}
        </div>
      </div>
    `).join('');

    // Color palettes
    const RACA_COLORS = { Branca:'#1d71b9', Parda:'#FFCB04', Preta:'#333', 'Ind\u00edgena':'#E53935', Amarela:'#43A047' };
    const RACA_ORDER = ['Branca','Parda','Preta','Ind\u00edgena','Amarela'];
    const SEXO_COLORS = { Feminino:'#E91E63', Masculino:'#1d71b9' };
    const LOC_COLORS = { Urbana:'#1d71b9', Rural:'#43A047' };
    const DEF_COLORS = { 'Sem Defici\u00eancia':'#1d71b9', 'Com Defici\u00eancia':'#E53935' };
    const TURNO_COLORS = { 'Manh\u00e3':'#FFCB04', Tarde:'#F57C00', Noite:'#333', Integral:'#1d71b9' };

    const DL_VAL = { display: true, font: { size: 10, weight: 'bold' }, color: '#333', anchor: 'end', align: 'top', formatter: v => v != null ? v.toFixed(1) : '' };
    const DL_PCT = { ...DL_VAL, formatter: v => v != null ? v.toFixed(1) + '%' : '' };
    const DESIG_PAD = { top: 24 }; // layout padding to prevent datalabel clipping

    // ── 1. RA\u00c7A BAR ──
    const racaGroups = RACA_ORDER.filter(g => dims.raca?.[g]?.[key]);
    if (racaGroups.length > 0) {
      S.charts.push(new Chart(document.getElementById('chart-desig-raca-bar'), {
        type: 'bar',
        data: { labels: racaGroups, datasets: [{ label: 'Profici\u00eancia', data: racaGroups.map(g => getVal('raca', g)),
          backgroundColor: racaGroups.map(g => RACA_COLORS[g] || '#999'), borderRadius: 4, barPercentage: 0.6 }] },
        options: { ...CHART_DEFAULTS, layout: { padding: DESIG_PAD }, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_VAL },
          scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: false } } },
      }));

      S.charts.push(new Chart(document.getElementById('chart-desig-raca-padrao'), {
        type: 'bar',
        data: { labels: racaGroups, datasets: [
          { label: 'Abaixo do Básico', data: racaGroups.map(g => getPadrao('raca', g, 'abaixo')), backgroundColor: '#E53935', borderRadius: 4 },
          { label: 'Básico', data: racaGroups.map(g => getPadrao('raca', g, 'basico')), backgroundColor: '#F57C00', borderRadius: 4 },
          { label: 'Adequado', data: racaGroups.map(g => getPadrao('raca', g, 'adequado')), backgroundColor: '#43A047', borderRadius: 4 },
          { label: 'Avançado', data: racaGroups.map(g => getPadrao('raca', g, 'avancado')), backgroundColor: '#1d71b9', borderRadius: 4 }
        ] },
        options: { ...CHART_DEFAULTS, layout: { padding: DESIG_PAD }, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 10, family: 'Inter' } } }, datalabels: { display: false } },
          scales: { ...CHART_DEFAULTS.scales, x: { stacked: true }, y: { stacked: true, max: 100, beginAtZero: true, ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => v + '%' } } } }
      }));
    }

    // ── 1b. RAÇA LINE (all years with race data) ──
    if (racaGroups.length > 0) {
      const anosComRaca = dd.anos.filter(a => a.dimensoes?.raca && Object.keys(a.dimensoes.raca).length > 1).map(a => a.ano);
      S.charts.push(new Chart(document.getElementById('chart-desig-raca-line'), {
        type: 'line',
        data: { labels: anosComRaca, datasets: racaGroups.map(g => ({
          label: g, data: anosComRaca.map(ano => getDesigYearData(ano)?.dimensoes?.raca?.[g]?.[key]?.media || null),
          borderColor: RACA_COLORS[g] || '#999', tension: 0.3, fill: false, pointRadius: 4, borderWidth: 2.5,
        })) },
        options: { ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, datalabels: { display: false } }, scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: false } } },
      }));

      // ── 1c. RAÇA DEFASAGEM LINE (% abaixo+básico over time) ──
      const getDefasagemPct = (ano, g) => {
        const yd = getDesigYearData(ano);
        const p = yd?.dimensoes?.raca?.[g]?.[key];
        if (!p || !p.padrao || !p.n_padrao) return null;
        return ((p.padrao.abaixo || 0) + (p.padrao.basico || 0)) / p.n_padrao * 100;
      };
      S.charts.push(new Chart(document.getElementById('chart-desig-raca-defasagem-line'), {
        type: 'line',
        data: { labels: anosComRaca, datasets: racaGroups.map(g => ({
          label: g, data: anosComRaca.map(ano => getDefasagemPct(ano, g)),
          borderColor: RACA_COLORS[g] || '#999', tension: 0.3, fill: false, pointRadius: 4, borderWidth: 2.5,
          borderDash: [5, 3],
        })) },
        options: { ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 10, family: 'Inter' } } }, datalabels: { display: false } },
          scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: false, ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => v.toFixed(0) + '%' } } } },
      }));
    }

    // ── 2. SEXO BAR ──
    const sexoGroups = ['Feminino', 'Masculino'].filter(g => dims.sexo?.[g]?.[key]);
    if (sexoGroups.length > 0) {
      S.charts.push(new Chart(document.getElementById('chart-desig-sexo-bar'), {
        type: 'bar',
        data: { labels: sexoGroups, datasets: [{ label: 'Profici\u00eancia', data: sexoGroups.map(g => getVal('sexo', g)),
          backgroundColor: sexoGroups.map(g => SEXO_COLORS[g]), borderRadius: 4, barPercentage: 0.5 }] },
        options: { ...CHART_DEFAULTS, layout: { padding: DESIG_PAD }, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_VAL },
          scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: false } } },
      }));
      S.charts.push(new Chart(document.getElementById('chart-desig-sexo-padrao'), {
        type: 'bar',
        data: { labels: sexoGroups, datasets: [
          { label: 'Abaixo do Básico', data: sexoGroups.map(g => getPadrao('sexo', g, 'abaixo')), backgroundColor: '#E53935', borderRadius: 4 },
          { label: 'Básico', data: sexoGroups.map(g => getPadrao('sexo', g, 'basico')), backgroundColor: '#F57C00', borderRadius: 4 },
          { label: 'Adequado', data: sexoGroups.map(g => getPadrao('sexo', g, 'adequado')), backgroundColor: '#43A047', borderRadius: 4 },
          { label: 'Avançado', data: sexoGroups.map(g => getPadrao('sexo', g, 'avancado')), backgroundColor: '#1d71b9', borderRadius: 4 }
        ] },
        options: { ...CHART_DEFAULTS, layout: { padding: DESIG_PAD }, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 10, family: 'Inter' } } }, datalabels: { display: false } },
          scales: { ...CHART_DEFAULTS.scales, x: { stacked: true }, y: { stacked: true, max: 100, beginAtZero: true, ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => v + '%' } } } }
      }));

    }

    // ── 2b. SEXO LINE (all years with sex data) ──
    if (sexoGroups.length > 0) {
      const anosComSexo = dd.anos.filter(a => a.dimensoes?.sexo && Object.keys(a.dimensoes.sexo).length > 0).map(a => a.ano);
      S.charts.push(new Chart(document.getElementById('chart-desig-sexo-line'), {
        type: 'line',
        data: { labels: anosComSexo, datasets: sexoGroups.map(g => ({
          label: g, data: anosComSexo.map(ano => getDesigYearData(ano)?.dimensoes?.sexo?.[g]?.[key]?.media || null),
          borderColor: SEXO_COLORS[g], tension: 0.3, fill: false, pointRadius: 4, borderWidth: 2.5,
        })) },
        options: { ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, datalabels: { display: false } }, scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: false } } },
      }));
    }

    // ── 3. LOCALIZA\u00c7\u00c3O BAR ──
    const locGroups = ['Urbana', 'Rural'].filter(g => dims.localizacao?.[g]?.[key]);
    if (locGroups.length > 0) {
      S.charts.push(new Chart(document.getElementById('chart-desig-loc-bar'), {
        type: 'bar',
        data: { labels: locGroups, datasets: [{ label: 'Profici\u00eancia', data: locGroups.map(g => getVal('localizacao', g)),
          backgroundColor: locGroups.map(g => LOC_COLORS[g]), borderRadius: 4, barPercentage: 0.5 }] },
        options: { ...CHART_DEFAULTS, layout: { padding: DESIG_PAD }, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_VAL },
          scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: false, min: 150, suggestedMax: 280 } } },
      }));
    }

    // ── 3b. LOCALIZA\u00c7\u00c3O LINE (all years) ──
    if (locGroups.length > 0) {
      S.charts.push(new Chart(document.getElementById('chart-desig-loc-line'), {
        type: 'line',
        data: { labels: anos, datasets: locGroups.map(g => ({
          label: g, data: dd.anos.map(a => getDesigYearData(a.ano)?.dimensoes?.localizacao?.[g]?.[key]?.media || null),
          borderColor: LOC_COLORS[g], tension: 0.3, fill: false, pointRadius: 4, borderWidth: 2.5,
        })) },
        options: { ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, datalabels: { display: false } }, scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: false } } },
      }));
    }

    // ── 4. DEFICI\u00caNCIA ──
    const defGroups = ['Sem Defici\u00eancia', 'Com Defici\u00eancia'].filter(g => dims.deficiencia?.[g]?.[key]);
    const defSection = document.getElementById('desig-section-def');
    if (defSection) defSection.style.display = defGroups.length > 0 ? '' : 'none';
    if (defGroups.length > 0) {
      S.charts.push(new Chart(document.getElementById('chart-desig-def-bar'), {
        type: 'bar',
        data: { labels: defGroups, datasets: [{ label: 'Profici\u00eancia', data: defGroups.map(g => getVal('deficiencia', g)),
          backgroundColor: defGroups.map(g => DEF_COLORS[g]), borderRadius: 4, barPercentage: 0.5 }] },
        options: { ...CHART_DEFAULTS, layout: { padding: DESIG_PAD }, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_VAL },
          scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: false, min: 150, suggestedMax: 280 } } },
      }));
      S.charts.push(new Chart(document.getElementById('chart-desig-def-pct'), {
        type: 'bar',
        data: { labels: defGroups, datasets: [{ label: '% Adequado+Avan\u00e7ado', data: defGroups.map(g => getPct('deficiencia', g)),
          backgroundColor: defGroups.map(g => DEF_COLORS[g]), borderRadius: 4, barPercentage: 0.5 }] },
        options: { ...CHART_DEFAULTS, layout: { padding: DESIG_PAD }, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_PCT },
          scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: true, max: 100, ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => v + '%' } } } },
      }));
    }

    // ── 3B. RAÇA X SEXO ──
    const rxOrder = ['Branca - Feminino', 'Branca - Masculino', 'Parda - Feminino', 'Parda - Masculino', 'Preta - Feminino', 'Preta - Masculino'];
    const rxGroups = rxOrder.filter(g => dims.raca_sexo?.[g]?.[key]);
    if (rxGroups.length > 0) {
      S.charts.push(new Chart(document.getElementById('chart-desig-raca-sexo-bar'), {
        type: 'bar',
        data: { labels: rxGroups.map(g => g.replace(' - ', '\n')),
          datasets: [{ label: 'Proficiência', data: rxGroups.map(g => getVal('raca_sexo', g)),
            backgroundColor: rxGroups.map(g => g.includes('Feminino') ? '#E91E63CC' : '#1d71b9CC'),
            borderRadius: 4, barPercentage: 0.6 }] },
        options: { ...CHART_DEFAULTS, layout: { padding: DESIG_PAD }, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_VAL },
          scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: false }, x: { ticks: { font: { size: 9, family: 'Inter' } } } } },
      }));

      S.charts.push(new Chart(document.getElementById('chart-desig-raca-sexo-padrao'), {
        type: 'bar',
        data: { labels: rxGroups.map(g => g.replace(' - ', '\n')), datasets: [
          { label: 'Abaixo do Básico', data: rxGroups.map(g => getPadrao('raca_sexo', g, 'abaixo')), backgroundColor: '#E53935', borderRadius: 4 },
          { label: 'Básico', data: rxGroups.map(g => getPadrao('raca_sexo', g, 'basico')), backgroundColor: '#F57C00', borderRadius: 4 },
          { label: 'Adequado', data: rxGroups.map(g => getPadrao('raca_sexo', g, 'adequado')), backgroundColor: '#43A047', borderRadius: 4 },
          { label: 'Avançado', data: rxGroups.map(g => getPadrao('raca_sexo', g, 'avancado')), backgroundColor: '#1d71b9', borderRadius: 4 }
        ] },
        options: { ...CHART_DEFAULTS, layout: { padding: DESIG_PAD }, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 10, family: 'Inter' } } }, datalabels: { display: false } },
          scales: { ...CHART_DEFAULTS.scales, x: { stacked: true, ticks: { font: { size: 9, family: 'Inter' } } }, y: { stacked: true, max: 100, beginAtZero: true, ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => v + '%' } } } }
      }));
    }

    // ── 5. INTERSEC\u00c7\u00c3O ──
    const interOrder = ['Branca - Urbana', 'Branca - Rural', 'Parda - Urbana', 'Parda - Rural', 'Preta - Urbana', 'Preta - Rural', 'Ind\u00edgena - Urbana', 'Ind\u00edgena - Rural'];
    const interGrupos = interOrder.filter(g => dims.raca_loc?.[g]?.[key]);
    if (interGrupos.length > 0) {
      const interColors = interGrupos.map(g => RACA_COLORS[g.split(' - ')[0]] || '#999');
      S.charts.push(new Chart(document.getElementById('chart-desig-inter'), {
        type: 'bar',
        data: { labels: interGrupos.map(g => g.replace(' - ', '\n')),
          datasets: [{ label: 'Profici\u00eancia', data: interGrupos.map(g => getVal('raca_loc', g)),
            backgroundColor: interGrupos.map((g,i) => g.includes('Rural') ? interColors[i] + '77' : interColors[i] + 'CC'),
            borderColor: interColors, borderWidth: 1, borderRadius: 4, barPercentage: 0.7 }] },
        options: { ...CHART_DEFAULTS, indexAxis: 'y',
          plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: { ...DL_VAL, anchor: 'end', align: 'right' } },
          scales: { x: { ...CHART_DEFAULTS.scales.y, beginAtZero: false }, y: { ticks: { font: { size: 9, family: 'Inter' } } } } },
      }));
    }

    // ── 6. TURNO ──
    const turnoOrder = ['Manh\u00e3', 'Tarde', 'Integral', 'Noite'];
    const turnoGrupos = turnoOrder.filter(g => dims.turno?.[g]?.[key]);
    const turnoSection = document.getElementById('desig-section-turno');
    if (turnoSection) turnoSection.style.display = turnoGrupos.length > 0 ? '' : 'none';
    if (turnoGrupos.length > 0) {
      S.charts.push(new Chart(document.getElementById('chart-desig-turno-bar'), {
        type: 'bar',
        data: { labels: turnoGrupos, datasets: [{ label: 'Profici\u00eancia', data: turnoGrupos.map(g => getVal('turno', g)),
          backgroundColor: turnoGrupos.map(g => TURNO_COLORS[g]), borderRadius: 4, barPercentage: 0.6 }] },
        options: { ...CHART_DEFAULTS, layout: { padding: DESIG_PAD }, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_VAL },
          scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: false } } },
      }));
      S.charts.push(new Chart(document.getElementById('chart-desig-turno-pct'), {
        type: 'bar',
        data: { labels: turnoGrupos, datasets: [{ label: '% Adequado+Avan\u00e7ado', data: turnoGrupos.map(g => getPct('turno', g)),
          backgroundColor: turnoGrupos.map(g => TURNO_COLORS[g]), borderRadius: 4, barPercentage: 0.6 }] },
        options: { ...CHART_DEFAULTS, layout: { padding: DESIG_PAD }, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_PCT },
          scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: true, max: 100, ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => v + '%' } } } },
      }));
    }

    // ── 7. CRE RANKING ──
    const creDataRaw = yearData.por_cre || {};
    const creLookup = yearData.cre_lookup || {};
    const creEntries = Object.entries(creDataRaw)
      .map(([cod, d]) => ({ cod, nome: creLookup[cod] || cod + '\u00aa CRE', val: d?.geral?.[key]?.media, n: d?.geral?.[key]?.n || 0 }))
      .filter(c => c.val != null)
      .sort((a, b) => b.val - a.val);
    if (creEntries.length > 0) {
      const median = geral?.media || 200;
      S.charts.push(new Chart(document.getElementById('chart-desig-cre'), {
        type: 'bar',
        data: { labels: creEntries.map(c => c.nome),
          datasets: [{ label: 'Profici\u00eancia', data: creEntries.map(c => c.val),
            backgroundColor: creEntries.map(c => c.val >= median ? '#1d71b9CC' : '#E53935CC'),
            borderRadius: 3, barPercentage: 0.7 }] },
        options: { ...CHART_DEFAULTS, indexAxis: 'y',
          plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: { ...DL_VAL, anchor: 'end', align: 'right', font: { size: 8, weight: 'bold' } } },
          scales: { x: { ...CHART_DEFAULTS.scales.y, beginAtZero: false }, y: { ticks: { font: { size: 8, family: 'Inter' } } } } },
      }));
    }

    // ── 8. PANORAMA MULTI-ETAPA ──
    const panLabels = [];
    const panRacas = { 'Branca': [], 'Parda': [], 'Preta': [], 'Indígena': [], 'Amarela': [] };
    const racaCoresPan = { 'Branca': '#1d71b9CC', 'Parda': '#FFCB04CC', 'Preta': '#333333CC', 'Indígena': '#E53935CC', 'Amarela': '#43A047CC' };
    
    ETAPAS.forEach(et => {
      ['LP', 'MT'].forEach(dc => {
        const k = et + '_' + dc;
        let hasData = false;
        Object.keys(panRacas).forEach(r => {
          if (dims.raca?.[r]?.[k]?.media != null) hasData = true;
        });
        if (hasData) {
          panLabels.push(ETAPA_LABELS[et] + ' ' + dc);
          Object.keys(panRacas).forEach(r => {
            panRacas[r].push(dims.raca?.[r]?.[k]?.media);
          });
        }
      });
    });
    if (panLabels.length > 0) {
      const activeRacas = Object.keys(panRacas).filter(r => panRacas[r].some(v => v != null));
      S.charts.push(new Chart(document.getElementById('chart-desig-panorama'), {
        type: 'bar',
        data: { labels: panLabels, datasets: activeRacas.map(r => ({
          label: r, data: panRacas[r], backgroundColor: racaCoresPan[r], borderRadius: 3, barPercentage: 0.4, categoryPercentage: 0.8
        })) },
        options: { ...CHART_DEFAULTS, layout: { padding: DESIG_PAD }, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: true, position: 'bottom' }, datalabels: { ...DL_VAL, font: { size: 8, weight: 'bold' }, formatter: v => v != null ? Math.round(v) : '' } },
          scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: false } } },
      }));
    }
  }

  // ── Table sort state ──
  let _desigSortCol = 'media_lp';
  let _desigSortAsc = false;

  buildCharts();
  buildDesigTable();

  ['desig-sel-etapa', 'desig-sel-disc'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => { buildCharts(); buildDesigTable(); });
  });
  // Sync global sel-ano with desigualdades charts
  document.getElementById('sel-ano')?.addEventListener('change', () => { buildCharts(); buildDesigTable(); });

  function buildDesigTable() {
    const tableCont = document.getElementById('desig-table-container');
    const tableBody = document.querySelector('#desig-table tbody');
    if (!tableCont || !tableBody) return;

    const anoSel = parseInt(document.getElementById('sel-ano')?.value || S.anoSel);
    const etapa = document.getElementById('desig-sel-etapa').value;
    const disc = document.getElementById('desig-sel-disc').value;
    const keyLP = etapa + '_LP';
    const keyMT = etapa + '_MT';
    const key = etapa + '_' + disc; // used for race/sex/loc breakdowns
    const yearData = dd.anos.find(a => a.ano === anoSel);
    if (!yearData || !yearData.por_escola) return;

    // Update table title dynamically
    const etLabel = ETAPA_LABELS[etapa] || etapa;
    const titleEl = document.getElementById('desig-table-title');
    if (titleEl) titleEl.textContent = `Proficiências Médias por Escola — ${etLabel} · ${anoSel}${geoSuffix()}`;

    const escolasLookup = yearData.escola_lookup || {};
    const escRows = [];
    for (const [codEsc, escData] of Object.entries(yearData.por_escola)) {
      const lpData = escData?.geral?.[keyLP];
      const mtData = escData?.geral?.[keyMT];
      if (lpData?.media == null && mtData?.media == null) continue;
      const mRaca = escData?.dimensoes?.raca || {};
      const mSexo = escData?.dimensoes?.sexo || {};
      const mLoc = escData?.dimensoes?.localizacao || {};
      escRows.push({
        nome: escolasLookup[codEsc]?.nome || codEsc,
        media_lp: lpData?.media ?? null,
        media_mt: mtData?.media ?? null,
        branca: mRaca['Branca']?.[key]?.media ?? null,
        preta: mRaca['Preta']?.[key]?.media ?? null,
        parda: mRaca['Parda']?.[key]?.media ?? null,
        indigena: mRaca['Indígena']?.[key]?.media ?? null,
        amarela: mRaca['Amarela']?.[key]?.media ?? null,
        fem: mSexo['Feminino']?.[key]?.media ?? null,
        masc: mSexo['Masculino']?.[key]?.media ?? null,
        urbana: mLoc['Urbana']?.[key]?.media ?? null,
        rural: mLoc['Rural']?.[key]?.media ?? null,
      });
    }

    // Sort
    escRows.sort((a, b) => {
      const va = a[_desigSortCol], vb = b[_desigSortCol];
      if (_desigSortCol === 'nome') {
        return _desigSortAsc ? (va || '').localeCompare(vb || '') : (vb || '').localeCompare(va || '');
      }
      const na = va ?? -Infinity, nb = vb ?? -Infinity;
      return _desigSortAsc ? na - nb : nb - na;
    });

    // Search filter
    const searchTerm = (document.getElementById('desig-escola-search')?.value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const filteredRows = searchTerm
      ? escRows.filter(d => d.nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(searchTerm))
      : escRows;

    const fmt = v => v != null ? v.toFixed(1) : '-';
    tableBody.innerHTML = filteredRows.map(d => `
      <tr>
        <td style="text-align:left;font-weight:500;font-size:10px">${d.nome}</td>
        <td style="text-align:right;font-weight:600;color:var(--pri)">${fmt(d.media_lp)}</td>
        <td style="text-align:right;font-weight:600;color:var(--pri)">${fmt(d.media_mt)}</td>
        <td style="text-align:right;color:#1d71b9">${fmt(d.branca)}</td>
        <td style="text-align:right;color:#333">${fmt(d.preta)}</td>
        <td style="text-align:right;color:#FFCB04">${fmt(d.parda)}</td>
        <td style="text-align:right;color:#8B4513">${fmt(d.indigena)}</td>
        <td style="text-align:right;color:#FF8C00">${fmt(d.amarela)}</td>
        <td style="text-align:right;color:#E91E63">${fmt(d.fem)}</td>
        <td style="text-align:right;color:#1d71b9">${fmt(d.masc)}</td>
        <td style="text-align:right;color:#2E7D32">${fmt(d.urbana)}</td>
        <td style="text-align:right;color:#795548">${fmt(d.rural)}</td>
      </tr>
    `).join('');

    // Store rows for export (filtered)
    S._desigExportRows = filteredRows;
  }

  // Sortable headers
  document.querySelectorAll('#desig-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (_desigSortCol === col) { _desigSortAsc = !_desigSortAsc; } else { _desigSortCol = col; _desigSortAsc = col === 'nome'; }
      buildDesigTable();
    });
  });

  // Search filter for escola table
  document.getElementById('desig-escola-search')?.addEventListener('input', () => buildDesigTable());

  // Export CSV
  document.getElementById('desig-export-csv')?.addEventListener('click', () => {
    const rows = S._desigExportRows;
    if (!rows || rows.length === 0) return;
    const etLabel = ETAPA_LABELS[document.getElementById('desig-sel-etapa')?.value] || '';
    const disc = document.getElementById('desig-sel-disc')?.value === 'LP' ? 'Língua Portuguesa' : 'Matemática';
    const headers = ['Escola', 'Geral LP', 'Geral MT', `Branca (${disc})`, `Preta (${disc})`, `Parda (${disc})`, `Indígena (${disc})`, `Amarela (${disc})`, `Feminino (${disc})`, `Masculino (${disc})`, `Urbana (${disc})`, `Rural (${disc})`];
    const csvRows = [headers.join(';')];
    const fmtCSV = v => v != null ? v.toFixed(1).replace('.', ',') : '';
    rows.forEach(d => {
      csvRows.push([
        `"${d.nome}"`, fmtCSV(d.media_lp), fmtCSV(d.media_mt),
        fmtCSV(d.branca), fmtCSV(d.preta), fmtCSV(d.parda), fmtCSV(d.indigena), fmtCSV(d.amarela),
        fmtCSV(d.fem), fmtCSV(d.masc), fmtCSV(d.urbana), fmtCSV(d.rural)
      ].join(';'));
    });
    const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `desigualdades_escola_${etLabel}_${document.getElementById('sel-ano')?.value || ''}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  });

  // Populate standard topbar filters
  populateMunDropdown(S.creSel || null);
  bindTopbarFilters();
  injectExportButtons();
  updateActiveFilters();
  updateDesigFilterBadges();

  function updateDesigFilterBadges() {
    const slot = document.getElementById('mun-filter-slot');
    if (!slot) return;
    // Remove old desig badges
    slot.querySelectorAll('.filter-chip-desig').forEach(el => el.remove());
    const etapaSel = document.getElementById('desig-sel-etapa')?.value;
    const discSel = document.getElementById('desig-sel-disc')?.value;
    if (etapaSel) {
      const etapaLabel = ETAPA_LABELS[etapaSel] || etapaSel;
      const chip = document.createElement('span');
      chip.className = 'filter-chip filter-chip-desig';
      chip.innerHTML = `📊 ${etapaLabel}`;
      chip.title = 'Etapa selecionada';
      slot.appendChild(chip);
    }
    if (discSel) {
      const discLabel = discSel === 'LP' ? 'Língua Portuguesa' : 'Matemática';
      const chip = document.createElement('span');
      chip.className = 'filter-chip filter-chip-desig';
      chip.innerHTML = `📘 ${discLabel}`;
      chip.title = 'Disciplina selecionada';
      slot.appendChild(chip);
    }
  }

  // Also update badges when desig filters change
  ['desig-sel-etapa', 'desig-sel-disc'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', updateDesigFilterBadges);
  });
}

// ══════════════════════════════════════════════════════════

function getCreNomeEscola(cod) {
  const c = String(cod).padStart(2, '0');
  return S.creLookup?.cre_list?.find(x => x.cod_cre === c)?.nome_cre?.replace(/^\d+\s*CRE\s*-\s*/, '') || `${parseInt(c, 10)}ª CRE`;
}

function escolaTooltipHtml(e, indicator, cfg) {
  const val = e[indicator];
  const valStr = val != null && cfg ? cfg.fmt(val) : null;
  return `<div class="escola-marker-tip">
    <div class="escola-marker-tip__name">${e.nome || ''}</div>
    <div class="escola-marker-tip__meta">${e.municipio || ''} · ${e.cre}ª CRE</div>
    <div class="escola-marker-tip__inep">INEP ${e.inep}</div>
    ${valStr ? `<div class="escola-marker-tip__val">${cfg.label}: <strong>${valStr}</strong></div>` : ''}
  </div>`;
}

function escolaPremiumItemHtml(e, indicator, cfg) {
  const val = e[indicator];
  const valStr = val != null && cfg ? cfg.fmt(val) : null;
  const color = getEscolaColor(val, indicator);
  const safeNome = (e.nome || '').replace(/"/g, '&quot;');
  return `<button type="button" class="escola-premium-item" data-inep="${e.inep}" data-label="${safeNome} · ${e.municipio || ''}">
    <span class="escola-premium-item__accent" style="background:${color}"></span>
    <div class="escola-premium-item__main">
      <span class="escola-premium-item__name">${e.nome}</span>
      <span class="escola-premium-item__meta">${e.municipio || ''} · ${e.cre}ª CRE · INEP ${e.inep}</span>
    </div>
    ${valStr ? `<span class="escola-premium-item__badge" style="--badge-color:${color}">${valStr}</span>` : '<span class="escola-premium-item__badge escola-premium-item__badge--empty">—</span>'}
  </button>`;
}

function bindEscolaPremiumList(container, onSelect) {
  container.querySelectorAll('.escola-premium-item').forEach(btn => {
    btn.addEventListener('click', () => onSelect(btn.dataset.inep, btn.dataset.label));
  });
}

function updateEscolasCreOverlay(map, creFilter) {
  if (S.escolasCreOverlay) {
    try { map.removeLayer(S.escolasCreOverlay); } catch (e) { /* noop */ }
    S.escolasCreOverlay = null;
  }
  if (!S.creGeo || !map) return;

  const creCod = creFilter ? String(creFilter).padStart(2, '0') : null;
  S.escolasCreOverlay = L.geoJSON(S.creGeo, {
    interactive: false,
    style: (feature) => {
      const cod = feature.properties.cod_cre;
      const isActive = creCod ? cod === creCod : false;
      return {
        fillColor: isActive ? '#0D47A1' : 'transparent',
        fillOpacity: isActive ? 0.08 : 0,
        weight: isActive ? 2.5 : 1.5,
        color: isActive ? '#0D47A1' : 'rgba(13,71,161,0.55)',
        dashArray: isActive ? null : '5,5',
        opacity: isActive ? 0.9 : 0.5,
      };
    },
    onEachFeature: (feature, layer) => {
      if (layer.setStyle) layer.options.interactive = false;
      if (!creCod) {
        const shortName = (feature.properties.nome_cre || '').replace(/^\d+\s*CRE\s*-\s*/, '');
        layer.bindTooltip(shortName, {
          permanent: false,
          direction: 'center',
          className: 'cre-overlay-label',
          interactive: false,
        });
      }
    },
  }).addTo(map);
}

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
  S.escolaInepSel = null;
  S.escolaMunSel = S.escolaMunSel || '';

  // Build CRE list
  const creSet = new Set(escolas.map(e => e.cre));
  const creList = [...creSet].sort((a, b) => parseInt(a) - parseInt(b));

  // Build municipality list
  const munMap = new Map();
  escolas.forEach(e => {
    const cod = e.cod_mun || e.cod_ibge;
    if (cod && e.municipio) munMap.set(String(cod), e.municipio);
  });
  const munList = [...munMap.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));

  const ESCOLA_LIST_MAX = 40;

  const defaultIndicator = 'ideb_af';

  main.innerHTML = `
    <div class="section-content" style="padding:10px 16px 50px;position:relative">
      ${sectionBanner('img/icons/escola.png', 'Visão por Escola (Boletim Escolar)', 'Rede Estadual do RS', { redeToggle: false })}
      <style>
         #main-content .banner-filters { display: none !important; }
      </style>

      <!-- Filters Row -->
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin:18px 0;align-items:center;background:#fff;padding:12px 16px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.04);border:1px solid #f0f0f0">
        <div style="display:flex;align-items:center;gap:8px">
          <label style="font-size:11px;font-weight:700;color:#333;text-transform:uppercase;letter-spacing:0.5px">Colorir mapa por:</label>
          <select id="escola-indicator" style="padding:6px 12px;border-radius:8px;border:1px solid #e0e0e0;font-size:12px;font-family:Inter;background:#f9fafb;cursor:pointer;color:#333;outline:none;transition:all 0.2s">
            ${ESCOLA_INDICATORS.map(i => `<option value="${i.key}" ${i.key === defaultIndicator ? 'selected' : ''}>${i.label}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <label style="font-size:11px;font-weight:700;color:#333;text-transform:uppercase;letter-spacing:0.5px">CRE:</label>
          <select id="escola-cre-filter" style="padding:6px 12px;border-radius:8px;border:1px solid #e0e0e0;font-size:12px;font-family:Inter;background:#f9fafb;cursor:pointer;color:#333;outline:none;transition:all 0.2s">
            <option value="">Todas as CREs</option>
            ${creList.map(c => `<option value="${c}">${c}ª CRE</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <label style="font-size:11px;font-weight:700;color:#333;text-transform:uppercase;letter-spacing:0.5px">Município:</label>
          <select id="escola-mun-filter" style="padding:6px 12px;border-radius:8px;border:1px solid #e0e0e0;font-size:12px;font-family:Inter;background:#f9fafb;cursor:pointer;color:#333;outline:none;transition:all 0.2s;max-width:220px">
            <option value="">Todos os municípios</option>
            ${munList.map(([cod, nome]) => `<option value="${cod}" ${cod === S.escolaMunSel ? 'selected' : ''}>${nome}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex:1;max-width:350px;margin-left:auto;position:relative">
          <label style="font-size:11px;font-weight:700;color:#333;text-transform:uppercase;letter-spacing:0.5px">Buscar escola:</label>
          <input type="text" id="escola-search" placeholder="Nome, município ou INEP..." autocomplete="off" style="padding:6px 12px;border-radius:8px;border:1px solid #e0e0e0;font-size:12px;font-family:Inter;width:100%;background:#f9fafb;color:#333;outline:none;transition:all 0.2s">
          <div id="escola-autocomplete" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid #e0e0e0;border-radius:8px;box-shadow:0 4px 15px rgba(0,0,0,0.1);z-index:1500;max-height:300px;overflow-y:auto;margin-top:4px"></div>
        </div>
      </div>

      <!-- KPIs -->
      <div id="escola-kpis" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px"></div>

      <!-- Lista compacta de escolas (município com poucas escolas) -->
      <div id="escola-list-panel" style="display:none;margin-bottom:14px"></div>

      <!-- Map Container -->
      <div class="chart-card" style="padding:0;overflow:hidden;border-radius:10px;margin-bottom:16px;position:relative">
        <div style="padding:10px 14px 6px;display:flex;justify-content:space-between;align-items:center">
          <div class="chart-title" id="escola-map-title">Mapa das Escolas</div>
          <div id="escola-legend" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"></div>
        </div>
        <div style="position:relative;width:100%">
          <div id="escola-map" style="height:550px;width:100%;background:#f0f4f8"></div>
          
          <!-- Satellite Toggle -->
          <div style="position:absolute;top:10px;left:50px;z-index:400;display:flex;background:#fff;border-radius:6px;box-shadow:0 2px 5px rgba(0,0,0,0.2);overflow:hidden">
            <button id="btn-mapa-carto" class="map-layer-btn" style="padding:4px 8px;font-size:11px;border:none;cursor:pointer;background:#f5f5f5;color:#666">Mapa Base</button>
            <button id="btn-mapa-sat" class="map-layer-btn active" style="padding:4px 8px;font-size:11px;border:none;cursor:pointer;background:#fff;color:#333">Satélite</button>
          </div>
          </div>
        </div>
      </div>

      <!-- Boletim Container -->
      <div id="escola-boletim-container" style="display:none;margin-top:20px;animation:fadeIn 0.4s ease">
         <!-- Renderizado via JS -->
      </div>

      <div style="text-align:right;margin-top:8px;font-size:9px;color:#aaa">
        Fonte: Censo Escolar 2025 / INEP — Indicadores por escola | ${withCoords.length} escolas georreferenciadas
      </div>
    </div>
  `;

  // Initialize map
  const mapEl = document.getElementById('escola-map');
  const layerCarto = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '© OpenStreetMap © CARTO', subdomains: 'abcd', maxZoom: 18 });
  const layerSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '© Esri', maxZoom: 18 });
  
  const map = L.map(mapEl, { zoomControl: true, scrollWheelZoom: true, layers: [layerSat] }).setView([-29.5, -53.5], 7);
  S.escolasMap = map;
  S.escolasMarkers = L.layerGroup().addTo(map);

  // Map layer toggle bindings
  document.getElementById('btn-mapa-carto').addEventListener('click', e => {
    map.removeLayer(layerSat); map.addLayer(layerCarto);
    e.target.classList.add('active'); e.target.style.background = '#fff'; e.target.style.color = '#333';
    document.getElementById('btn-mapa-sat').classList.remove('active'); document.getElementById('btn-mapa-sat').style.background = '#f5f5f5'; document.getElementById('btn-mapa-sat').style.color = '#666';
  });
  document.getElementById('btn-mapa-sat').addEventListener('click', e => {
    map.removeLayer(layerCarto); map.addLayer(layerSat);
    e.target.classList.add('active'); e.target.style.background = '#fff'; e.target.style.color = '#333';
    document.getElementById('btn-mapa-carto').classList.remove('active'); document.getElementById('btn-mapa-carto').style.background = '#f5f5f5'; document.getElementById('btn-mapa-carto').style.color = '#666';
  });

  // Boletim Fluxo Render
  window.renderBoletimFluxo = function(inep) {
    const e = S.escolasData.escolas.find(x => x.inep === inep);
    if (!e) return;
    const content = document.getElementById('boletim-fluxo-content');
    if (!content) return;

    if (window.fluxoBoletimCharts) {
      window.fluxoBoletimCharts.forEach(c => c.destroy());
    }
    window.fluxoBoletimCharts = [];

    const histFluxo = e.fluxo_hist || {};
    const histTdi = e.tdi_hist || {};
    const histYears = [...new Set([...Object.keys(histFluxo), ...Object.keys(histTdi)])].sort();

    if (histYears.length === 0) {
      content.innerHTML = `<div style="font-size:13px;color:#888;text-align:center;padding:20px;width:100%">Sem dados históricos de Fluxo para esta escola.</div>`;
      return;
    }

    let cHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:20px;width:100%">';
    const chartsData = [];

    const metrics = [
      { id: 'aprov', title: 'Aprovação', keys: { fund: 'aprov_fund', med: 'aprov_med' }, source: histFluxo },
      { id: 'reprov', title: 'Reprovação', keys: { fund: 'reprov_fund', med: 'reprov_med' }, source: histFluxo },
      { id: 'aband', title: 'Abandono', keys: { fund: 'aband_fund', med: 'aband_med' }, source: histFluxo },
      { id: 'tdi', title: 'Distorção Idade-Série', keys: { fund: 'tdi_fund', med: 'tdi_med' }, source: histTdi }
    ];

    for (const m of metrics) {
      const hasData = histYears.some(y => m.source[y] && (m.source[y][m.keys.fund] != null || m.source[y][m.keys.med] != null));
      if (!hasData) continue;

      cHtml += `
        <div style="background:#fff;padding:16px;border-radius:8px;border:1px solid #eee;box-shadow:0 2px 8px rgba(0,0,0,0.02)">
          <div style="font-weight:800;color:#333;margin-bottom:16px;text-align:center;font-size:13px;border-bottom:2px solid #f0f0f0;padding-bottom:8px">${m.title}</div>
          <div style="height:200px;width:100%;position:relative"><canvas id="boletim-fluxo-chart-${m.id}"></canvas></div>
        </div>
      `;

      chartsData.push({
        id: m.id,
        labels: histYears,
        title: m.title,
        dataFund: histYears.map(y => m.source[y] ? m.source[y][m.keys.fund] : null),
        dataMed: histYears.map(y => m.source[y] ? m.source[y][m.keys.med] : null)
      });
    }

    cHtml += '</div>';
    content.innerHTML = cHtml;

    setTimeout(() => {
      for (const d of chartsData) {
        const ctx = document.getElementById(`boletim-fluxo-chart-${d.id}`);
        if (!ctx) continue;
        const chart = new Chart(ctx, {
          type: 'line',
          data: {
            labels: d.labels,
            datasets: [
              { label: 'Ensino Fundamental', data: d.dataFund, borderColor: '#0D47A1', backgroundColor: '#0D47A1', tension: 0.3, pointRadius: 4 },
              { label: 'Ensino Médio', data: d.dataMed, borderColor: '#FF9800', backgroundColor: '#FF9800', tension: 0.3, pointRadius: 4 }
            ]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 6, font: { size: 10 } } },
              tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.raw != null ? c.raw + '%' : '-'}` } }
            },
            scales: {
              y: { min: 0, max: d.id === 'aprov' ? 100 : undefined, ticks: { callback: v => v + '%' } }
            }
          }
        });
        window.fluxoBoletimCharts.push(chart);
      }
    }, 50);
  };

  // Boletim SAERS Render
  window.renderBoletimSaers = function(inep) {
    const visao = document.getElementById('boletim-saers-visao')?.value || 'geral';
    const etapaFilter = document.getElementById('boletim-saers-etapa')?.value || 'todas';
    const e = S.escolasData.escolas.find(x => x.inep === inep);
    if (!e) return;
    const content = document.getElementById('boletim-saers-content');
    if (!content) return;

    if (window.saersBoletimCharts) {
      window.saersBoletimCharts.forEach(c => c.destroy());
    }
    window.saersBoletimCharts = [];

    const saersMetrics = [
      { keyLP: 'saers_2ef_lp', keyMT: 'saers_2ef_mt', title: '2º Ano EF', id: '2ef' },
      { keyLP: 'saers_5ef_lp', keyMT: 'saers_5ef_mt', title: '5º Ano EF', id: '5ef' },
      { keyLP: 'saers_9ef_lp', keyMT: 'saers_9ef_mt', title: '9º Ano EF', id: '9ef' },
      { keyLP: 'saers_em_lp', keyMT: 'saers_em_mt', title: 'Ensino Médio', id: 'em' }
    ].filter(m => etapaFilter === 'todas' || m.id === etapaFilter);

    const hist = e.saers_hist || {};
    const histYears = Object.keys(hist).sort();

    if (histYears.length === 0) {
      content.innerHTML = `<div style="font-size:13px;color:#888;text-align:center;padding:20px;width:100%">Sem dados históricos do SAERS para esta escola.</div>`;
      return;
    }

    let cHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:20px;width:100%">';
    const saersChartsData = [];

    for (const m of saersMetrics) {
      if (visao === 'geral') {
        const hasData = histYears.some(y => hist[y][m.keyLP] != null || hist[y][m.keyMT] != null);
        if (!hasData) continue;
        
        cHtml += `
          <div style="background:#fff;padding:16px;border-radius:8px;border:1px solid #eee;box-shadow:0 2px 8px rgba(0,0,0,0.02)">
            <div style="font-weight:800;color:#333;margin-bottom:16px;text-align:center;font-size:13px;border-bottom:2px solid #f0f0f0;padding-bottom:8px">${m.title}</div>
            <div style="height:180px;position:relative;width:100%">
              <canvas id="saers-chart-${m.id}"></canvas>
            </div>
          </div>
        `;
        const dataLP = histYears.map(y => hist[y][m.keyLP] || null);
        const dataMT = histYears.map(y => hist[y][m.keyMT] || null);
        saersChartsData.push({ id: m.id, type: 'line', labels: histYears, dataLP, dataMT });
      } else {
        const latestYear = histYears[histYears.length - 1];
        if (!S.desig || !S.desig.anos) continue;
        const yearData = S.desig.anos.find(a => a.ano === parseInt(latestYear));
        if (!yearData || !yearData.por_escola || !yearData.por_escola[inep]) continue;
        
        const escDesig = yearData.por_escola[inep];
        const mDim = escDesig.dimensoes?.[visao] || {};
        
        let cats = [];
        if (visao === 'raca') {
          cats = [
            { k: 'Branca', l: 'Branca' },
            { k: 'Preta', l: 'Preta' },
            { k: 'Parda', l: 'Parda' },
            { k: 'Indígena', l: 'Indígena' },
            { k: 'Amarela', l: 'Amarela' }
          ];
        } else if (visao === 'sexo') {
          cats = [
            { k: 'Feminino', l: 'Feminino' },
            { k: 'Masculino', l: 'Masculino' }
          ];
        }

        const desigKeyLP = { '2ef': '2_EF_LP', '5ef': '5_EF_LP', '9ef': '9_EF_LP', 'em': '3_EM_LP' }[m.id];
        const desigKeyMT = { '2ef': '2_EF_MT', '5ef': '5_EF_MT', '9ef': '9_EF_MT', 'em': '3_EM_MT' }[m.id];

        const labels = cats.map(c => c.l);
        const dataLP = cats.map(c => mDim[c.k]?.[desigKeyLP]?.media || null);
        const dataMT = cats.map(c => mDim[c.k]?.[desigKeyMT]?.media || null);
        
        if (dataLP.every(v => v == null) && dataMT.every(v => v == null)) continue;
        
        cHtml += `
          <div style="background:#fff;padding:16px;border-radius:8px;border:1px solid #eee;box-shadow:0 2px 8px rgba(0,0,0,0.02)">
            <div style="font-weight:800;color:#333;margin-bottom:16px;text-align:center;font-size:13px;border-bottom:2px solid #f0f0f0;padding-bottom:8px">${m.title} (${latestYear})</div>
            <div style="height:220px;position:relative;width:100%">
              <canvas id="saers-chart-${m.id}"></canvas>
            </div>
          </div>
        `;
        saersChartsData.push({ id: m.id, type: 'bar', labels, dataLP, dataMT });
      }
    }

    if (saersChartsData.length === 0) {
      cHtml += `<div style="font-size:13px;color:#888;grid-column:1/-1;text-align:center;padding:20px">Sem dados de SAERS para a visão selecionada.</div>`;
    }
    
    cHtml += '</div>';
    content.innerHTML = cHtml;

    saersChartsData.forEach(c => {
      const ctx = document.getElementById(`saers-chart-${c.id}`);
      if (!ctx) return;
      const chart = new Chart(ctx, {
        type: c.type,
        data: {
          labels: c.labels,
          datasets: [
            {
              label: 'Língua Portuguesa',
              data: c.dataLP,
              borderColor: '#1565c0',
              backgroundColor: c.type === 'bar' ? '#1565c0' : '#1565c0',
              tension: 0.3, pointRadius: 4, pointHoverRadius: 6, borderWidth: 2, spanGaps: true
            },
            {
              label: 'Matemática',
              data: c.dataMT,
              borderColor: '#e65100',
              backgroundColor: c.type === 'bar' ? '#e65100' : '#e65100',
              tension: 0.3, pointRadius: 4, pointHoverRadius: 6, borderWidth: 2, spanGaps: true
            }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } },
            tooltip: { mode: 'index', intersect: false }
          },
          scales: {
            y: { beginAtZero: false, ticks: { font: { size: 10 }, color: '#888' }, grid: { color: '#f0f0f0' } },
            x: { ticks: { font: { size: 10, weight: 'bold' }, color: '#555' }, grid: { display: false } }
          }
        }
      });
      window.saersBoletimCharts.push(chart);
    });
  };

  // Boletim Builder
  window.abrirBoletim = function(inep) {
    const e = escolas.find(x => x.inep === inep);
    if (!e) return;
    
    if (e.lat && e.lng && S.escolasMap) {
      S.escolasMap.flyTo([e.lat, e.lng], 18, { duration: 1.2 });
    }
    
    const container = document.getElementById('escola-boletim-container');
    container.style.display = 'block';
    
    const f = (val, fmt) => val != null ? fmt(val) : '<span style="color:#ccc">—</span>';
    const getSaersColor = v => {
      if(!v) return '#ccc';
      if(v >= 275) return '#1B5E20'; // avançado approx
      if(v >= 225) return '#00AB4E'; // adequado approx
      if(v >= 175) return '#F57F17'; // basico approx
      return '#C62828'; // abaixo approx
    };

    const cardHtml = (title, icon, rows) => {
      let html = `<div class="chart-card" style="padding:16px;height:100%;display:flex;flex-direction:column">
        <div style="font-size:12px;font-weight:800;color:#0D47A1;text-transform:uppercase;margin-bottom:12px;display:flex;align-items:center;gap:8px"><img src="${icon}" style="width:16px;height:16px;filter:opacity(0.8)"> ${title}</div>
        <div style="flex:1;display:flex;flex-direction:column;gap:4px">`;
      for(const r of rows) {
        if(r.val != null) {
          const badge = r.color ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${r.color};margin-right:6px"></span>` : '';
          html += `<div style="display:flex;justify-content:space-between;align-items:center;font-size:11.5px;padding:4px 0;border-bottom:1px dashed #eee">
            <span style="color:#555">${badge}${r.label}</span>
            <span style="font-weight:700;color:#222">${r.fmt ? r.fmt(r.val) : r.val}</span>
          </div>`;
        }
      }
      html += `</div></div>`;
      return html;
    };

    const simNaoColor = v => v ? '#1B5E20' : '#ccc';

    let cHtml = `
      <div style="background:#fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.08);padding:24px;border:1px solid #e0e0e0;margin-bottom:20px">
        <!-- Header -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;border-bottom:2px solid #f0f0f0;padding-bottom:16px">
          <div>
            <h2 style="margin:0;font-size:24px;font-weight:800;color:#0D47A1;line-height:1.2">${e.nome}</h2>
            <div style="margin-top:8px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
              <span style="background:#e3f2fd;color:#1565c0;padding:4px 10px;border-radius:12px;font-size:11px;font-weight:700">${e.municipio}</span>
              <span style="background:#fff3e0;color:#e65100;padding:4px 10px;border-radius:12px;font-size:11px;font-weight:700">${e.cre}ª CRE</span>
              <span style="background:#f5f5f5;color:#555;padding:4px 10px;border-radius:12px;font-size:11px;font-weight:700">INEP: ${e.inep}</span>
              <span style="color:#888;font-size:11px">${e.loc || 'Urbana'}</span>
            </div>
          </div>
          <button onclick="document.getElementById('escola-boletim-container').style.display='none'" style="background:#f5f5f5;border:none;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#555;font-size:18px;transition:0.2s hover:background:#e0e0e0">&times;</button>
        </div>
        
        <!-- Grid de Seções -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:20px;margin-bottom:24px">
    `;

    // 1. Matrículas e Docentes
    cHtml += `
      <div class="chart-card" style="padding:16px;display:flex;flex-direction:column;background:#fff;border-radius:8px;border:1px solid #eee;box-shadow:0 2px 8px rgba(0,0,0,0.02)">
        <div style="font-size:12px;font-weight:800;color:#0D47A1;text-transform:uppercase;margin-bottom:12px;display:flex;align-items:center;gap:8px">
          <img src="img/icons/matriculas.png" style="width:16px;height:16px;filter:opacity(0.8)"> Matrículas e Docentes (2025)
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:12px;font-size:11px;padding-bottom:8px;border-bottom:1px dashed #eee">
           <div><b>Alunos:</b> <span style="color:#1565c0">${e.mat_total ? e.mat_total.toLocaleString('pt-BR') : '-'}</span></div>
           <div><b>Docentes:</b> <span style="color:#e65100">${e.doc_total ? e.doc_total.toLocaleString('pt-BR') : '-'}</span></div>
           <div><b>Salas:</b> ${e.salas_total || e.salas || '-'}</div>
        </div>
        <div style="height:180px;position:relative;width:100%;flex:1">
          <canvas id="boletim-chart-mat"></canvas>
        </div>
      </div>
    `;

    // 2. Desempenho IDEB
    cHtml += `
      <div class="chart-card" style="padding:16px;display:flex;flex-direction:column;background:#fff;border-radius:8px;border:1px solid #eee;box-shadow:0 2px 8px rgba(0,0,0,0.02)">
        <div style="font-size:12px;font-weight:800;color:#0D47A1;text-transform:uppercase;margin-bottom:12px;display:flex;align-items:center;gap:8px">
          <img src="img/icons/nav_ideb.png" style="width:16px;height:16px;filter:opacity(0.8)"> Desempenho IDEB (2023)
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:12px;font-size:11px;padding-bottom:8px;border-bottom:1px dashed #eee">
           <div><b>Anos Iniciais:</b> <span style="color:${getIdebColor(e.ideb_ai)}">${e.ideb_ai ? e.ideb_ai.toFixed(1) : '-'}</span></div>
           <div><b>Anos Finais:</b> <span style="color:${getIdebColor(e.ideb_af)}">${e.ideb_af ? e.ideb_af.toFixed(1) : '-'}</span></div>
           <div><b>Médio:</b> <span style="color:${getIdebColor(e.ideb_em)}">${e.ideb_em ? e.ideb_em.toFixed(1) : '-'}</span></div>
        </div>
        <div style="height:180px;position:relative;width:100%;flex:1">
          <canvas id="boletim-chart-ideb"></canvas>
        </div>
      </div>
    `;

    // 3. Fluxo Escolar (TDI)
    cHtml += `
      <div class="chart-card" style="padding:16px;display:flex;flex-direction:column;background:#fff;border-radius:8px;border:1px solid #eee;box-shadow:0 2px 8px rgba(0,0,0,0.02)">
        <div style="font-size:12px;font-weight:800;color:#0D47A1;text-transform:uppercase;margin-bottom:12px;display:flex;align-items:center;gap:8px">
          <img src="img/icons/nav_fluxo.png" style="width:16px;height:16px;filter:opacity(0.8)"> Atraso Escolar TDI (2024)
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:12px;font-size:11px;padding-bottom:8px;border-bottom:1px dashed #eee">
           <div><b>Fundamental:</b> <span style="color:#d32f2f">${e.tdi_fund ? e.tdi_fund.toFixed(1)+'%' : '-'}</span></div>
           <div><b>Médio:</b> <span style="color:#d32f2f">${e.tdi_med ? e.tdi_med.toFixed(1)+'%' : '-'}</span></div>
        </div>
        <div style="height:180px;position:relative;width:100%;flex:1">
          <canvas id="boletim-chart-tdi"></canvas>
        </div>
      </div>
    `;

    // Removendo os cards de Fluxo para incluir na seção visual abaixo

    cHtml += cardHtml('Contexto Socioeconômico e Gestão', 'img/icons/social.png', [
      { label: 'Nível Socioeconômico INSE (2023)', val: e.inse_media, fmt: v=>v.toFixed(2) + (e.inse_nivel ? ` (${e.inse_nivel.replace('Nvel','Nível')})` : '') },
      { label: 'Complexidade de Gestão (2025)', val: e.icg_nivel, fmt: v=>`Nível ${v}` }
    ]);

    cHtml += cardHtml('Infraestrutura Escolar (2025)', 'img/icons/sec_infra.png', [
      { label: 'Acesso à Internet / Banda Larga', val: e.internet || e.banda_larga, fmt: v=>v?'Sim':'Não', color: simNaoColor(e.internet || e.banda_larga) },
      { label: 'Computadores p/ Alunos / Lab', val: e.computador || e.lab_info, fmt: v=>v?'Sim':'Não', color: simNaoColor(e.computador || e.lab_info) },
      { label: 'Biblioteca / Sala Leitura', val: e.biblioteca || e.bib_sala_leit, fmt: v=>v?'Sim':'Não', color: simNaoColor(e.biblioteca || e.bib_sala_leit) },
      { label: 'Quadra de Esportes', val: e.quadra, fmt: v=>v?'Sim':'Não', color: simNaoColor(e.quadra) },
      { label: 'Rampas / Acessibilidade', val: e.rampas, fmt: v=>v?'Sim':'Não', color: simNaoColor(e.rampas) }
    ]);

    cHtml += cardHtml('Corpo Docente (2025)', 'img/icons/sec_docentes.png', [
      { label: 'Total de Professores', val: e.doc_total, fmt: v=>v },
      { label: 'Licenciatura Plena', val: e.doc_licen, fmt: v=>v + ' ('+Math.round(v/e.doc_total*100)+'%)' },
      { label: 'Concursados', val: e.doc_concur, fmt: v=>v + ' ('+Math.round(v/e.doc_total*100)+'%)' },
      { label: 'Contratados', val: e.doc_contrat, fmt: v=>v + ' ('+Math.round(v/e.doc_total*100)+'%)' },
      { label: 'Ensino Superior', val: e.doc_sup, fmt: v=>v + ' ('+Math.round(v/e.doc_total*100)+'%)' }
    ]);

    cHtml += `</div>`; // Close grid

    // SEÇÃO FLUXO E RENDIMENTO (Full width inside Boletim)
    cHtml += `
      <div style="background:#fafbfc;border:1px solid #e0e0e0;border-radius:12px;padding:24px;margin-bottom:24px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
          <div style="font-size:16px;font-weight:800;color:#0D47A1;display:flex;align-items:center;gap:8px">
            <img src="img/icons/nav_fluxo.png" style="width:24px;height:24px;filter:opacity(0.9)">
            Fluxo e Rendimento (Evolução Histórica)
          </div>
        </div>
        <div id="boletim-fluxo-content"></div>
      </div>
    `;

    // SEÇÃO SAERS (Full width inside Boletim)
    cHtml += `
      <div style="background:#fafbfc;border:1px solid #e0e0e0;border-radius:12px;padding:24px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
          <div style="font-size:16px;font-weight:800;color:#0D47A1;display:flex;align-items:center;gap:8px">
            <img src="img/icons/nav_saeb.png" style="width:24px;height:24px;filter:opacity(0.9)">
            Desempenho no SAERS
          </div>
          <div>
            <select id="boletim-saers-etapa" onchange="window.renderBoletimSaers('${e.inep}')" style="padding:6px 12px;border-radius:8px;border:1px solid #e0e0e0;font-size:12px;font-family:Inter;background:#fff;cursor:pointer;color:#333;outline:none;margin-right:8px">
              <option value="todas">Todas as Etapas</option>
              <option value="2ef">2º Ano EF</option>
              <option value="5ef">5º Ano EF</option>
              <option value="9ef">9º Ano EF</option>
              <option value="em">Ensino Médio</option>
            </select>
            <select id="boletim-saers-visao" onchange="window.renderBoletimSaers('${e.inep}')" style="padding:6px 12px;border-radius:8px;border:1px solid #e0e0e0;font-size:12px;font-family:Inter;background:#fff;cursor:pointer;color:#333;outline:none;">
              <option value="geral">Visão Geral (Evolução Histórica)</option>
              <option value="raca">Desigualdade: Raça/Cor</option>
              <option value="sexo">Desigualdade: Sexo</option>
            </select>
          </div>
        </div>
        <div id="boletim-saers-content"></div>
      </div>
    </div>`; // close Boletim container card

    container.innerHTML = cHtml;
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });

    window.renderBoletimSaers(e.inep);
    window.renderBoletimMatriculas(e.inep);
    window.renderBoletimIdeb(e.inep);
    window.renderBoletimTdi(e.inep);
    window.renderBoletimFluxo(e.inep);
  };

  window.renderBoletimIdeb = function(inep) {
    const esc = escolas.find(x => x.inep === inep);
    const ctx = document.getElementById('boletim-chart-ideb');
    if (!ctx || !esc) return;
    if (window.boletimIdebChart) { window.boletimIdebChart.destroy(); window.boletimIdebChart = null; }

    const hist = esc.ideb_hist || {};
    const series = [
      { key: 'ideb_ai', label: 'Anos Iniciais', color: '#0D47A1' },
      { key: 'ideb_af', label: 'Anos Finais', color: '#FF9800' },
      { key: 'ideb_em', label: 'Médio', color: '#009639' }
    ];
    const years = [...new Set(series.flatMap(s => Object.keys(hist[s.key] || {})))].sort();
    if (!years.length) {
      ctx.parentElement.innerHTML = '<div style="font-size:11px;color:#888;text-align:center;padding:24px 0">Sem histórico IDEB para esta escola.</div>';
      return;
    }

    window.boletimIdebChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: years,
        datasets: series.filter(s => hist[s.key]).map(s => ({
          label: s.label,
          data: years.map(y => hist[s.key][y] ?? null),
          borderColor: s.color,
          backgroundColor: s.color,
          tension: 0.3,
          pointRadius: 4,
          borderWidth: 2
        }))
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 6, font: { size: 9 } } },
          datalabels: { ...DL_LINE, formatter: v => v != null ? v.toFixed(1) : '' }
        },
        scales: {
          y: { min: 0, max: 10, ticks: { stepSize: 1 } },
          x: { grid: { display: false } }
        }
      }
    });
  };

  window.renderBoletimTdi = function(inep) {
    const esc = escolas.find(x => x.inep === inep);
    const ctx = document.getElementById('boletim-chart-tdi');
    if (!ctx || !esc) return;
    if (window.boletimTdiChart) { window.boletimTdiChart.destroy(); window.boletimTdiChart = null; }

    const hist = esc.tdi_hist || {};
    const years = Object.keys(hist).sort();
    if (!years.length) {
      ctx.parentElement.innerHTML = '<div style="font-size:11px;color:#888;text-align:center;padding:24px 0">Sem histórico TDI para esta escola.</div>';
      return;
    }

    window.boletimTdiChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: years,
        datasets: [
          { label: 'Fundamental', data: years.map(y => hist[y]?.tdi_fund ?? null), borderColor: '#0D47A1', tension: 0.3, pointRadius: 4 },
          { label: 'Médio', data: years.map(y => hist[y]?.tdi_med ?? null), borderColor: '#FF9800', tension: 0.3, pointRadius: 4 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 6, font: { size: 9 } } },
          datalabels: { ...DL_LINE, formatter: v => v != null ? v.toFixed(1) + '%' : '' }
        },
        scales: {
          y: { beginAtZero: true, ticks: { callback: v => v + '%' } },
          x: { grid: { display: false } }
        }
      }
    });
  };

  window.renderBoletimMatriculas = function(inep) {
    const esc = escolas.find(x => x.inep === inep);
    const ctx = document.getElementById('boletim-chart-mat');
    if (!ctx || !esc) return;
    if (window.boletimMatChart) { window.boletimMatChart.destroy(); window.boletimMatChart = null; }

    const hist = esc.mat_hist || {};
    const years = Object.keys(hist).sort();
    if (!years.length) {
      ctx.parentElement.innerHTML = '<div style="font-size:11px;color:#888;text-align:center;padding:24px 0">Sem histórico de matrículas para esta escola.</div>';
      return;
    }

    window.boletimMatChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: years,
        datasets: [{
          label: 'Matrículas',
          data: years.map(y => hist[y]),
          borderColor: '#009639',
          backgroundColor: 'rgba(0,150,57,.12)',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          borderWidth: 2.5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          datalabels: { ...DL_LINE, formatter: v => v != null ? formatNumChart(v) : '' }
        },
        scales: {
          y: {
            beginAtZero: false,
            suggestedMax: Math.max(...years.map(y => hist[y])) * 1.15,
            ticks: { callback: v => formatNumChart(v) }
          },
          x: { grid: { display: false } }
        }
      }
    });
  };
  // Update function
  function updateEscolas() {
    const indicator = document.getElementById('escola-indicator').value;
    const creFilter = document.getElementById('escola-cre-filter').value;
    const munFilter = document.getElementById('escola-mun-filter')?.value || '';
    S.escolaMunSel = munFilter;
    const searchRaw = (document.getElementById('escola-search').value || '').trim();
    const search = searchRaw.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const cfg = ESCOLA_INDICATORS.find(i => i.key === indicator);

    // Filter schools — seleção explícita por INEP (evita duplicatas de nome)
    let filtered = escolas;
    if (creFilter) filtered = filtered.filter(e => e.cre === creFilter);
    if (munFilter) filtered = filtered.filter(e => String(e.cod_mun || e.cod_ibge || '') === munFilter);
    if (S.escolaInepSel) {
      filtered = filtered.filter(e => e.inep === S.escolaInepSel);
    } else if (search) {
      filtered = filtered.filter(e => {
        const nome = (e.nome || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const mun = (e.municipio || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const inep = e.inep || '';
        return nome.includes(search) || mun.includes(search) || inep.includes(search);
      });
    }

    const withVal = filtered.filter(e => e[indicator] != null);
    const vals = withVal.map(e => e[indicator]);
    const avg = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    const minV = vals.length ? Math.min(...vals) : null;
    const maxV = vals.length ? Math.max(...vals) : null;

    const nameCounts = {};
    filtered.forEach(e => { if (e.nome) nameCounts[e.nome] = (nameCounts[e.nome] || 0) + 1; });
    const hasDupNames = Object.values(nameCounts).some(c => c > 1);
    const kpiSub = hasDupNames && !S.escolaInepSel
      ? `<div style="font-size:9px;color:#888;margin-top:4px">${filtered.length} cód. INEP · selecione no menu</div>`
      : S.escolaInepSel
        ? `<div style="font-size:9px;color:#888;margin-top:4px">INEP ${S.escolaInepSel}</div>`
        : '';

    // KPIs
    document.getElementById('escola-kpis').innerHTML = `
      <div class="kpi-card" style="text-align:center;padding:16px;border-radius:12px;background:linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%);box-shadow:0 4px 15px rgba(0,0,0,0.03);border:1px solid #f0f0f0">
        <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;font-weight:700">Escolas (INEP)</div>
        <div style="font-size:26px;font-weight:800;color:#0D47A1;line-height:1">${filtered.length.toLocaleString('pt-BR')}</div>
        ${kpiSub}
      </div>
      <div class="kpi-card" style="text-align:center;padding:16px;border-radius:12px;background:linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%);box-shadow:0 4px 15px rgba(0,0,0,0.03);border:1px solid #f0f0f0">
        <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;font-weight:700">Média ${cfg ? cfg.label.split(' ')[0] : ''}</div>
        <div style="font-size:26px;font-weight:800;color:#00AB4E;line-height:1">${avg != null ? cfg.fmt(avg) : '—'}</div>
        <div style="font-size:10px;color:#999;margin-top:4px">${withVal.length} com dado</div>
      </div>
      <div class="kpi-card" style="text-align:center;padding:16px;border-radius:12px;background:linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%);box-shadow:0 4px 15px rgba(0,0,0,0.03);border:1px solid #f0f0f0">
        <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;font-weight:700">Melhor</div>
        <div style="font-size:26px;font-weight:800;color:#1B5E20;line-height:1">${maxV != null && cfg ? cfg.fmt(cfg.higher ? maxV : minV) : '—'}</div>
      </div>
      <div class="kpi-card" style="text-align:center;padding:16px;border-radius:12px;background:linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%);box-shadow:0 4px 15px rgba(0,0,0,0.03);border:1px solid #f0f0f0">
        <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;font-weight:700">Pior</div>
        <div style="font-size:26px;font-weight:800;color:#C62828;line-height:1">${minV != null && cfg ? cfg.fmt(cfg.higher ? minV : maxV) : '—'}</div>
      </div>
    `;

    // Legend
    const legendEl = document.getElementById('escola-legend');
    const legendItems = getEscolaLegend(indicator);
    legendEl.innerHTML = legendItems.map(l =>
      `<span style="display:inline-flex;align-items:center;gap:3px;font-size:9px;color:#666">
        <span style="width:10px;height:10px;border-radius:50%;background:${l.color};display:inline-block"></span>${l.label}
      </span>`
    ).join('');

    // Lista premium de escolas (CRE ou município filtrado)
    const listPanel = document.getElementById('escola-list-panel');
    if (listPanel) {
      const showList = !S.escolaInepSel && !search && filtered.length > 0 && (creFilter || munFilter);
      if (showList) {
        const title = creFilter
          ? getCreNomeEscola(creFilter)
          : (munMap.get(munFilter) || 'Município');
        const sorted = [...filtered].sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
        const showInnerSearch = sorted.length > ESCOLA_LIST_MAX;

        listPanel.style.display = 'block';
        listPanel.innerHTML = `
          <div class="escola-premium-list">
            <div class="escola-premium-list__head">
              <div>
                <div class="escola-premium-list__title">Escolas — ${title}</div>
                <div class="escola-premium-list__count">${filtered.length} unidade${filtered.length !== 1 ? 's' : ''}${creFilter ? ` · ${creFilter}ª CRE` : ''}</div>
              </div>
              ${showInnerSearch ? '<input type="text" id="escola-list-search" class="escola-premium-list__search" placeholder="Filtrar nesta lista..." autocomplete="off">' : ''}
            </div>
            <div class="escola-premium-list__body" id="escola-premium-list-body">
              ${sorted.map(e => escolaPremiumItemHtml(e, indicator, cfg)).join('')}
            </div>
          </div>`;

        const onSelect = (inep, label) => {
          S.escolaInepSel = inep;
          document.getElementById('escola-search').value = label || '';
          abrirBoletim(inep);
          updateEscolas();
        };
        bindEscolaPremiumList(listPanel, onSelect);

        const innerSearch = document.getElementById('escola-list-search');
        if (innerSearch) {
          innerSearch.addEventListener('input', () => {
            const q = innerSearch.value.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
            const body = document.getElementById('escola-premium-list-body');
            if (!body) return;
            const hits = q
              ? sorted.filter(e => {
                  const nome = (e.nome || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                  const mun = (e.municipio || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                  return nome.includes(q) || mun.includes(q) || (e.inep || '').includes(q);
                })
              : sorted;
            body.innerHTML = hits.map(e => escolaPremiumItemHtml(e, indicator, cfg)).join('');
            bindEscolaPremiumList(body, onSelect);
          });
        }
      } else {
        listPanel.style.display = 'none';
        listPanel.innerHTML = '';
      }
    }

    // Map markers (sempre acima dos contornos CRE)
    S.escolasMarkers.clearLayers();
    const filteredWithCoords = filtered.filter(e => e.lat && e.lng);
    for (const e of filteredWithCoords) {
      const val = e[indicator];
      const color = getEscolaColor(val, indicator);
      const isSelected = S.escolaInepSel === e.inep;
      const marker = L.circleMarker([e.lat, e.lng], {
        radius: isSelected ? 9 : 6,
        fillColor: color,
        fillOpacity: 0.95,
        color: isSelected ? '#0D47A1' : '#1e293b',
        weight: isSelected ? 3 : 2,
        opacity: 1,
      });

      marker.bindTooltip(escolaTooltipHtml(e, indicator, cfg), {
        direction: 'top',
        offset: [0, -8],
        className: 'escola-marker-tip-wrap',
        opacity: 1,
      });
      marker.on('click', () => abrirBoletim(e.inep));
      S.escolasMarkers.addLayer(marker);
    }

    // Contornos CRE abaixo dos pontos
    updateEscolasCreOverlay(map, creFilter);
    if (S.escolasMarkers) S.escolasMarkers.bringToFront();

    // Auto-focus mapa
    if (S.escolaInepSel && filtered.length === 1 && filteredWithCoords.length === 1) {
      const esc = filteredWithCoords[0];
      map.flyTo([esc.lat, esc.lng], 18, { duration: 1.2 });
      abrirBoletim(esc.inep);
    } else if (search && !S.escolaInepSel && filtered.length === 1 && filteredWithCoords.length === 1) {
      const esc = filteredWithCoords[0];
      map.flyTo([esc.lat, esc.lng], 18, { duration: 1.2 });
      abrirBoletim(esc.inep);
    } else if ((munFilter || creFilter) && filteredWithCoords.length > 0 && !search && !S.escolaInepSel) {
      const bounds = L.latLngBounds(filteredWithCoords.map(e => [e.lat, e.lng]));
      map.fitBounds(bounds.pad(0.12));
    }
  }

  // Bind events
  document.getElementById('escola-indicator').addEventListener('change', updateEscolas);
  document.getElementById('escola-cre-filter').addEventListener('change', () => {
    S.escolaInepSel = null;
    document.getElementById('escola-search').value = '';
    document.getElementById('escola-boletim-container').style.display = 'none';
    updateEscolas();
  });
  document.getElementById('escola-mun-filter').addEventListener('change', () => {
    S.escolaInepSel = null;
    document.getElementById('escola-search').value = '';
    document.getElementById('escola-boletim-container').style.display = 'none';
    updateEscolas();
  });
  let searchTimeout;
  document.getElementById('escola-search').addEventListener('input', (e) => {
    S.escolaInepSel = null;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(updateEscolas, 300);

    // Autocomplete Logic
    const autocompleteBox = document.getElementById('escola-autocomplete');
    if (!autocompleteBox) return;
    const val = (e.target.value || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (val.length < 3) {
      autocompleteBox.style.display = 'none';
      return;
    }
    const creFilter = document.getElementById('escola-cre-filter').value;
    const munFilter = document.getElementById('escola-mun-filter')?.value || '';
    let filtered = S.escolasData.escolas || [];
    if (creFilter) filtered = filtered.filter(x => x.cre === creFilter);
    if (munFilter) filtered = filtered.filter(x => String(x.cod_mun || x.cod_ibge || '') === munFilter);
    filtered = filtered.filter(x => {
      const nome = (x.nome || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const mun = (x.municipio || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const inep = x.inep || '';
      return nome.includes(val) || mun.includes(val) || inep.includes(val);
    }).slice(0, 50);

    if (filtered.length === 0) {
      autocompleteBox.innerHTML = '<div class="escola-ac-empty">Nenhuma escola encontrada</div>';
    } else {
      const ind = document.getElementById('escola-indicator')?.value || 'ideb_af';
      const indCfg = ESCOLA_INDICATORS.find(i => i.key === ind);
      autocompleteBox.innerHTML = filtered.map(x => {
        const val = x[ind];
        const valStr = val != null && indCfg ? indCfg.fmt(val) : null;
        const color = getEscolaColor(val, ind);
        return `<button type="button" class="escola-ac-item" data-inep="${x.inep}" data-label="${(x.nome || '').replace(/"/g, '&quot;')} · ${x.municipio || ''}">
          <span class="escola-ac-item__dot" style="background:${color}"></span>
          <span class="escola-ac-item__body">
            <span class="escola-ac-item__name">${x.nome}</span>
            <span class="escola-ac-item__meta">${x.municipio} · ${x.cre}ª CRE · INEP ${x.inep}</span>
          </span>
          ${valStr ? `<span class="escola-ac-item__badge">${valStr}</span>` : ''}
        </button>`;
      }).join('');

      autocompleteBox.querySelectorAll('.escola-ac-item').forEach(el => {
        el.addEventListener('click', () => {
          S.escolaInepSel = el.dataset.inep;
          document.getElementById('escola-search').value = el.dataset.label;
          autocompleteBox.style.display = 'none';
          abrirBoletim(el.dataset.inep);
          updateEscolas();
        });
      });
    }
    autocompleteBox.style.display = 'block';
  });

  // Close autocomplete on outside click
  document.addEventListener('click', (e) => {
    const ac = document.getElementById('escola-autocomplete');
    const input = document.getElementById('escola-search');
    if (ac && input && !input.contains(e.target) && !ac.contains(e.target)) {
      ac.style.display = 'none';
    }
  });

  // Initial render
  updateEscolas();
}

// ══════════════════════════════════════════════════════════
// SEÇÃO: SAERS — Avaliação Estadual do RS
// ══════════════════════════════════════════════════════════

const FONTE_SAERS = 'Fonte: ' + fonteLink(URL_SAERS, 'SAERS/CAEd — Avaliação do Estado do Rio Grande do Sul', 'Acessar o portal do SAERS (CAEd)');

function renderSaers() {
  const main = document.getElementById('main-content');
  destroyCharts(); destroyMap();
  document.body.classList.remove('sidebar-hidden');

  const sd = S.saersData;
  if (!sd || !sd.anos || !sd.anos.length) {
    main.innerHTML = `
      <div class="section-sticky">
        ${sectionBanner('img/icons/sec_saeb.png', 'SAERS', getRedeLabel() + ' do RS')}
        ${redeToggleHTML(['federal', 'filantropica', 'privada'], 'O SAERS avalia apenas escolas das redes estadual e municipal')}
      </div>
      <div style="text-align:center;padding:60px 20px;color:var(--text-sec);">
        <p style="font-size:1.1rem;font-weight:600;">Dados SAERS não disponíveis para a ${getRedeLabel()}</p>
        <p style="font-size:0.85rem;margin-top:8px;">O SAERS avalia apenas escolas das redes estadual e municipal.</p>
      </div>`;
    bindRedeToggle();
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

  // Determine which etapas actually have data for this rede (used in HTML template)
  const latestYear = sd.anos.find(a => a.ano === anoSel) || sd.anos[sd.anos.length - 1];
  const renderableEtapas = ETAPAS.filter(etapa =>
    latestYear?.geral?.[`${etapa}_LP`] || latestYear?.geral?.[`${etapa}_MT`]
  );


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
      ${sectionBanner('img/icons/sec_saeb.png', 'SAERS', getRedeLabel() + ' do RS')}
      ${redeToggleHTML(['federal', 'filantropica', 'privada'], 'O SAERS avalia apenas escolas das redes estadual e municipal')}
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
            <p style="font-size:10.5px;margin:0;color:#14507F;line-height:1.7">
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

    <div class="charts-grid" id="saers-kpi-cards"></div>

    <!-- ═══ EIXO: Proficiência — Série Histórica ═══ -->
    <div class="section-divider" style="margin-top:20px">
      <span class="section-divider-icon"><img src="img/icons/sec_evolucao.png" alt=""></span>
      <span class="section-divider-text">Proficiência SAERS — Série Histórica (${anos[0]}–${anos[anos.length-1]})</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px" id="saers-serie-charts">
      <div style="grid-column:1/-1;font-size:10px;color:var(--text-sec);font-style:italic;margin:-4px 0 2px;padding-left:2px">💡 Clique na legenda para mostrar / ocultar os referidos dados.</div>
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
        <div class="chart-title" id="saers-padrao-lp-title">Distribuição — Língua Portuguesa — ${anoSel}${geoSuffix()}</div>
        <div style="height:250px"><canvas id="chart-saers-padrao-lp"></canvas></div>
        <div class="chart-source">${FONTE_SAERS}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title" id="saers-padrao-mt-title">Distribuição — Matemática — ${anoSel}${geoSuffix()}</div>
        <div style="height:250px"><canvas id="chart-saers-padrao-mt"></canvas></div>
        <div class="chart-source">${FONTE_SAERS}</div>
      </div>
    </div>

    <!-- ═══ EIXO: Distribuição Territorial ═══ -->
    <div class="section-divider" style="margin-top:20px">
      <span class="section-divider-icon"><img src="img/icons/territorial.png" alt=""></span>
      <span class="section-divider-text">${territorialDividerText()}</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="map-table-row">
      <div class="map-container">
        <div class="map-toolbar">
          <h3>Mapa SAERS — <span id="saers-map-ano">${anoSel}</span></h3>
          <div class="map-layer-toggle">
            <button class="map-layer-btn active" id="saers-btn-layer-mun">Municípios</button>
            <button class="map-layer-btn" id="saers-btn-layer-cre">CREs</button>
            ${S.saersEscolasData ? '<button class="map-layer-btn" id="saers-btn-layer-escola">Escolas</button>' : ''}
          </div>
          <select id="sel-saers-map-metric" style="font-size:10px;padding:4px 8px;border-radius:4px;border:1px solid #ccc">
            <optgroup label="Proficiência">
              <option value="LP">Proficiência LP</option>
              <option value="MT">Proficiência MT</option>
            </optgroup>
            <optgroup label="Língua Portuguesa — Padrão">
              <option value="avancado_LP">% Avançado LP</option>
              <option value="adequado_LP">% Adequado LP</option>
              <option value="basico_LP">% Básico LP</option>
              <option value="abaixo_LP">% Abaixo do Básico LP</option>
            </optgroup>
            <optgroup label="Matemática — Padrão">
              <option value="avancado_MT">% Avançado MT</option>
              <option value="adequado_MT">% Adequado MT</option>
              <option value="basico_MT">% Básico MT</option>
              <option value="abaixo_MT">% Abaixo do Básico MT</option>
            </optgroup>
          </select>
          <select id="sel-saers-map-etapa" style="font-size:10px;padding:4px 8px;border-radius:4px;border:1px solid #ccc">
            ${renderableEtapas.map(e => `<option value="${e}">${ETAPA_LABELS[e]}</option>`).join('')}
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
              <th>#</th><th>Município</th><th>Prof. LP</th><th>Prof. MT</th><th>%Av. LP</th><th>%Ad. LP</th><th>%Bás. LP</th><th>%Ab. LP</th><th>%Av. MT</th><th>%Ad. MT</th><th>%Bás. MT</th><th>%Ab. MT</th><th>Avaliados</th>
            </tr></thead>
            <tbody id="saers-mun-tbody"></tbody>
          </table>
        </div>
        <div class="chart-source">${FONTE_SAERS}</div>
      </div>
    </div>



  `;

  // ── Populate banner filters (standard, like all other sections) ──
  const selAno = document.getElementById('sel-ano');
  if (selAno) {
    selAno.innerHTML = anos.map(a => `<option value="${a}" ${a === anoSel ? 'selected' : ''}>${a}</option>`).join('');
    S.anoSel = String(anoSel);
  }
  // Merge SAERS mun_lookup into universal lookup so the standard dropdown works
  if (sd.anos[0]?.mun_lookup) {
    if (!S._universalMunLookup) S._universalMunLookup = {};
    Object.assign(S._universalMunLookup, sd.anos[0].mun_lookup);
  }
  // Populate CRE dropdown
  const selCre = document.getElementById('sel-cre');
  if (selCre && sd.anos[0]?.cre_lookup) {
    selCre.innerHTML = '<option value="">Todas</option>' +
      Object.entries(sd.anos[0].cre_lookup)
        .sort(([a],[b]) => a.localeCompare(b))
        .map(([cod, nome]) => `<option value="${cod}" ${S.creSel === cod ? 'selected' : ''}>${nome}</option>`).join('');
  }
  // Use standard municipality dropdown + topbar filter bindings
  populateMunDropdown(S.creSel || null);
  bindTopbarFilters();

  // Search in table
  document.getElementById('saers-mun-search')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('#saers-mun-tbody tr').forEach(tr => {
      const nome = tr.children[1]?.textContent.toLowerCase() || '';
      tr.style.display = nome.includes(q) ? '' : 'none';
    });
  });

  // Bind map metric/etapa selects
  document.getElementById('sel-saers-map-metric')?.addEventListener('change', () => {
    if (S.saersMapMode === 'escola') { buildSaersEscolaMap(sd); buildSaersEscolaTable(sd); }
    else buildSaersMap(sd);
  });
  document.getElementById('sel-saers-map-etapa')?.addEventListener('change', () => {
    if (S.saersMapMode === 'escola') { buildSaersEscolaMap(sd); buildSaersEscolaTable(sd); }
    else buildSaersMap(sd);
  });

  // Map layer toggle (Municípios / CREs / Escolas)
  const saersBtnMun = document.getElementById('saers-btn-layer-mun');
  const saersBtnCre = document.getElementById('saers-btn-layer-cre');
  const saersBtnEsc = document.getElementById('saers-btn-layer-escola');
  const saersToggleBtns = [saersBtnMun, saersBtnCre, saersBtnEsc].filter(Boolean);
  const saersSetActive = (btn) => saersToggleBtns.forEach(b => b.classList.toggle('active', b === btn));

  if (saersBtnMun) {
    saersBtnMun.addEventListener('click', () => {
      S.saersMapMode = 'mun';
      saersSetActive(saersBtnMun);
      // Restore mun table headers
      const thead = document.querySelector('#saers-mun-table thead tr');
      if (thead) thead.innerHTML = '<th>#</th><th>Município</th><th>Prof. LP</th><th>Prof. MT</th><th>%Av. LP</th><th>%Ad. LP</th><th>%Bás. LP</th><th>%Ab. LP</th><th>%Av. MT</th><th>%Ad. MT</th><th>%Bás. MT</th><th>%Ab. MT</th><th>Avaliados</th>';
      const titleEl = document.querySelector('#saers-table-wrapper .table-header h3');
      if (titleEl) titleEl.textContent = 'Tabela por Município';
      const searchEl = document.getElementById('saers-mun-search');
      if (searchEl) { searchEl.value = ''; searchEl.placeholder = 'Buscar...'; }
      buildSaersAll(sd);
    });
  }
  if (saersBtnCre) {
    saersBtnCre.addEventListener('click', () => {
      S.saersMapMode = 'cre';
      saersSetActive(saersBtnCre);
      buildSaersMap(sd);
    });
  }
  if (saersBtnEsc) {
    saersBtnEsc.addEventListener('click', () => {
      S.saersMapMode = 'escola';
      saersSetActive(saersBtnEsc);
      buildSaersEscolaMap(sd);
      buildSaersEscolaTable(sd);
    });
  }

  // ── SAERS escola map builder ──
  function buildSaersEscolaMap(sd) {
    if (!S.saersEscolasData) return;
    destroyMap();
    const mapEl = document.getElementById('map-leaflet');
    if (!mapEl) return;

    const metric = document.getElementById('sel-saers-map-metric')?.value || 'LP';
    const etapa = document.getElementById('sel-saers-map-etapa')?.value || '5_EF';
    const anoSel = document.getElementById('sel-saers-map-ano')?.textContent || sd.anos[sd.anos.length - 1]?.ano?.toString() || '2025';
    const anoData = S.saersEscolasData.anos?.[anoSel];
    if (!anoData) return;

    const porEscola = anoData.por_escola || {};
    const escolaLookup = anoData.escola_lookup || {};
    const escolas = S.escolasData?.escolas || [];

    // Build lookup INEP → coords
    const coordMap = {};
    escolas.forEach(e => { if (e.lat && e.lng) coordMap[e.inep] = e; });

    S.map = L.map('map-leaflet', { zoomControl: true, scrollWheelZoom: true, attributionControl: false })
      .setView([-29.7, -53.5], 6.5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', { maxZoom: 14 }).addTo(S.map);

    // Color scale for proficiency
    const getColor = (v) => {
      if (v == null) return '#ccc';
      if (metric === 'pctLP' || metric === 'pctMT') {
        return v >= 70 ? '#2874A6' : v >= 50 ? '#66BB6A' : v >= 30 ? '#FFCB04' : '#E53935';
      }
      return v >= 275 ? '#2874A6' : v >= 225 ? '#66BB6A' : v >= 175 ? '#FFCB04' : '#E53935';
    };

    const markers = L.featureGroup();
    let count = 0;
    for (const [inep, dados] of Object.entries(porEscola)) {
      const coord = coordMap[inep];
      if (!coord) continue;
      const info = escolaLookup[inep] || {};
      
      // Filter by CRE/Mun
      if (S.creSel && info.cre !== S.creSel) continue;
      if (S.munSel && info.cod_mun !== S.munSel) continue;

      const keyLP = `${etapa}_LP`;
      const keyMT = `${etapa}_MT`;
      const dLP = dados[keyLP];
      const dMT = dados[keyMT];

      let val;
      if (metric === 'LP') val = dLP?.proficiencia;
      else if (metric === 'MT') val = dMT?.proficiencia;
      else if (metric.match(/^(avancado|adequado|basico|abaixo)_/)) {
        const padKey = metric.split('_')[0];
        const d = metric.endsWith('_LP') ? dLP : dMT;
        if (d?.padrao) {
          const total = (d.padrao.avancado||0) + (d.padrao.adequado||0) + (d.padrao.basico||0) + (d.padrao.abaixo||0);
          val = total > 0 ? round2((d.padrao[padKey]||0) / total * 100) : null;
        }
      }

      if (val == null) continue;
      count++;

      const marker = L.circleMarker([coord.lat, coord.lng], {
        radius: 4, fillColor: getColor(val), color: '#fff', weight: 1, fillOpacity: 0.85,
      });
      const fmtV = v => v != null ? (metric.startsWith('pct') ? v.toFixed(1) + '%' : v.toFixed(1)) : '—';
      marker.bindPopup(`
        <div style="font-family:Inter;min-width:220px">
          <strong style="font-size:12px">${info.nome || coord.nome}</strong><br>
          <span style="font-size:10px;color:#666">${coord.municipio || ''} — INEP: ${inep}</span>
          <hr style="margin:4px 0;border:none;border-top:1px solid #eee">
          <div style="font-size:10px;display:grid;grid-template-columns:1fr 1fr;gap:2px">
            <span>Prof. LP: <b>${fmtV(dLP?.proficiencia)}</b></span>
            <span>Prof. MT: <b>${fmtV(dMT?.proficiencia)}</b></span>
            <span style="color:#00AB4E">%Av. LP: <b>${dLP?.padrao ? ((dLP.padrao.avancado||0)/((dLP.padrao.avancado||0)+(dLP.padrao.adequado||0)+(dLP.padrao.basico||0)+(dLP.padrao.abaixo||0))*100).toFixed(1)+'%' : '—'}</b></span>
            <span style="color:#0097A7">%Ad. LP: <b>${dLP?.padrao ? ((dLP.padrao.adequado||0)/((dLP.padrao.avancado||0)+(dLP.padrao.adequado||0)+(dLP.padrao.basico||0)+(dLP.padrao.abaixo||0))*100).toFixed(1)+'%' : '—'}</b></span>
            <span style="color:#00AB4E">%Av. MT: <b>${dMT?.padrao ? ((dMT.padrao.avancado||0)/((dMT.padrao.avancado||0)+(dMT.padrao.adequado||0)+(dMT.padrao.basico||0)+(dMT.padrao.abaixo||0))*100).toFixed(1)+'%' : '—'}</b></span>
            <span style="color:#0097A7">%Ad. MT: <b>${dMT?.padrao ? ((dMT.padrao.adequado||0)/((dMT.padrao.avancado||0)+(dMT.padrao.adequado||0)+(dMT.padrao.basico||0)+(dMT.padrao.abaixo||0))*100).toFixed(1)+'%' : '—'}</b></span>
            <span>Avaliados LP: <b>${dLP?.avaliados || '—'}</b></span>
            <span>Avaliados MT: <b>${dMT?.avaliados || '—'}</b></span>
          </div>
        </div>
      `);
      marker.addTo(markers);
    }
    markers.addTo(S.map);
    if (count) S.map.fitBounds(markers.getBounds().pad(0.05));
  }

  // ── SAERS escola table builder ──
  function buildSaersEscolaTable(sd) {
    if (!S.saersEscolasData) return;
    const tableWrapper = document.getElementById('saers-table-wrapper');
    if (!tableWrapper) return;

    const ETAPAS_ALL = ['2_EF', '5_EF', '9_EF', '3_EM'];
    const ETAPA_LBL = S.saersEscolasData.etapa_labels || sd.etapa_labels || {};
    const anoSel = document.getElementById('sel-saers-map-ano')?.textContent || sd.anos[sd.anos.length - 1]?.ano?.toString() || '2025';
    const anoData = S.saersEscolasData.anos?.[anoSel];
    if (!anoData) return;

    const porEscola = anoData.por_escola || {};
    const escolaLookup = anoData.escola_lookup || {};
    const coordMap = {};
    (S.escolasData?.escolas || []).forEach(e => { coordMap[e.inep] = e; });

    const etapasDisp = ETAPAS_ALL.filter(et =>
      Object.values(porEscola).some(d => d[`${et}_LP`] || d[`${et}_MT`])
    );

    const rows = [];
    for (const [inep, dados] of Object.entries(porEscola)) {
      const info = escolaLookup[inep] || {};
      const coord = coordMap[inep];
      if (S.creSel && info.cre !== S.creSel) continue;
      if (S.munSel && info.cod_mun !== S.munSel) continue;
      const r = { inep, nome: info.nome || coord?.nome || inep, municipio: coord?.municipio || '' };
      let hasData = false;
      etapasDisp.forEach(et => {
        const dLP = dados[`${et}_LP`], dMT = dados[`${et}_MT`];
        r[`${et}_profLP`] = dLP?.proficiencia;
        r[`${et}_profMT`] = dMT?.proficiencia;
        // Individual padrao percentages
        ['LP', 'MT'].forEach(disc => {
          const d = disc === 'LP' ? dLP : dMT;
          if (d?.padrao) {
            const tot = (d.padrao.avancado||0)+(d.padrao.adequado||0)+(d.padrao.basico||0)+(d.padrao.abaixo||0);
            r[`${et}_pctAv${disc}`] = tot > 0 ? round2((d.padrao.avancado||0)/tot*100) : null;
            r[`${et}_pctAd${disc}`] = tot > 0 ? round2((d.padrao.adequado||0)/tot*100) : null;
            r[`${et}_pctBa${disc}`] = tot > 0 ? round2((d.padrao.basico||0)/tot*100) : null;
            r[`${et}_pctAb${disc}`] = tot > 0 ? round2((d.padrao.abaixo||0)/tot*100) : null;
          }
        });
        if (dLP || dMT) hasData = true;
      });
      if (hasData) rows.push(r);
    }

    const fmtV = v => v != null ? v.toFixed(1) : '—';
    const fmtP = v => v != null ? v.toFixed(1) + '%' : '—';
    const pctClr = v => v != null && v >= 50 ? '#27AE60' : '#E53935';

    const titleEl = tableWrapper.querySelector('.table-header h3');
    if (titleEl) titleEl.textContent = `Tabela por Escola — Todas as Etapas (${anoSel})`;
    const searchEl = document.getElementById('saers-mun-search');
    if (searchEl) { searchEl.value = ''; searchEl.placeholder = 'Buscar escola...'; }

    const tbody = document.getElementById('saers-mun-tbody');
    const theadEl = document.querySelector('#saers-mun-table thead');
    if (!tbody || !theadEl) return;

    let hdr1 = '<th class="sticky-col sticky-col-0" rowspan="2" style="min-width:32px">#</th>';
    hdr1 += '<th class="sticky-col sticky-col-1" rowspan="2" style="min-width:200px;cursor:pointer" data-col="nome">Escola ⇅</th>';
    hdr1 += '<th rowspan="2" style="cursor:pointer;min-width:90px" data-col="municipio">Município ⇅</th>';
    etapasDisp.forEach(et => {
      hdr1 += `<th colspan="10" style="text-align:center;background:rgba(29,113,185,.08);border-left:2px solid var(--pri);font-size:10px">${ETAPA_LBL[et] || et}</th>`;
    });
    let hdr2 = '';
    etapasDisp.forEach(et => {
      hdr2 += `<th style="font-size:8px;border-left:2px solid var(--pri);cursor:pointer;white-space:nowrap" data-col="${et}_profLP">LP ⇅</th>`;
      hdr2 += `<th style="font-size:8px;cursor:pointer;white-space:nowrap" data-col="${et}_profMT">MT ⇅</th>`;
      hdr2 += `<th style="font-size:7px;cursor:pointer;white-space:nowrap;color:#00AB4E" data-col="${et}_pctAvLP">%Av LP</th>`;
      hdr2 += `<th style="font-size:7px;cursor:pointer;white-space:nowrap;color:#0097A7" data-col="${et}_pctAdLP">%Ad LP</th>`;
      hdr2 += `<th style="font-size:7px;cursor:pointer;white-space:nowrap;color:#B8860B" data-col="${et}_pctBaLP">%Bs LP</th>`;
      hdr2 += `<th style="font-size:7px;cursor:pointer;white-space:nowrap;color:#EE302F" data-col="${et}_pctAbLP">%Ab LP</th>`;
      hdr2 += `<th style="font-size:7px;cursor:pointer;white-space:nowrap;color:#00AB4E" data-col="${et}_pctAvMT">%Av MT</th>`;
      hdr2 += `<th style="font-size:7px;cursor:pointer;white-space:nowrap;color:#0097A7" data-col="${et}_pctAdMT">%Ad MT</th>`;
      hdr2 += `<th style="font-size:7px;cursor:pointer;white-space:nowrap;color:#B8860B" data-col="${et}_pctBaMT">%Bs MT</th>`;
      hdr2 += `<th style="font-size:7px;cursor:pointer;white-space:nowrap;color:#EE302F" data-col="${et}_pctAbMT">%Ab MT</th>`;
    });
    theadEl.innerHTML = `<tr>${hdr1}</tr><tr>${hdr2}</tr>`;

    let sortCol = etapasDisp.length > 0 ? `${etapasDisp[0]}_profLP` : 'nome';
    let sortAsc = false;
    rows.sort((a, b) => (b[sortCol] || 0) - (a[sortCol] || 0));

    const renderRows = () => {
      tbody.innerHTML = rows.map((r, i) => {
        let h = `<tr><td class="sticky-col sticky-col-0">${i+1}</td>`;
        h += `<td class="sticky-col sticky-col-1" style="font-size:10px;min-width:200px;white-space:normal;word-break:break-word;line-height:1.3">${r.nome}</td>`;
        h += `<td style="font-size:10px">${r.municipio}</td>`;
        etapasDisp.forEach(et => {
          h += `<td style="font-weight:600;border-left:2px solid rgba(29,113,185,.15)">${fmtV(r[`${et}_profLP`])}</td>`;
          h += `<td style="font-weight:600">${fmtV(r[`${et}_profMT`])}</td>`;
          h += `<td style="font-weight:600;color:#00AB4E">${fmtP(r[`${et}_pctAvLP`])}</td>`;
          h += `<td style="font-weight:600;color:#0097A7">${fmtP(r[`${et}_pctAdLP`])}</td>`;
          h += `<td style="font-weight:600;color:#B8860B">${fmtP(r[`${et}_pctBaLP`])}</td>`;
          h += `<td style="font-weight:600;color:#EE302F">${fmtP(r[`${et}_pctAbLP`])}</td>`;
          h += `<td style="font-weight:600;color:#00AB4E">${fmtP(r[`${et}_pctAvMT`])}</td>`;
          h += `<td style="font-weight:600;color:#0097A7">${fmtP(r[`${et}_pctAdMT`])}</td>`;
          h += `<td style="font-weight:600;color:#B8860B">${fmtP(r[`${et}_pctBaMT`])}</td>`;
          h += `<td style="font-weight:600;color:#EE302F">${fmtP(r[`${et}_pctAbMT`])}</td>`;
        });
        return h + '</tr>';
      }).join('');
    };
    renderRows();

    const tableEl = document.getElementById('saers-mun-table');
    if (tableEl) {
      const scrollDiv = tableEl.closest('div[style*="overflow"]') || tableEl.parentElement;
      if (scrollDiv) { scrollDiv.style.overflowX = 'auto'; scrollDiv.style.position = 'relative'; }
    }

    document.querySelectorAll('#saers-mun-table th[data-col]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.col;
        if (sortCol === key) sortAsc = !sortAsc;
        else { sortCol = key; sortAsc = (key === 'nome' || key === 'municipio'); }
        rows.sort((a, b) => {
          const va = typeof a[key] === 'string' ? (a[key] || '') : (a[key] ?? -1);
          const vb = typeof b[key] === 'string' ? (b[key] || '') : (b[key] ?? -1);
          return sortAsc ? (typeof va === 'string' ? va.localeCompare(vb) : va - vb) : (typeof va === 'string' ? vb.localeCompare(va) : vb - va);
        });
        renderRows();
      });
    });

    if (searchEl) {
      searchEl.oninput = () => {
        const q = searchEl.value.toLowerCase();
        tbody.querySelectorAll('tr').forEach(tr => {
          const nome = (tr.children[1]?.textContent || '').toLowerCase();
          const mun = (tr.children[2]?.textContent || '').toLowerCase();
          tr.style.display = (nome.includes(q) || mun.includes(q)) ? '' : 'none';
        });
      };
    }
  }

  // ── Build all ──
  // Register escola builders globally for buildSaersAll access
  S._saersEscolaMap = buildSaersEscolaMap;
  S._saersEscolaTable = buildSaersEscolaTable;
  bindRedeToggle();
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
  // Determine which etapas actually have data for this rede
  const availableEtapas = ETAPAS.filter(etapa => {
    return curYearData?.geral?.[`${etapa}_LP`] || curYearData?.geral?.[`${etapa}_MT`];
  });
  const numCols = availableEtapas.length || 4;
  // Reorder KPIs: LP row first (top), MT row second (bottom)
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
    kpiContainer.style.display = 'grid';
    kpiContainer.style.gridTemplateColumns = `repeat(${numCols}, 1fr)`;
    kpiContainer.style.gap = '10px';
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
  const ETAPA_CHART_TITLES = { '2_EF': '2º ano EF', '5_EF': '5º ano EF', '9_EF': '9º ano EF', '3_EM': '3ª série EM' };

  // Inject chart canvases dynamically based on available etapas
  const serieContainer = document.getElementById('saers-serie-charts');
  if (serieContainer) {
    availableEtapas.forEach(et => {
      const card = document.createElement('div');
      card.className = 'chart-card';
      card.innerHTML = `
        <div class="chart-title">${ETAPA_CHART_TITLES[et]} — Evolução LP e MT${geoSuffix()}</div>
        <div style="height:260px"><canvas id="${ETAPA_CANVASES[et]}"></canvas></div>
        <div class="chart-source">${FONTE_SAERS}</div>`;
      serieContainer.appendChild(card);
    });
  }

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

  availableEtapas.forEach(et => buildSaersEtapaChart(et));

  // Aliases for compatibility with comparativo/padrão sections
  const etapas = availableEtapas;
  const etapaLabels = availableEtapas.map(e => ETAPA_LABELS[e]);
  const etapaCores = availableEtapas.map(e => ETAPA_COLORS[e]);

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
  if (S.saersMapMode === 'escola' && S._saersEscolaMap) {
    S._saersEscolaMap(sd);
    if (S._saersEscolaTable) S._saersEscolaTable(sd);
  } else {
    buildSaersMunTable(yearData, '');
    buildSaersMap(sd);
  }

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
  const disc = (metric === 'LP' || metric.endsWith('_LP')) ? 'LP' : 'MT';
  const key = `${etapa}_${disc}`;
  const isPct = metric !== 'LP' && metric !== 'MT';

  const ETAPA_LABELS = sd.etapa_labels;
  const padLabels = { avancado: '% Avançado', adequado: '% Adequado', basico: '% Básico', abaixo: '% Abaixo Básico' };
  const metricLabel = metric.match(/^(avancado|adequado|basico|abaixo)_/) ? padLabels[metric.split('_')[0]] : (isPct ? '% Adeq.+Av.' : 'Proficiência');
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
      let val;
      if (metric === 'LP' || metric === 'MT') val = d.proficiencia;
      else if (metric.match(/^(avancado|adequado|basico|abaixo)_/)) {
        const padKey = metric.split('_')[0];
        const total = (d.padrao?.avancado||0) + (d.padrao?.adequado||0) + (d.padrao?.basico||0) + (d.padrao?.abaixo||0);
        val = total > 0 ? round2((d.padrao?.[padKey]||0) / total * 100) : null;
      } else val = d.padrao?.pct_adequado_avancado;
      const paddedCode = codCre.padStart(2, '0');
      if (val != null) { dataMap[paddedCode] = val; vals.push(val); }
    }
  } else {
    // Municipality mode
    for (const [cod, munData] of Object.entries(yearData.por_municipio)) {
      const d = munData[key];
      if (!d) continue;
      let val;
      if (metric === 'LP' || metric === 'MT') val = d.proficiencia;
      else if (metric.match(/^(avancado|adequado|basico|abaixo)_/)) {
        const padKey = metric.split('_')[0];
        const total = (d.padrao?.avancado||0) + (d.padrao?.adequado||0) + (d.padrao?.basico||0) + (d.padrao?.abaixo||0);
        val = total > 0 ? round2((d.padrao?.[padKey]||0) / total * 100) : null;
      } else val = d.padrao?.pct_adequado_avancado;
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
    let lpAv = 0, lpAd = 0, lpBa = 0, lpAb = 0, lpTotal = 0;
    let mtAv = 0, mtAd = 0, mtBa = 0, mtAb = 0, mtTotal = 0;
    let avaliados = 0;

    etapas.forEach(etapa => {
      const lp = munData[`${etapa}_LP`];
      if (lp) {
        if (lp.proficiencia != null) { lpSum += lp.proficiencia * lp.n_proficiencia; lpN += lp.n_proficiencia; }
        if (lp.padrao) {
          lpAv += lp.padrao.avancado || 0; lpAd += lp.padrao.adequado || 0;
          lpBa += lp.padrao.basico || 0; lpAb += lp.padrao.abaixo || 0;
          lpTotal += (lp.padrao.avancado || 0) + (lp.padrao.adequado || 0) + (lp.padrao.basico || 0) + (lp.padrao.abaixo || 0);
        }
        avaliados += lp.avaliados || 0;
      }
      const mt = munData[`${etapa}_MT`];
      if (mt) {
        if (mt.proficiencia != null) { mtSum += mt.proficiencia * mt.n_proficiencia; mtN += mt.n_proficiencia; }
        if (mt.padrao) {
          mtAv += mt.padrao.avancado || 0; mtAd += mt.padrao.adequado || 0;
          mtBa += mt.padrao.basico || 0; mtAb += mt.padrao.abaixo || 0;
          mtTotal += (mt.padrao.avancado || 0) + (mt.padrao.adequado || 0) + (mt.padrao.basico || 0) + (mt.padrao.abaixo || 0);
        }
      }
    });

    // Compute individual padrao percentages
    const pctCalc = (count, total) => total > 0 ? round2(count / total * 100) : null;
    return {
      cod, nome: yearData.mun_lookup?.[cod] || cod,
      profLP: lpN > 0 ? round2(lpSum / lpN) : null,
      profMT: mtN > 0 ? round2(mtSum / mtN) : null,
      pctAvLP: pctCalc(lpAv, lpTotal), pctAdLP: pctCalc(lpAd, lpTotal),
      pctBaLP: pctCalc(lpBa, lpTotal), pctAbLP: pctCalc(lpAb, lpTotal),
      pctAvMT: pctCalc(mtAv, mtTotal), pctAdMT: pctCalc(mtAd, mtTotal),
      pctBaMT: pctCalc(mtBa, mtTotal), pctAbMT: pctCalc(mtAb, mtTotal),
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
      <td style="color:#00AB4E">${r.pctAvLP != null ? r.pctAvLP.toFixed(1) + '%' : '—'}</td>
      <td style="color:#0097A7">${r.pctAdLP != null ? r.pctAdLP.toFixed(1) + '%' : '—'}</td>
      <td style="color:#B8860B">${r.pctBaLP != null ? r.pctBaLP.toFixed(1) + '%' : '—'}</td>
      <td style="color:#EE302F">${r.pctAbLP != null ? r.pctAbLP.toFixed(1) + '%' : '—'}</td>
      <td style="color:#00AB4E">${r.pctAvMT != null ? r.pctAvMT.toFixed(1) + '%' : '—'}</td>
      <td style="color:#0097A7">${r.pctAdMT != null ? r.pctAdMT.toFixed(1) + '%' : '—'}</td>
      <td style="color:#B8860B">${r.pctBaMT != null ? r.pctBaMT.toFixed(1) + '%' : '—'}</td>
      <td style="color:#EE302F">${r.pctAbMT != null ? r.pctAbMT.toFixed(1) + '%' : '—'}</td>
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

/**
 * Tooltip flutuante para os ícones .info-tooltip.
 * Renderiza um único elemento anexado ao <body>, escapando de containers com
 * overflow:hidden (ex.: .kpi-card) e de contextos com -webkit-text-fill-color
 * transparent (ex.: .section-divider-text). Também remove o atributo title no
 * primeiro hover para suprimir o tooltip nativo duplicado do navegador.
 */
function initInfoTooltips() {
  let tip = null;
  const getEl = () => {
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'info-tip-float';
      document.body.appendChild(tip);
    }
    return tip;
  };
  const show = (target) => {
    if (target.hasAttribute('title')) {
      if (!target.getAttribute('data-tip')) target.setAttribute('data-tip', target.getAttribute('title'));
      target.removeAttribute('title');
    }
    const text = target.getAttribute('data-tip') || '';
    if (!text) return;
    const t = getEl();
    t.textContent = text;
    t.style.display = 'block';
    t.style.visibility = 'hidden';
    const r = target.getBoundingClientRect();
    const tw = t.offsetWidth, th = t.offsetHeight;
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    let top = r.top - th - 8;
    if (top < 8) top = r.bottom + 8;
    t.style.left = left + 'px';
    t.style.top = top + 'px';
    t.style.visibility = 'visible';
    t.classList.add('visible');
  };
  const hide = () => {
    if (tip) { tip.classList.remove('visible'); tip.style.display = 'none'; }
  };
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest && e.target.closest('.info-tooltip');
    if (el) show(el);
  });
  document.addEventListener('mouseout', (e) => {
    const el = e.target.closest && e.target.closest('.info-tooltip');
    if (el) hide();
  });
  window.addEventListener('scroll', hide, true);
}

async function init() {
  initNav();
  initInfoTooltips();
  renderHome();

  try {
    // NOTE: 4_11_desigualdades.json (~100 MB) é carregado sob demanda (lazy) ao abrir a aba
    // Desigualdades — ver ensureDesig(). Mantê-lo aqui travava o boot no GitHub Pages.
    const [respData, respGeo, respInfra, respDoc, respFtl, respSaeb, respFluxo, respCreGeo, respCreLookup, respInse, respIcg, respAfd, respIdeb, respTdi, respEscolas, respSaers, respSaersEsc] = await Promise.all([
      fetch('dados/4_1_acesso_estadual.json'),
      fetch('dados/rs_municipios.geojson'),
      fetch('dados/4_5_infra_estadual.json'),
      fetch('dados/4_5_docentes_estadual.json'),
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
      fetch('dados/4_saers_estadual.json'),
      fetch('dados/4_saers_escolas.json'),
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
    if (respSaersEsc.ok)  S.saersEscolasData = await respSaersEsc.json();

    // Seed rede cache with initial estadual data
    S.redeCache.estadual = { acesso: S.data, infra: S.infra, fluxo: S.fluxo, saeb: S.saeb, inse: S.inse, icg: S.icg, afd: S.afd, ideb: S.ideb, tdi: S.tdi, saers: S.saersData, saersEscolas: S.saersEscolasData, docentes: S.doc };

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

    S.loaded = true;

    // Navigate to user's pending selection if they clicked one while loading
    if (S.pendingView) {
      const view = S.pendingView;
      S.pendingView = null;
      const tab = document.querySelector(`.sidebar-tab[data-view="${view}"]`);
      if (tab) tab.click();
    }
  } catch (err) {
    document.getElementById('main-content').innerHTML = `
      <div class="loading" style="color:#C62828">
        <span>Erro ao carregar dados: ${err.message}</span>
      </div>
    `;
  }
}

document.addEventListener('DOMContentLoaded', init);
