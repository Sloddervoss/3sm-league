# PACE — fase A: live bewijs (read-only)

Bron: PCBART / Bart Tonkes, door opdrachtgever gemelde plugin 0.7.2.1. De live snapshot geeft source=null en connectorVersion is niet vastgesteld uit dit JSON; de versie is dus geen onafhankelijk bewezen runtimewaarde.

75 afzonderlijke SELECTs via SSH/docker exec/psql, ieder in BEGIN READ ONLY; COMMIT. Geen race-pc benaderd. Tijden hieronder UTC. Basis-HEAD 23552bdf2832211a1ae56ad8f06feb78de0b9e36; lokale main b1d458a965315921567690c451fb1cf4f6c0fa21. Bestaand untracked pace-ontwerp.md behouden.

## 1. Sectoren zijn geen coherente laatste ronde

De waarden hieronder komen uit vehicle.sector1Seconds..3, NIET uit timing (die drie zijn overal null) of de nog niet gelezen Opponent.LastLapSector-getters.

capturedAt | sequence | afgerond | verstreken | laatste (timing) | S1 | S2 | S3 | som | som−laatste
---|---:|---:|---:|---:|---:|---:|---:|---:|---:
2026-11-01T10:14:04.153172+00:00 | 1512 | 13 | 48.047 | 110.679 | 26.126 | 18.500 | 14 | 58.626 | -52.053
2026-11-01T10:14:26.852516+00:00 | 1534 | 13 | 70.747 | 110.679 | 26.126 | 18.500 | 14 | 58.626 | -52.053
2026-11-01T10:14:48.653072+00:00 | 1555 | 13 | 92.547 | 110.679 | 26.126 | 18.500 | 14 | 58.626 | -52.053
2026-11-01T10:15:02.453362+00:00 | 1568 | 14 | 1.242 | 105.104 | 22.047 | 18 | 13.800 | 53.847 | -51.257
2026-11-01T10:15:10.752987+00:00 | 1576 | 14 | 9.542 | 105.104 | 22.047 | 18 | 13.800 | 53.847 | -51.257
2026-11-01T10:15:33.052797+00:00 | 1598 | 14 | 31.842 | 105.104 | 22.047 | 18 | 13.800 | 53.847 | -51.257
2026-11-01T10:15:55.553494+00:00 | 1620 | 14 | 54.342 | 105.104 | 22.047 | 18 | 13.800 | 53.847 | -51.257
2026-11-01T10:16:18.153085+00:00 | 1642 | 14 | 76.942 | 105.104 | 22.047 | 18 | 13.800 | 53.847 | -51.257
2026-11-01T10:16:40.152944+00:00 | 1663 | 14 | 98.942 | 105.104 | 22.047 | 18 | 13.800 | 53.847 | -51.257
2026-11-01T10:16:48.552956+00:00 | 1671 | 15 | 2.216 | 105.126 | 21.642 | 18.100 | 14 | 53.742 | -51.384
2026-11-01T10:17:01.953166+00:00 | 1684 | 15 | 15.616 | 105.126 | 21.642 | 18.100 | 14 | 53.742 | -51.384
2026-11-01T10:17:24.455211+00:00 | 1706 | 15 | 38.116 | 105.126 | 21.642 | 18.100 | 14 | 53.742 | -51.384
2026-11-01T10:17:47.052998+00:00 | 1728 | 15 | 60.716 | 105.126 | 21.642 | 18.100 | 14 | 53.742 | -51.384
2026-11-01T10:17:56.252667+00:00 | 1737 | 0 | 69.900 | 105.126 | 21.642 | 18.100 | 14 | 53.742 | -51.384
2026-11-01T10:18:09.452675+00:00 | 1750 | 0 | 83.100 | 105.126 | 21.642 | 18.100 | 14 | 53.742 | -51.384
2026-11-01T10:18:22.553075+00:00 | 1763 | 15 | 96.200 | 105.126 | 21.642 | 18.100 | 14 | 53.742 | -51.384
2026-11-01T10:18:26.652917+00:00 | 1767 | 16 | 1.159 | None | 21.716 | 17.900 | None | None | None
2026-11-01T10:18:30.753192+00:00 | 1771 | 16 | 5.259 | None | 21.716 | 17.900 | None | None | None
2026-11-01T10:18:53.452959+00:00 | 1793 | 16 | 27.959 | None | 21.716 | 17.900 | None | None | None
2026-11-01T10:19:15.3537+00:00 | 1814 | 16 | 49.859 | None | 21.716 | 17.900 | None | None | None

Over meerdere finishovergangen veranderen sectoren en laatste rondetijd, maar hun som is geen laatste ronde. Ook blijven sectorduren vast terwijl de actuele rondetijd oploopt. Dit bewijst dat deze drie waarden niet als coherent laatste-rondetriplet bruikbaar zijn. Exact toeschrijven van elke sector aan een afzonderlijke ronde is met deze snapshots NIET bewijsbaar: bron-rondenummers ontbreken. De claim ‘uit verschillende ronden’ wordt daarom niet als bewezen gepresenteerd. Verkeerde splitsemantiek of bronvulling kan niet worden uitgesloten.

## 2. Snelheid in dezelfde snapshot

capturedAt | vehicle.speedKph | opponents[isPlayer].speedKph | ratio
---|---:|---:|---:
2026-11-01T10:14:04.153172+00:00 | 232.860 | 235.370 | 1.0108
2026-11-01T10:14:39.353137+00:00 | 91.300 | 92.162 | 1.0094
2026-11-01T10:15:15.852534+00:00 | 181.270 | 178.299 | 0.9836
2026-11-01T10:15:51.353036+00:00 | 191.340 | 191.752 | 1.0022
2026-11-01T10:16:26.553141+00:00 | 131.150 | 128.230 | 0.9777
2026-11-01T10:17:01.953166+00:00 | 188.770 | 188.528 | 0.9987
2026-11-01T10:17:37.752619+00:00 | 120.960 | 116.963 | 0.9670
(0, None)
2026-11-01T10:18:49.25284+00:00 | 117.840 | 113.476 | 0.9630
2026-11-01T10:19:24.454034+00:00 | 154.200 | 155.164 | 1.0062

Dezelfde orde en ratio nabij 1, niet 3,6: voor deze playerbron/rit ondersteunt dit km/h. Kleine verschillen zijn zichtbaar: dezelfde HTTP-snapshot bewijst niet dezelfde bron-tick. Geen bewijs voor stilstand, mph-instelling of de race-pc-assemblyhash; geen automatische conversie. Nieuwe rivalensnelheid blijft fail-closed tenzij een gelijktijdige player-unitcheck slaagt.

## 3. Volledige tegenstanderregel

Tijd: 2026-11-01T10:14:04.153172+00:00

```json
{
  "id": "Bart Tonkes",
  "lap": 14,
  "inPit": false,
  "carClass": null,
  "isPlayer": true,
  "position": 1,
  "speedKph": 235.37036290190167,
  "teamName": "Bart Tonkes",
  "carNumber": "64",
  "connected": true,
  "carClassId": "0",
  "driverName": "Bart Tonkes",
  "classPosition": 1,
  "bestLapSeconds": 104.38,
  "lapDistancePct": 0.4408785402774811,
  "lastLapSeconds": 110.765,
  "gapToLeaderSeconds": 0,
  "gapToPlayerSeconds": null
}
```

Tijdens deze capture staat alleen de player in de tegenstanderlijst. Een niet-player kon dus niet live worden bewezen.

## 4. Nieuwe getters en zelfcontrole

Opponent.LastLapSector1..3, BestLapSector1..3, BestSector1..3 en DeltaToBest/DeltaToPlayer worden door deze live plugin niet geëxporteerd. Hun runtimevulling is pas na een afzonderlijk goedgekeurde release te meten. Plugin en server controleren last/best-triplets tegen de bijbehorende rondetijd, absolute marge 0,1 s. Ontbrekend, niet-eindig, niet-positief of afwijkende som: triplet null, zichtbare mismatchteller. BestSector-minima zijn geen ronde en worden nooit als last/best-triplet gepresenteerd.

## Reproduceerbaarheid en grenzen

Query: SELECT jsonb_build_object(observedAt=clock_timestamp(), capturedAt=t.captured_at, sequence=t.sequence, data=t.v3_normalized) FROM public.simhub_telemetry_latest t JOIN public.simhub_devices d ON d.id=t.device_id WHERE upper(d.device_name)=PCBART (daadwerkelijke SQL gebruikt gequote veldnamen/waarden). Elke query in read-only transactie; 4 s wachttijd plus SSH/queryduur. Alleen nieuwste snapshots gelezen, geen historietabel of writes.

Live pg_get_functiondef read-only uitgelezen voor simhub_persist_v3, get_pitwall_data en get_simhub_device_details. Persist heeft exact acht argumenten, laatste drie DEFAULT NULL; retour TABLE(result text, received_at timestamptz, measurement_ack jsonb). Device-rowlock en replaycontrole zijn aanwezig.

Baseline: npx vitest run: 195 bestanden / 1638 tests PASS. Bestaand C#-harnas: 462 PASS / 1 FAIL: V24-3SM.EnduranceConnector verwacht 0.7.2.0 terwijl AssemblyInfo.cs reeds 0.7.2.1 meldt; vastgesteld vóór functionele edits.

PRODUCTIEWIJZIGING: NEE
