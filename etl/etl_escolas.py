# -*- coding: utf-8 -*-
"""
ETL Escolas — Visão por Escola (Rede Estadual RS)
Produto 4 UNESCO RS

Combina coordenadas (Censo + SEDUC), indicadores por escola
(SAEB, IDEB, INSE, ICG, TDI) e gera JSON para mapa + aba Excel.
"""
import sys, io


# --- caminhos portateis (repo Git + bases locais) ---
from paths import BASE, OUT_DIR, PAINEL_DIR, BASES_DIR, BASES_BASICAS  # noqa: E402

BASES_DADOS = BASES_DIR

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import pandas as pd
import numpy as np
import json, os, re, unicodedata, time, glob

# ════════════════════════════════════════════════════
# 1. UTILITY FUNCTIONS
# ════════════════════════════════════════════════════

def normalize_name(s):
    """Normalize school name for matching."""
    if pd.isna(s): return ''
    s = str(s).upper()
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    # Remove common prefixes (order matters: longest first)
    prefixes = [
        'ESCOLA ESTADUAL DE EDUCACAO BASICA ', 'ESCOLA ESTADUAL DE ENSINO MEDIO ',
        'ESCOLA ESTADUAL DE ENSINO FUNDAMENTAL ',
        'ESC ESTADUAL DE ENSINO MEDIO ', 'ESC ESTADUAL DE ENSINO FUNDAMENTAL ',
        'COLEGIO ESTADUAL ', 'COL ESTADUAL ',
        'C EST DE EN MED ', 'C EST DE ENS MED ',
        'ESC EST ENS MED ', 'ESC EST ED BAS ', 'ESC EST ENS FUN ', 'ESC EST ENS FUND ',
        'ESC EST DE ENS MED ', 'ESC EST DE ENS FUND ',
        'E E IND ENS FUN ', 'E E ENS MED ', 'E E ENS FUN ', 'E E ED BAS ',
        'INST EST EDU ', 'INST ESTADUAL DE EDUCACAO ',
        'ESC EST ', 'E E ', 'COLEGIO EST ', 'COL EST ',
    ]
    for prefix in prefixes:
        if s.startswith(prefix):
            s = s[len(prefix):]
            break
    s = re.sub(r'[^A-Z0-9 ]', '', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def safe_float(val):
    if val is None or val == '' or val == '-' or val == 'ND':
        return None
    try:
        v = float(val)
        return None if np.isnan(v) else round(v, 2)
    except (ValueError, TypeError):
        return None

# ════════════════════════════════════════════════════
# 2. LOAD COORDINATE SOURCES
# ════════════════════════════════════════════════════

def load_censo_escolas():
    """Load Escolas_Estaduais_RS_2025.xlsx as canonical base."""
    f = os.path.join(BASES_BASICAS, 'Escolas_Estaduais_RS_2025.xlsx')
    df = pd.read_excel(f)
    inep_col = df.columns[0]  # 'Código INEP'
    df['INEP'] = df[inep_col].astype(int).astype(str)
    df['_norm'] = df['Nome da Escola'].apply(normalize_name)
    # Clean lat/long
    df['lat'] = pd.to_numeric(df['Latitude'], errors='coerce')
    df['lng'] = pd.to_numeric(df['Longitude'], errors='coerce')
    # Remove invalid coordinates
    mask_invalid = (df['lat'] == 0) | (df['lng'] == 0) | df['lat'].isna() | df['lng'].isna()
    df.loc[mask_invalid, ['lat', 'lng']] = np.nan
    print(f"  Censo: {len(df)} escolas | {df['lat'].notna().sum()} com coordenadas")
    return df

def load_seduc_coords():
    """Load SEDUC coordinate file."""
    f = os.path.join(BASES_BASICAS, 'escolas_rede_ativas_lat_long.xlsx')
    df = pd.read_excel(f)
    df['_norm'] = df['NOME_ESTAB_REDUZIDO'].apply(normalize_name)
    df['lat'] = pd.to_numeric(df['LATITUDE_ESTAB'], errors='coerce')
    df['lng'] = pd.to_numeric(df['LONGITUDE_ESTAB'], errors='coerce')
    print(f"  SEDUC: {len(df)} escolas | {df['lat'].notna().sum()} com coordenadas")
    return df

def _extract_cre_num(cre_str):
    """Extract numeric CRE from either '1' or '01 CRE' format."""
    m = re.search(r'(\d+)', str(cre_str))
    return int(m.group(1)) if m else None

def match_coordinates(df_censo, df_seduc):
    """Match SEDUC coords to Censo schools missing coordinates.
    
    Uses (normalized_name, CRE_number) as the lookup key to prevent
    coordinate collisions between schools with the same name in
    different CREs (e.g., 'Érico Veríssimo' exists in 4+ CREs).
    Falls back to name-only match if CRE-aware match fails.
    """
    # Extract numeric CRE for both sources
    df_seduc = df_seduc.copy()
    df_seduc['_cre_num'] = df_seduc['CD_CRE'].apply(_extract_cre_num)
    df_censo['_cre_num'] = df_censo['Cód. CRE'].apply(_extract_cre_num)

    # Build SEDUC lookup by (normalized name, CRE number)
    seduc_lookup_cre = {}
    seduc_lookup_name = {}  # fallback: name-only (for schools with no CRE match)
    for _, r in df_seduc.iterrows():
        name = r['_norm']
        cre = r['_cre_num']
        if name and pd.notna(r['lat']):
            key = (name, cre)
            if key not in seduc_lookup_cre:
                seduc_lookup_cre[key] = (r['lat'], r['lng'])
            if name not in seduc_lookup_name:
                seduc_lookup_name[name] = (r['lat'], r['lng'])

    stats = {'total': len(df_censo), 'censo_ok': 0, 'seduc_fill': 0,
             'seduc_fallback': 0, 'no_match': 0, 'no_coords': 0}

    for idx, row in df_censo.iterrows():
        if pd.notna(row['lat']):
            stats['censo_ok'] += 1
            continue
        # Try SEDUC match: CRE-aware first, then name-only fallback
        norm = row['_norm']
        cre = row['_cre_num']
        key = (norm, cre)
        if key in seduc_lookup_cre:
            df_censo.at[idx, 'lat'] = seduc_lookup_cre[key][0]
            df_censo.at[idx, 'lng'] = seduc_lookup_cre[key][1]
            df_censo.at[idx, 'coord_fonte'] = 'SEDUC'
            stats['seduc_fill'] += 1
        elif norm in seduc_lookup_name:
            # Only use name-only fallback if name is unique across CREs
            cre_count = sum(1 for k in seduc_lookup_cre if k[0] == norm)
            if cre_count <= 1:
                df_censo.at[idx, 'lat'] = seduc_lookup_name[norm][0]
                df_censo.at[idx, 'lng'] = seduc_lookup_name[norm][1]
                df_censo.at[idx, 'coord_fonte'] = 'SEDUC'
                stats['seduc_fallback'] += 1
            else:
                # Ambiguous name — skip to avoid wrong coords
                stats['no_match'] += 1
        else:
            stats['no_match'] += 1

    # Set coord source for censo-sourced ones
    df_censo.loc[(df_censo['coord_fonte'] == '') & df_censo['lat'].notna(), 'coord_fonte'] = 'Censo'
    stats['no_coords'] = df_censo['lat'].isna().sum()

    return df_censo, stats

# ════════════════════════════════════════════════════
# 3. LOAD INDICATORS PER SCHOOL
# ════════════════════════════════════════════════════

def load_saeb_by_school():
    """Load SAEB proficiency per school from TS_ESCOLA (latest year: 2023)."""
    saeb_dir = os.path.join(BASES_DADOS, '03. Desempenho IDEB.SAEB', '01. SAEB')
    # Find 2023 TS_ESCOLA
    for root, dirs, files in os.walk(saeb_dir):
        for f in files:
            if 'escola' in f.lower() and f.endswith('.csv') and '2023' in root and 'quest' not in f.lower():
                fpath = os.path.join(root, f)
                print(f"  SAEB: lendo {os.path.basename(fpath)}...")
                # Detect separator
                df = pd.read_csv(fpath, sep=';', encoding='latin-1', nrows=2)
                if len(df.columns) < 5:
                    df = pd.read_csv(fpath, sep=',', encoding='latin-1')
                else:
                    df = pd.read_csv(fpath, sep=';', encoding='latin-1')

                # Filter RS public
                if 'ID_UF' in df.columns:
                    df = df[df['ID_UF'] == 43]
                elif 'CO_UF' in df.columns:
                    df = df[df['CO_UF'] == 43]

                if 'IN_PUBLICA' in df.columns:
                    df = df[df['IN_PUBLICA'] == 1]

                result = {}
                for _, row in df.iterrows():
                    eid = str(int(row['ID_ESCOLA']))
                    entry = {}
                    for col, key in [('MEDIA_5EF_LP', 'saeb_5ef_lp'), ('MEDIA_5EF_MT', 'saeb_5ef_mt'),
                                     ('MEDIA_9EF_LP', 'saeb_9ef_lp'), ('MEDIA_9EF_MT', 'saeb_9ef_mt'),
                                     ('MEDIA_EM_LP', 'saeb_em_lp'), ('MEDIA_EM_MT', 'saeb_em_mt')]:
                        if col in df.columns:
                            v = safe_float(row[col])
                            if v is not None:
                                entry[key] = v
                    if entry:
                        result[eid] = entry
                print(f"    → {len(result)} escolas com dados SAEB 2023")
                return result
    print("  SAEB: arquivo 2023 não encontrado")
    return {}

def load_ideb_by_school():
    """Load IDEB per school from divulgacao files (2023)."""
    ideb_dir = None
    for d in os.listdir(BASES_DADOS):
        if 'Fluxo' in d and 'Rendimento' in d:
            ideb_sub = os.path.join(BASES_DADOS, d, '02. IDEB')
            if os.path.exists(ideb_sub):
                ideb_dir = ideb_sub
                break
    if not ideb_dir:
        print("  IDEB: diretório não encontrado")
        return {}

    result = {}
    etapas = {
        'AI': 'divulgacao_anos_iniciais_escolas_2023.xlsx',
        'AF': 'divulgacao_anos_finais_escolas_2023.xlsx',
        'EM': 'divulgacao_ensino_medio_escolas_2023.xlsx',
    }
    for etapa, fname in etapas.items():
        fpath = os.path.join(ideb_dir, fname)
        if not os.path.exists(fpath):
            continue
        print(f"  IDEB {etapa}: lendo {fname}...")
        df = pd.read_excel(fpath, header=9)
        df = df[df['SG_UF'] == 'RS'].copy()
        df = df[df['REDE'] == 'Estadual'].copy()

        for _, row in df.iterrows():
            eid = str(int(row['ID_ESCOLA']))
            obs_2017 = safe_float(row.get('VL_OBSERVADO_2017'))
            obs_2019 = safe_float(row.get('VL_OBSERVADO_2019'))
            obs_2021 = safe_float(row.get('VL_OBSERVADO_2021'))
            obs_2023 = safe_float(row.get('VL_OBSERVADO_2023'))
            
            if obs_2023 is not None:
                if eid not in result:
                    result[eid] = {'ideb_hist': {}}
                
                # Keep latest as top-level for backwards compatibility
                result[eid][f'ideb_{etapa.lower()}'] = obs_2023
                
                # Add to history
                if f'ideb_{etapa.lower()}' not in result[eid]['ideb_hist']:
                    result[eid]['ideb_hist'][f'ideb_{etapa.lower()}'] = {}
                
                if obs_2017 is not None: result[eid]['ideb_hist'][f'ideb_{etapa.lower()}']['2017'] = obs_2017
                if obs_2019 is not None: result[eid]['ideb_hist'][f'ideb_{etapa.lower()}']['2019'] = obs_2019
                if obs_2021 is not None: result[eid]['ideb_hist'][f'ideb_{etapa.lower()}']['2021'] = obs_2021
                if obs_2023 is not None: result[eid]['ideb_hist'][f'ideb_{etapa.lower()}']['2023'] = obs_2023

    print(f"    → {len(result)} escolas com dados IDEB 2017-2023")
    return result

def load_inse_by_school():
    """Load INSE per school (2023)."""
    inse_dir = None
    for d in os.listdir(BASES_DADOS):
        if 'Desigualdade' in d or 'INSE' in d:
            inse_dir = os.path.join(BASES_DADOS, d)
            break
    if not inse_dir:
        print("  INSE: diretório não encontrado")
        return {}

    fpath = os.path.join(inse_dir, 'INSE_2023_escolas.xlsx')
    if not os.path.exists(fpath):
        fpath = os.path.join(inse_dir, 'INSE_2021_escolas (1).xlsx')
    if not os.path.exists(fpath):
        print("  INSE: arquivo não encontrado")
        return {}

    print(f"  INSE: lendo {os.path.basename(fpath)}...")
    df = pd.read_excel(fpath)
    df = df[df['SG_UF'] == 'RS'].copy()
    # Filter estadual (TP_TIPO_REDE=2 for estadual)
    if 'TP_TIPO_REDE' in df.columns:
        df = df[df['TP_TIPO_REDE'] == 2].copy()

    result = {}
    for _, row in df.iterrows():
        eid = str(int(row['ID_ESCOLA']))
        media = safe_float(row.get('MEDIA_INSE'))
        classif = str(row.get('INSE_CLASSIFICACAO', ''))
        if media is not None:
            result[eid] = {'inse_media': media, 'inse_nivel': classif}
    print(f"    → {len(result)} escolas com INSE")
    return result

def load_icg_by_school():
    """Load ICG per school (most recent year)."""
    icg_dir = None
    for d in os.listdir(BASES_DADOS):
        if 'Complex' in d:
            icg_dir = os.path.join(BASES_DADOS, d)
            break
    if not icg_dir:
        print("  ICG: diretório não encontrado")
        return {}

    # Find most recent file
    files = sorted(glob.glob(os.path.join(icg_dir, 'ICG_ESCOLAS_*.xlsx')), reverse=True)
    if not files:
        print("  ICG: nenhum arquivo encontrado")
        return {}

    fpath = files[0]
    fname = os.path.basename(fpath)
    year = re.search(r'(\d{4})', fname).group(1)
    print(f"  ICG: lendo {fname}...")

    df = pd.read_excel(fpath, header=6)
    df.columns = ['Ano', 'Regiao', 'UF', 'Cod_Mun', 'Nome_Mun',
                  'Cod_Escola', 'Nome_Escola', 'Loc', 'Dep', 'Nivel']
    df = df[df['UF'].notna()].copy()
    df = df[df['UF'].astype(str).str.strip() == 'RS'].copy()
    df = df[df['Dep'].astype(str).str.strip() == 'Estadual'].copy()

    result = {}
    for _, row in df.iterrows():
        try:
            eid = str(int(row['Cod_Escola']))
            nivel_str = str(row['Nivel'])
            nivel_num = re.search(r'(\d)', nivel_str)
            if nivel_num:
                result[eid] = {'icg_nivel': int(nivel_num.group(1))}
        except (ValueError, TypeError):
            continue
    print(f"    → {len(result)} escolas com ICG {year}")
    return result

def load_tdi_by_school():
    """Load TDI per school (most recent year with data)."""
    tdi_dir = os.path.join(BASES_DADOS, '02. Fluxo e Rendimento (Inep_2010_2024_Rendimento_TDI)', '01. Rendimento e TDI')
    if not os.path.exists(tdi_dir):
        print("  TDI: diretório não encontrado")
        return {}

    # Find most recent file (2019+ format with SG_UF columns)
    files = sorted(glob.glob(os.path.join(tdi_dir, 'TDI_ESCOLAS_*.xlsx')), reverse=True)
    # Filter only 2021+
    files = [f for f in files if any(str(y) in os.path.basename(f) for y in range(2021, 2030))]
    if not files:
        print("  TDI: nenhum arquivo 2021+ encontrado")
        return {}

    result = {}
    for fpath in files:
        fname = os.path.basename(fpath)
        year_match = re.search(r'(\d{4})', fname)
        if not year_match: continue
        year = year_match.group(1)
        print(f"  TDI: lendo {fname}...")

        df = pd.read_excel(fpath, header=8)
        if 'SG_UF' not in df.columns or 'NO_DEPENDENCIA' not in df.columns:
            continue
        df = df[df['SG_UF'].astype(str).str.strip() == 'RS'].copy()
        df = df[df['NO_DEPENDENCIA'].astype(str).str.strip() == 'Estadual'].copy()

        for _, row in df.iterrows():
            try:
                eid = str(int(row['CO_ENTIDADE']))
                if eid not in result:
                    result[eid] = {'tdi_hist': {}}
                
                entry = {}
                for col, key in [('FUN_CAT_0', 'tdi_fund'), ('FUN_AI_CAT_0', 'tdi_ai'),
                                 ('FUN_AF_CAT_0', 'tdi_af'), ('MED_CAT_0', 'tdi_med')]:
                    if col in df.columns:
                        v = safe_float(row[col])
                        if v is not None:
                            entry[key] = v
                
                if entry:
                    # Assign flat value if it's the most recent year (the first one read)
                    if 'tdi_fund' not in result[eid] and 'tdi_med' not in result[eid]:
                        for k, v in entry.items():
                            result[eid][k] = v
                    result[eid]['tdi_hist'][year] = entry
            except (ValueError, TypeError):
                continue
    print(f"    → {len(result)} escolas com histórico TDI")
    return result

def load_saers_by_school():
    """Load SAERS proficiency per school from 4_saers_escolas.json."""
    fpath = os.path.join(PAINEL_DIR, '4_saers_escolas.json')
    if not os.path.exists(fpath):
        print("  SAERS: arquivo não encontrado")
        return {}
        
    print(f"  SAERS: lendo {os.path.basename(fpath)}...")
    with open(fpath, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    result = {}
    anos = sorted(list(data.get('anos', {}).keys()), reverse=True)
    
    # Map from saers keys to output keys
    key_map = {
        '2_EF_LP': 'saers_2ef_lp', '2_EF_MT': 'saers_2ef_mt',
        '5_EF_LP': 'saers_5ef_lp', '5_EF_MT': 'saers_5ef_mt',
        '9_EF_LP': 'saers_9ef_lp', '9_EF_MT': 'saers_9ef_mt',
        '3_EM_LP': 'saers_em_lp', '3_EM_MT': 'saers_em_mt',
    }
    
    for ano in anos:
        por_escola = data['anos'][ano].get('por_escola', {})
        for eid, entry in por_escola.items():
            if eid not in result:
                result[eid] = {'saers_hist': {}}
            if ano not in result[eid]['saers_hist']:
                result[eid]['saers_hist'][ano] = {}
                
            for raw_k, out_k in key_map.items():
                if raw_k in entry:
                    val = safe_float(entry[raw_k].get('proficiencia'))
                    if val is not None:
                        result[eid]['saers_hist'][ano][out_k] = val
                        # Also keep the most recent year's data flat for easy access
                        if out_k not in result[eid]:
                            result[eid][out_k] = val
                        
    print(f"    → {len(result)} escolas com dados SAERS")
    return result

def load_matriculas_by_school():
    """Load enrollment data (QT_MAT_*) per school from Censo 2025."""
    MICRO_DIR = os.path.join(BASE, "00. Bases de Dados", "01. Acesso e Matrículas (Censo Escolar_2010_2025)", "01. extrações_2010_2025")
    
    # Try 2025 first (split tables), then fall back to 2024 microdados
    f_escola = os.path.join(MICRO_DIR, "Tabela_Escola_2025.csv")
    f_mat = os.path.join(MICRO_DIR, "Tabela_Matricula_2025.csv")
    
    if os.path.exists(f_mat) and os.path.exists(f_escola):
        print(f"  Matrículas: lendo Tabelas 2025...")
        
        # Get list of RS estadual schools
        h_esc = pd.read_csv(f_escola, sep=";", encoding="latin-1", nrows=0)
        esc_cols = [c for c in ["CO_UF", "CO_ENTIDADE", "TP_DEPENDENCIA", "TP_SITUACAO_FUNCIONAMENTO"] if c in h_esc.columns]
        df_esc = pd.read_csv(f_escola, sep=";", encoding="latin-1", usecols=esc_cols)
        df_esc = df_esc[(df_esc["CO_UF"] == 43) & (df_esc["TP_DEPENDENCIA"] == 2) & (df_esc["TP_SITUACAO_FUNCIONAMENTO"] == 1)]
        entidades_rs = set(df_esc["CO_ENTIDADE"].unique())
        
        # Read enrollment columns
        mat_cols_desired = [
            "CO_ENTIDADE",
            "QT_MAT_BAS", "QT_MAT_INF", "QT_MAT_INF_CRE", "QT_MAT_INF_PRE",
            "QT_MAT_FUND", "QT_MAT_FUND_AI", "QT_MAT_FUND_AF",
            "QT_MAT_MED", "QT_MAT_EJA", "QT_MAT_ESP",
            "QT_MAT_PROF", "QT_MAT_PROF_TEC",
            "QT_MAT_BAS_MASC", "QT_MAT_BAS_FEM",
            "QT_MAT_BAS_N",
        ]
        h_mat = pd.read_csv(f_mat, sep=";", encoding="latin-1", nrows=0)
        mat_cols = [c for c in mat_cols_desired if c in h_mat.columns]
        df_mat = pd.read_csv(f_mat, sep=";", encoding="latin-1", usecols=mat_cols)
        df_mat = df_mat[df_mat["CO_ENTIDADE"].isin(entidades_rs)]
        
        result = {}
        for _, row in df_mat.iterrows():
            eid = str(int(row["CO_ENTIDADE"]))
            entry = {
                'mat_total': int(row.get("QT_MAT_BAS", 0) or 0),
                'mat_infantil': int(row.get("QT_MAT_INF", 0) or 0),
                'mat_fund': int(row.get("QT_MAT_FUND", 0) or 0),
                'mat_fund_ai': int(row.get("QT_MAT_FUND_AI", 0) or 0),
                'mat_fund_af': int(row.get("QT_MAT_FUND_AF", 0) or 0),
                'mat_medio': int(row.get("QT_MAT_MED", 0) or 0),
                'mat_eja': int(row.get("QT_MAT_EJA", 0) or 0),
                'mat_especial': int(row.get("QT_MAT_ESP", 0) or 0),
                'mat_noturno': int(row.get("QT_MAT_BAS_N", 0) or 0),
            }
            # Add tecnico/profissional if available
            if "QT_MAT_PROF_TEC" in mat_cols:
                entry['mat_tecnico'] = int(row.get("QT_MAT_PROF_TEC", 0) or 0)
            elif "QT_MAT_PROF" in mat_cols:
                entry['mat_tecnico'] = int(row.get("QT_MAT_PROF", 0) or 0)
            result[eid] = entry
        
        print(f"    -> {len(result)} escolas com matriculas 2025")
        return result
    
    # Fallback: 2024 microdados
    import glob as globm
    pattern = os.path.join(MICRO_DIR, "microdados_ed_basica_2024.*")
    matches = globm.glob(pattern)
    if matches:
        print(f"  Matrículas: lendo microdados 2024...")
        h = pd.read_csv(matches[0], sep=";", encoding="latin-1", nrows=0)
        mat_cols_desired = [
            "CO_UF", "CO_ENTIDADE", "TP_DEPENDENCIA", "TP_SITUACAO_FUNCIONAMENTO",
            "QT_MAT_BAS", "QT_MAT_INF", "QT_MAT_FUND", "QT_MAT_FUND_AI", "QT_MAT_FUND_AF",
            "QT_MAT_MED", "QT_MAT_EJA", "QT_MAT_ESP", "QT_MAT_BAS_N",
            "QT_MAT_PROF", "QT_MAT_PROF_TEC",
        ]
        use = [c for c in mat_cols_desired if c in h.columns]
        df = pd.read_csv(matches[0], sep=";", encoding="latin-1", usecols=use)
        df = df[(df["CO_UF"] == 43) & (df["TP_DEPENDENCIA"] == 2) & (df["TP_SITUACAO_FUNCIONAMENTO"] == 1)]
        
        result = {}
        for _, row in df.iterrows():
            eid = str(int(row["CO_ENTIDADE"]))
            result[eid] = {
                'mat_total': int(row.get("QT_MAT_BAS", 0) or 0),
                'mat_infantil': int(row.get("QT_MAT_INF", 0) or 0),
                'mat_fund': int(row.get("QT_MAT_FUND", 0) or 0),
                'mat_fund_ai': int(row.get("QT_MAT_FUND_AI", 0) or 0),
                'mat_fund_af': int(row.get("QT_MAT_FUND_AF", 0) or 0),
                'mat_medio': int(row.get("QT_MAT_MED", 0) or 0),
                'mat_eja': int(row.get("QT_MAT_EJA", 0) or 0),
                'mat_especial': int(row.get("QT_MAT_ESP", 0) or 0),
                'mat_noturno': int(row.get("QT_MAT_BAS_N", 0) or 0),
            }
        print(f"    -> {len(result)} escolas com matriculas 2024")
        return result
    
    print("  Matrículas: nenhum arquivo encontrado")
    return {}

def load_censo_history_by_school():
    """Load historical QT_MAT_BAS and QT_DOC_BAS from 2021 to 2024 microdados."""
    MICRO_DIR = os.path.join(BASE, "00. Bases de Dados", "01. Acesso e Matrículas (Censo Escolar_2010_2025)", "01. extrações_2010_2025")
    result = {}
    
    for year in range(2021, 2025):
        pattern = os.path.join(MICRO_DIR, f"microdados_ed_basica_{year}.*")
        import glob
        matches = glob.glob(pattern)
        if not matches:
            continue
            
        print(f"  Histórico Censo {year}: lendo microdados...")
        fpath = matches[0]
        try:
            h = pd.read_csv(fpath, sep=";", encoding="latin-1", nrows=0)
            use = [c for c in ["CO_UF", "CO_ENTIDADE", "TP_DEPENDENCIA", "TP_SITUACAO_FUNCIONAMENTO", "QT_MAT_BAS", "QT_DOC_BAS"] if c in h.columns]
            if "CO_ENTIDADE" not in use:
                continue
                
            df = pd.read_csv(fpath, sep=";", encoding="latin-1", usecols=use)
            df = df[(df["CO_UF"] == 43) & (df["TP_DEPENDENCIA"] == 2) & (df["TP_SITUACAO_FUNCIONAMENTO"] == 1)]
            
            for _, row in df.iterrows():
                eid = str(int(row["CO_ENTIDADE"]))
                if eid not in result:
                    result[eid] = {'mat_hist': {}, 'doc_hist': {}}
                
                if "QT_MAT_BAS" in row and pd.notna(row["QT_MAT_BAS"]):
                    result[eid]['mat_hist'][str(year)] = int(row["QT_MAT_BAS"])
                if "QT_DOC_BAS" in row and pd.notna(row["QT_DOC_BAS"]):
                    result[eid]['doc_hist'][str(year)] = int(row["QT_DOC_BAS"])
        except Exception as e:
            print(f"    Erro ao ler {year}: {e}")
            
    # Also add 2025 to history from the previously loaded dictionaries, but we will do that in the main loop to avoid re-reading
    print(f"    → {len(result)} escolas com histórico do Censo (2021-2024)")
    return result

def load_infra_by_school():
    """Load key infrastructure indicators (IN_*) per school from Censo 2025."""
    MICRO_DIR = os.path.join(BASE, "00. Bases de Dados", "01. Acesso e Matrículas (Censo Escolar_2010_2025)", "01. extrações_2010_2025")
    f_escola = os.path.join(MICRO_DIR, "Tabela_Escola_2025.csv")
    
    if not os.path.exists(f_escola):
        # Try 2024 microdados
        pattern = os.path.join(MICRO_DIR, "microdados_ed_basica_2024.*")
        matches = glob.glob(pattern)
        if not matches:
            print("  Infra: nenhum arquivo encontrado")
            return {}
        f_escola = matches[0]
    
    print(f"  Infra: lendo {os.path.basename(f_escola)}...")
    
    # Key infra indicators to include per school
    KEY_INFRA = [
        "IN_INTERNET", "IN_BANDA_LARGA", "IN_COMPUTADOR",
        "IN_LABORATORIO_INFORMATICA", "IN_BIBLIOTECA", "IN_BIBLIOTECA_SALA_LEITURA",
        "IN_LABORATORIO_CIENCIAS", "IN_QUADRA_ESPORTES", "IN_QUADRA_ESPORTES_COBERTA",
        "IN_SALA_ATENDIMENTO_ESPECIAL", "IN_REFEITORIO",
        "IN_ACESSIBILIDADE_RAMPAS", "IN_BANHEIRO_PNE",
        "IN_AGUA_POTAVEL", "IN_ALIMENTACAO",
        "IN_SALA_DIRETORIA", "IN_SALA_PROFESSOR",
    ]
    SALAS_COLS = ["QT_SALAS_UTILIZADAS", "QT_SALAS_UTILIZA_CLIMATIZADAS"]
    
    h = pd.read_csv(f_escola, sep=";", encoding="latin-1", nrows=0)
    id_cols = [c for c in ["CO_UF", "CO_ENTIDADE", "TP_DEPENDENCIA", "TP_SITUACAO_FUNCIONAMENTO"] if c in h.columns]
    avail_infra = [c for c in KEY_INFRA if c in h.columns]
    avail_salas = [c for c in SALAS_COLS if c in h.columns]
    
    df = pd.read_csv(f_escola, sep=";", encoding="latin-1", usecols=id_cols + avail_infra + avail_salas)
    df = df[(df["CO_UF"] == 43) & (df["TP_DEPENDENCIA"] == 2) & (df["TP_SITUACAO_FUNCIONAMENTO"] == 1)]
    
    # Short labels for JSON keys
    LABEL_MAP = {
        "IN_INTERNET": "internet", "IN_BANDA_LARGA": "banda_larga", "IN_COMPUTADOR": "computador",
        "IN_LABORATORIO_INFORMATICA": "lab_info", "IN_BIBLIOTECA": "biblioteca",
        "IN_BIBLIOTECA_SALA_LEITURA": "bib_sala_leit", "IN_LABORATORIO_CIENCIAS": "lab_ciencias",
        "IN_QUADRA_ESPORTES": "quadra", "IN_QUADRA_ESPORTES_COBERTA": "quadra_coberta",
        "IN_SALA_ATENDIMENTO_ESPECIAL": "sala_aee", "IN_REFEITORIO": "refeitorio",
        "IN_ACESSIBILIDADE_RAMPAS": "rampas", "IN_BANHEIRO_PNE": "banheiro_pne",
        "IN_AGUA_POTAVEL": "agua_potavel", "IN_ALIMENTACAO": "alimentacao",
        "IN_SALA_DIRETORIA": "sala_diretoria", "IN_SALA_PROFESSOR": "sala_professor",
    }
    
    result = {}
    for _, row in df.iterrows():
        eid = str(int(row["CO_ENTIDADE"]))
        entry = {}
        # Count how many infra items this school has
        total_items = 0
        has_items = 0
        for col in avail_infra:
            key = LABEL_MAP.get(col, col.lower())
            raw = row.get(col, 0)
            val = 0 if pd.isna(raw) else int(raw)
            entry[key] = val
            total_items += 1
            has_items += val
        # Salas / climatização
        raw_salas = row.get("QT_SALAS_UTILIZADAS", 0)
        raw_clim = row.get("QT_SALAS_UTILIZA_CLIMATIZADAS", 0)
        salas = 0 if pd.isna(raw_salas) else int(raw_salas)
        salas_clim = 0 if pd.isna(raw_clim) else int(raw_clim)
        entry['salas_total'] = salas
        entry['salas_clim'] = salas_clim
        entry['infra_score'] = round(has_items / total_items * 100, 0) if total_items > 0 else 0
        result[eid] = entry
    
    print(f"    -> {len(result)} escolas com infra 2025")
    return result

def load_docentes_by_school():
    """Load docente count per school from Censo 2025."""
    MICRO_DIR = os.path.join(BASE, "00. Bases de Dados", "01. Acesso e Matrículas (Censo Escolar_2010_2025)", "01. extrações_2010_2025")
    f_esc = os.path.join(MICRO_DIR, "Tabela_Escola_2025.csv")
    f_doc = os.path.join(MICRO_DIR, "Tabela_Docente_2025.csv")
    
    if not os.path.exists(f_doc) or not os.path.exists(f_esc):
        print("  Docentes: tabelas 2025 não encontradas")
        return {}
    
    print(f"  Docentes: lendo Tabela_Docente_2025...")
    
    # Get RS estadual schools
    h_esc = pd.read_csv(f_esc, sep=";", encoding="latin-1", nrows=0)
    esc_cols = [c for c in ["CO_UF", "CO_ENTIDADE", "TP_DEPENDENCIA", "TP_SITUACAO_FUNCIONAMENTO"] if c in h_esc.columns]
    df_esc = pd.read_csv(f_esc, sep=";", encoding="latin-1", usecols=esc_cols)
    df_esc = df_esc[(df_esc["CO_UF"] == 43) & (df_esc["TP_DEPENDENCIA"] == 2) & (df_esc["TP_SITUACAO_FUNCIONAMENTO"] == 1)]
    entidades_rs = set(df_esc["CO_ENTIDADE"].unique())
    
    # Read docente columns
    doc_cols_desired = [
        "CO_ENTIDADE",
        "QT_DOC_BAS", "QT_DOC_INF", "QT_DOC_FUND_AI", "QT_DOC_FUND_AF",
        "QT_DOC_MED", "QT_DOC_EJA", "QT_DOC_ESP",
        "QT_DOC_BAS_FEM", "QT_DOC_BAS_MASC",
        "QT_DOC_BAS_ESCO_SUP_GRAD", "QT_DOC_BAS_ESCO_SUP_GRAD_LICEN",
        "QT_DOC_BAS_VINCULO_CONCUR", "QT_DOC_BAS_VINCULO_CONTRA",
    ]
    h_doc = pd.read_csv(f_doc, sep=";", encoding="latin-1", nrows=0)
    doc_cols = [c for c in doc_cols_desired if c in h_doc.columns]
    df_doc = pd.read_csv(f_doc, sep=";", encoding="latin-1", usecols=doc_cols)
    df_doc = df_doc[df_doc["CO_ENTIDADE"].isin(entidades_rs)]
    
    def si(v): return 0 if pd.isna(v) else int(v)

    result = {}
    for _, row in df_doc.iterrows():
        eid = str(int(row["CO_ENTIDADE"]))
        entry = {
            'doc_total': si(row.get("QT_DOC_BAS", 0)),
            'doc_fund_ai': si(row.get("QT_DOC_FUND_AI", 0)),
            'doc_fund_af': si(row.get("QT_DOC_FUND_AF", 0)),
            'doc_medio': si(row.get("QT_DOC_MED", 0)),
            'doc_eja': si(row.get("QT_DOC_EJA", 0)),
            'doc_fem': si(row.get("QT_DOC_BAS_FEM", 0)),
            'doc_sup': si(row.get("QT_DOC_BAS_ESCO_SUP_GRAD", 0)),
            'doc_licen': si(row.get("QT_DOC_BAS_ESCO_SUP_GRAD_LICEN", 0)),
            'doc_concur': si(row.get("QT_DOC_BAS_VINCULO_CONCUR", 0)),
            'doc_contrat': si(row.get("QT_DOC_BAS_VINCULO_CONTRA", 0)),
        }
        result[eid] = entry
    
    print(f"    -> {len(result)} escolas com docentes 2025")
    return result

def load_fluxo_by_school():
    """Lê os arquivos tx_rend_escolas_YYYY.xlsx para puxar Aprov, Reprov, Abandono (2019-2025)."""
    result = {}
    base_dir = os.path.join(BASE, "00. Bases de Dados", "02. Fluxo e Rendimento (Inep_2010_2024_Rendimento_TDI)", "01. Rendimento e TDI")
    years = [2019, 2020, 2021, 2022, 2023, 2024, 2025]
    
    for year in years:
        filepath = os.path.join(base_dir, f"tx_rend_escolas_{year}.xlsx")
        if not os.path.exists(filepath):
            continue
            
        print(f"  Fluxo: lendo tx_rend_escolas_{year}.xlsx...")
        
        hrow = 8
        for h in [8, 5, 9, 7]:
            try:
                df = pd.read_excel(filepath, header=h, nrows=3, dtype=str)
                cols = [str(c) for c in df.columns]
                if any('NU_ANO_CENSO' in c or 'Ano' in c for c in cols) and any('CO_ENTIDADE' in c or 'Código da Escola' in c for c in cols):
                    hrow = h
                    break
            except:
                continue
                
        df = pd.read_excel(filepath, header=hrow, dtype=str)
        
        rename = {}
        for old, new in [('Código da Escola', 'CO_ENTIDADE'), ('SG_UF', 'UF')]:
            if old in df.columns and new not in df.columns:
                rename[old] = new
        if rename:
            df = df.rename(columns=rename)
            
        if 'UF' in df.columns:
            df = df[df['UF'] == 'RS']
        elif 'SG_UF' in df.columns:
            df = df[df['SG_UF'] == 'RS']

        for _, row in df.iterrows():
            eid = str(row.get('CO_ENTIDADE', '')).split('.')[0]
            if not eid or eid == 'nan':
                continue
                
            def safe_float(v):
                if pd.isna(v) or v == '--' or v == '' or v is None: return None
                try: return round(float(str(v).replace(',', '.')), 1)
                except: return None
                
            entry = {
                'aprov_fund': safe_float(row.get('1_CAT_FUN')),
                'aprov_med': safe_float(row.get('1_CAT_MED')),
                'reprov_fund': safe_float(row.get('2_CAT_FUN')),
                'reprov_med': safe_float(row.get('2_CAT_MED')),
                'aband_fund': safe_float(row.get('3_CAT_FUN')),
                'aband_med': safe_float(row.get('3_CAT_MED')),
            }
            if any(v is not None for v in entry.values()):
                if eid not in result:
                    result[eid] = {'fluxo_hist': {}}
                result[eid]['fluxo_hist'][str(year)] = entry
                
    print(f"    -> {len(result)} escolas com dados de fluxo histórico")
    return result

# ════════════════════════════════════════════════════
# 4. MAIN
# ════════════════════════════════════════════════════

def main():
    t0 = time.time()
    print("=" * 60)
    print("ETL ESCOLAS — Visão por Escola (Rede Estadual RS)")
    print("=" * 60)

    # Step 1: Load coordinate sources
    print("\n── 1. Carregando coordenadas ──")
    df_censo = load_censo_escolas()
    df_seduc = load_seduc_coords()
    df_censo['coord_fonte'] = ''

    # Step 2: Match coordinates
    print("\n── 2. Matching de coordenadas ──")
    df, stats = match_coordinates(df_censo, df_seduc)
    print(f"\n  📊 Relatório de Matching:")
    print(f"     Total escolas Censo:    {stats['total']}")
    print(f"     Com coordenadas Censo:  {stats['censo_ok']} ({100*stats['censo_ok']/stats['total']:.1f}%)")
    matched = stats['seduc_fill'] + stats['seduc_fallback']
    print(f"     Preenchidas via SEDUC:  {matched} ({100*matched/stats['total']:.1f}%)")
    print(f"       ├─ CRE match:        {stats['seduc_fill']}")
    print(f"       └─ nome único:       {stats['seduc_fallback']}")
    total_ok = stats['censo_ok'] + matched
    print(f"     Total com coordenadas:  {total_ok} ({100*total_ok/stats['total']:.1f}%)")
    print(f"     Sem match (sem coords): {stats['no_coords']}")

    # List schools without coordinates
    sem_coords = df[df['lat'].isna()]
    if len(sem_coords) > 0:
        print(f"\n  ⚠️  Escolas SEM coordenadas ({len(sem_coords)}):")
        for _, r in sem_coords.iterrows():
            print(f"     INEP={r['INEP']} | {r['Nome da Escola']} | Mun={r['Município']}")

    # Step 3: Load indicators
    print("\n── 3. Carregando indicadores por escola ──")
    saeb = load_saeb_by_school()
    ideb = load_ideb_by_school()
    inse = load_inse_by_school()
    icg = load_icg_by_school()
    tdi = load_tdi_by_school()
    saers = load_saers_by_school()
    fluxo = load_fluxo_by_school()
    matriculas = load_matriculas_by_school()
    infra_esc = load_infra_by_school()
    docentes_esc = load_docentes_by_school()
    censo_hist = load_censo_history_by_school()

    print("\n── 4. Mesclando Indicadores ──")
    
    # Merge 2025 into censo_hist
    for eid in censo_hist:
        if eid in matriculas and 'mat_total' in matriculas[eid]:
            censo_hist[eid]['mat_hist']['2025'] = matriculas[eid]['mat_total']
        if eid in docentes_esc and 'doc_total' in docentes_esc[eid]:
            censo_hist[eid]['doc_hist']['2025'] = docentes_esc[eid]['doc_total']

    print("\n── 4. Montando JSON ──")
    escolas = []
    for _, row in df.iterrows():
        inep = row['INEP']
        escola = {
            'inep': inep,
            'nome': row['Nome da Escola'],
            'municipio': row['Município'],
            'cod_mun': str(row['Cód. Município']),
            'cre': str(row['Cód. CRE']),
            'loc': row['Localização'],
            'salas': int(row['Salas Utilizadas']) if pd.notna(row.get('Salas Utilizadas')) else None,
        }
        # Coordinates
        if pd.notna(row['lat']):
            escola['lat'] = round(float(row['lat']), 6)
            escola['lng'] = round(float(row['lng']), 6)

        # Merge indicators
        if inep in saeb:
            escola.update(saeb[inep])
        if inep in ideb:
            escola.update(ideb[inep])
        if inep in inse:
            escola.update(inse[inep])
        if inep in icg:
            escola.update(icg[inep])
        if inep in tdi:
            escola.update(tdi[inep])
        if inep in matriculas:
            escola.update(matriculas[inep])
        if inep in fluxo:
            escola.update(fluxo[inep])
        if inep in saers:
            escola.update(saers[inep])
        if inep in infra_esc:
            escola.update(infra_esc[inep])
        if inep in docentes_esc:
            escola.update(docentes_esc[inep])
        if inep in censo_hist:
            escola.update(censo_hist[inep])

        escolas.append(escola)

    # Count indicators coverage
    total = len(escolas)
    with_coords = sum(1 for e in escolas if 'lat' in e)
    with_saeb = sum(1 for e in escolas if any(k.startswith('saeb_') for k in e))
    with_ideb = sum(1 for e in escolas if any(k.startswith('ideb_') for k in e))
    with_inse = sum(1 for e in escolas if 'inse_media' in e)
    with_icg = sum(1 for e in escolas if 'icg_nivel' in e)
    with_tdi = sum(1 for e in escolas if any(k.startswith('tdi_') for k in e))
    with_saers = sum(1 for e in escolas if any(k.startswith('saers_') for k in e))

    print(f"\n  📊 Cobertura de Indicadores:")
    print(f"     Total escolas:  {total}")
    print(f"     Com coordenadas: {with_coords} ({100*with_coords/total:.1f}%)")
    print(f"     SAEB 2023:      {with_saeb} ({100*with_saeb/total:.1f}%)")
    print(f"     SAERS Recente:  {with_saers} ({100*with_saers/total:.1f}%)")
    print(f"     IDEB 2023:      {with_ideb} ({100*with_ideb/total:.1f}%)")
    print(f"     INSE:           {with_inse} ({100*with_inse/total:.1f}%)")
    print(f"     ICG:            {with_icg} ({100*with_icg/total:.1f}%)")
    print(f"     TDI:            {with_tdi} ({100*with_tdi/total:.1f}%)")

    # Save JSON
    output = {
        'metadata': {
            'fonte': 'Censo Escolar 2025 + SEDUC RS + Microdados INEP',
            'gerado_em': pd.Timestamp.now().isoformat(),
            'total_escolas': total,
            'com_coordenadas': with_coords,
        },
        'escolas': escolas,
    }

    out_path = os.path.join(PAINEL_DIR, 'escolas_estaduais.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, separators=(',', ':'))
    size_kb = os.path.getsize(out_path) / 1024
    print(f"\n  ✅ JSON: {os.path.basename(out_path)} ({size_kb:.0f} KB)")

    # Step 5: Generate Excel tab
    print("\n── 5. Gerando aba Excel ──")
    planilha_path = os.path.join(BASE, 'painel', 'dados', 'planilha_municipios_rs.xlsx')
    if not os.path.exists(planilha_path):
        # Try other common names
        for name in ['planilha_central.xlsx', 'planilha_municipios.xlsx']:
            alt = os.path.join(BASE, 'painel', 'dados', name)
            if os.path.exists(alt):
                planilha_path = alt
                break

    # Build school dataframe for Excel
    df_excel = pd.DataFrame([{
        'Código INEP': e['inep'],
        'Nome da Escola': e['nome'],
        'Município': e['municipio'],
        'Cód. Município': e['cod_mun'],
        'CRE': e['cre'],
        'Localização': e['loc'],
        'Latitude': e.get('lat'),
        'Longitude': e.get('lng'),
        'Fonte Coordenada': 'Censo' if e.get('lat') and any(
            row['INEP'] == e['inep'] and pd.notna(row.get('Latitude'))
            for _, row in df[df['coord_fonte'] == 'Censo'].head(0).iterrows()
        ) else e.get('lat') and 'SEDUC' or 'Sem coordenada',
        'SAEB 5EF LP': e.get('saeb_5ef_lp'),
        'SAEB 5EF MT': e.get('saeb_5ef_mt'),
        'SAEB 9EF LP': e.get('saeb_9ef_lp'),
        'SAEB 9EF MT': e.get('saeb_9ef_mt'),
        'SAEB EM LP': e.get('saeb_em_lp'),
        'SAEB EM MT': e.get('saeb_em_mt'),
        'SAERS 9EF LP': e.get('saers_9ef_lp'),
        'SAERS 9EF MT': e.get('saers_9ef_mt'),
        'SAERS EM LP': e.get('saers_em_lp'),
        'SAERS EM MT': e.get('saers_em_mt'),
        'IDEB AI': e.get('ideb_ai'),
        'IDEB AF': e.get('ideb_af'),
        'IDEB EM': e.get('ideb_em'),
        'INSE Média': e.get('inse_media'),
        'INSE Nível': e.get('inse_nivel'),
        'ICG Nível': e.get('icg_nivel'),
        'TDI Fund': e.get('tdi_fund'),
        'TDI AI': e.get('tdi_ai'),
        'TDI AF': e.get('tdi_af'),
        'TDI Médio': e.get('tdi_med'),
        'Salas': e.get('salas'),
    } for e in escolas])

    # Simplify coord source
    for idx, row in df_excel.iterrows():
        inep = row['Código INEP']
        match = df[df['INEP'] == inep]
        if len(match) > 0:
            fonte = match.iloc[0].get('coord_fonte')
            if pd.notna(fonte):
                df_excel.at[idx, 'Fonte Coordenada'] = fonte
            elif pd.isna(row['Latitude']):
                df_excel.at[idx, 'Fonte Coordenada'] = 'Sem coordenada'

    # Save standalone Excel with school data
    escola_xlsx = os.path.join(PAINEL_DIR, 'escolas_estaduais_rs.xlsx')
    with pd.ExcelWriter(escola_xlsx, engine='openpyxl') as writer:
        df_excel.to_excel(writer, sheet_name='Escolas', index=False)
    size_kb = os.path.getsize(escola_xlsx) / 1024
    print(f"  ✅ Excel: {os.path.basename(escola_xlsx)} ({size_kb:.0f} KB)")

    print(f"\nTempo total: {time.time()-t0:.1f}s")
    print("═══ ETL Escolas concluído! ═══")

if __name__ == '__main__':
    main()
