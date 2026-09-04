# 3SM — Device-Scoped Telemetry Ingest (rollout)

Datum: 2026-09-04 | Status: LIVE op productie | Scope: telemetry-auth, geen connector

## Besluit (Vincent)

Een geldig geauthenticeerd 3SM SimHub-apparaat mag telemetrie sturen **ook zonder** koppeling aan
een Endurance-team/event. Koppeling stuurt routing plus Pitwall-zichtbaarheid; koppeling is géén
voorwaarde voor basis-telemetrie-acceptatie.

## Oud gedrag (binding-required)

`simhub_persist_v3` wees telemetrie af met harde gates wanneer er geen actieve binding was:

- `not_bound` — `endurance_event_id`/`endurance_team_id` beide NULL op het device
- `not_authority` — `device_status <> 'active_binding'` of `device_role <> 'primary'`
- `not_registered` — geen actieve endurance-registratie voor owner op event

Exacte reject voor DESKTOP-E2SEMRP vóór deze fix: `not_bound` + `not_authority`
(canonical DeviceId `7e748fad-64a1-4fce-bc14-4f595480ff67`, owner peters870, connector 0.4.0.0,
niet revoked, geldig token, géén duplicaat — reject kwam puur door ontbrekende actieve binding).

## Nieuwe apparaatautorisatie-regel

**ACCEPT (device-scoped)** wanneer: apparaat bestaat + token geldig + niet-revoked + payload valide.
Routing-velden (`endurance_event_id` / `endurance_team_id` / `race_run_id`) = NULL.
Wordt ópgeslagen als device-scoped latest telemetrie; **niet** in een team-Pitwall.

**REJECT** wanneer: apparaat onbekend (`invalid_device`), token ongeldig (`invalid_payload`),
of device revoked (`revoked`).

## Nieuwe routing-regel (alleen actieve binding)

Telemetrie wordt naar team/event/raceRun gerouteerd **alleen** als ALLE voorwaarden gelden:
- `endurance_event_id` EN `endurance_team_id` aanwezig op device
- `device_status = 'active_binding'`
- `device_role = 'primary'`
- geldige actieve endurance-registratie (owner → event)

Inactive binding / geen binding / non-primary → device-scoped accepterend (geen team-routing),
**nooit automatische reactivatie**.

## Ongebonden persistentie

- latest telemetrie wordt altijd opgeslagen in `simhub_telemetry_latest`
  (device-scoped bij NULL routing; `endurance_event_id`/`endurance_team_id`/`race_run_id`)
- geen nep team/event/raceRun toegevoegd
- **geen** `endurance_opponent_gap_samples` zonder geldige bound raceRun-context
  (0.4.3-sampling vereist een geldige race/team/raceRun)

## Team-isolatie

- ongebonden telemetrie is **niet** zichtbaar in enig team-Pitwall (routing NULL)
- cross-team blijft geweigerd
- `get_pitwall_data` zoekt op eigen team / staff-gate, ongewijzigd
- staff/admin diagnostics volgen het bestaande admin-machtigenmodel

## Interactie met 0.4.3-sampling

Server-side sampled opponent history + closing rate (`record_opponent_gap_samples`,
`pitwall_opponent_trends_v1`) worden alleen geproduceerd voor een geldige gebonden
raceRun/team-context. Ongebonden telemetrie wordt NIET gesampeld.

## Milestone / rollback

- Migratie: `supabase/migrations/20260904_pitwall_0403_device_scoped_ingest.sql`
  (CREATE OR REPLACE FUNCTION `simhub_persist_v3`; géén schema-tabelwijziging)
- Backup vóór mutate: `/tmp/persist_v3_prod_pre_device_scoped.sql` (productie-β-definitie)
- Rollback: herstel de back-up-functiedefinitie (CREATE OR REPLACE) via die file

## Verificatie (non-prod + prod)

- A unbound valid → `accepted` / routing NULL (PASS)
- B active binding → `accepted` + event/team/raceRun routing (PASS)
- C inactive binding → `accepted` device-scoped / NULL routing (PASS)
- D revoked → `revoked` (REJECT PASS)
- E invalid token → `invalid_device` (REJECT PASS)
- F cross-team isolation (PASS)
- G late activation → oude ongebonden rij blijft NULL / nieuwe routeert (PASS, no retro)
- H diagnostics: ongebonden geldig device ≠ generiek "Fout" → Waarschuwing (UI-fix, zie hieronder)

## Diagnostics / Connectoroverzicht

`SimHubConnectorsModule.tsx` onderscheidt nu:
- DEVICE: Online / Offline
- GAME: Verbonden / Niet verbonden
- TELEMETRIE: Live / Verouderd / Geen
- BINDING: Gekoppeld / Niet gekoppeld
- STATUS: OK / Waarschuwing / Fout

`DEVICE_UNBOUND` en transient-codes → **Waarschuwing** (niet "Fout"). Alleen echte
auth/revoke/ingest-fouten → Fout. Tooltip: "Binding bepaalt alleen aan welk Endurance-team/event
telemetrie wordt gekoppeld." DESKTOP-in-actie: als vers sturen → Online, Game verbonden,
Telemetrie Ontvangen/Live, Binding Niet gekoppeld, Status OK/Waarschuwing.

## Kanelen / manifesten (niet aangeraakt)

- default = stable bridge = **0.4.0.0**
- canary/test = **0.4.1.0**
- stable baseline backup = 0.3.16.0
- geen connector binair / manifest wijziging