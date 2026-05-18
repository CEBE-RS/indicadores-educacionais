# Painel de Indicadores Educacionais — SEDUC-RS

Plataforma analítica interativa com dados do **Censo Escolar**, **SAEB** e indicadores de infraestrutura da rede estadual do **Rio Grande do Sul**.

🔗 **Acesse o painel:** [https://matheus-bianco.github.io/piloto_unesco/](https://matheus-bianco.github.io/piloto_unesco/)

---

## Seções Disponíveis

| Seção | Status | Conteúdo |
|-------|--------|----------|
| **Acesso e Matrículas** | ✅ V1 disponível | Evolução 2019–2025, etapas, raça/cor, faixa etária, mapa |
| **Infraestrutura e Docência** | ✅ V1 disponível | Comparativo 2019 vs 2024, ranking municipal, perfil docente |
| **Fluxo e Rendimento** | 🔨 Em Construção | Aprovação, reprovação, abandono, distorção idade-série |
| **IDEB / SAEB** | 🔨 Em Construção | Proficiências LP e MT — série histórica 2013–2023 |

## Dados

| Fonte | Cobertura | Arquivo |
|-------|-----------|---------|
| INEP — Censo Escolar | 2019–2025 | `dados/4_1_acesso_matriculas.json` |
| INEP — Indicadores Educacionais | 2019–2024 | `dados/4_3_fluxo_rendimento.json` |
| INEP — Censo Escolar (Infraestrutura) | 2019–2024 | `dados/4_5_infraestrutura.json` |
| INEP — Censo Escolar (Docentes) | 2025 | `dados/4_5_docentes.json` |
| INEP — Microdados SAEB | 2013–2023 | `dados/4_6_saeb.json` |
| IBGE — Malha Municipal RS | 2025 | `dados/rs_municipios.geojson` |

> **Recorte:** Rede Estadual do RS — 2.302 escolas ativas (TP_DEPENDENCIA = 2)

## Stack Técnico

- **Frontend:** HTML5 / CSS3 / JavaScript ES6+ (sem framework)
- **Visualizações:** [Chart.js 4.4](https://www.chartjs.org/) + chartjs-plugin-datalabels
- **Mapas:** [Leaflet 1.9](https://leafletjs.com/) + CartoDB basemap
- **Dados:** JSON estático gerado por ETL Python (pandas)
- **Hosting:** GitHub Pages

## Estrutura

```
painel/
├── index.html          # Shell do dashboard
├── css/styles.css      # Design system
├── js/app.js           # Lógica principal (~2.600 linhas)
├── dados/              # JSONs de dados
│   ├── 4_1_acesso_matriculas.json
│   ├── 4_1_funil_turma_locdif.json
│   ├── 4_3_fluxo_rendimento.json
│   ├── 4_5_infraestrutura.json
│   ├── 4_5_docentes.json
│   ├── 4_6_saeb.json
│   └── rs_municipios.geojson
└── img/
    ├── logo_rs.avif
    └── icons/          # 26 ícones PNG
```

## Desenvolvido no âmbito do Contrato UNESCO ED00585/2026

Secretaria da Educação do Estado do Rio Grande do Sul (SEDUC-RS)
