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

from .logging_setup import get_logger
from .schema import Registry, map_columns

log = get_logger(__name__)

def _read_workbook(content: bytes) -> dict[str, pd.DataFrame]:
    """Read every sheet with no header (we detect the header ourselves).

    .xls need the 'xlrd' engine; .xlsx would use 'openpxyl'.
    """
    bio = io.BytesIO(content)
    try:
        return pd.read_excel(bio, sheet_name=None, header=None, engine="xlrd")
    except Exception:  # noqa: BLE001 — fall back for .xlsx (ECDS, V2)
        bio.seek(0)
        return pd.read_excel(bio, sheet_name=None, header=None, engine="openpyxl")

def inspect(content: bytes, max_rows:int = 25) -> str:
    """Human-readable dump of sheets and their first rows (for '--inspect')."""
    sheets = _read_workbook(content)
    out = [f"Workbook has {len(sheets)} sheet(s):"]
    for name, df in sheets.items():
        out.append(f"\n===sheet: {name!r} shape={df.shape} ===")
        out.append(df.head(max_rows).to_string(max_cols=20))
    return "\n".join(out)

def _pick_sheet(sheets: dict[str, pd.DataFrame], registry: Registry) -> str: 
    for frag in registry.preferred_sheet_contains:
        for name in sheets:
            if frag in name.lower():
                return name
    # fallback: the sheet with the most non-null cells (the real data sheet)
    return max(sheets, key=lambda n: sheets[n].notna().sum().sum())

def _find_header_row(df: pd.DataFrame, anchor: str) -> int:
    anchor_l = anchor.strip().lower()
    """Find the row index that contains the header labels."""
    for i in range(min(len(df), 40)): # Header is within the first ~40 rows
        row_vals = [str(v).strip().lower() for v in df.iloc[i].tolist()]
        if any(anchor_l == v or anchor_l in v for v in row_vals):
            return i
    raise RuntimeError(
        f"Could not find header row containing '{anchor!r}' in the first 40 rows. "
        "Run with --inspect and check the registry's sheet_anchor_column"
    )

def _build_compound_labels(raw: pd.DataFrame, header_row: int) -> list[str]:
    """Combine the banner row (header_row-1) with the label row (header_row).

    NHS uses a two-row header: a group banner ('A&E attendances',
    'A&E attendances less than 4 hours...', 'Emergency Admissions') sitting
    above repeated sub-labels ('Type 1 Departments - Major A&E', etc).
    The banner spans merged cells, so it only appears in the first column of
    its group and is NaN across the rest — we forward-fill it.
    """
    banner_raw = raw.iloc[header_row - 1].tolist()
    label_raw = raw.iloc[header_row].tolist()

    # forward-fill the banner across its merged span
    banner: list[str] = []
    last = ""
    for v in banner_raw:
        s = "" if pd.isna(v) else re.sub(r"\s+", " ", str(v).strip())
        if s:
            last = s
        banner.append(last)

    labels: list[str] = []
    for b, l in zip(banner, label_raw):
        lbl = "" if pd.isna(l) else re.sub(r"\s+", " ", str(l).strip())
        # compound only when there's a sub-label; bare identity cols (Code/Region/Name) stay as-is
        if lbl and b and lbl.lower() not in ("code", "region", "name"):
            labels.append(f"{b} :: {lbl}")
        else:
            labels.append(lbl or b)
    return labels

def _coerce(series, dtype):
    if isinstance(series, pd.DataFrame):
        series = series.iloc[:, 0]

    if dtype == "integer":
        return pd.to_numeric(series, errors="coerce").astype("Int64")
    if dtype == "percent":
        # NHS stores these as 0–1 fractions or '-' placeholders
        return pd.to_numeric(series, errors="coerce")
    if dtype == "text":
        s = series.astype("string")
        return s.where(s.notna() & (s.str.strip() != ""), other=pd.NA)
    # fallback: leave as-is rather than nuking to None
    return series
    # ... (leave the rest of your existing code exactly as is) ...


_MONTH_RX = re.compile(r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+'?(\d{2,4})", re.I)

def extract_period(content: bytes, registry: Registry) -> pd.Timestamp | None:
    """Read the 'Period:' value (e.g. 'May 26') from the metadata block."""
    sheets = _read_workbook(content)
    sheet = sheets[_pick_sheet(sheets, registry)]
    for i in range(min(len(sheet), 14)):          # metadata block is rows 0–13
        row = [str(v).strip().lower() for v in sheet.iloc[i].tolist()]
        for j, cell in enumerate(row):
            if cell.startswith("period"):
                for v in sheet.iloc[i].tolist()[j+1:]:
                    if pd.isna(v) or not str(v).strip():
                        continue
                    m = _MONTH_RX.search(str(v))
                    if m:
                        mon, yr = m.group(1), m.group(2)
                        yr = int(yr) + 2000 if len(yr) == 2 else int(yr)
                        return pd.Timestamp(f"{yr}-{mon.title()}-01") \
                                 .to_period("M").to_timestamp()
    return None

def parse(content: bytes, registry: Registry) -> tuple[pd.DataFrame, list[str]]:
    """Return (tidy_DataFrame, missing_required_columns)."""
    sheets = _read_workbook(content)
    sheet_name = _pick_sheet(sheets, registry)
    raw = sheets[sheet_name]
    log.info("Parsing sheet %r (shape=%s)", sheet_name, raw.shape)

    header_row = _find_header_row(raw, registry.anchor_column)
    labels = _build_compound_labels(raw, header_row)
    body = raw.iloc[header_row + 1:].copy()
    body.columns = labels

    mapping = map_columns(labels, registry)
    if mapping.missing_required:
        log.error("MISSING required columns: %s", mapping.missing_required)
    if mapping.unmapped_source:
        log.error("Unmapped source columns (captured as drift): %d", len(mapping.unmapped_source))

    # Keep only mapped columns, rename to canonical columns
    keep = [c for c in body.columns if c in mapping.mapping]
    tidy = body[keep].rename(columns=mapping.mapping)

    # Drop fully-blank rows and footnote rows [no org_code]
    if "org_code" in tidy.columns:
        tidy = tidy[tidy["org_code"].notna()]
        # drop the literal '-' aggregate code
        tidy = tidy[tidy["org_code"].astype(str).str.strip() != "-"]
        # drop footnote/aggregate rows by code OR name
        tidy = tidy[~tidy["org_code"].astype(str).str.contains(
            r"note|source|total|england", case=False, na=False)]
    if "org_name" in tidy.columns:
        tidy = tidy[~tidy["org_name"].astype(str).str.contains(
            r"^england$|^total|^note", case=False, na=False)]
    
    # Coerce dtypes per registry
    dtype_per_name = {c.maps_to: c.dtype for c in registry.columns}
    for col in tidy.columns:
        tidy[col] = _coerce(tidy[col], dtype_per_name.get(col, "text"))

    # Normalise period to first-of-month
    if "period" in tidy.columns:
        tidy["period"] = tidy["period"].dt.to_period("M").dt.to_timestamp()

    tidy = tidy.reset_index(drop=True)
    log.info("Parsed %d data rows, %d columns", len(tidy), tidy.shape[1])
    return tidy, mapping.missing_required


