# 3SM SimHub Endurance Connector — Updategids & schaagnotities

## Voor deelnemers: hoe verloopt een update?

De plugin koppelt **eenmalig**. Updates bewaren de versleutelde device-token en de
bestaande 3SM-koppeling; opnieuw koppelen is normaal niet nodig.

Vanaf de updater-bootstrap (`0.3.0.0`) verloopt een update zo:

1. Open de 3SM-plugin in SimHub en klik eventueel **Nu op updates controleren**.
2. Bij een nieuwere versie wordt **Update installeren en SimHub herstarten** actief.
3. Bevestig de update en daarna de Windows UAC-melding.
4. De plugin controleert releasemetadata, download, grootte, SHA-256 en DLL-versie.
5. Een extern helperproces wacht tot SimHub volledig is afgesloten, bewaart de vorige DLL,
   plaatst de nieuwe DLL atomair en start SimHub via de normale Explorer-shell opnieuw.
6. Bij een installatiefout wordt de geverifieerde vorige DLL teruggezet.

## Handmatige installatie via de publieke ZIP

Voor een handmatige installatie download je `3SM.EnduranceConnector-latest.zip` via de
3SM-site. Sluit SimHub volledig af, hef zo nodig vóór het uitpakken de Windows-blokkering op
de ZIP op, pak de ZIP uit en volg `INSTALLEREN.txt`. Plaats alleen de canoniek benoemde
`3SM.EnduranceConnector.dll` in de map met `SimHubWPF.exe`; laat geen tweede versioned kopie
in die map staan. Start SimHub daarna opnieuw en controleer de connectorversie.

De overgang `0.3.8.0 → 0.3.9.0` moet door het bekende 0.3.8.0 self-update-defect éénmalig
handmatig worden uitgevoerd. Vanaf 0.3.9.0 werken toekomstige ondersteunde updates weer via
de normale automatische updater.

De eerste installatie van een versie van vóór `0.3.0.0` naar de updater-bootstrap blijft
eenmalig handmatig: sluit SimHub, hernoem een versioned download zoals
`3SM.EnduranceConnector-0.3.0.0.dll` eerst naar exact `3SM.EnduranceConnector.dll`, en plaats
alleen dat canoniek benoemde bestand in de map met `SimHubWPF.exe`. Laat geen tweede versioned
kopie in de SimHub-map staan. Start SimHub daarna opnieuw. Dezelfde handmatige route blijft
beschikbaar als fallback wanneer UAC of lokale beveiligingssoftware de helper blokkeert.

## Veiligheidsmodel

De geladen plugin-DLL overschrijft zichzelf nooit. Download en vervanging zijn gescheiden:
de plugin valideert en staged, waarna een extern verhoogd helperproces pas na SimHub-exit
back-upt en vervangt. Een geladen `0.3.0.1` of nieuwere plugin verifieert bovendien een
immutable RSA-ondertekend manifest met vaste HTTPS-host, versiegebonden bestandsnaam,
bytegrootte, SHA-256 en versie. De eenmalige overgang `0.3.0.0 → 0.3.0.1` wordt nog door
de oudere bootstrap uitgevoerd en gebruikt vaste TLS-host, versiepad en SHA-256, maar nog
niet de nieuwe RSA-handtekening of ready-handshake. De publieke verificatiesleutel staat in
de repository; de privésleutel wordt niet meegeleverd of gecommit.

De helper heeft nog geen Authenticode-certificaat. Windows kan de UAC-uitgever daarom als
onbekend tonen. Accepteer die melding alleen wanneer de update vanuit de 3SM-plugin is
gestart en de getoonde versie overeenkomt met de aangekondigde 3SM-release.

## Schaalbaarheid (~30 man)

De limieten zijn in de code geverifieerd en ruim toereikend voor tientallen deelnemers:

| Laag | Limiet | Gevolg bij 30 man |
|---|---|---|
| Plugin-interval | 1000 ms → 1 verzoek/s per device | ieder op eigen thuis-IP: 1/s ✓ |
| Edge ingest per IP | 600/min = 10/s per address | gedistribueerd thuisnetwerk ✓ |
| DB ingest per device | 400 ms gate + latest-only | 30 rijen, triviaal |
| Cloudflare per IP | 300/10 s = 30/s | gedistribueerd ✓ |
| Realtime (Race Control) | channel per device | tientallen subs, self-hosted ✓ |

**Belangrijkste schaalfactor:** iRacing onthoudt live telemetry aan niet-rijdende teamleden
(anti-cheat). Per team is dus maar **één device tegelijk "live"** → bij 30 man ~het aantal
teams, niet 30 streams. De `isInCar`-heartbeat van niet-actieve devices houdt dit licht.

**Uitzondering voor iedereen achter één NAT/office-IP:** dan lopen jullie gezamenlijk tegen
de 10/s-ingest-grens aan. Op thuisverbindingen (de realiteit) is dit geen probleem.
