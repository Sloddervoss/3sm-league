import lab
from lab import L, R, U, ART
R.guard()
for db in lab.C.DB_FOR.values():
    print(db,L.psql_clone_ok("SELECT json_build_object('devices',(SELECT json_agg(json_build_object('id',id,'seq',last_sequence)) FROM public.simhub_devices),'laps',(SELECT json_agg(json_build_object('uid',summary_uid,'device',device_id)) FROM public.simhub_lap_summaries))",db=db))
print((ART/'setup.log').stat().st_size)
print(L.psql_clone_ok("SELECT conname||': '||pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.simhub_devices'::regclass"))
if (ART/'WRITE-TIME-RACES.json').exists():
    print([{k:r[k] for k in ('mode','core_blocked_at_persist','before','after')} for r in __import__('json').loads((ART/'WRITE-TIME-RACES.json').read_text())])
