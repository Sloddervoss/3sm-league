# SimHub super-admin canary — productiechecklist

## Releasebron

- Branch: `release/simhub-superadmin-canary`
- Baseline: live `origin/main`
- Scope: één SimHub-canarycommit; geen `src/features/endurance/`-bestanden.
- Push, tag, migratie, Cloudflare-write, Edge-deploy en webdeploy vereisen expliciete GO.

## Entry gates

1. Remote branch/tag en live checkout wijzen naar de goedgekeurde SHA.
2. Windows CI bouwt op exact die SHA tegen SimHub 9.11.21.
3. Frozen pakket en `MANIFEST.sha256` verifiëren.
4. Fresh full/schema/policy/function-backups zijn leesbaar, gehasht en off-host gekopieerd.
5. Auth/storage ownershipreferentie is groen; DB, REST, Kong, Auth, Storage, Edge, Meta en Pooler zijn gezond.
6. Cloudflare Free-slot is leeg; `cloudflare-rate-limit.json` is toepasbaar en geeft in een gecontroleerde bursttest 429/block zonder normale 1 Hz-ingest te hinderen.
7. Maintenance mode geeft zichtbaar HTTP 503 voordat database/webwijzigingen starten.

## Apply-volgorde onder maintenance

1. Maak en verifieer beide backups van `/opt/3sm/dist` en `/var/www/3sm`; stop `3sm-seo-refresh.timer`.
2. Pas `20260716170000_simhub_central_relay.sql` toe met `ON_ERROR_STOP=1` en sessiegebonden DDL-logging.
3. Plaats `_shared/simhub.ts`, `simhub-pair/index.ts` en `simhub-ingest/index.ts`; herstart alleen `supabase-edge-functions`.
4. Pas de Cloudflare-rate-limitregelset toe en bewaar ruleset-/rule-ID voor rollback.
5. Deploy de Git-backed site uitsluitend via `3sm-web:/opt/3sm/deploy.sh`.
6. Verifieer dat `/`, `/admin/` en `/simhub-koppelen/` dezelfde actuele entrypoint-hash gebruiken en alle assets bestaan.

## Verplichte smokes vóór openen

- Anoniem, lid, moderator en admin: create/list/revoke en latest telemetry hard geweigerd.
- Alleen super-admin: pagina/menu zichtbaar en create/list/revoke toegestaan.
- Directe PostgREST-read van `simhub_devices` geweigerd.
- Pairingcode: tien minuten, éénmalig, race/team server-side gebonden.
- Ingest: geldig token geaccepteerd; fout/verlopen/ingetrokken token, replay, oude race en rolverlies geweigerd.
- Realtime: live snapshot zichtbaar; revoke verwijdert hem direct.
- Cloudflare: normale circa 1 Hz blijft groen; gecontroleerde overschrijding wordt geblokkeerd.
- Homepage, auth, results, nieuws, storage-object en bot blijven functioneel.

## Stop/rollback

Stop bij de eerste afwijking. Houd maintenance actief.

1. Verwijder/disable de aangemaakte Cloudflare-rate-limitregel via het opgeslagen ID.
2. Verwijder de twee SimHub Edge-functiondirectories en herstel de vooraf vastgelegde Edge-state; herstart Edge.
3. Voer alleen bij een zuivere, scoped SimHub-rollback `supabase/rollback/20260716170000_simhub_central_relay.rollback.sql` uit. Gebruik full restore uitsluitend bij integriteitsverlies.
4. Zet Git checkout terug naar de vooraf vastgelegde live SHA en herstel zowel `/opt/3sm/dist` als `/var/www/3sm` uit hun bij elkaar horende backups.
5. Draai één SEO-refresh, controleer entrypoints/assets, start de timer en verifieer de volgende echte tick.
6. Verifieer alle Supabase-services, auth/storage ownership, publieke smokes en bot voordat maintenance wordt verwijderd.
