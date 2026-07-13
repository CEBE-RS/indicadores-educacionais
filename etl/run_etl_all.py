# -*- coding: utf-8 -*-
"""Executa a ordem sugerida de atualizacao completa do pipeline ETL."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ETL_DIR = Path(__file__).resolve().parent

ORDER = [
    "etl_censo_escolar.py",
    "etl_suplementar.py",
    "etl_infra_docentes.py",
    "etl_fluxo_rendimento.py",
    "etl_tdi.py",
    "etl_funil_turma_locdif.py",
    "etl_saeb.py",
    "etl_saers.py",
    "etl_desigualdades.py",
    "etl_ideb.py",
    "etl_escolas.py",
    "etl_inse.py",
    "etl_icg.py",
    "etl_afd.py",
    "etl_redes.py",
    "gerar_planilhas_download.py",
]


def main() -> None:
    for script in ORDER:
        path = ETL_DIR / script
        if not path.exists():
            print("SKIP (ausente):", script)
            continue
        print("\n===", script, "===")
        subprocess.check_call([sys.executable, str(path)], cwd=str(ETL_DIR))


if __name__ == "__main__":
    main()
