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


def test_can_fetch_respects_robots_txt(monkeypatch):
    """Test _can_fetch respects robots.txt."""
    from ingestion.link_resolver import _can_fetch, _ROBOTS_CACHE
    
    # Clear cache
    _ROBOTS_CACHE.clear()
    
    # Mock robots.txt that allows all
    import ingestion.link_resolver as lr_module
    from urllib.robotparser import RobotFileParser
    
    def mock_read_allowed(self):
        self.allow_all = True
        self.disallow_all = False
    
    def mock_read_disallowed(self):
        self.allow_all = False
        self.disallow_all = True
    
    def mock_can_fetch_allowed(self, user_agent, url):
        return True
    
    def mock_can_fetch_disallowed(self, user_agent, url):
        return False
    
    # Test allowed
    monkeypatch.setattr(RobotFileParser, "read", mock_read_allowed)
    monkeypatch.setattr(RobotFileParser, "can_fetch", mock_can_fetch_allowed)
    
    assert _can_fetch("https://example.com/allowed") is True
    
    # Test disallowed
    _ROBOTS_CACHE.clear()
    monkeypatch.setattr(RobotFileParser, "read", mock_read_disallowed)
    monkeypatch.setattr(RobotFileParser, "can_fetch", mock_can_fetch_disallowed)
    
    assert _can_fetch("https://example.com/disallowed") is False


def test_fetch_html_polite_delay(monkeypatch):
    """Test _fetch_html includes polite delay."""
    import ingestion.link_resolver as lr
    import time
    
    original_sleep = time.sleep
    sleep_called = []
    
    def mock_sleep(seconds):
        sleep_called.append(seconds)
    
    monkeypatch.setattr(time, "sleep", mock_sleep)
    
    def mock_get(*args, **kwargs):
        class MockResp:
            def raise_for_status(self):
                pass
            text = "<html></html>"
        return MockResp()
    
    monkeypatch.setattr(lr.requests, "get", mock_get)
    
    # Clear robots cache
    lr._ROBOTS_CACHE.clear()
    monkeypatch.setattr(lr.RobotFileParser, "read", lambda self: setattr(self, 'allow_all', True) or setattr(self, 'disallow_all', False))
    monkeypatch.setattr(lr.RobotFileParser, "can_fetch", lambda self, ua, url: True)
    
    lr._fetch_html("https://example.com/test")
    
    assert len(sleep_called) == 1
    assert sleep_called[0] >= lr._MIN_DELAY_SECONDS


if __name__ == "__main__":
    pytest.main([__file__, "-v"])