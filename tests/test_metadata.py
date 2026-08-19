"""Tests for metadata module."""

import pytest
import pandas as pd
from ingestion.hashing import row_hash
from ingestion.metadata import _normalize_data_month
from datetime import date, datetime


def test_row_hash_deterministic_column_order():
    """Test that row_hash produces same result regardless of DataFrame column order."""
    # Same data, different column orders
    df1 = pd.DataFrame({"period": ["2024-01"], "org_code": ["R1"], "metric_a": [10], "metric_b": [20]})
    df2 = pd.DataFrame({"period": ["2024-01"], "org_code": ["R1"], "metric_b": [20], "metric_a": [10]})
    
    # Excluded columns (same as in metadata.py)
    EXCLUDED_HASH_COLUMNS = frozenset({
        "source_file_name", "source_file_hash", "source_url", "ingested_at"
    })
    
    # Sort columns alphabetically for deterministic hashing
    cols1 = sorted(c for c in df1.columns if c not in EXCLUDED_HASH_COLUMNS)
    cols2 = sorted(c for c in df2.columns if c not in EXCLUDED_HASH_COLUMNS)
    
    hash1 = row_hash(df1.iloc[0][c] for c in cols1)
    hash2 = row_hash(df2.iloc[0][c] for c in cols2)
    
    assert hash1 == hash2, "Hash should be identical regardless of column order"


def test_normalize_data_month_valid_formats():
    """Test _normalize_data_month handles valid formats."""
    assert _normalize_data_month("2024-01") == date(2024, 1, 1)
    assert _normalize_data_month(date(2024, 1, 15)) == date(2024, 1, 1)
    assert _normalize_data_month(datetime(2024, 1, 15, 12, 30)) == date(2024, 1, 1)


def test_normalize_data_month_invalid():
    """Test _normalize_data_month rejects invalid formats."""
    with pytest.raises(ValueError):
        _normalize_data_month("2024/01")
    with pytest.raises(ValueError):
        _normalize_data_month("01-2024")
    with pytest.raises(TypeError):
        _normalize_data_month(12345)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])