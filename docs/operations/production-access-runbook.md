# Productie DB-toegang (Self-hosted Supabase)

## Overzicht

3SM productie Supabase is **self-hosted Docker** op de **3sm-docker** LXC (192.168.50.23).

**Cloud Supabase endpoints (`supabase.co`) worden niet gebruikt voor DB-migraties.**  
De `/sql` REST endpoint op de custom domain (`api.3stripemotorsport.cc`) geeft 401 met de service key — dat is de verwachte configuratie voor deze self-hosted setup.

## SSH-toegang

```
Host 3sm-docker
  HostName 192.168.50.23
  User root
  IdentityFile ~/.ssh/hermes_3sm_ed25519
  IdentitiesOnly yes
```

## PostgreSQL-container

| Onderdeel | Waarde |
|---|---|
| Container | `supabase-db` |
| Image | `supabase/postgres:15.8.1.085` |
| User (migraties) | `supabase_admin` |
| Database | `postgres` |
| SSL | Niet nodig via `docker exec` |

## Basis read-only verificatie

```bash
# DB identiteit
ssh 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d postgres -Atc \"SELECT version();\""

# Telfuncties (SECDEF RPCs)
ssh 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d postgres -Atc \"SELECT count(*) FROM pg_proc WHERE prosecdef=true;\""

# Check of een functie bestaat
ssh 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d postgres -Atc \"SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname='get_pitwall_data');\""
```

## Een functiedefinitie inspecteren

```bash
ssh 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d postgres -Atc \"SELECT pg_get_functiondef(p.oid) FROM pg_proc p WHERE p.proname='get_pitwall_data';\""
```

## Migratie uitvoeren

1. Maak een backup/snapshot (zie Backup & Rollback)
2. Pipe de SQL naar psql:

```bash
cat supabase/migrations/20260904110000_pitwall_v1_read_rpc.sql | ssh 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d postgres"
```

3. Verifieer dat de functie correct is aangemaakt:

```bash
ssh 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d postgres -Atc \"SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname='get_pitwall_data');\""
```

## Rollback

```bash
echo "DROP FUNCTION IF EXISTS public.get_pitwall_data(uuid, uuid);" | ssh 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d postgres"
```

## Backup & Snapshot

Voor elke productie DDL-wijziging:

```bash
ssh 3sm-docker "docker exec -i supabase-db pg_dump -U supabase_admin -d postgres --schema-only --no-owner -f /tmp/pre-migration-schema-$(date +%Y%m%d).sql"
```

Optioneel full backup:

```bash
ssh 3sm-docker "docker exec -i supabase-db pg_dump -U supabase_admin -d postgres --no-owner -f /tmp/pre-migration-full-$(date +%Y%m%d).sql"
```

## identiteitskenmerken productie-DB (ter verificatie)

| Kenmerk | Waarde |
|---|---|
| PostgreSQL | 15.8 |
| Systeem-ID | 7618318406906855462 |
| Public tabellen | 64 |
| RLS policies | 154 |
| SECURITY DEFINER RPCs | 88 |
| Supabase project ref | cwwfriypwdluynajubhz |

## Wat NIET doen

- Geen Supabase PAT of database-password vragen — de interne Docker path werkt
- Geen `/sql` REST endpoint gebruiken voor DDL — dit endpoint geeft 401 op self-hosted
- Geen Docker container stoppen/herstarten voor migraties
- Geen service keys in commits of docs opslaan