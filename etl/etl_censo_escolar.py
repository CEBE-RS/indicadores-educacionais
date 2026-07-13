# -*- coding: utf-8 -*-
"""
ETL Censo Escolar — Produto 4 UNESCO RS
Lê microdados 2010-2024 + Tabelas 2025, filtra RS, calcula indicadores
e gera JSONs para o painel de Indicadores Educacionais.
"""

import sys, io


# --- caminhos portateis (repo Git + bases locais) ---
from paths import BASE, OUT_DIR, PAINEL_DIR, BASES_DIR, BASES_BASICAS  # noqa: E402

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import pandas as pd
import numpy as np
import json, os, glob, time

# ══════════════════════════════════════════════════════════════
# CONFIGURACAO
# ══════════════════════════════════════════════════════════════

MICRO_DIR = os.path.join(BASE, "00. Bases de Dados", "01. Acesso e Matrículas (Censo Escolar_2010_2025)", "01. extrações_2010_2025")

CO_UF_RS = 43

# Configuracao multi-rede
REDES = {
    'estadual':      {'dep': [2], 'cat_priv': None},
    'municipal':     {'dep': [3], 'cat_priv': None},
    'federal':       {'dep': [1], 'cat_priv': None},
    'filantropica':  {'dep': [4], 'cat_priv': 4},
    'privada':       {'dep': [4], 'cat_priv': None},
    'todas':         {'dep': [1, 2, 3, 4], 'cat_priv': None},
}

# Colunas que existem em TODOS os anos (2010-2024)
COLS_IDENTIFICACAO = [
    "CO_UF", "CO_MUNICIPIO", "CO_ENTIDADE", "NO_ENTIDADE",
    "TP_DEPENDENCIA", "TP_CATEGORIA_ESCOLA_PRIVADA",
    "TP_LOCALIZACAO", "TP_SITUACAO_FUNCIONAMENTO",
    "TP_LOCALIZACAO_DIFERENCIADA",
]

COLS_MATRICULA_ETAPA = [
    "QT_MAT_BAS",
    "QT_MAT_INF", "QT_MAT_INF_CRE", "QT_MAT_INF_PRE",
    "QT_MAT_FUND", "QT_MAT_FUND_AI", "QT_MAT_FUND_AF",
    "QT_MAT_MED",
    "QT_MAT_EJA",
    "QT_MAT_ESP",
]

COLS_MATRICULA_PERFIL = [
    "QT_MAT_BAS_MASC", "QT_MAT_BAS_FEM",
    "QT_MAT_BAS_BRANCA", "QT_MAT_BAS_PRETA", "QT_MAT_BAS_PARDA",
    "QT_MAT_BAS_AMARELA", "QT_MAT_BAS_INDIGENA", "QT_MAT_BAS_ND",
]

COLS_FAIXA_ETARIA = [
    "QT_MAT_BAS_0_3", "QT_MAT_BAS_4_5", "QT_MAT_BAS_6_10",
    "QT_MAT_BAS_11_14", "QT_MAT_BAS_15_17", "QT_MAT_BAS_18_MAIS",
]

COLS_NOTURNO = ["QT_MAT_BAS_N"]

# Noturno por etapa (2025 only)
COLS_NOTURNO_ETAPA = ["QT_MAT_FUND_N", "QT_MAT_MED_N", "QT_MAT_EJA_N"]

COLS_ESPECIAL = [
    "QT_MAT_ESP", "QT_MAT_ESP_CC", "QT_MAT_ESP_CE",
]

# Ed. Especial por etapa (2025 only)
COLS_ESPECIAL_ETAPA = [
    "QT_MAT_ESP_CC_INF", "QT_MAT_ESP_CC_FUND", "QT_MAT_ESP_CC_MED", "QT_MAT_ESP_CC_EJA",
    "QT_MAT_ESP_CE_INF", "QT_MAT_ESP_CE_FUND", "QT_MAT_ESP_CE_MED", "QT_MAT_ESP_CE_EJA",
    # Tipo de deficiência (2025 only)
    "QT_MAT_ESP_D", "QT_MAT_ESP_DM", "QT_MAT_ESP_DV",
]

# Colunas que so existem a partir de 2023
COLS_INTEGRAL = [
    "QT_MAT_FUND_INT", "QT_MAT_FUND_AI_INT", "QT_MAT_FUND_AF_INT",
    "QT_MAT_MED_INT", "QT_MAT_INF_INT", "QT_MAT_INF_CRE_INT", "QT_MAT_INF_PRE_INT",
]

COLS_ZONA_RESIDENCIA = ["QT_MAT_ZR_URB", "QT_MAT_ZR_RUR", "QT_MAT_ZR_NA"]

DEP_MAP = {1: "Federal", 2: "Estadual", 3: "Municipal", 4: "Privada"}
LOC_MAP = {1: "Urbana", 2: "Rural"}

def ler_microdados_ano(ano: int) -> pd.DataFrame:
    """Le microdados de um ano, filtra RS e escolas ativas (TODAS as redes)."""
    pattern = os.path.join(MICRO_DIR, f"microdados_ed_basica_{ano}.*")
    matches = glob.glob(pattern)
    if not matches:
        print(f"  [ERRO] Arquivo nao encontrado para {ano}")
        return pd.DataFrame()

    filepath = matches[0]
    print(f"  Lendo {os.path.basename(filepath)}...", end=" ", flush=True)
    t0 = time.time()

    # Determinar colunas disponiveis
    header = pd.read_csv(filepath, sep=";", encoding="latin-1", nrows=0)
    all_desired = (COLS_IDENTIFICACAO + COLS_MATRICULA_ETAPA + COLS_MATRICULA_PERFIL
                   + COLS_FAIXA_ETARIA + COLS_NOTURNO + COLS_NOTURNO_ETAPA
                   + COLS_ESPECIAL + COLS_ESPECIAL_ETAPA
                   + COLS_INTEGRAL + COLS_ZONA_RESIDENCIA)
    use_cols = [c for c in all_desired if c in header.columns]

    df = pd.read_csv(filepath, sep=";", encoding="latin-1", usecols=use_cols)
    # Filtra RS + escolas ativas (SEM filtro de rede — sera aplicado depois)
    df = df[(df["CO_UF"] == CO_UF_RS) & (df["TP_SITUACAO_FUNCIONAMENTO"] == 1)]
    df["ANO"] = ano

    elapsed = time.time() - t0
    print(f"{len(df)} escolas ({elapsed:.1f}s)")
    return df

def ler_tabelas_2025() -> pd.DataFrame:
    """Le e combina as tabelas separadas de 2025 (TODAS as redes)."""
    print("  Lendo Tabelas 2025...", flush=True)
    t0 = time.time()

    # Tabela_Escola tem os metadados (UF, municipio, dependencia, localizacao)
    f_escola = os.path.join(MICRO_DIR, "Tabela_Escola_2025.csv")
    escola_cols = ["CO_UF", "CO_MUNICIPIO", "CO_ENTIDADE", "NO_ENTIDADE",
                   "TP_DEPENDENCIA", "TP_CATEGORIA_ESCOLA_PRIVADA",
                   "TP_LOCALIZACAO", "TP_SITUACAO_FUNCIONAMENTO",
                   "TP_LOCALIZACAO_DIFERENCIADA"]
    
    h_escola = pd.read_csv(f_escola, sep=";", encoding="latin-1", nrows=0)
    escola_use = [c for c in escola_cols if c in h_escola.columns]
    df_escola = pd.read_csv(f_escola, sep=";", encoding="latin-1", usecols=escola_use)
    # Filtra RS + escolas ativas (SEM filtro de rede)
    df_escola = df_escola[(df_escola["CO_UF"] == CO_UF_RS) & (df_escola["TP_SITUACAO_FUNCIONAMENTO"] == 1)]
    print(f"    Escola: {len(df_escola)} registros RS (todas as redes)")

    # Tabela_Matricula tem as contagens QT_MAT_*
    f_mat = os.path.join(MICRO_DIR, "Tabela_Matricula_2025.csv")
    h_mat = pd.read_csv(f_mat, sep=";", encoding="latin-1", nrows=0)
    
    mat_desired = (["CO_ENTIDADE"] + COLS_MATRICULA_ETAPA + COLS_MATRICULA_PERFIL
                   + COLS_FAIXA_ETARIA + COLS_NOTURNO + COLS_NOTURNO_ETAPA
                   + COLS_ESPECIAL + COLS_ESPECIAL_ETAPA
                   + COLS_INTEGRAL + COLS_ZONA_RESIDENCIA)
    mat_use = [c for c in mat_desired if c in h_mat.columns]
    df_mat = pd.read_csv(f_mat, sep=";", encoding="latin-1", usecols=mat_use)
    print(f"    Matricula: {len(df_mat)} registros totais")

    # JOIN por CO_ENTIDADE
    entidades_rs = set(df_escola["CO_ENTIDADE"].unique())
    df_mat = df_mat[df_mat["CO_ENTIDADE"].isin(entidades_rs)]
    
    df = df_escola.merge(df_mat, on="CO_ENTIDADE", how="inner")
    df["ANO"] = 2025

    elapsed = time.time() - t0
    print(f"    Resultado: {len(df)} escolas ({elapsed:.1f}s)")
    return df

def calcular_agregacoes(df_all: pd.DataFrame) -> dict:
    """Calcula todas as agregacoes para o JSON de saida."""
    resultado = {
        "metadata": {
            "fonte": "Censo Escolar INEP",
            "anos": sorted(df_all["ANO"].unique().tolist()),
            "uf": "RS",
            "gerado_em": pd.Timestamp.now().isoformat(),
            "total_escolas_por_ano": {},
        },
        "serie_temporal": {},
        "por_dependencia": {},
        "por_localizacao": {},
        "por_municipio": {},
        "perfil_alunos": {},
        "integral": {},
    }

    anos = sorted(df_all["ANO"].unique())
    
    # -- Total de escolas por ano --
    for ano in anos:
        df_ano = df_all[df_all["ANO"] == ano]
        resultado["metadata"]["total_escolas_por_ano"][str(ano)] = int(len(df_ano))

    # ── 1. SERIE TEMPORAL (agregado estadual por ano) ──
    print("\n  [1/9] Serie temporal...")
    for ano in anos:
        df_ano = df_all[df_all["ANO"] == ano]
        ano_key = str(ano)
        
        serie = {
            "total_escolas": int(len(df_ano)),
            "mat_total": safe_int(df_ano["QT_MAT_BAS"].sum()),
            "mat_infantil": safe_int(df_ano["QT_MAT_INF"].sum()),
            "mat_infantil_creche": safe_int(df_ano["QT_MAT_INF_CRE"].sum()),
            "mat_infantil_pre": safe_int(df_ano["QT_MAT_INF_PRE"].sum()),
            "mat_fundamental": safe_int(df_ano["QT_MAT_FUND"].sum()),
            "mat_fund_ai": safe_int(df_ano["QT_MAT_FUND_AI"].sum()),
            "mat_fund_af": safe_int(df_ano["QT_MAT_FUND_AF"].sum()),
            "mat_medio": safe_int(df_ano["QT_MAT_MED"].sum()),
            "mat_eja": safe_int(df_ano["QT_MAT_EJA"].sum()),
            "mat_especial": safe_int(df_ano["QT_MAT_ESP"].sum()),
            # Faixa etária
            "fx_0_3": safe_col_sum(df_ano, "QT_MAT_BAS_0_3"),
            "fx_4_5": safe_col_sum(df_ano, "QT_MAT_BAS_4_5"),
            "fx_6_10": safe_col_sum(df_ano, "QT_MAT_BAS_6_10"),
            "fx_11_14": safe_col_sum(df_ano, "QT_MAT_BAS_11_14"),
            "fx_15_17": safe_col_sum(df_ano, "QT_MAT_BAS_15_17"),
            "fx_18_mais": safe_col_sum(df_ano, "QT_MAT_BAS_18_MAIS"),
            # Noturno
            "mat_noturno": safe_col_sum(df_ano, "QT_MAT_BAS_N"),
            "mat_noturno_fund": safe_col_sum(df_ano, "QT_MAT_FUND_N"),
            "mat_noturno_medio": safe_col_sum(df_ano, "QT_MAT_MED_N"),
            "mat_noturno_eja": safe_col_sum(df_ano, "QT_MAT_EJA_N"),
            # Educação Especial
            "esp_total": safe_col_sum(df_ano, "QT_MAT_ESP"),
            "esp_classes_comuns": safe_col_sum(df_ano, "QT_MAT_ESP_CC"),
            "esp_classes_exclusivas": safe_col_sum(df_ano, "QT_MAT_ESP_CE"),
            # Ed. Especial por etapa (2025+)
            "esp_cc_inf": safe_col_sum(df_ano, "QT_MAT_ESP_CC_INF"),
            "esp_cc_fund": safe_col_sum(df_ano, "QT_MAT_ESP_CC_FUND"),
            "esp_cc_med": safe_col_sum(df_ano, "QT_MAT_ESP_CC_MED"),
            "esp_cc_eja": safe_col_sum(df_ano, "QT_MAT_ESP_CC_EJA"),
            "esp_ce_inf": safe_col_sum(df_ano, "QT_MAT_ESP_CE_INF"),
            "esp_ce_fund": safe_col_sum(df_ano, "QT_MAT_ESP_CE_FUND"),
            "esp_ce_med": safe_col_sum(df_ano, "QT_MAT_ESP_CE_MED"),
            "esp_ce_eja": safe_col_sum(df_ano, "QT_MAT_ESP_CE_EJA"),
            # Tipo de deficiência (2025+)
            "esp_d": safe_col_sum(df_ano, "QT_MAT_ESP_D"),
            "esp_dm": safe_col_sum(df_ano, "QT_MAT_ESP_DM"),
            "esp_dv": safe_col_sum(df_ano, "QT_MAT_ESP_DV"),
        }
        resultado["serie_temporal"][ano_key] = serie

    # ── 2. POR DEPENDENCIA ADMINISTRATIVA ──
    print("  [2/9] Por dependencia administrativa...")
    for ano in anos:
        df_ano = df_all[df_all["ANO"] == ano]
        ano_key = str(ano)
        resultado["por_dependencia"][ano_key] = {}
        
        for dep_cod, dep_nome in DEP_MAP.items():
            df_dep = df_ano[df_ano["TP_DEPENDENCIA"] == dep_cod]
            resultado["por_dependencia"][ano_key][dep_nome] = {
                "escolas": int(len(df_dep)),
                "mat_total": safe_int(df_dep["QT_MAT_BAS"].sum()),
                "mat_infantil": safe_int(df_dep["QT_MAT_INF"].sum()),
                "mat_fundamental": safe_int(df_dep["QT_MAT_FUND"].sum()),
                "mat_fund_ai": safe_int(df_dep["QT_MAT_FUND_AI"].sum()),
                "mat_fund_af": safe_int(df_dep["QT_MAT_FUND_AF"].sum()),
                "mat_medio": safe_int(df_dep["QT_MAT_MED"].sum()),
                "mat_eja": safe_int(df_dep["QT_MAT_EJA"].sum()),
            }

    # ── 3. POR LOCALIZACAO ──
    print("  [3/9] Por localizacao...")
    for ano in anos:
        df_ano = df_all[df_all["ANO"] == ano]
        ano_key = str(ano)
        resultado["por_localizacao"][ano_key] = {}
        
        for loc_cod, loc_nome in LOC_MAP.items():
            df_loc = df_ano[df_ano["TP_LOCALIZACAO"] == loc_cod]
            resultado["por_localizacao"][ano_key][loc_nome] = {
                "escolas": int(len(df_loc)),
                "mat_total": safe_int(df_loc["QT_MAT_BAS"].sum()),
            }

    # ── 4. POR MUNICIPIO ──
    print("  [4/9] Por municipio...")
    ultimo_ano = max(anos)
    df_ult = df_all[df_all["ANO"] == ultimo_ano]
    mun_agg = df_ult.groupby("CO_MUNICIPIO").agg(
        escolas=("CO_ENTIDADE", "count"),
        mat_total=("QT_MAT_BAS", "sum"),
        mat_fund=("QT_MAT_FUND", "sum"),
        mat_medio=("QT_MAT_MED", "sum"),
    ).reset_index().sort_values("mat_total", ascending=False)
    
    # Colunas opcionais para agregacao municipal (inclui tudo que existe nos microdados)
    OPT_MUN_COLS = {
        # Faixa etária
        "fx_0_3": "QT_MAT_BAS_0_3", "fx_4_5": "QT_MAT_BAS_4_5",
        "fx_6_10": "QT_MAT_BAS_6_10", "fx_11_14": "QT_MAT_BAS_11_14",
        "fx_15_17": "QT_MAT_BAS_15_17", "fx_18_mais": "QT_MAT_BAS_18_MAIS",
        # Noturno
        "mat_noturno": "QT_MAT_BAS_N",
        "mat_noturno_fund": "QT_MAT_FUND_N", "mat_noturno_med": "QT_MAT_MED_N", "mat_noturno_eja": "QT_MAT_EJA_N",
        # Ed. Especial - totais
        "esp_total": "QT_MAT_ESP", "esp_cc": "QT_MAT_ESP_CC", "esp_ce": "QT_MAT_ESP_CE",
        # Ed. Especial por etapa - Classes Comuns
        "esp_cc_inf": "QT_MAT_ESP_CC_INF", "esp_cc_fund": "QT_MAT_ESP_CC_FUND",
        "esp_cc_med": "QT_MAT_ESP_CC_MED", "esp_cc_eja": "QT_MAT_ESP_CC_EJA",
        # Ed. Especial por etapa - Classes Exclusivas
        "esp_ce_inf": "QT_MAT_ESP_CE_INF", "esp_ce_fund": "QT_MAT_ESP_CE_FUND",
        "esp_ce_med": "QT_MAT_ESP_CE_MED", "esp_ce_eja": "QT_MAT_ESP_CE_EJA",
        # Tipo de deficiência
        "esp_def": "QT_MAT_ESP_D", "esp_def_mult": "QT_MAT_ESP_DM", "esp_def_visual": "QT_MAT_ESP_DV",
        # Integral
        "int_fund_total": "QT_MAT_FUND_INT",
        "int_fund_ai": "QT_MAT_FUND_AI_INT", "int_fund_af": "QT_MAT_FUND_AF_INT",
        "int_medio": "QT_MAT_MED_INT", "int_infantil": "QT_MAT_INF_INT",
        "int_inf_cre": "QT_MAT_INF_CRE_INT", "int_inf_pre": "QT_MAT_INF_PRE_INT",
        # Zona de residência
        "zr_urbana": "QT_MAT_ZR_URB", "zr_rural": "QT_MAT_ZR_RUR", "zr_na": "QT_MAT_ZR_NA",
        # Localização diferenciada (dummy — calculated below)
        "locdif_terra_indigena_esc": "_LOCDIF_TI_ESC",
        "locdif_terra_indigena_mat": "_LOCDIF_TI_MAT",
        "locdif_quilombola_esc": "_LOCDIF_QU_ESC",
        "locdif_quilombola_mat": "_LOCDIF_QU_MAT",
        "locdif_assentamento_esc": "_LOCDIF_AS_ESC",
        "locdif_assentamento_mat": "_LOCDIF_AS_MAT",
    }

    # Create localização diferenciada dummy columns
    # TP_LOCALIZACAO_DIFERENCIADA: 1=Assentamento, 2=Terra Indígena, 3=Quilombola
    if "TP_LOCALIZACAO_DIFERENCIADA" in df_all.columns:
        tp = df_all["TP_LOCALIZACAO_DIFERENCIADA"].fillna(0).astype(int)
        bas = df_all["QT_MAT_BAS"].fillna(0).astype(int)
        df_all["_LOCDIF_TI_ESC"] = (tp == 2).astype(int)
        df_all["_LOCDIF_TI_MAT"] = ((tp == 2).astype(int) * bas)
        df_all["_LOCDIF_QU_ESC"] = (tp == 3).astype(int)
        df_all["_LOCDIF_QU_MAT"] = ((tp == 3).astype(int) * bas)
        df_all["_LOCDIF_AS_ESC"] = (tp == 1).astype(int)
        df_all["_LOCDIF_AS_MAT"] = ((tp == 1).astype(int) * bas)

    # Serie temporal por municipio (todos os anos, todos os municipios)
    for ano in anos:
        df_ano = df_all[df_all["ANO"] == ano]
        ano_key = str(ano)
        
        # Build agg dict dynamically based on available columns
        agg_dict = {
            "escolas": ("CO_ENTIDADE", "count"),
            "mat_total": ("QT_MAT_BAS", "sum"),
            "mat_infantil": ("QT_MAT_INF", "sum"),
            "mat_fundamental": ("QT_MAT_FUND", "sum"),
            "mat_fund_ai": ("QT_MAT_FUND_AI", "sum"),
            "mat_fund_af": ("QT_MAT_FUND_AF", "sum"),
            "mat_medio": ("QT_MAT_MED", "sum"),
            "mat_eja": ("QT_MAT_EJA", "sum"),
            "masc": ("QT_MAT_BAS_MASC", "sum"),
            "fem": ("QT_MAT_BAS_FEM", "sum"),
            "branca": ("QT_MAT_BAS_BRANCA", "sum"),
            "preta": ("QT_MAT_BAS_PRETA", "sum"),
            "parda": ("QT_MAT_BAS_PARDA", "sum"),
            "amarela": ("QT_MAT_BAS_AMARELA", "sum"),
            "indigena": ("QT_MAT_BAS_INDIGENA", "sum"),
            "nao_declarada": ("QT_MAT_BAS_ND", "sum"),
        }
        for out_key, col_name in OPT_MUN_COLS.items():
            if col_name in df_ano.columns:
                agg_dict[out_key] = (col_name, "sum")

        mun_ano = df_ano.groupby("CO_MUNICIPIO").agg(**agg_dict).reset_index()
        
        resultado["por_municipio"][ano_key] = {}
        for _, row in mun_ano.iterrows():
            entry = {}
            for col in mun_ano.columns:
                if col == "CO_MUNICIPIO":
                    continue
                entry[col] = int(row[col])
            resultado["por_municipio"][ano_key][str(int(row["CO_MUNICIPIO"]))] = entry

    # ── 5. PERFIL DOS ALUNOS (sexo e raca) ──
    print("  [5/9] Perfil dos alunos...")
    for ano in anos:
        df_ano = df_all[df_all["ANO"] == ano]
        ano_key = str(ano)
        
        resultado["perfil_alunos"][ano_key] = {
            "sexo": {
                "masculino": safe_int(df_ano["QT_MAT_BAS_MASC"].sum()),
                "feminino": safe_int(df_ano["QT_MAT_BAS_FEM"].sum()),
            },
            "raca": {
                "branca": safe_int(df_ano["QT_MAT_BAS_BRANCA"].sum()),
                "preta": safe_int(df_ano["QT_MAT_BAS_PRETA"].sum()),
                "parda": safe_int(df_ano["QT_MAT_BAS_PARDA"].sum()),
                "amarela": safe_int(df_ano["QT_MAT_BAS_AMARELA"].sum()),
                "indigena": safe_int(df_ano["QT_MAT_BAS_INDIGENA"].sum()),
                "nao_declarada": safe_int(df_ano["QT_MAT_BAS_ND"].sum()),
            }
        }

    # ── 6. INTEGRAL (2023+ apenas) ──
    print("  [6/9] Matriculas em tempo integral...")
    for ano in anos:
        df_ano = df_all[df_all["ANO"] == ano]
        ano_key = str(ano)
        
        if "QT_MAT_FUND_INT" in df_ano.columns and df_ano["QT_MAT_FUND_INT"].notna().any():
            resultado["integral"][ano_key] = {
                "fund_total": safe_int(df_ano["QT_MAT_FUND_INT"].sum()),
                "fund_ai": safe_int(df_ano.get("QT_MAT_FUND_AI_INT", pd.Series([0])).sum()),
                "fund_af": safe_int(df_ano.get("QT_MAT_FUND_AF_INT", pd.Series([0])).sum()),
                "medio": safe_int(df_ano.get("QT_MAT_MED_INT", pd.Series([0])).sum()),
                "infantil": safe_int(df_ano.get("QT_MAT_INF_INT", pd.Series([0])).sum()),
            }

    return resultado

def calcular_variacao(resultado: dict) -> dict:
    """Calcula a variacao percentual inter-anual."""
    anos = sorted(resultado["serie_temporal"].keys())
    resultado["variacao_anual"] = {}
    
    for i in range(1, len(anos)):
        ano_ant = anos[i - 1]
        ano_cur = anos[i]
        chave = f"{ano_ant}-{ano_cur}"
        
        s_ant = resultado["serie_temporal"][ano_ant]
        s_cur = resultado["serie_temporal"][ano_cur]
        
        var = {}
        for metrica in s_ant:
            v_ant = s_ant[metrica]
            v_cur = s_cur[metrica]
            if v_ant and v_ant > 0:
                var[metrica] = round((v_cur - v_ant) / v_ant * 100, 2)
            else:
                var[metrica] = None
        resultado["variacao_anual"][chave] = var
    
    return resultado

def safe_int(val):
    """Converte para int seguro, tratando NaN."""
    if pd.isna(val):
        return 0
    return int(val)

def safe_col_sum(df, col):
    """Soma uma coluna que pode nao existir no DataFrame."""
    if col in df.columns:
        return safe_int(df[col].sum())
    return 0

def gerar_lookup_municipios(df_all: pd.DataFrame) -> dict:
    """Gera dicionario CO_MUNICIPIO -> nome para referencia."""
    # Pegar do ano mais recente que tenha NO_ENTIDADE nao eh ideal
    # Vamos usar a Tabela_Escola_2025 que tem NO_MUNICIPIO
    f_escola = os.path.join(MICRO_DIR, "Tabela_Escola_2025.csv")
    h = pd.read_csv(f_escola, sep=";", encoding="latin-1", nrows=0)
    
    if "NO_MUNICIPIO" in h.columns:
        cols = ["CO_UF", "CO_MUNICIPIO", "NO_MUNICIPIO"]
        df_e = pd.read_csv(f_escola, sep=";", encoding="latin-1", usecols=cols)
        df_e = df_e[df_e["CO_UF"] == CO_UF_RS]
        lookup = df_e.drop_duplicates("CO_MUNICIPIO").set_index("CO_MUNICIPIO")["NO_MUNICIPIO"].to_dict()
        return {str(k): v for k, v in lookup.items()}
    return {}

# ══════════════════════════════════════════════════════════════
# FILTRO DE REDE
# ══════════════════════════════════════════════════════════════

def filtrar_rede(df_all: pd.DataFrame, rede_key: str) -> pd.DataFrame:
    """Filtra o DataFrame por rede conforme REDES[rede_key]."""
    cfg = REDES[rede_key]
    df = df_all[df_all["TP_DEPENDENCIA"].isin(cfg['dep'])].copy()
    if cfg['cat_priv'] is not None:
        # Filantropica: TP_CATEGORIA_ESCOLA_PRIVADA == 4
        if 'TP_CATEGORIA_ESCOLA_PRIVADA' in df.columns:
            df = df[df['TP_CATEGORIA_ESCOLA_PRIVADA'] == cfg['cat_priv']]
        else:
            # Coluna nao existe neste ano — retorna vazio
            df = df.iloc[0:0]
    return df

# ══════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("=" * 70)
    print("ETL CENSO ESCOLAR RS — UNESCO Produto 4 (MULTI-REDE)")
    print("=" * 70)
    
    t_total = time.time()
    
    # 1. Ler todos os anos (TODAS as redes de uma vez)
    print("\n[ETAPA 1] Lendo microdados 2010-2024 (todas as redes)...")
    frames = []
    for ano in range(2010, 2025):
        df = ler_microdados_ano(ano)
        if len(df) > 0:
            frames.append(df)
    
    # 2. Ler 2025
    print("\n[ETAPA 2] Lendo tabelas 2025 (todas as redes)...")
    df_2025 = ler_tabelas_2025()
    if len(df_2025) > 0:
        frames.append(df_2025)
    
    # 3. Concatenar
    print("\n[ETAPA 3] Consolidando...")
    df_all = pd.concat(frames, ignore_index=True)
    print(f"  Total: {len(df_all)} registros ({df_all['ANO'].nunique()} anos)")
    
    # Preencher NaN com 0 nas colunas numericas
    num_cols = [c for c in df_all.columns if c.startswith("QT_MAT_")]
    df_all[num_cols] = df_all[num_cols].fillna(0).astype(int)
    
    # Preencher TP_CATEGORIA_ESCOLA_PRIVADA com 0 (NaN = escola publica)
    if 'TP_CATEGORIA_ESCOLA_PRIVADA' in df_all.columns:
        df_all['TP_CATEGORIA_ESCOLA_PRIVADA'] = df_all['TP_CATEGORIA_ESCOLA_PRIVADA'].fillna(0).astype(int)
    
    # 4. Lookup de municipios (gerar uma vez, independente de rede)
    print("\n[ETAPA 4] Gerando lookup de municipios...")
    lookup_municipios = gerar_lookup_municipios(df_all)
    print(f"  {len(lookup_municipios)} municipios mapeados")
    
    # 5. Processar cada rede
    print("\n[ETAPA 5] Gerando JSONs por rede...")
    for rede_key, rede_cfg in REDES.items():
        print(f"\n  {'─' * 50}")
        print(f"  REDE: {rede_key.upper()} (dep={rede_cfg['dep']}, cat_priv={rede_cfg['cat_priv']})")
        print(f"  {'─' * 50}")
        
        df_rede = filtrar_rede(df_all, rede_key)
        print(f"  Registros filtrados: {len(df_rede)} ({df_rede['ANO'].nunique()} anos)")
        
        if len(df_rede) == 0:
            print(f"  [SKIP] Nenhum registro para rede {rede_key}")
            continue
        
        resultado = calcular_agregacoes(df_rede)
        resultado = calcular_variacao(resultado)
        resultado["lookup_municipios"] = lookup_municipios
        resultado["metadata"]["rede"] = rede_key
        
        # Salvar JSON
        out_path = os.path.join(OUT_DIR, f"4_1_acesso_{rede_key}.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(resultado, f, ensure_ascii=False, indent=None, separators=(',', ':'))
        
        size_mb = os.path.getsize(out_path) / 1024 / 1024
        ultimo_ano = sorted(resultado['serie_temporal'].keys())[-1]
        s = resultado['serie_temporal'][ultimo_ano]
        print(f"  Salvo: {os.path.basename(out_path)} ({size_mb:.1f} MB)")
        print(f"  Ultimo ano ({ultimo_ano}): {s['total_escolas']} escolas, {s['mat_total']:,} matriculas")
    
    # 6. Backward compatibility: copiar estadual como 4_1_acesso_matriculas.json
    import shutil
    src = os.path.join(OUT_DIR, "4_1_acesso_estadual.json")
    dst = os.path.join(OUT_DIR, "4_1_acesso_matriculas.json")
    if os.path.exists(src):
        shutil.copy2(src, dst)
        print(f"\n  [COMPAT] Copiado {os.path.basename(src)} -> {os.path.basename(dst)}")
    
    elapsed_total = time.time() - t_total
    
    print(f"\n{'=' * 70}")
    print(f"CONCLUIDO! ({elapsed_total:.1f}s total)")
    print(f"{'=' * 70}")
    
    # Resumo por rede
    print("\nRESUMO (ultimo ano):")
    for rede_key in REDES:
        fpath = os.path.join(OUT_DIR, f"4_1_acesso_{rede_key}.json")
        if os.path.exists(fpath):
            with open(fpath, 'r', encoding='utf-8') as f:
                r = json.load(f)
            ultimo = sorted(r['serie_temporal'].keys())[-1]
            s = r['serie_temporal'][ultimo]
            print(f"  {rede_key:15s}: {s['total_escolas']:>6} escolas | {s['mat_total']:>10,} matriculas ({os.path.getsize(fpath)/1024/1024:.1f} MB)")
