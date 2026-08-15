# 3SM — Livegang checklist (canary → voor iedereen)

Vandaag (user beta) is Endurance + SimHub-telemetry beperkt tot **super_admin,
endurance_manager en tester**. Deze notitie legt vast wat bij een echte go-live
"voor iedereen" opengezet of heroverwogen moet worden. Bevestig per item met
Vincent wélke rolbreedte hij wil vóór je iets verruimt.

## 1. SimHub-pairing (edge function `supabase/functions/simhub-pair/index.ts`)
Huidige en-benodigde toegang:
- `create` (device-only paar-code) — nu: endurance-ster (super_admin/manager/tester).
  → Bij livegang: openstellen voor **alle gekoppelde leden** die hun eigen device
    willen koppelen.
- `list` / `revoke` — nu: super_admin alle devices; endurance-ster alleen eigen.
  → Livegang: alle leden alleen eigen device; beheer (alles zien/intrekken) blijft
    bij @admin/super_admin.
- `assign` / `clear` (device → endurance event + team) — nu: endurance_manager +
  super_admin. → Livegang: blijft beheer (manager/super_admin), NIET voor ieder lid.
- Legacy `race_id`/`team_id`-binding — super_admin-only (kan op uitfaseren).

## 2. Endurance-catalogus activatie-RPC
Nu: strikt fail-closed; `local_class_ids` + `local_car_ids` moeten expliciet
gemapt zijn (in SEASON_MAP / .env) voordat een tijdslot activeerbaar is.
→ Livegang: WHITELIST blijft disclosure-beschermd. Overweeg expliciete
  rollencheck (wie mag een slot "namens 3SM" activeren — nu endurance-manager).
  Whitelist zelf niet fail-open zetten t.o.v. Vincents opgenomen series/races.

## 3. DeviceAssignmentPanel (src/features/endurance/devices/DeviceAssignmentPanel.tsx)
Nu: gate = `isSuperAdmin || isEnduranceManager`.
→ Livegang: waarschijnlijk ongewijzigd (beheeractie). Bevestig.

## 4. Alpha-rol gates / Control Room
Zoek bij livegang op `isTester`, `isEnduranceManager`, `isSuperAdmin` in de UI en
bepaal per plek of de rol-breedte breder moet (bijv. Race Control `editable`,
stint-editing, registratieparticipatie).

## Deployment-notitie (edge functions)
Edge functions draaien live uit `/opt/supabase/docker/volumes/functions/`.
Deploy = file scp-en naar `3sm-docker` + `docker compose up -d --force-recreate
functions` (backup eerst naar /var/backups/3sm/). Geen DB-migratie nodig voor
rolverruiming van actuator acties (rollen-read via user_roles).