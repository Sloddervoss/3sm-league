# Pitwall-test en SimHub 0.7.6.2 — vrijgavepoorten

Start: 10 november 2026. Artefactbevriezing: 11 november 2026.
Status bij deze commit: **BOUW/REVIEW GO; NOG NIET GEPUBLICEERD.**

## Toestemming en grenzen

Vincent vroeg om een grotere circuitkaart in de juiste verhouding, leesbaardere
namen/tijden, een automodel naast de coureur, geen dubbele K/klassekolom en
tijden per sector. Daarna expliciete GO: “Ja, GO voor de gegevensketen, met tests
en rollback”. Extra harde eis: “doe het wel zodat de auto update niet breekt”.

De nieuwe vormgeving blijft uitsluitend op `/admin/pitwall-test`. Klassiek en
endurance-opmaak blijven ongewijzigd. De gedeelde gegevensketen krijgt wel de
apart goedgekeurde PACE-opslag en het optionele automodelveld. De koppelpagina
verandert alleen in versie/downloadverwijzing. Geen bot-, account-, RLS-,
strategie- of raceberekeningswijziging.

## Bewezen oorzaken

- Productie had geen `simhub_pace_merge_v1`/`simhub_pace_project_v1`; de detail-RPC
  gaf `paceCapture` terug maar maakte geen `paceHistory`. De sectorlezer kwam
  daardoor nooit bij de bestaande meetwaarden. De oude lokale migratie wordt
  niet blind uitgevoerd: er is een nieuwe forward op de actuele live-definities.
- Het automodel van tegenstanders stond niet in de producer/Edge-keten. Alleen
  het eigen model was bekend. Dat is additief aangevuld met `opponents[].carName`,
  uit DriverInfo op een veilige CarNumber+UserName-match; onbekend blijft leeg.
- De kaart was uniform geschaald, maar opgesloten in 160px hoogte. Premium
  gebruikt nu breedte plus de intrinsieke officiële viewBox-verhouding, zonder
  wijziging van geometrie, rondeafstand, pitprojectie of marker-popups.

## PASS/FAIL vóór publicatie

- **PASS UI:** Astra GO op `bf9e207c`; 100 gerichte tests. Lokale gecontroleerde
  Nordschleife-fixture: kaart 555×453 bij 1920×1080 en 642×524 bij 2560×1440,
  gelijke x/y-schaal; namen 14,5px, modellen 12,5px; alle zes sectorkolommen;
  eigen P16 vast en Eigen rij niet bedekt; geen documentoverflow op 390px.
  Dit is fixturebewijs, niet een echte productierace.
- **PASS gegevensketen:** Astra vond de logger-String(value)-fout; rood/groen
  gereproduceerd en gerepareerd in `577c49d2`. Herkeuring GO met eigen probe:
  kapotte JSON-carName maakt alleen dat veld leeg, niet het frame/de rijen.
- **PASS SQL:** parent zelf: PGlite 38/38; geïsoleerde PG15.19-kloon van het live
  public-schema en ACL's: 22 forward- en 6 rollbackchecks. 85 basistabellen plus
  6 views, 230 functies, 165 policies vóór de wijziging. De vijf rollbackfuncties
  worden exact hersteld. Geen productiegegevens in de kloon.
- **PASS connector:** parent DiagnosticsTests 655 PASS, 0 FAIL; echte net48
  Release-build op Beest met C#7.3 en alle 41 Compile-items. Geen installatie,
  GUI-start of bureaubladkopie. Geïnstalleerde DLL-hash voor/na gelijk.
- **PASS updater:** bron ongewijzigd, 61 methoden en alle niet-GUID-metadata van
  het embedded programma gelijk aan de vorige versie; andere PE-buildidentiteit
  is geen gewijzigde updaterlogica. De echte oudere DLLs 0.7.4.0/0.7.6.0/0.7.6.1
  accepteren het daadwerkelijk ondertekende kandidaatmanifest 0.7.6.2 en bieden
  de update aan. Kandidaat accepteert zichzelf zonder zelfupdate; alle vier
  verwerpen foute hash, lengte, naam, URL en handtekening. Geen fysieke
  SimHub-installatie geclaimd.
- **PASS contracttests:** 44 Deno-runtimechecks, 43 gerichte Vitest-checks
  (manual download, carName en PACE). De aparte opponent-Deno-tests typechecken.
- **INHERITED, geen nieuwe regressie:** volledige suite vóór laatste log-test:
  1825 PASS + bestaande `tyreTelemetryContract`-fout. Typecheck heeft dezelfde
  16 bestaande diagnostics. De bredere Deno-typecheck struikelt op ongewijzigd
  `paceCapture.ts:65` (ook op basis bewezen); runtimechecks draaien expliciet
  met `--no-check --allow-read --allow-env`. Geen stil weggerapporteerde failure.
- **PASS freeze:** `release-gate.py`: 23 PASS, 0 FAIL, 2 bestaande waarschuwingen
  over skip-build/herhistorische repo-artefacten. Definitieve DLL/ZIP in
  `releases/simhub-0.7.6.2-freeze.json`; niet opnieuw bouwen na bevriezing.

## Pins en backup

- Forward: `20261110231000_pitwall_pace_storage.sql`, SHA-256
  `c093162c9c7885b5a2ecc2a65cf46d6b6e2095d868ee31a8978237d88918fb21`.
- Rollback: zelfde basename onder `supabase/rollbacks/`, SHA-256
  `01fac7b003c38a33cd95a93678b40b608f3dcbb3c127daafc6fe4b4c2f14c70f`.
- DB/config/Edge-backup op 3sm-docker:
  `/var/backups/3sm/pre-pitwall-chain-0762-20261111` (mode700). Custom dump,
  globals zonder rolwachtwoorden, 2231 TOC-items, SHA-manifest gecontroleerd.
- DLL: 681472 bytes,
  `6461823490247bc447ec75d745abf2e69499de5eab369f9e480390d158e9a4af`.
- ZIP: 388607 bytes,
  `8566067a02291211c83044823b666b28758305738b064bc8cf224508099fa9a0`.

## Publicatievolgorde en terugweg

1. Bron/commits publiceren. Baseline-MD5's en ontbrekende helpers opnieuw
   controleren; alleen de gepinde forward transactioneel toepassen.
2. Exacte functies/grants/configuratie teruglezen. Geen configuratie-revisie bump.
3. Alleen de compatibele `opponents.ts` uitrollen, runtime herladen en hash plus
   echte ingest-acceptatie controleren. Oude clients mogen blijven verzenden.
4. Bevroren DLL/ZIP naar downloads, echte HTTP-download en binnen-DLL controleren.
5. **Manifest als laatste connectorstap** omschakelen en ondertekening/alle
   velden/download opnieuw controleren; oude artefacten permanent bewaren.
6. Site uit geïsoleerde release-werkboom bouwen/publiceren, SEO-timer pinnen en
   publieke assets plus browser controleren. Endurance krijgt geen premium-root.
7. Tijdelijke testtoestand en sessiebestand opruimen; feitelijke uitkomst hieronder
   aanvullen, zonder een ontbrekende echte racewaarneming te verzinnen.

Terug: vorige manifest/configwaarden en Edge-bestand uit backup; vorige frontend
`/opt/3sm-release-0dcf7c46`; SQL-rollback herstelt de vijf baselines en verwijdert
alleen de nieuwe helpers. Vastgelegde PACE-historie wordt niet stil verwijderd.
Klassiek en `?pitwallView=classic` blijven onmiddellijke visuele terugval.

Fysieke TTL-opruiming is als begrensde functie beschikbaar; een nieuwe cronjob
zit niet in deze SQL-forward. Opslag is per device hard begrensd; lees-/merge-TTL
blijft actief. Een onderhoudsplanning vraagt een afzonderlijke, gecontroleerde
stap en wordt niet als uitgerold voorgesteld.
