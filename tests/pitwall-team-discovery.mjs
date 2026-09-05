// Run with a local @electric-sql/pglite dist/index.js path as argument.
// Uses an in-memory database only; no connection to production.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const user = "11111111-1111-4111-8111-111111111111";
const staff = "22222222-2222-4222-8222-222222222222";
const event = "33333333-3333-4333-8333-333333333333";
const otherEvent = "44444444-4444-4444-8444-444444444444";
const team = "55555555-5555-4555-8555-555555555555";
try {
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      'SELECT nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    CREATE FUNCTION public.is_endurance_staff(uuid) RETURNS boolean LANGUAGE sql STABLE AS
      'SELECT $1 = ''${staff}''::uuid';
    CREATE TABLE public.endurance_teams(id uuid PRIMARY KEY, event_id uuid, name text);
    CREATE TABLE public.endurance_team_members(team_id uuid, user_id uuid);
    INSERT INTO public.endurance_teams VALUES
      ('${team}', '${event}', 'Own team'),
      ('66666666-6666-4666-8666-666666666666', '${event}', 'Other team'),
      ('77777777-7777-4777-8777-777777777777', '${otherEvent}', 'Other event');
    INSERT INTO public.endurance_team_members VALUES ('${team}', '${user}');
  `);
  await db.exec(await readFile("supabase/migrations/20260905110000_pitwall_team_discovery.sql", "utf8"));
  await db.exec("SET ROLE anon");
  await assert.rejects(db.query("SELECT * FROM public.get_pitwall_teams($1)", [event]), /permission denied/i);
  await db.exec("RESET ROLE; SET ROLE authenticated");
  await assert.rejects(db.query("SELECT * FROM public.get_pitwall_teams($1)", [event]), /Authentication required/i);
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [user]);
  assert.deepEqual((await db.query("SELECT * FROM public.get_pitwall_teams($1)", [event])).rows, [{ id: team, name: "Own team" }]);
  assert.equal((await db.query("SELECT * FROM public.get_pitwall_teams($1)", [otherEvent])).rows.length, 0);
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [staff]);
  assert.equal((await db.query("SELECT * FROM public.get_pitwall_teams($1)", [event])).rows.length, 2);
  assert.equal((await db.query("SELECT * FROM public.get_pitwall_teams($1)", [otherEvent])).rows.length, 1);
  await db.exec("RESET ROLE");
  await db.exec(await readFile("supabase/rollback/20260905110000_pitwall_team_discovery.rollback.sql", "utf8"));
  assert.equal((await db.query("SELECT to_regprocedure('public.get_pitwall_teams(uuid)') AS fn")).rows[0].fn, null);
  console.log("PASS: migration, anonymous denial, unauthenticated denial, own-team isolation, event isolation, staff access and rollback");
} finally { await db.close(); }
