"""Assemble Validation Definitions and a Checkpoint that runs both suites
and updates Data Docs (the auto-generated HTML validation report).

NOTE ON VERSION SENSITIVITY: 'add_or_update' is used throughout so 
re-running this script is idempotent (no "already exists" errors on a
second run). This method exists on GX 1.x's context stores as of when 
this was written. If your installed version doesn't have it, fall back 
to the get-or-add try/except pattern used in context.py
"""

from __future__ import annotations

from collections.abc import Callable

import great_expectations as gx
from great_expectations.core.expectation_suite import ExpectationSuite
from great_expectations.core.validation_definition import ValidationDefinition

from .context import (
    get_landing_batch_definition,
    get_monthly_totals_batch_definition,
)
from .logging_setup import get_logger
from .suites import (
    LANDING_SUITE_NAME,
    MONTHLY_TOTALS_SUITE_NAME,
    build_landing_suite,
    build_monthly_totals_suite,
)

logger = get_logger(__name__)

CHECKPOINT_NAME = "nhs_ae_quality_checkpoint"
UPDATE_DOCS_ACTION_NAME = "update_data_docs"

SuiteBuilder = Callable[[gx.DataContext], ExpectationSuite]


def _get_or_add_suite(
    context: gx.DataContext, 
    name: str, 
    builder: SuiteBuilder
) -> ExpectationSuite:
    """Return an existing suite by name, or build and add it."""
    # Relying on builder to construct the suite, then add_or_update to add it
    # to ensure idempotency.
    suite = builder(context)
    return context.suites.add_or_update(suite)


def _build_validation_definition(
    context: gx.DataContext,
    name: str,
    batch,
    suite: ExpectationSuite,
) -> ValidationDefinition:
    """Create and persist a ValidationDefinition linking a batch to a suite."""
    val_def = ValidationDefinition(
        name=name,
        data=batch,
        suite=suite,
    )
    return context.validation_definitions.add_or_update(val_def)


def build_checkpoint(context: gx.DataContext) -> gx.Checkpoint:
    """Assemble the NHS A & E quality checkpoint.
    
    Raises:
        ValueError: If any required batch or suite is missing.
            If `context` is None or required batch definitions are missing.
        RuntimeError: If GX raises while creating suites, validations, or checkpoint.
    """
    if context is None:
        raise ValueError("GX Context must be provided and initalized.")
    
    try:
        # 1. Get the data batches.
        landing_batch = get_landing_batch_definition(context)
        totals_batch = get_monthly_totals_batch_definition(context)

        if landing_batch is None or totals_batch is None: 
            raise ValueError("Required batch definitions are missing.")
        
        # 2. Get the expectation suites.
        landing_suite = _get_or_add_suite(
            context, 
            LANDING_SUITE_NAME, 
            build_landing_suite
        )
        totals_suite = _get_or_add_suite(
            context, 
            MONTHLY_TOTALS_SUITE_NAME, 
            build_monthly_totals_suite
        )

        # 3. Marry the checklists to the trucks (data batches).
        landing_validation = _build_validation_definition(
            context,
            name="landing_validation",
            batch=landing_batch,
            suite=landing_suite,
        )
        totals_validation = _build_validation_definition(
            context,
            name="totals_validation",
            batch=totals_batch,
            suite=totals_suite,
        )

        checkpoint = context.checkpoints.add_or_update(
            gx.checkpoint.checkpoint.Checkpoint(
                name=CHECKPOINT_NAME,
                validation_definitions=[landing_validation, totals_validation],
                actions=[
                    gx.checkpoint.actions.UpdateDataDocsAction(name=UPDATE_DOCS_ACTION_NAME)
                ],
            )
        )

        logger.info(
            "Checkpoint '%s' assembled with 2 validation definitions",
            CHECKPOINT_NAME,
        )
        return checkpoint

    except Exception as exc:
        logger.exception("Failed to build checkpoint: %s", CHECKPOINT_NAME)
        raise RuntimeError(
            f"Checkpoint '{CHECKPOINT_NAME}' failed to build."
        ) from exc
