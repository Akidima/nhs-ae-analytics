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
    """Find the latest Monthly A&E Sitrep XLS link using a two-step process."""
    log.info("Fetching landing page: %s", settings.landing_page_url)
    html = _fetch_html(settings.landing_page_url)
    soup = BeautifulSoup(html, "html.parser")
    
    # HARDCODED SEARCH TEXT to bypass .env prefix issues completely
    search_text = "Monthly A&E Attendances and Emergency Admissions"
    pattern = re.compile(
        search_text.replace(" ", r"\s+"),
        re.IGNORECASE
    )

    category_url = None

    # STEP 1: Find the category page for the current year (e.g., 2026-27)
    for anchor in soup.find_all("a", href=True):
        text = anchor.get_text(separator=" ", strip=True)
        text = re.sub(r"\s+", " ", text)
        
        # Skip the national aggregate "Time Series" files
        if "time series" in text.lower():
            continue
            
        if pattern.search(text):
            href = anchor["href"]
            
            # If it's already a direct XLS link, just return it (future-proofing)
            if href.endswith(".xls") or href.endswith(".xlsx"):
                url = href
                if url.startswith("/"): url = f"https://www.england.nhs.uk{url}"
                return ResolvedLink(url=url, link_text=text)
            
            # Otherwise, it's a category page. Save it and break.
            category_url = href
            if category_url.startswith("/"):
                category_url = f"https://www.england.nhs.uk{category_url}"
            elif category_url.startswith("//"):
                category_url = f"https:{category_url}"
            break # Take the first match (the newest year)

    if not category_url:
        raise RuntimeError(f"Could not find the category page for '{search_text}' on {settings.landing_page_url}")

    # STEP 2: Fetch the category page and find the latest XLS download
    log.info("Fetching category page: %s", category_url)
    cat_html = _fetch_html(category_url)
    cat_soup = BeautifulSoup(cat_html, "html.parser")

    for anchor in cat_soup.find_all("a", href=True):
        href = anchor["href"]
        text = anchor.get_text(separator=" ", strip=True)
        
        # Look specifically for the "Monthly A&E" XLS file.
        # This ensures we grab the Sitrep and ignore the "ECDS" XLS files on the same page.
        if ("monthly a&e" in text.lower() or "monthly ae" in text.lower()) and (href.endswith(".xls") or href.endswith(".xlsx")):
            url = href
            if url.startswith("/"):
                url = f"https://www.england.nhs.uk{url}"
            elif url.startswith("//"):
                url = f"https:{url}"
            log.info("Resolved final XLS link: %s", url)
            return ResolvedLink(url=url, link_text=text)

    raise RuntimeError(f"Could not find an XLS download link on the category page: {category_url}")