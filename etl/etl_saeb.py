# -*- coding: utf-8 -*-
"""
ETL SAEB — Produto 4 UNESCO RS
Extrai proficiências por escola da Rede Estadual do RS (2013-2023).
Gera JSON para o painel + XLSX com evolução por escola.
"""
import sys, io


# --- caminhos portateis (repo Git + bases locais) ---
from paths import BASE, OUT_DIR, PAINEL_DIR, BASES_DIR, BASES_BASICAS  # noqa: E402

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import pandas as pd
import numpy as np
import json, os, glob, time

SAEB_DIR = os.path.join(BASE, "00. Bases de Dados", "03. Desempenho IDEB.SAEB", "01. SAEB")

# RS UF code
UF_RS = 43

# Redes to generate — SAEB microdata only has IN_PUBLICA (0/1) flag,
# not ID_DEPENDENCIA_ADM (except 2011). So we can only distinguish:
REDES = {
    'estadual':  {'pub': 1, 'label': 'Pública'},    # IN_PUBLICA=1 (inclui est+mun+fed)
    'privada':   {'pub': 0, 'label': 'Privada'},     # IN_PUBLICA=0
    'todas':     {'pub': None, 'label': 'Todas'},     # No filter
}

# Etapas e suas colunas de média (normalizadas)
ETAPAS = {
    "5EF": {"lp": "MEDIA_5EF_LP", "mt": "MEDIA_5EF_MT", "label": "5º Ano EF"},
    "9EF": {"lp": "MEDIA_9EF_LP", "mt": "MEDIA_9EF_MT", "label": "9º Ano EF"},
    "EM":  {"lp": None, "mt": None, "label": "Ens. Médio"},  # resolve dynamically
}

# Column mapping for EM (varies by year)
EM_COL_MAP = {
    "2013": {"lp": "MEDIA_3EM_LP", "mt": "MEDIA_3EM_MT"},
    "2015": {"lp": "MEDIA_3EM_LP", "mt": "MEDIA_3EM_MT"},
    "2017": {"lp": "MEDIA_3EM_LP", "mt": "MEDIA_3EM_MT"},
    "2019": {"lp": "MEDIA_EM_LP", "mt": "MEDIA_EM_MT"},
    "2021": {"lp": "MEDIA_EM_LP", "mt": "MEDIA_EM_MT"},
    "2023": {"lp": "MEDIA_EM_LP", "mt": "MEDIA_EM_MT"},
}

# Lookup for Escolas Estaduais (from our canonical base)
ESCOLAS_REF = os.path.join(BASE, "..", "000. Bases_Básicas", "Escolas_Estaduais_RS_2025.xlsx")

def find_escola_csv(year_dir):
    """Find TS_ESCOLA.csv in any subdirectory."""
    for root, dirs, files in os.walk(year_dir):
        for f in files:
            if 'escola' in f.lower() and f.endswith('.csv') and 'quest' not in f.lower():
                return os.path.join(root, f)
    return None

def find_aluno_em_csv(year_dir):
    """Find TS_ALUNO_3EM.csv in any subdirectory."""
    for root, dirs, files in os.walk(year_dir):
        for f in files:
            if '3em' in f.lower() and f.endswith('.csv') and 'aluno' in f.lower():
                return os.path.join(root, f)
    return None

def extract_em_from_alunos(aluno_csv, pub_filter=None):
    """Read TS_ALUNO_3EM.csv, filter RS + rede, aggregate to school-level means.
    Returns dict matching extract_medias output for 'EM' key, or None.
    """
    df = pd.read_csv(aluno_csv, sep=';', encoding='latin-1')
    if len(df.columns) < 5:
        df = pd.read_csv(aluno_csv, sep=',', encoding='latin-1')

    # Filter RS
    if 'ID_UF' in df.columns:
        df = df[df['ID_UF'] == UF_RS]
    elif 'CO_UF' in df.columns:
        df = df[df['CO_UF'] == UF_RS]

    # Filter rede
    if pub_filter is not None and 'IN_PUBLICA' in df.columns:
        df = df[df['IN_PUBLICA'] == pub_filter]

    # Only students with valid proficiency
    if 'IN_PROFICIENCIA' in df.columns:
        df = df[df['IN_PROFICIENCIA'] == 1]

    # Find proficiency columns
    lp_col = next((c for c in df.columns if 'PROFICIENCIA_LP_SAEB' in c), None)
    mt_col = next((c for c in df.columns if 'PROFICIENCIA_MT_SAEB' in c), None)
    if not lp_col:
        lp_col = next((c for c in df.columns if 'PROFICIENCIA_LP' in c and 'DESVIO' not in c), None)
    if not mt_col:
        mt_col = next((c for c in df.columns if 'PROFICIENCIA_MT' in c and 'DESVIO' not in c), None)

    if not lp_col or 'ID_ESCOLA' not in df.columns:
        return None

    df['lp'] = pd.to_numeric(df[lp_col], errors='coerce')
    if mt_col:
        df['mt'] = pd.to_numeric(df[mt_col], errors='coerce')

    df = df.dropna(subset=['lp'])
    if len(df) == 0:
        return None

    # Aggregate to school level
    agg = df.groupby('ID_ESCOLA').agg(
        lp=('lp', 'mean'),
        mt=('mt', 'mean') if 'mt' in df.columns else ('lp', 'count'),  # dummy if no mt
    ).reset_index()

    if 'mt' not in df.columns:
        agg['mt'] = np.nan

    agg['lp'] = agg['lp'].round(1)
    agg['mt'] = agg['mt'].round(1)

    school_records = []
    for _, row in agg.iterrows():
        school_records.append({
            'ID_ESCOLA': int(row['ID_ESCOLA']),
            'lp': row['lp'],
            'mt': row['mt'] if pd.notna(row['mt']) else None,
        })

    return {
        'label': 'Ens. Médio',
        'media_lp': round(float(agg['lp'].mean()), 1),
        'media_mt': round(float(agg['mt'].mean()), 1) if agg['mt'].notna().any() else None,
        'n_escolas': len(agg),
        'escolas': school_records,
    }

def load_escola_csv(fpath, ano):
    """Load TS_ESCOLA with correct separator detection."""
    # Try semicolon first
    df = pd.read_csv(fpath, sep=';', encoding='latin-1', nrows=2)
    if len(df.columns) < 5:
        # Probably comma-separated (2013-2017 have everything in one column)
        df = pd.read_csv(fpath, sep=',', encoding='latin-1')
    else:
        df = pd.read_csv(fpath, sep=';', encoding='latin-1')
    return df

def filter_rs_rede(df, ano, dep_codes):
    """Filter for RS schools of given rede(s).
    dep_codes: list of ID_DEPENDENCIA_ADM values (1=Fed, 2=Est, 3=Mun, 4=Priv)
    """
    # UF filter
    if 'ID_UF' in df.columns:
        df = df[df['ID_UF'] == UF_RS]
    elif 'CO_UF' in df.columns:
        df = df[df['CO_UF'] == UF_RS]
    
    # Rede filter
    if 'ID_DEPENDENCIA_ADM' in df.columns:
        df = df[df['ID_DEPENDENCIA_ADM'].isin(dep_codes)]
    elif 'IN_PUBLICA' in df.columns:
        # Fallback: old files without ID_DEPENDENCIA_ADM
        if dep_codes == [1, 2, 3, 4]:  # todas
            pass  # keep all
        elif all(d in [1, 2, 3] for d in dep_codes):
            df = df[df['IN_PUBLICA'] == 1]
        elif dep_codes == [4]:
            df = df[df['IN_PUBLICA'] == 0]
    
    return df

def extract_medias(df, ano):
    """Extract proficiency averages for each etapa."""
    result = {}
    
    for etapa_key, etapa_info in ETAPAS.items():
        if etapa_key == "EM":
            em_cols = EM_COL_MAP.get(ano, {})
            lp_col = em_cols.get("lp")
            mt_col = em_cols.get("mt")
        else:
            lp_col = etapa_info["lp"]
            mt_col = etapa_info["mt"]
        
        if not lp_col or lp_col not in df.columns:
            continue
        
        # Extract school-level data
        school_data = df[['ID_ESCOLA']].copy()
        if 'ID_MUNICIPIO' in df.columns:
            school_data['ID_MUNICIPIO'] = df['ID_MUNICIPIO']
        
        if lp_col in df.columns:
            school_data['lp'] = pd.to_numeric(df[lp_col], errors='coerce')
        if mt_col and mt_col in df.columns:
            school_data['mt'] = pd.to_numeric(df[mt_col], errors='coerce')
        
        # Participation data
        mat_col = f"NU_MATRICULADOS_CENSO_{etapa_key}" if etapa_key != "EM" else "NU_MATRICULADOS_CENSO_EM"
        pres_col = f"NU_PRESENTES_{etapa_key}" if etapa_key != "EM" else "NU_PRESENTES_EM"
        
        if mat_col in df.columns:
            school_data['matriculados'] = pd.to_numeric(df[mat_col], errors='coerce')
        if pres_col in df.columns:
            school_data['presentes'] = pd.to_numeric(df[pres_col], errors='coerce')
        
        # Clean
        school_data = school_data.dropna(subset=['lp'])
        
        if len(school_data) == 0:
            continue
        
        # Aggregate
        media_lp = round(school_data['lp'].mean(), 1)
        media_mt = round(school_data['mt'].mean(), 1) if 'mt' in school_data.columns else None
        n_escolas = len(school_data)
        
        result[etapa_key] = {
            "label": etapa_info["label"],
            "media_lp": media_lp,
            "media_mt": media_mt,
            "n_escolas": n_escolas,
            "escolas": school_data.to_dict('records'),
        }
    
    return result

def main():
    t0 = time.time()
    print("=" * 60)
    print("ETL SAEB — MULTI-REDE RS")
    print("=" * 60)
    
    # Process each year dir once, cache raw DFs
    year_dirs = sorted(os.listdir(SAEB_DIR))
    raw_dfs = {}  # ano -> df (all RS, unfiltered by rede)
    year_paths = {}  # ano -> year_path (for aluno CSV fallback)
    
    for yd in year_dirs:
        year_path = os.path.join(SAEB_DIR, yd)
        if not os.path.isdir(year_path):
            continue
        ano = ''.join(c for c in yd if c.isdigit())[:4]
        if not ano or int(ano) < 2013:
            continue
        escola_csv = find_escola_csv(year_path)
        if not escola_csv:
            continue
        print(f"  {ano}: lendo...", end=" ", flush=True)
        df = load_escola_csv(escola_csv, ano)
        # Filter RS only (all redes)
        if 'ID_UF' in df.columns:
            df = df[df['ID_UF'] == UF_RS]
        elif 'CO_UF' in df.columns:
            df = df[df['CO_UF'] == UF_RS]
        print(f"{len(df)} escolas RS")
        raw_dfs[ano] = df
        year_paths[ano] = year_path
    
    # Generate per-rede JSONs
    for rede_key, rede_cfg in REDES.items():
        print(f"\n{'='*60}")
        print(f"  REDE: {rede_key.upper()} ({rede_cfg['label']})")
        print(f"{'='*60}")
        
        resultado = {
            "metadata": {
                "fonte": "Microdados SAEB/INEP",
                "recorte": f"Rede {rede_cfg['label']} RS",
                "gerado_em": pd.Timestamp.now().isoformat(),
            },
            "serie_temporal": {},
        }
        all_schools = []
        
        for ano, df_raw in sorted(raw_dfs.items()):
            # Filter by rede using IN_PUBLICA
            pub_filter = rede_cfg['pub']
            if pub_filter is not None and 'IN_PUBLICA' in df_raw.columns:
                df = df_raw[df_raw['IN_PUBLICA'] == pub_filter].copy()
            else:
                df = df_raw.copy()
            
            n_rede = len(df)
            medias = extract_medias(df, ano)
            
            # Fallback: if EM missing, try TS_ALUNO_3EM.csv
            if 'EM' not in medias and ano in year_paths:
                aluno_em_csv = find_aluno_em_csv(year_paths[ano])
                if aluno_em_csv:
                    print(f"    {ano}: EM ausente em TS_ESCOLA, lendo TS_ALUNO_3EM...", end=" ", flush=True)
                    em_data = extract_em_from_alunos(aluno_em_csv, pub_filter=rede_cfg['pub'])
                    if em_data:
                        medias['EM'] = em_data
                        print(f"{em_data['n_escolas']} escolas EM")
                    else:
                        print("sem dados")
            
            ano_data = {"n_escolas_total": n_rede}
            for etapa_key, etapa_data in medias.items():
                ano_data[etapa_key] = {
                    "media_lp": etapa_data["media_lp"],
                    "media_mt": etapa_data["media_mt"],
                    "n_escolas": etapa_data["n_escolas"],
                    "label": etapa_data["label"],
                }
                if rede_key == 'estadual':
                    for esc in etapa_data["escolas"]:
                        row = {
                            "ANO": int(ano),
                            "ID_ESCOLA": int(esc["ID_ESCOLA"]),
                            "ETAPA": etapa_data["label"],
                            "MEDIA_LP": esc.get("lp"),
                            "MEDIA_MT": esc.get("mt"),
                        }
                        if "matriculados" in esc:
                            row["MATRICULADOS"] = esc.get("matriculados")
                        if "presentes" in esc:
                            row["PRESENTES"] = esc.get("presentes")
                        all_schools.append(row)
            
            resultado["serie_temporal"][ano] = ano_data
            etapas_str = ", ".join(f"{k}({v['n_escolas']} esc)" for k, v in medias.items())
            print(f"  {ano}: {n_rede} escolas | {etapas_str}")
        
        # ── Per-municipality data from TS_MUNICIPIO.xlsx (official INEP) ──
        por_municipio = {}
        lookup_municipios = {}
        
        ts_mun_files = glob.glob(os.path.join(SAEB_DIR, "**/TS_MUNICIPIO.xlsx"), recursive=True)
        # Also check for year-suffixed files like TS_MUNICIPIO_2015.xlsx
        ts_mun_files += glob.glob(os.path.join(SAEB_DIR, "**/TS_MUNICIPIO_*.xlsx"), recursive=True)
        
        for mf in sorted(ts_mun_files):
            # Determine year from parent dir
            parent = os.path.basename(os.path.dirname(os.path.dirname(mf)))
            yr_digits = ''.join(c for c in parent if c.isdigit())[:4]
            if not yr_digits or int(yr_digits) < 2013:
                continue
            
            try:
                mdf = pd.read_excel(mf)
                # Some files have header rows — detect
                if 'CO_MUNICIPIO' not in mdf.columns and 'NO_MUNICIPIO' not in mdf.columns:
                    # Try reading with header at row 1 or 2
                    for skip in [1, 2, 3]:
                        mdf = pd.read_excel(mf, header=skip)
                        if 'CO_MUNICIPIO' in mdf.columns:
                            break
                
                if 'CO_MUNICIPIO' not in mdf.columns:
                    print(f"    SKIP {os.path.basename(mf)}: no CO_MUNICIPIO column")
                    continue
                
                # Filter RS
                uf_col = 'CO_UF' if 'CO_UF' in mdf.columns else None
                if uf_col:
                    mdf = mdf[mdf[uf_col] == UF_RS]
                else:
                    mdf = mdf[mdf['CO_MUNICIPIO'].astype(str).str.startswith('43')]
                
                # Filter by DEPENDENCIA_ADM based on rede
                if 'DEPENDENCIA_ADM' in mdf.columns:
                    if rede_key == 'estadual':
                        # "Estadual" in this context = public = Est+Mun+Fed
                        # Get Total or filter Estadual+Municipal+Federal
                        mdf_total = mdf[mdf['DEPENDENCIA_ADM'] == 'Total']
                        if len(mdf_total) == 0:
                            mdf = mdf[mdf['DEPENDENCIA_ADM'].isin(['Estadual', 'Municipal', 'Federal'])]
                        else:
                            mdf = mdf_total
                    elif rede_key == 'privada':
                        mdf = mdf[mdf['DEPENDENCIA_ADM'] == 'Privada']
                    else:  # todas
                        mdf_total = mdf[mdf['DEPENDENCIA_ADM'] == 'Total']
                        if len(mdf_total) > 0:
                            mdf = mdf_total
                
                # Also filter LOCALIZACAO = Total (if column exists)
                if 'LOCALIZACAO' in mdf.columns:
                    loc_total = mdf[mdf['LOCALIZACAO'] == 'Total']
                    if len(loc_total) > 0:
                        mdf = loc_total
                
                # Build municipality data
                mun_data = {}
                for _, row in mdf.iterrows():
                    cod = str(int(row['CO_MUNICIPIO']))[:7]
                    nome = str(row.get('NO_MUNICIPIO', ''))
                    if nome and nome != 'nan':
                        lookup_municipios[cod] = nome
                    
                    entry = {}
                    # 5EF
                    lp5 = pd.to_numeric(row.get('MEDIA_5_LP', None), errors='coerce')
                    mt5 = pd.to_numeric(row.get('MEDIA_5_MT', None), errors='coerce')
                    if pd.notna(lp5):
                        entry['5EF'] = {'media_lp': round(float(lp5), 1), 'media_mt': round(float(mt5), 1) if pd.notna(mt5) else None}
                    
                    # 9EF
                    lp9 = pd.to_numeric(row.get('MEDIA_9_LP', None), errors='coerce')
                    mt9 = pd.to_numeric(row.get('MEDIA_9_MT', None), errors='coerce')
                    if pd.notna(lp9):
                        entry['9EF'] = {'media_lp': round(float(lp9), 1), 'media_mt': round(float(mt9), 1) if pd.notna(mt9) else None}
                    
                    # EM — column varies by year
                    for em_lp_col, em_mt_col in [('MEDIA_12_LP','MEDIA_12_MT'), ('MEDIA_3_LP','MEDIA_3_MT'), ('MEDIA_EM_LP','MEDIA_EM_MT'), ('MEDIA_EMT_LP','MEDIA_EMT_MT')]:
                        lp_em = pd.to_numeric(row.get(em_lp_col, None), errors='coerce')
                        mt_em = pd.to_numeric(row.get(em_mt_col, None), errors='coerce')
                        if pd.notna(lp_em):
                            entry['EM'] = {'media_lp': round(float(lp_em), 1), 'media_mt': round(float(mt_em), 1) if pd.notna(mt_em) else None}
                            break
                    
                    if entry:
                        if cod in mun_data:
                            # Aggregate multiple dep_adm rows (est+mun+fed) for public
                            for etapa, vals in entry.items():
                                if etapa not in mun_data[cod]:
                                    mun_data[cod][etapa] = vals
                                else:
                                    # Average the two (weighted would be better but we don't have n)
                                    existing = mun_data[cod][etapa]
                                    for metric in ['media_lp', 'media_mt']:
                                        if vals.get(metric) is not None and existing.get(metric) is not None:
                                            existing[metric] = round((existing[metric] + vals[metric]) / 2, 1)
                        else:
                            mun_data[cod] = entry
                
                if mun_data:
                    por_municipio[yr_digits] = mun_data
                    print(f"    TS_MUNICIPIO {yr_digits}: {len(mun_data)} municipios")
            except Exception as e:
                print(f"    ERRO TS_MUNICIPIO {mf}: {e}")
        
        resultado["por_municipio"] = por_municipio
        resultado["lookup_municipios"] = lookup_municipios
        
        # Save JSON
        out_json = os.path.join(PAINEL_DIR, f"4_6_saeb_{rede_key}.json")
        with open(out_json, "w", encoding="utf-8") as f:
            json.dump(resultado, f, ensure_ascii=False, indent=2)
        print(f"  JSON: {os.path.basename(out_json)} ({os.path.getsize(out_json)/1024:.0f} KB)")
        
        # XLSX only for estadual
        if rede_key == 'estadual' and all_schools:
            print("\n  Gerando XLSX evolucao por escola (estadual)...")
            df_all = pd.DataFrame(all_schools)
            if len(df_all) > 0 and os.path.exists(ESCOLAS_REF):
                ref = pd.read_excel(ESCOLAS_REF)
                id_col = [c for c in ref.columns if 'INEP' in c or 'ENTIDADE' in c or 'digo' in c][0]
                nome_col = [c for c in ref.columns if 'Nome' in c][0]
                mun_col = [c for c in ref.columns if 'Munic' in c and 'Cód' not in c][0]
                ref = ref.rename(columns={id_col: 'ID_ESCOLA', nome_col: 'NOME_ESCOLA', mun_col: 'MUNICIPIO'})
                ref = ref[['ID_ESCOLA', 'NOME_ESCOLA', 'MUNICIPIO']]
                df_all = df_all.merge(ref, on='ID_ESCOLA', how='left')
            
            xlsx_path = os.path.join(BASE, "SAEB_Evolucao_Escolas_Estaduais_RS.xlsx")
            with pd.ExcelWriter(xlsx_path, engine='openpyxl') as writer:
                for etapa_label in df_all['ETAPA'].unique():
                    de = df_all[df_all['ETAPA'] == etapa_label].copy()
                    pivot_lp = de.pivot_table(index='ID_ESCOLA', columns='ANO', values='MEDIA_LP', aggfunc='first')
                    pivot_lp.columns = [f"LP_{c}" for c in pivot_lp.columns]
                    pivot_mt = de.pivot_table(index='ID_ESCOLA', columns='ANO', values='MEDIA_MT', aggfunc='first')
                    pivot_mt.columns = [f"MT_{c}" for c in pivot_mt.columns]
                    pivot = pivot_lp.join(pivot_mt)
                    if 'NOME_ESCOLA' in de.columns:
                        nomes = de.drop_duplicates('ID_ESCOLA').set_index('ID_ESCOLA')[['NOME_ESCOLA', 'MUNICIPIO']]
                        pivot = nomes.join(pivot)
                    pivot = pivot.reset_index()
                    lp_cols = [c for c in pivot.columns if c.startswith('LP_')]
                    mt_cols = [c for c in pivot.columns if c.startswith('MT_')]
                    if len(lp_cols) >= 2:
                        pivot['DELTA_LP'] = pivot[lp_cols[-1]] - pivot[lp_cols[0]]
                    if len(mt_cols) >= 2:
                        pivot['DELTA_MT'] = pivot[mt_cols[-1]] - pivot[mt_cols[0]]
                    sheet_name = etapa_label.replace("º", "").replace(" ", "_")[:31]
                    pivot.to_excel(writer, sheet_name=sheet_name, index=False)
                    print(f"    Aba '{sheet_name}': {len(pivot)} escolas")
            print(f"  XLSX: {xlsx_path}")
    
    # Backward compat
    import shutil
    src = os.path.join(PAINEL_DIR, "4_6_saeb_estadual.json")
    for dst_name in ["4_6_saeb.json"]:
        dst = os.path.join(PAINEL_DIR, dst_name)
        if os.path.exists(src):
            shutil.copy2(src, dst)
    # Also copy to dados/
    dst2 = os.path.join(OUT_DIR, "4_6_saeb.json")
    if os.path.exists(src):
        shutil.copy2(src, dst2)
    print(f"\n[COMPAT] Copiado -> 4_6_saeb.json")
    
    print(f"\nTempo total: {time.time()-t0:.1f}s")

if __name__ == "__main__":
    main()
