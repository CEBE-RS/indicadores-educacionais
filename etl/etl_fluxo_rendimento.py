# -*- coding: utf-8 -*-
"""
ETL Fluxo e Rendimento — Produto 4 UNESCO RS
Processa taxas de rendimento (aprovação/reprovação/abandono) e TDI
dos arquivos INEP por município e escola, filtra RS, gera JSON para o painel.

FONTES:
  - 2010-2018: Arquivos de ESCOLAS (tx_rendimento_escolas / TX_REND_ESCOLAS)
               Agregados por município via mediana ponderada
  - 2019-2024: Arquivos de MUNICÍPIOS (tx_rend_municipios)
  - 2020-2024: Arquivos UF (tx_rend_brasil_regioes_ufs) para série estadual
  - 2025:      TDI (TDI_MUNICIPIOS / TDI_BRASIL_REGIOES_UFS)
"""
import sys, io


# --- caminhos portateis (repo Git + bases locais) ---
from paths import BASE, OUT_DIR, PAINEL_DIR, BASES_DIR, BASES_BASICAS  # noqa: E402

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import pandas as pd
import numpy as np
import json, os, glob, time, re, shutil

REND_DIR = os.path.join(BASE, "00. Bases de Dados", "02. Fluxo e Rendimento (Inep_2010_2024_Rendimento_TDI)", "01. Rendimento e TDI")

SG_UF = "RS"

# Redes
REDES = {
    'estadual':  {'dep': ['Estadual'], 'label': 'Estadual'},
    'municipal': {'dep': ['Municipal'], 'label': 'Municipal'},
    'federal':   {'dep': ['Federal'], 'label': 'Federal'},
    'privada':   {'dep': ['Privada'], 'label': 'Privada'},
    'todas':     {'dep': ['Estadual', 'Municipal', 'Federal', 'Privada'], 'label': 'Todas'},
}

# ══════════════════════════════════════════════════════════
# UTILITIES
# ══════════════════════════════════════════════════════════

def safe_float(v):
    """Convert value to float, handling '--', NaN, etc."""
    if pd.isna(v) or v == '--' or v == '' or v is None:
        return None
    try:
        val = float(str(v).replace(',', '.'))
        if np.isnan(val) or np.isinf(val):
            return None
        return round(val, 1)
    except:
        return None

def extract_year_from_filename(fname):
    """Extract year (4 digits) from filename."""
    m = re.search(r'(\d{4})', fname)
    return int(m.group(1)) if m else None

# Sufixos de etapa/série -> sufixo da coluna INEP (CAT_*)
# Inclui as séries: Fundamental 1º-9º (FUN_01..09) e Médio 1ª-4ª (MED_01..04) + não-seriado.
REND_SUFIXOS = {
    'fund': '_CAT_FUN', 'fund_ai': '_CAT_FUN_AI', 'fund_af': '_CAT_FUN_AF',
    'fund_01': '_CAT_FUN_01', 'fund_02': '_CAT_FUN_02', 'fund_03': '_CAT_FUN_03',
    'fund_04': '_CAT_FUN_04', 'fund_05': '_CAT_FUN_05', 'fund_06': '_CAT_FUN_06',
    'fund_07': '_CAT_FUN_07', 'fund_08': '_CAT_FUN_08', 'fund_09': '_CAT_FUN_09',
    'med': '_CAT_MED', 'med_01': '_CAT_MED_01', 'med_02': '_CAT_MED_02',
    'med_03': '_CAT_MED_03', 'med_04': '_CAT_MED_04', 'med_ns': '_CAT_MED_NS',
}
# Prefixos de taxa: 1=Aprovação, 2=Reprovação, 3=Abandono
REND_RATES = {'aprov': '1', 'reprov': '2', 'aband': '3'}

# Lista completa de chaves geradas (etapa + série), usada no fallback de mediana
REND_KEYS = [f"{rk}_{sk}" for rk in REND_RATES for sk in REND_SUFIXOS]

def build_rend_record(row):
    """Monta um registro de rendimento com etapas E séries a partir de uma linha INEP."""
    rec = {}
    for rate_key, pfx in REND_RATES.items():
        for suf_key, suf_col in REND_SUFIXOS.items():
            rec[f"{rate_key}_{suf_key}"] = safe_float(row.get(f"{pfx}{suf_col}"))
    return rec

# ══════════════════════════════════════════════════════════
# READERS — ESCOLA-LEVEL (2010-2018)
# ══════════════════════════════════════════════════════════

def ler_escolas_2015_2018(filepath):
    """
    Reads escola-level files from 2015-2018.
    Header at row 9 (0-indexed), standardized columns:
    Ano, SG_UF, CO_MUNICIPIO, NO_MUNICIPIO, Dependad, TIPOLOCA,
    tap_FUN, tap_F14, tap_F58, tap_MED, tre_FUN, tre_F14, tre_F58, tre_MED,
    tab_FUN, tab_F14, tab_F58, tab_MED
    """
    fname = os.path.basename(filepath)
    
    # Try header rows 8 and 9
    for hrow in [9, 8]:
        try:
            df = pd.read_excel(filepath, header=hrow, nrows=3, dtype=str)
            cols = [str(c) for c in df.columns]
            if 'tap_FUN' in cols or 'SG_UF' in cols:
                df = pd.read_excel(filepath, header=hrow, dtype=str)
                
                # Normalize columns
                rename = {}
                for old, new in [('Ano', 'NU_ANO_CENSO'), ('Dependad', 'NO_DEPENDENCIA')]:
                    if old in df.columns and new not in df.columns:
                        rename[old] = new
                if rename:
                    df = df.rename(columns=rename)
                
                # Filter RS only
                if 'SG_UF' in df.columns:
                    df = df[df['SG_UF'] == SG_UF]
                
                print(f"    {fname}: header={hrow}, {len(df)} escolas RS")
                return df
        except Exception as e:
            continue
    
    print(f"    [ERRO] Formato não reconhecido: {fname}")
    return pd.DataFrame()

def ler_escolas_2012_2014(filepath):
    """
    Reads escola-level files from 2012-2014.
    Merged header — row 6 has main columns (Ano, UF, etc.) + merged rate headers.
    Row 7 has sub-headers (Total, AI, AF, etc.).
    Data starts at row 8.
    
    Strategy: read with header=6 to get column structure, then map by position.
    """
    fname = os.path.basename(filepath)
    
    # Try header=6 first
    for hrow in [6, 7]:
        try:
            df_test = pd.read_excel(filepath, header=hrow, nrows=3, dtype=str)
            cols = [str(c) for c in df_test.columns]
            if any('Ano' in c for c in cols) and any('UF' in c for c in cols):
                break
        except:
            continue
    else:
        print(f"    [ERRO] Formato não reconhecido: {fname}")
        return pd.DataFrame()
    
    # Read full file
    df = pd.read_excel(filepath, header=hrow, dtype=str)
    
    # The real data has sub-headers in the first row (NaN for meta columns).
    # Drop rows where UF is NaN (sub-header or notes)
    uf_col = None
    for c in df.columns:
        if 'UF' in str(c) and 'Unnamed' not in str(c):
            uf_col = str(c)
            break
    
    if not uf_col:
        print(f"    [ERRO] Coluna UF não encontrada: {fname}")
        return pd.DataFrame()
    
    # Drop sub-header rows (NaN in UF column)
    df = df.dropna(subset=[uf_col])
    
    # Filter RS
    df = df[df[uf_col] == SG_UF]
    
    # Identify columns by position
    # Structure: meta_cols (Ano, Região, UF, Cod.Mun, Nome.Mun, ..., Cod.Escola, Nome.Escola)
    # Then rate columns: Aprovação Fund (Total, AI, AF, 1º-9º), Aprovação Med (Total, 1ª-4ª, NS)
    #                     Reprovação Fund (...), Reprovação Med (...)
    #                     Abandono Fund (...), Abandono Med (...)
    
    # Find position of key meta columns
    col_map = {}
    for i, c in enumerate(df.columns):
        cs = str(c).lower()
        if 'ano' in cs and 'unnamed' not in cs:
            col_map['ano'] = i
        elif ('código do mun' in cs or 'codigo do mun' in cs) and 'unnamed' not in cs:
            col_map['cod_mun'] = i
        elif ('nome do mun' in cs) and 'unnamed' not in cs:
            col_map['nome_mun'] = i
        elif ('rede' == cs or 'dependência' in cs or 'dependencia' in cs) and 'unnamed' not in cs:
            col_map['dep'] = i
    
    if 'cod_mun' not in col_map or 'dep' not in col_map:
        print(f"    [AVISO] Colunas essenciais não encontradas: {fname} -> {col_map}")
        return pd.DataFrame()
    
    # Find rate columns by looking for 'Taxa de Aprov' headers
    rate_starts = []
    for i, c in enumerate(df.columns):
        cs = str(c).lower()
        if 'taxa de aprov' in cs and 'fundamental' in cs:
            rate_starts.append(('aprov_fund', i))
        elif 'taxa de aprov' in cs and 'médio' in cs.replace('m\xe9', 'mé'):
            rate_starts.append(('aprov_med', i))
        elif 'taxa de reprov' in cs and 'fundamental' in cs:
            rate_starts.append(('reprov_fund', i))
        elif 'taxa de reprov' in cs and 'médio' in cs.replace('m\xe9', 'mé'):
            rate_starts.append(('reprov_med', i))
        elif 'taxa de abandon' in cs and 'fundamental' in cs:
            rate_starts.append(('aband_fund', i))
        elif 'taxa de abandon' in cs and 'médio' in cs.replace('m\xe9', 'mé'):
            rate_starts.append(('aband_med', i))
    
    # Direct mapping from rate_starts label to output column names
    RATE_KEY_MAP = {
        'aprov_fund': ('tap_FUN', 'tap_F14', 'tap_F58'),  # Total, AI, AF
        'aprov_med':  ('tap_MED',),
        'reprov_fund': ('tre_FUN', 'tre_F14', 'tre_F58'),
        'reprov_med':  ('tre_MED',),
        'aband_fund': ('tab_FUN', 'tab_F14', 'tab_F58'),
        'aband_med':  ('tab_MED',),
    }
    
    # Build a normalized DataFrame
    cols_orig = list(df.columns)
    records = []
    for _, row in df.iterrows():
        rec = {
            'NU_ANO_CENSO': row.iloc[col_map.get('ano', 0)],
            'CO_MUNICIPIO': row.iloc[col_map['cod_mun']],
            'NO_MUNICIPIO': row.iloc[col_map.get('nome_mun', col_map['cod_mun'])],
            'NO_DEPENDENCIA': row.iloc[col_map['dep']],
        }
        
        for label, start_idx in rate_starts:
            out_keys = RATE_KEY_MAP.get(label, ())
            for offset, key in enumerate(out_keys):
                if start_idx + offset < len(cols_orig):
                    rec[key] = safe_float(row.iloc[start_idx + offset])
        
        records.append(rec)
    
    result = pd.DataFrame(records)
    result['SG_UF'] = SG_UF
    
    print(f"    {fname}: header={hrow}, {len(result)} escolas RS, cols={[c for c in result.columns if c.startswith('t')]}")
    return result

def ler_escolas_2010_2011(filepath):
    """
    Reads escola-level .xls files from 2010-2011.
    These files have data split by region in separate sheets.
    RS is in the 'SUL' sheet.
    Same column structure as 2012-2014 but .xls format (xlrd engine).
    """
    fname = os.path.basename(filepath)
    
    # These files have sheets: NORTE, NORDESTE..., SUDESTE, SUL, CENTRO-OESTE
    # RS is in the SUL sheet
    sheet_name = 'SUL'
    
    for hrow in [6, 7, 5]:
        try:
            df_test = pd.read_excel(filepath, header=hrow, nrows=3, dtype=str, engine='xlrd', sheet_name=sheet_name)
            cols = [str(c) for c in df_test.columns]
            if any('Ano' in c for c in cols) and any('UF' in c for c in cols):
                # Use the same logic as 2012-2014
                df = pd.read_excel(filepath, header=hrow, dtype=str, engine='xlrd', sheet_name=sheet_name)
                
                uf_col = None
                for c in df.columns:
                    if 'UF' in str(c) and 'Unnamed' not in str(c):
                        uf_col = str(c)
                        break
                
                if not uf_col:
                    continue
                
                df = df.dropna(subset=[uf_col])
                df = df[df[uf_col] == SG_UF]
                
                # Same positional logic
                col_map = {}
                for i, c in enumerate(df.columns):
                    cs = str(c).lower()
                    if 'ano' in cs and 'unnamed' not in cs:
                        col_map['ano'] = i
                    elif ('código do mun' in cs or 'codigo do mun' in cs) and 'unnamed' not in cs:
                        col_map['cod_mun'] = i
                    elif ('nome do mun' in cs) and 'unnamed' not in cs:
                        col_map['nome_mun'] = i
                    elif ('rede' == cs or 'dependência' in cs or 'dependencia' in cs) and 'unnamed' not in cs:
                        col_map['dep'] = i
                
                if 'cod_mun' not in col_map or 'dep' not in col_map:
                    print(f"    [AVISO] Colunas não encontradas: {fname} -> {col_map}")
                    continue
                
                rate_starts = []
                for i, c in enumerate(df.columns):
                    cs = str(c).lower()
                    if 'taxa de aprov' in cs and 'fundamental' in cs:
                        rate_starts.append(('aprov_fund', i))
                    elif 'taxa de aprov' in cs and ('médio' in cs or 'medio' in cs or 'm\xe9dio' in cs):
                        rate_starts.append(('aprov_med', i))
                    elif 'taxa de reprov' in cs and 'fundamental' in cs:
                        rate_starts.append(('reprov_fund', i))
                    elif 'taxa de reprov' in cs and ('médio' in cs or 'medio' in cs or 'm\xe9dio' in cs):
                        rate_starts.append(('reprov_med', i))
                    elif 'taxa de abandon' in cs and 'fundamental' in cs:
                        rate_starts.append(('aband_fund', i))
                    elif 'taxa de abandon' in cs and ('médio' in cs or 'medio' in cs or 'm\xe9dio' in cs):
                        rate_starts.append(('aband_med', i))
                
                RATE_KEY_MAP = {
                    'aprov_fund': ('tap_FUN', 'tap_F14', 'tap_F58'),
                    'aprov_med':  ('tap_MED',),
                    'reprov_fund': ('tre_FUN', 'tre_F14', 'tre_F58'),
                    'reprov_med':  ('tre_MED',),
                    'aband_fund': ('tab_FUN', 'tab_F14', 'tab_F58'),
                    'aband_med':  ('tab_MED',),
                }
                
                cols_orig = list(df.columns)
                records = []
                for _, row in df.iterrows():
                    rec = {
                        'NU_ANO_CENSO': row.iloc[col_map.get('ano', 0)],
                        'CO_MUNICIPIO': row.iloc[col_map['cod_mun']],
                        'NO_MUNICIPIO': row.iloc[col_map.get('nome_mun', col_map['cod_mun'])],
                        'NO_DEPENDENCIA': row.iloc[col_map['dep']],
                    }
                    for label, start_idx in rate_starts:
                        out_keys = RATE_KEY_MAP.get(label, ())
                        for offset, key in enumerate(out_keys):
                            if start_idx + offset < len(cols_orig):
                                rec[key] = safe_float(row.iloc[start_idx + offset])
                    records.append(rec)
                
                result = pd.DataFrame(records)
                result['SG_UF'] = SG_UF
                
                print(f"    {fname}: header={hrow}, {len(result)} escolas RS")
                return result
        except Exception as e:
            print(f"    {fname}: header={hrow} -> ERRO: {e}")
            continue
    
    print(f"    [ERRO] Não consegui ler: {fname}")
    return pd.DataFrame()

def agregar_escolas_por_municipio(df_escolas, dep_filter, ano):
    """
    Aggregates school-level rate data to municipality level using median.
    Input columns: tap_FUN, tap_F14, tap_F58, tap_MED, tre_FUN, etc.
    Output: dict { cod_mun: { aprov_fund, aprov_fund_ai, ... } }
    """
    if len(df_escolas) == 0:
        return {}, {}
    
    dep_col = 'NO_DEPENDENCIA' if 'NO_DEPENDENCIA' in df_escolas.columns else 'Dependad'
    if dep_col not in df_escolas.columns:
        return {}, {}
    
    df = df_escolas[df_escolas[dep_col].isin(dep_filter)].copy()
    if len(df) == 0:
        return {}, {}
    
    mun_col = 'CO_MUNICIPIO'
    nome_col = 'NO_MUNICIPIO'
    
    # Rate columns mapping: escola format → painel format
    rate_map = {
        'tap_FUN': 'aprov_fund', 'tap_F14': 'aprov_fund_ai', 'tap_F58': 'aprov_fund_af', 'tap_MED': 'aprov_med',
        'tre_FUN': 'reprov_fund', 'tre_F14': 'reprov_fund_ai', 'tre_F58': 'reprov_fund_af', 'tre_MED': 'reprov_med',
        'tab_FUN': 'aband_fund', 'tab_F14': 'aband_fund_ai', 'tab_F58': 'aband_fund_af', 'tab_MED': 'aband_med',
    }
    
    # Convert rate columns to numeric
    for col in rate_map:
        if col in df.columns:
            df[col] = df[col].apply(safe_float)
    
    por_mun = {}
    lookup = {}
    
    for cod_mun, grp in df.groupby(mun_col):
        cod = str(cod_mun).split('.')[0]  # Remove decimal if any
        entry = {}
        for esc_col, painel_key in rate_map.items():
            if esc_col in grp.columns:
                vals = grp[esc_col].dropna()
                if len(vals) > 0:
                    entry[painel_key] = round(float(vals.median()), 1)
                else:
                    entry[painel_key] = None
            else:
                entry[painel_key] = None
        
        por_mun[cod] = entry
        
        # Lookup
        nomes = grp[nome_col].dropna()
        if len(nomes) > 0:
            lookup[cod] = str(nomes.iloc[0])
    
    return por_mun, lookup

# ══════════════════════════════════════════════════════════
# READERS — MUNICÍPIO-LEVEL (2019-2024)
# ══════════════════════════════════════════════════════════

def ler_excel_inep(filepath, uf_filter=True):
    """Lê Excel INEP com detecção automática do header.
    Handles two formats:
    - 2020+: header=8, columns like 1_CAT_FUN, 2_CAT_FUN, etc.
    - 2019: header=5, merged headers with 'Taxa de Aprovação', positions fixed.
    """
    fname = os.path.basename(filepath)
    
    # header=6 cobre o formato antigo por município (2012-2014, com coluna 'Rede')
    for hrow in [8, 5, 9, 7, 6]:
        try:
            df = pd.read_excel(filepath, header=hrow, nrows=3, dtype=str)
        except:
            continue
        cols = [str(c) for c in df.columns]
        if any(c in cols for c in ['NU_ANO_CENSO', 'Ano']) and any(c in cols for c in ['SG_UF', 'UF']):
            break
    else:
        print(f"  [ERRO] Não encontrou header em {fname}")
        return pd.DataFrame()
    
    df = pd.read_excel(filepath, header=hrow, dtype=str)
    
    # Normalize column names ('Rede' é usado nos arquivos por município de 2012-2014)
    rename = {}
    for old, new in [('Ano', 'NU_ANO_CENSO'), ('UF', 'SG_UF'), 
                      ('Código do Município', 'CO_MUNICIPIO'), ('Nome do Município', 'NO_MUNICIPIO'),
                      ('Localização', 'NO_CATEGORIA'), ('Dependência Administrativa', 'NO_DEPENDENCIA'),
                      ('Rede', 'NO_DEPENDENCIA'), ('Região', 'NO_REGIAO')]:
        if old in df.columns and new not in df.columns:
            rename[old] = new
    if rename:
        df = df.rename(columns=rename)
    
    # Normaliza rótulos de dependência divergentes entre anos (2014 usa 'Particular')
    if 'NO_DEPENDENCIA' in df.columns:
        df['NO_DEPENDENCIA'] = df['NO_DEPENDENCIA'].replace({'Particular': 'Privada'})
    
    # Filter RS + Total category
    if uf_filter and 'SG_UF' in df.columns:
        df = df[(df['SG_UF'] == SG_UF) & (df['NO_CATEGORIA'] == 'Total')]
    
    # Drop rows where NU_ANO_CENSO is NaN (sub-header or note rows)
    if 'NU_ANO_CENSO' in df.columns:
        df = df.dropna(subset=['NU_ANO_CENSO'])
    
    # Check if this is the legacy merged-header format (2019)
    # In legacy: columns are 'Taxa de Aprovação', 'Unnamed:8', etc.
    # In modern: columns are '1_CAT_FUN', '1_CAT_FUN_AI', etc.
    cols = list(df.columns)
    has_modern = any('1_CAT_FUN' in str(c) for c in cols)
    has_legacy = any('Taxa de Aprov' in str(c) for c in cols)
    
    if has_legacy and not has_modern and len(cols) >= 50:
        # Legacy format: map positional columns to standard names
        # Layout: cols 0-6 = meta, then blocks of rate columns
        # Col 7 = Aprov Fund Total, 8 = AI, 9 = AF
        # Col 19 = Aprov Med Total
        # Col 25 = Reprov Fund Total, 26 = AI, 27 = AF
        # Col 37 = Reprov Med Total
        # Col 43 = Aband Fund Total, 44 = AI, 45 = AF
        # Col 55 = Aband Med Total
        # Layout idêntico ao formato moderno (2020+), porém sem nomes de coluna.
        # Cada taxa (aprov=1 base 7, reprov=2 base 25, aband=3 base 43) tem o bloco:
        #   FUN | FUN_AI | FUN_AF | 1º..9º ano | MED | 1ª..4ª série EM | MED_NS
        POS_MAP = {}
        for taxa_pref, base in (('1', 7), ('2', 25), ('3', 43)):
            POS_MAP[base + 0] = f'{taxa_pref}_CAT_FUN'
            POS_MAP[base + 1] = f'{taxa_pref}_CAT_FUN_AI'
            POS_MAP[base + 2] = f'{taxa_pref}_CAT_FUN_AF'
            for i in range(1, 10):            # 1º..9º ano -> base+3 .. base+11
                POS_MAP[base + 2 + i] = f'{taxa_pref}_CAT_FUN_{i:02d}'
            POS_MAP[base + 12] = f'{taxa_pref}_CAT_MED'
            for i in range(1, 5):             # 1ª..4ª série EM -> base+13 .. base+16
                POS_MAP[base + 12 + i] = f'{taxa_pref}_CAT_MED_{i:02d}'
            POS_MAP[base + 17] = f'{taxa_pref}_CAT_MED_NS'
        new_cols = {}
        for pos, new_name in POS_MAP.items():
            if pos < len(cols):
                old_name = cols[pos]
                new_cols[old_name] = new_name
        df = df.rename(columns=new_cols)
        print(f"[legacy->modern] ", end="")
    
    return df

_MUN_CACHE = None  # cache: ler_rendimento_municipios é chamado 1x por rede

def ler_rendimento_municipios():
    """Lê todos os arquivos de rendimento por município (2012-2024).

    Arquivos oficiais por município, com série completa:
      - 2012-2014: tx_rendimento_municipios / TAXAS RENDIMENTOS MUNICIPIOS (header 6, coluna 'Rede')
      - 2016-2018: TX_REND_MUNICIPIOS (header 5, 'Dependência Administrativa')
      - 2019-2024: tx_rend_municipios (formato moderno / legado 2019)
    Excluídos: 2010/2011 (.xls com layout divergente ou sem RS) e 2015 (sem arquivo)."""
    global _MUN_CACHE
    if _MUN_CACHE is not None:
        return _MUN_CACHE

    patterns = [
        "tx_rend_municipios_*.xlsx",          # 2019-2024 (e, no Windows, casa também 2016-2018)
        "TX_REND_MUNICIPIOS_*.xlsx",          # 2016-2018
        "TX_REND_MUN_*.xlsx",                 # 2015
        "tx_rendimento_municipios_*.xlsx",    # 2012
        "TAXAS RENDIMENTOS MUNICIPIOS *.xlsx",# 2013-2014
    ]
    seen, files = set(), []
    for pat in patterns:
        for f in glob.glob(os.path.join(REND_DIR, pat)):
            key = os.path.normcase(os.path.abspath(f))
            if key not in seen:
                seen.add(key)
                files.append(f)
    files = sorted(files, key=lambda p: extract_year_from_filename(os.path.basename(p)) or 0)
    print(f"  Encontrados {len(files)} arquivos de rendimento por município")
    
    frames = []
    for f in files:
        print(f"    Lendo {os.path.basename(f)}...", end=" ", flush=True)
        t0 = time.time()
        df = ler_excel_inep(f)
        print(f"{len(df)} municípios ({time.time()-t0:.1f}s)")
        if len(df) > 0:
            frames.append(df)
    
    _MUN_CACHE = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    return _MUN_CACHE

def ler_rendimento_escolas():
    """Lê todos os arquivos de rendimento por escola (2010-2018)."""
    all_frames = {}
    
    # 1. XLS files (2010-2011)
    xls_patterns = [
        os.path.join(REND_DIR, "tx_rendimento_escolas_201*.xls"),
    ]
    for pat in xls_patterns:
        for f in sorted(glob.glob(pat)):
            if f.endswith('.xlsx'):
                continue  # skip xlsx, handled separately
            year = extract_year_from_filename(os.path.basename(f))
            if year and year <= 2011:
                print(f"    Lendo {os.path.basename(f)}...", end=" ", flush=True)
                t0 = time.time()
                df = ler_escolas_2010_2011(f)
                if len(df) > 0:
                    all_frames[year] = df
                print(f"({time.time()-t0:.1f}s)")
    
    # 2. XLSX files 2012-2014 (merged header format)
    for pattern in [
        os.path.join(REND_DIR, "tx_rendimento_escolas_2012.xlsx"),
        os.path.join(REND_DIR, "TAXAS RENDIMENTOS ESCOLAS 2013.xlsx"),
        os.path.join(REND_DIR, "TAXAS RENDIMENTOS ESCOLAS 2014.xlsx"),
    ]:
        for f in glob.glob(pattern):
            year = extract_year_from_filename(os.path.basename(f))
            if year:
                print(f"    Lendo {os.path.basename(f)}...", end=" ", flush=True)
                t0 = time.time()
                df = ler_escolas_2012_2014(f)
                if len(df) > 0:
                    all_frames[year] = df
                print(f"({time.time()-t0:.1f}s)")
    
    # 3. XLSX files 2015-2018 (standardized format)
    for year in range(2015, 2019):
        pattern = os.path.join(REND_DIR, f"*ESCOLAS*{year}*xlsx")
        # Also try lowercase
        pattern2 = os.path.join(REND_DIR, f"*escolas*{year}*xlsx")
        files = glob.glob(pattern) + glob.glob(pattern2)
        # Deduplicate and exclude TDI files (they match the glob but aren't rendimento)
        files = list(set(files))
        files = [f for f in files if 'TDI' not in os.path.basename(f).upper()]
        for f in files:
            print(f"    Lendo {os.path.basename(f)}...", end=" ", flush=True)
            t0 = time.time()
            df = ler_escolas_2015_2018(f)
            if len(df) > 0:
                all_frames[year] = df
            print(f"({time.time()-t0:.1f}s)")
    
    return all_frames

def ler_tdi_municipios():
    """Lê TDI por município."""
    pattern = os.path.join(REND_DIR, "TDI_MUNICIPIOS_*.xlsx")
    files = sorted(glob.glob(pattern))
    if not files:
        print("  [AVISO] Nenhum arquivo TDI_MUNICIPIOS_*.xlsx encontrado")
        return pd.DataFrame()
    
    frames = []
    for f in files:
        print(f"    Lendo {os.path.basename(f)}...", end=" ", flush=True)
        t0 = time.time()
        df = ler_excel_inep(f)
        print(f"{len(df)} municípios ({time.time()-t0:.1f}s)")
        if len(df) > 0:
            frames.append(df)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()

def ler_tdi_uf():
    """Lê TDI agregado UF."""
    pattern = os.path.join(REND_DIR, "TDI_BRASIL_REGIOES_UFS_*.xlsx")
    files = sorted(glob.glob(pattern))
    if not files:
        print("  [AVISO] Nenhum arquivo TDI UF encontrado")
        return pd.DataFrame()
    frames = []
    for f in files:
        print(f"    Lendo {os.path.basename(f)}...", end=" ", flush=True)
        t0 = time.time()
        for hrow in [8, 5, 9, 7]:
            try:
                df = pd.read_excel(f, header=hrow, nrows=3, dtype=str)
                if 'NU_ANO_CENSO' in [str(c) for c in df.columns]:
                    break
            except:
                continue
        df = pd.read_excel(f, header=hrow, dtype=str)
        if 'UNIDGEO' in df.columns:
            df = df[(df['UNIDGEO'] == 'Rio Grande do Sul') & (df['NO_CATEGORIA'] == 'Total')]
        print(f"{len(df)} linhas ({time.time()-t0:.1f}s)")
        if len(df) > 0:
            frames.append(df)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()

# Legacy → modern column name mapping for UF files
_LEGACY_TO_MODERN = {
    'tap_FUN': '1_CAT_FUN', 'tap_F14': '1_CAT_FUN_AI', 'tap_F58': '1_CAT_FUN_AF', 'tap_MED': '1_CAT_MED',
    'tre_FUN': '2_CAT_FUN', 'tre_F14': '2_CAT_FUN_AI', 'tre_F58': '2_CAT_FUN_AF', 'tre_MED': '2_CAT_MED',
    'tab_FUN': '3_CAT_FUN', 'tab_F14': '3_CAT_FUN_AI', 'tab_F58': '3_CAT_FUN_AF', 'tab_MED': '3_CAT_MED',
}

def ler_rendimento_uf():
    """Lê dados agregados UF (2020-2024) para série temporal estadual."""
    pattern = os.path.join(REND_DIR, "tx_rend_brasil_regioes_ufs_*.xlsx")
    # Anos < 2020 (2017-2019, que no Windows também casam por case-insensitive) são
    # tratados em ler_rendimento_uf_legacy() — aqui ficam apenas 2020+.
    files = sorted(f for f in glob.glob(pattern) if (extract_year_from_filename(os.path.basename(f)) or 0) >= 2020)
    print(f"  Encontrados {len(files)} arquivos UF (2020+)")
    
    frames = []
    for f in files:
        print(f"    Lendo {os.path.basename(f)}...", end=" ", flush=True)
        t0 = time.time()
        # UF files have different structures
        for hrow in [8, 5, 9, 7]:
            try:
                df = pd.read_excel(f, header=hrow, nrows=3, dtype=str)
                cols = [str(c) for c in df.columns]
                if any('ano' in c.lower() for c in cols) and any('uf' in c.lower() or 'UNIDGEO' in c or 'unidgeo' in c.lower() for c in cols):
                    break
                # Legacy format (2020): has 'ano' and 'Unnamed: 1' (UF name)
                if any('ano' in c.lower() for c in cols) and any('DEPENDAD' in c for c in cols):
                    break
            except:
                continue
        else:
            print(f"[SKIP]")
            continue
        
        df = pd.read_excel(f, header=hrow, dtype=str)
        
        # Normalize columns (meta)
        rename = {}
        for old, new in [('Ano', 'NU_ANO_CENSO'), ('ano', 'NU_ANO_CENSO'),
                          ('Unidade Geográfica', 'UNIDGEO'),
                          ('Localização', 'NO_CATEGORIA'), ('TIPOLOCA', 'NO_CATEGORIA'),
                          ('Dependência Administrativa', 'NO_DEPENDENCIA'), ('DEPENDAD', 'NO_DEPENDENCIA')]:
            if old in df.columns and new not in df.columns:
                rename[old] = new
        # Legacy rate columns → modern names
        for old, new in _LEGACY_TO_MODERN.items():
            if old in df.columns and new not in df.columns:
                rename[old] = new
        if rename:
            df = df.rename(columns=rename)
        
        # Filter RS + Total
        if 'UNIDGEO' in df.columns:
            df = df[df['UNIDGEO'].str.contains('Rio Grande do Sul', case=False, na=False)]
        else:
            # Legacy format (2020): UF name in 'Unnamed: 1' column
            unnamed_cols = [c for c in df.columns if 'Unnamed' in str(c)]
            for uc in unnamed_cols:
                mask = df[uc].str.contains('Rio Grande do Sul', case=False, na=False)
                if mask.any():
                    df = df[mask]
                    break
            else:
                if 'SG_UF' in df.columns:
                    df = df[df['SG_UF'] == SG_UF]
        
        if 'NO_CATEGORIA' in df.columns:
            df = df[df['NO_CATEGORIA'] == 'Total']
        
        # Exclude dep='Total' row (we filter by rede in processar)
        if 'NO_DEPENDENCIA' in df.columns:
            df = df[df['NO_DEPENDENCIA'] != 'Total']
        
        print(f"{len(df)} linhas ({time.time()-t0:.1f}s)")
        if len(df) > 0:
            frames.append(df)
    
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()

# Mapa posicional do formato mesclado ('Taxa de Aprovação' + Unnamed) usado nos
# arquivos UF legados de 2012, 2017, 2018 e 2019. Meta nas colunas 0-3
# (Ano, UF/Unidade Geográfica, Localização, Rede/Dependência); cada taxa ocupa um
# bloco de 18 colunas (FUN, FUN_AI, FUN_AF, 1º-9º, MED, 1ª-4ª EM, MED_NS):
#   Aprovação base 4 | Reprovação base 22 | Abandono base 40
_UF_LEGACY_POS = {
    4: '1_CAT_FUN', 5: '1_CAT_FUN_AI', 6: '1_CAT_FUN_AF', 16: '1_CAT_MED',
    22: '2_CAT_FUN', 23: '2_CAT_FUN_AI', 24: '2_CAT_FUN_AF', 34: '2_CAT_MED',
    40: '3_CAT_FUN', 41: '3_CAT_FUN_AI', 42: '3_CAT_FUN_AF', 52: '3_CAT_MED',
}

# 2010 usa um layout distinto: antes de cada bloco há uma coluna avulsa ('1º Ano do
# EF de 9 anos') e os TOTAIS ficam ao FINAL do bloco (Total Fund/Médio), não no início.
#   Aprovação:  AI=13, AF=14, Total Fund=15, Total Médio=21
#   Reprovação: AI=31, AF=32, Total Fund=33, Total Médio=39
#   Abandono:   AI=49, AF=50, Total Fund=51, Total Médio=57
_UF_LEGACY_POS_2010 = {
    15: '1_CAT_FUN', 13: '1_CAT_FUN_AI', 14: '1_CAT_FUN_AF', 21: '1_CAT_MED',
    33: '2_CAT_FUN', 31: '2_CAT_FUN_AI', 32: '2_CAT_FUN_AF', 39: '2_CAT_MED',
    51: '3_CAT_FUN', 49: '3_CAT_FUN_AI', 50: '3_CAT_FUN_AF', 57: '3_CAT_MED',
}

def _is_rs_unidgeo(serie):
    """True para 'RS' (sigla) ou 'Rio Grande do Sul' — NUNCA 'Rio Grande do Norte'."""
    s = serie.astype(str).str.strip()
    return s.str.upper().eq('RS') | s.str.lower().eq('rio grande do sul')

def _read_uf_legacy_file(filepath):
    """Normaliza um arquivo UF de ano anterior a 2020 para o layout moderno.

    Dois formatos:
      - 'machine' (2015, 2016): há uma linha com códigos tap_/tre_/tab_ usada como
        cabeçalho; renomeada para 1_CAT_*/2_CAT_*/3_CAT_* via _LEGACY_TO_MODERN.
      - 'merged'  (2012, 2017-2019): cabeçalho mesclado 'Taxa de Aprovação' + Unnamed;
        as taxas são lidas por posição (_UF_LEGACY_POS).
    Retorna df filtrado: RS, Localização == 'Total', com NU_ANO_CENSO/UNIDGEO/
    NO_CATEGORIA/NO_DEPENDENCIA + colunas de taxa no padrão moderno.
    """
    fname = os.path.basename(filepath)
    try:
        raw = pd.read_excel(filepath, header=None, nrows=16, dtype=str)
    except Exception as e:
        print(f"    [SKIP UF-legacy] {fname}: {e}")
        return pd.DataFrame()

    hdr, kind = None, None
    # 1) Linha de códigos de máquina ALINHADA (2015, 2016): contém tap_FUN E a coluna
    #    de UF 'no_cod'. Em 2017-2019 também existe uma linha tap_*, porém desalinhada
    #    e SEM 'no_cod' — essa NÃO deve ser usada (cai no caminho mesclado abaixo).
    for i in range(len(raw)):
        cells = [str(v).strip() for v in raw.iloc[i].tolist()]
        if 'tap_FUN' in cells and 'no_cod' in cells:
            hdr, kind = i, 'machine'; break
    # 2) Caso contrário, cabeçalho mesclado 'Taxa de Aprovação' (2012, 2017-2019),
    #    cuja meta são exatamente 4 colunas: Ano, UF/Unidade Geográfica, Localização, Rede.
    if hdr is None:
        for i in range(len(raw)):
            cells = [str(v).strip() for v in raw.iloc[i].tolist()]
            low = [c.lower() for c in cells]
            if 'ano' in low and ('unidade geográfica' in low or 'uf' in low) and any('taxa de aprova' in c for c in low):
                hdr, kind = i, 'merged'; break
    if hdr is None:
        print(f"    [SKIP UF-legacy] {fname}: cabeçalho não reconhecido")
        return pd.DataFrame()

    df = pd.read_excel(filepath, header=hdr, dtype=str)
    cols = list(df.columns)

    if kind == 'machine':
        ren = {}
        for old, new in [('ano', 'NU_ANO_CENSO'), ('no_cod', 'UNIDGEO'),
                         ('TIPOLOCA', 'NO_CATEGORIA'), ('DEPENDAD', 'NO_DEPENDENCIA')]:
            if old in df.columns:
                ren[old] = new
        for old, new in _LEGACY_TO_MODERN.items():
            if old in df.columns:
                ren[old] = new
        df = df.rename(columns=ren)
    else:  # merged → posicional
        ano_arquivo = extract_year_from_filename(fname)
        pos_map = _UF_LEGACY_POS_2010 if ano_arquivo == 2010 else _UF_LEGACY_POS
        recs = []
        for _, r in df.iterrows():
            rec = {
                'NU_ANO_CENSO':   r.iloc[0] if len(cols) > 0 else None,
                'UNIDGEO':        r.iloc[1] if len(cols) > 1 else None,
                'NO_CATEGORIA':   r.iloc[2] if len(cols) > 2 else None,
                'NO_DEPENDENCIA': r.iloc[3] if len(cols) > 3 else None,
            }
            for idx, name in pos_map.items():
                if idx < len(cols):
                    rec[name] = safe_float(r.iloc[idx])
            recs.append(rec)
        df = pd.DataFrame(recs)

    if 'UNIDGEO' not in df.columns or 'NU_ANO_CENSO' not in df.columns:
        print(f"    [SKIP UF-legacy] {fname}: colunas meta ausentes")
        return pd.DataFrame()

    # Normaliza rótulos de dependência (2015='Particular', 2012='Publico')
    if 'NO_DEPENDENCIA' in df.columns:
        df['NO_DEPENDENCIA'] = df['NO_DEPENDENCIA'].replace({'Particular': 'Privada'})

    # Filtra RS + Localização Total + ano numérico
    df = df[_is_rs_unidgeo(df['UNIDGEO'])]
    if 'NO_CATEGORIA' in df.columns:
        df = df[df['NO_CATEGORIA'].astype(str).str.strip() == 'Total']
    df = df[pd.to_numeric(df['NU_ANO_CENSO'], errors='coerce').notna()]

    print(f"    UF-legacy {fname}: {len(df)} linhas RS (Total)")
    return df

def ler_rendimento_uf_legacy():
    """Lê arquivos UF oficiais de anos anteriores a 2020 para a série estadual.

    Cobre 2012, 2015, 2016 (códigos tap_/tre_/tab_) e 2017, 2018, 2019
    (cabeçalho mesclado). Estes anos não eram cobertos pelo arquivo
    'tx_rend_brasil_regioes_ufs_*' e caíam no fallback de mediana dos municípios,
    o que divergia dos valores oficiais do INEP.
    """
    patterns = [
        "TX_REND_BRASIL_REGIOES_UFS_2017.xlsx",
        "TX_REND_BRASIL_REGIOES_UFS_2018.xlsx",
        "tx_rend_brasil_regioes_ufs_2019.xlsx",
        "TX_REND_UFS_2015.xlsx",
        "TX_REND_UFS_2016.xlsx",
        "tx_rendimento_UFs_2012.xlsx",
        # UFs por estado de 2010, 2011, 2013, 2014 (formato mesclado; 2010 com layout próprio)
        "TAXAS RENDIMENTO UF 2010.xls",
        "tx_rendimento_uf_2011.xls",
        "TAXAS RENDIMENTOS UF 2013.xlsx",
        "TAXAS RENDIMENTOS UF 2014.xlsx",
    ]
    seen, files = set(), []
    for pat in patterns:
        for f in glob.glob(os.path.join(REND_DIR, pat)):
            key = os.path.normcase(os.path.abspath(f))
            if key not in seen:
                seen.add(key)
                files.append(f)
    files = sorted(files, key=lambda p: extract_year_from_filename(os.path.basename(p)) or 0)
    print(f"  Encontrados {len(files)} arquivos UF legados (<2020)")

    frames = []
    for f in files:
        df = _read_uf_legacy_file(f)
        if len(df) > 0:
            frames.append(df)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()

def ler_escolas_rend_recente():
    """Lê o arquivo de rendimento por escola mais recente para o mapa territorial.

    Usa 2025 quando disponível; senão recua para 2024. Retorna (df, ano).
    """
    candidatos = [("tx_rend_escolas_2025.xlsx", 2025), ("tx_rend_escolas_2024.xlsx", 2024)]
    for nome, ano in candidatos:
        filepath = os.path.join(REND_DIR, nome)
        if os.path.exists(filepath):
            print(f"    Lendo {nome}...", end=" ", flush=True)
            t0 = time.time()
            df = ler_excel_inep(filepath, uf_filter=False)
            if len(df) > 0 and 'SG_UF' in df.columns:
                df = df[df['SG_UF'] == SG_UF]
            print(f"{len(df)} escolas RS — ano {ano} ({time.time()-t0:.1f}s)")
            return df, ano
    print("  [AVISO] Nenhum arquivo tx_rend_escolas_2025/2024.xlsx encontrado!")
    return pd.DataFrame(), None

# ══════════════════════════════════════════════════════════
# PROCESSOR
# ══════════════════════════════════════════════════════════

def processar(dep_filter, rede_label, escolas_por_ano, df_escolas_recente, ano_escola_recente=2025, df_uf=None):
    resultado = {
        "metadata": {
            "fonte": "INEP — Indicadores Educacionais",
            "indicadores": "Taxas de Rendimento + Distorção Idade-Série",
            "uf": "RS",
            "rede": rede_label,
            "gerado_em": pd.Timestamp.now().isoformat(),
        },
        "serie_temporal": {},
        "por_municipio": {},
        "tdi_estadual": {},
        "tdi_por_municipio": {},
        "lookup_municipios": {},
    }
    
    # ── 1. ESCOLA-LEVEL DATA (2010-2018) → aggregate to municipality ──
    print(f"\n  [Fase 1] Agregando escolas (2010-2018) por município...")
    for year in sorted(escolas_por_ano.keys()):
        df_esc = escolas_por_ano[year]
        ano_str = str(year)
        por_mun, lookup = agregar_escolas_por_municipio(df_esc, dep_filter, year)
        if por_mun:
            resultado["por_municipio"][ano_str] = por_mun
            resultado["lookup_municipios"].update(lookup)
            print(f"    {ano_str}: {len(por_mun)} municípios")
    
    # ── 2. MUNICIPALITY-LEVEL DATA (2019-2024) ──
    print(f"\n  [Fase 2] Lendo dados por município (2019-2024)...")
    df_mun = ler_rendimento_municipios()
    if len(df_mun) > 0:
        df_mun = df_mun[df_mun['NO_DEPENDENCIA'].isin(dep_filter)]
    
    if len(df_mun) > 0:
        for _, row in df_mun.drop_duplicates('CO_MUNICIPIO').iterrows():
            resultado["lookup_municipios"][str(row['CO_MUNICIPIO'])] = row['NO_MUNICIPIO']
        
        for ano in sorted(df_mun['NU_ANO_CENSO'].unique()):
            df_ano = df_mun[df_mun['NU_ANO_CENSO'] == ano]
            ano_str = str(ano)
            # Dado oficial por município substitui integralmente a agregação de escolas
            resultado["por_municipio"][ano_str] = {}
            
            for _, row in df_ano.iterrows():
                cod = str(row['CO_MUNICIPIO'])
                resultado["por_municipio"][ano_str][cod] = build_rend_record(row)
            print(f"    {ano_str}: {len(df_ano)} municípios (arquivo por município)")
    
    # ── 3. SERIE TEMPORAL ──
    # Fallback: mediana dos municípios (para anos sem dado UF oficial)
    KEYS = REND_KEYS
    for ano, muns in sorted(resultado["por_municipio"].items()):
        vals = {k: [] for k in KEYS}
        for cod, v in muns.items():
            for k in KEYS:
                if v.get(k) is not None:
                    vals[k].append(v[k])
        resultado["serie_temporal"][ano] = {k: round(np.median(vs), 1) if vs else None for k, vs in vals.items()}
    
    # Override with official UF-level data when available (more accurate than
    # median of municipalities which inflates approval and deflates reprovação)
    if df_uf is not None and len(df_uf) > 0:
        df_uf_filtered = df_uf[df_uf['NO_DEPENDENCIA'].isin(dep_filter)] if 'NO_DEPENDENCIA' in df_uf.columns else df_uf
        n_overrides = 0
        for _, row in df_uf_filtered.iterrows():
            try:
                ano_str = str(int(float(row['NU_ANO_CENSO'])))
            except:
                continue
            uf_entry = build_rend_record(row)
            # Only override if we got at least some valid values
            has_data = any(v is not None for v in uf_entry.values())
            if has_data:
                # Merge: keep fallback median for keys not present in UF data
                if ano_str in resultado["serie_temporal"]:
                    for k, v in uf_entry.items():
                        if v is not None:
                            resultado["serie_temporal"][ano_str][k] = v
                else:
                    resultado["serie_temporal"][ano_str] = uf_entry
                n_overrides += 1
        print(f"\n  [Fase 3b] Serie temporal: {n_overrides} anos com dado UF oficial (override da mediana)")
    
    # ── 4. TDI POR MUNICIPIO ──
    df_tdi = ler_tdi_municipios()
    if len(df_tdi) > 0:
        df_tdi = df_tdi[df_tdi['NO_DEPENDENCIA'].isin(dep_filter)]
    
    if len(df_tdi) > 0:
        for ano_tdi_val in sorted(df_tdi['NU_ANO_CENSO'].dropna().unique()):
            try:
                ano_tdi_str = str(int(float(ano_tdi_val)))
            except:
                continue
            df_tdi_ano = df_tdi[df_tdi['NU_ANO_CENSO'] == ano_tdi_val]
            resultado["tdi_ano"] = ano_tdi_str
            
            tdi_vals = {k: [] for k in ['tdi_fund','tdi_fund_ai','tdi_fund_af','tdi_med']}
            for _, row in df_tdi_ano.iterrows():
                cod = str(row['CO_MUNICIPIO'])
                entry = {
                    "tdi_fund": safe_float(row.get('FUN_CAT_0')),
                    "tdi_fund_ai": safe_float(row.get('FUN_AI_CAT_0')),
                    "tdi_fund_af": safe_float(row.get('FUN_AF_CAT_0')),
                    "tdi_med": safe_float(row.get('MED_CAT_0')),
                }
                resultado["tdi_por_municipio"][cod] = entry
                for k in tdi_vals:
                    if entry[k] is not None:
                        tdi_vals[k].append(entry[k])
                if cod not in resultado["lookup_municipios"]:
                    resultado["lookup_municipios"][cod] = row.get('NO_MUNICIPIO', f'Cod.{cod}')
            
            resultado["tdi_estadual"] = {k: round(np.median(vs), 1) if vs else None for k, vs in tdi_vals.items()}
    
    # ── 5. TDI UF (série temporal) ──
    df_tdi_uf = ler_tdi_uf()
    tdi_serie = {}
    if len(df_tdi_uf) > 0:
        df_tdi_uf_f = df_tdi_uf[df_tdi_uf['NO_DEPENDENCIA'].isin(dep_filter)] if 'NO_DEPENDENCIA' in df_tdi_uf.columns else df_tdi_uf
        for _, row in df_tdi_uf_f.iterrows():
            try:
                ano_str = str(int(float(row['NU_ANO_CENSO'])))
            except:
                continue
            entry = {
                "tdi_fund": safe_float(row.get('FUN_CAT_0')),
                "tdi_fund_ai": safe_float(row.get('FUN_AI_CAT_0')),
                "tdi_fund_af": safe_float(row.get('FUN_AF_CAT_0')),
                "tdi_med": safe_float(row.get('MED_CAT_0')),
            }
            tdi_serie[ano_str] = entry
            resultado["tdi_estadual"] = entry
    resultado["tdi_serie_temporal"] = tdi_serie
    
    # ── 6. DADOS ESCOLAS (Mapa) — ano mais recente disponível (2025) ──
    por_escola = []
    if len(df_escolas_recente) > 0:
        df_esc_filtered = df_escolas_recente[df_escolas_recente['NO_DEPENDENCIA'].isin(dep_filter)]
        for _, row in df_esc_filtered.iterrows():
            rec = {
                "cod_escola": str(row.get('CO_ENTIDADE', '')),
                "nome_escola": str(row.get('NO_ENTIDADE', '')),
                "cod_mun": str(row.get('CO_MUNICIPIO', '')),
                "nome_mun": str(row.get('NO_MUNICIPIO', '')),
                "aprov_fund": safe_float(row.get('1_CAT_FUN')),
                "aprov_fund_ai": safe_float(row.get('1_CAT_FUN_AI')),
                "aprov_fund_af": safe_float(row.get('1_CAT_FUN_AF')),
                "aprov_med": safe_float(row.get('1_CAT_MED')),
                "reprov_fund": safe_float(row.get('2_CAT_FUN')),
                "reprov_fund_ai": safe_float(row.get('2_CAT_FUN_AI')),
                "reprov_fund_af": safe_float(row.get('2_CAT_FUN_AF')),
                "reprov_med": safe_float(row.get('2_CAT_MED')),
                "aband_fund": safe_float(row.get('3_CAT_FUN')),
                "aband_fund_ai": safe_float(row.get('3_CAT_FUN_AI')),
                "aband_fund_af": safe_float(row.get('3_CAT_FUN_AF')),
                "aband_med": safe_float(row.get('3_CAT_MED'))
            }
            por_escola.append(rec)
    # Mantém a chave dinâmica (por_escola_2025) + um alias estável p/ o frontend
    resultado[f"por_escola_{ano_escola_recente}"] = por_escola
    resultado["por_escola_recente"] = por_escola
    resultado["ano_escola_recente"] = str(ano_escola_recente) if ano_escola_recente else None

    return resultado

# ══════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("=" * 70)
    print("ETL FLUXO E RENDIMENTO RS — UNESCO Produto 4 (MULTI-REDE)")
    print(f"Diretório de dados: {REND_DIR}")
    print("=" * 70)
    
    t0 = time.time()
    
    # Pre-load escola files (shared across redes)
    print("\n[PRE-LOAD] Lendo arquivos de escola (2010-2018)...")
    escolas_por_ano = ler_rendimento_escolas()
    print(f"  Carregados: {sorted(escolas_por_ano.keys())}")
    
    print("\n[PRE-LOAD] Lendo arquivo de escola mais recente (2025/2024)...")
    df_escolas_recente, ano_escola_recente = ler_escolas_rend_recente()
    
    print("\n[PRE-LOAD] Lendo dados UF oficiais (2020-2024)...")
    df_uf = ler_rendimento_uf()
    print(f"  Linhas UF (2020-2024): {len(df_uf)}")

    print("\n[PRE-LOAD] Lendo dados UF oficiais legados (2012, 2015-2019)...")
    df_uf_legacy = ler_rendimento_uf_legacy()
    if len(df_uf_legacy) > 0:
        df_uf = pd.concat([df_uf, df_uf_legacy], ignore_index=True) if len(df_uf) > 0 else df_uf_legacy
    print(f"  Linhas UF totais (com legado): {len(df_uf)}")
    
    for rede_key, rede_cfg in REDES.items():
        print(f"\n{'='*60}")
        print(f"  REDE: {rede_key.upper()} ({rede_cfg['label']})")
        print(f"{'='*60}")
        
        # Só a rede estadual precisa dos dados por escola (temos coords apenas das estaduais)
        df_esc = df_escolas_recente if rede_key == 'estadual' else pd.DataFrame()
        resultado = processar(rede_cfg['dep'], rede_cfg['label'], escolas_por_ano, df_esc,
                              ano_escola_recente=ano_escola_recente or 2025, df_uf=df_uf)
        
        out_json = os.path.join(OUT_DIR, f"4_3_fluxo_{rede_key}.json")
        with open(out_json, "w", encoding="utf-8") as f:
            json.dump(resultado, f, ensure_ascii=False, separators=(',', ':'))
        
        size_mb = os.path.getsize(out_json) / 1024 / 1024
        print(f"\n  JSON: {os.path.basename(out_json)} ({size_mb:.1f} MB)")
        print(f"  Anos rendimento: {sorted(resultado['serie_temporal'].keys())}")
        print(f"  Municípios: {len(resultado['lookup_municipios'])}")
    
    # Backward compatibility
    src = os.path.join(OUT_DIR, "4_3_fluxo_estadual.json")
    dst = os.path.join(OUT_DIR, "4_3_fluxo_rendimento.json")
    if os.path.exists(src):
        shutil.copy2(src, dst)
        print(f"\n[COMPAT] Copiado -> {os.path.basename(dst)}")
    
    print(f"\nTempo total: {time.time()-t0:.1f}s")
    print("=" * 70)
