"""Parse the NHS England .xls into a tidy DataFrame.

NHS files are built for humans (branding rows, multi-row headers, footnotes),
so we never assume a fixed layout. We:
    1. Pick the data sheet,
    2. Find the real header row,
    3. Map the messy labels to canonical names via the schema registry,
    4. Coerce types and drop footnote/blank rows.

NOTE: the exact live layout should be confirmed with '--inspect' and the 
registry tuned accordingly (Phase 2 honesty note). This parser is built to be
adaptable, not to assume one fixed shape.
"""
from __future__ import annotations

import io
import re

import pandas as pd

from .logging_setup import logging
from .schema import Registry, map_columns

log = get_logger(__name__)

def _read_workbook(content: bytes) -> dict[str, DataFrame]:
    """Read every sheet with no header (we detect the header ourselves).

    .xls need the 'xlrd' engine; .xlsx would use 'openpxyl'.
    """
    bio = io.BytesIO(content)
    try:
        return pd.read_excel(bio, sheet_name=None, header=None, engine="xlrd")
    except Exception:  # noqa: BLE001 — fall back for .xlsx (ECDS, V2)
        bio.seek(0)
        return pd.read_excel(bio, sheet_name=None, header=None, engine="openpyxl")

