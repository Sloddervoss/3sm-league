#!/usr/bin/env python3
"""Offline harness regression tests; never contact Docker or production."""
import copy
import io
import os
import pathlib
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import clone as C
import resume as R
import s2e3lib as L


def metadata():
    return {'Id':'synthetic-owned-id','Config':{'Labels':{L.LABEL_KEY:L.LABEL_VAL}},
            'HostConfig':{'NetworkMode':L.NET,'PortBindings':{},'Privileged':False,'PidMode':'','IpcMode':'private','UsernsMode':'','Devices':[]},
            'Mounts':[{'Type':'volume','Name':L.DB_VOLUME,'Source':'/var/lib/docker/volumes/'+L.DB_VOLUME+'/_data'}]}


class GuardTests(unittest.TestCase):
    def test_owned_named_volume_is_not_a_bind(self):
        m=metadata();m['HostConfig']['Binds']=[L.DB_VOLUME+':/var/lib/postgresql/data']
        with patch.object(L,'container_meta',return_value=m):
            self.assertEqual(L.assert_owned(L.DB_CONTAINER)['Id'],'synthetic-owned-id')

    def test_forbidden_container_metadata_fails_closed(self):
        mutations=[('NetworkMode','host'),('PortBindings',{'5432/tcp':[{'HostPort':'5432'}]}),('Privileged',True),('PidMode','host'),('IpcMode','container:other'),('UsernsMode','host'),('Devices',[{'PathOnHost':'/dev/sda'}])]
        for key,value in mutations:
            with self.subTest(key=key):
                m=metadata();m['HostConfig'][key]=value
                with patch.object(L,'container_meta',return_value=m),self.assertRaises(L.GuardError):
                    L.assert_owned(L.DB_CONTAINER)

    def test_bind_and_socket_mounts_rejected(self):
        for mount in ({'Type':'bind','Source':'/home/production'}, {'Type':'volume','Source':'/var/run/docker.sock'}):
            m=metadata();m['Mounts']=[mount]
            with patch.object(L,'container_meta',return_value=m),self.assertRaises(L.GuardError):
                L.assert_owned(L.DB_CONTAINER)

    def test_wrong_name_label_or_missing_resource_rejected(self):
        with self.assertRaises(L.GuardError):L.assert_owned('supabase-db')
        for m in (None,{'Config':{'Labels':{}}}):
            with patch.object(L,'container_meta',return_value=m),self.assertRaises(L.GuardError):L.assert_owned(L.DB_CONTAINER)

    def test_container_absence_does_not_confuse_same_named_volume(self):
        class Result:
            returncode=1
        with patch.object(L,'remote',return_value=Result()) as remote:
            L.assert_absent(L.CLIENT_VOLUME)
            self.assertTrue(remote.call_args.args[0].startswith('docker container inspect '))

    def test_exact_saved_database_identity_required(self):
        m=metadata();m.update(State={'Running':True},Image=L.PG_IMAGE_ID)
        with patch.object(L,'assert_owned',return_value=m),self.assertRaises(AssertionError):R.guard()

    def test_tar_tree_has_unique_members(self):
        with tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR')) as d:
            root=pathlib.Path(d);(root/'nested').mkdir();(root/'nested/file.ts').write_text('export {};')
            raw=C._tar_tree(root)
            with tarfile.open(fileobj=io.BytesIO(raw)) as tf:
                names=tf.getnames()
                self.assertEqual(names,['nested','nested/file.ts'])
                member=tf.extractfile('nested/file.ts')
                assert member is not None
                self.assertEqual(member.read(),b'export {};')

    def test_total_budget_includes_http_client(self):
        self.assertLessEqual(sum(v[0] for v in C.BUDGET.values())+128,3072)
        self.assertLessEqual(round(sum(v[1] for v in C.BUDGET.values())+.1,6),2)

    def test_seed_captures_exact_id_before_start_and_removes_it(self):
        cid='a'*64
        with patch.object(R,'resource'),patch.object(L,'assert_absent'),patch.object(L,'image_id',return_value='sha256:'+'b'*64),patch.object(R,'owned_handles',return_value={}),patch.object(R,'run',side_effect=[cid,'','']) as run,patch.object(L,'log') as log,patch.object(L,'assert_owned',return_value={'Id':cid}):
            R.seed(L.FUNC_VOLUME+'-base',b'synthetic-tar','test-seed')
            self.assertIn('docker create -i --pull never',run.call_args_list[0].args[0])
            self.assertEqual(run.call_args_list[1].args[0],'docker start -ai '+cid)
            self.assertEqual(run.call_args_list[2].args[0],'docker rm -f '+cid)
            self.assertEqual(log.call_args.kwargs['id'],cid)


if __name__=='__main__':unittest.main()
