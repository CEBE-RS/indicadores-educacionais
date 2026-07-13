# -*- coding: utf-8 -*-
"""
ETL Redes - consolida visao cross-rede a partir dos JSONs ja gerados.
Gera painel/dados/4_1_redes.json (sem reler microdados).

Fonte: Censo Escolar INEP via 4_1_acesso_*.json + 4_5_docentes_*.json
"""
import sys, io, json, os, datetime


# --- caminhos portateis (repo Git + bases locais) ---
from paths import BASE, OUT_DIR, PAINEL_DIR, BASES_DIR, BASES_BASICAS  # noqa: E402

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

REDE_FILES = {
    "Federal": "federal",
    "Estadual": "estadual",
    "Municipal": "municipal",
    "Privada": "privada",
}
REDE_COLORS = {
    "Federal": "#7B1FA2",
    "Estadual": "#0D47A1",
    "Municipal": "#00897B",
    "Privada": "#F57C00",
}

def load_json(name):
    path = os.path.join(OUT_DIR, name)
    if not os.path.exists(path):
        print(f"  [AVISO] ausente: {name}")
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def safe_int(v):
    if v is None:
        return None
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return None

def oferta_from_acesso(acesso, ano):
    if not acesso:
        return {"mat_diurno": None, "mat_noturno": None, "mat_integral": None}
    st = (acesso.get("serie_temporal") or {}).get(ano) or {}
    turno = st.get("por_turno") or {}
    diurno = safe_int(turno.get("QT_MAT_BAS_D"))
    noturno = safe_int(turno.get("QT_MAT_BAS_N"))
    if noturno is None:
        noturno = safe_int(st.get("mat_noturno"))
    if diurno is None and st.get("mat_total") is not None and noturno is not None:
        diurno = max(0, safe_int(st["mat_total"]) - noturno)

    integ = (acesso.get("integral") or {}).get(ano) or {}
    parts = [integ.get(k) for k in ("fund_total", "medio", "infantil") if integ.get(k) is not None]
    mat_integral = safe_int(sum(parts)) if parts else None
    if mat_integral is None:
        parts2 = [integ.get(k) for k in ("fund_ai", "fund_af", "medio", "infantil") if integ.get(k) is not None]
        mat_integral = safe_int(sum(parts2)) if parts2 else None

    def duo(d_key, n_key, mat_key=None):
        d = safe_int(turno.get(d_key))
        n = safe_int(turno.get(n_key))
        if d is None and n is None and mat_key:
            # fallback: so noturno da serie + resto diurno
            n = safe_int(st.get(mat_key.replace("mat_", "mat_noturno_") if False else None))
        return d, n

    fund_d, fund_n = duo("QT_MAT_FUND_D", "QT_MAT_FUND_N")
    if fund_n is None:
        fund_n = safe_int(st.get("mat_noturno_fund"))
    if fund_d is None and st.get("mat_fundamental") is not None and fund_n is not None:
        fund_d = max(0, safe_int(st["mat_fundamental"]) - fund_n)

    med_d, med_n = duo("QT_MAT_MED_D", "QT_MAT_MED_N")
    if med_n is None:
        med_n = safe_int(st.get("mat_noturno_medio") or st.get("mat_noturno_med"))
    if med_d is None and st.get("mat_medio") is not None and med_n is not None:
        med_d = max(0, safe_int(st["mat_medio"]) - med_n)

    eja_d, eja_n = duo("QT_MAT_EJA_D", "QT_MAT_EJA_N")
    if eja_n is None:
        eja_n = safe_int(st.get("mat_noturno_eja"))
    if eja_d is None and st.get("mat_eja") is not None and eja_n is not None:
        eja_d = max(0, safe_int(st["mat_eja"]) - eja_n)

    # Infantil: quase sempre diurno; se nao houver turno, usa total como diurno
    inf_d = safe_int(turno.get("QT_MAT_INF_D"))
    inf_n = safe_int(turno.get("QT_MAT_INF_N")) or 0
    if inf_d is None and st.get("mat_infantil") is not None:
        inf_d = max(0, safe_int(st["mat_infantil"]) - (inf_n or 0))

    return {
        "mat_diurno": diurno,
        "mat_noturno": noturno,
        "mat_integral": mat_integral,
        "int_fund": safe_int(integ.get("fund_total")),
        "int_fund_ai": safe_int(integ.get("fund_ai")),
        "int_fund_af": safe_int(integ.get("fund_af")),
        "int_medio": safe_int(integ.get("medio")),
        "int_infantil": safe_int(integ.get("infantil")),
        "mat_diurno_fund": fund_d,
        "mat_noturno_fund": fund_n,
        "mat_diurno_medio": med_d,
        "mat_noturno_medio": med_n,
        "mat_diurno_eja": eja_d,
        "mat_noturno_eja": eja_n,
        "mat_diurno_infantil": inf_d,
        "mat_noturno_infantil": inf_n,
    }

def docentes_ano(doc, ano):
    if not doc:
        return None
    st = (doc.get("serie_temporal_total") or {}).get(ano) or {}
    return safe_int(st.get("QT_DOC_BAS"))

def main():
    print("=== ETL Redes (consolidacao) ===")
    todas = load_json("4_1_acesso_todas.json")
    if not todas or "por_dependencia" not in todas:
        raise SystemExit("4_1_acesso_todas.json com por_dependencia e obrigatorio")

    acesso_rede = {}
    doc_rede = {}
    for label, key in REDE_FILES.items():
        acesso_rede[label] = load_json(f"4_1_acesso_{key}.json")
        doc_rede[label] = load_json(f"4_5_docentes_{key}.json")

    anos = sorted(todas["por_dependencia"].keys())
    por_rede = {}
    for ano in anos:
        por_rede[ano] = {}
        base = todas["por_dependencia"].get(ano) or {}
        for label in REDE_FILES:
            row = dict(base.get(label) or {})
            for k in ("escolas", "mat_total", "mat_infantil", "mat_fundamental", "mat_fund_ai", "mat_fund_af", "mat_medio", "mat_eja"):
                if k in row:
                    row[k] = safe_int(row[k])
            # AI/AF: por_dependencia pode nao ter (JSONs antigos) — completa via serie_temporal da rede
            st_rede = ((acesso_rede[label] or {}).get("serie_temporal") or {}).get(ano) or {}
            if row.get("mat_fund_ai") is None:
                row["mat_fund_ai"] = safe_int(st_rede.get("mat_fund_ai"))
            if row.get("mat_fund_af") is None:
                row["mat_fund_af"] = safe_int(st_rede.get("mat_fund_af"))
            row["docentes"] = docentes_ano(doc_rede[label], ano)
            row.update(oferta_from_acesso(acesso_rede[label], ano))
            # AI/AF sem noturno publicado no Censo — trata como diurno
            if row.get("mat_fund_ai") is not None:
                row["mat_diurno_fund_ai"] = row["mat_fund_ai"]
                row["mat_noturno_fund_ai"] = 0
            if row.get("mat_fund_af") is not None:
                row["mat_diurno_fund_af"] = row["mat_fund_af"]
                row["mat_noturno_fund_af"] = 0
            if row.get("docentes") and row.get("mat_total"):
                row["razao_ap"] = round(row["mat_total"] / row["docentes"], 1)
            else:
                row["razao_ap"] = None
            por_rede[ano][label] = row

    out = {
        "metadata": {
            "titulo": "Oferta educacional por rede (mantenedora) - RS",
            "fonte": "INEP - Censo Escolar da Educacao Basica",
            "abrangencia": "Rio Grande do Sul - todas as dependencias administrativas",
            "anos": anos,
            "redes": list(REDE_FILES.keys()),
            "cores": REDE_COLORS,
            "nota": (
                "Agregado a partir dos JSONs do painel (por_dependencia + serie por rede + docentes). "
                "Privada = TP_DEPENDENCIA=4 (inclui filantropica). "
                "Integral disponivel a partir dos anos em que o Censo publica QT_MAT_*_INT."
            ),
            "gerado_em": datetime.datetime.now().strftime("%Y-%m-%d"),
        },
        "por_rede": por_rede,
    }

    out_path = os.path.join(OUT_DIR, "4_1_redes.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    size_kb = os.path.getsize(out_path) / 1024
    print(f"OK -> {out_path} ({size_kb:.1f} KB)")
    y = por_rede.get("2025") or por_rede[anos[-1]]
    for r, v in y.items():
        print(f"  {r}: esc={v.get('escolas')} mat={v.get('mat_total')} doc={v.get('docentes')} not={v.get('mat_noturno')} int={v.get('mat_integral')}")

if __name__ == "__main__":
    main()
