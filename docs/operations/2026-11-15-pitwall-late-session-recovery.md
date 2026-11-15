# Pitwall: late eerste telemetriepakketten herstellen

## Probleem en beperkte oplossing

Een nieuwe plugin-verzendsessie kan de eerste pakketten missen terwijl de frameteller wel doorloopt. De oude `simhub_persist_v3`-guard weigerde vervolgens iedere onbekende sessie met sequence > 5, ook wanneer het eerdere proces al dagen niets had verzonden. Een recente health-heartbeat verhulde dat core-telemetrie met HTTP 409 bleef steken.

Migratie: `20261115201044_simhub_late_new_session_recovery.sql`.
Rollback: `supabase/rollback/20261115201044_simhub_late_new_session_recovery.rollback.sql`.

De uitzondering voor een laat eerste pakket vereist alle volgende feiten:

- het apparaat is geauthenticeerd, niet ingetrokken en niet rate-limited;
- de vorige zender heeft minimaal vijf seconden geen geaccepteerd frame gestuurd;
- er is een geldige vorige client-opnametijd in de opgeslagen V3-snapshot;
- de nieuwe opnametijd is strikt later dan die vorige client-opnametijd;
- het nieuwe pakket ligt binnen 120 seconden van de serverklok, in beide richtingen.

Tellers van bekende sessies, sessieretentie, actuele-zenderbescherming, routing, meet-ACKs, observation-policy, eigendom en grants blijven behouden. Een onbekende of beschadigde oude opnametijd levert geen verzonnen toestemming op. Client-opnametijden worden met elkaar vergeleken; een beperkte negatieve client-klokafwijking mag geen nieuwe permanente blokkade veroorzaken.

Geen pluginwijziging of procesherstart vereist. Geen tabel/kolom/policy toegevoegd of gewijzigd; één bestaande DB-functie krijgt een nieuwe body, met exact dezelfde signature, eigenaar, SECURITY DEFINER, search_path en ACL. Geen frontendcodewijziging voor deze sessiefix.

## Bewijs en uitrol

- Werkboom: `fix/pitwall-session-road-america-20261115`, basis `cf039de7639dc6ee9546447e59bd4523c518a6da`.
- Baseline: het echte publieke RPC weigert de regressie `late_first_frame_1700_recovers` met `replayed`.
- `supabase/tests/simhub-late-new-session-recovery.sql`: 23 assertions tegen het echte publieke RPC en de volledige productieschema-afhankelijkheden, inclusief duplicaten, oudere tellers, concurrerende actieve zenders, klokafwijking, oude/toekomstige timestamps, corrupte/missende snapshots, intrekking, onbevoegde claims en 64-sessieretentie.
- Exacte forward- en rollbackbestanden zijn binnen één omvattende teruggedraaide transactie uitgevoerd; functiedefinitie, ACL/eigenaar/security-config en nul resterende synthetische devices daarna gecontroleerd.
- De synthetische devices gebruiken een bestaand owner-FK uitsluitend binnen de teruggedraaide transactie. Dit zijn geen echte ritten of nauwkeurigheidsproeven. De tests eindigen altijd met ROLLBACK; met `ON_ERROR_STOP` beëindigt een fout de sessie en draait de open transactie terug.
- Voorbeeld: `ssh 3sm-docker 'docker exec -i supabase-db psql -X -q -At -v ON_ERROR_STOP=1 -U supabase_admin -d postgres' < supabase/tests/simhub-late-new-session-recovery.sql`.
- Migratie en rollback bewaken de exacte preimage via `md5(pg_get_functiondef(...))`; bij runtime-drift stoppen in plaats van een oudere body over productie te zetten.
- Beschermde bewijsbestanden: `/home/hermes/artifacts/3sm/pitwall-session-road-america-20261115/`. Geen credentials in bewijs of repository opslaan.

Na daadwerkelijke uitrol: herhaal de 23 assertions op de geïnstalleerde publieke functie en controleer afzonderlijk echte clientpakketten: verse ontvangst, oplopende sequence, juiste huidige TrackID/baan en HTTP 202. Een server-readback bewijst niet op zichzelf dat een geopende browser visueel gecontroleerd is.

## Uitgerold en teruggelezen

Op expliciete toestemming is de forward-migratie toegepast zonder service- of SimHub-herstart. De geïnstalleerde definitie heeft MD5 `e15ef4a7bde6e876e835c406696283c6`; eigenaar, ACL, SECURITY DEFINER en search_path zijn onveranderd. Alle 23 assertions zijn daarna opnieuw tegen de werkelijk geïnstalleerde publieke functie geslaagd, zonder resterende synthetische devices.

Beschermde productieback-up en rollback: `/opt/supabase/backups/pitwall-session-recovery-20261115201044` op `3sm-docker`. Echte PCBART-pakketten op 2026-11-15 om 20:18:37–20:18:41 UTC: TrackID 596 / `roadamerica 2026 full`, in de auto, verse ontvangst, sequence 3221 → 3224, HTTP 202. Dit bewijst de doorlopende bestaande clientverbinding na uitrol; de herstelde late sessiestart zelf is afzonderlijk met de synthetische regressie bewezen.
