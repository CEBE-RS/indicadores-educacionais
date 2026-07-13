# -*- coding: utf-8 -*-
"""
ETL Infraestrutura e Perfil Docente — Produto 4 UNESCO RS
Extrai IN_* (infra) e QT_DOC_* (docentes) do Censo Escolar RS.
Gera JSONs separados para o painel.
"""
import sys, io

# --- caminhos portateis (repo Git + bases locais) ---
from paths import BASE, OUT_DIR, PAINEL_DIR, BASES_DIR, BASES_BASICAS  # noqa: E402

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import pandas as pd
import numpy as np
import json, os, glob, time

MICRO_DIR = None  # resolved dynamically
CO_UF_RS = 43

# Configuracao multi-rede (mesma do etl_censo_escolar.py)
REDES = {
    'estadual':      {'dep': [2], 'cat_priv': None},
    'municipal':     {'dep': [3], 'cat_priv': None},
    'federal':       {'dep': [1], 'cat_priv': None},
    'filantropica':  {'dep': [4], 'cat_priv': 4},
    'privada':       {'dep': [4], 'cat_priv': None},
    'todas':         {'dep': [1, 2, 3, 4], 'cat_priv': None},
}

MICRO_DIR = os.path.join(BASE, "00. Bases de Dados", "01. Acesso e Matrículas (Censo Escolar_2010_2025)", "01. extrações_2010_2025")

# ══════════════════════════════════════════════════════════
# INFRAESTRUTURA INDICATORS — curated set of 30 key indicators
# ══════════════════════════════════════════════════════════

INFRA_INDICATORS = {
    # Tecnologia
    "IN_INTERNET": "Acesso a Internet",
    "IN_BANDA_LARGA": "Banda Larga",
    "IN_COMPUTADOR": "Computador",
    "IN_DESKTOP_ALUNO": "Desktop para Alunos",
    "IN_COMP_PORTATIL_ALUNO": "Notebook para Alunos",
    "IN_TABLET_ALUNO": "Tablet para Alunos",
    "IN_LABORATORIO_INFORMATICA": "Lab. Informatica",
    "IN_EQUIP_LOUSA_DIGITAL": "Lousa Digital",
    "IN_EQUIP_MULTIMIDIA": "Projetor Multimidia",
    # Espacos Pedagogicos
    "IN_BIBLIOTECA": "Biblioteca",
    "IN_BIBLIOTECA_SALA_LEITURA": "Biblioteca ou Sala de Leitura",
    "IN_LABORATORIO_CIENCIAS": "Lab. Ciencias",
    "IN_QUADRA_ESPORTES": "Quadra de Esportes",
    "IN_QUADRA_ESPORTES_COBERTA": "Quadra Coberta",
    "IN_PARQUE_INFANTIL": "Parque Infantil",
    "IN_PATIO_COBERTO": "Patio Coberto",
    "IN_AUDITORIO": "Auditorio",
    "IN_SALA_ATENDIMENTO_ESPECIAL": "Sala Atend. Especial (AEE)",
    "IN_REFEITORIO": "Refeitorio",
    # Acessibilidade
    "IN_ACESSIBILIDADE_RAMPAS": "Rampas",
    "IN_ACESSIBILIDADE_CORRIMAO": "Corrimao",
    "IN_ACESSIBILIDADE_ELEVADOR": "Elevador",
    "IN_ACESSIBILIDADE_PISOS_TATEIS": "Pisos Tateis",
    "IN_BANHEIRO_PNE": "Banheiro PNE",
    "IN_ACESSIBILIDADE_VAO_LIVRE": "Vao Livre",
    "IN_ACESSIBILIDADE_SINAL_SONORO": "Sinal Sonoro",
    "IN_ACESSIBILIDADE_SINAL_TATIL": "Sinal Tatil",
    "IN_ACESSIBILIDADE_SINAL_VISUAL": "Sinal Visual",
    "IN_ACESSIBILIDADE_SINALIZACAO": "Sinalizacao",
    "IN_ACESSIBILIDADE_INEXISTENTE": "Sem Acessibilidade",
    # Saneamento e Energia
    "IN_AGUA_REDE_PUBLICA": "Agua Rede Publica",
    "IN_ESGOTO_REDE_PUBLICA": "Esgoto Rede Publica",
    "IN_ENERGIA_REDE_PUBLICA": "Energia Rede Publica",
    "IN_AGUA_POTAVEL": "Agua Potavel",
    "IN_ESGOTO_FOSSA_SEPTICA": "Fossa Septica",
    # Alimentacao
    "IN_ALIMENTACAO": "Alimentacao Escolar",
    "IN_COZINHA": "Cozinha",
    # Estrutura Administrativa
    "IN_SALA_DIRETORIA": "Sala Diretoria",
    "IN_SALA_PROFESSOR": "Sala Professores",
    "IN_SECRETARIA": "Secretaria",
    "IN_ALMOXARIFADO": "Almoxarifado",
    "IN_DESPENSA": "Despensa",
    "IN_BANHEIRO": "Banheiro",
    "IN_BANHEIRO_FUNCIONARIOS": "Banheiro Funcionarios",
    "IN_BANHEIRO_CHUVEIRO": "Banheiro Chuveiro",
    "IN_BANHEIRO_EI": "Banheiro Ed. Infantil",
    # Espacos Adicionais
    "IN_QUADRA_ESPORTES_DESCOBERTA": "Quadra Descoberta",
    "IN_PATIO_DESCOBERTO": "Patio Descoberto",
    "IN_AREA_VERDE": "Area Verde",
    "IN_SALA_LEITURA": "Sala de Leitura",
    "IN_SALA_MUSICA_CORAL": "Sala Musica/Coral",
    "IN_LABORATORIO_EDUC_PROF": "Lab. Ed. Profissional",
    "IN_PISCINA": "Piscina",
    # Sustentabilidade
    "IN_LIXO_SERVICO_COLETA": "Coleta de Lixo",
    "IN_TRATAMENTO_LIXO_SEPARACAO": "Separacao de Lixo",
    "IN_TRATAMENTO_LIXO_RECICLAGEM": "Reciclagem",
    "IN_TRATAMENTO_LIXO_INEXISTENTE": "Sem Tratamento Lixo",
    # Climatizacao (derivado de QT_SALAS_UTILIZA_CLIMATIZADAS)
    "IN_CLIMATIZACAO": "Climatização",
}

INFRA_CATEGORIES = {
    "Tecnologia": ["IN_INTERNET","IN_BANDA_LARGA","IN_COMPUTADOR","IN_DESKTOP_ALUNO",
                   "IN_COMP_PORTATIL_ALUNO","IN_TABLET_ALUNO","IN_LABORATORIO_INFORMATICA",
                   "IN_EQUIP_LOUSA_DIGITAL","IN_EQUIP_MULTIMIDIA"],
    "Espacos Pedagogicos": ["IN_BIBLIOTECA","IN_BIBLIOTECA_SALA_LEITURA","IN_LABORATORIO_CIENCIAS",
                            "IN_QUADRA_ESPORTES","IN_QUADRA_ESPORTES_COBERTA","IN_QUADRA_ESPORTES_DESCOBERTA",
                            "IN_PARQUE_INFANTIL","IN_PATIO_COBERTO","IN_PATIO_DESCOBERTO",
                            "IN_AUDITORIO","IN_SALA_ATENDIMENTO_ESPECIAL","IN_REFEITORIO",
                            "IN_SALA_LEITURA","IN_SALA_MUSICA_CORAL","IN_LABORATORIO_EDUC_PROF","IN_PISCINA"],
    "Estrutura Administrativa": ["IN_SALA_DIRETORIA","IN_SALA_PROFESSOR","IN_SECRETARIA",
                                  "IN_ALMOXARIFADO","IN_DESPENSA","IN_BANHEIRO",
                                  "IN_BANHEIRO_FUNCIONARIOS","IN_BANHEIRO_CHUVEIRO","IN_BANHEIRO_EI"],
    "Acessibilidade": ["IN_ACESSIBILIDADE_RAMPAS","IN_ACESSIBILIDADE_CORRIMAO",
                       "IN_ACESSIBILIDADE_ELEVADOR","IN_ACESSIBILIDADE_PISOS_TATEIS","IN_BANHEIRO_PNE",
                       "IN_ACESSIBILIDADE_VAO_LIVRE","IN_ACESSIBILIDADE_SINAL_SONORO",
                       "IN_ACESSIBILIDADE_SINAL_TATIL","IN_ACESSIBILIDADE_SINAL_VISUAL",
                       "IN_ACESSIBILIDADE_SINALIZACAO","IN_ACESSIBILIDADE_INEXISTENTE"],
    "Saneamento e Energia": ["IN_AGUA_REDE_PUBLICA","IN_ESGOTO_REDE_PUBLICA",
                             "IN_ENERGIA_REDE_PUBLICA","IN_AGUA_POTAVEL","IN_ESGOTO_FOSSA_SEPTICA"],
    "Alimentacao": ["IN_ALIMENTACAO","IN_COZINHA"],
    "Sustentabilidade": ["IN_LIXO_SERVICO_COLETA","IN_TRATAMENTO_LIXO_SEPARACAO",
                         "IN_TRATAMENTO_LIXO_RECICLAGEM","IN_TRATAMENTO_LIXO_INEXISTENTE"],
    "Espacos Adicionais": ["IN_AREA_VERDE"],
    "Climatizacao": ["IN_CLIMATIZACAO"],
}

# Colunas de quantidade de salas (para calcular indicador derivado de climatização)
COLS_SALAS = ["QT_SALAS_UTILIZADAS", "QT_SALAS_UTILIZA_CLIMATIZADAS"]

# ══════════════════════════════════════════════════════════
# DOCENTE PROFILE — from Tabela_Docente_2025
# ══════════════════════════════════════════════════════════

DOC_COLS_PERFIL = {
    "total": "QT_DOC_BAS",
    "por_sexo": ["QT_DOC_BAS_FEM","QT_DOC_BAS_MASC","QT_DOC_BAS_ND"],
    "por_raca": ["QT_DOC_BAS_BRANCA","QT_DOC_BAS_PRETA","QT_DOC_BAS_PARDA",
                 "QT_DOC_BAS_AMARELA","QT_DOC_BAS_INDIGENA"],
    "por_faixa_etaria": ["QT_DOC_BAS_0_24","QT_DOC_BAS_25_29","QT_DOC_BAS_30_39",
                         "QT_DOC_BAS_40_49","QT_DOC_BAS_50_54","QT_DOC_BAS_55_59","QT_DOC_BAS_60_MAIS"],
    "por_escolaridade": ["QT_DOC_BAS_ESCO_EF","QT_DOC_BAS_ESCO_EM",
                         "QT_DOC_BAS_ESCO_SUP_GRAD","QT_DOC_BAS_ESCO_SUP_GRAD_LICEN",
                         "QT_DOC_BAS_ESCO_SUP_GRAD_SLICEN"],
    "por_pos": ["QT_DOC_BAS_ESCO_SUP_POS_ESPEC","QT_DOC_BAS_ESCO_SUP_POS_MESTRA",
                "QT_DOC_BAS_ESCO_SUP_POS_DOUTO","QT_DOC_BAS_ESCO_SUP_POS_NENHUM"],
    "por_vinculo": ["QT_DOC_BAS_VINCULO_CONCUR","QT_DOC_BAS_VINCULO_CONTRA",
                    "QT_DOC_BAS_VINCULO_TERCEIR","QT_DOC_BAS_VINCULO_CLT"],
    "por_etapa": ["QT_DOC_INF","QT_DOC_FUND_AI","QT_DOC_FUND_AF","QT_DOC_MED","QT_DOC_EJA","QT_DOC_ESP"],
}

DOC_LABELS = {
    "QT_DOC_BAS_FEM": "Feminino", "QT_DOC_BAS_MASC": "Masculino", "QT_DOC_BAS_ND": "Nao Declarado",
    "QT_DOC_BAS_BRANCA": "Branca", "QT_DOC_BAS_PRETA": "Preta", "QT_DOC_BAS_PARDA": "Parda",
    "QT_DOC_BAS_AMARELA": "Amarela", "QT_DOC_BAS_INDIGENA": "Indigena",
    "QT_DOC_BAS_0_24": "Ate 24", "QT_DOC_BAS_25_29": "25-29", "QT_DOC_BAS_30_39": "30-39",
    "QT_DOC_BAS_40_49": "40-49", "QT_DOC_BAS_50_54": "50-54", "QT_DOC_BAS_55_59": "55-59",
    "QT_DOC_BAS_60_MAIS": "60+",
    "QT_DOC_BAS_ESCO_EF": "Ens. Fundamental", "QT_DOC_BAS_ESCO_EM": "Ens. Medio",
    "QT_DOC_BAS_ESCO_SUP_GRAD": "Superior", "QT_DOC_BAS_ESCO_SUP_GRAD_LICEN": "Licenciatura",
    "QT_DOC_BAS_ESCO_SUP_GRAD_SLICEN": "Sup. sem Licenciatura",
    "QT_DOC_BAS_ESCO_SUP_POS_ESPEC": "Especializacao", "QT_DOC_BAS_ESCO_SUP_POS_MESTRA": "Mestrado",
    "QT_DOC_BAS_ESCO_SUP_POS_DOUTO": "Doutorado", "QT_DOC_BAS_ESCO_SUP_POS_NENHUM": "Sem Pos",
    "QT_DOC_BAS_VINCULO_CONCUR": "Concursado", "QT_DOC_BAS_VINCULO_CONTRA": "Contratado",
    "QT_DOC_BAS_VINCULO_TERCEIR": "Terceirizado", "QT_DOC_BAS_VINCULO_CLT": "CLT",
    "QT_DOC_INF": "Infantil", "QT_DOC_FUND_AI": "Fund. AI", "QT_DOC_FUND_AF": "Fund. AF",
    "QT_DOC_MED": "Medio", "QT_DOC_EJA": "EJA", "QT_DOC_ESP": "Especial",
}


def safe_int(v):
    return 0 if pd.isna(v) else int(v)

def safe_pct(num, den):
    return round(num / den * 100, 1) if den > 0 else 0


# ══════════════════════════════════════════════════════════
# ETL INFRAESTRUTURA
# ══════════════════════════════════════════════════════════

def etl_infraestrutura():
    print("\n" + "=" * 60)
    print("ETL INFRAESTRUTURA ESCOLAR RS (MULTI-REDE)")
    print("=" * 60)

    # Process each year — read ALL schools once per CSV
    micros = sorted(glob.glob(os.path.join(MICRO_DIR, "microdados_ed_basica_*.*")))
    id_cols = ["CO_UF","CO_MUNICIPIO","CO_ENTIDADE","TP_DEPENDENCIA","TP_CATEGORIA_ESCOLA_PRIVADA","TP_LOCALIZACAO","TP_SITUACAO_FUNCIONAMENTO"]

    # Store raw DataFrames per year for re-filtering
    dfs_por_ano = {}  # {ano_str: DataFrame}

    print("\n  [1/2] Lendo microdados (todas as redes)...")
    for fpath in micros:
        fname = os.path.basename(fpath)
        ano = fname.replace("microdados_ed_basica_","").replace(".csv","").replace(".CSV","")
        print(f"    {ano}...", end=" ", flush=True)
        t0 = time.time()

        header = pd.read_csv(fpath, sep=";", encoding="latin-1", nrows=0)
        avail = [c for c in list(INFRA_INDICATORS.keys()) if c in header.columns and c != "IN_CLIMATIZACAO"]
        salas_avail = [c for c in COLS_SALAS if c in header.columns]
        use_id = [c for c in id_cols if c in header.columns]
        use = use_id + avail + salas_avail

        df = pd.read_csv(fpath, sep=";", encoding="latin-1", usecols=use)
        # Filtra RS + ativas (SEM filtro de rede)
        df = df[(df["CO_UF"] == CO_UF_RS) & (df["TP_SITUACAO_FUNCIONAMENTO"] == 1)]
        if 'TP_CATEGORIA_ESCOLA_PRIVADA' in df.columns:
            df['TP_CATEGORIA_ESCOLA_PRIVADA'] = df['TP_CATEGORIA_ESCOLA_PRIVADA'].fillna(0).astype(int)

        dfs_por_ano[ano] = (df, avail)
        elapsed = time.time() - t0
        print(f"{len(df)} escolas ({elapsed:.1f}s)")

    # 2025 vem na estrutura nova (Tabela_Escola_2025), com as mesmas colunas IN_* / QT_SALAS_*
    f_esc_2025 = os.path.join(MICRO_DIR, "Tabela_Escola_2025.csv")
    if os.path.exists(f_esc_2025):
        print("    2025 (Tabela_Escola)...", end=" ", flush=True)
        t0 = time.time()
        header = pd.read_csv(f_esc_2025, sep=";", encoding="latin-1", nrows=0)
        avail = [c for c in list(INFRA_INDICATORS.keys()) if c in header.columns and c != "IN_CLIMATIZACAO"]
        salas_avail = [c for c in COLS_SALAS if c in header.columns]
        use_id = [c for c in id_cols if c in header.columns]
        use = use_id + avail + salas_avail
        df = pd.read_csv(f_esc_2025, sep=";", encoding="latin-1", usecols=use)
        df = df[(df["CO_UF"] == CO_UF_RS) & (df["TP_SITUACAO_FUNCIONAMENTO"] == 1)]
        if 'TP_CATEGORIA_ESCOLA_PRIVADA' in df.columns:
            df['TP_CATEGORIA_ESCOLA_PRIVADA'] = df['TP_CATEGORIA_ESCOLA_PRIVADA'].fillna(0).astype(int)
        dfs_por_ano["2025"] = (df, avail)
        print(f"{len(df)} escolas ({time.time()-t0:.1f}s)")

    anos_sorted = sorted(dfs_por_ano.keys())

    # [2/2] Gerar JSON para cada rede
    print("\n  [2/2] Gerando JSONs por rede...")
    for rede_key, rede_cfg in REDES.items():
        print(f"\n    {'─' * 40}")
        print(f"    REDE INFRA: {rede_key.upper()}")
        print(f"    {'─' * 40}")

        resultado = {
            "metadata": {"fonte": "Censo Escolar INEP — IN_*", "uf": "RS", "rede": rede_key,
                          "gerado_em": pd.Timestamp.now().isoformat()},
            "categorias": INFRA_CATEGORIES,
            "labels": INFRA_INDICATORS,
            "serie_temporal": {},
            "por_dependencia": {},
            "por_localizacao": {},
            "por_municipio": {},
        }

        for ano in anos_sorted:
            df_full, avail = dfs_por_ano[ano]

            # Filtrar por rede
            df = df_full[df_full["TP_DEPENDENCIA"].isin(rede_cfg['dep'])].copy()
            if rede_cfg['cat_priv'] is not None:
                if 'TP_CATEGORIA_ESCOLA_PRIVADA' in df.columns:
                    df = df[df['TP_CATEGORIA_ESCOLA_PRIVADA'] == rede_cfg['cat_priv']]
                else:
                    df = df.iloc[0:0]

            n = len(df)
            if n == 0:
                continue

            # Estadual aggregate
            stats = {}
            for col in avail:
                count = int(df[col].sum())
                stats[col] = {"count": count, "pct": safe_pct(count, n)}
            if "QT_SALAS_UTILIZA_CLIMATIZADAS" in df.columns:
                clim_count = int((df["QT_SALAS_UTILIZA_CLIMATIZADAS"] > 0).sum())
                stats["IN_CLIMATIZACAO"] = {"count": clim_count, "pct": safe_pct(clim_count, n)}
                if "QT_SALAS_UTILIZADAS" in df.columns:
                    total_salas = int(df["QT_SALAS_UTILIZADAS"].sum())
                    total_clim = int(df["QT_SALAS_UTILIZA_CLIMATIZADAS"].sum())
                    stats["PCT_SALAS_CLIMATIZADAS"] = {"total_salas": total_salas, "total_clim": total_clim, "pct": safe_pct(total_clim, total_salas)}
            resultado["serie_temporal"][ano] = {"total_escolas": n, "indicadores": stats}

            # Por dependencia (within filtered set — useful for 'todas')
            dep_map = {1:"Federal", 2:"Estadual", 3:"Municipal", 4:"Privada"}
            resultado["por_dependencia"][ano] = {}
            for dep_cod, dep_nome in dep_map.items():
                dd = df[df["TP_DEPENDENCIA"] == dep_cod]
                nd = len(dd)
                dep_stats = {}
                for col in avail:
                    c = int(dd[col].sum())
                    dep_stats[col] = {"count": c, "pct": safe_pct(c, nd)}
                if "QT_SALAS_UTILIZA_CLIMATIZADAS" in dd.columns:
                    dep_stats["IN_CLIMATIZACAO"] = {"count": int((dd["QT_SALAS_UTILIZA_CLIMATIZADAS"] > 0).sum()), "pct": safe_pct(int((dd["QT_SALAS_UTILIZA_CLIMATIZADAS"] > 0).sum()), nd)}
                    if "QT_SALAS_UTILIZADAS" in dd.columns:
                        ts = int(dd["QT_SALAS_UTILIZADAS"].fillna(0).sum())
                        tc = int(dd["QT_SALAS_UTILIZA_CLIMATIZADAS"].fillna(0).sum())
                        dep_stats["PCT_SALAS_CLIMATIZADAS"] = {"total_salas": ts, "total_clim": tc, "pct": safe_pct(tc, ts)}
                resultado["por_dependencia"][ano][dep_nome] = {"escolas": nd, "indicadores": dep_stats}

            # Por localizacao
            resultado["por_localizacao"][ano] = {}
            for loc, nome in {1:"Urbana", 2:"Rural"}.items():
                dl = df[df["TP_LOCALIZACAO"] == loc]
                nl = len(dl)
                loc_stats = {}
                for col in avail:
                    c = int(dl[col].sum())
                    loc_stats[col] = {"count": c, "pct": safe_pct(c, nl)}
                if "QT_SALAS_UTILIZA_CLIMATIZADAS" in dl.columns:
                    loc_stats["IN_CLIMATIZACAO"] = {"count": int((dl["QT_SALAS_UTILIZA_CLIMATIZADAS"] > 0).sum()), "pct": safe_pct(int((dl["QT_SALAS_UTILIZA_CLIMATIZADAS"] > 0).sum()), nl)}
                    if "QT_SALAS_UTILIZADAS" in dl.columns:
                        ts = int(dl["QT_SALAS_UTILIZADAS"].fillna(0).sum())
                        tc = int(dl["QT_SALAS_UTILIZA_CLIMATIZADAS"].fillna(0).sum())
                        loc_stats["PCT_SALAS_CLIMATIZADAS"] = {"total_salas": ts, "total_clim": tc, "pct": safe_pct(tc, ts)}
                resultado["por_localizacao"][ano][nome] = {"escolas": nl, "indicadores": loc_stats}

            # Por municipio (ultimo ano apenas)
            if ano == anos_sorted[-1]:
                mun_agg = {}
                for cod, grp in df.groupby("CO_MUNICIPIO"):
                    nm = len(grp)
                    ms = {}
                    for col in avail:
                        c = int(grp[col].sum())
                        ms[col] = {"count": c, "pct": safe_pct(c, nm)}
                    if "QT_SALAS_UTILIZA_CLIMATIZADAS" in grp.columns:
                        ms["IN_CLIMATIZACAO"] = {"count": int((grp["QT_SALAS_UTILIZA_CLIMATIZADAS"] > 0).sum()), "pct": safe_pct(int((grp["QT_SALAS_UTILIZA_CLIMATIZADAS"] > 0).sum()), nm)}
                        if "QT_SALAS_UTILIZADAS" in grp.columns:
                            ts = int(grp["QT_SALAS_UTILIZADAS"].fillna(0).sum())
                            tc = int(grp["QT_SALAS_UTILIZA_CLIMATIZADAS"].fillna(0).sum())
                            ms["PCT_SALAS_CLIMATIZADAS"] = {"total_salas": ts, "total_clim": tc, "pct": safe_pct(tc, ts)}
                    mun_agg[str(int(cod))] = {"escolas": nm, "indicadores": ms}
                resultado["por_municipio"][ano] = mun_agg

        # Save
        out = os.path.join(OUT_DIR, f"4_5_infra_{rede_key}.json")
        with open(out, "w", encoding="utf-8") as f:
            json.dump(resultado, f, ensure_ascii=False, indent=None, separators=(',',':'))
        size_mb = os.path.getsize(out) / 1024 / 1024
        n_anos = len(resultado['serie_temporal'])
        print(f"    Salvo: {os.path.basename(out)} ({size_mb:.1f} MB, {n_anos} anos)")

    # Backward compatibility: copiar estadual como 4_5_infraestrutura.json
    import shutil
    src = os.path.join(OUT_DIR, "4_5_infra_estadual.json")
    dst = os.path.join(OUT_DIR, "4_5_infraestrutura.json")
    if os.path.exists(src):
        shutil.copy2(src, dst)
        print(f"\n    [COMPAT] Copiado {os.path.basename(src)} -> {os.path.basename(dst)}")

    return None  # no single result anymore


# ══════════════════════════════════════════════════════════
# ETL PERFIL DOCENTE
# ══════════════════════════════════════════════════════════

def etl_docentes():
    print("\n" + "=" * 60)
    print("ETL PERFIL DOCENTE RS (MULTI-REDE)")
    print("=" * 60)

    id_cols = ["CO_UF","CO_MUNICIPIO","CO_ENTIDADE","TP_DEPENDENCIA","TP_SITUACAO_FUNCIONAMENTO","TP_CATEGORIA_ESCOLA_PRIVADA"]
    doc_basic = ["QT_DOC_BAS","QT_DOC_INF","QT_DOC_FUND_AI","QT_DOC_FUND_AF","QT_DOC_MED","QT_DOC_EJA","QT_DOC_ESP"]

    # 1. Lendo todos os microdados (2010-2024)
    print("\n  [1/4] Lendo microdados (2010-2024)...")
    micros = sorted(glob.glob(os.path.join(MICRO_DIR, "microdados_ed_basica_*.*")))
    dfs_ts = {}
    for fpath in micros:
        fname = os.path.basename(fpath)
        ano = fname.replace("microdados_ed_basica_","").replace(".csv","").replace(".CSV","")
        print(f"    {ano}...", end=" ", flush=True)
        header = pd.read_csv(fpath, sep=";", encoding="latin-1", nrows=0)
        avail = [c for c in doc_basic if c in header.columns]
        use = [c for c in id_cols if c in header.columns] + avail + (["QT_MAT_BAS"] if "QT_MAT_BAS" in header.columns else [])
        df = pd.read_csv(fpath, sep=";", encoding="latin-1", usecols=use)
        df = df[(df["CO_UF"] == CO_UF_RS) & (df["TP_SITUACAO_FUNCIONAMENTO"] == 1)]
        if 'TP_CATEGORIA_ESCOLA_PRIVADA' in df.columns:
            df['TP_CATEGORIA_ESCOLA_PRIVADA'] = df['TP_CATEGORIA_ESCOLA_PRIVADA'].fillna(0).astype(int)
        dfs_ts[ano] = (df, avail)
        print(f"ok")

    # 2. Lendo dados de 2025 (Escola + Docente)
    print("\n  [2/4] Lendo dados 2025...")
    f_doc = os.path.join(MICRO_DIR, "Tabela_Docente_2025.csv")
    f_esc = os.path.join(MICRO_DIR, "Tabela_Escola_2025.csv")
    
    h_esc = pd.read_csv(f_esc, sep=";", encoding="latin-1", nrows=0)
    use_esc = [c for c in id_cols if c in h_esc.columns]
    df_esc = pd.read_csv(f_esc, sep=";", encoding="latin-1", usecols=use_esc)
    df_esc = df_esc[(df_esc["CO_UF"] == CO_UF_RS) & (df_esc["TP_SITUACAO_FUNCIONAMENTO"] == 1)]
    if 'TP_CATEGORIA_ESCOLA_PRIVADA' in df_esc.columns:
        df_esc['TP_CATEGORIA_ESCOLA_PRIVADA'] = df_esc['TP_CATEGORIA_ESCOLA_PRIVADA'].fillna(0).astype(int)

    all_doc_cols = []
    for group_cols in DOC_COLS_PERFIL.values():
        if isinstance(group_cols, list): all_doc_cols.extend(group_cols)
        else: all_doc_cols.append(group_cols)
    
    h_doc = pd.read_csv(f_doc, sep=";", encoding="latin-1", nrows=0)
    avail_doc = [c for c in ["CO_ENTIDADE"] + all_doc_cols if c in h_doc.columns]
    df_doc_raw = pd.read_csv(f_doc, sep=";", encoding="latin-1", usecols=avail_doc)
    
    df_2025 = df_esc.merge(df_doc_raw, on="CO_ENTIDADE", how="inner")
    print(f"    {len(df_2025)} escolas RS com dados docentes em 2025")

    censo_path = os.path.join(OUT_DIR, "4_1_acesso_matriculas.json")
    lookup = {}
    if os.path.exists(censo_path):
        with open(censo_path, "r", encoding="utf-8") as f:
            lookup = json.load(f).get("lookup_municipios", {})

    print("\n  [3/4] Gerando JSONs por rede...")
    for rede_key, rede_cfg in REDES.items():
        print(f"    Rede: {rede_key}")
        resultado = {
            "metadata": {"fonte": "Censo Escolar INEP", "uf": "RS", "rede": rede_key, "gerado_em": pd.Timestamp.now().isoformat()},
            "labels": DOC_LABELS,
            "serie_temporal_total": {},
            "serie_temporal_municipio": {},
            "perfil_2025": {},
            "por_municipio_2025": {},
            "razao_aluno_professor": {},
            "lookup_municipios": lookup
        }

        # Time series 2010-2024
        for ano, (df_full, avail) in dfs_ts.items():
            df = df_full[df_full["TP_DEPENDENCIA"].isin(rede_cfg['dep'])].copy()
            if rede_cfg['cat_priv'] is not None and 'TP_CATEGORIA_ESCOLA_PRIVADA' in df.columns:
                df = df[df['TP_CATEGORIA_ESCOLA_PRIVADA'] == rede_cfg['cat_priv']]
            
            resultado["serie_temporal_total"][ano] = {DOC_LABELS.get(c, c): safe_int(df[c].sum()) for c in avail}
            
            if "QT_DOC_BAS" in avail and "QT_MAT_BAS" in df.columns:
                mun_ts = {}
                for cod, grp in df.groupby("CO_MUNICIPIO"):
                    cod_str = str(int(cod))
                    doc_sum = safe_int(grp["QT_DOC_BAS"].sum())
                    mat_sum = safe_int(grp["QT_MAT_BAS"].sum())
                    mun_ts[cod_str] = {"docentes": doc_sum, "matriculas": mat_sum, "razao": round(mat_sum / doc_sum, 1) if doc_sum > 0 else None}
                resultado["serie_temporal_municipio"][ano] = mun_ts
            
            mat_total = df["QT_MAT_BAS"].sum() if "QT_MAT_BAS" in df.columns else 0
            doc_total = df["QT_DOC_BAS"].sum() if "QT_DOC_BAS" in avail else 0
            resultado["razao_aluno_professor"][ano] = {"geral": round(mat_total / doc_total, 1) if doc_total > 0 else None}

        # 2025
        df_25 = df_2025[df_2025["TP_DEPENDENCIA"].isin(rede_cfg['dep'])].copy()
        if rede_cfg['cat_priv'] is not None and 'TP_CATEGORIA_ESCOLA_PRIVADA' in df_25.columns:
            df_25 = df_25[df_25['TP_CATEGORIA_ESCOLA_PRIVADA'] == rede_cfg['cat_priv']]
        
        if len(df_25) > 0:
            avail_25 = [c for c in doc_basic if c in df_25.columns]
            resultado["serie_temporal_total"]["2025"] = {DOC_LABELS.get(c, c): safe_int(df_25[c].sum()) for c in avail_25}

            perfil = {}
            for group_name, group_cols in DOC_COLS_PERFIL.items():
                if isinstance(group_cols, str):
                    perfil[group_name] = safe_int(df_25[group_cols].sum()) if group_cols in df_25.columns else 0
                else:
                    perfil[group_name] = {}
                    for c in group_cols:
                        if c in df_25.columns:
                            label = DOC_LABELS.get(c, c)
                            perfil[group_name][label] = safe_int(df_25[c].sum())
            resultado["perfil_2025"] = perfil

            for cod, grp in df_25.groupby("CO_MUNICIPIO"):
                cod_str = str(int(cod))
                mun_entry = {"escolas": int(grp["CO_ENTIDADE"].nunique()), "docentes": safe_int(grp["QT_DOC_BAS"].sum() if "QT_DOC_BAS" in grp.columns else 0)}
                for group_name, group_cols in DOC_COLS_PERFIL.items():
                    if isinstance(group_cols, list):
                        mun_entry[group_name] = {}
                        for c in group_cols:
                            if c in grp.columns:
                                label = DOC_LABELS.get(c, c)
                                mun_entry[group_name][label] = safe_int(grp[c].sum())
                resultado["por_municipio_2025"][cod_str] = mun_entry

        out = os.path.join(OUT_DIR, f"4_5_docentes_{rede_key}.json")
        with open(out, "w", encoding="utf-8") as f:
            json.dump(resultado, f, ensure_ascii=False, indent=None, separators=(',',':'))
        print(f"      Salvo: {os.path.basename(out)} ({os.path.getsize(out)/1024/1024:.1f} MB)")

    # Backward compatibility
    import shutil
    src = os.path.join(OUT_DIR, "4_5_docentes_estadual.json")
    dst = os.path.join(OUT_DIR, "4_5_docentes.json")
    if os.path.exists(src):
        shutil.copy2(src, dst)

    return {"serie_temporal_total": resultado["serie_temporal_total"], "razao_aluno_professor": resultado["razao_aluno_professor"]}


# ══════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════

if __name__ == "__main__":
    t0 = time.time()
    etl_infraestrutura()  # gera 6 JSONs de infra (multi-rede)
    docs = etl_docentes()  # docentes continua só Estadual

    # Quick summary
    print("\n" + "=" * 60)
    print("RESUMO")
    print("=" * 60)

    # Infra summary per rede
    print("\nINFRAESTRUTURA (ultimo ano por rede):")
    for rede_key in REDES:
        fpath = os.path.join(OUT_DIR, f"4_5_infra_{rede_key}.json")
        if os.path.exists(fpath):
            with open(fpath, 'r', encoding='utf-8') as f:
                infra = json.load(f)
            ultimo = sorted(infra['serie_temporal'].keys())[-1]
            s = infra['serie_temporal'][ultimo]
            print(f"  {rede_key:15s}: {s['total_escolas']:>6} escolas ({os.path.getsize(fpath)/1024/1024:.1f} MB)")

    print(f"\nDOCENTES:")
    for ano in sorted(docs["serie_temporal_total"].keys()):
        t = docs["serie_temporal_total"][ano]
        r = docs["razao_aluno_professor"][ano]["geral"]
        print(f"  {ano}: {t.get('QT_DOC_BAS', t.get('total',0)):>7,} docentes | razao aluno/prof: {r}")

    print(f"\nTempo total: {time.time()-t0:.1f}s")
