"""One place to configure logging so every module logs consistently."""
from __future__ import annotations

import logging
import sys

from .settings import settings

_CONFIGURED = False

def get_logger(name: str) -> logging.Logger:
    """Return a configured logger. Safe to call many times."""
    global _CONFIGURED
    if not _CONFIGURED:
        logging.basicConfig(
            level=getattr(logging, settings.log_level.upper(), logging.INFO),
            format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
            stream=sys.stdout,
        )
        _CONFIGURED = True
    return logging.getLogger(name)
    