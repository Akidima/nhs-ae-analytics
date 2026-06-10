"""Download the resolved file. Return the bytes and the original filename."""
from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import unquote, urlparse

import requests  

from .hashing import sha256_bytes, with_retries
from .logging_setup import get_logger
from .settings import settings

log = get_logger(__name__)

_USER_AGENT = "nhs-ae-analytics/1.0 (+portfolio project)"

@dataclass
class DownloadedFile:

    content: bytes
    filename: str
    sha256: str
    source_url: str



def _filename_from_url(url:str) -> str:
    path = urlparse(url).path
    return unquote(path.rsplit("/", 1)[-1]) or "download.xls"

@with_retries(exceptions=(requests.RequestException, ))
def download(url: str) -> DownloadedFile:
    log.info("Downloading %s", url)
    resp = requests.get(
        url, headers={"User-Agent": _USER_AGENT}, timeout=120
    )
    resp.raise_for_status()
    content = resp.content
    digest = sha256_bytes(content)
    filename = _filename_from_url(url)
    log.info(
        "Downloaded %s (%d bytes, sha256=%s...)",
        filename,
        len(content),
        digest[:12]
    )
    return DownloadedFile(
        content=content,
        filename=filename,
        sha256=digest,
        source_url=url
    )

