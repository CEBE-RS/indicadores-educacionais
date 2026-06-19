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

A raiz do projeto deve manter a seguinte organização de pastas:

```text
├── 00. Bases de Dados/               # Bases originais brutas (não sobem para o Git público)
│   ├── 01. Acesso e Matrículas (Censo Escolar_2010_2025)/
│   │   └── 01. extrações_2010_2025/
│   │       ├── microdados_ed_basica_[ANO].csv    # Microdados anuais do Censo Escolar
│   │       ├── Tabela_Escola_2025.csv             # Tabelas do censo mais recentes desmembradas
│   │       └── Tabela_Matricula_2025.csv          #
│   ├── 02. Fluxo e Rendimento (Inep_2010_2024_Rendimento_TDI)/
│   │   └── 01. Rendimento e TDI/                  # Planilhas INEP de Rendimento Escolar e TDI
│   ├── 10, SAERS/                                 # Microdados de proficiência do SAERS
│   └── (Demais pastas de bases brutas: SAEB, INSE, ICG, AFD)
│
├── painel/                           # Frontend Estático (Esta pasta é enviada para o servidor/GitHub Pages)
│   ├── css/                          # Folhas de estilo (styles.css)
│   ├── dados/                        # Destino dos JSONs gerados pelo ETL (4_*.json)
│   ├── img/                          # Ícones e logotipos oficiais
│   ├── js/                           # Lógica JS do painel (app.js)
│   └── index.html                    # Página de entrada única (SPA)
│
├── etl_*.py                          # Scripts Python que compõem o pipeline de dados
├── run_etl_all.py                    # Script de conveniência para reprocessamento completo
└── DOCUMENTACAO_MANUTENCAO.md        # Este arquivo
```

---

## 3. Mapeamento de Scripts ETL e Bases de Dados

A tabela abaixo descreve a responsabilidade de cada script ETL, os arquivos de entrada necessários que devem estar na pasta `00. Bases de Dados/` e os arquivos JSON de saída que são gravados em `painel/dados/`:

| Script ETL | Fontes de Dados de Entrada | Arquivo(s) JSON Gerado(s) | Seção do Painel Atendida |
| :--- | :--- | :--- | :--- |
| **`etl_censo_escolar.py`** | Microdados do Censo Escolar (2010 a 2024) e Tabelas de 2025. | `4_1_acesso_[rede].json` (para cada rede: estadual, municipal, etc.) e cópia de compatibilidade em `4_1_acesso_matriculas.json` | Acesso e Matrículas |
| **`etl_infra_docentes.py`** | Microdados do Censo Escolar (filtrado por rede) contendo recursos físicos da escola e perfil de formação. | `4_5_infra_[rede].json`<br>`4_5_docentes_[rede].json` | Infraestrutura e Docência |
| **`etl_fluxo_rendimento.py`** | Planilhas de Taxas de Rendimento (Aprovação, Reprovação, Abandono) do INEP de 2010-2024 por Município, Escola e UF, e planilhas de Taxa de Distorção Idade-Série (TDI). | `4_3_fluxo_[rede].json`<br>`4_10_tdi_[rede].json` | Fluxo e Rendimento, Distorção Idade-Série |
| **`etl_saeb.py`** | Planilhas oficiais do SAEB por escola, município e UF. | `4_6_saeb_[rede].json` | SAEB (Proficiência histórica) |
| **`etl_saers.py`** | Microdados do SAERS (2022-2025) fornecidos pelo CAEd. | `4_saers_[rede].json`<br>`4_saers_escolas.json` | SAERS (Avaliação Estadual) |
| **`etl_desigualdades.py`** | Microdados do SAERS contendo perfis sociodemográficos de alunos (raça, sexo, localização, turno). | `4_11_desigualdades.json` | Desigualdades (Gráficos e cruzamentos) |
| **`etl_escolas.py`** | Cadastro de coordenadas e dados consolidados do Censo de Escolas Estaduais do RS. | `escolas_estaduais.json` | Visão por Escola (Mapa Georreferenciado) |
| **`etl_funil_turma_locdif.py`** | Tabelas do Censo Escolar compilando matrículas por turma e áreas de localização diferenciada (Quilombolas, Indígenas, etc.). | `4_1_funil_turma_locdif.json` | Acesso e Matrículas (Gráfico de Funil / Diferenciadas) |
| **`etl_inse.py`** | Planilhas do Indicador de Nível Socioeconômico (INSE) do INEP. | `4_7_inse_[rede].json` | Contexto Socioeconômico (INSE) |
| **`etl_icg.py`** | Planilhas do Indicador de Complexidade de Gestão Escolar (ICG) do INEP. | `4_8_icg_[rede].json` | Complexidade de Gestão (ICG) |
| **`etl_afd.py`** | Planilhas do Indicador de Adequação da Formação Docente (AFD) do INEP. | `4_9_afd_[rede].json` | Formação Docente (AFD) |

---

## 4. Configuração do Ambiente e Requisitos do Pipeline

### Requisitos do Sistema
- **Python 3.10** ou superior instalado.
- Pacotes adicionais necessários para processamento científico e leitura de planilhas Excel:
  ```bash
  pip install pandas numpy openpyxl
  ```

### Ajuste de Caminho Base (`BASE`)
Todos os scripts de ETL contêm uma constante no topo chamada `BASE` que determina onde os arquivos do projeto estão localizados. 
Ao rodar os scripts em uma nova máquina ou servidor, edite esta linha no script (ou garanta que ele seja executado no diretório correto usando caminhos relativos). Exemplo:

```python
# No script Python:
BASE = os.path.dirname(os.path.abspath(__file__))
# ou caminho absoluto:
BASE = r"C:\Caminho\Ate\O\Repositorio\Produto 4_Indicadores Educacionais"
```

---

## 5. Ordem Sugerida para Execução de Atualização Completa

Caso decida atualizar as bases de dados históricas ou processar um novo lote anual completo, execute os scripts na seguinte ordem lógica para garantir integridade e coerência entre os arquivos gerados:

1. **`python etl_censo_escolar.py`** (Base principal de matrículas de todas as seções)
2. **`python etl_infra_docentes.py`** (Gera a infraestrutura física e os dados de corpo docente)
3. **`python etl_fluxo_rendimento.py`** (Calcula as taxas oficiais UF/INEP de aprovação e distorção)
4. **`python etl_funil_turma_locdif.py`** (Agrega dados de localização de escolas diferenciadas)
5. **`python etl_saers.py`** e **`python etl_saeb.py`** (Atualiza as proficiências das avaliações oficiais)
6. **`python etl_desigualdades.py`** ou **`python run_etl_all.py`** (Processa os recortes socioeconômicos de raça/cor/sexo no SAERS)
7. **`python etl_escolas.py`** (Compila as coordenadas das escolas para o mapa final)
8. **`python etl_inse.py`**, **`etl_icg.py`**, **`etl_afd.py`** (Atualiza os indicadores complementares do INEP)

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
Abra o prompt de comando ou terminal, navegue até a pasta raiz do projeto e execute:
```bash
python etl_censo_escolar.py
```
O console exibirá o progresso de leitura do arquivo bruto, o filtro para as escolas ativas do Rio Grande do Sul e a geração dos novos JSONs em `painel/dados/4_1_acesso_[rede].json`.

### Passo 4: Publicar as alterações no Git
Uma vez que o script rodar com sucesso e gerar os arquivos em `painel/dados/`, basta versionar e subir as atualizações para o GitHub que hospeda a página:
```bash
git add painel/dados/
git commit -m "data: adiciona dados do Censo Escolar 2026"
git push
```
O painel detectará a nova chave do ano automaticamente e exibirá o ano 2026 na interface instantaneamente.
