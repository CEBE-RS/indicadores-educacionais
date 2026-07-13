# -*- coding: utf-8 -*-
"""
ETL Funil Educacional, Tamanho de Turma e Localizacao Diferenciada
Produto 4 UNESCO RS
"""
import sys, io


# --- caminhos portateis (repo Git + bases locais) ---
from paths import BASE, OUT_DIR, PAINEL_DIR, BASES_DIR, BASES_BASICAS  # noqa: E402

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import pandas as pd
import numpy as np
import json, os, glob, time

_bd = os.path.join(BASE, "00. Bases de Dados")
_d1 = [d for d in os.listdir(_bd) if d.startswith("01.")][0]
_d2 = [d for d in os.listdir(os.path.join(_bd, _d1)) if d.startswith("01.")][0]
MICRO_DIR = os.path.join(_bd, _d1, _d2)

CO_UF_RS = 43

def si(v): return 0 if pd.isna(v) else int(v)

# ══════════════════════════════════════════════════════════
# FUNIL POR SERIE + TAMANHO DE TURMA
# ══════════════════════════════════════════════════════════

FUNIL_COLS = {
    "1_ano": "QT_MAT_FUND_AI_1", "2_ano": "QT_MAT_FUND_AI_2",
    "3_ano": "QT_MAT_FUND_AI_3", "4_ano": "QT_MAT_FUND_AI_4",
    "5_ano": "QT_MAT_FUND_AI_5", "6_ano": "QT_MAT_FUND_AF_6",
    "7_ano": "QT_MAT_FUND_AF_7", "8_ano": "QT_MAT_FUND_AF_8",
    "9_ano": "QT_MAT_FUND_AF_9",
    "em_1": "QT_MAT_MED_NM_1", "em_2": "QT_MAT_MED_NM_2",
    "em_3": "QT_MAT_MED_NM_3", "em_4": "QT_MAT_MED_NM_4",
}

TURMA_PAIRS = [
    ("Educacao Basica",   "QT_MAT_BAS",     "QT_TUR_BAS"),
    ("Ed. Infantil",      "QT_MAT_INF",     "QT_TUR_INF"),
    ("Fund. Anos Iniciais","QT_MAT_FUND_AI","QT_TUR_FUND_AI"),
    ("Fund. Anos Finais", "QT_MAT_FUND_AF", "QT_TUR_FUND_AF"),
    ("Ens. Medio",        "QT_MAT_MED",     "QT_TUR_MED"),
    ("EJA",               "QT_MAT_EJA",     "QT_TUR_EJA"),
]

LOC_DIF_MAP = {0: "Nenhuma", 1: "Area de Assentamento", 2: "Terra Indigena",
               3: "Quilombola", 4: "Unidade de Conservacao", 5: "Comunidade Remanescente"}

def etl_funil_turma_locdif():
    print("=" * 60)
    print("ETL FUNIL + TURMA + LOCALIZACAO DIFERENCIADA")
    print("=" * 60)
    t0 = time.time()

    resultado = {
        "metadata": {"fonte": "Censo Escolar INEP", "uf": "RS",
                     "gerado_em": pd.Timestamp.now().isoformat()},
        "funil_por_serie": {},      # ano -> {serie: total}
        "tamanho_turma": {},        # ano -> {etapa: {mat, tur, media}}
        "localizacao_diferenciada": {},  # ano -> {tipo: {escolas, matriculas}}
    }

    micros = sorted(glob.glob(os.path.join(MICRO_DIR, "microdados_ed_basica_*.*")))
    id_cols = ["CO_UF", "CO_ENTIDADE", "TP_SITUACAO_FUNCIONAMENTO", "TP_DEPENDENCIA"]

    for fpath in micros:
        fname = os.path.basename(fpath)
        ano = fname.replace("microdados_ed_basica_","").replace(".csv","").replace(".CSV","")
        print(f"\n  {ano}...", end=" ", flush=True)
        t1 = time.time()

        header = list(pd.read_csv(fpath, sep=";", encoding="latin-1", nrows=0).columns)

        # Determine which columns to load
        need = list(id_cols)
        funil_avail = {k: v for k, v in FUNIL_COLS.items() if v in header}
        need += list(funil_avail.values())

        turma_avail = []
        for label, mat_col, tur_col in TURMA_PAIRS:
            if mat_col in header and tur_col in header:
                turma_avail.append((label, mat_col, tur_col))
                if mat_col not in need: need.append(mat_col)
                if tur_col not in need: need.append(tur_col)

        has_loc_dif = "TP_LOCALIZACAO_DIFERENCIADA" in header
        if has_loc_dif and "TP_LOCALIZACAO_DIFERENCIADA" not in need:
            need.append("TP_LOCALIZACAO_DIFERENCIADA")
        if "QT_MAT_BAS" not in need and "QT_MAT_BAS" in header:
            need.append("QT_MAT_BAS")

        df = pd.read_csv(fpath, sep=";", encoding="latin-1", usecols=need)
        df = df[(df["CO_UF"] == CO_UF_RS) & (df["TP_SITUACAO_FUNCIONAMENTO"] == 1)]
        n = len(df)

        # 1. Funil
        if funil_avail:
            funil = {}
            for serie, col in funil_avail.items():
                funil[serie] = si(df[col].sum())
            resultado["funil_por_serie"][ano] = funil
            print(f"funil={len(funil_avail)} series", end="  ", flush=True)
        else:
            print("funil=N/A", end="  ", flush=True)

        # 2. Tamanho de turma
        turma_data = {}
        for label, mat_col, tur_col in turma_avail:
            mat_total = si(df[mat_col].sum())
            tur_total = si(df[tur_col].sum())
            media = round(mat_total / tur_total, 1) if tur_total > 0 else None
            turma_data[label] = {"matriculas": mat_total, "turmas": tur_total, "media_alunos": media}
        resultado["tamanho_turma"][ano] = turma_data
        print(f"turma={len(turma_avail)} etapas", end="  ", flush=True)

        # 3. Localizacao diferenciada
        if has_loc_dif:
            loc_data = {}
            for cod, nome in LOC_DIF_MAP.items():
                mask = df["TP_LOCALIZACAO_DIFERENCIADA"] == cod
                if mask.any():
                    escolas = int(mask.sum())
                    mat = si(df.loc[mask, "QT_MAT_BAS"].sum()) if "QT_MAT_BAS" in df.columns else 0
                    loc_data[nome] = {"escolas": escolas, "matriculas": mat}
            # Group "nenhuma" as absence
            if "Nenhuma" in loc_data:
                loc_data["Nenhuma (urbana/rural regular)"] = loc_data.pop("Nenhuma")
            resultado["localizacao_diferenciada"][ano] = loc_data
            dif_count = sum(v["escolas"] for k, v in loc_data.items() if "Nenhuma" not in k)
            print(f"loc_dif={dif_count} escolas diferenciadas", end="", flush=True)

        print(f"  ({time.time()-t1:.1f}s)")

    # Save
    out = os.path.join(OUT_DIR, "4_1_funil_turma_locdif.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(resultado, f, ensure_ascii=False, indent=2)
    size = os.path.getsize(out) / 1024
    print(f"\n  Salvo: {out} ({size:.0f} KB)")

    # Summary
    print("\n" + "=" * 60)
    print("RESUMO")
    print("=" * 60)

    # Funil
    for ano in sorted(resultado["funil_por_serie"].keys()):
        f = resultado["funil_por_serie"][ano]
        print(f"\nFUNIL {ano}:")
        for s, v in f.items():
            print(f"  {s:>8s}: {v:>8,}")

    # Turma
    ultimo_t = sorted(resultado["tamanho_turma"].keys())[-1]
    print(f"\nTAMANHO DE TURMA {ultimo_t}:")
    for etapa, v in resultado["tamanho_turma"][ultimo_t].items():
        print(f"  {etapa:25s}  {v['media_alunos']:>5} alunos/turma  ({v['matriculas']:>9,} mat / {v['turmas']:>6,} tur)")

    # Loc dif
    ultimo_l = sorted(resultado["localizacao_diferenciada"].keys())[-1]
    print(f"\nLOCALIZACAO DIFERENCIADA {ultimo_l}:")
    for tipo, v in resultado["localizacao_diferenciada"][ultimo_l].items():
        if "Nenhuma" not in tipo:
            print(f"  {tipo:35s}  {v['escolas']:>5} escolas  {v['matriculas']:>8,} mat")

    print(f"\nTempo total: {time.time()-t0:.1f}s")

if __name__ == "__main__":
    etl_funil_turma_locdif()
