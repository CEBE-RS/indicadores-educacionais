#!/usr/bin/env python3
"""
ETL SAERS — Avaliação Estadual do Rio Grande do Sul
Processa SAERS_2022.csv a SAERS_2025.csv (nível aluno → escola/município/CRE/estado)
Gera: painel/dados/4_saers.json
"""

import pandas as pd
import json, os, time, unicodedata, re


# --- caminhos portateis (repo Git + bases locais) ---
from paths import BASE, OUT_DIR, PAINEL_DIR, BASES_DIR, BASES_BASICAS  # noqa: E402

OUT = os.path.join(OUT_DIR, '4_saers.json')


SAERS_DIR = os.path.join(BASE, '00. Bases de Dados', '10, SAERS')

YEARS = [2022, 2023, 2024, 2025]

COLS = [
    'CD_ESCOLA', 'NM_ESCOLA', 'CD_MUNICIPIO', 'NM_MUNICIPIO',
    'CD_REGIONAL', 'NM_REGIONAL', 'CD_REDE', 'DC_REDE',
    'CD_ETAPA_AVALIADA', 'DC_ETAPA_AVALIADA',
    'NM_DISCIPLINA', 'VL_PROFICIENCIA', 'DC_PADRAO_DESEMPENHO',
    'FL_AVALIADO', 'FL_PREVISTO',
]

# Normalize etapa names (encoding issues between years)
def norm_etapa(s):
    if pd.isna(s): return ''
    s = str(s).strip()
    s = unicodedata.normalize('NFKD', s)
    s = re.sub(r'[^\x00-\x7F]', '', s)  # remove accents
    s = s.upper().strip()
    if '2' in s and 'ANO' in s: return '2_EF'
    if '5' in s and 'ANO' in s: return '5_EF'
    if '9' in s and 'ANO' in s: return '9_EF'
    if '3' in s and ('SERIE' in s or 'SRI' in s): return '3_EM'
    return s

ETAPA_LABELS = {
    '2_EF': '2º ano EF',
    '5_EF': '5º ano EF',
    '9_EF': '9º ano EF',
    '3_EM': '3ª série EM',
}

def norm_disc(s):
    if pd.isna(s): return ''
    s = unicodedata.normalize('NFKD', str(s))
    s = re.sub(r'[^\x00-\x7F]', '', s).strip().upper()
    if 'PORT' in s or 'LINGU' in s: return 'LP'
    if 'MAT' in s: return 'MT'
    return s

DISC_LABELS = {'LP': 'Língua Portuguesa', 'MT': 'Matemática'}

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

def aggregate(df_group):
    """Calculate stats for a group"""
    total = len(df_group)
    avaliados = int(df_group['FL_AVALIADO'].sum())
    previstos = int(df_group['FL_PREVISTO'].sum())
    
    # Only consider rows with proficiency
    with_prof = df_group.dropna(subset=['VL_PROFICIENCIA'])
    n = len(with_prof)
    prof_media = round(float(with_prof['VL_PROFICIENCIA'].mean()), 1) if n > 0 else None
    
    # Padrão distribution (only rows with valid padrão)
    with_padrao = df_group.dropna(subset=['padrao_norm'])
    np_total = len(with_padrao)
    padrao = {}
    if np_total > 0:
        for p in ['avancado', 'adequado', 'basico', 'abaixo']:
            cnt = int((with_padrao['padrao_norm'] == p).sum())
            padrao[p] = cnt
        # Percentages
        padrao['pct_adequado_avancado'] = round((padrao['avancado'] + padrao['adequado']) / np_total * 100, 1)
    
    return {
        'alunos': total,
        'avaliados': avaliados,
        'previstos': previstos,
        'n_proficiencia': n,
        'proficiencia': prof_media,
        'padrao': padrao,
    }

def load_year(year):
    """Load and normalize one SAERS year file. Returns full DataFrame."""
    # Try multiple filename patterns (V3 takes priority)
    candidates = [
        os.path.join(SAERS_DIR, f'Microdados_SAERS_{year}_V3.csv'),
        os.path.join(SAERS_DIR, f'SAERS_{year}.csv'),
    ]
    fname = None
    for c in candidates:
        if os.path.exists(c):
            fname = c
            break
    if not fname:
        print(f"  [SKIP] No file found for {year}")
        return None
    
    t0 = time.time()
    print(f"  Loading {year} from {os.path.basename(fname)}...", end=' ')
    
    enc = 'latin-1'
    header = pd.read_csv(fname, sep=';', encoding=enc, nrows=0)
    header.columns = [c.strip().strip('\ufeff').strip('\xef\xbb\xbf') for c in header.columns]
    
    available = set(header.columns)
    use = [c for c in COLS if c in available]
    missing = set(COLS) - available
    if missing:
        print(f"(missing cols: {missing})", end=' ')
    
    df = pd.read_csv(fname, sep=';', encoding=enc, low_memory=False)
    df.columns = [c.strip().strip('\ufeff').strip('\xef\xbb\xbf') for c in df.columns]
    df = df[[c for c in use if c in df.columns]]
    
    for c in COLS:
        if c not in df.columns:
            df[c] = '' if c in ['CD_REDE', 'DC_REDE'] else None
    
    print(f"{len(df):,} rows in {time.time()-t0:.1f}s")
    
    # Normalize
    df['etapa'] = df['DC_ETAPA_AVALIADA'].apply(norm_etapa)
    df['disc'] = df['NM_DISCIPLINA'].apply(norm_disc)
    df['padrao_norm'] = df['DC_PADRAO_DESEMPENHO'].apply(norm_padrao)
    df['VL_PROFICIENCIA'] = df['VL_PROFICIENCIA'].astype(str).str.replace(',', '.', regex=False)
    df['VL_PROFICIENCIA'] = pd.to_numeric(df['VL_PROFICIENCIA'], errors='coerce')
    df['FL_AVALIADO'] = pd.to_numeric(df['FL_AVALIADO'], errors='coerce').fillna(0).astype(int)
    df['FL_PREVISTO'] = pd.to_numeric(df['FL_PREVISTO'], errors='coerce').fillna(0).astype(int)
    df['CD_ESCOLA'] = df['CD_ESCOLA'].astype(str).str.strip()
    df['CD_MUNICIPIO'] = df['CD_MUNICIPIO'].astype(str).str.strip()
    df['CD_REGIONAL'] = df['CD_REGIONAL'].astype(str).str.strip()
    df['rede_norm'] = df['DC_REDE'].astype(str).str.strip().str.upper()
    
    return df

def aggregate_df(df, year, include_escolas=False):
    """Aggregate a (possibly filtered) DataFrame into the year result dict."""
    result = {
        'ano': year,
        'total_alunos': len(df),
        'total_avaliados': int(df['FL_AVALIADO'].sum()),
    }
    
    # 1. Estado geral
    geral = {}
    for (etapa, disc), g in df.groupby(['etapa', 'disc']):
        if not etapa or not disc: continue
        key = f"{etapa}_{disc}"
        geral[key] = aggregate(g)
        geral[key]['etapa'] = etapa
        geral[key]['disc'] = disc
    result['geral'] = geral
    
    # 2. Por município
    por_municipio = {}
    mun_lookup = {}
    for (cod_mun, etapa, disc), g in df.groupby(['CD_MUNICIPIO', 'etapa', 'disc']):
        if not etapa or not disc: continue
        if cod_mun not in por_municipio:
            por_municipio[cod_mun] = {}
            nome = g['NM_MUNICIPIO'].iloc[0] if len(g) > 0 else ''
            mun_lookup[cod_mun] = nome
        key = f"{etapa}_{disc}"
        por_municipio[cod_mun][key] = aggregate(g)
    result['por_municipio'] = por_municipio
    result['mun_lookup'] = mun_lookup
    
    # 3. Por CRE
    por_cre = {}
    cre_lookup = {}
    for (cod_cre, etapa, disc), g in df.groupby(['CD_REGIONAL', 'etapa', 'disc']):
        if not etapa or not disc: continue
        if cod_cre not in por_cre:
            por_cre[cod_cre] = {}
            nome = g['NM_REGIONAL'].iloc[0] if len(g) > 0 else ''
            cre_lookup[cod_cre] = nome
        key = f"{etapa}_{disc}"
        por_cre[cod_cre][key] = aggregate(g)
    result['por_cre'] = por_cre
    result['cre_lookup'] = cre_lookup
    
    # 4. Por escola (optional)
    if include_escolas:
        por_escola = {}
        escola_lookup = {}
        for (cod_esc, etapa, disc), g in df.groupby(['CD_ESCOLA', 'etapa', 'disc']):
            if not etapa or not disc: continue
            cod_esc = str(cod_esc).strip()
            if cod_esc not in por_escola:
                por_escola[cod_esc] = {}
                nome = g['NM_ESCOLA'].iloc[0] if len(g) > 0 else ''
                cod_mun = str(g['CD_MUNICIPIO'].iloc[0]).strip() if len(g) > 0 else ''
                cod_cre = str(g['CD_REGIONAL'].iloc[0]).strip() if len(g) > 0 else ''
                escola_lookup[cod_esc] = {'nome': nome, 'cod_mun': cod_mun, 'cre': cod_cre}
            key = f"{etapa}_{disc}"
            por_escola[cod_esc][key] = aggregate(g)
        result['por_escola'] = por_escola
        result['escola_lookup'] = escola_lookup
    
    return result

def make_saers_shell():
    """Create the base SAERS JSON structure (metadata only)."""
    return {
        'etapa_labels': ETAPA_LABELS,
        'disc_labels': DISC_LABELS,
        'padrao_labels': {
            'avancado': 'Avançado', 'adequado': 'Adequado',
            'basico': 'Básico', 'abaixo': 'Abaixo do Básico',
        },
        'padrao_desc': {
            'avancado': 'Desenvolvimento além do esperado. Precisam de estímulos para continuar avançando.',
            'adequado': 'Consolidaram habilidades previstas. Requerem ações para aprofundar a aprendizagem.',
            'basico': 'Ainda não desenvolveram adequadamente as habilidades essenciais. Demandam reforço.',
            'abaixo': 'Carência de aprendizagem para habilidades mínimas. Necessitam recuperação.',
        },
        'anos': [],
    }

def save_json(data, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    mb = os.path.getsize(path) / 1024 / 1024
    print(f"  [OK] {os.path.basename(path)} ({mb:.1f} MB)")
    return mb

def main():
    t0 = time.time()
    print("=== ETL SAERS ===")
    
    REDES = ['todas', 'estadual', 'municipal']
    
    # Prepare containers per rede
    saers = {r: make_saers_shell() for r in REDES}
    escolas = {r: {'etapa_labels': ETAPA_LABELS, 'disc_labels': DISC_LABELS, 'anos': {}} for r in ['estadual', 'municipal']}
    
    for year in YEARS:
        df = load_year(year)
        if df is None:
            continue
        
        for rede in REDES:
            if rede == 'todas':
                df_f = df
            elif rede == 'estadual':
                df_f = df[df['rede_norm'] == 'ESTADUAL']
            elif rede == 'municipal':
                df_f = df[df['rede_norm'] == 'MUNICIPAL']
            else:
                continue
            
            include_esc = rede in ('estadual', 'municipal')
            result = aggregate_df(df_f, year, include_escolas=include_esc)
            
            n_esc = len(result.get('por_escola', {}))
            print(f"    [{rede:>9}] Geral: {len(result['geral'])} | Mun: {len(result['por_municipio'])} | CRE: {len(result['por_cre'])}" +
                  (f" | Escolas: {n_esc}" if include_esc else ""))
            
            # Extract escola data to separate container
            if include_esc:
                escolas[rede]['anos'][str(year)] = {
                    'por_escola': result.pop('por_escola', {}),
                    'escola_lookup': result.pop('escola_lookup', {}),
                }
            
            saers[rede]['anos'].append(result)
    
    # Save all JSONs
    print()
    OUT_DIR = os.path.dirname(OUT)
    save_json(saers['todas'], os.path.join(OUT_DIR, '4_saers.json'))
    save_json(saers['todas'], os.path.join(OUT_DIR, '4_saers_todas.json'))
    save_json(saers['estadual'], os.path.join(OUT_DIR, '4_saers_estadual.json'))
    save_json(saers['municipal'], os.path.join(OUT_DIR, '4_saers_municipal.json'))
    save_json(escolas['estadual'], os.path.join(OUT_DIR, '4_saers_escolas.json'))
    save_json(escolas['municipal'], os.path.join(OUT_DIR, '4_saers_escolas_municipal.json'))
    
    print(f"\n  Total time: {time.time()-t0:.1f}s")

if __name__ == '__main__':
    main()
