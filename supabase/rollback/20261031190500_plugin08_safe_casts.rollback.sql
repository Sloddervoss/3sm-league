-- Rollback van 20261031190500_plugin08_safe_casts.sql
-- Gegevensbehoudend: er wordt geen enkele meetrij verwijderd. Wat teruggaat is
-- code en, waar nodig, een constraint. De tabellen en hun inhoud blijven staan,
-- zodat een review of een latere herkansing de gegevens niet kwijt is.
--
-- De oude, onveilige extractie komt terug: rechtstreekse tekstcasts die 'NaN',
-- 'Infinity' en '1.0'-naar-integer weer toelaten. Dit is met opzet een slechtere
-- toestand; de rollback bestaat alleen om de keten sluitend te maken.
-- Volgorde: altijd van nieuw naar oud terugdraaien (190800 eerst).
-- Geen begin/commit: atomair te draaien met psql -1.
-- ============================================================================

-- De oude definities staan in 20261031180300 en worden hier letterlijk
-- herhaald: een rollback mag niet van een ander bestand afhangen.
-- simhub_persist_measurement_batch gebruikt.
create or replace function public.simhub_jvalid(
  p jsonb,
  p_kind text,
  p_min double precision default null,
  p_max double precision default null)
returns boolean
language plpgsql
immutable
as $$
declare
  v_text text;
  v_num double precision;
  v_ts timestamptz;
begin
  -- Ontbrekend (SQL null) of expliciet JSON null: niets te keuren.
  if p is null or p = 'null'::jsonb then
    return true;
  end if;

  if p_kind in ('string', 'uuid', 'timestamp') and jsonb_typeof(p) <> 'string' then
    return false;
  end if;
  if p_kind in ('number', 'integer', 'bigint') and jsonb_typeof(p) <> 'number' then
    return false;
  end if;
  if p_kind = 'boolean' and jsonb_typeof(p) <> 'boolean' then
    return false;
  end if;

  if p_kind = 'string' then
    v_text := btrim(p #>> '{}');
    return char_length(v_text) between coalesce(p_min, 1)::integer and coalesce(p_max, 64)::integer;
  end if;

  if p_kind in ('number', 'integer', 'bigint') then
    begin
      v_num := (p #>> '{}')::double precision;
    exception when others then
      return false;
    end;
    -- 'NaN'/'Infinity' zijn geldige invoer voor ::double precision en zouden
    -- elk gemiddelde vergiftigen. Ze zijn hier geen meting.
    if v_num is null
       or v_num = 'NaN'::double precision
       or v_num = 'Infinity'::double precision
       or v_num = '-Infinity'::double precision then
      return false;
    end if;
    if p_kind in ('integer', 'bigint') and v_num <> trunc(v_num) then
      return false;
    end if;
    if p_kind = 'integer' and v_num not between -2147483648 and 2147483647 then
      return false;
    end if;
    if p_kind = 'bigint' and v_num not between -9007199254740991 and 9007199254740991 then
      return false;
    end if;
    return (p_min is null or v_num >= p_min) and (p_max is null or v_num <= p_max);
  end if;

  if p_kind = 'timestamp' then
    v_text := p #>> '{}';
    -- Alleen ISO-8601 met zone. Een tijd zonder zone is geen tijd: de kolom is
    -- timestamptz en de lokale klok van een Windows-pc is geen waarnemingstijd.
    if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
      return false;
    end if;
    begin
      v_ts := v_text::timestamptz;
    exception when others then
      return false;
    end;
    -- Alles buiten 2000-2100 is geen meting van deze eeuw en dus rommel.
    return v_ts between '2000-01-01T00:00:00Z'::timestamptz and '2100-01-01T00:00:00Z'::timestamptz;
  end if;

  if p_kind = 'uuid' then
    begin
      perform (p #>> '{}')::uuid;
    exception when others then
      return false;
    end;
    return true;
  end if;

  if p_kind = 'boolean' then
    return true;
  end if;

  -- Onbekende soort: nooit stil goedkeuren.
  return false;
end;
$$;

create or replace function public.simhub_jtext(p jsonb)
returns text
language sql
immutable
strict
as $$ select btrim(p #>> '{}') $$;

create or replace function public.simhub_jdouble(p jsonb)
returns double precision
language sql
immutable
strict
as $$ select (p #>> '{}')::double precision $$;

create or replace function public.simhub_jint(p jsonb)
returns integer
language sql
immutable
strict
as $$ select (p #>> '{}')::integer $$;

create or replace function public.simhub_jbigint(p jsonb)
returns bigint
language sql
immutable
strict
as $$ select (p #>> '{}')::bigint $$;

create or replace function public.simhub_juuid(p jsonb)
returns uuid
language sql
immutable
strict
as $$ select (p #>> '{}')::uuid $$;

create or replace function public.simhub_jtimestamptz(p jsonb)
returns timestamptz
language sql
immutable
strict
as $$ select (p #>> '{}')::timestamptz $$;

create or replace function public.simhub_jbool(p jsonb)
returns boolean
language sql
immutable
strict
as $$ select (p #>> '{}')::boolean $$;


revoke all on function public.simhub_jvalid(jsonb, text, double precision, double precision) from public, anon, authenticated;
revoke all on function public.simhub_jtext(jsonb) from public, anon, authenticated;
revoke all on function public.simhub_jdouble(jsonb) from public, anon, authenticated;
revoke all on function public.simhub_jint(jsonb) from public, anon, authenticated;
revoke all on function public.simhub_jbigint(jsonb) from public, anon, authenticated;
revoke all on function public.simhub_juuid(jsonb) from public, anon, authenticated;
revoke all on function public.simhub_jtimestamptz(jsonb) from public, anon, authenticated;
revoke all on function public.simhub_jbool(jsonb) from public, anon, authenticated;

