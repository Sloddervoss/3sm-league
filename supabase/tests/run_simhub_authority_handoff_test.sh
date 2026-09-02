#!/usr/bin/env bash
# TEST-ONLY: run H08-H10 on the disposable local PostgreSQL instance.
set -euo pipefail
export PATH="/home/hermes/rpms/pg15/usr/pgsql-15/bin:$PATH"
export LD_LIBRARY_PATH="/home/hermes/rpms/pg15/usr/pgsql-15/lib:/home/hermes/rpms/icu67/usr/lib/x86_64-linux-gnu"
PG=(psql -X -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1)
A=cccccccc-cccc-cccc-cccc-ccccccccccc2
B=cccccccc-cccc-cccc-cccc-ccccccccccc3
EVENT=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
TEAM=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1

"${PG[@]}" -c "UPDATE public.simhub_devices SET device_role=CASE id WHEN '$A'::uuid THEN 'primary' ELSE 'standby' END WHERE id IN ('$A','$B');" >/dev/null

# H08: independent PostgreSQL sessions race two candidate promotions.
python3 -c '
import subprocess
base=["psql","-X","-h","127.0.0.1","-p","55432","-U","postgres","-v","ON_ERROR_STOP=1","-Atc"]
def q(device):
    return subprocess.Popen(base+[f"BEGIN; SET LOCAL request.jwt.claim.role='"'"'service_role'"'"'; SELECT public.simhub_set_primary_device('"'"'{device}'"'"'); COMMIT;"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
p=[q("cccccccc-cccc-cccc-cccc-ccccccccccc2"),q("cccccccc-cccc-cccc-cccc-ccccccccccc3")]
for x in p:
    out,err=x.communicate()
    if x.returncode: raise SystemExit(err)
    print(out.strip())
' > /tmp/h08-results.txt
ONE=$("${PG[@]}" -Atc "SELECT count(*) FROM public.simhub_devices WHERE endurance_event_id='$EVENT' AND endurance_team_id='$TEAM' AND device_role='primary';")
[ "$ONE" = 1 ]
printf 'H08 PASS primary_count=%s results=%s\n' "$ONE" "$(tr '\n' ',' < /tmp/h08-results.txt)"

# H09: test-only trigger raises only on target promotion, after the helper demotes
# the prior primary. PostgreSQL must roll the entire function transaction back.
"${PG[@]}" <<SQL >/dev/null
UPDATE public.simhub_devices SET device_role=CASE id WHEN '$A'::uuid THEN 'primary' ELSE 'standby' END WHERE id IN ('$A','$B');
CREATE OR REPLACE FUNCTION public.test_h09_fail_target_promotion() RETURNS trigger LANGUAGE plpgsql AS \$\$ BEGIN IF NEW.id='$B'::uuid AND NEW.device_role='primary' THEN RAISE EXCEPTION 'H09 injected promotion failure'; END IF; RETURN NEW; END; \$\$;
CREATE TRIGGER test_h09_fail_target_promotion BEFORE UPDATE ON public.simhub_devices FOR EACH ROW EXECUTE FUNCTION public.test_h09_fail_target_promotion();
SQL
set +e
"${PG[@]}" -c "BEGIN; SET LOCAL request.jwt.claim.role='service_role'; SELECT public.simhub_set_primary_device('$B'); COMMIT;" >/tmp/h09-failure.out 2>&1
RC=$?
set -e
[ "$RC" -ne 0 ]
"${PG[@]}" -c 'DROP TRIGGER test_h09_fail_target_promotion ON public.simhub_devices; DROP FUNCTION public.test_h09_fail_target_promotion();' >/dev/null
STATE=$("${PG[@]}" -Atc "SELECT string_agg(device_name||':'||device_role,',' ORDER BY device_name) FROM public.simhub_devices WHERE id IN ('$A','$B');")
[ "$STATE" = 'H-B:primary,H-C:standby' ]
printf 'H09 PASS rollback_state=%s\n' "$STATE"

OTHER=$("${PG[@]}" -Atc "SELECT device_name||':'||device_role FROM public.simhub_devices WHERE endurance_event_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2' AND endurance_team_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2' AND device_role='primary';")
[ "$OTHER" = 'H-no-primary:primary' ]
printf 'H10 PASS other_binding_primary=%s\n' "$OTHER"
