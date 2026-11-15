#!/usr/bin/env python3
"""Offline regression tests for the calibrated P1 performance gate.

These tests do not touch the database. They pin the measurement contract that
would otherwise let a 0-ACK, capture-off, empty-batch or hard-coded-kind sample
look like a PASS.
"""

from __future__ import annotations

import ast
import importlib.util
import inspect
import unittest
from collections import Counter
from pathlib import Path

HARNESS = Path(__file__).resolve().parents[1] / "rehearse-p1.py"
SPEC = importlib.util.spec_from_file_location("rehearse_p1", HARNESS)
assert SPEC is not None and SPEC.loader is not None
rehearse = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(rehearse)


def on_record(**overrides):
    rec = {
        "ev_bytes": "12691", "lp_bytes": "3231", "body_bytes": "16022",
        "batch_stored_bytes": "2811", "batch_text_bytes": "20881",
        "ev_acc": "20",
        "lp_acc": "3",
        "ev_uids_ok": "true",
        "lp_uids_ok": "true",
        "batch_rows": "2",
        "batch_items": "23",
        "ev_batch_rows": "1",
        "ev_batch_items": "20",
        "lp_batch_rows": "1",
        "lp_batch_items": "3",
        "rev_delta": "0",
        "job_delta": "2",
    }
    rec.update(overrides)
    return rec


def off_record(**overrides):
    rec = {
        "ev_bytes": "12691", "lp_bytes": "3231", "body_bytes": "16022",
        "batch_stored_bytes": "0", "batch_text_bytes": "0",
        "ev_acc": "20",
        "lp_acc": "3",
        "ev_uids_ok": "true",
        "lp_uids_ok": "true",
        "batch_rows": "0",
        "batch_items": "0",
        "ev_batch_rows": "0",
        "ev_batch_items": "0",
        "lp_batch_rows": "0",
        "lp_batch_items": "0",
        "rev_delta": "0",
        "job_delta": "0",
    }
    rec.update(overrides)
    return rec


class MeasurementContractTests(unittest.TestCase):
    def test_valid_on_and_off_samples_have_no_errors(self):
        self.assertEqual(rehearse.measurement_contract_errors("on", on_record()), [])
        self.assertEqual(rehearse.measurement_contract_errors("off", off_record()), [])
        self.assertEqual(rehearse.measurement_contract_errors("absent", off_record()), [])

    def test_psql_boolean_spelling_is_accepted(self):
        self.assertEqual(
            rehearse.measurement_contract_errors(
                "on", on_record(ev_uids_ok="t", lp_uids_ok="t")), [])
        self.assertTrue(rehearse.measurement_contract_errors(
            "on", on_record(ev_uids_ok="f")))

    def test_zero_ack_is_invalid(self):
        errors = rehearse.measurement_contract_errors("on", on_record(ev_acc="0"))
        self.assertTrue(any("accepted events" in err for err in errors))

    def test_capture_off_on_sample_is_invalid(self):
        errors = rehearse.measurement_contract_errors("on", on_record(batch_rows="0"))
        self.assertTrue(any("batch_rows" in err for err in errors))

    def test_empty_batch_is_invalid(self):
        errors = rehearse.measurement_contract_errors(
            "on", on_record(batch_items="0", ev_batch_items="0", lp_batch_items="0"))
        self.assertTrue(any("batch_items" in err for err in errors))

    def test_hard_coded_kind_cannot_hide_wrong_source_kinds(self):
        errors = rehearse.measurement_contract_errors(
            "on", on_record(ev_batch_rows="0", lp_batch_rows="0"))
        self.assertTrue(any("ev_batch_rows" in err for err in errors))
        self.assertTrue(any("lp_batch_rows" in err for err in errors))

    def test_private_capture_in_off_phase_is_invalid(self):
        errors = rehearse.measurement_contract_errors("off", off_record(batch_rows="1"))
        self.assertTrue(any("private capture" in err for err in errors))

    def test_missing_or_non_numeric_field_is_invalid(self):
        errors = rehearse.measurement_contract_errors("on", on_record(job_delta="n/a"))
        self.assertTrue(any("non-numeric job_delta" in err for err in errors))


class ByteBudgetTests(unittest.TestCase):
    def test_oversize_sample_cannot_pass_even_with_fast_timing(self):
        for key, value in (("ev_bytes", "16384"), ("lp_bytes", "16384"),
                           ("body_bytes", "24577"), ("batch_text_bytes", "262145")):
            with self.subTest(key=key):
                errors = rehearse.measurement_contract_errors("on", on_record(**{key: value}))
                self.assertEqual(rehearse.classify_gate(1.0, 1.0, True, errors), "FAIL")

    def test_negative_or_missing_byte_counts_fail_closed(self):
        for key in ("ev_bytes", "lp_bytes", "body_bytes", "batch_text_bytes"):
            for value in ("-1", "n/a", None):
                with self.subTest(key=key, value=value):
                    self.assertTrue(rehearse.measurement_contract_errors(
                        "on", on_record(**{key: value})))

    def test_exact_byte_limits_remain_accepted(self):
        self.assertEqual(rehearse.measurement_contract_errors(
            "on", on_record(ev_bytes="13153", lp_bytes="3231", body_bytes="24576",
                            batch_text_bytes="262144")), [])

    def test_off_samples_also_obey_wire_byte_limits(self):
        self.assertTrue(rehearse.measurement_contract_errors(
            "off", off_record(body_bytes="24577")))


class HarnessGuardTests(unittest.TestCase):
    def test_finish_busy_claim_stream_contains_transaction_and_guard(self):
        tree = ast.parse(inspect.getsource(rehearse.finish_busy))
        claims = []
        for node in ast.walk(tree):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                    and node.func.id == "_run" and node.args
                    and isinstance(node.args[0], ast.JoinedStr)):
                value = node.args[0]
                literals = "".join(v.value for v in value.values
                                   if isinstance(v, ast.Constant) and isinstance(v.value, str))
                if "claim_jobs" in literals:
                    claims.append((value, literals))
        self.assertEqual(len(claims), 1)
        value, literals = claims[0]
        self.assertTrue(literals.startswith("BEGIN;"))
        self.assertIn("COMMIT;", literals)
        self.assertTrue(any(isinstance(v, ast.FormattedValue)
                            and isinstance(v.value, ast.Name) and v.value.id == "GUARD"
                            for v in value.values))


class GateClassificationTests(unittest.TestCase):
    def test_contract_error_fails_even_with_fast_delta(self):
        self.assertEqual(
            rehearse.classify_gate(1.0, 1.0, True, ["on: accepted events 0 != 20"]),
            "FAIL")

    def test_aa_noise_is_inconclusive(self):
        self.assertEqual(rehearse.classify_gate(5.0, 2.0, False, []), "INCONCLUSIVE")

    def test_exact_threshold_passes(self):
        self.assertEqual(rehearse.classify_gate(20.0, 10.0, True, []), "PASS")

    def test_either_threshold_above_budget_fails(self):
        self.assertEqual(rehearse.classify_gate(20.001, 10.0, True, []), "FAIL")
        self.assertEqual(rehearse.classify_gate(20.0, 10.001, True, []), "FAIL")

    def test_missing_percentage_fails(self):
        self.assertEqual(rehearse.classify_gate(1.0, None, True, []), "FAIL")

    def test_protocol_rejects_non_40_rounds_before_any_database_work(self):
        with self.assertRaises(ValueError):
            rehearse.perf(samples=39)


class OrderDesignTests(unittest.TestCase):
    def test_each_phase_occupies_each_position_eight_times(self):
        positions = {
            phase: Counter() for phase in
            ("absent", "absent_aa", "off", "off_aa", "on")}
        orders = rehearse.calibrated_phase_orders()
        self.assertEqual(len(orders), 10)
        for run in range(40):
            order = orders[run % len(orders)]
            self.assertEqual(len(order), 5)
            for position, phase in enumerate(order, start=1):
                positions[phase][position] += 1
        for phase, counts in positions.items():
            self.assertEqual(dict(counts), {1: 8, 2: 8, 3: 8, 4: 8, 5: 8},
                             msg=phase)


if __name__ == "__main__":
    unittest.main(verbosity=2)
