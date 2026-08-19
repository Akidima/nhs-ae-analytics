"""Tests for link_resolver module."""

import pytest
from ingestion.link_resolver import _abs_url


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


if __name__ == "__main__":
    pytest.main([__file__, "-v"])