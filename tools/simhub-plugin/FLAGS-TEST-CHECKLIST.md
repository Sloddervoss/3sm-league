# 3SM Endurance Connector — vlaggen & flagbox: testchecklist

Kort, stap voor stap, om de flags-module (incl. flagbox-profiel) in SimHub te verifiëren.
Vink af en noteer afwijkingen.

---

## 0. Bouwen en klaarzetten
- [ ] Bouw in Visual Studio/MSBuild met `SIMHUB_INSTALL_PATH` gezet naar `C:\Program Files (x86)\SimHub\`.
- [ ] **Versie bumpen** (`bump-version.sh`) — nodig voor een eventuele auto-update. Zonder bump ziet een oude client geen nieuwere versie.
- [ ] Kopieer `3SM.EnduranceConnector.dll` naar `C:\Program Files (x86)\SimHub\`.
- [ ] Sluit SimHub volledig af en start opnieuw.
- [ ] SimHub → Plugins: "3SM Endurance Connector" is actief, en er is een **⚑ Vlaggen**-tab.

**Verwacht:** geen fouten in het SimHub-log bij het laden. Eerste keer wordt de settings-migratie naar schema 5 uitgevoerd (`Flags`-blok + `Boxes` geïnitialiseerd).

---

## 1. Properties verschijnen
- [ ] Open in SimHub een formule/property-verkenner (bv. de LED-editor of dashboard-formule-editor → "beschikbare properties").
- [ ] Zoek op `THREESM`.
**Verwacht** (universeel), met de pluginnaam ervoor:
`EnduranceConnectorPlugin.THREESM.Flags.Active`, `.Primary`, `.Colour`, `.Layout`, `.Bits`, `.Severity`, `.Green/.Yellow/.Red/.Blue/.White/.Checkered/.Black/.Orange/.Debris/.SafetyCar/.VirtualSafetyCar`.
En per box: `EnduranceConnectorPlugin.THREESM.Flags.Box1.*` … `Box4.*` (+ `.DeviceName`).

> De prefix alleen (`THREESM.Flags`) is niet genoeg: SimHub zet de pluginnaam
> ervoor. Een binding zonder `EnduranceConnectorPlugin.` bestaat niet en blijft
> stil leeg.

> Niet zichtbaar? → SimHub herstarten; controleer het log op een exceptie in `Init`.

---

## 2. Vlaggen oplossen zonder hardware (iRacing)
- [ ] Ga de baan op in iRacing (of een sessie met vlaggen).
- [ ] Laat in de property-verkenner `EnduranceConnectorPlugin.THREESM.Flags.Primary` en `.Green/.Yellow/...` live meelopen.
**Verwacht:**
- [ ] Groen bij een groene vlag → `Primary = "green"`, `.Green = True`.
- [ ] Geel (of laat een gele vlag triggeren) → `Primary = "yellow"`.
- [ ] Finishvlag → `Primary = "checkered"` en blijft ~20 s staan (latch).
- [ ] Buiten de auto / geen sessie → `.Active = False`, `Primary = "none"`.

**Als niets verandert:**
- [ ] Controleer in het SimHub-log of de ruwe paden bestaan: `GameRawData.Telemetry.SessionFlagsDetails.*` (iRacing).
- [ ] Controleer de `FlagProperty` in de settings (`DataCorePlugin.GameData.NewData.Flag`).
- [ ] Test met de generieke naam-fallback: zet in iRacing een vlag die `Flag_Name` vult.

---

## 3. SimHub-property publicatie (de brug naar de flagbox)
- [ ] Vlaggen → **"Publiceer vlag-properties"** aan.
- [ ] Verander een vlag en kijk of `EnduranceConnectorPlugin.THREESM.Flags.Box1.Primary` meeloopt.
**Verwacht:** de properties volgen de opgeloste vlag (bij wijziging, max elke 250 ms).

---

## 4. Flagbox-profiel installeren
- [ ] Vlaggen → Flagboxen: kies **Profielsoort** (8x8 RGB-matrix / RGB-LED strip / TM1638).
- [ ] Bij strip: zet **"LEDs per strip"** op het aantal LEDs van je strip.
- [ ] Zet **"Aantal flagboxen"** op het juiste aantal (bv. 1).
- [ ] Wijs per box het **SimHub-device** toe (dropdown; leeg laten = eerste matrix-driver).
- [ ] Zet **"Profiel gebruikt Box (1-4)"** op de box die dit device moet tonen.
- [ ] Klik **"Installeer flagbox-profiel"**.

**Verwacht:**
- [ ] Melding "live geïnstalleerd op '<device>'" → klaar (live route).
- [ ] Lukt live niet → melding toont de **bestandsinstallatie** + backup `…LedsSettings.json.3smbak`. Herstart dan SimHub.

**Daarna:**
- [ ] Open in SimHub de LED-editor van het device → er staat een profiel **"3SM Flags"**.
- [ ] Selecteer dat profiel op de matrix.
- [ ] Test de vlaggen → de matrix toont de juiste kleur/patroon (rood, geel, knipperend geel bij safety car, checker bij finish, enz.).

---

## 5. Meerdere boxen
- [ ] Zet "Aantal flagboxen" op 2+ en wijs Box2 aan een tweede device.
- [ ] Zet de tweede box op "**Volgt universeel**" → toont hetzelfde.
- [ ] Zet "Volgt universeel" **uit** en kies per box andere vlaggen → de box toont een subset.
- [ ] Herhaal "Installeer flagbox-profiel" met "Profiel gebruikt Box" = 2 (elk device zijn eigen profiel).

---

## 6. Terugval / herstel
- [ ] Profiel overschreven of verdwenen? → opnieuw **live** installeren (knop), of bestandsinstallatie + SimHub herstarten.
- [ ] Probleem met een update? → backup `*.3smbak` blijft staan; `.superseded`-DLL wordt door het updater-proces opgeruimd.

---

## Bekende beperkingen (nu)
- Profielen: **8×8 RGB-matrix** (JS) én **LED-strip** (RGB/TM1638, `Groups.CustomConditionalGroup` + `CustomStatus`).
- Op een strip is de finishvlag **effen wit** (geen checker-patroon op strips).
- Overlap van meerdere vlaggen op een strip hangt af van SimHub's container-prioriteit; bijstellen kan in de LED-editor.
- De live-installatie via reflectie is **runtime nog niet gedraaid**; faalt hij, dan is er de bestands-terugval.
- Matrix-**positie** (`StartPositionMatrix/X/Y`) kan bij multi-matrix devices bijgesteld moeten worden.
- De ruwe iRacing-paden (`…SessionFlagsDetails.*`) zijn niet op elke SimHub-versie gegarandeerd; de generieke naam-fallback dekt de rest.
