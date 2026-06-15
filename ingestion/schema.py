"""Schema Registry: load expected schemas from YAML files and validate parsed data.
    Detect header row, map columns, and report drift. This is the guard against silently
    loading into the wrong columns when the NHS England changes the format.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import yaml

from .logging_setup import get_logger
from .settings import settings

log = get_logger(__name__)

@dataclass 
class ColumnSpec:
    maps_to:str
    patterns: list[str] # alternative substrings (regrex-ish, '|' split)
    dtype: str
    required: bool

@dataclass
class Registry:
    schema_version: str
    anchor_column: str
    preferred_sheet_contains: list[str]
    drift_policy: dict
    columns: list[ColumnSpec]

@dataclass
class MappingResult:
    # source column label -> canonical name
    mapping: dict[str,str] = field(default_factory=dict)
    missing_required: list[str] = field(default_factory=list)
    unmapped_source: list[str] = field(default_factory=list)

def load_registry(path: str | None = None) -> Registry:
    path = path or settings.schema_registry_path
    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f)
    cols = [
        ColumnSpec(
            maps_to=c["maps_to"],
            patterns=[p.strip() for p in str(c["source_label_contains"]).split("|")],
            dtype=c.get("dtype", "text"),
            required=bool(c.get("required", False)),
        )
        for c in raw["columns"]
    ]
    return Registry(
        schema_version=str(raw.get("schema_version","unknown")),
        anchor_column=str(raw.get("sheet_anchor_column","Code")),
        preferred_sheet_contains=[
            s.lower() for s in raw.get("preferred_sheet_contains", [])
        ],
        drift_policy=raw.get("drift_policy",{}),
        columns=cols
    )

def _matches(label:str, spec:ColumnSpec) -> bool:
    """Check if an Excel header label matches any of the patterns in the spec."""
    # Clean up the Excel header: remove extra spaces, make lowercase
    norm = re.sub(r"\s+", " ", label.strip().lower())
     # Does any of our registry patterns hide inside this cleaned header?
    return any(re.search(p.lower(), norm) for p in spec.patterns)

def map_columns(source_labels: list[str], registry: Registry) -> MappingResult:
    """Map real column labels to canonical names."""
    result = MappingResult()
    # Changed name for clarity: tracks which Excel headers we've already matched
    used_labels: set[str] = set()

    # Step 1: Go through our Rulebook and try to find matches in the Excel file
    for spec in registry.columns:
        match = next(
            (lbl for lbl in source_labels 
            if lbl not in used_labels and _matches(lbl, spec)),
            None
        )
        if match is not None:
            # We found it! Map the messy name to the clean database name.
            result.mapping[match] = spec.maps_to
            used_labels.add(match)
        else:
            # We didn't find it. Is it a big deal?
            if spec.required:
            # Yes! Abort mission (the Parser will see this and fail loudly).
                result.missing_required.append(spec.maps_to)
            # If it's optional and missing, we just silently move on.
            
        # Step 2: Find the "Drift" (Extra columns in Excel that aren't in our Rulebook)
        result.unmapped_source = [
            lbl for lbl in source_labels 
            if lbl not in used_labels
        ]
    return result
