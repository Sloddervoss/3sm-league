# Premium Pitwall — leesbaarheid op monitordistance

Datum: 22 november 2026  
Basis: `48b24fafdaef37589e4c9c829c38e3afa72bae45` (`origin/main`)  
Bereik: uitsluitend frontend van de premium Pitwall (`PitwallPremiumView`) op
de Test Pitwall, Mijn Pitwall en de gedeelde meekijkstand.

## Wat is gemeten

Dezelfde echte componenten, CSS en focuscontainer als de drie routes, maar met
een login-vrije, synthetische fixture. Er is **geen** productiesessie, sharelink,
database, RPC of connector gebruikt of gewijzigd. De fixture staat in
`docs/pitwall-look/preview/premium-readability.tsx` en
`premiumReadabilityFixture.ts`; de runner is
`scripts/pitwall-readability-browser.mjs`.

Matrix: 36 toestanden

- 3 varianten: Test Pitwall (5 panelen), Mijn Pitwall (5 panelen), gedeeld
  (4 panelen; de pitbevestiging is owner-only en hoort niet op een share);
- 3 viewports: 2560×1440, 1920×1080 en 1280×720. Die laatste is de CSS-viewport
  die ontstaat bij 200% zoom op 2560×1440 (WCAG 2.2 1.4.4);
- normaal en focus;
- live en offline (met de echte `OFFLINE`- en leeftijdslabels).

Per toestand meet de browser:

- de computed `font-size` van elk zichtbaar tekstknooppunt;
- het contrast van de gerenderde tekst tegen de samengestelde achtergrond
  (inclusief `oklch()`/`oklab()`-kleuren en transparantie);
- afkapping (`scrollWidth/scrollHeight` tegen `clientWidth/clientHeight`) buiten
  een eigen scrollcontainer;
- het aantal panelen, horizontale pagina-overflow en of de laatste kaart na
  scrollen echt in beeld komt.

## Resultaat

| Meting (36 toestanden) | Voor | Na |
|---|---:|---:|
| Tekst onder 11 px | 5.946 | **0** |
| Contrast onder 4,5:1 (normale tekst) | 2.922 | **0** |
| Afkapping zonder scrollbare afhandeling | 24 | **0** |
| Horizontale pagina-overflow | 0 | **0** |
| Panelen kwijt of onbereikbaar | 0 | **0** |

Alle 36 runs hebben nul console-, page- en requestfouten. De volledige
per-toestand-cijfers staan in `measurements.csv`; de ruwe rapporten in
`report-before.json` en `report-after.json`.

## Wat is aangepast

- Nieuwe presentatielaag `src/features/endurance/pitwall/test-premium/pitwallReadability.css`,
  na de bestaande premium- en focuslaag geladen. Geen query, sortering,
  autorisatie of berekening verandert.
- Ondergrens 11–11,5 px voor labels/metadata, 12–13 px voor secundaire tekst,
  14 px voor tabelcellen en 15–24 px voor wedstrijdwaarden (positie, laatste/
  beste ronde, S1–S3, gap, PIT).
- Gedempte kleuren van `#64717f` (4,0:1) naar `#8b9bad`/`#9aa9b8` (≥6:1);
  `—`-waarden en de offline-status hebben nu een leesbare, eigen kleur.
- Focusweergave schaalt niet meer terug naar 6,5–9 px. De rijen hebben vaste
  minimumhoogtes en de focuscontainer scrollt; op 1280×720 staan de panelen in
  drie kolommen in plaats van in vijf onleesbare kolommen.
- De vaste paneelrij op desktop groeit van 236 naar 272 px, zodat
  "Laatste/Beste" in de Pace-kaart niet meer halverwege wordt afgekapt.
- De gedeelde meekijkstand vult met vier panelen de volle breedte (geen lege
  vijfde kolom).
- Op Mijn Pitwall blijft de deelstrook ook in focus bereikbaar (bestaand
  contract), maar wordt zij daar één compacte bedieningsregel: kop, status en
  knop zichtbaar, alleen de lange uitleg vervalt. Zo blijven de vijf panelen in
  één beeld. Buiten focus is de volledige strook leesbaar gemaakt.
- Geen enkel paneel, geen kolom en geen wedstrijdwaarde is verwijderd.

## Reproduceren

```bash
# in deze worktree
npx vite --host 127.0.0.1 --port 5210 --strictPort

# in een tweede terminal
npm run test:browser:pitwall-readability -- \
  --base http://127.0.0.1:5210/docs/pitwall-look/preview \
  --out docs/pitwall-look/evidence/pitwall-readable-20261122/rerun
```

De runner start geen server en doet geen writes. `--only test|personal|shared`
en `--viewport 2560x1440|1920x1080|1280x720` beperken de matrix.

## Beperkingen van dit bewijs

- Dit bewijst presentatie, niet de correctheid van live data of RPC's.
- De fixture gebruikt synthetische namen en tijden; de vorm volgt het echte
  `V3Normalized`-contract.
- Op 1280×720 focus moet de gebruiker scrollen; dat is een bewuste keuze
  ("scroll, niet krimpen"). De scrollcontrole bewijst dat de laatste kaart
  bereikbaar is (`after-...-scrollend.png`).
- De gedeelde variant heeft vier panelen omdat de vijfde, de pitbevestiging,
  een owner-only mutatie is. Dat is bestaand gedrag en is niet verruimd.
