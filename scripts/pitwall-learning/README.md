# P0 bron-audit

Deze map bevat alleen de read-only P0-audit, geen worker, training of migratie.

## Offline safetytest

Bestaande ontwikkeltool: systeem-Python `/usr/bin/python3` met `pglast`. Dit is geen nieuwe productie-dependency. De Hermes-execute_code-interpreter is een andere Python en heeft die module niet; voer de test met de systeem-Python uit.

```sh
PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -m unittest discover -s scripts/pitwall-learning -p 'test_*.py' -v
```

De test parseert alle SQL en blokkeert writes, write-CTE, SELECT INTO, rijlocks, niet-allowlisted functies, niet-lokale/andere instellingen, verruimde timeouts, ontbrekende READ ONLY, COMMIT of tussenliggende transacties. Dit is een guard voor het eigen auditbestand, geen algemene SQL-firewall of database-autorisatievervanger.

## Uitvoering op bestaande geautoriseerde self-hosted route

Alleen na de offline guard en controle van het bestand:

```sh
(umask 077
 ssh -o BatchMode=yes 3sm-docker \
   'docker exec -i supabase-db psql -X -qAt -v ON_ERROR_STOP=1 -U supabase_admin -d postgres' \
   < scripts/pitwall-learning/audit-sources.sql \
   > /PAD/BUITEN/GIT/pitwall-source-audit.jsonl
)
```

`/PAD/BUITEN/GIT/` is een expliciet te kiezen bestaande beschermde outputdirectory, geen production-hostpad. De audit opent één repeatable-read READ ONLY-transactie, gebruikt statement_timeout 8s/lock_timeout 500ms/idle timeout 12s en ROLLBACK. Iedere statement-timeout geldt per statement, niet als totale jobduur. `ON_ERROR_STOP` voorkomt een half rapport als geslaagde hele audit; vertrouw alleen exit 0 én alle tien benoemde JSON-secties.

Output is aggregate-only maar niet automatisch anoniem; houd die intern, geen raw records/namen/tokens. UID's worden intern alleen voor tellen/order gebruikt. Huidige device-eigenaren tellen uitsluitend als huidige dekking, niet als historische eigenaar of toestemming om te poolen. De oude text-device-ID's en UUID-device-ID's worden alleen voor de diagnostische union exact naar tekst geprojecteerd; bronwaarden blijven onveranderd.

`NULL`-qualified sets/accounts/trainingsvoorbeelden betekent niet vastgesteld. De strikte structurele fuelpoort eist expliciet false voor pit/driverwissel en nul voor waargenomen tanktoevoeging; ontbreken wordt niet als false/nul ingevuld. Dat levert in de P0-snapshot nul structurele kandidaten op, **niet** bewijs dat er geen normale rondes gereden zijn. Contractextractie moet de juiste afleiding eerst bewijzen.

`observed_transport_ids_differ` vergelijkt twee verschillende ID-domeinen; deze teller is geen late-deliveryclassificatie. Ook `received_before_end`/`received_before_observed` kunnen kleine client-/serverklokverschillen weerspiegelen: in de P0-diagnostiek was het maximum circa 2,68 s. Ze bewijzen geen negatieve of late levering; de audit corrigeert geen klok. Device-sessietellingen en distinct gerapporteerde sessie-ID's zijn beide diagnostiek, geen bewezen onafhankelijke races/sessies. De per-wieldiagnostiek is geen setkwalificatie en geen fysiologisch slijtagemodel. Uitsluitredenen worden alleen via vaste broncode-/coverage-allowlists geaggregeerd; overige labels worden `other_or_unmapped`, nooit vrije cliënttekst publiceren.

## Betekenis en grenzen

- Recordaantallen, bestaande valid-flags, device-sessies, legacy-setgroepen en gekwalificeerde onafhankelijke labels zijn verschillende tellingen.
- Current source tables bewaren niet noodzakelijk alle vroegere revisies. De audit claimt geen reconstructie van historische knowledge cutoffs.
- Per-wielgroepen niet optellen als onafhankelijke sets; gelijke waarden niet als verse wearankers.
- Entry→exit-pitduur niet als netto tijdverlies of marginale bandenservicekosten hernoemen.
- Audit doet geen historische seed, geen wijziging aan de bestaande priorqueue en geen modelpromotie.

Dossier: `docs/operations/pitwall-learning-baseline.md`; bronkaart en beleidsvoorstel onder `docs/contracts/pitwall-learning-*.md`.
