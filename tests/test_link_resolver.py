"""Tests for link_resolver module."""

import pytest
from ingestion.link_resolver import _abs_url
from ingestion.settings import settings


def test_abs_url_normalization():
    """Test _abs_url handles relative, absolute, and protocol-relative URLs."""
    # Relative path
    assert _abs_url("/path/file.xls") == "https://www.england.nhs.uk/path/file.xls"
    
    # Protocol-relative
    assert _abs_url("//example.com/file.xls") == "https://example.com/file.xls"
    
    # Already absolute
    assert _abs_url("https://example.com/file.xls") == "https://example.com/file.xls"
    
    # Already absolute with different domain
    assert _abs_url("http://other.com/file.xls") == "http://other.com/file.xls"


def test_abs_url_with_category_pages():
    """Test _abs_url works for category page URLs."""
    # Relative category page
    assert _abs_url("/statistics/statistical-work-areas/ae-waiting-times-and-activity/ae-attendances-2026-27/") == \
        "https://www.england.nhs.uk/statistics/statistical-work-areas/ae-waiting-times-and-activity/ae-attendances-2026-27/"
    
    # Protocol-relative category page
    assert _abs_url("//www.england.nhs.uk/statistics/") == "https://www.england.nhs.uk/statistics/"


def test_category_patterns_from_settings():
    """Test that settings has the new pattern fields."""
    assert hasattr(settings, 'category_page_patterns')
    assert hasattr(settings, 'xls_link_patterns')
    assert hasattr(settings, 'exclude_patterns')
    assert isinstance(settings.category_page_patterns, list)
    assert isinstance(settings.xls_link_patterns, list)
    assert isinstance(settings.exclude_patterns, list)
    assert len(settings.category_page_patterns) >= 2
    assert len(settings.xls_link_patterns) >= 2
    assert len(settings.exclude_patterns) >= 3


def test_patterns_match_expected_strings():
    """Test that compiled patterns match expected strings."""
    import re
    
    # Compile patterns like the module does
    category_patterns = [re.compile(p, re.IGNORECASE) for p in settings.category_page_patterns]
    xls_patterns = [re.compile(p, re.IGNORECASE) for p in settings.xls_link_patterns]
    exclude_patterns = [re.compile(p, re.IGNORECASE) for p in settings.exclude_patterns]
    
    # Category page patterns should match
    category_text = "Monthly A&E Attendances and Emergency Admissions 2026-27"
    assert any(p.search(category_text) for p in category_patterns)
    
    # XLS link patterns should match
    xls_text = "Monthly A&E Provider Data January 2026"
    assert any(p.search(xls_text) for p in xls_patterns)
    
    # Exclude patterns should match
    exclude_text = "Time Series Data"
    assert any(p.search(exclude_text) for p in exclude_patterns)
    
    ecds_text = "ECDS Monthly Data"
    assert any(p.search(ecds_text) for p in exclude_patterns)


def test_discover_year_pages(monkeypatch):
    """Test discover_year_pages finds year pages from landing page."""
    from ingestion.link_resolver import discover_year_pages
    import ingestion.link_resolver as lr
    
    # Load fixture
    with open("tests/fixtures/landing_page.html") as f:
        fixture_html = f.read()
    
    # Mock _fetch_html to return our fixture
    def mock_fetch_html(url):
        return fixture_html
    
    monkeypatch.setattr(lr, "_fetch_html", mock_fetch_html)
    
    pages = discover_year_pages("https://fake.example.com/landing")
    assert len(pages) >= 3
    assert all("ae-attendances-and-emergency-admissions-" in p for p in pages)
    assert pages == sorted(pages, reverse=True)  # newest first


if __name__ == "__main__":
    pytest.main([__file__, "-v"])