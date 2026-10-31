-- ============================================================================
-- Plugin 0.7.2.0 — veilige casts en foutisolatie per rij
-- Datum: 2026-10-31
-- Vorige migratie: 20261031190400_plugin08_lap_coverage.sql
-- Reviewpunt: 6 (veilige casts)
-- Status: voorstel. Niet toegepast op productie.
--
-- De validatie dekte niet alle casts: temperatuur en integralen hadden geen
-- eindigheids- of bereikcontrole, 'NaN' en 'Infinity' castten naar geldige float8,
-- en '1.0' passeerde de integervalidatie maar klapte op de tekstcast — waarna de
-- hele lapbatch werd verworpen.
--
-- Alle getallen lopen nu via één numerieke tekstvorm (simhub_jnumeric): geen NaN,
-- geen Infinity, en een integer-cast via numeric zodat 1.0 werkt. Bereiken worden
-- vóór de cast gecontroleerd. Elke rij zit in zijn eigen subtransactie, dus een rij
-- die toch faalt kost alleen die rij en staat met reden in het ACK-rapport.
-- Geen begin/commit: atomair te draaien met psql -1.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Veilige extractie: eindigheid en bereik vóór de cast
-- ---------------------------------------------------------------------------
-- De oude helpers castten de tekst van het JSON-getal rechtstreeks. PostgreSQL
-- accepteert 'NaN' en 'Infinity' als geldige float8, en '1.0' als tekst faalt
-- juist bij een cast naar integer. Beide zijn hier onmogelijk gemaakt: eerst
-- een numerieke tekstvorm controleren, dan pas casten.
create or replace function public.simhub_jnumeric(p jsonb)
returns numeric
language sql
immutable
strict
as $$
  select case
           when (p #>> '{}') ~ '^-?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$'
             then (p #>> '{}')::numeric
         end
$$;

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
  v_num numeric;
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
    -- Eén bron van waarheid voor getallen: de numerieke tekstvorm. 'NaN',
    -- 'Infinity' en '-Infinity' vallen hier af, net als elke andere rommel.
    v_num := public.simhub_jnumeric(p);
    if v_num is null then
      return false;
    end if;
    if v_num <> v_num then
      return false;
    end if;
    if p_kind in ('integer', 'bigint') and v_num <> trunc(v_num) then
      return false;
    end if;
    if p_kind = 'integer' and (v_num < -2147483648 or v_num > 2147483647) then
      return false;
    end if;
    if p_kind = 'bigint' and (v_num < -9007199254740991 or v_num > 9007199254740991) then
      return false;
    end if;
    -- Alles buiten het bereik van double precision bestaat niet als meting.
    if v_num < -1e308 or v_num > 1e308 then
      return false;
    end if;
    return (p_min is null or v_num >= p_min) and (p_max is null or v_num <= p_max);
  end if;

  if p_kind = 'timestamp' then
    v_text := p #>> '{}';
    if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
      return false;
    end if;
    begin
      v_ts := v_text::timestamptz;
    exception when others then
      return false;
    end;
    return v_ts between '2000-01-01T00:00:00Z'::timestamptz and '2100-01-01T00:00:00Z'::timestamptz;
  end if;

  if p_kind = 'uuid' then
    return public.simhub_juuid(p) is not null;
  end if;

  if p_kind = 'boolean' then
    return true;
  end if;

  return false;
end;
$$;

create or replace function public.simhub_jdouble(p jsonb)
returns double precision
language sql
immutable
strict
as $$ select public.simhub_jnumeric(p)::double precision $$;

create or replace function public.simhub_jint(p jsonb)
returns integer
language sql
immutable
strict
as $$ select public.simhub_jnumeric(p)::integer $$;

create or replace function public.simhub_jbigint(p jsonb)
returns bigint
language sql
immutable
strict
as $$ select public.simhub_jnumeric(p)::bigint $$;

create or replace function public.simhub_jtext(p jsonb)
returns text
language sql
immutable
strict
as $$ select btrim(p #>> '{}') $$;

create or replace function public.simhub_jtimestamptz(p jsonb)
returns timestamptz
language sql
immutable
strict
as $$
  select case
           when (p #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
             then (p #>> '{}')::timestamptz
         end
$$;

create or replace function public.simhub_jbool(p jsonb)
returns boolean
language sql
immutable
strict
as $$ select case when jsonb_typeof(p) = 'boolean' then (p #>> '{}')::boolean end $$;

revoke all on function public.simhub_jnumeric(jsonb) from public, anon, authenticated;
revoke all on function public.simhub_jvalid(jsonb, text, double precision, double precision) from public, anon, authenticated;
revoke all on function public.simhub_jdouble(jsonb) from public, anon, authenticated;
revoke all on function public.simhub_jint(jsonb) from public, anon, authenticated;
revoke all on function public.simhub_jbigint(jsonb) from public, anon, authenticated;
revoke all on function public.simhub_jtext(jsonb) from public, anon, authenticated;
revoke all on function public.simhub_jtimestamptz(jsonb) from public, anon, authenticated;
revoke all on function public.simhub_jbool(jsonb) from public, anon, authenticated;
grant execute on function public.simhub_jnumeric(jsonb) to service_role;
grant execute on function public.simhub_jvalid(jsonb, text, double precision, double precision) to service_role;
grant execute on function public.simhub_jdouble(jsonb) to service_role;
grant execute on function public.simhub_jint(jsonb) to service_role;
grant execute on function public.simhub_jbigint(jsonb) to service_role;
grant execute on function public.simhub_jtext(jsonb) to service_role;
grant execute on function public.simhub_jtimestamptz(jsonb) to service_role;
grant execute on function public.simhub_jbool(jsonb) to service_role;

-- De schrijver zelf is sinds 20261031190200 rij-per-rij geïsoleerd en gebruikt
-- voor ieder getal simhub_jvalid vóór de cast; deze migratie hardt alleen de
-- helpers. De functie blijft daarom ongewijzigd.
comment on function public.simhub_jvalid(jsonb, text, double precision, double precision) is
  'Interne validatie: ontbrekend of null is goed; aanwezig maar onleesbaar, niet-eindig of buiten bereik is fout. Nooit een exception.';
comment on function public.simhub_jnumeric(jsonb) is
  'Numerieke tekstvorm van een JSON-getal, of null. Weigert NaN, Infinity en alle niet-numerieke vormen.';
