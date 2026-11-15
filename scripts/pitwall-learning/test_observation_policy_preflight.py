"""Unit-test the exact harness preflight with I/O injected; never contact Docker/SSH."""
import ast
import os
from pathlib import Path
from types import SimpleNamespace
import unittest

SOURCE = Path(os.environ.get('S2E2_PREFLIGHT_SOURCE', str(Path(__file__).with_name('rehearse-observation-policy-s2e2.py'))))

class PreflightTests(unittest.TestCase):
    def evaluate(self, available_kib):
        calls = []
        def remote(*args):
            calls.append(args)
            if args[0] == 'hostname': out = 'synthetic-host\n'
            elif args[0] == 'awk': out = str(available_kib) + '\n'
            elif args[0] == 'df': out = 'Filesystem Blocks Used Available Capacity Mounted\nsynthetic 8192 1 8191 1% /\n'
            else: raise AssertionError(args)
            return SimpleNamespace(returncode=0, stdout=out.encode())
        def docker(*args):
            calls.append(args)
            if args[0] == 'info': out = 'synthetic-daemon\n'
            elif args[:2] == ('inspect', 'supabase-db'): out = 'synthetic-production-id\n'
            else: raise AssertionError(args)
            return SimpleNamespace(returncode=0, stdout=out.encode())
        def docker_out(*args):
            calls.append(args)
            if args[:2] == ('image', 'inspect'): return 'synthetic-image'
            if args[0] == 'ps': return ''
            raise AssertionError(args)
        tree = ast.parse(SOURCE.read_text())
        fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'preflight')
        scope = {'remote': remote, 'docker': docker, 'docker_out': docker_out,
                 'IMAGE_ID': 'synthetic-image', 'CONTAINER': 'synthetic-test', 'StageError': RuntimeError}
        exec(compile(ast.Module(body=[fn], type_ignores=[]), str(SOURCE), 'exec'), scope)
        return scope['preflight'](), calls

    def test_zero_denied(self):
        with self.assertRaisesRegex(RuntimeError, 'memory'): self.evaluate(0)
    def test_two_mib_denied(self):
        with self.assertRaisesRegex(RuntimeError, 'memory'): self.evaluate(2 * 1024)
    def test_one_kib_below_threshold_denied(self):
        with self.assertRaisesRegex(RuntimeError, 'memory'): self.evaluate(1536 * 1024 - 1)
    def test_exact_threshold_allowed_and_reported_in_mib(self):
        result, _ = self.evaluate(1536 * 1024)
        self.assertEqual(result['mem_available_mib'], 1536)
    def test_recorded_host_sample_converted(self):
        result, _ = self.evaluate(5710132)
        self.assertEqual(result['mem_available_mib'], 5710132 // 1024)
    def test_no_production_container_inspection(self):
        result, calls = self.evaluate(4096 * 1024)
        self.assertFalse(result['production_container_inspected'])
        self.assertNotIn(('inspect', 'supabase-db', '--format', '{{.Id}}'), calls)

if __name__ == '__main__': unittest.main(verbosity=2)
