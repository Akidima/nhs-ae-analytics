from __future__ import annotations


import functools
import hashlib
import time
from typing import Any, Callable, Iterable

from .logging_setup import get_logger

log = get_logger(__name__)

def sha256_bytes(data: bytes) -> str: 
    """SHA-256 of raw bytes (used for the whole downloaded file.)"""
    return hashlib.sha256(data).hexdigest()

def row_hash(values: Iterable[Any]) -> str:
    """Stable hash of a row's business values.

    We join the values with a seperator unlikely to appear in the data, so two
    different rows can't accidentally produce the same string.
    """
    joined = "\x1f".join("" if v is None else str(v) for v in values)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()

def with_retries(
    retries: int = 4,
    base_delay: float = 2.0,
    exceptions: tuple[type[Exception], ...] = (Exception,),
) -> Callable:
    """
    Decorator: retry a function with exponential backoff.

    Used for network calls (scraping, downloading) which fails transiently.
    """

    def decorator(fn: Callable) -> Callable:
        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            last_err: Exception | None = None
            for attempt in range(1, retries + 1):
                try:
                    return fn(*args, **kwargs)
                except exceptions as err: 
                        last_err = err
                        delay = base_delay * (2 ** (attempt -1))
                        log.warning(
                            "%s failed (attempt %d/%d): %s - retrying in %.0fs",
                            fn.__name__,
                            attempt,
                            retries,
                            err,
                            delay,
                        )
                        if attempt < retries:
                            time.sleep(delay)
            assert last_err is not None
            raise last_err
        return wrapper
    return decorator