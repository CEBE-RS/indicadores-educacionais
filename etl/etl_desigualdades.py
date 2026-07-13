import pandas as pd
import json, os, time, unicodedata, re


# --- caminhos portateis (repo Git + bases locais) ---
from paths import BASE, OUT_DIR, PAINEL_DIR, BASES_DIR, BASES_BASICAS  # noqa: E402


SAERS_DIR = os.path.join(BASE, '00. Bases de Dados', '10, SAERS')

YEARS = [2022, 2023, 2024, 2025]

# Columns needed
COLS = [
    'CD_ESCOLA', 'NM_ESCOLA', 'CD_MUNICIPIO', 'NM_MUNICIPIO',
    'CD_REGIONAL', 'NM_REGIONAL', 'CD_REDE', 'DC_REDE',
    'CD_ETAPA_AVALIADA', 'DC_ETAPA_AVALIADA',
    'NM_DISCIPLINA', 'VL_PROFICIENCIA', 'DC_PADRAO_DESEMPENHO',
    'FL_AVALIADO', 'FL_PREVISTO',
    'DC_COR_RACA', 'DC_RACA', 'DC_SEXO', 'DC_ALUNO_NEC_ESPECIAL', 'TIPO_DEFICIENCIA', 'DC_LOCALIZACAO', 'DC_TURNO'
]

# Normalizers (same as etl_saers.py)
def norm_etapa(s):
    if pd.isna(s): return ''
    s = str(s).strip()
    s = unicodedata.normalize('NFKD', s)
    s = re.sub(r'[^\x00-\x7F]', '', s).upper().strip()
    if '2' in s and 'ANO' in s: return '2_EF'
    if '5' in s and 'ANO' in s: return '5_EF'
    if '9' in s and 'ANO' in s: return '9_EF'
    if '3' in s and ('SERIE' in s or 'SRI' in s): return '3_EM'
    return s

def norm_disc(s):
    if pd.isna(s): return ''
    s = unicodedata.normalize('NFKD', str(s))
    s = re.sub(r'[^\x00-\x7F]', '', s).strip().upper()
    if 'PORT' in s or 'LINGU' in s: return 'LP'
    if 'MAT' in s: return 'MT'
    return s

PADRAO_MAP = {
    'AVANÇADO': 'avancado', 'AVANCADO': 'avancado',
    'ADEQUADO': 'adequado',
    'BÁSICO': 'basico', 'BASICO': 'basico',
    'ABAIXO DO BÁSICO': 'abaixo', 'ABAIXO DO BASICO': 'abaixo',
}

def norm_padrao(s):
    if pd.isna(s): return None
    s = unicodedata.normalize('NFKD', str(s))
    s = re.sub(r'[^\x00-\x7F]', '', s).strip().upper()
    return PADRAO_MAP.get(s, None)

def norm_deficiencia(s):
    if pd.isna(s): return 'Sem Deficiência'
    s = str(s).strip()
    if s in ['', '*']: return 'Sem Deficiência'
    return 'Com Deficiência'

def norm_raca(s):
    if pd.isna(s): return None
    s = str(s).strip().strip('"')
    su = s.upper()
    if 'IND' in su: return 'Indígena'
    if 'BRANC' in su: return 'Branca'
    if 'PARD' in su: return 'Parda'
    if 'PRET' in su: return 'Preta'
    if 'AMAREL' in su: return 'Amarela'
    return None

def norm_sexo(s):
    if pd.isna(s): return None
    s = str(s).strip().strip('"')
    su = s.upper()
    if su == 'FEMININO': return 'Feminino'
    if su == 'MASCULINO': return 'Masculino'
    return None

def norm_loc(s):
    if pd.isna(s): return None
    s = str(s).strip().strip('"')
    su = s.upper()
    if su == 'URBANA': return 'Urbana'
    if su == 'RURAL': return 'Rural'
    return None

def norm_turno(s):
    if pd.isna(s): return None
    s = str(s).strip().strip('"')
    su = s.upper()
    if 'MANH' in su: return 'Manhã'
    if su == 'TARDE': return 'Tarde'
    if su == 'NOITE': return 'Noite'
    if su == 'INTEGRAL': return 'Integral'
    return None

def aggregate_subset(df_sub):
    total = len(df_sub)
    if total == 0: return None
    
    with_prof = df_sub.dropna(subset=['VL_PROFICIENCIA'])
    n = len(with_prof)
    prof_media = round(float(with_prof['VL_PROFICIENCIA'].mean()), 1) if n > 0 else None
    
    with_padrao = df_sub.dropna(subset=['padrao_norm'])
    np_total = len(with_padrao)
    padrao = {}
    if np_total > 0:
        for p in ['avancado', 'adequado', 'basico', 'abaixo']:
            padrao[p] = int((with_padrao['padrao_norm'] == p).sum())
        padrao['pct_adequado_avancado'] = round((padrao['avancado'] + padrao['adequado']) / np_total * 100, 1)
        padrao['pct_basico'] = round(padrao['basico'] / np_total * 100, 1)
        padrao['pct_abaixo'] = round(padrao['abaixo'] / np_total * 100, 1)
        
    if prof_media is None and np_total == 0:
        return None
        
    return {
        'n': total,
        'n_padrao': np_total,
        'media': prof_media,
        'pct_adeq_av': padrao.get('pct_adequado_avancado', None),
        'padrao': padrao
    }

def aggregate_dimensoes(g):
    dims = {}
    
    # 1. Sexo
    if 'sexo' in g.columns and g['sexo'].notna().any():
        dims['sexo'] = {}
        for k, sub in g.groupby('sexo'):
            res = aggregate_subset(sub)
            if res: dims['sexo'][k] = res
            
    # 2. Raca
    if 'raca' in g.columns and g['raca'].notna().any():
        dims['raca'] = {}
        for k, sub in g.groupby('raca'):
            res = aggregate_subset(sub)
            if res: dims['raca'][k] = res
            
    # 3. Deficiencia
    if 'deficiencia' in g.columns and g['deficiencia'].notna().any():
        dims['deficiencia'] = {}
        for k, sub in g.groupby('deficiencia'):
            res = aggregate_subset(sub)
            if res: dims['deficiencia'][k] = res
            
    # 4. Localizacao
    if 'loc' in g.columns and g['loc'].notna().any():
        dims['localizacao'] = {}
        for k, sub in g.groupby('loc'):
            res = aggregate_subset(sub)
            if res: dims['localizacao'][k] = res
            
    # 5. Turno
    if 'turno' in g.columns and g['turno'].notna().any():
        dims['turno'] = {}
        for k, sub in g.groupby('turno'):
            res = aggregate_subset(sub)
            if res: dims['turno'][k] = res

    # 6. Intersecao Raca x Loc
    if 'raca' in g.columns and 'loc' in g.columns:
        valid = g.dropna(subset=['raca', 'loc'])
        if len(valid) > 0:
            dims['raca_loc'] = {}
            for (r, l), sub in valid.groupby(['raca', 'loc']):
                res = aggregate_subset(sub)
                if res: dims['raca_loc'][f"{r} - {l}"] = res

    # 7. Intersecao Raca x Sexo
    if 'raca' in g.columns and 'sexo' in g.columns:
        valid = g.dropna(subset=['raca', 'sexo'])
        if len(valid) > 0:
            dims['raca_sexo'] = {}
            for (r, s), sub in valid.groupby(['raca', 'sexo']):
                res = aggregate_subset(sub)
                if res: dims['raca_sexo'][f"{r} - {s}"] = res

    return dims if dims else None

def aggregate_dimensoes_simple(g):
    """Simplified version for escola-level: no cross-dimensional groupings (raça×sexo, raça×loc)
    to avoid exponential explosion with ~2500 schools × 8 etapa/disc combos."""
    dims = {}
    for col_name, dim_name in [('sexo','sexo'), ('raca','raca'), ('deficiencia','deficiencia'), ('loc','localizacao'), ('turno','turno')]:
        if col_name in g.columns and g[col_name].notna().any():
            dims[dim_name] = {}
            for k, sub in g.groupby(col_name):
                res = aggregate_subset(sub)
                if res: dims[dim_name][k] = res
    return dims if dims else None

def rearrange_dimensoes(dim_list):
    """
    dim_list is a list of dicts: [{'etapa':'...', 'disc':'...', 'dims': {...}}, ...]
    We want to transpose it to:
    {
      'sexo': { 'Feminino': {'5_EF_LP': {...}, ...}, ...},
      'raca': { 'Branca': {'5_EF_LP': {...}, ...}, ...},
      ...
    }
    """
    res = {}
    for item in dim_list:
        key = f"{item['etapa']}_{item['disc']}"
        dims = item['dims']
        if not dims: continue
        for dim_name, dim_groups in dims.items():
            if dim_name not in res: res[dim_name] = {}
            for group_name, stats in dim_groups.items():
                if group_name not in res[dim_name]: res[dim_name][group_name] = {}
                res[dim_name][group_name][key] = stats
    return res

def process_year(year):
    # Try multiple filename patterns
    candidates = [
        os.path.join(SAERS_DIR, f'Microdados_SAERS_{year}_V3.csv'),
        os.path.join(SAERS_DIR, f'SAERS_{year}.csv'),
    ]
    fname = None
    for c in candidates:
        if os.path.exists(c):
            fname = c
            break
    if not fname: return None
    print(f"Loading {year} from {os.path.basename(fname)}...", flush=True)
    
    enc = 'latin-1'
    def usecol_filter(c):
        return c.strip().strip('\ufeff').strip('\xef\xbb\xbf') in COLS
        
    df = pd.read_csv(fname, sep=';', encoding=enc, low_memory=False, usecols=usecol_filter)
    df.columns = [c.strip().strip('\ufeff').strip('\xef\xbb\xbf') for c in df.columns]
    
    # Filter state network only (assuming Desigualdades is mainly Estadual, wait, Produto 4 is usually State network)
    # Actually, we should filter for ESTADUAL network
    if 'DC_REDE' in df.columns:
        df['rede_norm'] = df['DC_REDE'].astype(str).str.strip().str.upper()
        df = df[df['rede_norm'] == 'ESTADUAL']
    
    df['etapa'] = df.get('DC_ETAPA_AVALIADA', pd.Series(dtype=str)).apply(norm_etapa)
    df['disc'] = df.get('NM_DISCIPLINA', pd.Series(dtype=str)).apply(norm_disc)
    df['padrao_norm'] = df.get('DC_PADRAO_DESEMPENHO', pd.Series(dtype=str)).apply(norm_padrao)
    
    if 'VL_PROFICIENCIA' in df.columns:
        df['VL_PROFICIENCIA'] = df['VL_PROFICIENCIA'].astype(str).str.replace(',', '.', regex=False)
        df['VL_PROFICIENCIA'] = pd.to_numeric(df['VL_PROFICIENCIA'], errors='coerce')
    else:
        df['VL_PROFICIENCIA'] = np.nan
        
    if 'DC_SEXO' in df.columns: df['sexo'] = df['DC_SEXO'].apply(norm_sexo)
    if 'DC_COR_RACA' in df.columns: df['raca'] = df['DC_COR_RACA'].apply(norm_raca)
    elif 'DC_RACA' in df.columns: df['raca'] = df['DC_RACA'].apply(norm_raca)
    
    if 'DC_ALUNO_NEC_ESPECIAL' in df.columns: df['deficiencia'] = df['DC_ALUNO_NEC_ESPECIAL'].apply(norm_deficiencia)
    elif 'TIPO_DEFICIENCIA' in df.columns: df['deficiencia'] = df['TIPO_DEFICIENCIA'].apply(norm_deficiencia)
    
    if 'DC_LOCALIZACAO' in df.columns: df['loc'] = df['DC_LOCALIZACAO'].apply(norm_loc)
    if 'DC_TURNO' in df.columns: df['turno'] = df['DC_TURNO'].apply(norm_turno)
    
    # Drop rows without etapa or disc
    df = df[(df['etapa'] != '') & (df['disc'] != '')]
    
    result = {'ano': year, 'total_registros': len(df)}
    
    # GERAL (Estado)
    print("  Aggregating State...", flush=True)
    geral = {}
    dim_list = []
    for (etapa, disc), g in df.groupby(['etapa', 'disc']):
        key = f"{etapa}_{disc}"
        res = aggregate_subset(g)
        if res:
            res['etapa'] = etapa
            res['disc'] = disc
            geral[key] = res
        dims = aggregate_dimensoes(g)
        if dims:
            dim_list.append({'etapa': etapa, 'disc': disc, 'dims': dims})
    result['geral'] = geral
    result['dimensoes'] = rearrange_dimensoes(dim_list)
    
    # CRE
    print("  Aggregating CRE...", flush=True)
    por_cre = {}
    cre_lookup = {}
    if 'CD_REGIONAL' in df.columns:
        for (cod, etapa, disc), g in df.groupby(['CD_REGIONAL', 'etapa', 'disc']):
            cod = str(cod).strip()
            if cod not in por_cre:
                por_cre[cod] = {'geral': {}, 'dimensoes': {}}
                nome = g['NM_REGIONAL'].iloc[0] if 'NM_REGIONAL' in g.columns and len(g) > 0 else ''
                cre_lookup[cod] = nome
            res = aggregate_subset(g)
            if res:
                por_cre[cod]['geral'][f"{etapa}_{disc}"] = res
            
            # Dimensions for CRE
            dims = aggregate_dimensoes(g)
            if dims:
                if not por_cre[cod]['dimensoes']: por_cre[cod]['dimensoes'] = []
                por_cre[cod]['dimensoes'].append({'etapa': etapa, 'disc': disc, 'dims': dims})
                
        for cod in por_cre:
            if por_cre[cod]['dimensoes']:
                por_cre[cod]['dimensoes'] = rearrange_dimensoes(por_cre[cod]['dimensoes'])
            else:
                por_cre[cod]['dimensoes'] = {}
                
    result['por_cre'] = por_cre
    result['cre_lookup'] = cre_lookup
    
    # Municipio
    print("  Aggregating Municipio...", flush=True)
    por_mun = {}
    if 'CD_MUNICIPIO' in df.columns:
        for (cod, etapa, disc), g in df.groupby(['CD_MUNICIPIO', 'etapa', 'disc']):
            cod = str(cod).strip()
            if cod not in por_mun:
                por_mun[cod] = {'geral': {}, 'dimensoes': {}}
            res = aggregate_subset(g)
            if res:
                por_mun[cod]['geral'][f"{etapa}_{disc}"] = res
                
            dims = aggregate_dimensoes(g)
            if dims:
                if not por_mun[cod]['dimensoes']: por_mun[cod]['dimensoes'] = []
                por_mun[cod]['dimensoes'].append({'etapa': etapa, 'disc': disc, 'dims': dims})
                
        for cod in por_mun:
            if por_mun[cod]['dimensoes']:
                por_mun[cod]['dimensoes'] = rearrange_dimensoes(por_mun[cod]['dimensoes'])
            else:
                por_mun[cod]['dimensoes'] = {}
    result['por_municipio'] = por_mun
    
    # Escola
    print("  Aggregating Escola...", flush=True)
    por_esc = {}
    escola_lookup = {}
    if 'CD_ESCOLA' in df.columns:
        for (cod, etapa, disc), g in df.groupby(['CD_ESCOLA', 'etapa', 'disc']):
            cod = str(cod).strip()
            if cod not in por_esc:
                por_esc[cod] = {'geral': {}, 'dimensoes': {}}
                nome = g['NM_ESCOLA'].iloc[0] if 'NM_ESCOLA' in g.columns and len(g) > 0 else ''
                cod_mun = str(g['CD_MUNICIPIO'].iloc[0]).strip() if 'CD_MUNICIPIO' in g.columns and len(g) > 0 else ''
                cod_cre = str(g['CD_REGIONAL'].iloc[0]).strip() if 'CD_REGIONAL' in g.columns and len(g) > 0 else ''
                escola_lookup[cod] = {'nome': str(nome).strip(), 'cod_mun': cod_mun, 'cre': cod_cre}
            res = aggregate_subset(g)
            if res:
                por_esc[cod]['geral'][f"{etapa}_{disc}"] = res
                
            dims = aggregate_dimensoes_simple(g)
            if dims:
                if not por_esc[cod]['dimensoes']: por_esc[cod]['dimensoes'] = []
                por_esc[cod]['dimensoes'].append({'etapa': etapa, 'disc': disc, 'dims': dims})
                
        for cod in por_esc:
            if por_esc[cod]['dimensoes']:
                por_esc[cod]['dimensoes'] = rearrange_dimensoes(por_esc[cod]['dimensoes'])
            else:
                por_esc[cod]['dimensoes'] = {}
    result['por_escola'] = por_esc
    result['escola_lookup'] = escola_lookup
    
    return result

def main():
    t0 = time.time()
    anos_data = []
    for y in YEARS:
        res = process_year(y)
        if res: anos_data.append(res)
        
    out_path = os.path.join(OUT_DIR, '4_11_desigualdades.json')
    os.makedirs(OUT_DIR, exist_ok=True)
    
    meta = {'fonte': 'SAERS/CAED - Microdados da Avaliação do Estado do Rio Grande do Sul', 'etapa_labels': {'2_EF': '2º ano EF', '5_EF': '5º ano EF', '9_EF': '9º ano EF', '3_EM': '3ª série EM'}}
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump({'metadata': meta, 'anos': anos_data}, f, ensure_ascii=False, separators=(',', ':'))
        
    print(f"Done in {time.time()-t0:.1f}s. Saved to {out_path}")

if __name__ == '__main__':
    main()
