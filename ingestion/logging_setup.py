"""One place to configure logging so every module logs consistently."""
from __future__ import annotations

import logging
import sys

from .settings import setttings

_CONFIGURED = False

def get_logger(name: str) -> logging.logger:
    """Return a configured logger. Safe to call many times."""
    