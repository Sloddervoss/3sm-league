# Wekelijkse iRacing Endurance-catalogussync

## Secrets

Configureer uitsluitend server-side:

- `IRACING_EMAIL` en `IRACING_PASSWORD`: dezelfde technische login als Track Intelligence;
- `ENDURANCE_IRACING_SYNC_TOKEN`: willekeurig dedicated token van minimaal 32 tekens;
- `ENDURANCE_IRACING_SEASON_MAP_JSON`: expliciete JSON-array met officiële season-ID's en metadata;
- de gebruikelijke `SUPABASE_URL`, `SUPABASE_ANON_KEY` en `SUPABASE_SERVICE_ROLE_KEY`.

Voorbeeldmapping (geen secret):

```json
[{
  "seasonId": 6578,
  "localClassIds": [],
  "seed": {
    "sourceKey": "iracing:2026:portimao-1000",
    "year": 2026,
    "name": "Portimao 1000",
    "circuit": "Algarve International Circuit",
    "dateStart": "2026-08-14",
    "dateEnd": "2026-08-15",
    "teamEvent": true,
    "officialUrl": "https://www.iracing.com/special-events/#portimao-1000",
    "posterUrl": "https://www.iracing.com/wp-content/uploads/2025/12/iRSE-2026-Portimao-1000.png",
    "classIds": ["HPD", "GT1", "GT2"]
  }
}]
```

`localClassIds` is bewust apart van de officiële `classIds` en accepteert alleen de lokaal ondersteunde stemklassen `GTP`, `LMP2` en `GT3`. Laat deze array leeg als de officiële klassen niet expliciet en inhoudelijk aan de lokale autoselectie zijn gekoppeld; het event blijft dan zichtbaar maar activatie wordt database-side geblokkeerd. Gok bijvoorbeeld niet dat een historische `HPD`-klasse automatisch `GTP` betekent.

Season-ID's worden expres niet uit namen gegokt. Pas de mapping aan wanneer iRacing een nieuw event/schedule publiceert.

## Handmatige controle

```bash
ENDURANCE_IRACING_SYNC_URL='https://api.example/functions/v1/iracing-special-events-sync' \
ENDURANCE_IRACING_SYNC_TOKEN='...' \
bash scripts/sync-iracing-endurance-events.sh
```

Een ingelogde `super_admin` kan de Edge Function ook handmatig met diens Supabase access-token aanroepen. De service-role key is nooit schedulercredential.

Controleer daarna `endurance_iracing_sync_runs`: `status`, tellingen en `error_summary`. Bij `partial` blijven eerder bekende slots staan.

## Planning

Voorkeur op de bestaande host: de meegeleverde systemd-timer draait maandag 04:15 `Europe/Amsterdam`. Gebruik een root-only `EnvironmentFile` met mode `0600`. De servicetemplate draait standaard als root om dit envbestand te lezen; stel via een systemd drop-in pas `User=`/`Group=` in nadat het echte hostserviceaccount en diens leesrechten zijn bewezen. Activeer de timer pas na een handmatige groene run in de doelomgeving.

## Uitschakelen en rotatie

- timer stoppen/disable; de laatste goede catalogus blijft beschikbaar;
- `ENDURANCE_IRACING_SYNC_TOKEN` in Edge-runtime en host-env tegelijk roteren;
- nooit Authorization-headers of envbestanden loggen.
