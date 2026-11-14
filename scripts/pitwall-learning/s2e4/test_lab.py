import pathlib
import subprocess
import unittest
from unittest.mock import patch
import lab

class IsolationTests(unittest.TestCase):
    def test_output_and_names_are_new(self):
        self.assertNotEqual(lab.L.ART,lab.OLD)
        self.assertEqual(lab.L.LABEL,'3sm.test=pitwall-learning-s2e4')
        self.assertNotIn('pitwall_learning_s2e3_',lab.L.CLONE_GUARD)
        for field in ('NET','DB_CONTAINER','FUNC_VOLUME','DENO_VOLUME','CLIENT_VOLUME'):
            self.assertTrue(getattr(lab.L,field).startswith('pitwall-learning-s2e4-'))

    def test_production_fetches_disabled(self):
        for fn in (lab.C.fetch_live_edge,lab.C.functions,lab.L.psql_prod_file,lab.C.reset_lab):
            with self.assertRaises(lab.L.GuardError):fn()

    def test_default_psql_targets_only_new_candidate(self):
        with patch.object(lab.L,'psql_clone',return_value=subprocess.CompletedProcess([],0,b'ok',b'')) as query:
            self.assertEqual(lab.L.psql_clone_ok('SELECT 1'),'ok')
            self.assertEqual(query.call_args.args[1],'pitwall_learning_s2e4_cand')

    def test_replaced_id_and_mounts_refused(self):
        meta={'Id':'new','Image':'image','Mounts':[],'Config':{},'HostConfig':{}}
        with patch.object(lab,'original_owned',return_value=meta),patch.object(lab,'ledger',return_value={'pitwall-learning-s2e4-db':{'id':'old'}}):
            with self.assertRaises(AssertionError):lab.owned('pitwall-learning-s2e4-db')

if __name__=='__main__':unittest.main()
