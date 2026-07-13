# Manual de Manutenção dos Scripts ETL — Painel UNESCO RS (Produto 4)

Este documento descreve a arquitetura de dados, a estrutura de diretórios e o funcionamento detalhado dos scripts ETL (Extract, Transform, Load) desenvolvidos no âmbito do contrato **UNESCO ED00585/2026** para a **Secretaria da Educação do Estado do Rio Grande do Sul (SEDUC-RS)**.

---

## 1. Visão Geral da Arquitetura

O painel é estruturado em duas camadas totalmente independentes:

1. **Camada de Processamento de Dados (ETL / Local)**:
   - Escrita em **Python 3**.
   - Lê as bases de dados brutas de grande porte (Microdados do Censo Escolar, planilhas oficiais do INEP, avaliações do SAERS e SAEB) armazenadas localmente.
   - Limpa, normaliza, filtra para o Estado do Rio Grande do Sul (`SG_UF == 'RS'`) e pré-agrega os dados por ano, rede de ensino (estadual, municipal, federal, privada, todas), CRE (Coordenadoria Regional de Educação) e município.
   - Exporta os resultados estruturados em arquivos **JSON compactados** diretamente na pasta do frontend.

2. **Camada de Visualização (Frontend / Servidor Web)**:
   - Escrita em **HTML5, CSS3 (Vanilla) e JavaScript Puro (ES6+)**.
   - Utiliza bibliotecas modernas de visualização executadas no cliente: **Chart.js v4** (gráficos) e **Leaflet v1.9** (mapas georreferenciados).
   - Não depende de banco de dados ativo ou servidores de aplicação (Node.js, PHP, Java). O frontend apenas lê estaticamente os arquivos JSON gerados pelo ETL.

---

## 2. Estrutura de Diretórios do Projeto

O **repositório Git** (`CEBE-RS/indicadores-educacionais`) contém o frontend e os scripts ETL. As bases brutas ficam **fora do Git**, em pasta local:

```text
<projeto>/
├── 00. Bases de Dados/               # Bases originais brutas (NÃO versionar)
│   ├── 01. Acesso e Matrículas (Censo Escolar_2010_2025)/
│   │   └── 01. extrações_2010_2025/
│   │       ├── microdados_ed_basica_[ANO].csv
│   │       ├── Tabela_Escola_2025.csv
│   │       └── Tabela_Matricula_2025.csv
│   ├── 02. Fluxo e Rendimento (Inep_2010_2024_Rendimento_TDI)/
│   │   └── 01. Rendimento e TDI/
│   ├── 10, SAERS/
│   └── (Demais pastas: SAEB, IDEB, INSE, ICG, AFD)
│
└── indicadores-educacionais/         # Clone do repositório GitHub
    ├── index.html
    ├── css/  js/  img/
    ├── dados/                        # JSONs gerados pelo ETL (versionados)
    ├── etl/                          # Scripts Python de atualização
    │   ├── paths.py                  # Caminhos portáteis (BASE / OUT_DIR)
    │   ├── etl_*.py
    │   ├── gerar_planilhas_download.py
    │   ├── run_etl_all.py
    │   └── README.md
    ├── DOCUMENTACAO_MANUTENCAO.md
    ├── REQUISITOS_HOSPEDAGEM.md
    └── README.md
```

Os scripts em `etl/` resolvem automaticamente:
- **BASE** = pasta `<projeto>` (irmã do repositório), onde está `00. Bases de Dados`
- **OUT_DIR / PAINEL_DIR** = `dados/` dentro do repositório

Override opcional: variável de ambiente `UNESCO_ETL_ROOT` apontando para `<projeto>`.

---

## 3. Mapeamento de Scripts ETL e Bases de Dados

A tabela abaixo descreve a responsabilidade de cada script ETL, os arquivos de entrada necessários que devem estar na pasta `00. Bases de Dados/` e os arquivos JSON de saída que são gravados em `painel/dados/`:

| Script ETL | Fontes de Dados de Entrada | Arquivo(s) JSON Gerado(s) | Seção do Painel Atendida |
| :--- | :--- | :--- | :--- |
| **`etl/etl_censo_escolar.py`** | Microdados do Censo Escolar (2010 a 2024) e Tabelas de 2025. | `4_1_acesso_[rede].json` (para cada rede: estadual, municipal, etc.) e cópia de compatibilidade em `4_1_acesso_matriculas.json` | Acesso e Matrículas |
| **`etl/etl_suplementar.py`** | Complementos do Censo (campos adicionais nas séries). | Atualiza `4_1_acesso_[rede].json` | Acesso e Matrículas |
| **`etl/etl_infra_docentes.py`** | Microdados do Censo Escolar (filtrado por rede) contendo recursos físicos da escola e perfil de formação. | `4_5_infra_[rede].json`<br>`4_5_docentes_[rede].json` | Infraestrutura e Docência |
| **`etl/etl_fluxo_rendimento.py`** | Planilhas de Taxas de Rendimento (Aprovação, Reprovação, Abandono) do INEP. | `4_3_fluxo_[rede].json` | Fluxo e Rendimento |
| **`etl/etl_tdi.py`** | Planilhas de Taxa de Distorção Idade-Série (TDI) do INEP. | `4_10_tdi_[rede].json` | Distorção Idade-Série |
| **`etl/etl_funil_turma_locdif.py`** | Tabelas do Censo Escolar (funil, turma, localização diferenciada). | `4_1_funil_turma_locdif.json` | Acesso e Matrículas |
| **`etl/etl_saeb.py`** | Planilhas/microdados oficiais do SAEB. | `4_6_saeb_[rede].json` | SAEB |
| **`etl/etl_saers.py`** | Microdados do SAERS (2022-2025) fornecidos pelo CAEd. | `4_saers_[rede].json`<br>`4_saers_escolas.json` | SAERS |
| **`etl/etl_desigualdades.py`** | Microdados do SAERS (recortes sociodemográficos). | `4_11_desigualdades.json` | Desigualdades |
| **`etl/etl_ideb.py`** | Planilhas oficiais do IDEB (INEP). | `4_7_ideb_[rede].json` | IDEB |
| **`etl/etl_escolas.py`** | Cadastro/coordenadas + indicadores por escola. | `escolas_estaduais.json` | Visão por Escola |
| **`etl/etl_inse.py`** | Planilhas do INSE (INEP). | `4_7_inse_[rede].json` | INSE |
| **`etl/etl_icg.py`** | Planilhas do ICG (INEP). | `4_8_icg_[rede].json` | Complexidade de Gestão |
| **`etl/etl_afd.py`** | Planilhas do AFD (INEP). | `4_9_afd_[rede].json` | Formação Docente (AFD) |
| **`etl/etl_redes.py`** | Consolida JSONs já gerados (cross-rede). | `4_1_redes.json` | Visão por Redes |
| **`etl/gerar_planilhas_download.py`** | Lê os JSONs do painel. | `dados/downloads/*.xlsx` + `manifest.json` | Central de Dados |
| **`etl/run_etl_all.py`** | Orquestra a sequência completa acima. | — | Manutenção |
---

## 4. Configuração do Ambiente e Requisitos do Pipeline

### Requisitos do Sistema
- **Python 3.10** ou superior instalado.
- Pacotes adicionais necessários para processamento científico e leitura de planilhas Excel:
  ```bash
  pip install pandas numpy openpyxl
  ```

### Ajuste de Caminho Base (`BASE`)
Os scripts importam `etl/paths.py`, que define automaticamente:

- `BASE` / `BASES_DIR` → pasta do projeto com `00. Bases de Dados` (irmã do repositório)
- `OUT_DIR` / `PAINEL_DIR` → `dados/` dentro do repositório Git

Em geral **não é necessário editar** os scripts. Se o layout local for diferente:

```bash
# PowerShell
$env:UNESCO_ETL_ROOT="C:\Caminho\Ate\O\Projeto"
```

---

## 5. Ordem Sugerida para Execução de Atualização Completa

Caso decida atualizar as bases de dados históricas ou processar um novo lote anual completo, execute os scripts **a partir da pasta `etl/`** na seguinte ordem:

```bash
cd etl
python etl_censo_escolar.py
python etl_suplementar.py
python etl_infra_docentes.py
python etl_fluxo_rendimento.py
python etl_tdi.py
python etl_funil_turma_locdif.py
python etl_saeb.py
python etl_saers.py
python etl_desigualdades.py
python etl_ideb.py
python etl_escolas.py
python etl_inse.py
python etl_icg.py
python etl_afd.py
python etl_redes.py
python gerar_planilhas_download.py
```

Atalho para a sequência completa:

```bash
cd etl
python run_etl_all.py
```

---

## 6. Guia Prático: Como Adicionar um Novo Ano de Dados (Exemplo: Censo Escolar de 2025/2026)

O frontend do painel foi projetado para ser **autossuficiente**. Ele lê os anos disponíveis analisando diretamente as chaves presentes nos arquivos JSON da série temporal. Portanto, **não é necessário programar no JavaScript para fazer com que um novo ano apareça nos seletores do painel!** Basta rodar o ETL e gerar o JSON com os novos dados.

Aqui está o passo a passo técnico:

### Passo 1: Posicionar o novo arquivo brutamente extraído do INEP
Baixe o arquivo de microdados correspondente ao ano (ex: Censo Escolar 2026) no formato `.csv` ou `.xlsx`.
Coloque o arquivo dentro do subdiretório correspondente na pasta de bases:
* Exemplo: `00. Bases de Dados/01. Acesso e Matrículas (Censo Escolar_2010_2025)/01. extrações_2010_2025/microdados_ed_basica_2026.csv`

### Passo 2: Atualizar a lista de anos no script ETL correspondente
No script Python, localize a lista de anos (geralmente uma variável ou laço `range`) e inclua o ano recém-adicionado.

No arquivo `etl_censo_escolar.py`:
```python
# Mude a linha do __main__ para incluir o ano 2026:
for ano in range(2010, 2027): # O range em Python é exclusivo no final, então 2027 incluirá 2026
    df = ler_microdados_ano(ano)
    # ...
```

### Passo 3: Executar o script
Abra o terminal, navegue até a pasta `etl/` do repositório e execute:
```bash
cd etl
python etl_censo_escolar.py
```
O console exibirá o progresso de leitura do arquivo bruto, o filtro para as escolas ativas do Rio Grande do Sul e a geração dos novos JSONs em `dados/4_1_acesso_[rede].json`.

### Passo 4: Publicar as alterações no Git
Uma vez que o script rodar com sucesso e gerar os arquivos em `dados/`, basta versionar e subir as atualizações para o GitHub que hospeda a página:
```bash
git add dados/
git commit -m "data: adiciona dados do Censo Escolar 2026"
git push
```
O painel detectará a nova chave do ano automaticamente e exibirá o ano 2026 na interface instantaneamente.
