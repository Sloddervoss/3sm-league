-- Gedragstest voor 20261027090000_profile_team_assignment_rpc.sql.
--
-- Draait in een transactie en sluit af met ROLLBACK: er blijft niets staan.
--   psql "$DATABASE_URL" -f supabase/tests/20261027090000_profile_team_assignment_rpc.sql
--
-- Wat deze test bewijst (gedrag, geen string-guards):
--   1. join_team en admin_set_team laten geen membership van een ander team
--      achter: één team per gebruiker;
--   2. admin_set_team(user, null) wist alle memberships van die gebruiker;
--   3. een iracing_id claimen die al van iemand anders is geeft een harde fout
--      (iracing_id_in_use), en NULL ontkoppelt;
--   4. self-service ratings zijn begrensd op 0..5000 en SR 0..5.00;
--   5. na de import (rating_source = 'imported') laat self-service de ratings
--      staan, terwijl iracing_id koppelen/ontkoppelen blijft werken;
--   6. de tabelgrants zijn dicht: alleen de zelfservice-kolommen zijn nog
--      schrijfbaar en team_memberships is niet meer rechtstreeks schrijfbaar.
--
-- De test leent bestaande profielen (profielen hangen aan auth.users) en maakt
-- alleen eigen teams en rollen aan, die met de ROLLBACK verdwijnen.

\set ON_ERROR_STOP on

begin;

-- 1 en 2: één team per gebruiker ------------------------------------------------
do $team$
declare
  v_me      uuid;
  v_other   uuid;
  v_team_a  uuid;
  v_team_b  uuid;
  v_rows    integer;
  v_team    uuid;
  v_on_team_b boolean;
begin
  select profile.user_id into v_me from public.profiles as profile order by profile.user_id limit 1;
  select profile.user_id into v_other from public.profiles as profile
   where profile.user_id <> v_me order by profile.user_id limit 1;

  if v_me is null or v_other is null then
    raise exception 'test heeft twee bestaande profielen nodig';
  end if;

  insert into public.teams (name) values ('RPC-test A ' || md5(random()::text)) returning id into v_team_a;
  insert into public.teams (name) values ('RPC-test B ' || md5(random()::text)) returning id into v_team_b;

  perform set_config('request.jwt.claim.sub', v_me::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_me)::text, true);

  -- Zelf joinen: team A, daarna team B. De oude membership moet verdwijnen.
  perform public.join_team(v_team_a);
  perform public.join_team(v_team_b);

  select count(*), bool_and(membership.team_id = v_team_b) into v_rows, v_on_team_b
  from public.team_memberships as membership
  where membership.user_id = v_me;

  if v_rows <> 1 or v_on_team_b is not true then
    raise exception 'join_team liet % memberships achter, verwacht 1 membership op team B', v_rows;
  end if;

  select profile.team_id into v_team from public.profiles as profile where profile.user_id = v_me;
  if v_team <> v_team_b then
    raise exception 'profiles.team_id (%) wijst niet naar team B (%)', v_team, v_team_b;
  end if;

  -- Beheerder zet een ander lid van team A naar team B: ook daar één membership.
  insert into public.user_roles (user_id, role) values (v_me, 'admin')
  on conflict do nothing;

  perform public.admin_set_team(v_other, v_team_a);
  perform public.admin_set_team(v_other, v_team_b);

  select count(*), bool_and(membership.team_id = v_team_b) into v_rows, v_on_team_b
  from public.team_memberships as membership
  where membership.user_id = v_other;

  if v_rows <> 1 or v_on_team_b is not true then
    raise exception 'admin_set_team liet % memberships achter, verwacht 1 membership op team B', v_rows;
  end if;

  -- Ontkoppelen via de beheerder: alles weg, ook een eventueel restant.
  insert into public.team_memberships (user_id, team_id) values (v_other, v_team_a)
  on conflict do nothing;
  perform public.admin_set_team(v_other, null);

  select count(*) into v_rows from public.team_memberships as membership where membership.user_id = v_other;
  if v_rows <> 0 then
    raise exception 'admin_set_team(..., null) liet % memberships staan', v_rows;
  end if;

  select profile.team_id into v_team from public.profiles as profile where profile.user_id = v_other;
  if v_team is not null then
    raise exception 'admin_set_team(..., null) liet profiles.team_id op % staan', v_team;
  end if;

  -- Zelf verlaten: dezelfde ene schrijfweg, en ook dan blijft er niets achter.
  perform set_config('request.jwt.claim.sub', v_me::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_me)::text, true);
  perform public.leave_team();

  select count(*) into v_rows from public.team_memberships as membership where membership.user_id = v_me;
  if v_rows <> 0 then
    raise exception 'leave_team liet % memberships staan', v_rows;
  end if;

  select profile.team_id into v_team from public.profiles as profile where profile.user_id = v_me;
  if v_team is not null then
    raise exception 'leave_team liet profiles.team_id op % staan', v_team;
  end if;

  -- Onbekend team: geen halve toewijzing.
  begin
    perform public.join_team('00000000-0000-4000-8000-000000000000');
    raise exception 'join_team accepteerde een onbekend team';
  exception
    when foreign_key_violation then null;
  end;
end;
$team$;

-- 3, 4 en 5: iracing_id, ratinggrenzen en rating-herkomst ------------------------
do $ratings$
declare
  v_me        uuid;
  v_other     uuid;
  v_admin     uuid;
  v_claimed   text;
  v_irating   integer;
  v_sr        text;
  v_source    text;
  v_stamp     timestamptz;
begin
  select profile.user_id into v_me from public.profiles as profile order by profile.user_id limit 1;
  select profile.user_id into v_other from public.profiles as profile
   where profile.user_id <> v_me order by profile.user_id limit 1;
  select role_row.user_id into v_admin from public.user_roles as role_row
   where role_row.role in ('admin', 'super_admin') order by role_row.user_id limit 1;

  if v_admin is null then
    raise exception 'test heeft een beheerder nodig (user_roles)';
  end if;

  -- Een customer ID die nog nergens staat.
  select candidate.id into v_claimed
  from (select '99' || lpad(((random() * 100000000)::bigint)::text, 9, '0') as id) as candidate
  where not exists (select 1 from public.profiles as profile where profile.iracing_id = candidate.id);
  if v_claimed is null then
    raise exception 'kon geen vrije iracing_id vinden';
  end if;

  perform set_config('request.jwt.claim.sub', v_me::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_me)::text, true);

  -- Zelf invullen mag, en blijft herkomst 'self'.
  perform public.update_own_racing_profile(v_claimed, 3450, 'A 4.50');

  select profile.rating_source, profile.irating, profile.safety_rating, profile.rating_updated_at
    into v_source, v_irating, v_sr, v_stamp
  from public.profiles as profile where profile.user_id = v_me;

  if v_source <> 'self' or v_irating <> 3450 or v_sr <> 'A 4.50' or v_stamp is null then
    raise exception 'self-service ratings niet opgeslagen zoals verwacht: source=%, irating=%, sr=%, stamp=%',
      v_source, v_irating, v_sr, v_stamp;
  end if;

  -- Een ander mag die ID niet claimen.
  perform set_config('request.jwt.claim.sub', v_other::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);

  begin
    perform public.update_own_racing_profile(v_claimed, 1200, 'D 2.00');
    raise exception 'claimen van een bezette iracing_id (%) werd toegestaan', v_claimed;
  exception
    when unique_violation then
      if position('iracing_id_in_use' in sqlerrm) = 0 then
        raise exception 'conflict gaf wel 23505 maar zonder duidelijke melding: %', sqlerrm;
      end if;
  end;

  -- Grenzen van self-service.
  begin
    perform public.update_own_racing_profile(null, 5001, 'A 4.50');
    raise exception 'iRating 5001 werd toegestaan bij self-service';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform public.update_own_racing_profile(null, 1200, 'A 5.01');
    raise exception 'Safety Rating 5.01 werd toegestaan bij self-service';
  exception
    when invalid_parameter_value then null;
  end;

  -- De import is eigenaar: die zet rating_source op 'imported'.
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  perform public.admin_update_driver_ratings(v_me, 5100, 'A 4.99');

  select profile.rating_source, profile.irating into v_source, v_irating
  from public.profiles as profile where profile.user_id = v_me;
  if v_source <> 'imported' or v_irating <> 5100 then
    raise exception 'import zette rating_source=% en irating=% (verwacht imported/5100)', v_source, v_irating;
  end if;

  -- Self-service mag een geïmporteerde rating niet overschrijven, maar
  -- ontkoppelen (NULL) moet blijven werken.
  perform set_config('request.jwt.claim.sub', v_me::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_me)::text, true);
  perform public.update_own_racing_profile(null, 900, 'D 1.00');

  select profile.iracing_id, profile.rating_source, profile.irating, profile.safety_rating
    into v_claimed, v_source, v_irating, v_sr
  from public.profiles as profile where profile.user_id = v_me;

  if v_claimed is not null then
    raise exception 'ontkoppelen liet iracing_id % staan', v_claimed;
  end if;
  if v_source <> 'imported' or v_irating <> 5100 or v_sr <> 'A 4.99' then
    raise exception 'self-service overschreef een geïmporteerde rating: source=%, irating=%, sr=%',
      v_source, v_irating, v_sr;
  end if;

  -- Opnieuw koppelen na de import blijft toegestaan.
  perform public.update_own_racing_profile('990000000001', null, null);
  select profile.iracing_id into v_claimed from public.profiles as profile where profile.user_id = v_me;
  if v_claimed <> '990000000001' then
    raise exception 'koppelen na de import mislukte (iracing_id=%)', v_claimed;
  end if;
end;
$ratings$;

-- 6: de tabelgrants en de index --------------------------------------------------
do $grants$
declare
  v_me     uuid;
  v_team   uuid;
begin
  select profile.user_id into v_me from public.profiles as profile order by profile.user_id limit 1;
  select team.id into v_team from public.teams as team limit 1;

  if v_me is null or v_team is null then
    raise exception 'test heeft een profiel en een team nodig';
  end if;

  perform set_config('request.jwt.claim.sub', v_me::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_me)::text, true);
  perform set_config('role', 'authenticated', true);

  -- Zelfservice-kolom: mag.
  update public.profiles set display_name = display_name where user_id = v_me;

  -- Alles wat met team, Discord of ratings te maken heeft: mag niet meer.
  begin
    update public.profiles set team_id = v_team where user_id = v_me;
    raise exception 'team_id was rechtstreeks schrijfbaar voor authenticated';
  exception
    when insufficient_privilege then null;
  end;

  begin
    update public.profiles set discord_id = '999' where user_id = v_me;
    raise exception 'discord_id was rechtstreeks schrijfbaar voor authenticated';
  exception
    when insufficient_privilege then null;
  end;

  begin
    update public.profiles set irating = 4000 where user_id = v_me;
    raise exception 'irating was rechtstreeks schrijfbaar voor authenticated';
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into public.team_memberships (user_id, team_id) values (v_me, v_team);
    raise exception 'team_memberships was rechtstreeks schrijfbaar voor authenticated';
  exception
    when insufficient_privilege then null;
  end;

  perform set_config('role', 'postgres', true);

  -- De index is de harde grens onder de EXISTS-check in de RPC: uniek en
  -- partiëel, zodat meerdere profielen zonder iracing_id mogen blijven bestaan.
  if not exists (
    select 1
    from pg_index as index_row
    join pg_class as index_class on index_class.oid = index_row.indexrelid
    where index_class.relname = 'profiles_iracing_id_uniq'
      and index_row.indisunique
      and pg_get_indexdef(index_row.indexrelid) like '%WHERE (iracing_id IS NOT NULL)%'
  ) then
    raise exception 'partiële unieke index profiles_iracing_id_uniq ontbreekt of is niet partiëel';
  end if;
end;
$grants$;

rollback;
