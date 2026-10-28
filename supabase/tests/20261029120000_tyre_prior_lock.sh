#!/usr/bin/env bash
# ============================================================================
# Bewijs bij 20261029120000_tyre_prior_guard_and_contract.sql:
# een ingest die tegelijk met een lange lock op tyre_prior_stats binnenkomt,
# wacht niet langer dan de lock_timeout van de trigger (2 s) en slaagt daarna.
#
# Draait tegen productie (self-hosted Supabase op 3sm-docker). Alles wat dit
# script schrijft, heeft session_key 'locktest-…' en wordt aan het eind weer
# verwijderd; het apparaat is het lege CAT-PC (290fe152).
#
#   bash supabase/tests/20261029120000_tyre_prior_lock.sh
# ============================================================================
set -euo pipefail

REMOTE=3sm-docker
DEV=290fe152-5789-448c-8420-8deb3cf3077f
SESSIE="locktest-$$"
LOCK_S=${LOCK_S:-8}
MAX_MS=${MAX_MS:-3500}

sql() {
  ssh "$REMOTE" "docker exec -i supabase-db psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 ${1:-}"
}

# Eén waarde uit de database (tuples-only, geen ruis).
q() {
  printf '%s\n' "$1" | sql "-At"
}

schoon() {
  sql >/dev/null 2>&1 <<SQL || true
delete from public.simhub_tyre_lap_samples
 where device_id = '$DEV' and session_key like 'locktest-%';
SQL
}

ok()   { echo "PASS: $*"; }
fout() { echo "FAIL: $*"; exit 1; }

trap 'schoon' EXIT

schoon

echo "1. Een lopende stint van 11 rondes klaarzetten (sessie $SESSIE)"
sql >/dev/null <<SQL
insert into public.simhub_tyre_lap_samples
  (device_id, connector_id, session_key, lap_number, tyre_set,
   wear_fl, wear_fr, wear_rl, wear_rr, car_key, track_key, captured_at)
select '$DEV', 'lock', '$SESSIE', g, 1,
       100 - g * 0.5, 100 - g * 0.5, 100 - g * 0.5, 100 - g * 0.5,
       'locktestcar', 'locktest:gp', now() + (g || ' minutes')::interval
  from generate_series(1, 11) g;
SQL
ok "stint staat klaar (nog open, dus nog niet in de pool)"

echo "2. Een andere sessie houdt $LOCK_S s een ACCESS EXCLUSIVE-lock op tyre_prior_stats"
( sql >/dev/null 2>&1 <<SQL
begin;
lock table public.tyre_prior_stats in access exclusive mode;
select pg_sleep($LOCK_S);
rollback;
SQL
) &
LOCKER=$!

for i in $(seq 1 50); do
  WACHT=$(q "select count(*) from pg_locks where relation = 'public.tyre_prior_stats'::regclass and mode = 'AccessExclusiveLock' and granted;" 2>/dev/null | tr -d '[:space:]')
  [ "${WACHT:-0}" = "1" ] && break
  sleep 0.2
done
[ "${WACHT:-0}" = "1" ] || fout "de lock kwam niet tot stand"
ok "lock is gehouden door een andere sessie"

echo "3. Nu een ronde die de stint sluit (nieuwe bandenset), met de klok erbij"
UITKOMST=$(sql 2>&1 <<SQL
\timing on
insert into public.simhub_tyre_lap_samples
  (device_id, connector_id, session_key, lap_number, tyre_set,
   wear_fl, wear_fr, wear_rl, wear_rr, car_key, track_key, captured_at)
values ('$DEV', 'lock', '$SESSIE', 12, 2,
        100, 100, 100, 100, 'locktestcar', 'locktest:gp', now() + interval '20 minutes');
SQL
) || fout "de insert faalde: $UITKOMST"

MS=$(printf '%s\n' "$UITKOMST" | sed -n 's/^Time: \([0-9.]*\) ms.*$/\1/p' | tail -1)
[ -n "${MS:-}" ] || fout "geen tijdmeting in de uitvoer: $UITKOMST"
MS_INT=$(printf '%.0f' "$MS")

printf '%s\n' "$UITKOMST" | grep -qi "statistiek overgeslagen" \
  && ok "de trigger meldde de overslag als warning en liet de ingest door" \
  || fout "geen warning over de overgeslagen statistiek: $UITKOMST"

echo "4. De insert wachtte ${MS_INT} ms (lock_timeout is 2000 ms, grens $MAX_MS ms)"
[ "$MS_INT" -ge 1500 ] || fout "de insert wachtte maar ${MS_INT} ms — heeft hij de lock wel geraakt?"
[ "$MS_INT" -le "$MAX_MS" ] || fout "de insert wachtte ${MS_INT} ms, meer dan de lock_timeout"

RIJEN=$(q "select count(*) from public.simhub_tyre_lap_samples where device_id = '$DEV' and session_key = '$SESSIE';" | tr -d '[:space:]')
[ "$RIJEN" = "12" ] || fout "de insert is niet bewaard (rijen: $RIJEN)"
ok "de ronde staat in de tabel: de ingest is niet geblokkeerd"

wait "$LOCKER" || true

echo "5. De statistiek liep achter en is te repareren"
STINTS=$(q "select coalesce(sum(stints), 0) from public.tyre_prior_stats where car_key = 'locktestcar';" | tr -d '[:space:]')
[ "$STINTS" = "0" ] || fout "verwachtte 0 stints (overgeslagen), kreeg $STINTS"
ok "de pool is niet bijgewerkt tijdens de lock (0 stints)"

sql >/dev/null <<'SQL'
select public.tyre_prior_refresh();
SQL
STINTS=$(q "select coalesce(sum(stints), 0) from public.tyre_prior_stats where car_key = 'locktestcar';" | tr -d '[:space:]')
[ "$STINTS" = "1" ] || fout "na tyre_prior_refresh() verwachtte ik 1 stint, kreeg $STINTS"
ok "tyre_prior_refresh() haalt de achterstand in (1 stint, 10 rondes)"

schoon
REST=$(q "select count(*) from public.simhub_tyre_lap_samples where session_key like 'locktest-%';" | tr -d '[:space:]')
[ "$REST" = "0" ] || fout "opruimen liet $REST rijen achter"
ok "opgeruimd: geen locktest-rijen meer"

echo
echo "PASS: ingest wacht hooguit de lock_timeout en gaat daarna door"
