"""
ETL — Taxa de Distorção Idade-Série (TDI)
Processa TDI_ESCOLAS de 2010 a 2025 e gera JSON para o painel.
Lida com 3 formatos heterogêneos do INEP:
  - 2010-2011: .xls com aba "Sul", header posicional
  - 2012-2018: .xlsx com colunas TDI_FUN/TDI_F14/TDI_F58/TDI_MED
  - 2019-2025: .xlsx com colunas FUN_CAT_0/FUN_AI_CAT_0/FUN_AF_CAT_0/MED_CAT_0
"""
import os, json, glob, re
import pandas as pd
import numpy as np


# --- caminhos portateis (repo Git + bases locais) ---
from paths import BASE, OUT_DIR, PAINEL_DIR, BASES_DIR, BASES_BASICAS  # noqa: E402


MICRO_DIR = os.path.join(BASE, '00. Bases de Dados',
    '02. Fluxo e Rendimento (Inep_2010_2024_Rendimento_TDI)', '01. Rendimento e TDI')

# Dependência administrativa mapping
DEP_MAP = {
    'Federal': 'federal',
    'Estadual': 'estadual',
    'Municipal': 'municipal',
    'Privada': 'privada',
}

# Columns we want in the final normalized frame:
# ano, cod_mun, dep, tdi_fund, tdi_ai, tdi_af, tdi_med
# Each sub-indicator is a %

def safe_float(v):
    """Convert a cell to float; return NaN for '--' or empty."""
    if v is None or v == '' or v == '--' or (isinstance(v, str) and v.strip() in ('--', '')):
        return np.nan
    try:
        return float(v)
    except (ValueError, TypeError):
        return np.nan

def load_2010_2011(year):
    """Load TDI from .xls files with regional sheets (aba 'Sul')."""
    patterns = [
        f'TDI ESCOLAS  {year}.xls',
        f'TDI ESCOLAS {year}.xls',
        f'tdi_escolas_{year}.xls',
    ]
    path = None
    for pat in patterns:
        p = os.path.join(MICRO_DIR, pat)
        if os.path.exists(p):
            path = p
            break
    if not path:
        print(f'  [SKIP] {year}: arquivo .xls não encontrado')
        return pd.DataFrame()

    print(f'  [{year}] Lendo {os.path.basename(path)} aba Sul...')
    df = pd.read_excel(path, sheet_name='Sul', engine='xlrd', header=None)

    # Data starts at row 8 (0-indexed). Row 6 has sub-headers.
    # Columns: 0=Ano, 1=Região, 2=UF, 3=Município, 4=CodMun, 5=CodEscola,
    #          6=NomeEscola, 7=Localização, 8=Rede,
    #          9-20=Fundamental (Total, AI, AF, 1-9 ano),
    #          21-25=Médio (Total, 1-4 série)
    data = df.iloc[8:].copy()
    data.columns = range(len(data.columns))

    # Filter RS
    data = data[data[2].astype(str).str.strip() == 'RS'].copy()
    data = data[data[4].notna()].copy()

    result = pd.DataFrame({
        'ano': year,
        'cod_mun': data[4].apply(lambda x: str(int(x))[:7] if pd.notna(x) else None),
        'dep': data[8].map(DEP_MAP),
        'tdi_fund': data[9].apply(safe_float),
        'tdi_ai': data[10].apply(safe_float),
        'tdi_af': data[11].apply(safe_float),
        'tdi_med': data[21].apply(safe_float) if 21 in data.columns else np.nan,
    })
    return result.dropna(subset=['cod_mun', 'dep'])

def load_2012_2018(year):
    """Load TDI from .xlsx files.
    2012-2014: positional columns (no code-name header row)
    2015-2018: header=8 with TDI_FUN/TDI_F14/TDI_F58/TDI_MED columns
    """
    patterns = [
        f'TDI_ESCOLAS_{year}.xlsx',
        f'tdi_escolas_{year}.xlsx',
    ]
    path = None
    for pat in patterns:
        p = os.path.join(MICRO_DIR, pat)
        if os.path.exists(p):
            path = p
            break
    if not path:
        print(f'  [SKIP] {year}: arquivo .xlsx não encontrado')
        return pd.DataFrame()

    print(f'  [{year}] Lendo {os.path.basename(path)}...')
    xl = pd.ExcelFile(path)
    sheet = xl.sheet_names[0]

    # Try loading with header=8
    df = pd.read_excel(path, sheet_name=sheet, header=8)

    # Check if we got proper column names or positional (2012-2014 have no code header)
    has_named_cols = any(c in df.columns for c in ['SG_UF', 'SIGLA', 'TDI_FUN', 'NU_ANO_CENSO'])

    if has_named_cols:
        # 2015-2018 format: named columns
        uf_col = 'SG_UF' if 'SG_UF' in df.columns else 'SIGLA'
        mun_col = 'CO_MUNICIPIO' if 'CO_MUNICIPIO' in df.columns else 'PK_COD_MUNICIPIO'
        dep_col = 'DEPENDAD' if 'DEPENDAD' in df.columns else 'Dependad'

        df = df[df[uf_col].astype(str).str.strip() == 'RS'].copy()

        # Column names for TDI
        tdi_ai_col = 'TDI_F14' if 'TDI_F14' in df.columns else 'TDI_AI'
        tdi_af_col = 'TDI_F58' if 'TDI_F58' in df.columns else 'TDI_AF'

        result = pd.DataFrame({
            'ano': year,
            'cod_mun': df[mun_col].apply(lambda x: str(int(x))[:7] if pd.notna(x) else None),
            'dep': df[dep_col].map(DEP_MAP),
            'tdi_fund': df['TDI_FUN'].apply(safe_float),
            'tdi_ai': df[tdi_ai_col].apply(safe_float),
            'tdi_af': df[tdi_af_col].apply(safe_float),
            'tdi_med': df['TDI_MED'].apply(safe_float),
        })
    else:
        # 2012-2014 format: positional columns (data starts at row 8, no code header)
        # Re-read with no header, skip first 8 rows
        df = pd.read_excel(path, sheet_name=sheet, header=None, skiprows=8)
        # Positional: 0=Ano, 1=Região, 2=UF, 3=Município, 4=CodMun,
        #   5=CodEscola, 6=NomeEscola, 7=Localização, 8=Rede,
        #   9=TDI_FUN, 10=TDI_AI, 11=TDI_AF, 12-20=séries,
        #   21=TDI_MED, 22-25=séries médio
        df = df[df[2].astype(str).str.strip() == 'RS'].copy()

        result = pd.DataFrame({
            'ano': year,
            'cod_mun': df[4].apply(lambda x: str(int(x))[:7] if pd.notna(x) else None),
            'dep': df[8].map(DEP_MAP),
            'tdi_fund': df[9].apply(safe_float),
            'tdi_ai': df[10].apply(safe_float),
            'tdi_af': df[11].apply(safe_float),
            'tdi_med': df[21].apply(safe_float) if 21 in df.columns else np.nan,
        })

    return result.dropna(subset=['cod_mun', 'dep'])

def load_2019_plus(year):
    """Load TDI from .xlsx with FUN_CAT_0/FUN_AI_CAT_0/FUN_AF_CAT_0/MED_CAT_0 columns.
    Also extracts per-series and per-location data."""
    patterns = [
        f'TDI_ESCOLAS_{year}.xlsx',
        f'tdi_escolas_{year}.xlsx',
    ]
    path = None
    for pat in patterns:
        p = os.path.join(MICRO_DIR, pat)
        if os.path.exists(p):
            path = p
            break
    if not path:
        print(f'  [SKIP] {year}: arquivo .xlsx não encontrado')
        return pd.DataFrame()

    print(f'  [{year}] Lendo {os.path.basename(path)}...')
    xl = pd.ExcelFile(path)
    sheet = xl.sheet_names[0]
    df = pd.read_excel(path, sheet_name=sheet, header=8)

    df = df[df['SG_UF'].astype(str).str.strip() == 'RS'].copy()

    result = pd.DataFrame({
        'ano': year,
        'cod_mun': df['CO_MUNICIPIO'].apply(lambda x: str(int(x))[:7] if pd.notna(x) else None),
        'dep': df['NO_DEPENDENCIA'].map(DEP_MAP),
        'loc': df['NO_CATEGORIA'].astype(str).str.strip() if 'NO_CATEGORIA' in df.columns else 'Total',
        'tdi_fund': df['FUN_CAT_0'].apply(safe_float),
        'tdi_ai': df['FUN_AI_CAT_0'].apply(safe_float),
        'tdi_af': df['FUN_AF_CAT_0'].apply(safe_float),
        'tdi_med': df['MED_CAT_0'].apply(safe_float),
    })

    # Per-series columns (1st-9th Fund, 1st-4th EM)
    SERIE_COLS = {
        'f1': 'FUN_01_CAT_0', 'f2': 'FUN_02_CAT_0', 'f3': 'FUN_03_CAT_0',
        'f4': 'FUN_04_CAT_0', 'f5': 'FUN_05_CAT_0', 'f6': 'FUN_06_CAT_0',
        'f7': 'FUN_07_CAT_0', 'f8': 'FUN_08_CAT_0', 'f9': 'FUN_09_CAT_0',
        'm1': 'MED_01_CAT_0', 'm2': 'MED_02_CAT_0', 'm3': 'MED_03_CAT_0',
        'm4': 'MED_04_CAT_0',
    }
    for key, col in SERIE_COLS.items():
        if col in df.columns:
            result[f'tdi_{key}'] = df[col].apply(safe_float)
        else:
            result[f'tdi_{key}'] = np.nan

    return result.dropna(subset=['cod_mun', 'dep'])

def aggregate_by_municipality(df_all, dep_filter=None):
    """
    Aggregate school-level TDI to municipality-level using median.
    Returns: { year: { cod_mun: { tdi_fund, tdi_ai, tdi_af, tdi_med, n_escolas, por_serie: {...} } } }
    """
    if dep_filter:
        df_all = df_all[df_all['dep'] == dep_filter].copy()

    SERIE_KEYS = ['tdi_f1','tdi_f2','tdi_f3','tdi_f4','tdi_f5','tdi_f6','tdi_f7','tdi_f8','tdi_f9',
                  'tdi_m1','tdi_m2','tdi_m3','tdi_m4']

    result = {}
    for ano, group in df_all.groupby('ano'):
        ano_str = str(ano)
        mun_data = {}
        for cod_mun, mun_group in group.groupby('cod_mun'):
            entry = {
                'tdi_fund': round(mun_group['tdi_fund'].median(), 1) if mun_group['tdi_fund'].notna().any() else None,
                'tdi_ai': round(mun_group['tdi_ai'].median(), 1) if mun_group['tdi_ai'].notna().any() else None,
                'tdi_af': round(mun_group['tdi_af'].median(), 1) if mun_group['tdi_af'].notna().any() else None,
                'tdi_med': round(mun_group['tdi_med'].median(), 1) if mun_group['tdi_med'].notna().any() else None,
                'n_escolas': int(len(mun_group)),
            }
            # Per-series
            por_serie = {}
            for sk in SERIE_KEYS:
                if sk in mun_group.columns and mun_group[sk].notna().any():
                    por_serie[sk.replace('tdi_', '')] = round(mun_group[sk].median(), 1)
            if por_serie:
                entry['por_serie'] = por_serie

            # Per-location
            if 'loc' in mun_group.columns:
                por_loc = {}
                for loc_name, loc_group in mun_group.groupby('loc'):
                    loc_key = loc_name.lower()
                    if loc_key in ('urbana', 'rural'):
                        fund_val = loc_group['tdi_fund'].median() if loc_group['tdi_fund'].notna().any() else None
                        ai_val = loc_group['tdi_ai'].median() if loc_group['tdi_ai'].notna().any() else None
                        af_val = loc_group['tdi_af'].median() if loc_group['tdi_af'].notna().any() else None
                        med_val = loc_group['tdi_med'].median() if loc_group['tdi_med'].notna().any() else None
                        por_loc[loc_key] = {
                            'tdi_fund': round(fund_val, 1) if fund_val is not None else None,
                            'tdi_ai': round(ai_val, 1) if ai_val is not None else None,
                            'tdi_af': round(af_val, 1) if af_val is not None else None,
                            'tdi_med': round(med_val, 1) if med_val is not None else None,
                        }
                if por_loc:
                    entry['por_loc'] = por_loc

            mun_data[cod_mun] = entry
        result[ano_str] = mun_data
    return result

def aggregate_state(df_all, dep_filter=None):
    """
    Aggregate all RS schools to a single state-level TDI per year.
    Uses median of school-level TDI. Includes per-series and per-location.
    """
    if dep_filter:
        df_all = df_all[df_all['dep'] == dep_filter].copy()

    SERIE_KEYS = ['tdi_f1','tdi_f2','tdi_f3','tdi_f4','tdi_f5','tdi_f6','tdi_f7','tdi_f8','tdi_f9',
                  'tdi_m1','tdi_m2','tdi_m3','tdi_m4']

    result = {}
    for ano, group in df_all.groupby('ano'):
        ano_str = str(ano)
        entry = {
            'tdi_fund': round(group['tdi_fund'].median(), 1) if group['tdi_fund'].notna().any() else None,
            'tdi_ai': round(group['tdi_ai'].median(), 1) if group['tdi_ai'].notna().any() else None,
            'tdi_af': round(group['tdi_af'].median(), 1) if group['tdi_af'].notna().any() else None,
            'tdi_med': round(group['tdi_med'].median(), 1) if group['tdi_med'].notna().any() else None,
            'n_escolas': int(group['tdi_fund'].notna().sum()),
        }

        # Per-series
        por_serie = {}
        for sk in SERIE_KEYS:
            if sk in group.columns and group[sk].notna().any():
                por_serie[sk.replace('tdi_', '')] = round(group[sk].median(), 1)
        if por_serie:
            entry['por_serie'] = por_serie

        # Per-location
        if 'loc' in group.columns:
            por_loc = {}
            for loc_name, loc_group in group.groupby('loc'):
                loc_key = loc_name.lower()
                if loc_key in ('urbana', 'rural'):
                    fund_val = loc_group['tdi_fund'].median() if loc_group['tdi_fund'].notna().any() else None
                    ai_val = loc_group['tdi_ai'].median() if loc_group['tdi_ai'].notna().any() else None
                    af_val = loc_group['tdi_af'].median() if loc_group['tdi_af'].notna().any() else None
                    med_val = loc_group['tdi_med'].median() if loc_group['tdi_med'].notna().any() else None
                    por_loc[loc_key] = {
                        'tdi_fund': round(fund_val, 1) if fund_val is not None else None,
                        'tdi_ai': round(ai_val, 1) if ai_val is not None else None,
                        'tdi_af': round(af_val, 1) if af_val is not None else None,
                        'tdi_med': round(med_val, 1) if med_val is not None else None,
                    }
            if por_loc:
                entry['por_loc'] = por_loc

        result[ano_str] = entry
    return result

def build_lookup(df_all):
    """Build municipality name lookup from the data."""
    # We need municipality names — try the 2025 municipal file
    mun_file = os.path.join(MICRO_DIR, 'TDI_MUNICIPIOS_2025.xlsx')
    lookup = {}
    if os.path.exists(mun_file):
        df = pd.read_excel(mun_file, sheet_name=0, header=8)
        rs = df[df['SG_UF'] == 'RS']
        for _, row in rs.iterrows():
            cod = str(int(row['CO_MUNICIPIO']))[:7]
            nome = row['NO_MUNICIPIO']
            if cod not in lookup and pd.notna(nome):
                lookup[cod] = nome
    return lookup

def build_json(df_all, dep_filter, rede_name):
    """Build full JSON for a given rede."""
    state = aggregate_state(df_all, dep_filter)
    mun = aggregate_by_municipality(df_all, dep_filter)
    lookup = build_lookup(df_all)

    return {
        'serie_temporal': state,
        'por_municipio': mun,
        'lookup_municipios': lookup,
    }

def main():
    print('═══ ETL TDI — Distorção Idade-Série ═══')
    print(f'Diretório: {MICRO_DIR}')

    # Load all years
    frames = []

    # 2010-2011: .xls with "Sul" sheet
    for year in [2010, 2011]:
        df = load_2010_2011(year)
        if len(df):
            frames.append(df)
            print(f'    → {len(df)} escolas RS')

    # 2012-2018: .xlsx with TDI_* columns
    for year in range(2012, 2019):
        df = load_2012_2018(year)
        if len(df):
            frames.append(df)
            print(f'    → {len(df)} escolas RS')

    # 2019-2025: .xlsx with FUN_CAT_0 columns
    for year in range(2019, 2026):
        df = load_2019_plus(year)
        if len(df):
            frames.append(df)
            print(f'    → {len(df)} escolas RS')

    if not frames:
        print('ERRO: Nenhum dado encontrado!')
        return

    df_all = pd.concat(frames, ignore_index=True)
    print(f'\nTotal: {len(df_all)} registros, anos {df_all["ano"].min()}-{df_all["ano"].max()}')
    print(f'Dependências: {df_all["dep"].value_counts().to_dict()}')

    # Generate JSON per rede
    redes = {
        'estadual': 'estadual',
        'municipal': 'municipal',
        'federal': 'federal',
        'privada': 'privada',
        'todas': None,  # None = sem filtro
    }

    for rede_key, dep_filter in redes.items():
        data = build_json(df_all, dep_filter, rede_key)
        anos_with_data = [a for a, v in data['serie_temporal'].items() if v.get('tdi_fund') is not None]
        filename = f'4_10_tdi_{rede_key}.json'
        filepath = os.path.join(OUT_DIR, filename)
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        size_kb = os.path.getsize(filepath) / 1024
        print(f'  ✅ {filename} ({size_kb:.0f} KB) — {len(anos_with_data)} anos com dados')

    # Also save compat symlink
    import shutil
    src = os.path.join(OUT_DIR, '4_10_tdi_estadual.json')
    dst = os.path.join(OUT_DIR, '4_10_tdi.json')
    shutil.copy2(src, dst)
    print(f'  ✅ 4_10_tdi.json (cópia do estadual)')

    print('\n═══ ETL TDI concluído! ═══')

if __name__ == '__main__':
    main()
