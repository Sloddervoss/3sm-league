# Persoonlijke Pitwall + opt-in deelview

## Wat het is

- **Mijn Pitwall** (`/pitwall/`): premium per-device Pitwall voor de ingelogde eigenaar.
  De server bepaalt de connector uit `auth.uid()` en
  `public.simhub_devices.owner_user_id`; apparaatnamen en admin-fleet-RPC's worden
  niet gebruikt om eigenaarschap te bepalen.
- **Deel deze race**: maakt één verse bearer-link naar
  `/pitwall/shared#t=<token>`. Alleen de SHA-256-hash staat in de database.
- **Publieke lezer**: anonieme RPC met een kleine, getypeerde raceprojectie.
  Geen ruwe telemetrie, account-/device-id's, archief, fleet of beheer.

## Gedrag

| Situatie | Uitkomst |
|---|---|
| Geen connector | koppel-CTA naar `/simhub-koppelen` |
| Connector offline | wachten op telemetrie |
| Eén verse connector | automatisch openen |
| Meerdere verse connectors | expliciet kiezen |
| Delen | alleen bij verse, actieve, eenduidige sessie (max. 90 s oud) |
| Link | 64 hex, fragment, geen opslag/analytics; 5 min–6 uur TTL |
| Stoppen | `revoked_at` direct gezet; volgende poll krijgt `ended` en wist racebeeld |
| Verlopen/device revoked/sessie- of trackwijziging/terminal state | fail closed, link eindigt |

De lezer pollt elke 2 s en pollt direct bij terugkeer van een verborgen tab,
`online` of `pageshow`. Elke fout, `ended`, `invalid` of `stale` wist de
getoonde racedata; `stale`/`waiting` blijven pollen.

## Migratie en rollback

Forward:

```text
supabase/migrations/20261119120000_personal_pitwall_share.sql
```

Rollback:

```text
supabase/rollbacks/20261119120000_personal_pitwall_share.down.sql
```

De migratie is additief: één tabel `public.pitwall_shared_races`, RLS, expliciete
grants en vijf RPC's. Geen bestaande tabel, policy of plugin/ingest is gewijzigd.
De rollback dropt alleen de nieuwe functies en tabel.

## Verificatie

```bash
npm run test:db:pitwall-share          # PGlite, echte forward + rollback
npx vitest run src/test/personalPitwall.test.tsx src/test/routeClassification.test.ts
npx tsc -p tsconfig.app.json --noEmit  # let op: repo heeft bestaande fouten buiten dit domein
```

De DB-test dekt o.a. cross-owner, verkeerde/oude/ingetrokken/verlopen links,
device- en sessiewijziging, terminale state, transport-hergebruik, stale data,
RLS/kolomrechten, viewer-writes en forward → rollback → forward.

## Productie-checklist (ouder/beheer)

1. Neem een schema-snapshot volgens `docs/operations/production-access-runbook.md`.
2. Controleer de kolommen uit `simhub_devices`, `simhub_telemetry_latest`,
   `simhub_device_health` en `simhub_device_laps` tegen de inventory.
3. Pas de forward-migratie toe als `supabase_admin`.
4. Verifieer: `to_regclass('public.pitwall_shared_races')`, de vijf functies,
   `relrowsecurity`, en `has_function_privilege('anon', ...)`.
5. Publiceer de frontend; `/pitwall` en `/pitwall/shared` staan op noindex.
6. Rooktest met een synthetische/test-connector: één verse sessie, link openen
   in een incognitovenster, `Delen stoppen`, bevestig dat de volgende poll het
   racebeeld wist.

## Bewust niet gedaan

- Geen plugin- of ingest-wijziging.
- Geen service-role key in de browser.
- Geen token in localStorage/sessionStorage, analytics of queryparameters.
- Geen publieke leesrechten op `simhub_telemetry_latest`, `simhub_device_laps`
  of archieftabellen.
