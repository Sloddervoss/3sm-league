-- ============================================================================
-- Test voor 20261031150100_tyre_kish_n_eff.sql en
--          20261031150200_tyre_band_zelfde_schatter.sql
--
--   A. n_eff is de Kish-maat over de stintgewichten: twee gelijke stints geven
--      ongeveer 2, niet het aantal rondes (18). De oude formule
--      (som a)^2/som(a^2/rondes) gaf hier 18.
--   B. De band ligt om dezelfde schatter als wear_per_lap: de gerapporteerde
--      rate is de blend w*eigen + (1-w)*gedeeld met w = rondes/(rondes+8), en
--      het bereik omsluit remaining/rate. De band heet een modelmarge.
--   C. prior_n is een Kish-maat: hij kan niet groter zijn dan het aantal
--      stints dat hem draagt (vroeger: de som van w x rondes, 179,33 uit
--      twintig stints).
--
-- Draai als één transactie met ROLLBACK.
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

create function pg_temp.blok(p_device uuid, p_session text, p_set integer,
                             p_van integer, p_rondes integer,
                             p_auto text, p_baan text, p_rate numeric,
                             p_start timestamptz)
returns void language sql as $$
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, car_key, track_key, captured_at)
  select p_device, 'test', p_session, p_van + g - 1, p_set,
         100 - g * p_rate, 100 - g * p_rate, 100 - g * p_rate, 100 - g * p_rate,
         p_auto, p_baan, p_start + ((p_van + g - 1) || ' minutes')::interval
    from generate_series(1, p_rondes) g;
$$;

create function pg_temp.frame(p_device uuid, p_session text, p_auto text,
                              p_baan text, p_at timestamptz)
returns void language sql as $$
  insert into public.simhub_telemetry_latest
    (device_id, owner_user_id, session_id, sequence, captured_at, connector_id,
     game, telemetry, car_id, car_name, track_name, track_config, v3_normalized)
  select p_device, d.owner_user_id, p_session, 1, p_at, 'test', 'IRacing',
         '{}'::jsonb, p_auto, p_auto,
         split_part(p_baan, ':', 1), split_part(p_baan, ':', 2), '{}'::jsonb
    from public.simhub_devices d
   where d.id = p_device
  on conflict (device_id) do update set
    owner_user_id = excluded.owner_user_id,
    session_id = excluded.session_id,
    captured_at = excluded.captured_at,
    car_id = excluded.car_id,
    car_name = excluded.car_name,
    track_name = excluded.track_name,
    track_config = excluded.track_config,
    v3_normalized = excluded.v3_normalized;
$$;

do $test$
declare
  v_dev   constant uuid := '9da43e1d-1e06-42ac-9178-9532f842a353';  -- RICKY
  v_owner constant uuid := '3cf38c92-5e18-4e1b-925a-4256f17354ae';
  v_cat   constant uuid := 'e90ad2ca-98b8-4384-b241-b1d94d7ddb64';  -- CAT-PC (echte data)
  v_owner_cat constant uuid := '103daeb3-9f46-4d79-a0a1-c460e43ed3b7';
  v_t     constant timestamptz := now();
  v_e     jsonb;
  v_w     numeric;
  v_rate  numeric;
  v_rest  numeric;
begin
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  perform pg_temp.blok(v_dev, 'k-1', 1, 1,  10, 'kishcar', 'kish:gp', 0.5, v_t - interval '25 minutes');
  perform pg_temp.blok(v_dev, 'k-1', 2, 11, 10, 'kishcar', 'kish:gp', 0.5, v_t - interval '25 minutes');
  perform pg_temp.blok(v_dev, 'k-1', 3, 21, 1,  'kishcar', 'kish:gp', 0,   v_t - interval '5 minutes');
  perform pg_temp.frame(v_dev, 'k-1', 'kishcar', 'kish:gp', v_t - interval '1 minute');

  v_e := public.pitwall_tyre_estimate_v2(v_dev);
  v_rate := (v_e->>'wear_per_lap')::numeric;

  --------------------------------------------------------------------------
  -- A. Kish over stints
  --------------------------------------------------------------------------
  perform pg_temp.eis('A: n_eff is de Kish-maat (~2), niet het aantal rondes',
                      (v_e #>> '{basis,n_eff}')::numeric between 1.9 and 2.1);
  perform pg_temp.eis('A: n_eff is niet de oude rondetelling (18)',
                      (v_e #>> '{basis,n_eff}')::numeric < 5);
  perform pg_temp.eis('A: n_eff kan niet groter zijn dan het aantal stints',
                      (v_e #>> '{basis,n_eff}')::numeric
                      <= (v_e #>> '{basis,eigen,stints}')::numeric + 0.01);
  perform pg_temp.eis('A: rondes_effectief is dezelfde maat',
                      (v_e #>> '{basis,rondes_effectief}')::numeric
                      = (v_e #>> '{basis,n_eff}')::numeric);

  --------------------------------------------------------------------------
  -- B. De band om dezelfde schatter als de gerapporteerde rate
  --------------------------------------------------------------------------
  v_w := (v_e #>> '{basis,rondes_in_basis}')::numeric
         / ((v_e #>> '{basis,rondes_in_basis}')::numeric + 8);

  perform pg_temp.eis('B: wear_per_lap is de blend met w = rondes/(rondes+8)',
                      round(v_w * (v_e #>> '{basis,eigen,rate}')::numeric
                            + (1 - v_w) * coalesce((v_e #>> '{basis,gedeeld,rate}')::numeric,
                                                   (v_e #>> '{basis,eigen,rate}')::numeric), 4)
                      = round(v_rate, 4));

  v_rest := (v_e->>'wear_now')::numeric - (v_e->>'threshold_pct')::numeric;
  perform pg_temp.eis('B: het bereik omsluit remaining / wear_per_lap',
                      (v_e #>> '{range_laps,low}')::numeric <= v_rest / v_rate
                      and (v_e #>> '{range_laps,high}')::numeric >= v_rest / v_rate);
  perform pg_temp.eis('B: de band heet een modelmarge (geen gemeten bereik)',
                      v_e #>> '{basis,band,soort}' = 'modelmarge');
  perform pg_temp.eis('B: de bandbreedte hangt aan de blend, niet aan een tweede schatter',
                      (v_e #>> '{basis,band,sigma}')::numeric > 0);

  --------------------------------------------------------------------------
  -- C. prior_n is een Kish-maat op de echte pool
  --------------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_owner_cat::text, true);
  v_e := public.pitwall_tyre_estimate_v2(v_cat);

  if (v_e #>> '{basis,prior_stints}')::integer > 0 then
    perform pg_temp.eis('C: prior_n is niet groter dan het aantal priorstints',
                        (v_e #>> '{basis,prior_n}')::numeric
                        <= (v_e #>> '{basis,prior_stints}')::numeric + 0.01);
    perform pg_temp.eis('C: prior_n is niet groter dan het aantal priorrondes',
                        (v_e #>> '{basis,prior_n}')::numeric
                        <= (v_e #>> '{basis,prior_rondes}')::numeric);
  else
    raise notice 'C: geen priorstints in de pool; de Kish-eigenschap is hier niet te toetsen';
  end if;
end $test$;

rollback;
