# -*- coding: utf-8 -*-
"""
ETL SAEB — Produto 4 UNESCO RS
Bases INEP/SEDUC por escola (Rede Estadual RS), anos 2017/2019/2021/2023/2025.
Escolas IDENTIFICADAS (codigo real 43..., nome). Estadual-only.

Gera 4_6_saeb_estadual.json (copiado p/ 4_6_saeb.json) com estrutura multi-ano:
  - metadata, anos
  - serie_temporal[ano]          -> media simples de escolas por etapa (LP/MT)
  - por_municipio[ano]           -> media simples por municipio/etapa
  - lookup_municipios            -> {cod7: nome}
  - por_escola[inep]             -> {nome, cod_mun, cre, lat, lng, anos:{ano:{etapa:{lp,mt,part_lp,part_mt,pres}}}}
  - padrao_desempenho[ano]       -> {estadual, por_cre, por_municipio} (ponderado por presentes)
  - cortes                       -> PADRAO_CORTES
Tambem gera SAEB_Evolucao_Escolas_Estaduais_RS.xlsx (nomes reais por ano).
"""
import sys, io

from paths import BASE, OUT_DIR, PAINEL_DIR  # noqa: E402

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import pandas as pd
import numpy as np
import json, os, time, unicodedata, shutil

# --- Bases identificadas por escola (INEP/SEDUC) ---
IDEB_DIR = os.path.join(
    BASE, "00. Bases de Dados",
    "02. Fluxo e Rendimento (Inep_2010_2024_Rendimento_TDI)", "02. IDEB")

SAEB_FILES = {
    "2017": "INEP_SAEB_2017_RS.xlsx",
    "2019": "INEP_SAEB_2019_RS.xlsx",
    "2021": "INEP_SAEB_2021_RS.xlsx",
    "2023": "INEP_SAEB_2023_RS.xlsx",
    "2025": "INEP_SAEB_2025_RS (1).xlsx",
}

# Base canonica de escolas estaduais (coordenadas p/ o mapa por escola).
ESCOLAS_GEO = os.path.join(PAINEL_DIR, "escolas_estaduais.json")
CRE_LOOKUP_FILE = os.path.join(PAINEL_DIR, "rs_cre_lookup.json")

ETAPA_LABEL = {"5EF": "5º Ano EF", "9EF": "9º Ano EF", "EM": "Ens. Médio"}

# Base (ponto inicial) dos NIVEIS da escala SAEB por etapa. Calibrado empiricamente
# reconstruindo a MEDIA a partir da distribuicao NIVEL 0..10 (bandas de 25 pontos):
#   Nivel 0 = abaixo da base; Nivel k = [base+(k-1)*25, base+k*25).
# 5EF base 125 | 9EF base 200 | EM base 225 (escala vertical, mesmos cortes p/ todos os anos).
NIVEL_BASE = {"5EF": 125, "9EF": 200, "EM": 225}

# Padrao de desempenho — pontos de corte na escala SAEB por etapa/disciplina.
# PRELIMINAR: referencia comum QEdu/Todos Pela Educacao. VALIDAR com a analise SAEB (Bruna).
# [c1, c2, c3] => Insuficiente < c1 <= Basico < c2 <= Proficiente < c3 <= Avancado
PADRAO_CORTES = {
    "5EF": {"lp": [150, 200, 250], "mt": [175, 225, 275]},
    "9EF": {"lp": [200, 275, 325], "mt": [225, 300, 350]},
    "EM":  {"lp": [250, 300, 375], "mt": [275, 350, 400]},
}


def _nivel_lo(n, et):
    """Limite inferior (pontos da escala SAEB) do NIVEL n na etapa `et`."""
    return NIVEL_BASE[et] + (n - 1) * 25


def _norm(s):
    """Normaliza texto p/ matching robusto (sem acento, upper)."""
    s = unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode('ascii')
    return s.strip().upper()


def _load_mun_to_cre():
    """mun (7 dig) -> cod_cre (ex '18') a partir de rs_cre_lookup.json."""
    try:
        with open(CRE_LOOKUP_FILE, encoding='utf-8') as f:
            d = json.load(f)
    except Exception as e:
        print(f"    [AVISO] rs_cre_lookup.json: {e}")
        return {}
    m = d.get('mun_to_cre', d)
    out = {}
    for k, v in m.items():
        out[str(k)[:7]] = str(v.get('cod_cre')) if isinstance(v, dict) else str(v)
    return out


def _load_escolas_geo():
    """inep(str) -> {lat, lng, cre} da base canonica de escolas estaduais."""
    out = {}
    if not os.path.exists(ESCOLAS_GEO):
        return out
    try:
        with open(ESCOLAS_GEO, encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        print(f"    [AVISO] escolas_estaduais.json: {e}")
        return out
    lst = data.get('escolas', data) if isinstance(data, dict) else data
    for e in lst:
        if not isinstance(e, dict):
            continue
        inep = e.get('inep') or e.get('ID_ESCOLA') or e.get('cod')
        if inep is None:
            continue
        try:
            key = str(int(inep))
        except Exception:
            continue
        out[key] = {'lat': e.get('lat'), 'lng': e.get('lng'), 'cre': str(e.get('cre') or '')}
    return out


def load_year(path):
    """Le uma base INEP_SAEB (aba Escolas) e retorna DataFrame normalizado:
    _inep, _cod(7), _nesc, _nmun, _serie(5EF/9EF/EM), _disc(lp/mt), _med, _part, _pres, _w, _n0.._n10."""
    df = pd.read_excel(path, sheet_name=0)
    cols = {_norm(c): c for c in df.columns}

    def col(*parts_options):
        for parts in parts_options:
            for nc, orig in cols.items():
                if all(p in nc for p in parts):
                    return orig
        return None

    c_esc = col(("CODIGO", "ESCOLA"), ("COD", "ESCOLA"))
    c_mun = col(("CODIGO", "MUNICIPIO"), ("COD", "MUNICIPIO"))
    c_nesc = col(("NOME", "ESCOLA"),)
    c_nmun = col(("NOME", "MUNICIPIO"),)
    c_disc = col(("DISCIPLINA",),)
    c_serie = col(("SERIE",),)
    c_med = col(("MEDIA",),)
    c_part = col(("TAXA", "PARTICIPACAO"), ("PARTICIPACAO",))
    c_pres = col(("PRESENTES",),)
    niv_cols = [next((orig for nc, orig in cols.items() if nc == f"NIVEL {n}"), None) for n in range(11)]

    missing = [name for name, c in [("cod_escola", c_esc), ("cod_mun", c_mun),
               ("disciplina", c_disc), ("serie", c_serie), ("media", c_med)] if c is None]
    if missing:
        raise ValueError(f"colunas ausentes em {os.path.basename(path)}: {missing}")

    out = pd.DataFrame()
    out['_serie'] = df[c_serie].astype(str).str.strip().str[0].map(
        {"5": "5EF", "9": "9EF", "3": "EM", "4": "EM"})
    out['_disc'] = df[c_disc].astype(str).apply(
        lambda x: "lp" if ("PORT" in _norm(x) or "LINGUA" in _norm(x)) else ("mt" if "MAT" in _norm(x) else None))
    out['_med'] = pd.to_numeric(df[c_med], errors='coerce')
    out['_part'] = pd.to_numeric(df[c_part], errors='coerce') if c_part else np.nan
    out['_pres'] = pd.to_numeric(df[c_pres], errors='coerce') if c_pres else 0
    out['_inep'] = pd.to_numeric(df[c_esc], errors='coerce')
    out['_cod'] = pd.to_numeric(df[c_mun], errors='coerce')
    out['_nesc'] = df[c_nesc].astype(str) if c_nesc else out['_inep'].astype(str)
    out['_nmun'] = df[c_nmun].astype(str) if c_nmun else ''
    for n in range(11):
        out[f'_n{n}'] = pd.to_numeric(df[niv_cols[n]], errors='coerce') if niv_cols[n] else np.nan

    out = out.dropna(subset=['_serie', '_disc', '_med', '_inep', '_cod']).copy()
    out['_w'] = out['_pres'].fillna(0)
    out['_inep'] = out['_inep'].astype('int64').astype(str)
    out['_cod'] = out['_cod'].astype('int64').astype(str).str[:7]
    return out


def _padrao_from_rows(rows, et, disc):
    """Distribuicao (%) nos 4 padroes, ponderada por PRESENTES, p/ etapa+disciplina."""
    cortes = PADRAO_CORTES[et][disc]
    tot = [0.0] * 11
    for _, r in rows.iterrows():
        w = r['_w']
        if not w or w <= 0:
            continue
        for n in range(11):
            v = r.get(f'_n{n}')
            if pd.notna(v):
                tot[n] += (float(v) / 100.0) * w
    total = sum(tot)
    if total <= 0:
        return None
    cats = {"insuf": 0.0, "basico": 0.0, "prof": 0.0, "avanc": 0.0}
    for n in range(11):
        lo = _nivel_lo(n, et)
        if lo < cortes[0]:
            cats["insuf"] += tot[n]
        elif lo < cortes[1]:
            cats["basico"] += tot[n]
        elif lo < cortes[2]:
            cats["prof"] += tot[n]
        else:
            cats["avanc"] += tot[n]
    return {k: round(v / total * 100, 1) for k, v in cats.items()}


def _padrao_block(rows):
    """Bloco {etapa: {disc: {4 padroes}}} p/ um recorte de linhas."""
    out = {}
    for et in ["5EF", "9EF", "EM"]:
        sub = rows[rows['_serie'] == et]
        if sub.empty:
            continue
        block = {}
        for disc in ["lp", "mt"]:
            sd = sub[sub['_disc'] == disc]
            if not sd.empty:
                p = _padrao_from_rows(sd, et, disc)
                if p:
                    block[disc] = p
        if block:
            out[et] = block
    return out


def _simple_mean(sub):
    return round(float(sub['_med'].mean()), 1) if not sub.empty else None


def main():
    t0 = time.time()
    print("=" * 60)
    print("ETL SAEB — Rede Estadual identificada por escola (2017-2025)")
    print("=" * 60)

    mun_to_cre = _load_mun_to_cre()
    geo = _load_escolas_geo()

    resultado = {
        "metadata": {
            "fonte": "INEP/SEDUC — SAEB por escola (Rede Estadual RS)",
            "recorte": "Rede Estadual RS",
            "gerado_em": pd.Timestamp.now().isoformat(),
        },
        "anos": [],
        "serie_temporal": {},
        "por_municipio": {},
        "lookup_municipios": {},
        "por_escola": {},
        "padrao_desempenho": {},
        "cortes": PADRAO_CORTES,
    }
    lookup = resultado["lookup_municipios"]
    por_escola = resultado["por_escola"]
    xlsx_rows = []

    for ano, fn in SAEB_FILES.items():
        p = os.path.join(IDEB_DIR, fn)
        if not os.path.exists(p):
            print(f"  [AVISO] {fn} nao encontrado — pulando {ano}")
            continue
        try:
            d = load_year(p)
        except Exception as e:
            print(f"  [ERRO] {ano}: {e}")
            continue
        if d.empty:
            print(f"  [AVISO] {ano}: base vazia")
            continue

        resultado["anos"].append(ano)
        d['_cre'] = d['_cod'].map(mun_to_cre).fillna('')

        for cod, nm in zip(d['_cod'], d['_nmun']):
            if nm and nm != 'nan':
                lookup.setdefault(cod, nm)

        # --- serie_temporal[ano] (media simples de escolas) ---
        serie = {"n_escolas_total": int(d['_inep'].nunique())}
        for et in ["5EF", "9EF", "EM"]:
            sub = d[d['_serie'] == et]
            if sub.empty:
                continue
            serie[et] = {
                "media_lp": _simple_mean(sub[sub['_disc'] == 'lp']),
                "media_mt": _simple_mean(sub[sub['_disc'] == 'mt']),
                "n_escolas": int(sub['_inep'].nunique()),
                "label": ETAPA_LABEL[et],
            }
        resultado["serie_temporal"][ano] = serie

        # --- por_municipio[ano] ---
        mun = {}
        for cod, g in d.groupby('_cod'):
            entry = {}
            for et in ["5EF", "9EF", "EM"]:
                s = g[g['_serie'] == et]
                if s.empty:
                    continue
                entry[et] = {
                    "media_lp": _simple_mean(s[s['_disc'] == 'lp']),
                    "media_mt": _simple_mean(s[s['_disc'] == 'mt']),
                }
            if entry:
                mun[cod] = entry
        resultado["por_municipio"][ano] = mun

        # --- padrao_desempenho[ano] ---
        padrao = {"estadual": _padrao_block(d), "por_cre": {}, "por_municipio": {}}
        for cod, g in d.groupby('_cod'):
            b = _padrao_block(g)
            if b:
                padrao["por_municipio"][cod] = b
        for cre, g in d.groupby('_cre'):
            if not cre:
                continue
            b = _padrao_block(g)
            if b:
                padrao["por_cre"][cre] = b
        resultado["padrao_desempenho"][ano] = padrao

        # --- por_escola (multi-ano) ---
        for inep, g in d.groupby('_inep'):
            rec = por_escola.get(inep)
            if rec is None:
                cod = str(g['_cod'].iloc[0])
                rec = {
                    "nome": str(g['_nesc'].iloc[0]),
                    "cod_mun": cod,
                    "cre": str(g['_cre'].iloc[0] or mun_to_cre.get(cod, '')),
                    "anos": {},
                }
                gg = geo.get(inep)
                if gg and gg.get('lat') is not None and gg.get('lng') is not None:
                    rec["lat"] = gg["lat"]
                    rec["lng"] = gg["lng"]
                por_escola[inep] = rec
            ad = {}
            for et in ["5EF", "9EF", "EM"]:
                s = g[g['_serie'] == et]
                if s.empty:
                    continue
                etd = {}
                lp = s[s['_disc'] == 'lp']
                mt = s[s['_disc'] == 'mt']
                if not lp.empty:
                    etd["lp"] = round(float(lp['_med'].iloc[0]), 1)
                    pv = lp['_part'].iloc[0]
                    etd["part_lp"] = None if pd.isna(pv) else round(float(pv), 1)
                    pr = lp['_pres'].iloc[0]
                    etd["pres"] = 0 if pd.isna(pr) else int(pr)
                if not mt.empty:
                    etd["mt"] = round(float(mt['_med'].iloc[0]), 1)
                    pv = mt['_part'].iloc[0]
                    etd["part_mt"] = None if pd.isna(pv) else round(float(pv), 1)
                    if "pres" not in etd:
                        pr = mt['_pres'].iloc[0]
                        etd["pres"] = 0 if pd.isna(pr) else int(pr)
                if etd:
                    ad[et] = etd
            if ad:
                rec["anos"][ano] = ad

        # --- linhas p/ XLSX ---
        for _, r in d.iterrows():
            xlsx_rows.append({
                "ANO": int(ano),
                "ID_ESCOLA": int(r['_inep']),
                "NOME_ESCOLA": r['_nesc'],
                "MUNICIPIO": r['_nmun'],
                "ETAPA": ETAPA_LABEL[r['_serie']],
                "DISC": r['_disc'].upper(),
                "MEDIA": r['_med'],
            })

        resumo = " | ".join(
            f"{et}:LP={serie[et]['media_lp']}/MT={serie[et]['media_mt']}"
            for et in ["5EF", "9EF", "EM"] if et in serie)
        print(f"  {ano}: {serie['n_escolas_total']} escolas | {resumo}")

    n_geo = sum(1 for r in por_escola.values() if 'lat' in r)
    print(f"\n  por_escola: {len(por_escola)} escolas ({n_geo} c/ coord) | "
          f"municipios={len(lookup)} | anos={resultado['anos']}")

    # --- Salvar JSON ---
    out_json = os.path.join(PAINEL_DIR, "4_6_saeb_estadual.json")
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(resultado, f, ensure_ascii=False, indent=2)
    print(f"  JSON: {os.path.basename(out_json)} ({os.path.getsize(out_json)/1024:.0f} KB)")

    for dst in [os.path.join(PAINEL_DIR, "4_6_saeb.json"), os.path.join(OUT_DIR, "4_6_saeb.json")]:
        if os.path.abspath(dst) != os.path.abspath(out_json):
            shutil.copy2(out_json, dst)
    print("  [COMPAT] Copiado -> 4_6_saeb.json")

    # --- XLSX evolucao por escola (nomes reais por ano) ---
    if xlsx_rows:
        print("\n  Gerando XLSX evolucao por escola...")
        df_all = pd.DataFrame(xlsx_rows)
        xlsx_path = os.path.join(BASE, "SAEB_Evolucao_Escolas_Estaduais_RS.xlsx")
        try:
            with pd.ExcelWriter(xlsx_path, engine='openpyxl') as writer:
                for etapa_label in ["5º Ano EF", "9º Ano EF", "Ens. Médio"]:
                    de = df_all[df_all['ETAPA'] == etapa_label]
                    if de.empty:
                        continue
                    piv_lp = de[de['DISC'] == 'LP'].pivot_table(
                        index='ID_ESCOLA', columns='ANO', values='MEDIA', aggfunc='first')
                    piv_lp.columns = [f"LP_{c}" for c in piv_lp.columns]
                    piv_mt = de[de['DISC'] == 'MT'].pivot_table(
                        index='ID_ESCOLA', columns='ANO', values='MEDIA', aggfunc='first')
                    piv_mt.columns = [f"MT_{c}" for c in piv_mt.columns]
                    piv = piv_lp.join(piv_mt, how='outer')
                    nomes = de.drop_duplicates('ID_ESCOLA').set_index('ID_ESCOLA')[['NOME_ESCOLA', 'MUNICIPIO']]
                    piv = nomes.join(piv, how='right').reset_index()
                    sheet = etapa_label.replace("º", "").replace(" ", "_")[:31]
                    piv.to_excel(writer, sheet_name=sheet, index=False)
                    print(f"    Aba '{sheet}': {len(piv)} escolas")
            print(f"  XLSX: {xlsx_path}")
        except Exception as e:
            print(f"  [AVISO] XLSX nao gerado: {e}")

    print(f"\nTempo total: {time.time()-t0:.1f}s")


if __name__ == "__main__":
    main()
