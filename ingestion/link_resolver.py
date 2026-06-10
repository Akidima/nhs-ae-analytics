"""Resolve the download URL by scraping the NHS England landing page.

WHY THIS EXISTS: the file URL contains a random WordPress suffix 
(e.g ...February-2026-D36ah6.xls). It cannot be constructed from the date, so
we must find the link on the rendered page every run, by its visible text.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import requests
from bs4 import BeautifulSoup

from .hashing import with_retries
from .logging_setup import get_logger
from .settings import settings

log = get_logger(__name__)

_USER_AGENT = "nhs-ae-analytics-ingestion/1.0 (+portfolio-project)"

@dataclass
class ResolvedLink:
    url: str
    link_text: str

@with_retries(retries=4, exceptions=(requests.RequestException,))
def _fetch_html(url: str) -> str:
    resp = requests.get(url, headers={"User-Agent": _USER_AGENT}, timeout=30)
    resp.raise_for_status()
    return resp.text

def resolve_timeseries_url() -> ResolvedLink:
    """Find the 'Monthly A&E Time Series' link and return its full URL.
    
    Raises RuntimeError if no matching link is found. - that means the page
    layout has changed or the link text has been updated and a human should look (fail loudly, never silently).
    """
    log.info("Fetching landing page: %s", settings.landing_page_url)
    html = _fetch_html(settings.landing_page_url)
    soup = BeautifulSoup(html, "html.parser")
    
     # Match the link by its visible text, tolerating spacing/case variations.
    pattern = re.compile(
        settings.timeseries_link_text.replace(" ", r"\s+"),
        re.IGNORECASE
    )

    for anchor in soup.find_all("a", href="True"):
        text = anchor.get_text(strip=True)
        if pattern.search(text):
            url = anchor["href"]
            log.info("Resolved time-series link: %s", url)
            return ResolvedLink(url=url, link_text=text)

    raise RuntimeError(
        "Could not find the 'Monthly A & E Time Series' link on "
        f"{settings.landing_page_url}. The page layout may have changed - "
        "manual review required."
    )

     
    