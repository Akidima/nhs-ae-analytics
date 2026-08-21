"""Tests for staging_loader module."""

import pytest
import pandas as pd
import numpy as np
from unittest.mock import MagicMock, patch
from datetime import datetime, timezone


# Test constants
def test_expected_columns_constant_exists():
    from ingestion.staging_loader import EXPECTED_COLUMNS
    assert isinstance(EXPECTED_COLUMNS, (list, tuple))
    assert len(EXPECTED_COLUMNS) == 20
    assert "period" in EXPECTED_COLUMNS
    assert "org_code" in EXPECTED_COLUMNS
    assert "source_file_name" in EXPECTED_COLUMNS


def test_dtype_mapping_constant_exists():
    from ingestion.staging_loader import DTYPE_MAPPING
    assert isinstance(DTYPE_MAPPING, dict)
    assert "period" in DTYPE_MAPPING
    assert "org_code" in DTYPE_MAPPING
    # Check some type names
    assert DTYPE_MAPPING["period"].__visit_name__ == "date"
    assert DTYPE_MAPPING["org_code"].__visit_name__ == "string"


def test_empty_dataframe_returns_zero():
    from ingestion.staging_loader import load
    import pandas as pd
    
    empty_df = pd.DataFrame()
    mock_engine = MagicMock()
    
    with patch("ingestion.staging_loader.get_engine", return_value=mock_engine):
        with patch("ingestion.staging_loader._ensure_schema"):
            with patch("ingestion.staging_loader.log"):
                result = load(df=empty_df, source_file_name="test.xls", 
                              source_file_hash="abc", source_url="http://test")
                assert result == 0


def test_validate_rejects_missing_required_columns():
    from ingestion.staging_loader import _validate
    import pandas as pd
    
    df = pd.DataFrame({"period": ["2024-01-01"]})  # missing org_code, org_name
    with pytest.raises(ValueError, match="Missing required columns"):
        _validate(df)


def test_validate_rejects_nan_period():
    from ingestion.staging_loader import _validate
    import pandas as pd
    import numpy as np
    
    df = pd.DataFrame({"period": [np.nan], "org_code": ["R1H"], "org_name": ["Test"]})
    with pytest.raises(ValueError, match="period is required"):
        _validate(df)


def test_validate_rejects_empty_org_code():
    from ingestion.staging_loader import _validate
    import pandas as pd
    
    df = pd.DataFrame({"period": ["2024-01-01"], "org_code": [""], "org_name": ["Test"]})
    with pytest.raises(ValueError, match="org_code is required"):
        _validate(df)


def test_ddl_runs_once():
    from ingestion.staging_loader import _ensure_schema, _DDL
    from unittest.mock import MagicMock
    
    mock_conn = MagicMock()
    _ensure_schema(mock_conn)
    _ensure_schema(mock_conn)  # Second call
    
    # DDL statements should only execute once
    ddl_count = len([s for s in _DDL.strip().split(";") if s.strip()])
    assert mock_conn.execute.call_count == ddl_count


def test_schema_uses_integer_not_bigint():
    from ingestion.staging_loader import _DDL
    assert "INTEGER" in _DDL
    assert "BIGINT" not in _DDL


def test_structured_logging_contains_correlation_fields():
    from ingestion.staging_loader import load
    from unittest.mock import MagicMock, patch
    import pandas as pd
    
    df = pd.DataFrame([{
        "period": "2024-01-01", "org_code": "R1H", "org_name": "Test",
        "attendances_total": 100, "source_file_name": "test.xls",
        "source_file_hash": "abc", "source_url": "http://test", "ingested_at": pd.Timestamp.now()
    }])
    
    mock_engine = MagicMock()
    
    with patch("ingestion.staging_loader.get_engine", return_value=mock_engine):
        with patch("ingestion.staging_loader._ensure_schema"):
            with patch("ingestion.staging_loader.log") as mock_log:
                load(df=df,
                     source_file_name="test.xls", source_file_hash="abc", source_url="http://test")
                
                call_args = mock_log.info.call_args
                assert call_args is not None
                extra = call_args.kwargs.get("extra", {})
                assert extra["source_file_name"] == "test.xls"
                assert "duration_ms" in extra
                assert "periods_affected" in extra


def test_get_engine_returns_same_instance():
    from ingestion.staging_loader import get_engine
    
    engine1 = get_engine()
    engine2 = get_engine()
    assert engine1 is engine2


def test_docstring_has_no_typos():
    from ingestion.staging_loader import load
    doc = load.__doc__ or ""
    assert "Monhtly" not in doc
    assert "seperately" not in doc
    assert "FULL history" not in doc  # misleading comment removed


if __name__ == "__main__":
    pytest.main([__file__, "-v"])