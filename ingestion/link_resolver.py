"""Resolve the download URL by scraping the NHS England landing page.

WHY THIS EXISTS: the file URL contains a random WordPress suffix 
(e.g ...February-2026-D36ah6.xls). It cannot be constructed from the date, so
we must find the link on the rendered page every run, by its visible text.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import requests
from bs4 import BeautifulSoup

from .hashing import with_retries
from .logging_setup import get_logger
from .settings import settings

log = get_logger(__name__)

_USER_AGENT = "nhs-ae-analytics-ingestion/1.0 (+portfolio-project)"
_MIN_DELAY_SECONDS = 1.0
_ROBOTS_CACHE: dict[str, RobotFileParser | None] = {}
_BACKFILL_YEAR_PAGES = [
    "https://www.england.nhs.uk/statistics/statistical-work-areas/ae-waiting-times-and-activity/ae-attendances-and-emergency-admissions-2025-26/",
    "https://www.england.nhs.uk/statistics/statistical-work-areas/ae-waiting-times-and-activity/ae-attendances-and-emergency-admissions-2026-27/",
]

# Pre-compiled regex patterns from settings (case-insensitive)
_CATEGORY_PAGE_PATTERNS = [re.compile(p, re.IGNORECASE) for p in settings.category_page_patterns]
_XLS_LINK_PATTERNS = [re.compile(p, re.IGNORECASE) for p in settings.xls_link_patterns]
_EXCLUDE_PATTERNS = [re.compile(p, re.IGNORECASE) for p in settings.exclude_patterns]

# Pattern to discover year pages from landing page
_YEAR_PAGE_PATTERN = re.compile(
    r"ae-attendances-and-emergency-admissions-\d{4}-\d{2}",
    re.IGNORECASE
)


def _previous_year_url(url: str) -> str:
    """Decrement the financial year in URL (e.g., 2026-27 -> 2025-26)."""
    match = re.search(r"(\d{4})-(\d{2})", url)
    if not match:
        return url
    start, end = int(match.group(1)), int(match.group(2))
    return url.replace(f"{start}-{end:02d}", f"{start-1}-{start-2000:02d}")

@dataclass
class ResolvedLink:
    url: str
    link_text: str

@with_retries(retries=4, exceptions=(requests.RequestException,))
def _fetch_html(url: str) -> str:
    if not _can_fetch(url):
        raise RuntimeError(f"robots.txt disallows fetching {url}")
    
    # Polite delay
    time.sleep(_MIN_DELAY_SECONDS)
    
    resp = requests.get(url, headers={"User-Agent": _USER_AGENT}, timeout=30)
    resp.raise_for_status()
    return resp.text


def _can_fetch(url: str) -> bool:
    """Check robots.txt politely (cached)."""
    parsed = urlparse(url)
    base = f"{parsed.scheme}://{parsed.netloc}"
    
    if base not in _ROBOTS_CACHE:
        rp = RobotFileParser()
        try:
            rp.set_url(f"{base}/robots.txt")
            rp.read()
        except Exception:
            rp = None
        _ROBOTS_CACHE[base] = rp
    
    rp = _ROBOTS_CACHE[base]
    if rp is None:
        return True  # Allow if robots.txt unavailable
    return rp.can_fetch(_USER_AGENT, url)

def _abs_url(href: str) -> str:
    """Normalise a possibly-relative href to an absolute england.nhs.uk URL."""
    if href.startswith("//"):
        return f"https:{href}"
    if href.startswith("/"):
        return f"https://www.england.nhs.uk{href}"
    return href


def discover_year_pages(landing_url: str | None = None) -> list[str]:
    """Find all 'ae-attendances-and-emergency-admissions-YYYY-YY' links on landing page."""
    url = landing_url or settings.landing_page_url
    html = _fetch_html(url)
    soup = BeautifulSoup(html, "html.parser")
    
    pages: list[str] = []
    for anchor in soup.find_all("a", href=True):
        href = anchor["href"]
        if _YEAR_PAGE_PATTERN.search(href):
            pages.append(_abs_url(href))
    
    # Deduplicate and sort newest first (assuming YYYY-YY in URL)
    pages = sorted(set(pages), reverse=True)
    log.info("Discovered %d year pages: %s", len(pages), pages)
    return pages

def resolve_backfill_urls(year_pages: list[str] | None = None) -> list[ResolvedLink]:
    """Find every Monthly A&E provider XLS across the given year-pages.

    Reuses the same 'monthly a&e' + .xls matching as resolve_timeseries_url's
    STEP 2, but collects ALL matches instead of returning the first. Used by
    the backfill runner to ingest a full year of history in one command.
    """
    pages = year_pages or discover_year_pages()
    found: list[ResolvedLink] = []
    seen: set[str] = set()

    for page in pages:
        log.info("Backfill: scanning year-page %s", page)
        try:
            html = _fetch_html(page)
        except Exception as err:  # noqa: BLE001
            log.error("Could not fetch year-page %s: %s", page, err)
            continue

        soup = BeautifulSoup(html, "html.parser")
        for anchor in soup.find_all("a", href=True):
            href = anchor["href"]
            text = anchor.get_text(separator=" ", strip=True)
            text = re.sub(r"\s+", " ", text)

            # Use compiled patterns from settings
            is_monthly = any(p.search(text) for p in _XLS_LINK_PATTERNS)
            is_xls = href.endswith(".xls") or href.endswith(".xlsx")
            if not (is_monthly and is_xls):
                continue
            # skip the national time-series aggregates and other excluded
            if any(p.search(text) for p in _EXCLUDE_PATTERNS):
                continue

            url = _abs_url(href)
            if url in seen:
                continue
            seen.add(url)
            found.append(ResolvedLink(url=url, link_text=text))
            log.info("  found: %s (%s)", text, url.rsplit("/", 1)[-1])

    log.info("Backfill: %d monthly files found across %d page(s)",
             len(found), len(pages))
    return found

def resolve_timeseries_url() -> ResolvedLink:
    """Find the latest Monthly A&E Sitrep XLS link using a two-step process."""
    log.info("Fetching landing page: %s", settings.landing_page_url)
    html = _fetch_html(settings.landing_page_url)
    soup = BeautifulSoup(html, "html.parser")

    category_url = None

    # STEP 1: Find the category page for the current year (e.g., 2026-27)
    for anchor in soup.find_all("a", href=True):
        text = anchor.get_text(separator=" ", strip=True)
        text = re.sub(r"\s+", " ", text)
        
        # Skip excluded patterns (time series, ECDS, quarterly)
        if any(p.search(text) for p in _EXCLUDE_PATTERNS):
            continue
            
        # Match category page patterns
        if any(p.search(text) for p in _CATEGORY_PAGE_PATTERNS):
            href = anchor["href"]
            
            # If it's already a direct XLS link, just return it (future-proofing)
            if href.endswith(".xls") or href.endswith(".xlsx"):
                return ResolvedLink(url=_abs_url(href), link_text=text)
            
            # Otherwise, it's a category page. Save it and break.
            category_url = _abs_url(href)
            break # Take the first match (the newest year)

    if not category_url:
        raise RuntimeError(f"Could not find the category page on {settings.landing_page_url}")

    # Try current year, then fallback to previous year
    for attempt_url in [category_url, _previous_year_url(category_url)]:
        try:
            log.info("Fetching category page: %s", attempt_url)
            cat_html = _fetch_html(attempt_url)
            cat_soup = BeautifulSoup(cat_html, "html.parser")
            
            for anchor in cat_soup.find_all("a", href=True):
                href = anchor["href"]
                text = anchor.get_text(separator=" ", strip=True)
                
                # Use compiled patterns from settings
                is_monthly = any(p.search(text) for p in _XLS_LINK_PATTERNS)
                is_xls = href.endswith(".xls") or href.endswith(".xlsx")
                if is_monthly and is_xls:
                    log.info("Resolved final XLS link: %s", _abs_url(href))
                    return ResolvedLink(url=_abs_url(href), link_text=text)
            
            # If we got here, page loaded but no XLS found
            log.warning("No XLS link found on %s", attempt_url)
            
        except requests.HTTPError as e:
            if e.response.status_code == 404:
                log.info("Category page not found (404): %s, trying fallback", attempt_url)
                continue
            raise
    
    raise RuntimeError(f"Could not find an XLS download link on category page or fallback: {category_url}")