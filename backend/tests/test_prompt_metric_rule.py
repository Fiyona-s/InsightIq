"""The SQL planner is told to reuse a named user-defined metric exactly as written, so a plain-English question that names a
confirmed metric produces the same query as the metric and can carry its confirmed currency. Prompt text only; no provider call."""
import hashlib

from app.prompts import PROMPT_HASH, PROMPT_VERSION, SYSTEM


def test_prompt_reuses_a_named_metric_exactly():
    assert "exactly as written" in SYSTEM
    assert "the same expressions, filters, grouping and ordering" in SYSTEM
    assert "Change it only when the question" in SYSTEM


def test_prompt_version_and_hash_are_consistent_and_bumped():
    assert PROMPT_VERSION == "sql-grounding-v5"
    assert PROMPT_HASH == hashlib.sha256(SYSTEM.encode()).hexdigest()


def test_existing_safety_rules_are_still_in_the_prompt():
    for rule in ("Never infer currency or units from column names", "Only confirmed metadata defines", "Do not recast mapped"):
        assert rule in SYSTEM
