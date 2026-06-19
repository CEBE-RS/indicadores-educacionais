# Painel de Indicadores Educacionais — SEDUC-RS

Plataforma analítica e interativa com dados consolidados do **Censo Escolar**, **SAEB**, **SAERS** e indicadores educacionais oficiais da rede pública de ensino do **Rio Grande do Sul**.

🔗 **Acesse o Painel (Homologação):** [https://matheus-bianco.github.io/piloto_unesco/](https://matheus-bianco.github.io/piloto_unesco/)

---

## 📱 Seções do Painel (Todas Concluídas — V1)

O painel é estruturado como uma Single Page Application (SPA) compacta e responsiva, contendo as seguintes seções de análise:

| Seção | Status | Indicadores e Visualizações |
| :--- | :---: | :--- |
| **Início (Home)** | ✅ | Hub central com animações micro-interativas para navegação rápida entre seções. |
| **Acesso e Matrículas** | ✅ | Evolução histórica (2019-2025), matrículas por etapa, perfil de raça/cor, sexo, localização diferenciada (Indígenas, Quilombolas) e mapa coroplético municipal. |
| **Infraestrutura** | ✅ | Nível de atendimento de recursos físicos básicos e tecnológicos (energia, água, esgoto, internet, laboratórios, salas climatizadas) e comparativo histórico. |
| **Complexidade de Gestão (ICG)** | ✅ | Indicador ICG oficial do INEP agregando complexidade por escola, CRE e município. |
| **Contexto Socioeconômico (INSE)** | ✅ | Distribuição das escolas e alunos por faixas socioeconômicas do INSE. |
| **Docência** | ✅ | Perfil do corpo docente, tipo de vínculo (efetivo, temporário) e adequação por etapa. |
| **Formação Docente (AFD)** | ✅ | Indicador de Adequação da Formação Docente (AFD) dividido por etapas e disciplinas. |
| **Fluxo e Rendimento** | ✅ | Taxas oficiais de Aprovação, Reprovação e Abandono (2020-2024) com dados consolidados por UF, CRE e município. |
| **Distorção Idade-Série (TDI)** | ✅ | Taxa de defasagem escolar por ano e etapa de ensino. |
| **SAERS** | ✅ | Resultados da Avaliação Estadual (Proficiência média e padrões de desempenho de alfabetização, básico, adequado e avançado). |
| **Desigualdades** | ✅ | Recortes intersecionais de proficiência (Sexo, Raça/Cor, Localização, Deficiência e Turno) para identificar lacunas de aprendizagem. |
| **SAEB** | ✅ | Série histórica de proficiências oficiais do INEP (Língua Portuguesa e Matemática). |
| **IDEB** | ✅ | Evolução do IDEB e comparação com as metas projetadas. |
| **Visão por Escola** | ✅ | Mapa georreferenciado interativo com busca rápida para consultar todos os indicadores consolidados de cada uma das escolas da rede estadual do RS. |

---

## 🛠️ Stack Técnico e Arquitetura

O projeto adota os princípios da arquitetura **JAMstack estática** para garantir máxima performance, segurança e custo zero de hospedagem:

- **Lógica e Visualização**: HTML5, CSS3 (Vanilla) e JavaScript Puro (ES6) executados localmente no navegador.
- **Gráficos**: [Chart.js v4](https://www.chartjs.org/) + presets customizados de `chartjs-plugin-datalabels`.
- **Mapas Interativos**: [Leaflet v1.9](https://leafletjs.com/) alimentado por arquivos GeoJSON simplificados.
- **Dados**: Compilados offline a partir de bases brutas pelo pipeline em Python e consumidos estaticamente via arquivos JSON compactados.

---

## 📂 Estrutura de Diretórios de Produção

A pasta `painel/` versionada neste repositório contém apenas os arquivos necessários para o servidor web público:

```text
painel/
├── index.html                  # Shell único do painel (SPA)
├── README.md                   # Este arquivo
├── DOCUMENTACAO_MANUTENCAO.md  # Manual de manutenção dos scripts ETL (Python)
├── REQUISITOS_HOSPEDAGEM.md    # Manual de infraestrutura/hospedagem para a TI da SEDUC
├── css/
│   └── styles.css              # Design system, animações e layout
├── js/
│   └── app.js                  # Lógica central (bindings, rotas, renderizadores de gráficos)
├── img/
│   ├── logo_rs.avif            # Logotipos oficiais
│   ├── UNESCO_logo_white.png   #
│   └── icons/                  # Biblioteca de ícones compactados
└── dados/                      # Bases de dados agregadas em JSON
    ├── 4_1_acesso_[rede].json
    ├── 4_3_fluxo_[rede].json
    ├── 4_11_desigualdades.json # Cruzamentos socioeconômicos (SAERS)
    ├── escolas_estaduais.json  # Coordenadas geográficas das escolas
    ├── rs_municipios.geojson   # Malha geográfica dos municípios
    └── (demais arquivos JSON compactados)
```

---

## 📚 Manuais de Suporte

Para orientações específicas, consulte os guias incluídos na raiz do repositório:
1. **Implantação e DevOps**: Consulte o [REQUISITOS_HOSPEDAGEM.md](REQUISITOS_HOSPEDAGEM.md) para saber como publicar o painel no GitHub Pages da SEDUC-RS, configurar um subdomínio oficial do Estado (CNAME) e integrá-lo via iframe responsivo em portais existentes.
2. **Atualização de Dados**: Consulte o [DOCUMENTACAO_MANUTENCAO.md](DOCUMENTACAO_MANUTENCAO.md) para entender como configurar o ambiente Python e rodar os scripts de ETL para adicionar dados de anos futuros (ex: 2026).

---

## 📝 Licença e Parceria

Desenvolvido sob o escopo do contrato **UNESCO ED00585/2026** em parceria com a **Secretaria da Educação do Estado do Rio Grande do Sul (SEDUC-RS)**.
Consultor Responsável: Matheus Ibelli Bianco.
