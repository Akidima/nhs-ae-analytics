"""Shared logging setup for the data quality service.

Mirrors the ingestion service's log format so output looks consistent
across the whole pipeline (timestamp | LEVEL | logger.name | message).
"""
from __future__ import annotations

import logging
import sys

_FORMAT = "%(asctime)s | %(levelname)s | %(name)s | %(message)s"
_DATEFMT = "%Y-%m-%d %H:%M:%S"

_configured = False

def _configure_root() -> None:
    global _configured
    if _configured:
        return 
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(_FORMAT, datefmt=_DATEFMT))
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(handler)
    _configured = True

def getLogger(name: str) -> logging.Logger:
    _configure_root()
    return logging.getLogger(name)