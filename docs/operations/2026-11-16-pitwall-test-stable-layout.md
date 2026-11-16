# Implementatie-GO — stabiele bestaande Pitwall-test

Toestemming voor implementatie: Vincent, “maak de benodigde aanpassingen,”.
Een afzonderlijke expliciete push-/productie-GO voor deze layout is niet
vastgelegd. De live webroot, hoofdbranch en SEO-pin blijven daarom ongewijzigd.
Werkbranch: `fix/pitwall-test-stable-layout-20261116`.
Exacte basis: `8406d67b7ca2895baf3d22ec066d9eab36560c19`.

## Scope

Uitsluitend de bestaande premium/Nieuw-weergave op `/admin/pitwall-test`.
Geen nieuwe pagina, variantenlab, plugin, migratie, RPC, backend of leerketen.
Gedeelde KPI-opties zijn opt-in; de klassieke testweergave en gewone Endurance
houden hun bestaande standaardgedrag. De gevestigde stijl en copy blijven behouden.

## Wijziging en acceptatie

- Eerste betrouwbaar bekende sectorindeling wordt bewaard per apparaat,
  transport en baan/configuratie. Geen fictieve drie sectoren; 1–16 ondersteund.
- Alleen indelingsmetadata wordt bewaard. Oud geworden, ongeldige of niet
  rondegebonden tijden blijven `—`; een conflicterende reeks wordt niet afgekapt.
- KPI, masthead en timingtoren delen dezelfde indeling. Contextwissels mogen
  geen oude sectorvakken overnemen. Rijderwissel of poll mag de layout niet wissen.
- Timing heeft echte colgroup-kolommen, vaste verdeling en tabulaire getallen.
  Geen onbedoelde horizontale overflow bij een gewone driesectorbaan op desktop;
  grote aantallen sectoren mogen bewust binnen het paneel scrollen.
- Compactere context/advieszone, vaste KPI-waardeslots, voorspelbare hoofdzone
  en uitgelijnde secundaire kaarten. Mobiel blijft natuurlijk stapelen.
- Verversingsmelding houdt een vaste, visueel verborgen plek wanneer inactief.
  Apparaatbronobjecten worden gememoiseerd; geen nieuwe bronidentiteit per tick.
- Positievolgorde, FLIP, verminderde beweging en alle meetkeuring blijven intact.

## Gates

- RED: nieuwe regressies lieten het verdwijnen van sectorvakken en KPI-velden
  op de oude productiecomponenten zien.
- PASS: 170 gerichte tests in 13 testbestanden op de uiteindelijke bronwijziging.
- PASS: git diff --check.
- BLOCKED: lokale volledige TypeScript-CLI werd door de lifecycle-scanner
  geweigerd omdat _tsc.js boven de scancap ligt. Dit is geen geslaagde typecheck
  en ook geen gerapporteerde TypeScript-fout. Geen guard-omzeiling gebruiken.
- PASS: eerste Node24 releasebuild op c6410d13, zonder publicatie.
- PASS: geauthenticeerde bestaande app met echte read-RPCs; bron-CSS gecontroleerd
  op 390, 1366, 1600 en 1920px, zonder horizontale pagina-overflow. Definitieve
  gecompileerde bundel wordt apart gecontroleerd; CSS-injectie is geen buildbewijs.
- De echte browser toonde tijdens de controle geen gecontroleerde sectorreeks.
  Een live overgang van geldige tijden naar ontbrekende tijden is dus niet
  geclaimd; de gerichte regressies bewijzen wel metadataretentie en tijdverval.
- PASS: definitieve Node24 build van
  `f2e0ac6c378ff1a049c7a2103519b7f79e2147f5`, schoon detached worktree.
- PASS: definitieve gecompileerde app, zonder CSS-injectie, op dezelfde vier
  schermbreedtes. Echte pointerselectie en echte read-RPCs; vaste kopgeometrie
  in het gemeten updatevenster, geen horizontale pagina-overflow.
- PASS: Pace-toelichting is bereikbaar via de bedoelde interne scroller
  (196px zichtbaar, 243px inhoud, scrollTop 47). Geen onbereikbare afgekapt tekst.
- PASS: live SEO-pin blijft `/opt/3sm-release-572d4cf8`; nieuwe JS/CSS ontbreken
  in de live webroot en origin/main blijft de oorspronkelijke basis.
- WACHT OP GO: productiepublicatie en live readback. De definitieve bewijzen
  staan onder `/home/hermes/artifacts/3sm/pitwall-test-live-review-20261116/`:
  `FINAL-FRONTEND-PREPARED.json`, `FINAL-COMPILED-BROWSER.json`,
  `PACE-SCROLL-VERIFIED.json` en `fix-final-tests.json`.
  Deze afrondingsnotitie verandert uitsluitend documentatie na de gepinde build.

## Publicatiegrenzen

Bouw vanuit een nieuw, exact gepind release-worktree op 3sm-web, met Node24 en
clientconfig uit de werkelijk actieve release. Bestaande Node-dependencies
mogen alleen worden hergebruikt bij gelijke package/lock-hashes.
Behoud alle live routes, oude gehashte assets en de ondertekende SimHub-downloads.
TrackID 596 en de 425-entry kaartcatalogus moeten meegaan; die waren op de oude
release als gecontroleerde asset-overlay gepubliceerd.

Publiceer pas na browsercontrole. Maak een hash-geverifieerde back-up van de
oude webroot plus actieve SEO-pin; bereid een gepaarde rollback voor en pin de
SEO-timer aan de nieuwe release. Readback moet publieke HTML/JS/CSS, de gekozen
Pitwall-testweergave en de nieuwe pin bevestigen.

Productie vóór publicatie: ongewijzigd. Geen hoofdbranch-fast-forward uitvoeren.
Beoogde productie-impact: frontend JA; backend/DB/bot/plugin NEE.
