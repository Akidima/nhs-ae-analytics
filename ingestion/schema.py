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

        )
    ]
    