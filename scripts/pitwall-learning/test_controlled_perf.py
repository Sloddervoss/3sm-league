#!/usr/bin/env python3
"""Offline contract tests for the one pre-registered 200-round P1 perf run.

These tests never touch a database, Docker or SSH. They pin the design that
would otherwise let a 40-round run, a position-confounded maintenance
schedule, a p50 substitution, an incomplete ACK or a post-hoc threshold change
look like a valid PASS.
"""

from __future__ import annotations

import copy
import json
import tempfile
import unittest
from collections import Counter
from pathlib import Path

import controlled_perf as cp

ROOT = Path(__file__).resolve().parents[2]
PROTOCOL = ROOT / "docs/operations/pitwall-learning-p1-controlled-perf-protocol.json"
SIDECAR = PROTOCOL.with_suffix(".sha256")


def protocol_data() -> dict:
    return json.loads(PROTOCOL.read_text(encoding="utf-8"))


def on_fields(**overrides):
    rec = {
        "ms": "100.000",
        "ev_bytes": "12691",
        "lp_bytes": "3231",
        "body_bytes": "16022",
        "batch_stored_bytes": "2811",
        "batch_text_bytes": "20881",
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


def off_fields(**overrides):
    rec = on_fields(
        ms="100.000",
        batch_stored_bytes="0",
        batch_text_bytes="0",
        batch_rows="0",
        batch_items="0",
        ev_batch_rows="0",
        ev_batch_items="0",
        lp_batch_rows="0",
        lp_batch_items="0",
        rev_delta="0",
        job_delta="0",
    )
    rec.update(overrides)
    return rec


def sample(run: int, position: int, phase: str, fields: dict) -> dict:
    return {
        "run": run,
        "cycle": (run - 1) // 10,
        "position": position,
        "phase": phase,
        "fields": fields,
    }


def full_samples(on_ms: float = 100.0, absent_ms: float = 100.0,
                 off_ms: float = 100.0, absent_aa_ms: float = 100.0,
                 off_aa_ms: float = 100.0, on_values: list[float] | None = None,
                 absent_values: list[float] | None = None) -> list[dict]:
    rows = []
    for run in range(1, 201):
        for phase in cp.PHASES:
            if phase == "on" and on_values is not None:
                ms = on_values[run - 1]
            elif phase == "absent" and absent_values is not None:
                ms = absent_values[run - 1]
            else:
                ms = {
                    "on": on_ms,
                    "absent": absent_ms,
                    "off": off_ms,
                    "absent_aa": absent_aa_ms,
                    "off_aa": off_aa_ms,
                }[phase]
            fields = on_fields(ms=f"{ms:.3f}") if phase == "on" else off_fields(
                ms=f"{ms:.3f}")
            rows.append(sample(run, (run - 1) % 5 + 1, phase, fields))
    return rows


def inspect_payload(container_id: str = "a" * 64) -> dict:
    return {
        "Id": container_id,
        "Name": "/pitwall-learning-p1-controlled-20261111",
        "Image": "sha256:1aabcd9cfb8a58ecde50a6092b207bcbb5f6bdc45546fde35cfda5d3ab39c065",
        "State": {"Running": True},
        "Config": {
            "User": "100:101",
            "Image": "supabase/postgres:15.19.0.004",
            "Labels": {"3sm.test": "pitwall-learning-p1-controlled"},
        },
        "HostConfig": {
            "NetworkMode": "none",
            "PortBindings": {},
            "ReadonlyRootfs": True,
            "Memory": 536870912,
            "NanoCpus": 1000000000,
            "PidsLimit": 64,
            "Tmpfs": {
                "/work": "rw,noexec,nosuid,nodev,size=384m,uid=100,gid=101,mode=700"
            },
        },
        "NetworkSettings": {"Ports": {}, "Networks": {"none": {}}},
    }


class ProtocolPreregistrationTests(unittest.TestCase):
    def test_protocol_is_the_preregistered_200_round_design(self):
        data, digest = cp.load_protocol(PROTOCOL)
        self.assertEqual(data["design"]["rounds"], 200)
        self.assertEqual(data["design"]["cycles"], 20)
        self.assertEqual(data["design"]["orders_per_cycle"], 10)
        self.assertEqual(data["design"]["measured_samples"], 1000)
        self.assertEqual(data["design"]["total_rpcs"], 4000)
        self.assertEqual(data["design"]["warmup_ingests_per_phase"], 3)
        self.assertEqual(data["statistic"]["quantile"], "nearest-rank p95")
        self.assertEqual(data["gate"]["delta_ms_max"], 20.0)
        self.assertEqual(data["gate"]["delta_pct_max"], 10.0)
        self.assertEqual(data["aa_control"]["delta_ms_max"], 20.0)
        self.assertEqual(data["aa_control"]["delta_pct_max"], 10.0)
        self.assertEqual(len(digest), 64)

    def test_sidecar_hash_matches_the_committed_protocol(self):
        _, digest = cp.load_protocol(PROTOCOL)
        self.assertEqual(SIDECAR.read_text(encoding="utf-8").split()[0], digest)

    def test_non_200_rounds_are_refused(self):
        data = protocol_data()
        data["design"]["rounds"] = 40
        data["design"]["cycles"] = 4
        data["design"]["measured_samples"] = 200
        data["design"]["total_rpcs"] = 800
        errors = cp.validate_protocol_data(data)
        self.assertTrue(any("rounds" in err for err in errors), errors)

    def test_two_warmups_are_refused(self):
        data = protocol_data()
        data["design"]["warmup_ingests_per_phase"] = 2
        data["design"]["total_rpcs"] = 3000
        errors = cp.validate_protocol_data(data)
        self.assertTrue(any("warmup" in err for err in errors), errors)

    def test_threshold_cannot_be_relaxed(self):
        data = protocol_data()
        data["gate"]["delta_ms_max"] = 25.0
        errors = cp.validate_protocol_data(data)
        self.assertTrue(any("gate" in err for err in errors), errors)

    def test_image_and_network_are_pinned(self):
        data = protocol_data()
        data["target"]["image_id"] = "sha256:" + "0" * 64
        errors = cp.validate_protocol_data(data)
        self.assertTrue(any("image" in err for err in errors), errors)

    def test_protocol_sidecar_mismatch_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            proto = Path(tmp) / "protocol.json"
            proto.write_bytes(PROTOCOL.read_bytes())
            proto.with_suffix(".sha256").write_text(
                "0" * 64 + "  protocol.json\n", encoding="utf-8")
            with self.assertRaises(cp.ProtocolError):
                cp.load_protocol(proto)


class OrderDesignTests(unittest.TestCase):
    def test_every_phase_occupies_every_position_forty_times(self):
        sequence = cp.order_sequence()
        self.assertEqual(len(sequence), 200)
        counts = cp.position_counts(sequence)
        for phase in cp.PHASES:
            self.assertEqual(counts[phase], {str(i): 40 for i in range(1, 6)})

    def test_each_ten_round_cycle_contains_each_order_exactly_once(self):
        sequence = cp.order_sequence()
        base = cp.rehearse.calibrated_phase_orders(cp.PHASES)
        for cycle in range(20):
            block = sequence[cycle * 10:(cycle + 1) * 10]
            self.assertEqual(sorted(block), sorted(base))

    def test_boundary_round_order_rotates_through_all_ten(self):
        summary = cp.maintenance_boundary_summary(cp.order_sequence())
        boundaries = [tuple(entry["boundary_order"]) for entry in summary]
        self.assertEqual(len(boundaries), 20)
        self.assertEqual(Counter(boundaries),
                         Counter({tuple(order): 2 for order in cp.rehearse.calibrated_phase_orders(cp.PHASES)}))

    def test_boundary_and_after_indices_match_the_actual_run_rotation(self):
        # Independently observed from the frozen samples/rounds: run 10 has
        # index 9, run 11 index 1, run 20 index 0, run 21 index 2, ...,
        # run 200 index 8.  The pair is (boundary round, first round after).
        summary = cp.maintenance_boundary_summary(cp.order_sequence())
        self.assertEqual(
            [(entry["boundary_round"],
              entry["boundary_order_index"],
              entry["first_round_after_boundary"],
              entry["first_order_index_after_boundary"])
             for entry in summary],
            [(10, 9, 11, 1), (20, 0, 21, 2), (30, 1, 31, 3),
             (40, 2, 41, 4), (50, 3, 51, 5), (60, 4, 61, 6),
             (70, 5, 71, 7), (80, 6, 81, 8), (90, 7, 91, 9),
             (100, 8, 101, 0), (110, 9, 111, 1), (120, 0, 121, 2),
             (130, 1, 131, 3), (140, 2, 141, 4), (150, 3, 151, 5),
             (160, 4, 161, 6), (170, 5, 171, 7), (180, 6, 181, 8),
             (190, 7, 191, 9), (200, 8, None, None)])

    def test_first_order_after_boundary_is_the_next_measured_round(self):
        # Synthetic sequence makes the slice unambiguous: index i contains
        # ["order-i"].  Boundary 10 is sequence[9]; the first measurement after
        # it is run 11 = sequence[10], not the boundary round again.
        sequence = [[f"order-{index}"] for index in range(200)]
        summary = cp.maintenance_boundary_summary(sequence)
        first = summary[0]
        self.assertEqual(first["boundary_order"], ["order-9"])
        self.assertEqual(first["first_order_after_boundary"], ["order-10"])
        self.assertEqual(first["first_round_after_boundary"], 11)
        self.assertEqual(first["first_order_index_after_boundary"], 1)

    def test_last_boundary_has_no_following_round(self):
        summary = cp.maintenance_boundary_summary(cp.order_sequence())
        last = summary[-1]
        self.assertEqual(last["boundary_round"], 200)
        self.assertEqual(last["boundary_order_index"], 8)
        self.assertEqual(last["boundary_order"], cp.order_sequence()[199])
        self.assertIsNone(last["first_round_after_boundary"])
        self.assertIsNone(last["first_order_index_after_boundary"])
        self.assertIsNone(last["first_order_after_boundary"])

    def test_maintenance_boundaries_are_the_ten_round_boundaries(self):
        data = protocol_data()
        self.assertEqual(data["design"]["maintenance_boundary_rounds"],
                         list(range(10, 201, 10)))


class GateTests(unittest.TestCase):
    def test_p95_is_used_not_p50(self):
        # p50 is identical (100 ms) but the top tail pushes p95 to 130 ms.
        on = [100.0] * 100 + [130.0] * 100
        result = cp.analyze_samples(full_samples(on_values=on), protocol_data())
        self.assertEqual(result["stats"]["on"]["p50_ms"], 100.0)
        self.assertEqual(result["stats"]["on"]["p95_ms"], 130.0)
        self.assertEqual(result["gate_status"], "FAIL")

    def test_exact_thresholds_pass(self):
        result = cp.analyze_samples(
            full_samples(on_ms=110.0, absent_ms=100.0), protocol_data())
        self.assertEqual(result["overhead_vs_absent"]["p95_ms"], 10.0)
        self.assertEqual(result["overhead_vs_absent"]["p95_pct"], 10.0)
        self.assertEqual(result["gate_status"], "PASS")

    def test_aa_noise_is_inconclusive(self):
        result = cp.analyze_samples(
            full_samples(absent_aa_ms=125.0, off_ms=100.0, off_aa_ms=100.0),
            protocol_data())
        self.assertFalse(result["aa_control"]["within_budget"])
        self.assertEqual(result["gate_status"], "INCONCLUSIVE")

    def test_negative_aa_delta_is_absolute_noise(self):
        result = cp.analyze_samples(
            full_samples(absent_aa_ms=75.0, off_ms=100.0, off_aa_ms=100.0),
            protocol_data())
        self.assertFalse(result["aa_control"]["within_budget"])

    def test_any_contract_error_in_any_late_sample_fails(self):
        rows = full_samples()
        target = next(row for row in rows
                      if row["run"] == 156 and row["phase"] == "on")
        target["fields"] = on_fields(ev_acc="0")
        result = cp.analyze_samples(rows, protocol_data())
        self.assertEqual(result["gate_status"], "FAIL")
        self.assertTrue(any("run 156" in err for err in result["measurement_contract_errors"]))

    def test_every_record_is_checked_for_byte_budget(self):
        rows = full_samples()
        target = next(row for row in rows if row["run"] == 101 and row["phase"] == "on")
        target["fields"] = on_fields(body_bytes="24577")
        result = cp.analyze_samples(rows, protocol_data())
        self.assertEqual(result["gate_status"], "FAIL")
        self.assertTrue(any("24577" in err or "body" in err
                            for err in result["measurement_contract_errors"]))

    def test_on_batch_contract_is_two_batches_and_23_items(self):
        rows = full_samples()
        target = next(row for row in rows if row["run"] == 42 and row["phase"] == "on")
        target["fields"] = on_fields(batch_rows="1", batch_items="20",
                                     lp_batch_rows="0", lp_batch_items="0")
        result = cp.analyze_samples(rows, protocol_data())
        self.assertEqual(result["gate_status"], "FAIL")

    def test_incomplete_dataset_never_passes(self):
        result = cp.analyze_samples(full_samples()[:999], protocol_data())
        self.assertEqual(result["gate_status"], "INCOMPLETE")
        self.assertFalse(result["gate_pass"])

    def test_bootstrap_ci_is_deterministic_and_labelled_diagnostic(self):
        xs = [float(i % 37) for i in range(200)]
        ys = [float((i * 3) % 41) for i in range(200)]
        a = cp.bootstrap_p95_ci(xs, ys, seed=20261111, resamples=500)
        b = cp.bootstrap_p95_ci(xs, ys, seed=20261111, resamples=500)
        self.assertEqual(a, b)
        self.assertEqual(a["role"], "diagnostic_only_not_gate")


class ContainerGuardTests(unittest.TestCase):
    def expected(self):
        return cp.expected_container(protocol_data(), "a" * 64)

    def test_valid_inspect_passes(self):
        cp.assert_container_identity(inspect_payload(), self.expected())

    def test_wrong_id_label_network_image_user_memory_cpu_pids_fail(self):
        overrides = {
            "Id": "b" * 64,
            "Config.Labels": {"3sm.test": "something-else"},
            "HostConfig.NetworkMode": "bridge",
            "Image": "sha256:" + "1" * 64,
            "Config.User": "0:0",
            "HostConfig.Memory": 1073741824,
            "HostConfig.NanoCpus": 500000000,
            "HostConfig.PidsLimit": 128,
            "HostConfig.ReadonlyRootfs": False,
        }
        for key, value in overrides.items():
            with self.subTest(key=key):
                info = copy.deepcopy(inspect_payload())
                node = info
                parts = key.split(".")
                for part in parts[:-1]:
                    node = node[part]
                node[parts[-1]] = value
                with self.assertRaises(cp.GuardError):
                    cp.assert_container_identity(info, self.expected())

    def test_tmpfs_size_and_uid_gid_are_checked(self):
        for value in ("rw,size=128m,uid=100,gid=101",
                      "rw,size=384m,uid=0,gid=0"):
            with self.subTest(value=value):
                info = inspect_payload()
                info["HostConfig"]["Tmpfs"]["/work"] = value
                with self.assertRaises(cp.GuardError):
                    cp.assert_container_identity(info, self.expected())

    def test_published_port_is_refused(self):
        info = inspect_payload()
        info["HostConfig"]["PortBindings"] = {"5432/tcp": [{"HostPort": "5432"}]}
        info["NetworkSettings"]["Ports"] = {"5432/tcp": [{"HostPort": "5432"}]}
        with self.assertRaises(cp.GuardError):
            cp.assert_container_identity(info, self.expected())

    def test_invalid_container_stops_before_any_psql(self):
        original_inspect, original_psql = cp._docker_inspect, cp._psql
        calls = {"psql": 0}

        def fake_inspect(_container_id):
            info = inspect_payload()
            info["HostConfig"]["NetworkMode"] = "bridge"
            return info

        def fake_psql(*_args, **_kwargs):
            calls["psql"] += 1
            raise AssertionError("psql must not run after a container guard failure")

        cp._docker_inspect, cp._psql = fake_inspect, fake_psql
        try:
            with tempfile.TemporaryDirectory() as tmp:
                with self.assertRaises(cp.GuardError):
                    cp.run_experiment(PROTOCOL, "a" * 64, Path(tmp) / "proof",
                                      require_clean_git=False)
        finally:
            cp._docker_inspect, cp._psql = original_inspect, original_psql
        self.assertEqual(calls["psql"], 0)

    def test_bad_protocol_stops_before_inspect_or_psql(self):
        data = protocol_data()
        data["design"]["rounds"] = 40
        with tempfile.TemporaryDirectory() as tmp:
            proto = Path(tmp) / "protocol.json"
            proto.write_text(json.dumps(data), encoding="utf-8")
            proto.with_suffix(".sha256").write_text(
                cp.sha256_bytes(proto.read_bytes()) + "  protocol.json\n",
                encoding="utf-8")
            original_inspect, original_psql = cp._docker_inspect, cp._psql
            calls = {"inspect": 0, "psql": 0}

            def fake_inspect(_container_id):
                calls["inspect"] += 1
                return inspect_payload()

            def fake_psql(*_args, **_kwargs):
                calls["psql"] += 1
                raise AssertionError("psql must not run for a refused protocol")

            cp._docker_inspect, cp._psql = fake_inspect, fake_psql
            try:
                with self.assertRaises(cp.ProtocolError):
                    cp.run_experiment(proto, "a" * 64, Path(tmp) / "proof")
            finally:
                cp._docker_inspect, cp._psql = original_inspect, original_psql
        self.assertEqual(calls, {"inspect": 0, "psql": 0})

    def test_proof_root_must_be_new(self):
        with tempfile.TemporaryDirectory() as tmp:
            proof = Path(tmp) / "proof"
            cp.prepare_proof_root(proof)
            (proof / "already").write_text("x", encoding="utf-8")
            with self.assertRaises(FileExistsError):
                cp.prepare_proof_root(proof)


class CliTests(unittest.TestCase):
    def test_run_requires_explicit_container_and_protocol(self):
        with self.assertRaises(SystemExit):
            cp.main(["run"])

    def test_non_200_protocol_is_refused_by_cli_before_database(self):
        data = protocol_data()
        data["design"]["rounds"] = 40
        with tempfile.TemporaryDirectory() as tmp:
            proto = Path(tmp) / "protocol.json"
            proto.write_text(json.dumps(data), encoding="utf-8")
            proto.with_suffix(".sha256").write_text(
                cp.sha256_bytes(proto.read_bytes()) + "  protocol.json\n",
                encoding="utf-8")
            original = cp.run_experiment

            def forbidden(*_args, **_kwargs):
                raise AssertionError("run_experiment must not be called")

            cp.run_experiment = forbidden
            try:
                rc = cp.main([
                    "run", "--protocol", str(proto),
                    "--container-id", "a" * 64,
                    "--proof-root", str(Path(tmp) / "proof"),
                ])
            finally:
                cp.run_experiment = original
        self.assertNotEqual(rc, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
