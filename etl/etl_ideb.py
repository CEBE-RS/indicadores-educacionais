# -*- coding: utf-8 -*-
"""
ETL IDEB — Produto 4 UNESCO RS
Extrai IDEB observado, metas, notas SAEB e indicador de rendimento
das planilhas oficiais INEP (divulgação 2023) por escola.
Gera JSONs multi-rede para o painel.
"""
import sys, io


# --- caminhos portateis (repo Git + bases locais) ---
from paths import BASE, OUT_DIR, PAINEL_DIR, BASES_DIR, BASES_BASICAS  # noqa: E402

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import pandas as pd
import numpy as np
import json, os, time

IDEB_DIR = os.path.join(BASE, "00. Bases de Dados", "02. Fluxo e Rendimento (Inep_2010_2024_Rendimento_TDI)", "02. IDEB")

# Files and etapa config
ETAPAS = {
    "AI": {
        "file": "divulgacao_anos_iniciais_escolas_2023.xlsx",
        "label": "Anos Iniciais (5º ano)",
        "anos_ideb": [2005, 2007, 2009, 2011, 2013, 2015, 2017, 2019, 2021, 2023],
        "anos_proj": [2007, 2009, 2011, 2013, 2015, 2017, 2019, 2021],
    },
    "AF": {
        "file": "divulgacao_anos_finais_escolas_2023.xlsx",
        "label": "Anos Finais (9º ano)",
        "anos_ideb": [2005, 2007, 2009, 2011, 2013, 2015, 2017, 2019, 2021, 2023],
        "anos_proj": [2007, 2009, 2011, 2013, 2015, 2017, 2019, 2021],
    },
    "EM": {
        "file": "divulgacao_ensino_medio_escolas_2023.xlsx",
        "label": "Ensino Médio",
        "anos_ideb": [2017, 2019, 2021, 2023],
        "anos_proj": [2019, 2021],
    },
}

REDES = {
    'estadual':  ['Estadual'],
    'municipal': ['Municipal'],
    'federal':   ['Federal'],
    'privada':   ['Privada'],
    'todas':     None,  # no filter
}

# ──────────────────────────────────────────────────────────────────────────
# VALORES OFICIAIS AGREGADOS POR UF/REDE (INEP)
# O IDEB de uma rede NAO e a media dos IDEBs das escolas (ver Nota Tecnica n.1
# do IDEB). O valor oficial de rede e calculado pelo INEP a partir das
# proficiencias dos alunos (N) e da aprovacao agregada (P). Por isso usamos a
# planilha oficial "Regioes e UFs" como fonte autoritativa do serie_temporal.
# Para o RS, o arquivo traz apenas Total/Publica/Privada/Estadual (AI/AF) e
# Total/Privada/Estadual (EM) — Municipal e Federal nao constam.
UF_OFICIAL_FILE = os.path.join(IDEB_DIR, "divulgacao_regioes_ufs_ideb_2023.xlsx")
UF_NOME = "R. G. do Sul"
UF_SHEETS = {"AI": "UF e Regi\u00f5es (AI)", "AF": "UF e Regi\u00f5es (AF)", "EM": "UF e Regi\u00f5es (EM)"}
# rede_key do painel -> rotulo (primeira palavra) da planilha oficial
REDE_OFICIAL_MAP = {"estadual": "Estadual", "privada": "Privada", "todas": "Total"}

def carregar_oficial_uf():
    """Le a planilha oficial agregada (Regioes/UFs) e retorna:
    oficial[rede_rotulo][etapa][ano] = {ideb, nota_saeb, rendimento}
    onde rede_rotulo e a primeira palavra da coluna Rede (Total, Publica,
    Privada, Estadual). Apenas linhas do RS."""
    import re
    if not os.path.exists(UF_OFICIAL_FILE):
        print(f"  [AVISO] Planilha oficial UF nao encontrada: {UF_OFICIAL_FILE}")
        return {}
    oficial = {}
    for etapa, sheet in UF_SHEETS.items():
        raw = pd.read_excel(UF_OFICIAL_FILE, sheet_name=sheet, header=None)
        codes = [str(c) for c in raw.iloc[9].tolist()]
        col = {}
        for i, c in enumerate(codes):
            m = re.match(r'VL_(OBSERVADO|NOTA_MEDIA|INDICADOR_REND)_(\d{4})', c)
            if m:
                col.setdefault(m.group(2), {})[m.group(1)] = i
        data = raw.iloc[10:]
        rs = data[data[0].astype(str).str.strip() == UF_NOME]
        for _, row in rs.iterrows():
            rede_rotulo = str(row[1]).strip().split(' ')[0]  # "Total (4)" -> "Total"
            dest = oficial.setdefault(rede_rotulo, {}).setdefault(etapa, {})
            for ano, idx in col.items():
                ideb = safe_numeric(row[idx['OBSERVADO']]) if 'OBSERVADO' in idx else None
                if ideb is None:
                    continue
                entry = {"ideb": round(ideb, 2)}
                if 'NOTA_MEDIA' in idx:
                    n = safe_numeric(row[idx['NOTA_MEDIA']])
                    if n is not None:
                        entry["nota_saeb"] = round(n, 2)
                if 'INDICADOR_REND' in idx:
                    p = safe_numeric(row[idx['INDICADOR_REND']])
                    if p is not None:
                        entry["rendimento"] = round(p, 4)
                dest[ano] = entry
    return oficial

def safe_numeric(val):
    """Convert to float, handling '-', 'ND', 'nan', etc."""
    if val is None or val == '' or val == '-' or val == 'ND' or val == 'nd':
        return None
    try:
        v = float(val)
        return v if not np.isnan(v) else None
    except (ValueError, TypeError):
        return None

def load_ideb_file(etapa_key):
    """Load IDEB Excel file with header at row 9."""
    cfg = ETAPAS[etapa_key]
    fpath = os.path.join(IDEB_DIR, cfg["file"])
    print(f"  Lendo {cfg['file']}...", end=" ", flush=True)
    df = pd.read_excel(fpath, header=9)
    # Filter RS
    df = df[df['SG_UF'] == 'RS'].copy()
    print(f"{len(df)} escolas RS")
    return df

def extract_etapa_data(df, etapa_key, rede_filter=None):
    """Extract IDEB data for one etapa, optionally filtered by rede."""
    cfg = ETAPAS[etapa_key]
    
    if rede_filter:
        df = df[df['REDE'].isin(rede_filter)].copy()
    
    serie = {}
    for ano in cfg["anos_ideb"]:
        obs_col = f"VL_OBSERVADO_{ano}"
        nota_col = f"VL_NOTA_MEDIA_{ano}"
        rend_col = f"VL_INDICADOR_REND_{ano}"
        proj_col = f"VL_PROJECAO_{ano}" if ano in cfg["anos_proj"] else None
        
        if obs_col not in df.columns:
            continue
        
        # Convert to numeric — use df index for alignment
        vals_obs = df[obs_col].apply(safe_numeric)
        vals_nota = df[nota_col].apply(safe_numeric) if nota_col in df.columns else pd.Series(dtype=float, index=df.index)
        vals_rend = df[rend_col].apply(safe_numeric) if rend_col in df.columns else pd.Series(dtype=float, index=df.index)
        vals_proj = df[proj_col].apply(safe_numeric) if proj_col and proj_col in df.columns else pd.Series(dtype=float, index=df.index)
        
        # Only schools with valid IDEB
        valid_idx = vals_obs.dropna().index
        n_escolas = len(valid_idx)
        
        if n_escolas == 0:
            continue
        
        entry = {
            "ideb": round(float(vals_obs.loc[valid_idx].mean()), 2),
            "nota_saeb": round(float(vals_nota.loc[valid_idx].mean()), 2) if vals_nota.loc[valid_idx].notna().sum() > 0 else None,
            "rendimento": round(float(vals_rend.loc[valid_idx].mean()), 4) if vals_rend.loc[valid_idx].notna().sum() > 0 else None,
            "n_escolas": int(n_escolas),
        }
        
        # Projection (meta)
        proj_valid = vals_proj.loc[valid_idx].dropna()
        if len(proj_valid) > 0:
            entry["meta"] = round(float(proj_valid.mean()), 2)
        
        serie[str(ano)] = entry
    
    return serie

def extract_municipio_data(df, etapa_key, rede_filter=None):
    """Extract per-municipality IDEB data."""
    cfg = ETAPAS[etapa_key]
    
    if rede_filter:
        df = df[df['REDE'].isin(rede_filter)].copy()
    
    # Use latest year with data
    for ano in reversed(cfg["anos_ideb"]):
        obs_col = f"VL_OBSERVADO_{ano}"
        if obs_col in df.columns:
            df['_ideb'] = df[obs_col].apply(safe_numeric)
            df_valid = df[df['_ideb'].notna()].copy()
            if len(df_valid) > 0:
                break
    else:
        return {}, {}
    
    lookup = {}
    mun_data = {}
    
    for cod, grp in df_valid.groupby('CO_MUNICIPIO'):
        cod_str = str(int(cod))[:7]
        nome = grp['NO_MUNICIPIO'].iloc[0]
        lookup[cod_str] = nome
        
        mun_data[cod_str] = {
            "ideb": round(float(grp['_ideb'].mean()), 2),
            "n_escolas": len(grp),
        }
    
    return mun_data, lookup

def extract_mun_all_years(df, etapa_key, rede_filter=None):
    """Extract per-municipality IDEB for ALL years."""
    cfg = ETAPAS[etapa_key]
    
    if rede_filter:
        df = df[df['REDE'].isin(rede_filter)].copy()
    
    por_ano = {}
    lookup = {}
    
    for ano in cfg["anos_ideb"]:
        obs_col = f"VL_OBSERVADO_{ano}"
        if obs_col not in df.columns:
            continue
        
        df['_ideb'] = df[obs_col].apply(safe_numeric)
        df_valid = df[df['_ideb'].notna()].copy()
        
        if len(df_valid) == 0:
            continue
        
        mun_data = {}
        for cod, grp in df_valid.groupby('CO_MUNICIPIO'):
            cod_str = str(int(cod))[:7]
            nome = grp['NO_MUNICIPIO'].iloc[0]
            lookup[cod_str] = nome
            mun_data[cod_str] = {
                "ideb": round(float(grp['_ideb'].mean()), 2),
                "n_escolas": len(grp),
            }
        
        if mun_data:
            por_ano[str(ano)] = mun_data
    
    return por_ano, lookup

def main():
    t0 = time.time()
    print("=" * 60)
    print("ETL IDEB — MULTI-REDE RS")
    print("=" * 60)
    
    # Load all files once
    raw_dfs = {}
    for etapa_key in ETAPAS:
        raw_dfs[etapa_key] = load_ideb_file(etapa_key)

    # Valores oficiais agregados por UF/rede (fonte autoritativa do serie_temporal)
    print("\n  Carregando valores oficiais agregados (Regioes/UFs)...")
    OFICIAL = carregar_oficial_uf()
    if OFICIAL:
        print(f"  Redes oficiais disponiveis p/ RS: {sorted(OFICIAL.keys())}")
    
    # Generate per-rede JSONs
    for rede_key, rede_filter in REDES.items():
        print(f"\n{'='*60}")
        print(f"  REDE: {rede_key.upper()}")
        print(f"{'='*60}")
        
        resultado = {
            "metadata": {
                "fonte": "IDEB/INEP — Divulgação 2023",
                "recorte": f"Rede {rede_key.title()} RS",
                "gerado_em": pd.Timestamp.now().isoformat(),
                "formula": "IDEB = N (Nota SAEB padronizada) × P (Indicador de Rendimento)",
            },
            "serie_temporal": {},
            "por_municipio": {},
            "lookup_municipios": {},
        }
        
        all_lookup = {}
        
        for etapa_key in ETAPAS:
            df = raw_dfs[etapa_key]
            serie = extract_etapa_data(df, etapa_key, rede_filter)
            
            for ano, data in serie.items():
                if ano not in resultado["serie_temporal"]:
                    resultado["serie_temporal"][ano] = {}
                resultado["serie_temporal"][ano][etapa_key] = data
            
            # Per-municipality (all years)
            por_ano, lookup = extract_mun_all_years(df, etapa_key, rede_filter)
            all_lookup.update(lookup)
            
            for ano, mun_data in por_ano.items():
                if ano not in resultado["por_municipio"]:
                    resultado["por_municipio"][ano] = {}
                for cod, md in mun_data.items():
                    if cod not in resultado["por_municipio"][ano]:
                        resultado["por_municipio"][ano][cod] = {}
                    resultado["por_municipio"][ano][cod][etapa_key] = md
            
            # Summary
            anos_disp = sorted(serie.keys())
            if anos_disp:
                ultimo = anos_disp[-1]
                d = serie[ultimo]
                print(f"  {etapa_key}: IDEB {ultimo} = {d['ideb']} ({d['n_escolas']} escolas) [media de escolas, pre-override]")

        # ── OVERRIDE com valores oficiais agregados por rede (serie_temporal) ──
        rotulo = REDE_OFICIAL_MAP.get(rede_key)
        if rotulo and rotulo in OFICIAL:
            n_over = 0
            for etapa_key, por_ano in OFICIAL[rotulo].items():
                for ano, o in por_ano.items():
                    entry = resultado["serie_temporal"].setdefault(ano, {}).setdefault(etapa_key, {})
                    entry["ideb"] = o["ideb"]
                    if "nota_saeb" in o:
                        entry["nota_saeb"] = o["nota_saeb"]
                    if "rendimento" in o:
                        entry["rendimento"] = o["rendimento"]
                    entry["fonte"] = "oficial_inep_uf"
                    n_over += 1
            resultado["metadata"]["serie_temporal_fonte"] = (
                "Valores oficiais agregados por UF/rede (INEP — divulgacao_regioes_ufs_ideb_2023). "
                "IDEB de rede = N x P calculado pelo INEP no nivel do aluno (nao e media das escolas)."
            )
            ult_em = resultado["serie_temporal"].get("2023", {}).get("EM", {}).get("ideb")
            print(f"  [OVERRIDE OFICIAL] {n_over} valores substituidos (rotulo '{rotulo}'). EM 2023 = {ult_em}")
        else:
            resultado["metadata"]["serie_temporal_fonte"] = (
                "Sem agregado oficial por UF para esta rede; serie_temporal = media dos IDEBs das escolas (aproximacao)."
            )
            print(f"  [SEM OVERRIDE] rede '{rede_key}' nao consta no agregado oficial UF — mantida media de escolas")

        resultado["lookup_municipios"] = all_lookup
        
        # Save JSON
        out_json = os.path.join(PAINEL_DIR, f"4_7_ideb_{rede_key}.json")
        with open(out_json, "w", encoding="utf-8") as f:
            json.dump(resultado, f, ensure_ascii=False, indent=2)
        size_kb = os.path.getsize(out_json) / 1024
        print(f"  JSON: {os.path.basename(out_json)} ({size_kb:.0f} KB)")
    
    # Backward compat
    import shutil
    src = os.path.join(PAINEL_DIR, "4_7_ideb_estadual.json")
    dst = os.path.join(PAINEL_DIR, "4_7_ideb.json")
    if os.path.exists(src):
        shutil.copy2(src, dst)
        print(f"\n[COMPAT] Copiado -> 4_7_ideb.json")
    
    print(f"\nTempo total: {time.time()-t0:.1f}s")

if __name__ == "__main__":
    main()
