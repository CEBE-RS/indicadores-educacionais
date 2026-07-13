# -*- coding: utf-8 -*-
"""
ETL INSE — Produto 4 UNESCO RS
Processa Indicador de Nivel Socioeconomico (INSE) das escolas
Edicoes 2019, 2021, 2023 — escala equalizada por TRI.
Filtra RS + Rede Estadual, gera JSON para o painel.
"""
import sys, io


# --- caminhos portateis (repo Git + bases locais) ---
from paths import BASE, OUT_DIR, PAINEL_DIR, BASES_DIR, BASES_BASICAS  # noqa: E402

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import pandas as pd
import numpy as np
import json, os, time

INSE_DIR = os.path.join(BASE, "00. Bases de Dados", "04. Desigualdades Educacionais (INSE)")

UF_COD = 43  # RS

# Redes to generate (INSE doesn't have TP_CATEGORIA_ESCOLA_PRIVADA, so no filantropica)
REDES = {
    'estadual':  {'dep': [2], 'label': 'Estadual'},
    'municipal': {'dep': [3], 'label': 'Municipal'},
    'federal':   {'dep': [1], 'label': 'Federal'},
    'privada':   {'dep': [4], 'label': 'Privada'},
    'todas':     {'dep': [1, 2, 3, 4], 'label': 'Todas'},
}

# INSE level ranges for classification
NIVEIS = ['Nível I','Nível II','Nível III','Nível IV','Nível V','Nível VI','Nível VII','Nível VIII']

def safe_float(v, decimals=2):
    if pd.isna(v) or v == '--' or v == '':
        return None
    try:
        return round(float(v), decimals)
    except:
        return None

def load_inse_file(path, sheet_name):
    """Load and normalize an INSE Excel file. Returns ALL RS schools (no dep filter)."""
    print(f"    Lendo {os.path.basename(path)}...", end=" ", flush=True)
    t0 = time.time()
    df = pd.read_excel(path, sheet_name=sheet_name)
    
    # Normalize columns
    renames = {
        'ID_ESCOLA': 'CO_ESCOLA',
        'NO_ESCOLA': 'NOME_ESCOLA',
        'NOME_ESCOLA': 'NOME_ESCOLA',
        'NO_MUNICIPIO': 'NOME_MUNICIPIO',
        'NOME_MUNICIPIO': 'NOME_MUNICIPIO',
        'INSE_VALOR_ABSOLUTO': 'MEDIA_INSE',
        'TP_TIPO_REDE': 'TP_DEPENDENCIA',
        'NO_UF': 'NOME_UF',
        'NOME_UF': 'NOME_UF',
    }
    df.rename(columns={k:v for k,v in renames.items() if k in df.columns}, inplace=True)
    
    # Filter RS only (all redes)
    df = df[df['CO_UF'] == UF_COD].copy()
    
    elapsed = time.time() - t0
    print(f"{len(df)} escolas RS todas as redes ({elapsed:.1f}s)")
    return df

def calc_nivel_distribution(df):
    """Calculate distribution of schools across INSE levels."""
    classif = df['INSE_CLASSIFICACAO'].value_counts()
    total = len(df)
    dist = {}
    for nivel in NIVEIS:
        count = int(classif.get(nivel, 0))
        dist[nivel] = {'count': count, 'pct': round(count/total*100, 1) if total > 0 else 0}
    return dist

def calc_nivel_alunos_distribution(df):
    """Calculate weighted distribution of students across levels using PC_NIVEL_X columns."""
    result = {}
    for i in range(1, 9):
        col = f'PC_NIVEL_{i}'
        if col in df.columns:
            # Weighted average: each school's % weighted by its QTD_ALUNOS_INSE
            weights = df['QTD_ALUNOS_INSE'].fillna(0)
            values = pd.to_numeric(df[col], errors='coerce').fillna(0)
            if weights.sum() > 0:
                wavg = (values * weights).sum() / weights.sum()
            else:
                wavg = values.mean()
            result[f'Nível {["I","II","III","IV","V","VI","VII","VIII"][i-1]}'] = round(wavg, 1)
        else:
            result[f'Nível {["I","II","III","IV","V","VI","VII","VIII"][i-1]}'] = 0
    return result

def processar_rede(all_dfs, dep_list, rede_label):
    """Process INSE for a specific rede filter."""
    resultado = {
        "metadata": {
            "indicador": "INSE - Indicador de Nivel Socioeconomico",
            "fonte": "INEP/SAEB",
            "rede": rede_label,
            "uf": "RS",
            "anos_disponiveis": [],
            "niveis": {
                "I": {"faixa": "< 2,0", "desc": "Extrema vulnerabilidade"},
                "II": {"faixa": "2,0 a 3,0", "desc": "Pobreza"},
                "III": {"faixa": "3,0 a 4,0", "desc": "Vulnerável"},
                "IV": {"faixa": "4,0 a 4,5", "desc": "Baixo-médio"},
                "V": {"faixa": "4,5 a 5,0", "desc": "Médio (média nacional)"},
                "VI": {"faixa": "5,0 a 5,5", "desc": "Médio-alto"},
                "VII": {"faixa": "5,5 a 6,0", "desc": "Alto"},
                "VIII": {"faixa": "> 6,0", "desc": "Muito alto"},
            }
        },
        "serie_temporal": {},
        "por_municipio": {},
        "lookup_municipios": {},
    }
    
    for ano, df_all in all_dfs.items():
        df = df_all[df_all['TP_DEPENDENCIA'].isin(dep_list)].copy()
        if len(df) == 0:
            continue
        
        resultado["metadata"]["anos_disponiveis"].append(ano)
        
        media = safe_float(df['MEDIA_INSE'].mean())
        mediana = safe_float(df['MEDIA_INSE'].median())
        dp = safe_float(df['MEDIA_INSE'].std())
        n_escolas = len(df)
        n_alunos = int(df['QTD_ALUNOS_INSE'].fillna(0).sum())
        
        urb = df[df['TP_LOCALIZACAO'] == 1]
        rur = df[df['TP_LOCALIZACAO'] == 2]
        
        resultado["serie_temporal"][ano] = {
            "media": media,
            "mediana": mediana,
            "dp": dp,
            "n_escolas": n_escolas,
            "n_alunos": n_alunos,
            "dist_niveis_escolas": calc_nivel_distribution(df),
            "dist_niveis_alunos": calc_nivel_alunos_distribution(df),
            "urbana": {"media": safe_float(urb['MEDIA_INSE'].mean()), "n": len(urb)},
            "rural": {"media": safe_float(rur['MEDIA_INSE'].mean()), "n": len(rur)},
        }
        
        mun_data = {}
        for cod_mun, grp in df.groupby('CO_MUNICIPIO'):
            cod = str(int(cod_mun))
            nome = grp['NOME_MUNICIPIO'].iloc[0] if 'NOME_MUNICIPIO' in grp.columns else f'Cod.{cod}'
            urb_m = grp[grp['TP_LOCALIZACAO'] == 1]
            rur_m = grp[grp['TP_LOCALIZACAO'] == 2]
            mun_data[cod] = {
                "inse": safe_float(grp['MEDIA_INSE'].mean()),
                "mediana": safe_float(grp['MEDIA_INSE'].median()),
                "nivel": grp['INSE_CLASSIFICACAO'].mode().iloc[0] if len(grp) > 0 else None,
                "n_escolas": len(grp),
                "n_alunos": int(grp['QTD_ALUNOS_INSE'].fillna(0).sum()),
                "urbana": safe_float(urb_m['MEDIA_INSE'].mean()) if len(urb_m) > 0 else None,
                "rural": safe_float(rur_m['MEDIA_INSE'].mean()) if len(rur_m) > 0 else None,
                "dist_niveis": calc_nivel_distribution(grp),
            }
            if cod not in resultado["lookup_municipios"]:
                resultado["lookup_municipios"][cod] = nome
        resultado["por_municipio"][ano] = mun_data
    
    return resultado

def processar():
    print("=" * 70)
    print("ETL INSE — UNESCO Produto 4 (MULTI-REDE)")
    print("=" * 70)
    
    files = [
        ("2019", "INSE_2019_ESCOLAS.xlsx", "INSE_2019"),
        ("2021", "INSE_2021_escolas (1).xlsx", "INSE_ESC_2021"),
        ("2023", "INSE_2023_escolas.xlsx", "INSE_ESC_2023"),
    ]
    
    # Step 1: Load all RS data once
    print("\n[ETAPA 1] Lendo todos os dados RS...")
    all_dfs = {}
    for ano, fname, sheet in files:
        fpath = os.path.join(INSE_DIR, fname)
        if not os.path.exists(fpath):
            print(f"  [AVISO] {fname} nao encontrado, pulando...")
            continue
        df = load_inse_file(fpath, sheet)
        if len(df) > 0:
            all_dfs[ano] = df
    
    # Step 2: Generate per-rede JSONs
    print("\n[ETAPA 2] Gerando JSONs por rede...")
    for rede_key, rede_cfg in REDES.items():
        print(f"\n  {'='*50}")
        print(f"  REDE: {rede_key.upper()}")
        print(f"  {'='*50}")
        
        resultado = processar_rede(all_dfs, rede_cfg['dep'], rede_cfg['label'])
        
        out_path = os.path.join(OUT_DIR, f"4_7_inse_{rede_key}.json")
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(resultado, f, ensure_ascii=False, indent=None, separators=(',',':'))
        
        size_mb = os.path.getsize(out_path) / 1024 / 1024
        n_esc = sum(v.get('n_escolas', 0) for v in resultado['serie_temporal'].values())
        print(f"  Salvo: {os.path.basename(out_path)} ({size_mb:.1f} MB, {len(resultado['serie_temporal'])} anos)")
    
    # Backward compatibility
    import shutil
    src = os.path.join(OUT_DIR, "4_7_inse_estadual.json")
    dst = os.path.join(OUT_DIR, "4_7_inse.json")
    if os.path.exists(src):
        shutil.copy2(src, dst)
        print(f"\n  [COMPAT] Copiado {os.path.basename(src)} -> {os.path.basename(dst)}")

if __name__ == '__main__':
    t0 = time.time()
    processar()
    print(f"\nTempo total: {time.time()-t0:.1f}s")
    print("=" * 70)
