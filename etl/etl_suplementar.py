# -*- coding: utf-8 -*-
"""
ETL SUPLEMENTAR — Matrículas por Série, Turno e Ed. Profissional/Técnica
Extrai dados adicionais da Tabela_Matricula_2025 e microdados 2019-2024.
Enriquece o JSON 4_1_acesso_matriculas.json existente.
"""
import sys, io


# --- caminhos portateis (repo Git + bases locais) ---
from paths import BASE, OUT_DIR, PAINEL_DIR, BASES_DIR, BASES_BASICAS  # noqa: E402

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import pandas as pd
import numpy as np
import json, os, glob, time

MICRO_DIR = os.path.join(BASE, "00. Bases de Dados", "01. Acesso e Matrículas (Censo Escolar_2010_2025)", "01. extrações_2010_2025")

CO_UF_RS = 43

REDES = {
    'estadual':      {'dep': [2], 'cat_priv': None},
    'municipal':     {'dep': [3], 'cat_priv': None},
    'federal':       {'dep': [1], 'cat_priv': None},
    'filantropica':  {'dep': [4], 'cat_priv': 4},
    'privada':       {'dep': [4], 'cat_priv': None},
    'todas':         {'dep': [1, 2, 3, 4], 'cat_priv': None},
}

# ══════════════════════════════════════════════════════════
# Colunas por série
# ══════════════════════════════════════════════════════════
COLS_SERIE = [
    "QT_MAT_FUND_AI_1", "QT_MAT_FUND_AI_2", "QT_MAT_FUND_AI_3",
    "QT_MAT_FUND_AI_4", "QT_MAT_FUND_AI_5",
    "QT_MAT_FUND_AF_6", "QT_MAT_FUND_AF_7", "QT_MAT_FUND_AF_8", "QT_MAT_FUND_AF_9",
    "QT_MAT_MED_PROP_1", "QT_MAT_MED_PROP_2", "QT_MAT_MED_PROP_3", "QT_MAT_MED_PROP_4",
]

LABELS_SERIE = {
    "QT_MAT_FUND_AI_1": "1º Ano", "QT_MAT_FUND_AI_2": "2º Ano",
    "QT_MAT_FUND_AI_3": "3º Ano", "QT_MAT_FUND_AI_4": "4º Ano",
    "QT_MAT_FUND_AI_5": "5º Ano",
    "QT_MAT_FUND_AF_6": "6º Ano", "QT_MAT_FUND_AF_7": "7º Ano",
    "QT_MAT_FUND_AF_8": "8º Ano", "QT_MAT_FUND_AF_9": "9º Ano",
    "QT_MAT_MED_PROP_1": "1ª Série EM", "QT_MAT_MED_PROP_2": "2ª Série EM",
    "QT_MAT_MED_PROP_3": "3ª Série EM", "QT_MAT_MED_PROP_4": "4ª Série EM",
}

# ══════════════════════════════════════════════════════════
# Colunas de educação profissional/técnica
# ══════════════════════════════════════════════════════════
COLS_PROF = [
    "QT_MAT_PROF", "QT_MAT_PROF_TEC", "QT_MAT_PROF_TEC_CONC", "QT_MAT_PROF_TEC_SUBS",
    "QT_MAT_PROF_TEC_IFTP_CT", "QT_MAT_PROF_NAO_TEC", "QT_MAT_PROF_IFTP_QP",
    "QT_MAT_PROF_FIC_CONC",
    "QT_MAT_MED_IFTP_CT",
    "QT_MAT_MED_IFTP_CT_1", "QT_MAT_MED_IFTP_CT_2", "QT_MAT_MED_IFTP_CT_3", "QT_MAT_MED_IFTP_CT_4",
    "QT_MAT_EJA_MED_TEC",
]

LABELS_PROF = {
    "QT_MAT_PROF": "Ed. Profissional (Total)",
    "QT_MAT_PROF_TEC": "Cursos Técnicos",
    "QT_MAT_PROF_TEC_CONC": "Técnico Concomitante",
    "QT_MAT_PROF_TEC_SUBS": "Técnico Subsequente",
    "QT_MAT_PROF_TEC_IFTP_CT": "Técnico IFTP CT",
    "QT_MAT_PROF_NAO_TEC": "Profissional Não Técnico",
    "QT_MAT_PROF_IFTP_QP": "Qualificação Profissional",
    "QT_MAT_PROF_FIC_CONC": "FIC Concomitante",
    "QT_MAT_MED_IFTP_CT": "Médio Integrado (Curso Técnico)",
    "QT_MAT_MED_IFTP_CT_1": "Médio Integrado 1ª Série",
    "QT_MAT_MED_IFTP_CT_2": "Médio Integrado 2ª Série",
    "QT_MAT_MED_IFTP_CT_3": "Médio Integrado 3ª Série",
    "QT_MAT_MED_IFTP_CT_4": "Médio Integrado 4ª Série",
    "QT_MAT_EJA_MED_TEC": "EJA Médio Técnico",
}

# ══════════════════════════════════════════════════════════
# Colunas por turno
# ══════════════════════════════════════════════════════════
COLS_TURNO = [
    "QT_MAT_BAS_D", "QT_MAT_BAS_N",
    "QT_MAT_FUND_D", "QT_MAT_FUND_N",
    "QT_MAT_FUND_AI_D", "QT_MAT_FUND_AI_N",
    "QT_MAT_FUND_AF_D", "QT_MAT_FUND_AF_N",
    "QT_MAT_MED_D", "QT_MAT_MED_N",
    "QT_MAT_PROF_D", "QT_MAT_PROF_N",
    "QT_MAT_PROF_TEC_D", "QT_MAT_PROF_TEC_N",
    "QT_MAT_EJA_D", "QT_MAT_EJA_N",
]

def safe_int(v):
    return 0 if pd.isna(v) else int(v)

def safe_sum(df, col):
    return safe_int(df[col].sum()) if col in df.columns else 0

def processar_2025(rede_key, rede_cfg):
    """Processa Tabela_Matricula_2025 + Tabela_Escola_2025."""
    # Escola para filtrar RS + rede
    f_escola = os.path.join(MICRO_DIR, "Tabela_Escola_2025.csv")
    escola_cols = ["CO_UF", "CO_MUNICIPIO", "CO_ENTIDADE", "TP_DEPENDENCIA",
                   "TP_CATEGORIA_ESCOLA_PRIVADA", "TP_SITUACAO_FUNCIONAMENTO"]
    h_esc = pd.read_csv(f_escola, sep=";", encoding="latin-1", nrows=0)
    use_esc = [c for c in escola_cols if c in h_esc.columns]
    df_esc = pd.read_csv(f_escola, sep=";", encoding="latin-1", usecols=use_esc)
    df_esc = df_esc[(df_esc["CO_UF"] == CO_UF_RS) & (df_esc["TP_SITUACAO_FUNCIONAMENTO"] == 1)]
    df_esc = df_esc[df_esc["TP_DEPENDENCIA"].isin(rede_cfg['dep'])]
    if rede_cfg['cat_priv'] is not None and 'TP_CATEGORIA_ESCOLA_PRIVADA' in df_esc.columns:
        df_esc = df_esc[df_esc['TP_CATEGORIA_ESCOLA_PRIVADA'] == rede_cfg['cat_priv']]
    entidades = set(df_esc["CO_ENTIDADE"].unique())

    # Matrícula
    f_mat = os.path.join(MICRO_DIR, "Tabela_Matricula_2025.csv")
    h_mat = pd.read_csv(f_mat, sep=";", encoding="latin-1", nrows=0)
    all_want = ["CO_ENTIDADE"] + COLS_SERIE + COLS_PROF + COLS_TURNO
    use_mat = [c for c in all_want if c in h_mat.columns]
    df_mat = pd.read_csv(f_mat, sep=";", encoding="latin-1", usecols=use_mat)
    df_mat = df_mat[df_mat["CO_ENTIDADE"].isin(entidades)]

    # Merge com município
    df = df_esc[["CO_ENTIDADE", "CO_MUNICIPIO"]].merge(df_mat, on="CO_ENTIDADE", how="inner")
    num = [c for c in df.columns if c.startswith("QT_")]
    df[num] = df[num].fillna(0).astype(int)

    return df

def processar_microdados(ano, rede_cfg):
    """Processa microdados de um ano (2010-2024)."""
    pattern = os.path.join(MICRO_DIR, f"microdados_ed_basica_{ano}.*")
    matches = glob.glob(pattern)
    if not matches:
        return pd.DataFrame()

    filepath = matches[0]
    header = pd.read_csv(filepath, sep=";", encoding="latin-1", nrows=0)
    id_cols = ["CO_UF", "CO_MUNICIPIO", "CO_ENTIDADE", "TP_DEPENDENCIA",
               "TP_CATEGORIA_ESCOLA_PRIVADA", "TP_SITUACAO_FUNCIONAMENTO"]
    want = COLS_PROF + COLS_SERIE + COLS_TURNO  # Turno: todos os anos; Série: desde 2023
    avail = [c for c in want if c in header.columns]
    if not avail:
        return pd.DataFrame()

    use = [c for c in id_cols if c in header.columns] + avail
    df = pd.read_csv(filepath, sep=";", encoding="latin-1", usecols=use)
    df = df[(df["CO_UF"] == CO_UF_RS) & (df["TP_SITUACAO_FUNCIONAMENTO"] == 1)]
    df = df[df["TP_DEPENDENCIA"].isin(rede_cfg['dep'])]
    if rede_cfg['cat_priv'] is not None and 'TP_CATEGORIA_ESCOLA_PRIVADA' in df.columns:
        df['TP_CATEGORIA_ESCOLA_PRIVADA'] = df['TP_CATEGORIA_ESCOLA_PRIVADA'].fillna(0).astype(int)
        df = df[df['TP_CATEGORIA_ESCOLA_PRIVADA'] == rede_cfg['cat_priv']]

    num = [c for c in df.columns if c.startswith("QT_")]
    if num:
        df[num] = df[num].fillna(0).astype(int)
    return df

def agregar(df, cols):
    """Agrega um DataFrame em um dict de somas."""
    return {c: safe_sum(df, c) for c in cols if c in df.columns}

def agregar_por_mun(df, cols):
    """Agrega por município."""
    result = {}
    for cod, grp in df.groupby("CO_MUNICIPIO"):
        result[str(int(cod))] = agregar(grp, cols)
    return result

if __name__ == "__main__":
    print("=" * 70)
    print("ETL SUPLEMENTAR — Série, Turno e Ed. Profissional")
    print("=" * 70)
    t0 = time.time()

    for rede_key, rede_cfg in REDES.items():
        print(f"\n{'─' * 50}")
        print(f"REDE: {rede_key.upper()}")
        print(f"{'─' * 50}")

        # Carregar JSON existente
        json_path = os.path.join(OUT_DIR, f"4_1_acesso_{rede_key}.json")
        if not os.path.exists(json_path):
            print(f"  [SKIP] JSON não encontrado: {json_path}")
            continue

        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        # ── 1. Processar 2025 (série + turno + prof) ──
        print("  [1/3] Tabela_Matricula_2025...", flush=True)
        df_2025 = processar_2025(rede_key, rede_cfg)
        print(f"    {len(df_2025)} escolas")

        # Série
        serie_2025 = agregar(df_2025, COLS_SERIE)
        # Turno
        turno_2025 = agregar(df_2025, COLS_TURNO)
        # Profissional
        prof_2025 = agregar(df_2025, COLS_PROF)

        # Adicionar ao serie_temporal 2025
        if "2025" in data["serie_temporal"]:
            data["serie_temporal"]["2025"]["por_serie"] = serie_2025
            data["serie_temporal"]["2025"]["por_turno"] = turno_2025
            data["serie_temporal"]["2025"]["mat_prof"] = prof_2025["QT_MAT_PROF"] if "QT_MAT_PROF" in prof_2025 else 0
            data["serie_temporal"]["2025"]["mat_prof_tec"] = prof_2025.get("QT_MAT_PROF_TEC", 0)
            data["serie_temporal"]["2025"]["mat_med_integrado"] = prof_2025.get("QT_MAT_MED_IFTP_CT", 0)
            data["serie_temporal"]["2025"]["mat_eja_med_tec"] = prof_2025.get("QT_MAT_EJA_MED_TEC", 0)
            data["serie_temporal"]["2025"]["detalhes_prof"] = prof_2025
            print(f"    2025: prof={prof_2025.get('QT_MAT_PROF',0):,}, tec={prof_2025.get('QT_MAT_PROF_TEC',0):,}, integrado={prof_2025.get('QT_MAT_MED_IFTP_CT',0):,}")

        # Série por município 2025
        serie_mun_2025 = agregar_por_mun(df_2025, COLS_SERIE)
        turno_mun_2025 = agregar_por_mun(df_2025, COLS_TURNO)
        prof_mun_2025 = agregar_por_mun(df_2025, COLS_PROF)

        if "2025" in data.get("por_municipio", {}):
            for cod in data["por_municipio"]["2025"]:
                if cod in serie_mun_2025:
                    data["por_municipio"]["2025"][cod]["por_serie"] = serie_mun_2025[cod]
                if cod in turno_mun_2025:
                    data["por_municipio"]["2025"][cod]["por_turno"] = turno_mun_2025[cod]
                if cod in prof_mun_2025:
                    data["por_municipio"]["2025"][cod]["mat_prof"] = prof_mun_2025[cod].get("QT_MAT_PROF", 0)
                    data["por_municipio"]["2025"][cod]["mat_prof_tec"] = prof_mun_2025[cod].get("QT_MAT_PROF_TEC", 0)
                    data["por_municipio"]["2025"][cod]["detalhes_prof"] = prof_mun_2025[cod]

        # ── 2. Processar microdados 2010-2024 (prof/tec + série + turno) ──
        print("  [2/3] Microdados 2010-2024 (prof/tec + turno + série)...")
        for ano in range(2010, 2025):
            ano_str = str(ano)
            if ano_str not in data["serie_temporal"]:
                continue
            df_ano = processar_microdados(ano, rede_cfg)
            if len(df_ano) == 0:
                continue
            # Profissional
            prof_ano = agregar(df_ano, COLS_PROF)
            data["serie_temporal"][ano_str]["mat_prof"] = prof_ano.get("QT_MAT_PROF", 0)
            data["serie_temporal"][ano_str]["mat_prof_tec"] = prof_ano.get("QT_MAT_PROF_TEC", 0)
            # Detalhes profissional (2023+ — microdados têm QT_MAT_PROF_TEC_CONC etc.)
            has_detalhes = prof_ano.get("QT_MAT_PROF_TEC_CONC", 0) > 0 or prof_ano.get("QT_MAT_PROF_TEC_SUBS", 0) > 0
            if has_detalhes:
                data["serie_temporal"][ano_str]["detalhes_prof"] = prof_ano
            # Turno (disponível 2010+)
            turno_ano = agregar(df_ano, COLS_TURNO)
            if any(turno_ano.get(c, 0) > 0 for c in COLS_TURNO):
                data["serie_temporal"][ano_str]["por_turno"] = turno_ano
            # Série (disponível 2023+)
            serie_ano = agregar(df_ano, COLS_SERIE)
            if any(serie_ano.get(c, 0) > 0 for c in COLS_SERIE):
                data["serie_temporal"][ano_str]["por_serie"] = serie_ano
            # Per-municipality: prof + detalhes_prof + turno + série
            if ano_str in data.get("por_municipio", {}) and "CO_MUNICIPIO" in df_ano.columns:
                prof_mun = agregar_por_mun(df_ano, COLS_PROF)
                turno_mun = agregar_por_mun(df_ano, COLS_TURNO)
                serie_mun = agregar_por_mun(df_ano, COLS_SERIE)
                for cod in data["por_municipio"][ano_str]:
                    if cod in prof_mun:
                        data["por_municipio"][ano_str][cod]["mat_prof"] = prof_mun[cod].get("QT_MAT_PROF", 0)
                        data["por_municipio"][ano_str][cod]["mat_prof_tec"] = prof_mun[cod].get("QT_MAT_PROF_TEC", 0)
                        if has_detalhes:
                            data["por_municipio"][ano_str][cod]["detalhes_prof"] = prof_mun[cod]
                    if cod in turno_mun:
                        data["por_municipio"][ano_str][cod]["por_turno"] = turno_mun[cod]
                    if cod in serie_mun:
                        data["por_municipio"][ano_str][cod]["por_serie"] = serie_mun[cod]
            if prof_ano.get("QT_MAT_PROF", 0) > 0:
                print(f"    {ano}: prof={prof_ano.get('QT_MAT_PROF',0):,}, tec={prof_ano.get('QT_MAT_PROF_TEC',0):,}, turno={'✓' if turno_ano else '—'}, série={'✓' if serie_ano else '—'}")

        # ── 3. Adicionar labels ──
        print("  [3/3] Adicionando metadados...")
        data["labels_serie"] = LABELS_SERIE
        data["labels_prof"] = LABELS_PROF

        # Salvar
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=None, separators=(',', ':'))
        size_mb = os.path.getsize(json_path) / 1024 / 1024
        print(f"  Salvo: {os.path.basename(json_path)} ({size_mb:.1f} MB)")

    # Backward compatibility
    import shutil
    src = os.path.join(OUT_DIR, "4_1_acesso_estadual.json")
    dst = os.path.join(OUT_DIR, "4_1_acesso_matriculas.json")
    if os.path.exists(src):
        shutil.copy2(src, dst)
        print(f"\n  [COMPAT] Copiado {os.path.basename(src)} -> {os.path.basename(dst)}")

    print(f"\nTempo total: {time.time()-t0:.1f}s")
