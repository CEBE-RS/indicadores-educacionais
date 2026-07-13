# -*- coding: utf-8 -*-
"""Caminhos portateis do pipeline ETL - Painel de Indicadores Educacionais (UNESCO/CEBE-RS).

Layout esperado:

  <projeto>/
    00. Bases de Dados/          # bases brutas (NAO versionadas no Git)
    000. Bases_Basicas/          # opcional (coordenadas etc.)
    indicadores-educacionais/    # clone deste repositorio
      etl/                       # estes scripts
      dados/                     # JSONs de saida
      index.html

Overrides (opcional):

  UNESCO_ETL_ROOT       = pasta <projeto> que contem "00. Bases de Dados"
  UNESCO_BASES_BASICAS  = pasta alternativa de bases basicas/geo
"""
from __future__ import annotations

import os
from pathlib import Path

ETL_DIR = Path(__file__).resolve().parent
REPO_ROOT = ETL_DIR.parent
PROJECT_ROOT = Path(os.environ.get("UNESCO_ETL_ROOT", str(REPO_ROOT.parent))).resolve()

BASE = str(PROJECT_ROOT)
OUT_DIR = str(REPO_ROOT / "dados")
PAINEL_DIR = OUT_DIR
BASES_DIR = str(PROJECT_ROOT / "00. Bases de Dados")
BASES_BASICAS = os.environ.get(
    "UNESCO_BASES_BASICAS",
    str(PROJECT_ROOT.parent / "000. Bases_Basicas"),
)

os.makedirs(OUT_DIR, exist_ok=True)
