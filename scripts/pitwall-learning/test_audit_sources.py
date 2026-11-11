"""Offline safety gate for the P0 audit; requires the existing pglast tool.

Run: python3 -m unittest discover -s scripts/pitwall-learning -p 'test_*.py' -v
This gate parses SQL; it never opens a database connection.
"""
from pathlib import Path
import unittest

from pglast import ast, parse_sql
from pglast.visitors import Visitor

AUDIT = Path(__file__).with_name("audit-sources.sql")
ALLOWED_FUNCTIONS = {
    "count", "sum", "min", "max", "round", "lag", "bool_and",
    "jsonb_build_object", "jsonb_agg", "jsonb_array_length", "jsonb_typeof",
    "array_length", "current_database", "current_setting", "extract", "unnest",
}
TIMEOUTS = {"statement_timeout": "8s", "lock_timeout": "500ms", "idle_in_transaction_session_timeout": "12s"}
UNKNOWN_FIELDS = {
    "identity": set(),
    "lap_summaries": {"historical_owner_accounts", "training_eligible"},
    "measurement_events": {"qualified_physical_sets"},
    "wheel_counter_diagnostics": {"qualified_physical_sets"},
    "fuel_samples": {"historical_owner_accounts", "training_eligible"},
    "tyre_laps": {"qualified_physical_sets"},
    "prior_contributions": {"qualified_physical_sets"},
    "pit_stops": {"comparable_net_loss_examples"},
    "prior_queue": set(),
    "account_coverage": {"historical_owner_accounts"},
}


def json_object_fields(node):
    if not isinstance(node, ast.FuncCall) or node.funcname[-1].sval != "jsonb_build_object" or len(node.args or ()) % 2:
        raise ValueError("Explicit JSON object required")
    fields = {}
    for key, value in zip(node.args[::2], node.args[1::2]):
        if not isinstance(key, ast.A_Const) or not isinstance(key.val, ast.String) or key.val.sval in fields:
            raise ValueError("Unique explicit JSON keys required")
        fields[key.val.sval] = value
    return fields


def validate_audit(sql: str) -> None:
    statements = parse_sql(sql)
    if len(statements) < 7:
        raise ValueError("Missing audit sections")
    first, last = statements[0].stmt, statements[-1].stmt
    if not isinstance(first, ast.TransactionStmt) or first.kind.name != "TRANS_STMT_BEGIN":
        raise ValueError("Explicit read-only transaction required")
    options = {o.defname: o.arg for o in first.options or ()}
    read_only = options.get("transaction_read_only")
    if read_only is None or read_only.val.ival != 1:
        raise ValueError("READ ONLY required")
    if not isinstance(last, ast.TransactionStmt) or last.kind.name != "TRANS_STMT_ROLLBACK":
        raise ValueError("ROLLBACK required")
    for statement in statements[1:-1]:
        node = statement.stmt
        if not isinstance(node, (ast.SelectStmt, ast.VariableSetStmt)):
            raise ValueError("Only SELECT and local timeouts allowed")
        if isinstance(node, ast.VariableSetStmt) and (
            not node.is_local or node.kind.name != "VAR_SET_VALUE" or node.name not in {
                "statement_timeout", "lock_timeout", "idle_in_transaction_session_timeout"
            }
        ):
            raise ValueError("Only local timeouts allowed")
        if isinstance(node, ast.VariableSetStmt):
            if len(node.args or ()) != 1 or not isinstance(node.args[0], ast.A_Const):
                raise ValueError("Exact bounded timeout required")
            value = node.args[0].val
            if not isinstance(value, ast.String) or value.sval != TIMEOUTS[node.name]:
                raise ValueError("Exact bounded timeout required")

    class SafetyVisitor(Visitor):
        def visit(self, ancestors, node):
            if node.__class__.__name__.endswith("Stmt") and not isinstance(
                node, (ast.RawStmt, ast.SelectStmt, ast.VariableSetStmt, ast.TransactionStmt)
            ):
                raise ValueError("Mutating or unsupported statement")

        def visit_SelectStmt(self, ancestors, node):
            if node.intoClause is not None or node.lockingClause:
                raise ValueError("No SELECT INTO or row locks")

        def visit_FuncCall(self, ancestors, node):
            parts: list[str] = [x.sval for x in node.funcname]
            if not parts or len(parts) > 2 or (len(parts) == 2 and parts[0] != "pg_catalog") or parts[-1] not in ALLOWED_FUNCTIONS:
                raise ValueError("Function not allowlisted")

    SafetyVisitor()(statements)
    local_settings = {s.stmt.name for s in statements if isinstance(s.stmt, ast.VariableSetStmt)}
    if local_settings != {"statement_timeout", "lock_timeout", "idle_in_transaction_session_timeout"}:
        raise ValueError("All bounded local timeouts required")
    sections = set()
    for raw in statements:
        if not isinstance(raw.stmt, ast.SelectStmt):
            continue
        targets = raw.stmt.targetList or ()
        if len(targets) != 1:
            raise ValueError("One aggregate JSON output per section required")
        outer = json_object_fields(targets[0].val)
        kind = outer.get("kind")
        if kind is None or not isinstance(kind, ast.A_Const) or not isinstance(kind.val, ast.String):
            raise ValueError("Explicit section name required")
        name = kind.val.sval
        if name not in UNKNOWN_FIELDS or name in sections or set(outer) != {"kind", "data"}:
            raise ValueError("Unexpected or duplicate section")
        fields = json_object_fields(outer["data"])
        for key in UNKNOWN_FIELDS[name]:
            value = fields.get(key)
            if value is None or not isinstance(value, ast.A_Const) or not value.isnull:
                raise ValueError("Unverified count must remain NULL in its own section")
        sections.add(name)
    if sections != set(UNKNOWN_FIELDS):
        raise ValueError("All ten named sections required exactly once")


class AuditSafetyTests(unittest.TestCase):
    def test_real_audit_is_bounded_and_read_only(self):
        validate_audit(AUDIT.read_text())

    def test_required_sections_exist_and_unknown_is_not_zero(self):
        text = AUDIT.read_text()
        for section in UNKNOWN_FIELDS:
            self.assertIn("'" + section + "'", text)
        self.assertIn("'qualified_physical_sets', NULL", text)
        self.assertIn("'historical_owner_accounts', NULL", text)
        self.assertIn("'as_of_reconstructable', false", text)

    def mutate(self, clause):
        return AUDIT.read_text().replace("ROLLBACK;", clause + ";\nROLLBACK;")

    def test_rejects_missing_wheel_section(self):
        text = AUDIT.read_text()
        for raw in parse_sql(text):
            if isinstance(raw.stmt, ast.SelectStmt) and "wheel_counter_diagnostics" in text[raw.stmt_location:raw.stmt_location + raw.stmt_len]:
                mutated = text[:raw.stmt_location] + text[raw.stmt_location + raw.stmt_len + 1:]
                with self.assertRaises(ValueError):
                    validate_audit(mutated)
                return
        self.fail("Wheel section not found")

    def test_rejects_unknown_changed_to_zero_in_each_section(self):
        text = AUDIT.read_text()
        for key in ("qualified_physical_sets", "historical_owner_accounts", "training_eligible", "comparable_net_loss_examples"):
            needle = "'" + key + "', NULL"
            start = 0
            while (index := text.find(needle, start)) >= 0:
                with self.subTest(key=key, index=index), self.assertRaises(ValueError):
                    validate_audit(text[:index] + text[index:].replace(needle, "'" + key + "', 0", 1))
                start = index + len(needle)

    def test_rejects_duplicate_section(self):
        with self.assertRaises(ValueError):
            validate_audit(AUDIT.read_text().replace("'wheel_counter_diagnostics'", "'measurement_events'"))

    def test_rejects_duplicate_unknown_key(self):
        with self.assertRaises(ValueError):
            validate_audit(AUDIT.read_text().replace("'training_eligible', NULL", "'training_eligible', NULL, 'training_eligible', 0", 1))

    def test_rejects_delete(self):
        with self.assertRaises(ValueError):
            validate_audit(self.mutate("DELETE FROM public.simhub_lap_summaries"))

    def test_rejects_cte_write(self):
        with self.assertRaises(ValueError):
            validate_audit(self.mutate("WITH x AS (DELETE FROM public.simhub_lap_summaries RETURNING id) SELECT count(*) FROM x"))

    def test_rejects_select_into(self):
        with self.assertRaises(ValueError):
            validate_audit(self.mutate("SELECT 1 INTO audit_leak"))

    def test_rejects_row_lock(self):
        with self.assertRaises(ValueError):
            validate_audit(self.mutate("SELECT * FROM public.simhub_lap_summaries FOR UPDATE"))

    def test_rejects_unapproved_function(self):
        for call in ("pg_sleep(10)", "public.simhub_prune_measurements(NULL,NULL,false)", "pg_catalog.pg_terminate_backend(1)"):
            with self.subTest(call=call), self.assertRaises(ValueError):
                validate_audit(self.mutate("SELECT " + call))

    def test_rejects_persistent_setting(self):
        with self.assertRaises(ValueError):
            validate_audit(self.mutate("SET statement_timeout='1h'"))

    def test_rejects_missing_read_only(self):
        with self.assertRaises(ValueError):
            validate_audit(AUDIT.read_text().replace("READ ONLY", "READ WRITE"))

    def test_rejects_unbounded_timeout(self):
        for value in ("'0'", "'1h'", "DEFAULT"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_audit(AUDIT.read_text().replace("'8s'", value))

    def test_rejects_commit(self):
        with self.assertRaises(ValueError):
            validate_audit(AUDIT.read_text().replace("ROLLBACK;", "COMMIT;"))

    def test_rejects_second_transaction(self):
        with self.assertRaises(ValueError):
            validate_audit(self.mutate("COMMIT; BEGIN READ ONLY"))


if __name__ == "__main__":
    unittest.main()
