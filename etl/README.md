# Pipeline ETL — Painel de Indicadores Educacionais

Scripts Python para gerar/atualizar os JSONs em `../dados/` a partir das bases oficiais (INEP/Censo, SAEB, SAERS etc.).

## Requisitos

```bash
pip install pandas numpy openpyxl
```

## Configuração de caminhos

Por padrão, o script assume:

```text
<projeto>/
  00. Bases de Dados/     # bases brutas (fora do Git)
  <este-repositorio>/     # clone GitHub
    etl/
    dados/
```

Se as bases estiverem em outro lugar:

```bash
# Windows (PowerShell)
$env:UNESCO_ETL_ROOT="C:\caminho\para\projeto"
```

## Execução (na pasta `etl/`)

```bash
cd etl
python etl_censo_escolar.py
python etl_infra_docentes.py
python etl_fluxo_rendimento.py
python etl_funil_turma_locdif.py
python etl_saeb.py
python etl_saers.py
python etl_desigualdades.py
python etl_escolas.py
python etl_inse.py
python etl_icg.py
python etl_afd.py
python etl_ideb.py
python etl_tdi.py
python etl_redes.py
python gerar_planilhas_download.py
```

Ou, para rodar a sequência completa:

```bash
python run_etl_all.py
```

Documentação completa: [`../DOCUMENTACAO_MANUTENCAO.md`](../DOCUMENTACAO_MANUTENCAO.md)
