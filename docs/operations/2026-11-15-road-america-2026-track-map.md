# Road America 2026 (TrackID 596) layered map

Op 2026-11-15 toegevoegd aan de bestaande layered catalogus. Aanleiding: een
live Bart-sessie meldde `trackId=596`, `trackName=roadamerica 2026 full`,
`trackConfig=Full Course`; de catalogus (snapshot 2026-05-05) kende alleen 18
(Full Course) en 50 (Bend), waardoor de pitwall geen kaart kon laden.

## Identiteit

- iRacing TrackID: **596**
- Lokale weergavenaam: `Road America 2026 - Full Course` (jaartal onderscheidt de rescan van TrackID 18 in de selector en naamfallback).
- Config: `Full Course`
- SDK-map: `roadamerica\2026\full`
- `configNameShort`: `roadamerica-2026-full`
- iRacing introduceerde de 2026-rescan in Season 4 (build 2026.09.09.01) met
  Full Course, Bend, Short East en Short West. TrackID 596 is de Full Course;
  de live telemetrie bevestigt dezelfde identiteit.

## Bron

Officiële iRacing CDN (publiek, geen sessiecookie), map
`tracks_roadamerica/596-roadamerica-2026-full`:

```
https://members-assets.iracing.com/public/track-maps/tracks_roadamerica/596-roadamerica-2026-full/background.svg
https://members-assets.iracing.com/public/track-maps/tracks_roadamerica/596-roadamerica-2026-full/inactive.svg
https://members-assets.iracing.com/public/track-maps/tracks_roadamerica/596-roadamerica-2026-full/pitroad.svg
https://members-assets.iracing.com/public/track-maps/tracks_roadamerica/596-roadamerica-2026-full/active.svg
https://members-assets.iracing.com/public/track-maps/tracks_roadamerica/596-roadamerica-2026-full/start-finish.svg
```

De vijf layers zijn gedownload en met de bestaande `render_svg()` uit
`scripts/generate-layered-track-maps.py` ingebed in `track-596.svg`. De
generator-main is niet uitgevoerd (die overschrijft de hele catalogus en
verwijst naar een verouderd `/tmp/mm-clone`-pad).

SHA-256 van de gebruikte bronlayers:

| Layer | SHA-256 |
| --- | --- |
| background | `cce4240f9fe5a5ede0223f15040a489b856931088056a2839134bc27142d4abc` |
| inactive | `984841c04142ec82f028bf4e930b1124eeb7f8f71604362fcc3cc7a2537a9193` |
| pitroad | `390d2699222cf98e26aff2236e16a5833f4bb485d6f6c2def62385f6a5f691b3` |
| active | `c961edb5f87a80aaa33bade7e3798475355373168ef7319561e6148c354dd379` |
| start-finish | `65dd28e5e7155dab7a7c97012630b693392ec5888f77f176577c13443192d82f` |

Deze 596-layers zijn byte-identiek aan de gepubliceerde 18-layers. Dat is een
eigenschap van de officiële 596-publicatie, geen alias: het asset is uit de
596-map gegenereerd en de manifest-entry verwijst alleen naar TrackID 596.
De 2026-herbouw voegt Short East/West toe; iRacing publiceert voor de Full
Course van 596 dezelfde layerbestanden als voor 18.

## Beperking

Dit bewijst de statische officiële kaart. TrackID 596 staat niet in
`ROAD_PROJECTION_IDS`; de pitwall gebruikt daarom de bestaande contourprojectie,
geen apart gevalideerd road-centerline-asset. Er is geen live auto- of
GPS-projectie tegen deze kaart gemeten. De gedeelde
`readOfficialTrackReference()` geeft voor Road America zowel bij 18 als 596 geen
start/finish of richting terug; dat is een bestaande beperking van de huidige
parser voor deze bronlayers, geen regressie van de 596-toevoeging. De statische
kaart rendert wel.

## Gerichte publicatie en verificatie

Alle 424 bestaande catalogusentries blijven byte-inhoudelijk gelijk; alleen 596
wordt toegevoegd. De weergavenaam bevat expliciet 2026 zodat ook de bestaande
naamfallback en de adminselector geen dubbele Full Course-keuze krijgen.

Na de laatste wijziging: vijf gerichte Vitest-bestanden / 31 tests geslaagd;
`validate-layered-track-maps.mjs` rendert alle 425 SVGs zonder fouten. De vijf
596-bronlayers zijn door de parent opnieuw direct van de officiële CDN opgehaald
en op SHA-256 met de ingebedde inhoud vergeleken. Een 960×540-render is visueel
gecontroleerd: de oranje baanlijn is zichtbaar en ononderbroken. De lokale
ESLint-herhaling werd door de gateway lifecycle-scanner geblokkeerd; niet als een
geslaagde lint-run tellen.

Publiceer alleen `manifest.json` en `track-596.svg` als vastgelegde asset-overlay
op zowel de actieve `dist/tracks/layered` als `/var/www/3sm/tracks/layered`.
Bewaar de eerdere manifesten en eventuele eerdere 596-bestanden met hashes in
`/opt/3sm-release-overlays/` buiten de checkout; registreer de broncommit en
nieuwe bestandshashes. Gebruik dezelfde `/var/lock/3sm-site.lock` als de
SEO-refresh en atomische bestandsvervanging. De actieve broncheckout en de
gecompileerde JS/CSS/HTML blijven ongewijzigd. De Git-bron voor een volgende
release bevat de nieuwe assets wel; bouw een oude bevroren release niet opnieuw
alsof die de overlay bevat.

Controleer na publicatie de normale publieke URLs (niet alleen cache-busted):
manifestentry 596, ongewijzigde overige entries, juiste SVG-content-type en exact
de gepubliceerde SHA-256. Een reeds geopende Pitwall bewaart de catalogus in een
modulepromise: één pagina-refresh haalt de nieuwe catalogus op, zonder SimHub
of iRacing te herstarten. Statische kaart en live-autokalibratie blijven aparte
gates; geen live-markers claimen op grond van de statische render.
