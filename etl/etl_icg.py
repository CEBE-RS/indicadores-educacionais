# -*- coding: utf-8 -*-
"""
ETL ICG — Indicador de Complexidade de Gestão da Escola
Produto 4 UNESCO RS

Processa ICG_ESCOLAS_YYYY.xlsx (2013-2025) → 4_8_icg.json
Níveis 1-6 do INEP (TRI), por escola, agregado por município e estado.
"""
import sys, io


# --- caminhos portateis (repo Git + bases locais) ---
from paths import BASE, OUT_DIR, PAINEL_DIR, BASES_DIR, BASES_BASICAS  # noqa: E402

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import pandas as pd
import numpy as np
import json, os, time, glob

BASES_DIR = os.path.join(BASE, "00. Bases de Dados")
# Find directory with encoding-safe approach
ICG_DIR = None
for d in os.listdir(BASES_DIR):
    if 'Complex' in d:
        ICG_DIR = os.path.join(BASES_DIR, d)
        break
if not ICG_DIR:
    raise FileNotFoundError("Diretório ICG não encontrado")

# Redes (dependência administrativa)
REDES = {
    'estadual':    ['Estadual'],
    'municipal':   ['Municipal'],
    'federal':     ['Federal'],
    'privada':     ['Privada'],
    'todas':       ['Estadual', 'Municipal', 'Federal', 'Privada'],
}

# Nível descriptions (from INEP technical note)
NIVEL_DESC = {
    1: "Porte inferior a 50 matrículas, único turno e etapa, Ed. Infantil ou Anos Iniciais como etapa mais elevada.",
    2: "Porte entre 50 e 300 matrículas, 2 turnos, até 2 etapas, Ed. Infantil ou Anos Iniciais como etapa mais elevada.",
    3: "Porte entre 50 e 500 matrículas, 2 turnos, até 2 etapas, Anos Finais como etapa mais elevada.",
    4: "Porte entre 150 e 1.000 matrículas, 2 ou 3 turnos, 2 ou 3 etapas, Ensino Médio/Ed. Profissional como etapa mais elevada.",
    5: "Porte entre 150 e 1.000 matrículas, 3 turnos, 2 ou 3 etapas, com oferta de EJA.",
    6: "Porte superior a 500 matrículas, 3 turnos, 4 ou mais etapas, com oferta de EJA.",
}

def load_icg_file(filepath):
    """Load an ICG Excel file with the standard INEP format."""
    df = pd.read_excel(filepath, header=6, engine='openpyxl')
    df.columns = ['Ano', 'Regiao', 'UF', 'Cod_Mun', 'Nome_Mun',
                  'Cod_Escola', 'Nome_Escola', 'Loc', 'Dep', 'Nivel']
    # Drop header/empty rows
    df = df[df['UF'].notna()].copy()
    df = df[~df['Nivel'].isin(['ICG', 'COMPLEX', 'NO_COMPLEX', None, np.nan])].copy()
    df = df[~df['UF'].isin(['SG_UF', 'SIGLA', 'Ano', 'NU_ANO_CENSO'])].copy()
    # Filter RS only
    df = df[df['UF'] == 'RS'].copy()
    # Normalize Nivel to integer (1-6)
    df['Nivel_Num'] = df['Nivel'].str.extract(r'(\d)').astype(float).astype('Int64')
    # Cod_Mun as string (7 digits)
    df['Cod_Mun'] = df['Cod_Mun'].astype(str).str[:7]
    return df

def build_distribution(df):
    """Build level distribution from a DataFrame."""
    total = len(df)
    if total == 0:
        return {}
    dist = {}
    for nivel in range(1, 7):
        n = int((df['Nivel_Num'] == nivel).sum())
        dist[f"nivel_{nivel}"] = {
            "count": n,
            "pct": round(n / total * 100, 1),
        }
    dist['total_escolas'] = total
    # Nível médio ponderado
    mean_nivel = df['Nivel_Num'].mean()
    if pd.notna(mean_nivel):
        dist['nivel_medio'] = round(float(mean_nivel), 2)
    return dist

def build_rede_output(all_dfs, dep_filter_list):
    """Build full output for a given rede."""
    resultado = {
        "metadata": {
            "fonte": "INEP — Indicador de Complexidade de Gestão da Escola",
            "gerado_em": pd.Timestamp.now().isoformat(),
            "niveis_descricao": NIVEL_DESC,
        },
        "serie_temporal": {},
        "por_municipio": {},
        "lookup_municipios": {},
    }

    anos_disponiveis = []

    for ano, df_full in sorted(all_dfs.items()):
        # Filter by rede
        if dep_filter_list != ['Estadual', 'Municipal', 'Federal', 'Privada']:
            df = df_full[df_full['Dep'].isin(dep_filter_list)].copy()
        else:
            df = df_full.copy()

        if len(df) == 0:
            continue

        anos_disponiveis.append(ano)
        dist = build_distribution(df)

        # Per-locality distribution
        urbana = build_distribution(df[df['Loc'] == 'Urbana'])
        rural = build_distribution(df[df['Loc'] == 'Rural'])

        resultado["serie_temporal"][ano] = {
            **dist,
            "urbana": urbana,
            "rural": rural,
        }

        # Per municipality
        mun_data = {}
        for cod_mun, grp in df.groupby('Cod_Mun'):
            mun_dist = build_distribution(grp)
            mun_data[cod_mun] = mun_dist
            # Lookup
            nome = grp['Nome_Mun'].iloc[0]
            if pd.notna(nome):
                resultado["lookup_municipios"][cod_mun] = str(nome)

        resultado["por_municipio"][ano] = mun_data

    resultado["metadata"]["anos_disponiveis"] = sorted(anos_disponiveis)
    return resultado

def main():
    t0 = time.time()
    print("=" * 60)
    print("ETL ICG — Complexidade de Gestão da Escola — RS")
    print("=" * 60)

    # Load all year files
    files = sorted(glob.glob(os.path.join(ICG_DIR, "ICG_ESCOLAS_*.xlsx")))
    all_dfs = {}

    for fpath in files:
        fname = os.path.basename(fpath)
        year = ''.join(c for c in fname if c.isdigit())[:4]
        if not year:
            continue
        print(f"  {year}: lendo {fname}...", end=" ", flush=True)
        df = load_icg_file(fpath)
        print(f"{len(df)} escolas RS | Dep: {sorted(df['Dep'].unique())}")
        if len(df) > 0:
            all_dfs[year] = df

    print(f"\nAnos carregados: {sorted(all_dfs.keys())}")
    print(f"Total: {len(all_dfs)} anos\n")

    # Generate per-rede JSONs
    for rede_key, dep_list in REDES.items():
        print(f"\n{'='*50}")
        print(f"  REDE: {rede_key.upper()}")
        print(f"{'='*50}")

        resultado = build_rede_output(all_dfs, dep_list)
        anos = resultado["metadata"]["anos_disponiveis"]

        if not anos:
            print(f"  SKIP — sem dados para esta rede")
            continue

        # Summary
        ultimo = anos[-1]
        su = resultado["serie_temporal"][ultimo]
        print(f"  Anos: {anos[0]}–{anos[-1]} ({len(anos)} edições)")
        print(f"  Escolas {ultimo}: {su['total_escolas']}")
        print(f"  Nível médio {ultimo}: {su.get('nivel_medio', 'N/A')}")
        for n in range(1, 7):
            nk = f"nivel_{n}"
            if nk in su:
                print(f"    Nível {n}: {su[nk]['count']} ({su[nk]['pct']}%)")
        print(f"  Municípios: {len(resultado['por_municipio'].get(ultimo, {}))}")

        # Save JSON
        out_path = os.path.join(OUT_DIR, f"4_8_icg_{rede_key}.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(resultado, f, ensure_ascii=False, separators=(',', ':'))
        size_kb = os.path.getsize(out_path) / 1024
        print(f"  JSON: {os.path.basename(out_path)} ({size_kb:.0f} KB)")

    # Backward compatibility: copy estadual → default name
    import shutil
    src = os.path.join(OUT_DIR, "4_8_icg_estadual.json")
    dst = os.path.join(OUT_DIR, "4_8_icg.json")
    if os.path.exists(src):
        shutil.copy2(src, dst)
        print(f"\n[COMPAT] Copiado → 4_8_icg.json")

    print(f"\nTempo total: {time.time() - t0:.1f}s")

if __name__ == "__main__":
    main()
