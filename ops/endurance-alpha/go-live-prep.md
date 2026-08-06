# Endurance alpha — go-live & rollback-prep (klaargezet, NIET uitgevoerd)

Status: voorbereid op 2026-08-06. **Alles hieronder is klaargezet maar nog NIET op de
live-server uitgevoerd**; uitvoering vereist de expliciete GO per stap (zoals de
SimHub-canary-checklist in `ops/simhub-canary/release-checklist.md`, die endurance
bewust buiten de eerdere canary hield).

## Vastgelegde referentie
- Live-SHA vóór de wijziging (rollback-target): **`a46087184f`** (was `origin/main`)
- Back-up-tag: **`prod-main-before-endurance-20260806`**
- Feature→main merge die nu op `origin/main` staat: **`9537c60`** (a460871..9537c60)
- Server: `3sm-web`, webroot `/var/www/3sm`, build `/opt/3sm`, deploy via `deploy.sh`

## Backups (gedaan, geverifieerd, off-host)
- Server: `/root/3sm-backups/3sm-dist-20260806-141937.tar.gz`, `3sm-webroot-20260806-141937.tar.gz`, `SHA256-20260806-141937.txt`
- Off-host: `~/3sm-backups/` op deze VM (hashes matchen exact met server)
- DB: endurance-migraties al live toegepast (additief); rollback `.rollback.sql` bestanden staan in `supabase/rollback/`

## Go-live (UITVOEREN BIJ GO, onder maintenance)
1. `systemctl stop 3sm-seo-refresh.timer` (deployvenster).
2. Git: `cd /opt/3sm && git fetch origin && git checkout 9537c60` (of `git pull origin main`).
3. Edge-functies: plaats `_shared/simhub.ts`, `simhub-pair/index.ts`, `simhub-ingest/index.ts`, `simhub-version/index.ts`; herstart alleen `supabase-edge-functions`. (DB-migraties staan al live.)
4. Webdeploy uitsluitend via `/opt/3sm/deploy.sh` (`git pull` + `npm ci` + build + rsync naar webroot).
5. DB: applicabele migraties die nog niet live zijn met `ON_ERROR_STOP=1` sessiegebonden toepassen (controleer eerst welke al toegepast zijn — rollen/helpers/RLS/ingest staan er al op).
6. Verifieer entrypoint-hash van `/`, `/admin/`, `/simhub-koppelen/` en `3stripemotorsport.cc`.
7. Start `3sm-seo-refresh.timer`; draai één reflectie en verifieer de volgende echte tick.

## Verplichte smokes vóór openen (per checklist + alpha-rollen)
- Anoniem/lid/moderator/admin: endurance/menu/profiel-koppeling onzichtbaar, no access, directe PostgREST-read van `simhub_devices` en `endurance_*` geweigerd.
- `tester`: menu+profielkoppeling zichtbaar, eigen device koppelen OK, streamen (`accepted`), events zien + eigen registratie/beschikbaarheid.
- `endurance_manager`: beheer (events/teams/stints) + alles wat tester kan.
- `super_admin`: dispositivo toewijzen aan event+team (Apparaten-tab).
- Ingest: geldig token accepted; fout/verlopen/ingetrokken/replay/rolverlies geweigerd; niet-registered → `not_registered`.
- Homepage, auth, results, nieuws, storage-object en bot blijven functioneel.

## Rollback (uitvoeren bij eerste afwijking; maintenance actief houden)
1. Git: `cd /opt/3sm && git checkout a46087184f`.
2. Rustel `/opt/3sm/dist` en `/var/www/3sm` terug uit de bij elkaar horende backups:
   `tar xzf /root/3sm-backups/3sm-dist-20260806-141937.tar.gz -C /opt/3sm` en `tar xzf /root/3sm-backups/3sm-webroot-20260806-141937.tar.gz -C /var/www`.
3. Edge: verwijder de nieuw geplaatste function-directories / herstel de vooraf vastgelegde Edge-state; herstart Edge.
4. DB: alleen bij een zuivere scoped rollback de corresponderende `.rollback.sql` draaien; full restore uitsluitend bij integriteitsverlies.
5. Draai één SEO-refresh, controleer entrypoints/assets, start de timer, verifieer de volgende tick, en controleer alle Supabase-services + bot.
