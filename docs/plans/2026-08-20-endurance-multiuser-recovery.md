# Endurance Multi-User Recovery Implementation Plan

> **For Hermes:** Use subagent-driven-development task-by-task with spec and quality review.

**Goal:** Herstel de Endurance/SimHub-stack tot een onderhoudbare, concurrency-veilige multi-user basis die nu alpha-rollen ondersteunt en later via runtime-instellingen voor gewone leden open kan zonder nieuwe pairing-, ingest- of assignmentarchitectuur.

**Architecture:** Device-identiteit blijft permanent owner/account-scoped; event/crew-assignment blijft server-side en tijdelijk. Autorisatie wordt via server-side capabilities en runtime-killswitches bepaald in plaats van verspreide role checks. Alle multi-row writes en invarianten leven in PostgreSQL-RPC's; clients gebruiken gefilterde Realtime-invalidatie met polling/manual fallback.

**Tech Stack:** React + TanStack Query + Supabase Realtime/PostgREST, PostgreSQL RLS/SECURITY DEFINER, Deno Edge Functions, .NET Framework 4.8 SimHub plugin/updater.

---

## Release invariants

- Geen push, live migration, Edge deploy, plugin release of site deploy zonder apart akkoord.
- Nieuwe backend blijft compatibel met de huidige live frontend/plugin tijdens backend-first rollout.
- Runtime flags staan standaard in alpha/old-behavior mode.
- Uitschakelen van member-ingest trekt bestaande devices niet in; het pauzeert alleen niet-staff ingest.
- Geen clientpayload bepaalt event/team; één server-side effective-binding resolver is autoriteit.
- Verboden writes moeten hard door PostgreSQL worden geweigerd; UI-gates zijn alleen UX.
- Iedere forward migration krijgt een concrete rollback; nood-app-rollback mag geen schema-tightening vereisen.

## Task 1 — Recovery branch bovenop actuele main

**Files:** volledige conflictset in `fix/endurance-multiuser-hardening`.

1. Bewaar WIP snapshot en live-schemafingerprint buiten repo met checksums.
2. Merge `origin/main` en resolveer per hunk: main als basis, WIP-delta graften.
3. Behoud alle latere main-fixes en verwijder geen bestaande productiefunctionaliteit.
4. Draai tsc, lint, volledige Vitest-suite en SQL parsecheck.
5. Commit lokaal; niet pushen.

## Task 2 — Capability- en killswitchmodel

**Create:** nieuwe forward migration + rollback na actuele live baseline.
**Modify:** `supabase/functions/simhub-pair/index.ts`, ingest SQL successor, auth/capability repository, Navbar/EndurancePage/SimHubPairingPage.

1. Voeg een dedicated singleton `endurance_runtime_settings` toe met default alpha-safe flags:
   - `member_access_enabled=false`;
   - `member_pairing_enabled=false`;
   - `member_ingest_enabled=false`;
   - `multi_user_realtime_enabled=false`;
   - globale noodstop `simhub_ingest_enabled=true`.
2. Behoud bestaande `simhub_devices`, pairingcodes, DPAPI-token en server-side tokenhash; maak géén tweede device/JWT/pairingarchitectuur.
3. Voeg server-side capabilityhelpers/RPC toe voor current-user capabilities en service-side owner checks. Ontbrekende settingsrij = alpha-safe defaults.
4. Staff blijft toegestaan wanneer memberflags uitstaan (old-behavior fallback). Een killswitch weigert tijdelijk ingest maar revoket/verwijdert nooit een geldig device.
5. Owner-scoped list/revoke; event-/teammanager-scoped assign/clear; super-admin beheert runtimeflags.
6. Gewone leden kunnen later via flags pairen en een neutrale connection-test sturen; domain ingest blijft registratie + effective-binding-gated.
7. Frontend/Edge/plugin lezen hetzelfde servercontract; UI-rolechecks zijn alleen presentatie.
8. Voeg rolmatrixtests toe voor anon/member/tester/participant/teammanager/endurance-manager/super-admin/service-role en alpha→members→disabled→alpha toggles.

## Task 3 — Data-invarianten en atomische RPC's

**Create:** één nieuwe additive hardening migration + rollback; geen reeds toegepaste alpha-files opnieuw uitvoeren.

1. Eén eventgebonden team/crew per gebruiker via een backward-compatible, door trigger/RPC gevulde `event_id` op `endurance_team_members` en een echte unieke `(event_id,user_id)`-invariant; geen invoervolgorde of zachte `is_primary`-keuze.
2. Eén open practice per event/team via databaseconstraint en start/stop RPC.
3. Eén actuele gepubliceerde planning per event/team; publish versie + confirmations atomair.
4. Team-/planrevision of expected-updated-at voor optimistic concurrency.
5. Server-side Race Control shift/complete/replace RPC's; geen stale absolute clientupdates.
6. Iedere Race Control-write schrijft before/after audit in dezelfde transactie.
7. Assign/clear verwijdert stale `simhub_telemetry_latest` atomair.
8. Test twee gelijktijdige PostgreSQL-sessies en expliciete conflictrespons.

## Task 4 — Eén effective SimHub resolver

1. Laat ingest, RLS, device-list en latest-read exact dezelfde resolver gebruiken.
2. Manual override valideert altijd complete event/team-paar en geldigheid.
3. Auto-resolver is deterministisch en kan niet op invoervolgorde tussen crews leunen.
4. Device-token/pairing blijft owner-only; assignment-id's uit pluginpayload blijven genegeerd.
5. Voeg stale-binding, active-vs-future en wrong-team role probes toe.

## Task 5 — Complete Realtime-matrix

1. Centrale typed tabel→query-key→filter mapping voor events, registrations, availability, pace, teams, members, stints, plan versions, confirmations, practice en notifications.
2. Unieke channelnaam per purpose/event/team/user.
3. Idempotente publication migration voor alleen noodzakelijke tabellen.
4. Reconnect met bounded exponential backoff of Supabase-native reconnect; geen recursief subscribe-hotloop.
5. Runtime Realtime flag: bij uit fallback naar bestaande mutation-invalidatie + bounded polling/manual refresh.
6. Test twee QueryClients/browsers: A schrijft, B invalideert en leest nieuwe data.

## Task 6 — Race Control/practice/planning UI vereenvoudigen

1. Verwijder dubbel customDelay/repairveld of geef repair een eigen server-semantiek.
2. Splits selectieberekeningen uit RaceControlPanel naar pure functies.
3. Laat conflict-, audit- en stale-datafeedback expliciet zien.
4. Vervang verouderde `super-admin-only` comments door capability-/RLS-contracttekst.
5. Houd telemetry adviserend en handmatige fallback beschikbaar.

## Task 7 — Plugin/updater onderhoudbaarheid

1. Splits `EnduranceConnectorPlugin` in pairing, capture, sender, state en updateclient zonder protocolwijziging.
2. Houd statusvelden zichtbaar: heartbeat/verzendtijd, iRacing, isInCar, ronde, fuel, pit, laatste serverresultaat.
3. Canoniek ondertekend release-manifest; public key ingebakken; hash blijft integriteitscheck maar niet trust root.
4. Externe updater behoudt atomic replace/rollback en valideert signature vóór elevation.
5. Bouw en behavior-test op Beest met .NET 4.8; geen release bij offline/ongeteste Windows-toolchain.

## Task 8 — Echte tests en rehearsal

1. Privilege-preserving disposable productieclone.
2. Rollback→forward→rollback tweemaal met exacte object/fingerprintchecks.
3. SQL/PostgREST rolmatrix en forbidden-write evidence.
4. Concurrencytests voor stints, plan publish, practice start en teamassignment.
5. Practice idempotency/replay en effective telemetry routing.
6. Twee browsercontexten volledige flow: inschrijf→stem→auto→team→availability/pace→stints→publish/confirm→Race Control→telemetry.
7. Testdata en accounts volledig verwijderen.

## Final gate

- Full tsc/lint/test/build groen.
- Windows plugin/updater build + behavior tests groen.
- Disposable DB cycles groen en rollback bewezen.
- Runtime flags default alpha-safe; member-open flip apart bewezen.
- Onafhankelijke spec- en quality-review zonder open critical/high findings.
- Daarna pas lokaal GO/NO-GO en apart akkoord vragen voor push/backend-first live release.
