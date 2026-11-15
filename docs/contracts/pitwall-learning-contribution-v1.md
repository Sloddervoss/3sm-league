# Learningbijdrage v1 — P1-contractlaag

**Status:** lokaal gebouwd en gereviewd; niet aangesloten op een UI, query of adviespad.
Productiefrontendwijzigingen: NONE. PRODUCTIEWIJZIGING: NEE.

Bron: `src/features/endurance/pitwall/learning/contracts.ts`; tegenproeven:
`contracts.test.ts`. P1 bouwt de bewijslaag, geen nieuw beslissend model.

## API

```ts
parseLearningContribution(
  input: unknown,
  options?: { knownModelVersions?: readonly string[] },
): LearningContribution | null
```

De parser is puur: geen klok, netwerk, database, poller of modelselectie. Ongeldige invoer
levert `null`, niet een gedeeltelijk vertrouwd model. Een geslaagde parse bewijst alleen
contractconformiteit, niet toegang, huidige context, actualiteit of modelnauwkeurigheid.
Die poorten moeten latere geautoriseerde serving en de adapter afzonderlijk afdwingen.

## Targets en eenheden

- `fuel`: `L/lap`, `corner: null`.
- `pit_loss`: `s`, `corner: null`. De caller mag bruto entry→exit niet als netto verlies
  aanleveren alleen omdat de eenheid overeenkomt.
- `tyre_wear`: `percent_remaining`, verplichte hoek `fl`, `fr`, `rl` of `rr`, bereik 0–100.
- `tyre_pace`: `s/lap`, `corner: null`.

De returned union houdt target, eenheid en hoek bij elkaar. Een weargetal heeft dus
altijd hetzelfde hoeklabel. Wear is geen automatische toestemming voor economische
bandenkeuze.

## Verplichte vorm en ontbrekende waarden

`schemaVersion` is exact 1; `target`, `state`, `unit`, `featureVersion`, `policyVersion`,
`contextMatch`, `decisive`, `reasonCodes` en `independentSessions` moeten aanwezig en
correct getypeerd zijn. `state` is `collecting`, `shadow`, `active` of `blocked`.

Nullable velden kunnen ontbreken en worden dan `null`: `modelVersion`, `trainedThrough`,
`sourceObservedAt`, `sourceFrameSequence`, `estimate`, `lower`, `upper`, `independentSets`.
`estimate/lower/upper` zijn samen null of samen finite, met `lower <= estimate <= upper`.
Counts zijn niet-negatieve veilige integers. Een echte nul blijft nul. Ontbrekende
`decisive` of `contextMatch` wordt niet stil `false` en maakt de payload ongeldig.

Een niet-null `modelVersion` moet exact in de door de caller geleverde allowlist staan;
een plausibel ogende versienaam is geen bekende versie. Zonder allowlist worden alleen
bijdragen zonder modelversie aanvaard.

## Tijd is geen impliciete kalenderdatum

- `sourceObservedAt`, indien niet-null: volledige ISO-datum, `T`, tijd en expliciet `Z`
  of een offset. Dit geldt in **alle** toestanden. `2026-11-11` is geen observatietijdstip
  en wordt geweigerd; er wordt geen middernacht of tijdzone ingevuld.
- `trainedThrough`: een volledige datum mag dagprecisie hebben, of een gezoneerd
  tijdstip zijn. Deze metadata is geen automatisch bewijs van een exact knowledge cutoff.
- De huidige parser ondersteunt maximaal milliseconden (drie fractiecijfers). Een latere
  database-reader met fijnere precisie moet dit contract expliciet afstemmen; niet stil
  aannemen dat iedere PostgreSQL-timestampstring nu al aan deze vorm voldoet.
- De parser doet geen versheids-/serverbekendheidstoets. Bronreceipt vóór COMMIT of
  historische revisies worden hiermee niet tot onafhankelijk as-of-bewijs verheven.

De date-only bronobservatie was een bewezen fout in de eerste versie: een active/decisive
payload kon toen onterecht door. De gerichte correctie is met eerst rode en daarna groene
regressies uitgevoerd. De positieve trainedThrough-dagprecisie bleef behouden.

## Active en decisive

`active` vereist een bekende non-null modelversie, expliciet `contextMatch: true` en
niet-null `trainedThrough` en `sourceObservedAt`. `decisive: true` vereist bovendien een
volledig numeriek interval en is alleen bij `active` toegestaan. Andere toestanden zijn
nooit decisive. Deze vormcontrole verleent geen beleids- of productie-GO.

## Grenzen van de volledige payload

- Maximaal 8192 UTF-8-bytes, inclusief onbekende velden.
- Maximaal 16 reasoncodes, elk maximaal 64 tekens.
- Maximaal 512 JSON-knopen en acht geneste object-/arrayniveaus.
- Alleen gewone JSON-waarden/objects; NaN, Infinity, undefined, BigInt, accessors,
  class-instances en cycli worden gesloten afgehandeld. Geen `toJSON` of
  `String(object)`-coercie van de payload.
- Onbekende geldige JSON-velden tellen mee voor de grenzen, maar worden niet teruggegeven
  of als modelbewijs gebruikt. Opties met bekende modelversies zijn callerconfiguratie,
  geen van de serverpayload afgeleide toestemming.

## Uitgevoerde verificatie

- 121 tests geslaagd bij builder, parent-integratie en onafhankelijke kwaliteitsreview.
- Parent-specherkeuring: date-only bron in alle vier states geweigerd; gezoneerde UTC-
  middernacht en expliciete offset geaccepteerd; trainedThrough-datum behouden.
- ESLint op beide bestanden: groen.
- Projecttypecheck: de 16 vastgelegde baselinefouten blijven bestaan, geen nieuwe
  learningdiagnostics. Niet als geheel groene projecttypecheck presenteren.
- De volledige ongewijzigde fasebasis telde 1826 geslaagde tests en één bestaande
  `tyreTelemetryContract`-fout. De integratiesuite wordt na de complete P1-delta opnieuw
  vergeleken, niet uit deze losse contracttest afgeleid.

Reviewbasis: `72e82de4f35347b3dd16721f8d8aa647c3706f21`;
parent-integratie: `2cc00dcedcb2055967014dbf3f17923102ca0235`.
Geen push, productie-DDL, connector- of zichtbare copywijziging onder deze contracttaak.
