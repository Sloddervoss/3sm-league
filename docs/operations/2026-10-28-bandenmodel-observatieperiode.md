# Bandenmodel — observatieperiode tot 4 november 2026

**Besluit (28-10-2026, Vincent):** we laten het een week draaien en komen er daarna op terug.
Geen modelwijziging, geen nieuwe plugin, geen drempelaanpassing in deze periode.

## Wat we zagen

In `simhub_tyre_lap_samples` bij DESKTOP-E2SEMRP, één sessie, `tyre_set` de hele tijd 1:

```
ronde  5  100,000
ronde  6   95,500
ronde  7   99,640   <- omhoog
ronde 10   96,210
ronde 18   94,730
ronde 21   97,970   <- omhoog
ronde 25   96,960
ronde 31   98,510   <- omhoog
```

Slijtage hoort te dalen. De set-teller blijft staan, dus soit de teller soit de
wear-waarde komt van een andere set dan we aannemen.

## Twee hypothesen

1. **Reset of nieuwe set zonder tellerupdate.** Een auto-reset of tow kan een verse
   set geven; de wear springt dan terug naar ~100 en zakt daarna. Dat past bij de
   sprongen (+3 tot +3,5 pp) en bij het feit dat de waarde niet exact 100 is.
   Gevolg: de **setgrens** is het probleem, niet de meting.
2. **Oude pluginversie.** Beide apparaten stonden op een oude versie
   (DESKTOP-E2SEMRP 0.7.0.0, PCBART 0.6.1.0) met 0.7.1.2 al gedownload in de stand
   `WAITING_FOR_RESTART`. In het bandenblok is tussen die versies het nodige
   veranderd.

## Wat er in de tussentijd niet gebeurt

- Geen nieuwe schatter, geen aangepaste shrinkage, geen extra graden.
- Geen wijziging aan de pitwall-presentatie op basis van deze meting.
- De bestaande cijfers blijven staan zoals ze zijn, met hun "voorlopig"-label.

## Wat we op 4 november beoordelen

1. Draaien beide apparaten op 0.7.1.2 of hoger (`simhub_device_health.connector_version`)?
2. Zijn er in de nieuwe data nog stijgingen van de wear binnen één `tyre_set`?
3. Beweegt `tyre_set` mee bij een reset of bandenwissel?
4. Hoeveel afgesloten stints met een bruikbare helling zijn er bijgekomen, per
   auto+circuit?
5. Is de spreiding tussen stints kleiner geworden, of nog steeds factor 4?

Bij punt 2 "geen stijgingen meer" en punt 3 "teller beweegt mee": dan is de
meetketen gezond en gaan we door met de schatter (advies §3).
Bij punt 2 "nog steeds stijgingen": dan behandelen we een stijging als setgrens
in plaats van als ongeldige meting, en hertoetsen we opnieuw.

## Referenties

- Advies: `/home/hermes/3sm-bandenmodel-advies-2026-10-28.txt`
  (ook de basis voor de volgorde: meetketen → schatter → presentatie).
- Openstaand in de plugin: `onPitRoad` + `tyre_changed` per stop vastleggen, zodat
  een reset of fuel-only stop herkenbaar wordt zonder giswerk.
