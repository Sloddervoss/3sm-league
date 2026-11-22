# Pitwall learning — fleet eligibility herstel (release-GO)

**Datum:** 22 november 2026
**Branch:** `fix/learning-fleet-eligibility` (lokaal; geen push)
**Basis:** `4d073c63`
**Scope:** personal fuel learning / Auto Learn. Geen schema-, connector- of UI-wijziging.

## Release-GO

**GO voor deze scoped fix**, met één harde voorwaarde: productieapply pas na expliciete
goedkeuring van de projecteigenaar. De migratie is functie-only, additief en heeft een
getimede paired rollback. Er is in deze opdracht **niets** naar productie geschreven,
niets gepusht en geen enkele service gestopt of herstart.

## Wat er werkelijk mis was

Productie (read-only gecontroleerd op 22 november 2026):

- `pitwall_learning.fuel_worker_provision` filterde op
  `device_status IN ('active_unbound','bound','active')`.
- De live constraint `simhub_devices_device_status_check` staat alleen
  `inactive`, `active_binding`, `active_unbound` en `revoked` toe. `bound` en `active`
  kunnen dus nooit matchen; `active_binding` — de status van een gekoppeld apparaat —
  ontbrak.
- Daardoor waren **0 owners** eligibel volgens de oude regel, terwijl **3 recente
  owners met een `active_binding`-device op 0.7.6.4** wel degelijk aanwezig zijn.
  `pitwall_learning.account_policy` stond op 0 rijen: niemand werd automatisch
  ingeschreven, dus er was ook geen capture/training.
- De worker-container stond op `unhealthy`. De image erft de healthcheck van
  `supabase/postgres`: `pg_isready -U postgres -h localhost`. De worker-container
  draait zelf geen database; `PGHOST=supabase-db`. De healthcheck faalde 23 keer op
  rij met `localhost:5432 - no response`.

## Wijzigingen

### 1. Provisioner: echte statussen, echte versie

`supabase/migrations/20261122134500_pitwall_learning_fleet_eligibility.sql`

- `fuel_worker_provision` accepteert nu `active_binding`, `active_unbound` en de
  historische tokens `bound`/`active` (die laatste twee zijn onschadelijk en houden
  oude databases compatible).
- `revoked_at IS NULL` en de bestaande 30-dagen-`last_seen_at`-grens blijven staan.
- Een owner wordt alleen ingeschreven als minstens één device een **parseerbare
  connectorversie ≥ 0.7.6.3** in `simhub_device_health` heeft.
- Bestaande `account_policy`-rijen worden nog steeds niet aangeraakt:
  `NOT EXISTS (...)` beschermt opt-outs, historie en handmatige beleidsrijen.

### 2. Auto Learn: per device, niet per account

Dezelfde migratie vervangt `fuel_worker_source`. Vóór de bestaande policycontrole
moet de **bron-device** in `simhub_telemetry_latest`:

- bij dezelfde owner horen, en
- een connectorversie ≥ 0.7.6.3 rapporteren.

`simhub_persist_v3` schrijft `simhub_telemetry_latest` in dezelfde transactie vóór de
meetbatch, dus dit is de versie van het frame dat de rij opleverde. Ontbrekende
telemetrie of een ontbrekende/onparseerbare versie betekent weigeren (fail closed).
Zo kan een account met een nieuwe binding én een oude reserve-pc niet via de oude pc
aan Auto Learn bijdragen.

`fuel_worker_record` blijft daarnaast de echte payload-capability afdwingen
(`observation.version = 2`, `fuelQuality`-velden, policy/owner/device/context). Een
onjuiste versiestring alleen is dus niet genoeg om een trainingsvoorbeeld te maken.

### 3. Worker-healthcheck op de geconfigureerde database

`deploy/pitwall-learning.compose.yml`

```yaml
healthcheck:
  test:
    - CMD-SHELL
    - >-
      pg_isready -q -h "$${PGHOST:-supabase-db}" -p "$${PGPORT:-5432}"
      -U "$${PGUSER:-pitwall_learning_worker}" -d "$${PGDATABASE:-postgres}"
  interval: 30s
  timeout: 5s
  retries: 3
  start_period: 30s
```

De compose-override is nodig omdat de immutable image de foute base-healthcheck
meeneemt; een image-rebuild is niet nodig. De deployed compose in
`/opt/supabase/learning/pitwall-learning-0.7.6.3-572d4cf8/compose.yml` is in deze
opdracht **niet** aangepast.

## Minimale versie: uit de code, niet aangenomen

- De v2-producer (`observation.version=2` plus de vijf `fuelQuality`-velden) is
  geïntroduceerd in commit `5db05ec8` en meegegaan in de 0.7.6.3-release
  (`843c8a00`, AssemblyVersion `0.7.6.3`).
- `tools/simhub-plugin/3SM.EnduranceConnector/ObservationCapture.cs` is vanaf
  `843c8a00` tot en met 0.7.6.5 **byte-identiek**; 0.7.6.4/0.7.6.5 bevatten dus
  dezelfde capability.
- 0.7.6.2 en ouder hebben die producer niet. Daarom is 0.7.6.3 de ondergrens.
- Deze grens is een **proxy voor deelname**; de werkelijke payload wordt nog steeds
  door `fuel_worker_record` gevalideerd.

## Bewijs (read-only, productie)

```sql
-- oude regel vs. herstelde regel, 30 dagen, niet-revoked, versie parseerbaar
-- resultaat: old_rule_owners=0 | fixed_rule_owners=3 |
--            active_binding_owners=3 | active_binding_0764=3
-- account_policy_rows=0
```

Healthcheck in de draaiende container:

```text
old:   pg_isready -U postgres -h localhost  -> exit 2, "localhost:5432 - no response"
fixed: pg_isready -h "$PGHOST" -U "$PGUSER" -> exit 0
```

De production-function-definitions zijn vóór de wijziging vastgelegd in
`.hermes/evidence/` (buiten de commit); de migratie is daaruit opgebouwd, niet uit
een verouderde repo-kopie.

## Tests en resultaten

### Nieuwe regressietest

`supabase/tests/pitwall-learning-fleet-eligibility.sql` — 27 asserties, één
transactie met `ROLLBACK`:

- `active_binding` 0.7.6.4 wordt ingeschreven (het oorspronkelijke defect);
- `active_unbound` 0.7.6.5 wordt ingeschreven;
- `inactive`, `revoked`, 0.7.6.2, 0.4.2.1, onparseerbare versie, ontbrekende health
  en `last_seen_at` ouder dan 30 dagen worden niet ingeschreven;
- bestaande opt-out (`capture_enabled=false`) blijft byte-identiek, inclusief
  `updated_at`;
- tweede `fuel_worker_provision` is idempotent;
- mixed account: oud device (0.4.2.1) levert `NULL` en geen visibility-rij; nieuw
  device (0.7.6.4) levert wel een source en visibility-rij;
- ontbrekende telemetrie/versie → `NULL`;
- opt-out blokkeert ook op de worker-grens;
- versiegrenzen: 0.7.6.2 `false`, 0.7.6.3 `true`, 0.7.6.4/0.7.6.5 `true`,
  `0.7.6` en `0.7.6.3-beta` en `NULL` `false`.

Uitvoering op een wegwerp-PG15-kloon van de normal-update-fixture:

```text
NOTICE:  pitwall-learning fleet eligibility: 27 van 27 PASS
```

### Overige tests

- `src/test/pitwallLearningWorkerHealthcheck.test.ts` — 3/3 PASS.
- `src/test/pitwallLearningFleetLoop.test.ts` — 1/1 PASS: een `NULL`-source
  (oude device) wordt als `done` afgesloten en bereikt `fuel_worker_record` niet.
- Worker-rechten op een kloon: `SET SESSION AUTHORIZATION pitwall_learning_worker`
  → `has_function_privilege(...fuel_worker_provision..., 'EXECUTE') = true` en
  `fuel_worker_provision(100) = 1` voor een tijdelijke `active_binding` 0.7.6.4.
- `npx eslint src/test/pitwallLearningWorkerHealthcheck.test.ts src/test/pitwallLearningFleetLoop.test.ts` — schoon.
- Bestaande P1-suites (`pitwall-learning-access.sql`, `-capture.sql`, `-jobs.sql`)
  falen in de gebruikte fixture-kloon op dezelfde punten **zonder** deze migratie;
  dat is een fixture-/omgevingsbeperking, geen regressie van deze wijziging. De
  echte P1-rehearsalcontainer was niet beschikbaar.
- `tsc -p tsconfig.app.json` heeft de bestaande diagnostics; het nieuwe testbestand
  voegt er geen toe.

## Uitrol (na goedkeuring)

1. Maak een verse backup en controleer de live functie-hashes/ACL's opnieuw.
2. Pas de migratie toe als `supabase_admin` (eigenaar blijft `supabase_admin`):
   `docker exec -i supabase-db psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -f - < 20261122134500_...sql`
3. Werk de deployed compose bij met de healthcheck hierboven en recreëer alleen de
   `pitwall-learning-worker`-service (geen database, geen andere service).
4. Controleer: worker `healthy`, `account_policy` +3 (de drie 0.7.6.4
   `active_binding`-owners), oude 0.4.2.1-device niet ingeschreven, en de eerste
   `fuel_worker_source`-cyclus zonder fouten.
5. Publiceer geen nieuwe connector: de update-path blijft ongewijzigd. Oude
   connectors blijven telemetrie/research leveren zoals voorheen, maar worden niet
   als Auto Learn-bron geaccepteerd.

## Rollback

`supabase/rollbacks/20261122134500_pitwall_learning_fleet_eligibility.sql`

- Herstelt de twee oude functiebody's en dropt de private helper.
- Raakt geen `account_policy`, capture-, bewijs-, model- of historierij aan.
- Aanbevolen: worker kort stoppen, rollback toepassen, worker starten. De
  runtime-switches hoeven niet te worden gewijzigd; zet ze zo nodig eerst uit.
- Getest: forward → rollback op een verse kloon; helper weg, oude statuslijst en
  oude source-body terug.

## Beperkingen / open punten

- Geen productie-writes uitgevoerd; de daadwerkelijke +3-inschrijving is dus niet
  live bewezen. De read-only telling (0 → 3) is het bewijs dat de oude regel geen
  enkele owner raakte.
- De per-device worker-gate gebruikt de **huidige** `simhub_telemetry_latest`-versie,
  niet een historische versie per bronrij. In productie zijn geen fuel-source-
  revisies/examples (0 rijen), dus er is niets te herclassificeren. Bij een toekomstige
  uitrol met vooraf bestaande rijen moet de gate opnieuw worden beoordeeld.
- Oude devices kunnen, zolang de accountpolicy capture toestaat, nog steeds in de
  P1-onderzoekslaag terechtkomen; ze kunnen daaruit geen Auto Learn-voorbeeld worden.
  Dat is bewust: onderzoek/historie blijft, training niet.
- De healthcheck is een compose-override. Een `docker run` buiten compose houdt de
  foute base-healthcheck; de ondersteunde deployment is de compose-template.
- Dit is geen kwaliteits- of nauwkeurigheidsclaim over het fuelmodel. De
  modelpromotiecriteria (100 voorbeelden/20 sessies/MAE etc.) zijn ongewijzigd.

## Bewijshashes (SHA-256)

```text
63aac6642e1af7f80e1412630c6700ad0c7f1d53eb8e5c8df45596b021239e46  supabase/migrations/20261122134500_pitwall_learning_fleet_eligibility.sql
a647cd04067f9d0dc465c425e0cb6310df6ef5bdfcac400fb7933a5f8e17d260  supabase/rollbacks/20261122134500_pitwall_learning_fleet_eligibility.sql
cf098ddcef8cc97708f3fd2bad560b969cb6365c40651f43aa2d3de4e072c887  supabase/tests/pitwall-learning-fleet-eligibility.sql
d9e9f0b8ad222def349ec6ebe3b83126ed175d150c001754f0ffdb65fed9a160  deploy/pitwall-learning.compose.yml
868e2a854bcac047d60301fd5d9b4fe777e3121eaea2f637aaadf5f73c009084  src/test/pitwallLearningWorkerHealthcheck.test.ts
117b991af63111e49da112c7058c132b491c61dfa1cd562a19c3c53bac572561  src/test/pitwallLearningFleetLoop.test.ts
```

De productie-functiedumps die als bron zijn gebruikt staan lokaal in
`.hermes/evidence/prod_capture_source_batch.sql`, `prod_fuel_worker_source.sql` en
`prod_fuel_worker_provision.sql`; die zijn niet gecommit.

## Scope-verklaring

- **PRODUCTIEWIJZIGING: NEE** in deze opdracht (alleen lokale bestanden; geen
  productie-DB, geen live site, geen deploy, geen push).
- De voorgestelde uitrol is **wel** een productiewijziging en wacht op expliciete
  goedkeuring.
