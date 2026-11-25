# Auto-leren voor banden — schaduwmodus

**Scope:** database + één bestaande Edge Function. Geen connector- of frontendwijziging.
Geen actief bandenadvies, promotie, terugvulling of gedeelde pool. Het bestaande experimentele
bereik en het brandstofadvies veranderen niet.

## Wat dit leert

- Bewaar race-, account- en autocontext naast de bestaande bandenwaarneming, uit hetzelfde
  geaccepteerde frame. Telemetrie zonder bewezen Race + sessie-ID en layout krijgt geen leerbewijs.
- Een bevestigde bandenstop start opnieuw vanaf de **gemeten** postservice-stand per wiel (geen
  veronderstelde 100% en geen claim dat alle vier vervangen zijn). Een bevestigde tank- of
  serviceloze stop kan dezelfde set voortzetten. Een onbekende stop, conflict in hoektellers,
  stijgende wear, ontbrekende waarneming of o.a. rijderwissel onderbreekt het bewijs. Wacht tien
  minuten op een antwoord in de bestaande Pitwall; daarna geen stille reconstructie. Geen nieuwe
  vraag of verplichte oefenrit. Zonder kwalificeerbare bevestigingen blijft het model leeg.
- Leer de procentpuntdaling per ronde per wiel uit minstens acht gemeten rondes tussen twee
  verse wear-ankers, met schone binnenronden in dezelfde race. Gelijke waarden op herhaalde frames
  gelden niet als verversing. Gebruik alleen dezelfde account-, apparaat-, rijder-, auto-, baan- en
  compoundcontext. Start na drie geldige intervallen uit ten minste twee races, neem de mediaan
  per wiel over maximaal dertig eerdere intervallen. Voorspel een **slijtagetarief tot de eerstvolgende
  geldige refresh op diezelfde set**, geen levensduur of rondes tot pit. Schrijf eerst de score van
  de eerdere bevroren voorspelling; fit daarna opnieuw. Een late voorspelling krijgt geen score.
- De private tabel bewaart maximaal dertig dagen werkvoorraad/resultaten; de onderhoudstaak
  verwijdert ingetrokken/gewijzigde policy niet uit de bestaande ruwe telemetrie. De shadow-path
  hoort de actuele private capture-/fit-permissies te respecteren. Geen publieke leesfunctie.

## GO-poorten vóór productie (geen uitvoering zonder GO)

1. **PASS**: run `supabase/tests/tyre_race_shadow_test.sql` uitsluitend op een lege,
   geïsoleerde PostgreSQL 15-testdatabase (fixture → migratie → voorspelling → rollback).
   Draai ook de Edge-ingest-/bandenobservatietests.
2. Controleer de productie-schema's, RLS, cron en werkende ingest. Back-up en vergelijk hashes
   van de werkelijk gemounte `simhub-ingest-v3/index.ts` met HOOFD vóór de patch. Pas geen andere
   edgebestanden of containers aan. Bij afwijkende live code alleen het beoordeelde hunk porteren.
3. Pas `20261125190000_tyre_race_shadow.sql` toe met `ON_ERROR_STOP=1`. Controleer dat gewone
   rollen geen rechten hebben en normale telemetrie doorloopt. Rol de Edge-patch uit, controleer
   de actieve bestandshash en een echt 0.7.6.8-frame. Pas daarna `supabase/ops/tyre_race_shadow_enable.sql`
   toe via dezelfde beheerrol. Controleer de job als die eenmaal gelopen heeft.
4. Gebruik `supabase/ops/tyre_race_shadow_health.sql` om de queue, kwalificatie, echte voorspellingen
   en fouten per wiel te zien. Eerste veldpoort: één bewezen bandenstop en één tankstop zonder
   banden; beoordeel echte refresh, continuïteit en kwalificatie. Daarna validatie op onafhankelijke
   races tegen een eenvoudige referentie. Zonder bewijs geen wijziging aan het pitadvies.

**Terug:** stop de cronjob en herstel het oude Edge-bestand; behoud de private tabel als je de
bevindingen wilt onderzoeken. De gematchte rollback verwijdert desgewenst de volledige
shadow-tabel en trigger (export resultaten eerst). Oude bandendata blijven onaangeroerd.
