-- ============================================================================
-- Test voor 20261031130000_pitwall_prior_pool_privacy.sql
--
--   A. authenticated mag tyre_prior(text, text, uuid) niet meer uitvoeren (42501)
--      en pitwall_prior_v1(text, text) wel.
--   B. De wrapper sluit het eigen apparaat zelf uit: dezelfde cel geeft een
--      andere uitkomst voor twee aanroepers, zonder dat iemand een apparaat
--      meegeeft.
--   C. Publiceren pas bij 2 accounts en 2 stints: één account geeft thin_pool
--      en een grover level; twee accounts geven level exact en accounts = 2.
--   D. Geen apparaat, sessie of naam in de uitvoer.
--
-- Draai als één transactie met ROLLBACK; er blijft niets achter.
--
--   ssh 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1" \
--     < supabase/tests/20261031130000_pitwall_prior_pool_privacy.sql
-- ============================================================================

begin;

create function pg_temp.eis(p_naam text, p_ok boolean) returns void
language plpgsql as $$
begin
  if p_ok is not true then
    raise exception 'FAIL: %', p_naam;
  end if;
  raise notice 'PASS: %', p_naam;
end $$;

-- Een gesloten stint van n rondes met een vaste helling per ronde.
create function pg_temp.stint(p_device uuid, p_session text, p_auto text, p_baan text,
                              p_rate numeric, p_rondes integer, p_start timestamptz)
returns void language sql as $$
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, car_key, track_key, captured_at)
  select p_device, 'test', p_session, g, 1,
         100 - g * p_rate, 100 - g * p_rate, 100 - g * p_rate, 100 - g * p_rate,
         p_auto, p_baan, p_start + (g || ' minutes')::interval
    from generate_series(1, p_rondes) g;
$$;

-- De sessie sluiten: één ronde in een nieuwe sessie. Daarna telt de stint mee.
create function pg_temp.sluit(p_device uuid, p_auto text, p_baan text, p_start timestamptz)
returns void language sql as $$
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, car_key, track_key, captured_at)
  values (p_device, 'test', 'sluit-' || gen_random_uuid(), 1, 1,
          100, 100, 100, 100, p_auto, p_baan, p_start + interval '3 hours');
$$;

do $test$
declare
  v_cat_a   constant uuid := '290fe152-5789-448c-8420-8deb3cf3077f';  -- CAT-PC (leeg), eigendom 103daeb3
  v_ricky   constant uuid := '9da43e1d-1e06-42ac-9178-9532f842a353';  -- RICKY, eigendom 3cf38c92
  v_desk    constant uuid := '81222914-3ad7-43db-b5eb-27c246ba1381';  -- DESKTOP-GR4NN00, eigendom 137e6307
  v_owner_cat   constant uuid := '103daeb3-9f46-4d79-a0a1-c460e43ed3b7';
  v_owner_ricky constant uuid := '3cf38c92-5e18-4e1b-925a-4256f17354ae';
  v_auto    constant text := 'wrapcar';
  v_baan    constant text := 'wrap:gp';
  v_t       constant timestamptz := timestamptz '2027-01-01 08:00:00+00';
  v_p       jsonb;
  v_tekst   text;
begin
  --------------------------------------------------------------------------
  -- A. De deur: authenticated kan tyre_prior() niet meer, de wrapper wel
  --------------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_owner_cat::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  perform pg_temp.eis('authenticated heeft geen EXECUTE op tyre_prior(text, text, uuid)',
                      not has_function_privilege('authenticated',
                        'public.tyre_prior(text, text, uuid)', 'EXECUTE'));
  perform pg_temp.eis('authenticated heeft geen EXECUTE op tyre_prior_core',
                      not has_function_privilege('authenticated',
                        'public.tyre_prior_core(text, text, uuid[])', 'EXECUTE'));
  perform pg_temp.eis('authenticated heeft EXECUTE op pitwall_prior_v1',
                      has_function_privilege('authenticated',
                        'public.pitwall_prior_v1(text, text)', 'EXECUTE'));

  -- Echte aanroep als authenticated: moet op 42501 stuklopen.
  set local role authenticated;
  begin
    perform public.tyre_prior('porsche992rgt3', '465:fullcourse', v_cat_a);
    raise exception 'FAIL: tyre_prior() ging door als authenticated';
  exception
    when insufficient_privilege then
      raise notice 'PASS: tyre_prior() geeft 42501 voor authenticated';
  end;
  -- En de wrapper werkt in dezelfde rol.
  perform public.pitwall_prior_v1('porsche992rgt3', '465:fullcourse');
  raise notice 'PASS: pitwall_prior_v1() is uitvoerbaar als authenticated';
  reset role;

  --------------------------------------------------------------------------
  -- C. Publiceren pas bij twee accounts
  --------------------------------------------------------------------------
  -- Eerst één account (RICKY) op een verse cel.
  perform pg_temp.stint(v_ricky, 'wrap-1', v_auto, v_baan, 0.5, 6, v_t);
  perform pg_temp.sluit(v_ricky, v_auto, v_baan, v_t);
  perform public.tyre_prior_sync_session(v_ricky, 'wrap-1');

  v_p := public.pitwall_prior_v1(v_auto, v_baan);   -- als CAT-PC-eigenaar
  perform pg_temp.eis('één account: geen publicatie van de cel',
                      (v_p->>'publicatie')::boolean = false);
  perform pg_temp.eis('één account: thin_pool staat aan',
                      (v_p->>'thin_pool')::boolean = true);
  perform pg_temp.eis('één account: de functie valt terug op de trap erboven',
                      v_p->>'level' = 'algemeen');
  perform pg_temp.eis('één account: accounts telt alleen de andere eigenaar',
                      (v_p->>'accounts')::integer >= 1);

  -- Nu een tweede account op dezelfde cel.
  perform pg_temp.stint(v_desk, 'wrap-2', v_auto, v_baan, 0.45, 6, v_t);
  perform pg_temp.sluit(v_desk, v_auto, v_baan, v_t);
  perform public.tyre_prior_sync_session(v_desk, 'wrap-2');

  v_p := public.pitwall_prior_v1(v_auto, v_baan);
  perform pg_temp.eis('twee accounts: de cel wordt gepubliceerd (level exact)',
                      v_p->>'level' = 'exact');
  perform pg_temp.eis('twee accounts: publicatie = true',
                      (v_p->>'publicatie')::boolean = true);
  perform pg_temp.eis('twee accounts: thin_pool staat uit',
                      (v_p->>'thin_pool')::boolean = false);
  -- `accounts` telt de eigenaren achter de hele pool die het getal draagt
  -- (exact + de grovere traps), niet alleen de cel. De cel zelf heeft er twee:
  -- dat staat hiernaast direct in de boekhouding.
  perform pg_temp.eis('twee accounts: accounts telt minstens de twee van de cel',
                      (v_p->>'accounts')::integer >= 2);
  perform pg_temp.eis('twee accounts: de cel heeft precies twee eigenaren',
                      (select count(distinct d.owner_user_id)
                         from public.tyre_prior_contrib c
                         join public.simhub_devices d on d.id = c.device_id
                        where c.car_key = v_auto and c.track_key = v_baan) = 2);
  perform pg_temp.eis('twee accounts: er is een gedeelde helling',
                      (v_p->>'rate')::numeric > 0);
  perform pg_temp.eis('twee accounts: de bron noemt geen apparaat of naam',
                      position('9da43e1d' in (v_p->>'bron')) = 0
                      and position('81222914' in (v_p->>'bron')) = 0);

  --------------------------------------------------------------------------
  -- B. De uitsluiting hangt aan de aanroeper, niet aan een parameter
  --------------------------------------------------------------------------
  -- RICKY roept dezelfde cel aan. Na uitsluiting van zijn apparaten blijft er
  -- één account over (DESKTOP-GR4NN00) en dus geen publicatie.
  perform set_config('request.jwt.claim.sub', v_owner_ricky::text, true);
  v_p := public.pitwall_prior_v1(v_auto, v_baan);
  perform pg_temp.eis('RICKY ziet zijn eigen cel niet gepubliceerd (1 andere account)',
                      (v_p->>'publicatie')::boolean = false
                      and (v_p->>'thin_pool')::boolean = true);
  perform pg_temp.eis('dezelfde cel, andere aanroeper: andere publicatie',
                      (public.pitwall_prior_v1(v_auto, v_baan)->>'publicatie')::boolean = false);

  --------------------------------------------------------------------------
  -- D. Geen apparaat in de uitvoer
  --------------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_owner_cat::text, true);
  v_tekst := public.pitwall_prior_v1('porsche992rgt3', '465:fullcourse')::text;
  perform pg_temp.eis('geen apparaat-id in de uitvoer van de wrapper',
                      position('8ea3fe36' in v_tekst) = 0
                      and position('7e748fad' in v_tekst) = 0
                      and position('e90ad2ca' in v_tekst) = 0);
  perform pg_temp.eis('geen sessiesleutel in de uitvoer van de wrapper',
                      position('simhub-' in v_tekst) = 0);
end $test$;

rollback;
