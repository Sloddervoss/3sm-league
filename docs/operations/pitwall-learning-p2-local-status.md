# Pitwall learning — P2 lokale tussenstand

P2 is nog niet afgerond. Geen toestemming voor productie, P3, fitting, UI-publicatie
of modelactivatie. Fasebasis: `79ca3381ee880bb145c91c9804da7584fc2b683a`.

## T09 / T10 geaccepteerd en lokaal geïntegreerd

- Gereviewde bron: `3422b47e87c2473c7ccfcfb1f6e331233bd91f6d`.
- Onafhankelijke SPEC-herkeuring: PASS; zes eerdere blokkades gesloten.
- Afzonderlijke kwaliteitsreview: APPROVED, geen blokkerende bevindingen.
- Lokale integratiecommit: `0da53e0e30dceb36604860bb1d7ea4b485dcb1d5`.
- Parent-run op die integratie: **165/165 learningtests geslaagd**, inclusief
  bestaande P1-contracttests; Vite-build exit 0. Geen volledige P2-eindverificatie.
- Nieuwe modules zijn nog niet verbonden met productie-ingest, worker of UI.
  De DB-adapter volgt in T25; er is nog geen bewijs van betere modelvoorspellingen.

Bewijs buiten Git onder `/home/hermes/artifacts/3sm/`:
- `pitwall-learning-p2-context-quality-spec-recheck/`
- `pitwall-learning-p2-context-quality-quality-review/`
- `pitwall-learning-p2-context-quality-parent/integrated-0da53e0e.json`
- `pitwall-learning-p2-context-quality-parent/build-0da53e0e.log`

## Nog uit te voeren binnen P2

- **T11 gestart:** fysieke bandintervallen per wiel, geïsoleerd vanaf de
  integratiecommit. Geen fysieke vervanging afleiden uit alleen een teller,
  wearstijging of herhaalde last_available-waarde. Geen fitting.
- **T12 nog niet gestart:** stopsegmenten; bruto duur en netto verlies gescheiden.
- **T13 conditioneel:** echte broncontractgaten bewijzen en minimaal oplossen;
  geen connectorpublicatie of DLL-wissel zonder afzonderlijke GO.

## Beperkingen en vervolgnotities

- Historische P1-records missen meerdere context-/resetvelden; onbekend blijft
  onbekend. Positieve fixtures zijn synthetisch, geen historische dekkingsclaim.
- T10 bevat een enkel wear-label; ongelijke hoeken blijven daar ambigu. T11 moet
  echte per-hoekdata verwerken en niet normale ongelijke banden afwijzen omdat
  het aggregaat geen enkel label kan leveren.
- Een handmatig inconsistente CanonicalContext kan buiten de builder vallen;
  adapters moeten de constructor/trustgrens respecteren, geen losse typecasts.
- De kwaliteitsreview noemt ontbrekende extra fuel-/vensterbovengrenzen en enkele
  strengere fail-closed gates als niet-blokkerende vervolgpunten. Deze zijn geen
  goedkeuring om later onbetrouwbare input te gebruiken.
- Lokale CLI: Vitest accepteert `--maxWorkers=1`, niet `--minWorkers`.
  De geweigerde parent-aanroep bleef als apart log bewaard; geen testresultaat.

Productiefrontendwijzigingen: **NONE**. Productie-DDL/data/API/connector: **NONE**.
PRODUCTIEWIJZIGING: NEE.
