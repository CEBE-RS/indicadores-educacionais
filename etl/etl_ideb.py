# -*- coding: utf-8 -*-
"""
ETL IDEB — Produto 4 UNESCO RS
Extrai IDEB observado, metas, notas SAEB e indicador de rendimento
das planilhas oficiais INEP (divulgação 2025) por escola.
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
MICRO_DIR = os.path.join(BASE, "00. Bases de Dados", "01. Acesso e Matrículas (Censo Escolar_2010_2025)", "01. extrações_2010_2025")

# Colunas de matricula por SERIE AVALIADA no SAEB (Censo 2025), usadas como
# peso da media ponderada por escola no nivel da CRE (regional).
#   AI -> 5o ano do Fundamental | AF -> 9o ano | EM -> 3a serie do Medio
SERIE_COLS = {
    "AI": ["QT_MAT_FUND_AI_5"],
    "AF": ["QT_MAT_FUND_AF_9"],
    "EM": ["QT_MAT_MED_NM_3", "QT_MAT_MED_PROP_3", "QT_MAT_MED_IFTP_CT_3"],
}

# Files and etapa config
ETAPAS = {
    "AI": {
        "file": "divulgacao_anos_iniciais_escolas_2025.xlsx",
        "file_mun": "divulgacao_anos_iniciais_municipios_2025.xlsx",
        "label": "Anos Iniciais (5º ano)",
        "anos_ideb": [2005, 2007, 2009, 2011, 2013, 2015, 2017, 2019, 2021, 2023, 2025],
        "anos_proj": [2007, 2009, 2011, 2013, 2015, 2017, 2019, 2021],
    },
    "AF": {
        "file": "divulgacao_anos_finais_escolas_2025.xlsx",
        "file_mun": "divulgacao_anos_finais_municipios_2025.xlsx",
        "label": "Anos Finais (9º ano)",
        "anos_ideb": [2005, 2007, 2009, 2011, 2013, 2015, 2017, 2019, 2021, 2023, 2025],
        "anos_proj": [2007, 2009, 2011, 2013, 2015, 2017, 2019, 2021],
    },
    "EM": {
        "file": "divulgacao_ensino_medio_escolas_2025.xlsx",
        "file_mun": "divulgacao_ensino_medio_municipios_2025.xlsx",
        "label": "Ensino Médio",
        "anos_ideb": [2017, 2019, 2021, 2023, 2025],
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
UF_OFICIAL_FILE = os.path.join(IDEB_DIR, "divulgacao_regioes_ufs_ideb_2025.xlsx")
UF_NOME = "R. G. do Sul"
UF_SHEETS = {"AI": "UF e Regi\u00f5es (AI)", "AF": "UF e Regi\u00f5es (AF)", "EM": "UF e Regi\u00f5es (EM)"}
# rede_key do painel -> rotulo (primeira palavra) da planilha oficial
REDE_OFICIAL_MAP = {"estadual": "Estadual", "privada": "Privada", "todas": "Total"}

# ──────────────────────────────────────────────────────────────────────────
# VALORES OFICIAIS POR MUNICIPIO (INEP)
# O IDEB de um municipio tambem NAO e a media dos IDEBs das escolas. As
# planilhas oficiais "por municipio" trazem o valor agregado calculado pelo
# INEP (N x P no nivel do aluno). Usamos essa fonte para Estadual/Municipal/
# Federal (redes presentes no recorte municipal oficial). Privada e Todas nao
# constam nesse recorte -> mantem fallback de media das escolas.
REDE_OFICIAL_MUN_MAP = {"estadual": "Estadual", "municipal": "Municipal", "federal": "Federal"}

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

def load_ideb_mun_file(etapa_key):
    """Load official per-municipality IDEB Excel file (header at row 9)."""
    cfg = ETAPAS[etapa_key]
    fpath = os.path.join(IDEB_DIR, cfg["file_mun"])
    if not os.path.exists(fpath):
        print(f"  [AVISO] Planilha oficial de municipios nao encontrada: {cfg['file_mun']}")
        return None
    print(f"  Lendo {cfg['file_mun']}...", end=" ", flush=True)
    df = pd.read_excel(fpath, header=9)
    df = df[df['SG_UF'] == 'RS'].copy()
    print(f"{len(df)} linhas RS")
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

def extract_mun_all_years_oficial(mun_df, esc_df, etapa_key, rede_rotulo):
    """IDEB OFICIAL por municipio (planilha oficial de municipios), todos os anos.

    O valor do municipio vem direto da planilha oficial (nao e media das escolas).
    n_escolas e contado a partir do arquivo de escolas (mesma etapa/rede) apenas
    para ponderar a agregacao por CRE no app — nao altera o valor exibido."""
    cfg = ETAPAS[etapa_key]
    m = mun_df[mun_df['REDE'].astype(str).str.strip() == rede_rotulo].copy()
    esc = esc_df[esc_df['REDE'].astype(str).str.strip() == rede_rotulo].copy()

    por_ano = {}
    lookup = {}
    for ano in cfg["anos_ideb"]:
        obs_col = f"VL_OBSERVADO_{ano}"
        if obs_col not in m.columns:
            continue

        m['_ideb'] = m[obs_col].apply(safe_numeric)
        mv = m[m['_ideb'].notna()].copy()
        if len(mv) == 0:
            continue

        # Contagem de escolas por municipio nesse ano (apenas para ponderacao CRE)
        esc_counts = {}
        if obs_col in esc.columns:
            esc['_e'] = esc[obs_col].apply(safe_numeric)
            ev = esc[esc['_e'].notna()]
            for cod, grp in ev.groupby('CO_MUNICIPIO'):
                esc_counts[str(int(cod))[:7]] = len(grp)

        mun_data = {}
        for _, row in mv.iterrows():
            cod_str = str(int(row['CO_MUNICIPIO']))[:7]
            lookup[cod_str] = row['NO_MUNICIPIO']
            mun_data[cod_str] = {
                "ideb": round(float(row['_ideb']), 2),
                "n_escolas": esc_counts.get(cod_str, 1),
            }

        if mun_data:
            por_ano[str(ano)] = mun_data

    return por_ano, lookup

def load_serie_weights():
    """Peso por escola = matricula na SERIE AVALIADA (5o/9o/3oEM) no Censo 2025.
    Retorna {id_escola: {'AI': n, 'AF': n, 'EM': n}}."""
    f = os.path.join(MICRO_DIR, "Tabela_Matricula_2025.csv")
    if not os.path.exists(f):
        print(f"  [AVISO] {os.path.basename(f)} nao encontrada — por_cre usara peso 1 por escola")
        return {}
    todas_cols = [c for cols in SERIE_COLS.values() for c in cols]
    h = pd.read_csv(f, sep=";", encoding="latin-1", nrows=0)
    use = ["CO_ENTIDADE"] + [c for c in todas_cols if c in h.columns]
    df = pd.read_csv(f, sep=";", encoding="latin-1", usecols=use)

    def soma(row, cols):
        tot = 0
        for c in cols:
            if c in df.columns:
                v = row[c]
                if not pd.isna(v):
                    tot += int(v)
        return tot

    weights = {}
    for _, row in df.iterrows():
        eid = str(int(row["CO_ENTIDADE"]))
        weights[eid] = {et: soma(row, cols) for et, cols in SERIE_COLS.items()}
    print(f"  Pesos (matricula por serie) carregados p/ {len(weights)} escolas (Censo 2025)")
    return weights


def load_mun_to_cre():
    """Mapa CO_MUNICIPIO (7 digitos) -> cod_cre, a partir do lookup do painel."""
    f = os.path.join(PAINEL_DIR, "rs_cre_lookup.json")
    if not os.path.exists(f):
        print("  [AVISO] rs_cre_lookup.json nao encontrado — por_cre nao sera gerado")
        return {}
    with open(f, encoding="utf-8") as fh:
        d = json.load(fh)
    return {k: v.get("cod_cre") for k, v in d.get("mun_to_cre", {}).items()}


def extract_cre_all_years(df, etapa_key, rede_filter, weights, mun_to_cre):
    """IDEB por CRE, todos os anos: media PONDERADA das escolas pela matricula
    na serie avaliada (peso). Fiel ao metodo da SEDUC-RS (media ponderada,
    escola a escola), em vez de media simples de municipios."""
    cfg = ETAPAS[etapa_key]
    if rede_filter:
        df = df[df["REDE"].isin(rede_filter)].copy()

    por_ano = {}
    for ano in cfg["anos_ideb"]:
        obs_col = f"VL_OBSERVADO_{ano}"
        if obs_col not in df.columns:
            continue
        df["_ideb"] = df[obs_col].apply(safe_numeric)
        dv = df[df["_ideb"].notna()]
        if len(dv) == 0:
            continue

        acc = {}  # cre -> [sum(ideb*peso), sum(peso), n_escolas]
        for _, row in dv.iterrows():
            mun = str(int(row["CO_MUNICIPIO"]))[:7]
            cre = mun_to_cre.get(mun)
            if not cre:
                continue
            eid = str(int(row["ID_ESCOLA"]))
            w = (weights.get(eid, {}) or {}).get(etapa_key, 0) or 0
            if w <= 0:
                w = 1  # fallback: escola sem matricula 2025 na serie (ex.: fechada)
            a = acc.setdefault(cre, [0.0, 0.0, 0])
            a[0] += row["_ideb"] * w
            a[1] += w
            a[2] += 1

        cre_data = {}
        for cre, (soma_iw, soma_w, n_esc) in acc.items():
            if soma_w > 0:
                cre_data[cre] = {
                    "ideb": round(soma_iw / soma_w, 2),
                    "n_escolas": n_esc,
                    "n_alunos": int(soma_w),
                }
        if cre_data:
            por_ano[str(ano)] = cre_data
    return por_ano


def main():
    t0 = time.time()
    print("=" * 60)
    print("ETL IDEB — MULTI-REDE RS")
    print("=" * 60)
    
    # Load all files once
    raw_dfs = {}
    mun_dfs = {}
    for etapa_key in ETAPAS:
        raw_dfs[etapa_key] = load_ideb_file(etapa_key)
        mun_dfs[etapa_key] = load_ideb_mun_file(etapa_key)

    # Valores oficiais agregados por UF/rede (fonte autoritativa do serie_temporal)
    print("\n  Carregando valores oficiais agregados (Regioes/UFs)...")
    OFICIAL = carregar_oficial_uf()
    if OFICIAL:
        print(f"  Redes oficiais disponiveis p/ RS: {sorted(OFICIAL.keys())}")

    # Pesos (matricula por serie avaliada) + mapa municipio->CRE para o por_cre
    print("\n  Carregando pesos e mapa de CREs (para media ponderada por regional)...")
    SERIE_WEIGHTS = load_serie_weights()
    MUN_TO_CRE = load_mun_to_cre()
    
    # Generate per-rede JSONs
    for rede_key, rede_filter in REDES.items():
        print(f"\n{'='*60}")
        print(f"  REDE: {rede_key.upper()}")
        print(f"{'='*60}")
        
        resultado = {
            "metadata": {
                "fonte": "IDEB/INEP — Divulgação 2025",
                "recorte": f"Rede {rede_key.title()} RS",
                "gerado_em": pd.Timestamp.now().isoformat(),
                "formula": "IDEB = N (Nota SAEB padronizada) × P (Indicador de Rendimento)",
            },
            "serie_temporal": {},
            "por_municipio": {},
            "por_cre": {},
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
            # Estadual/Municipal/Federal -> valor OFICIAL por municipio (INEP).
            # Privada/Todas nao constam no recorte municipal oficial -> media das escolas.
            rotulo_mun = REDE_OFICIAL_MUN_MAP.get(rede_key)
            mun_df = mun_dfs.get(etapa_key)
            if rotulo_mun and mun_df is not None:
                por_ano, lookup = extract_mun_all_years_oficial(mun_df, df, etapa_key, rotulo_mun)
            else:
                por_ano, lookup = extract_mun_all_years(df, etapa_key, rede_filter)
            all_lookup.update(lookup)
            
            for ano, mun_data in por_ano.items():
                if ano not in resultado["por_municipio"]:
                    resultado["por_municipio"][ano] = {}
                for cod, md in mun_data.items():
                    if cod not in resultado["por_municipio"][ano]:
                        resultado["por_municipio"][ano][cod] = {}
                    resultado["por_municipio"][ano][cod][etapa_key] = md

            # Per-CRE (todos os anos): MEDIA PONDERADA das escolas pela matricula
            # na serie avaliada (5o/9o/3oEM). Substitui a media por municipio no
            # nivel da regional, alinhando com o metodo da SEDUC-RS.
            if MUN_TO_CRE:
                cre_por_ano = extract_cre_all_years(df, etapa_key, rede_filter, SERIE_WEIGHTS, MUN_TO_CRE)
                for ano, cre_data in cre_por_ano.items():
                    if ano not in resultado["por_cre"]:
                        resultado["por_cre"][ano] = {}
                    for cre, md in cre_data.items():
                        if cre not in resultado["por_cre"][ano]:
                            resultado["por_cre"][ano][cre] = {}
                        resultado["por_cre"][ano][cre][etapa_key] = md

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
                "Valores oficiais agregados por UF/rede (INEP — divulgacao_regioes_ufs_ideb_2025). "
                "IDEB de rede = N x P calculado pelo INEP no nivel do aluno (nao e media das escolas)."
            )
            ult_em = resultado["serie_temporal"].get("2025", {}).get("EM", {}).get("ideb")
            print(f"  [OVERRIDE OFICIAL] {n_over} valores substituidos (rotulo '{rotulo}'). EM 2025 = {ult_em}")
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
