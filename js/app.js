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
  geo: null,
  creGeo: null,      // CRE polygons GeoJSON
  creLookup: null,   // { mun_to_cre, cre_list }
  map: null,
  mapLayer: null,
  mapMode: 'mun',   // 'mun' | 'cre'
  charts: [],
  anoSel: null,
  depSel: 'Estadual',
  munSel: null,
  munSelFluxo: null,
  creSel: null,      // selected CRE code e.g. '06'
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
  infantil: '#FFCB04', fundamental: '#00AB4E', medio: '#EE302F', eja: '#1565C0', especial: '#6A1B9A',
  gridLine: 'rgba(0,0,0,.06)',
};

// Datalabels presets
const DL_BAR = { display: true, anchor: 'end', align: 'end', font: { family: 'Inter', size: 9, weight: '600' }, color: '#444', formatter: v => formatNumChart(v) };
const DL_BAR_PCT = { display: true, anchor: 'end', align: 'end', font: { family: 'Inter', size: 9, weight: '600' }, color: '#444', formatter: v => v.toFixed(1) + '%' };
const DL_LINE = { display: true, anchor: 'end', align: 'top', offset: 3, font: { family: 'Inter', size: 8, weight: '600' }, color: '#555', formatter: v => formatNumChart(v) };
const DL_DONUT = { display: true, font: { family: 'Inter', size: 10, weight: '700' }, color: '#fff', formatter: (v, ctx) => { const t = ctx.dataset.data.reduce((a,b) => a+b, 0); const p = (v/t*100); return p >= 5 ? p.toFixed(0) + '%' : ''; } };
const DL_NONE = { display: false };

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

// ══════════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════════

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

/** Reusable section banner */
function sectionBanner(icon, title, subtitle) {
  return `<div class="section-banner">
    <div class="section-banner-bg"></div>
    <div class="section-banner-content">
      <div class="section-banner-icon"><img src="${icon}" alt=""></div>
      <h2>${title}${subtitle ? `<span>${subtitle}</span>` : ''}</h2>
      <span id="mun-filter-slot"></span>
    </div>
  </div>`;
}

function getRedeData(d, ano) {
  // Data is pre-filtered for Rede Estadual via ETL
  return d.serie_temporal[ano] || {};
}

function getRedeLabel() {
  return 'Rede Estadual';
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
    ${sectionBanner('img/icons/nav_acesso.png', 'Acesso e Matrículas', redeLabel)}
    <div class="kpi-strip" id="kpi-strip"></div>

    <!-- ═══ EIXO: Panorama da Rede ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/panorama.png" alt=""></span>
      <span class="section-divider-text">Panorama da Rede</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px">
      <div class="chart-card d1">
        <div class="chart-title" id="title-serie">Evolução de Matrículas — ${redeLabel} (${anos[0]}–${anoSel})</div>
        <div style="height:200px"><canvas id="chart-serie"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card d2">
        <div class="chart-title" id="title-etapa">Matrículas por Etapa — ${anoSel}</div>
        <div style="height:200px"><canvas id="chart-etapa"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card d3">
        <div class="chart-title" id="title-faixa">Matrículas por Faixa Etária — ${anoSel}</div>
        <div style="height:200px"><canvas id="chart-faixa"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title" id="title-integral">Educação Integral — Evolução</div>
        <div id="integral-delta" style="font-size:11px;color:#00AB4E;font-weight:600;margin:2px 0"></div>
        <div style="height:200px"><canvas id="chart-integral"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title" id="title-noturno">Matrículas Noturnas — Evolução</div>
        <div style="height:200px"><canvas id="chart-noturno"></canvas></div>
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
      <div class="chart-card d4">
        <div class="chart-title" id="title-raca">Evolução por Raça/Cor — ${redeLabel}</div>
        <div id="raca-filters" style="display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 6px 0;font-size:10px"></div>
        <div style="height:210px"><canvas id="chart-raca"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card d5">
        <div class="chart-title" id="title-sexo">Distribuição por Sexo</div>
        <div style="height:220px"><canvas id="chart-sexo"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card d6">
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
      <div class="chart-card d7">
        <div class="chart-title" id="title-esp-evo">Alunos da Ed. Especial — Evolução</div>
        <div style="height:200px"><canvas id="chart-esp-evo"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card d8">
        <div class="chart-title" id="title-esp-tipo">Classes Comuns vs Exclusivas — ${anoSel}</div>
        <div style="height:200px"><canvas id="chart-esp-tipo"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card d9">
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

    <div class="map-table-row d7">
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

  // 1. Série temporal (filtered by network)
  S.charts.push(new Chart(document.getElementById('chart-serie'), {
    type: 'line',
    data: {
      labels: anos,
      datasets: [{
        label: 'Matrículas', data: anos.map(a => getRedeData(d, a).mat_total || 0),
        borderColor: COLORS.pri, backgroundColor: COLORS.pri + '18',
        fill: true, tension: .35, pointRadius: 4, pointHoverRadius: 7,
        borderWidth: 2,
      }]
    },
    options: { ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_LINE } }
  }));

  // 2. Por etapa (bar chart no ano selecionado)
  const su = getRedeData(d, anoSel);
  const st = d.serie_temporal; // fallback for sub-fields
  const etapas = ['Infantil', 'Fundamental', 'Médio', 'EJA'];
  const etapaKeys = ['mat_infantil', 'mat_fundamental', 'mat_medio', 'mat_eja'];
  const etapaCores = [COLORS.infantil, COLORS.fundamental, COLORS.medio, COLORS.eja];
  const etapaData = etapaKeys.map(k => su[k] || 0);
  const etapaMax = Math.max(...etapaData);

  S.charts.push(new Chart(document.getElementById('chart-etapa'), {
    type: 'bar',
    data: {
      labels: etapas,
      datasets: [{
        label: `Matrículas ${anoSel}`,
        data: etapaData,
        backgroundColor: etapaCores.map(c => c + 'CC'),
        borderColor: etapaCores, borderWidth: 1.5, borderRadius: 4,
      }]
    },
    options: { ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_BAR },
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
      const datasets = racaKeys.map((k, i) => ({
        label: racaLabels[i],
        data: anos.map(a => d.perfil_alunos[a]?.raca?.[k] || 0),
        borderColor: racaCores[i], backgroundColor: racaCores[i] + '18',
        fill: false, tension: .35, pointRadius: 3, borderWidth: 2,
        hidden: !activeRacas.has(k),
      }));
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

  // 6. Integral (stacked bar)
  const intg = d.integral;
  const intAnos = Object.keys(intg).sort();
  if (intAnos.length > 0) {
    S.charts.push(new Chart(document.getElementById('chart-integral'), {
      type: 'bar',
      data: {
        labels: intAnos,
        datasets: [
          { label: 'Infantil', data: intAnos.map(a => intg[a].infantil), backgroundColor: COLORS.infantil + 'CC', borderRadius: 4 },
          { label: 'Fundamental', data: intAnos.map(a => intg[a].fund_total), backgroundColor: COLORS.fundamental + 'CC', borderRadius: 4 },
          { label: 'Médio', data: intAnos.map(a => intg[a].medio), backgroundColor: COLORS.medio + 'CC', borderRadius: 4 },
        ]
      },
      options: {
        ...CHART_DEFAULTS,
        scales: {
          ...CHART_DEFAULTS.scales,
          x: { ...CHART_DEFAULTS.scales.x, stacked: true },
          y: { ...CHART_DEFAULTS.scales.y, stacked: true },
        }
      }
    }));
  }
}

function buildMunTable(d, ano) {
  const mun = d.por_municipio[ano];
  const lookup = d.lookup_municipios || {};
  if (!mun) return;

  const rows = Object.entries(mun)
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
  if (S.munSel) {
    const anoSel = S.anoSel || Object.keys(d.serie_temporal).sort().pop();
    applyMunFilter(d, anoSel, lookup);
  }
}

/** Apply municipality filter — update KPIs, charts, map highlight, badge */
function applyMunFilter(d, anoSel, lookup) {
  const anos = Object.keys(d.serie_temporal).sort();
  const tbody = document.getElementById('mun-tbody');

  // Highlight row
  if (tbody) tbody.querySelectorAll('tr').forEach(tr => tr.classList.toggle('selected', tr.dataset.cod === S.munSel));

  // Badge
  const slot = document.getElementById('mun-filter-slot');
  if (slot) {
    if (S.munSel) {
      const nome = lookup[S.munSel] || S.munSel;
      slot.innerHTML = `<span class="mun-filter-badge" id="mun-clear-badge">📍 ${nome} <span class="close">✕</span></span>`;
      document.getElementById('mun-clear-badge').addEventListener('click', () => {
        S.munSel = null;
        applyMunFilter(d, anoSel, lookup);
      });
    } else {
      slot.innerHTML = '';
    }
  }

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
    setTitle('title-serie', `Evolução de Matrículas — ${nome} (${anos[0]}–${anoSel})`);
    setTitle('title-etapa', `Matrículas por Etapa — ${nome} — ${anoSel}`);
    setTitle('title-raca', `Raça/Cor — ${nome} (dado estadual)`);
    setTitle('title-sexo', `Sexo — ${nome}`);
    setTitle('title-faixa', `Faixa Etária — ${nome} — ${anoSel}`);
    setTitle('title-noturno', `Matrículas Noturnas — ${nome}`);
    setTitle('title-integral', `Ed. Integral — Rede Estadual (dado estadual)`);
    setTitle('title-locdif', `Loc. Diferenciada — Rede Estadual (dado estadual)`);
    setTitle('title-esp-evo', `Alunos Ed. Especial — ${nome}`);
    setTitle('title-esp-tipo', `Classes Comuns vs Exclusivas — ${nome} — ${anoSel}`);
    setTitle('title-esp-etapa', `Ed. Especial por Etapa — Rede Estadual (dado estadual)`);
    setTitle('title-def', `Tipo de Deficiência — Rede Estadual (dado estadual)`);

    // Série temporal do município
    const serieChart = document.getElementById('chart-serie');
    if (serieChart) {
      const munSeries = anos.map(a => d.por_municipio[a]?.[S.munSel]?.mat_total || 0);
      S.charts.push(new Chart(serieChart, {
        type: 'line',
        data: {
          labels: anos,
          datasets: [{ label: nome, data: munSeries, borderColor: COLORS.pri, backgroundColor: COLORS.pri + '18', fill: true, tension: .35, pointRadius: 4, borderWidth: 2 }]
        },
        options: { ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_LINE } }
      }));
    }

    // Por etapa (bar)
    const etapaChart = document.getElementById('chart-etapa');
    if (etapaChart) {
      const etapas = ['Infantil', 'Fundamental', 'Médio', 'EJA'];
      const etapaKeys = ['mat_infantil', 'mat_fundamental', 'mat_medio', 'mat_eja'];
      const etapaCores = [COLORS.infantil, COLORS.fundamental, COLORS.medio, COLORS.eja];
      const etapaData = etapaKeys.map(k => munData[k] || 0);
      S.charts.push(new Chart(etapaChart, {
        type: 'bar',
        data: { labels: etapas, datasets: [{ label: `Matrículas ${anoSel}`, data: etapaData, backgroundColor: etapaCores.map(c => c + 'CC'), borderColor: etapaCores, borderWidth: 1.5, borderRadius: 4 }] },
        options: { ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_BAR },
          scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, suggestedMax: Math.max(...etapaData) * 1.15 } } }
      }));
    }

    // Raça — use full-state data (municipality-level race data not available)
    buildMunChartsFallback(d, anoSel);
    // New charts with municipality support
    buildFaixaEtaria(d, anoSel);
    buildNoturno(d, anos, anoSel);
    buildEdEspecial(d, anos, anoSel);

    // ── Zoom map to municipality ──
    zoomToMunicipality(S.munSel);

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
    setTitle('title-serie', `Evolução de Matrículas — Rede Estadual (${anos[0]}–${anoSel})`);
    setTitle('title-etapa', `Matrículas por Etapa — ${anoSel}`);
    setTitle('title-raca', `Evolução por Raça/Cor — Rede Estadual`);
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

  // Raça — always state-level temporal evolution
  const racaEl = document.getElementById('chart-raca');
  if (racaEl && d.perfil_alunos) {
    const racaKeys = ['branca', 'preta', 'parda', 'amarela', 'indigena', 'nao_declarada'];
    const racaLabels = ['Branca', 'Preta', 'Parda', 'Amarela', 'Indígena', 'Não Decl.'];
    const racaCores = [COLORS.branca, COLORS.preta, COLORS.parda, COLORS.amarela, COLORS.indigena, COLORS.nd];
    const anos = Object.keys(d.perfil_alunos).sort();
    const racaDatasets = racaKeys.map((k, i) => ({
      label: racaLabels[i], data: anos.map(a => d.perfil_alunos[a]?.raca?.[k] || 0),
      borderColor: racaCores[i], backgroundColor: racaCores[i] + '18', fill: false, tension: .35, pointRadius: 3, borderWidth: 2,
    }));
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

  // Integral (state-level only)
  const intEl = document.getElementById('chart-integral');
  if (intEl && d.integral) {
    const intAnos = Object.keys(d.integral).sort();
    S.charts.push(new Chart(intEl, {
      type: 'bar', data: { labels: intAnos, datasets: [
        { label: 'Infantil', data: intAnos.map(a => d.integral[a].infantil), backgroundColor: COLORS.infantil + 'CC', borderRadius: 4 },
        { label: 'Fundamental', data: intAnos.map(a => d.integral[a].fund_total), backgroundColor: COLORS.fundamental + 'CC', borderRadius: 4 },
        { label: 'Médio', data: intAnos.map(a => d.integral[a].medio), backgroundColor: COLORS.medio + 'CC', borderRadius: 4 },
      ] },
      options: { ...CHART_DEFAULTS, scales: { ...CHART_DEFAULTS.scales, x: { ...CHART_DEFAULTS.scales.x, stacked: true }, y: { ...CHART_DEFAULTS.scales.y, stacked: true } } }
    }));
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
    ${sectionBanner('img/icons/nav_infra.png', 'Infraestrutura e Docência', 'Rede Estadual do RS')}

    <!-- KPIs Premium -->
    <div class="kpi-strip" id="infra-kpis"></div>

    <!-- ═══ EIXO: Infraestrutura — Comparativo ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/sec_infra.png" alt=""></span>
      <span class="section-divider-text">Infraestrutura Escolar — Comparativo 2019 vs ${anoAtual}</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="infra-cat-tabs" id="infra-cat-tabs">
      <button class="infra-cat-tab active" data-cat="Tecnologia">Tecnologia</button>
      <button class="infra-cat-tab" data-cat="Espacos Pedagogicos">Espaços Pedagógicos</button>
      <button class="infra-cat-tab" data-cat="Acessibilidade">Acessibilidade</button>
      <button class="infra-cat-tab" data-cat="Saneamento e Energia,Alimentacao">Saneamento & Alimentação</button>
    </div>

    <div class="chart-card" style="margin-bottom:10px">
      <div id="infra-chart-title" class="chart-title">Tecnologia — 2019 vs ${anoAtual}</div>
      <div style="height:380px"><canvas id="chart-infra-main"></canvas></div>
      <div class="chart-source">${FONTE_CENSO}</div>
    </div>

    <!-- ═══ EIXO: Infraestrutura por Município ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/territorial.png" alt=""></span>
      <span class="section-divider-text">Infraestrutura por Município</span>
      <span class="section-divider-line"></span>
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
            <th>Internet</th><th>Biblioteca</th><th>Quadra</th><th>Lab. Inf.</th><th>Rampas</th>
          </tr></thead>
          <tbody id="infra-mun-tbody"></tbody>
        </table>
      </div>
      <div class="chart-source">${FONTE_CENSO}</div>
    </div>


    ${doc ? `
    <!-- ═══ EIXO: Perfil Docente ═══ -->
    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/sec_docentes.png" alt=""></span>
      <span class="section-divider-text">Perfil Docente</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="kpi-strip" id="doc-kpis" style="grid-template-columns:repeat(4,1fr)"></div>

    <div class="charts-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
      <div class="chart-card d1">
        <div class="chart-title">Docentes por Sexo</div>
        <div style="height:240px"><canvas id="chart-doc-sexo"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card d2">
        <div class="chart-title">Escolaridade dos Docentes</div>
        <div style="height:240px"><canvas id="chart-doc-esco"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card d3">
        <div class="chart-title">Faixa Etária</div>
        <div style="height:240px"><canvas id="chart-doc-idade"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
      <div class="chart-card d4">
        <div class="chart-title">Tipo de Vínculo</div>
        <div style="height:240px"><canvas id="chart-doc-vinculo"></canvas></div>
        <div class="chart-source">${FONTE_CENSO}</div>
      </div>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
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
    </div>` : ''}
  `;

  buildInfraKPIs(infra, anoAtual, anos);
  buildInfraChart(infra, anoAtual, 'Tecnologia');
  bindInfraCatTabs(infra, anoAtual);
  buildInfraMunTable(infra);
  if (doc) buildDocCharts(doc);
  injectExportButtons();
}

/* ── Infra Municipality Table ── */
function buildInfraMunTable(infra) {
  const tbody = document.getElementById('infra-mun-tbody');
  if (!tbody) return;
  const lookup = S.data?.lookup_municipios || {};
  const munData = infra.por_municipio?.['2024'] || {};
  const indicators = ['IN_INTERNET', 'IN_BIBLIOTECA', 'IN_QUADRA_ESPORTES', 'IN_LABORATORIO_INFORMATICA', 'IN_ACESSIBILIDADE_RAMPAS'];

  let rows = Object.entries(munData)
    .map(([cod, v]) => ({ cod, nome: lookup[cod] || `Cód. ${cod}`, escolas: v.escolas || 0, inds: v.indicadores || {} }))
    .sort((a, b) => b.escolas - a.escolas);

  const pctCell = (pct) => {
    const cls = pct >= 80 ? 'color:#00AB4E' : pct >= 50 ? 'color:#E6A100' : 'color:#EE302F';
    return `<td style="text-align:center;font-weight:600;${cls}">${pct.toFixed(0)}%</td>`;
  };

  const renderRows = (data) => {
    tbody.innerHTML = data.map((r, i) =>
      `<tr><td>${i + 1}</td><td>${r.nome}</td><td>${r.escolas}</td>` +
      indicators.map(k => pctCell(r.inds[k]?.pct || 0)).join('') +
      `</tr>`
    ).join('');
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

  const pctFn = (cur, old) => (cur != null && old != null && old !== 0) ? ((cur - old) / old * 100) : null;
  const absFn = (cur, old) => (cur != null && old != null) ? (cur - old) : null;

  const kpis = [
    { label: 'Escolas', val: su.total_escolas, prevVal: suPrev?.total_escolas, icon: 'img/icons/escola.png', accent: 'green', fmt: 'num' },
    { label: 'Internet', val: su.indicadores.IN_INTERNET?.pct, prevVal: suPrev?.indicadores?.IN_INTERNET?.pct, icon: 'img/icons/internet.png', accent: 'green', fmt: 'pct' },
    { label: 'Biblioteca', val: su.indicadores.IN_BIBLIOTECA?.pct, prevVal: suPrev?.indicadores?.IN_BIBLIOTECA?.pct, icon: 'img/icons/biblioteca.png', accent: 'green', fmt: 'pct' },
    { label: 'Quadra', val: su.indicadores.IN_QUADRA_ESPORTES?.pct, prevVal: suPrev?.indicadores?.IN_QUADRA_ESPORTES?.pct, icon: 'img/icons/quadra.png', accent: 'green', fmt: 'pct' },
    { label: 'Lab. Informática', val: su.indicadores.IN_LABORATORIO_INFORMATICA?.pct, prevVal: suPrev?.indicadores?.IN_LABORATORIO_INFORMATICA?.pct, icon: 'img/icons/laboratorio.png', accent: 'green', fmt: 'pct' },
    { label: 'Acessibilidade', val: su.indicadores.IN_ACESSIBILIDADE_RAMPAS?.pct, prevVal: suPrev?.indicadores?.IN_ACESSIBILIDADE_RAMPAS?.pct, icon: 'img/icons/acessibilidade.png', accent: 'green', fmt: 'pct' },
  ];

  // Build sparklines from historical data
  function buildSparkInfra(key, color) {
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

  const sparkKeys = ['total_escolas','IN_INTERNET','IN_BIBLIOTECA','IN_QUADRA_ESPORTES','IN_LABORATORIO_INFORMATICA','IN_ACESSIBILIDADE_RAMPAS'];
  const sparkColors = ['#00AB4E','#00AB4E','#FFCB04','#EE302F','#1565C0','#FFCB04'];

  const strip = document.getElementById('infra-kpis');
  strip.innerHTML = kpis.map((k, i) => {
    const val = k.val;
    const displayVal = k.fmt === 'pct' ? (val != null ? val.toFixed(1) + '%' : '—') : formatNum(val);
    const pct = pctFn(val, k.prevVal);
    const abs = absFn(val, k.prevVal);
    const cls = pct !== null ? (pct >= 0 ? 'up' : 'down') : '';
    const arrow = pct !== null ? (pct >= 0 ? '↑' : '↓') : '';
    const sparkline = buildSparkInfra(sparkKeys[i], sparkColors[i]);
    const absStr = k.fmt === 'pct' ? (abs !== null ? `${abs >= 0 ? '+' : ''}${abs.toFixed(1)}pp` : '') : (abs !== null ? `${abs >= 0 ? '+' : ''}${formatNum(abs)}` : '');

    return `
    <div class="kpi-card accent-${k.accent}" style="animation-delay:${i * 80}ms" title="${k.label}: ${displayVal} (${anos[0]}–${ano})">
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
        <span class="kpi-abs">${absStr} ${refLabel}</span>
      </div>
    </div>`;
  }).join('');
}

/** Build single infra chart for a given category key */
function buildInfraChart(infra, ano, catKey) {
  const su = infra.serie_temporal[ano];
  const labels = infra.labels;
  const cats = infra.categorias;
  const anos = Object.keys(infra.serie_temporal).sort();
  const primeiro = anos[0];
  const suBase = infra.serie_temporal[primeiro];

  // Destroy existing infra chart only
  const el = document.getElementById('chart-infra-main');
  if (!el) return;
  const existing = Chart.getChart(el);
  if (existing) { existing.destroy(); S.charts = S.charts.filter(c => c !== existing); }

  // Parse category keys (can be comma-separated)
  const catKeys = catKey.split(',');
  const catNames = { 'Tecnologia': 'Tecnologia', 'Espacos Pedagogicos': 'Espaços Pedagógicos', 'Acessibilidade': 'Acessibilidade', 'Saneamento e Energia': 'Saneamento & Alimentação', 'Alimentacao': 'Alimentação' };
  const catLabel = catKeys.length > 1 ? 'Saneamento & Alimentação' : (catNames[catKeys[0]] || catKeys[0]);
  const titleEl = document.getElementById('infra-chart-title');
  if (titleEl) titleEl.textContent = `${catLabel} — ${primeiro} vs ${ano}`;

  const allCols = [];
  catKeys.forEach(cat => { if (cats[cat]) allCols.push(...cats[cat]); });

  const barLabels = allCols.map(c => labels[c] || c);
  const dataAtual = allCols.map(c => su.indicadores[c]?.pct || 0);
  const dataBase = allCols.map(c => suBase?.indicadores?.[c]?.pct || 0);

  S.charts.push(new Chart(el, {
    type: 'bar',
    data: {
      labels: barLabels,
      datasets: [
        {
          label: primeiro,
          data: dataBase,
          backgroundColor: '#FFDF00AA',
          borderColor: '#FFDF00',
          borderWidth: 1,
          borderRadius: 4,
          barPercentage: .85,
          categoryPercentage: .7,
        },
        {
          label: ano,
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
        y: { max: 105, grid: { color: COLORS.gridLine }, ticks: { callback: v => v <= 100 ? v + '%' : '', font: { family: 'Inter', size: 10 } } },
        x: { grid: { display: false }, ticks: { font: { family: 'Inter', size: 9 }, maxRotation: 45, minRotation: 20 } }
      },
    }
  }));
  injectExportButtons();
}

/** Bind infra category tab clicks */
function bindInfraCatTabs(infra, ano) {
  document.querySelectorAll('.infra-cat-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.infra-cat-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      buildInfraChart(infra, ano, tab.dataset.cat);
    });
  });
}

function buildDocCharts(doc) {
  const p = doc.perfil_2025;
  if (!p) return;

  // Premium KPIs for Docentes — use consistent denominators
  const docTotal = p.total || 0;
  const sexoTotal = p.por_sexo ? Object.values(p.por_sexo).reduce((a, b) => a + b, 0) : docTotal;
  const anosDoc = Object.keys(doc.razao_aluno_professor).sort();
  const lastRatio = doc.razao_aluno_professor[anosDoc[anosDoc.length - 1]]?.geral;
  const femPct = p.por_sexo ? (p.por_sexo.Feminino / sexoTotal * 100).toFixed(1) + '%' : '—';
  const supPct = p.por_escolaridade?.Superior ? (p.por_escolaridade.Superior / docTotal * 100).toFixed(1) + '%' : '—';
  const kpis = [
    { label: 'Docentes', value: formatNum(docTotal), icon: 'img/icons/professor.png', accent: 'green' },
    { label: 'Aluno/Prof', value: lastRatio ? lastRatio.toFixed(1) : '—', icon: 'img/icons/matriculas.png', accent: 'green' },
    { label: '% Feminino', value: femPct, icon: 'img/icons/social.png', accent: 'green' },
    { label: '% Superior', value: supPct, icon: 'img/icons/fundamental.png', accent: 'green' },
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
  doughnut('chart-doc-vinculo', p.por_vinculo, ['#2E7D32CC','#E65100CC','#6A1B9ACC','#1565C0CC']);

  // Bar for escolaridade
  const escoEl = document.getElementById('chart-doc-esco');
  if (escoEl && p.por_escolaridade) {
    S.charts.push(new Chart(escoEl, {
      type: 'bar',
      data: { labels: Object.keys(p.por_escolaridade), datasets: [{ data: Object.values(p.por_escolaridade), backgroundColor: '#1565C0CC', borderRadius: 6 }] },
      options: { ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_BAR } }
    }));
  }

  // Bar for faixa etaria
  const idadeEl = document.getElementById('chart-doc-idade');
  if (idadeEl && p.por_faixa_etaria) {
    S.charts.push(new Chart(idadeEl, {
      type: 'bar',
      data: { labels: Object.keys(p.por_faixa_etaria), datasets: [{ data: Object.values(p.por_faixa_etaria), backgroundColor: '#2E7D32CC', borderRadius: 6 }] },
      options: { ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_BAR } }
    }));
  }

  // Line: razao aluno/professor
  const razaoEl = document.getElementById('chart-doc-razao');
  if (razaoEl && doc.razao_aluno_professor) {
    const anos = Object.keys(doc.razao_aluno_professor).sort();
    const razaoData = anos.map(a => doc.razao_aluno_professor[a]?.geral);
    const razaoMin = Math.floor(Math.min(...razaoData.filter(Boolean)) - 1);
    const razaoMax = Math.ceil(Math.max(...razaoData.filter(Boolean)) + 1);
    S.charts.push(new Chart(razaoEl, {
      type: 'line',
      data: { labels: anos, datasets: [{ label: 'Alunos por Professor', data: razaoData,
        borderColor: '#005A32', backgroundColor: '#005A3218', fill: true, tension: .35, pointRadius: 5, borderWidth: 2.5 }] },
      options: { ...CHART_DEFAULTS,
        plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false },
          datalabels: { display: true, anchor: 'end', align: 'top', offset: 3, font: { family: 'Inter', size: 10, weight: '700' }, color: '#005A32', formatter: v => v?.toFixed(1) } },
        scales: { ...CHART_DEFAULTS.scales,
          y: { ...CHART_DEFAULTS.scales.y, beginAtZero: false, min: razaoMin, max: razaoMax,
            ticks: { ...CHART_DEFAULTS.scales.y.ticks, stepSize: 0.5, callback: v => v.toFixed(1) } } } }
    }));
  }

  // Docentes evolution line chart
  const docEvoEl = document.getElementById('chart-doc-evo');
  if (docEvoEl && doc.serie_temporal_total) {
    const stt = doc.serie_temporal_total;
    const docAnos = Object.keys(stt).sort();
    const totalVals = docAnos.map(a => stt[a]?.QT_DOC_BAS || 0);
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
    ${sectionBanner('img/icons/nav_desigualdades.png', 'Desigualdades', 'Recortes Socioeconômicos')}
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
// SAEB / IDEB
// ══════════════════════════════════════════════════════════

const FONTE_SAEB = 'Fonte: Microdados SAEB — INEP';

function renderSaeb() {
  const saeb = S.saeb;
  const main = document.getElementById('main-content');
  destroyCharts();
  destroyMap();

  const anos = Object.keys(saeb.serie_temporal).sort();
  const ultimo = anos[anos.length - 1];
  const primeiro = anos[0];
  const su = saeb.serie_temporal[ultimo];

  // KPI data
  const kpis = [];
  if (su['5EF']) kpis.push({ label: '5º EF — LP', val: su['5EF'].media_lp, accent: 'green', icon: 'img/icons/fundamental.png' });
  if (su['5EF']) kpis.push({ label: '5º EF — MT', val: su['5EF'].media_mt, accent: 'green', icon: 'img/icons/fundamental.png' });
  if (su['9EF']) kpis.push({ label: '9º EF — LP', val: su['9EF'].media_lp, accent: 'blue', icon: 'img/icons/fundamental.png' });
  if (su['9EF']) kpis.push({ label: '9º EF — MT', val: su['9EF'].media_mt, accent: 'blue', icon: 'img/icons/fundamental.png' });
  if (su['EM']) kpis.push({ label: 'EM — LP', val: su['EM'].media_lp, accent: 'red', icon: 'img/icons/medio.png' });
  if (su['EM']) kpis.push({ label: 'EM — MT', val: su['EM'].media_mt, accent: 'red', icon: 'img/icons/medio.png' });

  main.innerHTML = `
    ${sectionBanner('img/icons/nav_ideb.png', 'IDEB / SAEB', 'Rede Estadual do RS')}
    <div class="kpi-strip" id="saeb-kpis"></div>

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
      <span class="section-divider-text">Comparativo ${primeiro} vs ${ultimo}</span>
      <span class="section-divider-line"></span>
    </div>

    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="chart-card">
        <div class="chart-title">Proficiência ${primeiro} vs ${ultimo} — Língua Portuguesa</div>
        <div style="height:200px"><canvas id="chart-saeb-comp-lp"></canvas></div>
        <div class="chart-source">${FONTE_SAEB}</div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Proficiência ${primeiro} vs ${ultimo} — Matemática</div>
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

  // ── Build KPIs ──
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
            display: true, anchor: 'end', align: 'top', offset: 3,
            font: { family: 'Inter', size: 9, weight: '700' },
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

  // ── Comparison bars: first vs last ──
  function buildCompBar(canvasId, field) {
    const el = document.getElementById(canvasId);
    if (!el) return;

    const etsAvail = etapas.filter(et => saeb.serie_temporal[ultimo]?.[et] && saeb.serie_temporal[primeiro]?.[et]);
    const labels = etsAvail.map(et => etapaLabels[etapas.indexOf(et)]);
    const dataFirst = etsAvail.map(et => saeb.serie_temporal[primeiro]?.[et]?.[field] || 0);
    const dataLast = etsAvail.map(et => saeb.serie_temporal[ultimo]?.[et]?.[field] || 0);

    S.charts.push(new Chart(el, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: primeiro, data: dataFirst, backgroundColor: 'rgba(180,180,180,.5)', borderColor: '#999', borderWidth: 1, borderRadius: 4, barPercentage: .7 },
          { label: ultimo, data: dataLast, backgroundColor: COLORS.pri + 'CC', borderColor: COLORS.pri, borderWidth: 1, borderRadius: 4, barPercentage: .7 },
        ]
      },
      options: {
        ...CHART_DEFAULTS,
        plugins: {
          ...CHART_DEFAULTS.plugins,
          datalabels: {
            display: true, anchor: 'end', align: 'top', offset: 2,
            font: { family: 'Inter', size: 10, weight: '700' },
            color: '#333',
            formatter: v => v?.toFixed(1) ?? '',
          },
        },
        scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: false,
          ticks: { ...CHART_DEFAULTS.scales.y.ticks, stepSize: 20 } } }
      }
    }));
  }

  buildCompBar('chart-saeb-comp-lp', 'media_lp');
  buildCompBar('chart-saeb-comp-mt', 'media_mt');

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
  injectExportButtons();
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
    { view: 'infra', icon: 'img/icons/nav_infra.png', title: 'Infraestrutura e Docência',
      desc: 'Infraestrutura escolar, perfil docente e razão aluno/professor.',
      status: 'active', statusLabel: 'V1 disponível', accent: '#00AB4E' },
    { view: 'fluxo', icon: 'img/icons/nav_fluxo.png', title: 'Fluxo e Rendimento',
      desc: 'Taxas de aprovação, reprovação, abandono e distorção idade-série.',
      status: 'wip', statusLabel: 'Em Construção', accent: '#9E9E9E' },
    { view: 'desempenho', icon: 'img/icons/nav_ideb.png', title: 'IDEB / SAEB',
      desc: 'Proficiências em Língua Portuguesa e Matemática — série histórica 2013–2023.',
      status: 'wip', statusLabel: 'Em Construção', accent: '#9E9E9E' },
  ];

  main.innerHTML = `
    <div class="home-wrap">
      <div class="home-bg"></div>
      <div class="home-content">

        <div class="home-hero">
          <div class="home-hero-badge">Secretaria da Educação do Rio Grande do Sul</div>
          <h1>Painel de <span>Indicadores Educacionais</span></h1>
          <p class="home-hero-sub">
            Plataforma analítica com dados do Censo Escolar, SAEB e indicadores de infraestrutura
            da rede estadual do Rio Grande do Sul — abrangendo mais de 2.300 escolas.
          </p>
        </div>

        <div class="home-divider">
          <span class="home-divider-line"></span>
          <span class="home-divider-text">Explorar Seções</span>
          <span class="home-divider-line"></span>
        </div>

        <div class="home-grid">
          ${sections.map(s => `
            <div class="home-card" data-nav="${s.view}" style="--card-accent:${s.accent}">
              <div class="home-card-icon"><img src="${s.icon}" alt=""></div>
              <div class="home-card-title">${s.title}</div>
              <div class="home-card-desc">${s.desc}</div>
              <span class="home-card-status ${s.status}">● ${s.statusLabel}</span>
            </div>
          `).join('')}
        </div>

        <div class="home-footer">
          <div class="home-footer-text">
            Dados: INEP — Censo Escolar da Educação Básica & Microdados SAEB<br>
            Desenvolvido no âmbito do contrato UNESCO / SEDUC-RS
          </div>
          <div class="home-footer-logos">
            <img src="img/logo_rs.avif" alt="Governo RS" onerror="this.style.display='none'">
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

function renderFluxo() {
  const f = S.fluxo;
  const anos = Object.keys(f.serie_temporal).sort();
  const anoSel = anos.includes(S.anoSel) ? S.anoSel : anos[anos.length - 1];
  const st = f.serie_temporal[anoSel] || {};
  const lookup = f.lookup_municipios || {};
  const tdiEst = f.tdi_estadual || {};
  const main = document.getElementById('main-content');
  destroyCharts(); destroyMap();
  S.munSelFluxo = null;

  main.innerHTML = `
    ${sectionBanner('img/icons/nav_fluxo.png', 'Fluxo e Rendimento', 'Rede Estadual do RS')}
    <div id="fluxo-kpi-strip" class="kpi-strip"></div>

    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/panorama.png" alt=""></span>
      <span class="section-divider-text">Evolução Temporal</span>
      <span class="section-divider-line"></span>
    </div>
    <div class="charts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="chart-card d1">
        <div class="chart-title" id="flx-title-aprov">Aprovação (%) — Rede Estadual</div>
        <div style="height:200px"><canvas id="flx-chart-aprov"></canvas></div>
        <div class="chart-source">${FONTE_REND}</div>
      </div>
      <div class="chart-card d2">
        <div class="chart-title" id="flx-title-repab">Reprovação e Abandono (%) — Rede Estadual</div>
        <div style="height:200px"><canvas id="flx-chart-repab"></canvas></div>
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
        <div class="chart-title" id="flx-title-etapa">Taxas por Etapa — ${anoSel}</div>
        <div style="height:200px"><canvas id="flx-chart-etapa"></canvas></div>
        <div class="chart-source">${FONTE_REND}</div>
      </div>
      <div class="chart-card d4">
        <div class="chart-title" id="flx-title-tdi">Distorção Idade-Série (%) — ${f.tdi_ano || anoSel}</div>
        <div style="height:200px"><canvas id="flx-chart-tdi"></canvas></div>
        <div class="chart-source">${FONTE_REND}</div>
      </div>
    </div>

    <div class="section-divider">
      <span class="section-divider-icon"><img src="img/icons/territorial.png" alt=""></span>
      <span class="section-divider-text">Ranking Municipal</span>
      <span class="section-divider-line"></span>
    </div>
    <div class="map-table-row">
      <div class="chart-card" style="flex:1">
        <div class="mun-table-header">
          <div><strong>Tabela de Municípios</strong></div>
          <input type="text" id="flx-mun-search" placeholder="Buscar..." style="padding:4px 8px;border:1px solid #ddd;border-radius:4px;font-size:11px;width:120px">
        </div>
        <div class="mun-table-wrap" style="max-height:400px;overflow-y:auto">
          <table class="mun-table"><thead><tr>
            <th>#</th><th>Município</th><th>Aprov.F(%)</th><th>Aprov.M(%)</th><th>Reprov.F(%)</th><th>Aband.M(%)</th><th>TDI.F(%)</th>
          </tr></thead><tbody id="flx-mun-tbody"></tbody></table>
        </div>
        <div class="chart-source">${FONTE_REND}</div>
      </div>
    </div>
  `;

  // KPIs
  fluxoUpdateKPIs(st, tdiEst);
  // Charts
  fluxoBuildCharts(f, anos, anoSel, st, tdiEst);
  // Table
  fluxoBuildTable(f, anoSel, lookup);
}

function fluxoUpdateKPIs(st, tdiEst) {
  const strip = document.getElementById('fluxo-kpi-strip');
  if (!strip) return;
  const kpis = [
    { label: 'Aprovação Fund.', value: st.aprov_fund, icon: 'img/icons/fundamental.png', accent: 'green', suffix: '%' },
    { label: 'Aprovação Médio', value: st.aprov_med, icon: 'img/icons/medio.png', accent: 'green', suffix: '%' },
    { label: 'Reprovação Fund.', value: st.reprov_fund, icon: 'img/icons/fundamental.png', accent: 'red', suffix: '%' },
    { label: 'Abandono Médio', value: st.aband_med, icon: 'img/icons/medio.png', accent: 'red', suffix: '%' },
  ];
  strip.innerHTML = kpis.map((k,i) => `
    <div class="kpi-card accent-${k.accent}" style="animation-delay:${i*80}ms">
      <div class="kpi-top"><span class="kpi-label">${k.label}</span><img class="kpi-icon" src="${k.icon}" alt=""></div>
      <div class="kpi-body"><span class="kpi-value">${k.value != null ? k.value + k.suffix : '—'}</span></div>
    </div>
  `).join('');
}

function fluxoBuildCharts(f, anos, anoSel, st, tdiEst) {
  // 1. Approval evolution
  const aprovEl = document.getElementById('flx-chart-aprov');
  if (aprovEl) {
    S.charts.push(new Chart(aprovEl, {
      type: 'line',
      data: { labels: anos, datasets: [
        { label: 'Fund. AI', data: anos.map(a => f.serie_temporal[a]?.aprov_fund_ai), borderColor: COLORS.fundamental, backgroundColor: COLORS.fundamental+'18', fill: false, tension:.3, pointRadius:4, borderWidth:2 },
        { label: 'Fund. AF', data: anos.map(a => f.serie_temporal[a]?.aprov_fund_af), borderColor: COLORS.priLight, backgroundColor: COLORS.priLight+'18', fill: false, tension:.3, pointRadius:4, borderWidth:2 },
        { label: 'Médio', data: anos.map(a => f.serie_temporal[a]?.aprov_med), borderColor: COLORS.red, backgroundColor: COLORS.red+'18', fill: false, tension:.3, pointRadius:4, borderWidth:2 },
      ]},
      options: { ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, datalabels: DL_LINE, legend: { display: true, labels: { font: { family:'Inter', size:10 } } } },
        scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, min: 70, max: 100 } } }
    }));
  }

  // 2. Reprovação + Abandono evolution
  const repabEl = document.getElementById('flx-chart-repab');
  if (repabEl) {
    S.charts.push(new Chart(repabEl, {
      type: 'line',
      data: { labels: anos, datasets: [
        { label: 'Reprov. Fund.', data: anos.map(a => f.serie_temporal[a]?.reprov_fund), borderColor: COLORS.yellow, borderWidth:2, tension:.3, pointRadius:4 },
        { label: 'Reprov. Médio', data: anos.map(a => f.serie_temporal[a]?.reprov_med), borderColor: COLORS.red, borderWidth:2, tension:.3, pointRadius:4 },
        { label: 'Aband. Fund.', data: anos.map(a => f.serie_temporal[a]?.aband_fund), borderColor: '#999', borderDash:[5,5], borderWidth:2, tension:.3, pointRadius:4 },
        { label: 'Aband. Médio', data: anos.map(a => f.serie_temporal[a]?.aband_med), borderColor: '#333', borderDash:[5,5], borderWidth:2, tension:.3, pointRadius:4 },
      ]},
      options: { ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, datalabels: DL_LINE, legend: { display: true, labels: { font: { family:'Inter', size:10 } } } },
        scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, min: 0, suggestedMax: 15 } } }
    }));
  }

  // 3. Per-stage bars (current year)
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
      options: { ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, datalabels: DL_BAR, legend: { display: true, labels: { font: { family:'Inter', size:10 } } } },
        scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, min:0, max: 100 } } }
    }));
  }

  // 4. TDI bars
  const tdiEl = document.getElementById('flx-chart-tdi');
  if (tdiEl) {
    const src = tdiEst;
    const labels = ['Fund. AI', 'Fund. AF', 'Médio'];
    const data = [src.tdi_fund_ai, src.tdi_fund_af, src.tdi_med];
    S.charts.push(new Chart(tdiEl, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'TDI (%)', data, backgroundColor: [COLORS.fundamental+'CC', COLORS.priLight+'CC', COLORS.red+'CC'], borderRadius: 6 }] },
      options: { ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, datalabels: DL_BAR, legend: { display: false } },
        scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, min: 0, suggestedMax: Math.max(...data.filter(v=>v!=null))*1.3 } } }
    }));
  }
}

function fluxoBuildTable(f, anoSel, lookup) {
  const muns = f.por_municipio[anoSel] || {};
  const tdi = f.tdi_por_municipio || {};
  const rows = Object.entries(muns)
    .map(([cod, v]) => ({ cod, nome: lookup[cod] || `Cód.${cod}`, ...v, ...(tdi[cod]||{}) }))
    .filter(r => r.aprov_fund != null)
    .sort((a,b) => (b.aprov_fund||0) - (a.aprov_fund||0));

  const tbody = document.getElementById('flx-mun-tbody');
  tbody.innerHTML = rows.map((r,i) => `
    <tr data-cod="${r.cod}" class="${S.munSelFluxo===r.cod?'selected':''}">
      <td>${i+1}</td><td><strong>${r.nome}</strong></td>
      <td>${r.aprov_fund!=null?r.aprov_fund+'%':'—'}</td>
      <td>${r.aprov_med!=null?r.aprov_med+'%':'—'}</td>
      <td>${r.reprov_fund!=null?r.reprov_fund+'%':'—'}</td>
      <td>${r.aband_med!=null?r.aband_med+'%':'—'}</td>
      <td>${r.tdi_fund!=null?r.tdi_fund+'%':'—'}</td>
    </tr>
  `).join('');

  // Click handler
  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => {
      const cod = tr.dataset.cod;
      S.munSelFluxo = S.munSelFluxo === cod ? null : cod;
      applyFluxoMunFilter(f, anoSel, lookup);
    });
  });

  // Search
  document.getElementById('flx-mun-search')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    tbody.querySelectorAll('tr').forEach(tr => {
      tr.style.display = (tr.children[1]?.textContent.toLowerCase()||'').includes(q) ? '' : 'none';
    });
  });
}

function applyFluxoMunFilter(f, anoSel, lookup) {
  const anos = Object.keys(f.serie_temporal).sort();
  const tbody = document.getElementById('flx-mun-tbody');
  tbody.querySelectorAll('tr').forEach(tr => tr.classList.toggle('selected', tr.dataset.cod === S.munSelFluxo));

  destroyCharts();

  if (S.munSelFluxo) {
    const nome = lookup[S.munSelFluxo] || S.munSelFluxo;
    const munData = f.por_municipio[anoSel]?.[S.munSelFluxo] || {};
    const tdiMun = f.tdi_por_municipio?.[S.munSelFluxo] || f.tdi_estadual || {};

    // Update titles
    const t1 = document.getElementById('flx-title-aprov');
    const t2 = document.getElementById('flx-title-repab');
    const t3 = document.getElementById('flx-title-etapa');
    const t4 = document.getElementById('flx-title-tdi');
    if (t1) t1.textContent = `Aprovação (%) — ${nome}`;
    if (t2) t2.textContent = `Reprovação e Abandono (%) — ${nome}`;
    if (t3) t3.textContent = `Taxas por Etapa — ${nome} — ${anoSel}`;
    if (t4) t4.textContent = `Distorção Idade-Série (%) — ${nome}`;

    // Update KPIs
    fluxoUpdateKPIs(munData, tdiMun);

    // Rebuild charts with municipality data
    const munST = {};
    for (const a of anos) {
      munST[a] = f.por_municipio[a]?.[S.munSelFluxo] || {};
    }
    const fakeST = { serie_temporal: munST };
    fluxoBuildCharts(fakeST, anos, anoSel, munData, tdiMun);
  } else {
    // Restore
    const st = f.serie_temporal[anoSel] || {};
    const tdiEst = f.tdi_estadual || {};
    fluxoUpdateKPIs(st, tdiEst);
    fluxoBuildCharts(f, anos, anoSel, st, tdiEst);
    // Reset titles
    const t1 = document.getElementById('flx-title-aprov');
    const t2 = document.getElementById('flx-title-repab');
    const t3 = document.getElementById('flx-title-etapa');
    const t4 = document.getElementById('flx-title-tdi');
    if (t1) t1.textContent = 'Aprovação (%) — Rede Estadual';
    if (t2) t2.textContent = 'Reprovação e Abandono (%) — Rede Estadual';
    if (t3) t3.textContent = `Taxas por Etapa — ${anoSel}`;
    if (t4) t4.textContent = `Distorção Idade-Série (%) — ${f.tdi_ano || anoSel}`;
  }
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
      else if (view === 'fluxo' && S.fluxo) { renderFluxo(); }
      else if (view === 'infra' && S.infra) { renderInfra(); }
      else if (view === 'desempenho' && S.saeb) { renderSaeb(); }
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
      options: { ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_LINE } }
    }));
  } else {
    // State: total noturno line
    const vals = anos.map(a => d.serie_temporal[a]?.mat_noturno || 0);
    S.charts.push(new Chart(el, {
      type: 'line',
      data: { labels: anos, datasets: [{ label: 'Matrículas Noturnas', data: vals, borderColor: '#6A1B9A', backgroundColor: '#6A1B9A18', fill: true, tension: .35, pointRadius: 4, borderWidth: 2 }] },
      options: { ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_LINE } }
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
      options: { ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_LINE } }
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

  // 3. CC by etapa (current year, estadual only — data only available in 2025)
  const etapaEl = document.getElementById('chart-esp-etapa');
  if (etapaEl) {
    const st = d.serie_temporal[anoSel] || {};
    const etapas = ['Infantil', 'Fundamental', 'Médio', 'EJA'];
    const ccData = [st.esp_cc_inf || 0, st.esp_cc_fund || 0, st.esp_cc_med || 0, st.esp_cc_eja || 0];
    const etapaCores = [COLORS.infantil, COLORS.fundamental, COLORS.medio, COLORS.eja];
    // Only show if we have data (2025+)
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
  const int24 = d.integral?.['2024'];
  const int25 = d.integral?.['2025'];
  if (!int24 || !int25) { el.textContent = ''; return; }

  const total24 = (int24.fund_total || 0) + (int24.medio || 0) + (int24.infantil || 0);
  const total25 = (int25.fund_total || 0) + (int25.medio || 0) + (int25.infantil || 0);
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
  if (!ftl?.localizacao_diferenciada) return;

  const ld = ftl.localizacao_diferenciada;
  const anos = Object.keys(ld).sort();
  const tipos = ['Terra Indigena', 'Quilombola', 'Area de Assentamento'];
  const tipoLabels = ['Terra Indígena', 'Quilombola', 'Assentamento'];
  const tipoCores = [COLORS.pri, COLORS.red, COLORS.yellow];

  // Trend chart: escolas por tipo ao longo dos anos
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

  // Bar chart: matrículas no último ano disponível
  const ultimoAno = anos[anos.length - 1];
  const canvasBar = document.getElementById('chart-locdif-bar');
  if (canvasBar) {
    const barData = tipos.map(t => ld[ultimoAno]?.[t]?.matriculas || 0);
    S.charts.push(new Chart(canvasBar, {
      type: 'bar',
      data: {
        labels: tipoLabels,
        datasets: [{
          label: `Matrículas ${ultimoAno}`,
          data: barData,
          backgroundColor: tipoCores.map(c => c + 'CC'),
          borderColor: tipoCores, borderWidth: 1.5, borderRadius: 4,
        }]
      },
      options: { ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false }, datalabels: DL_BAR },
        scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: true, suggestedMax: Math.max(...barData) * 1.2 } } }
    }));
  }
}

function buildCreLayer(anoSel, metric) {
  if (!S.creGeo || !S.map) return;
  if (S.mapLayer) { S.mapLayer.remove(); S.mapLayer = null; }

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

  function getColor(v) {
    const t = v / maxVal;
    if (t > 0.8) return '#005A32';
    if (t > 0.6) return '#238B45';
    if (t > 0.4) return '#41AB5D';
    if (t > 0.2) return '#74C476';
    return '#C7E9C0';
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

  selMun.innerHTML = '<option value="">Todos os municípios</option>' +
    entries.map(([cod, nome]) => `<option value="${cod}">${nome}</option>`).join('');
}

/** Bind topbar filter interactions */
function bindTopbarFilters() {
  const selAno = document.getElementById('sel-ano');
  const selCre = document.getElementById('sel-cre');
  const selMun = document.getElementById('sel-mun');

  if (selAno) selAno.addEventListener('change', e => {
    S.anoSel = e.target.value;
    S.munSel = null;
    if (selMun) selMun.value = '';
    refreshActiveTab();
  });

  if (selCre) selCre.addEventListener('change', e => {
    S.creSel = e.target.value || null;
    S.munSel = null;
    if (selMun) selMun.value = '';
    populateMunDropdown(S.creSel);
    refreshActiveTab();
  });

  if (selMun) selMun.addEventListener('change', e => {
    S.munSel = e.target.value || null;
    refreshActiveTab();
  });

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
    const [respData, respGeo, respInfra, respDoc, respFtl, respSaeb, respFluxo, respCreGeo, respCreLookup] = await Promise.all([
      fetch('dados/4_1_acesso_matriculas.json'),
      fetch('dados/rs_municipios.geojson'),
      fetch('dados/4_5_infraestrutura.json'),
      fetch('dados/4_5_docentes.json'),
      fetch('dados/4_1_funil_turma_locdif.json'),
      fetch('dados/4_6_saeb.json'),
      fetch('dados/4_3_fluxo_rendimento.json'),
      fetch('dados/rs_cres.geojson'),
      fetch('dados/rs_cre_lookup.json'),
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
