-- Additive live sectors; retain the deployed hardened PACE merge, signature and ACL.
BEGIN;
DO $baseline$
BEGIN
 IF md5((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('public.simhub_pace_merge_v1(jsonb,jsonb,text,timestamptz)'))) IS DISTINCT FROM '5a8ead0f2c8e29633b7f647697c86e2a' THEN
  RAISE EXCEPTION 'Live sector migration baseline drift: recapture the current PACE helper first';
 END IF;
END;
$baseline$;
-- Internal, bounded, optional sector helpers. No exposed table and no auth change.
CREATE OR REPLACE FUNCTION public.simhub_sector_update_valid_v1(u jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $sector$
DECLARE k text; n numeric; count_n integer;
BEGIN
 IF jsonb_typeof(u) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_object_keys(u) x WHERE x NOT IN ('id','lap','sectorIndex','sectorCount','seconds','completedSessionTimeSeconds','observedSessionTimeSeconds','revision','status','referenceSeconds')) THEN RETURN false; END IF;
 IF jsonb_typeof(u->'id') IS DISTINCT FROM 'string' OR char_length(btrim(u->>'id')) NOT BETWEEN 1 AND 64 OR char_length(u->>'id')>64 THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['lap','sectorIndex','sectorCount','completedSessionTimeSeconds','observedSessionTimeSeconds','revision'] LOOP
  IF jsonb_typeof(u->k) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
 END LOOP;
 IF (u->>'lap')::numeric NOT BETWEEN 1 AND 100000 OR trunc((u->>'lap')::numeric)<>(u->>'lap')::numeric THEN RETURN false; END IF;
 IF (u->>'sectorCount')::numeric NOT BETWEEN 1 AND 16 OR trunc((u->>'sectorCount')::numeric)<>(u->>'sectorCount')::numeric THEN RETURN false; END IF;
 count_n:=(u->>'sectorCount')::integer;
 IF (u->>'sectorIndex')::numeric NOT BETWEEN 0 AND count_n-1 OR trunc((u->>'sectorIndex')::numeric)<>(u->>'sectorIndex')::numeric THEN RETURN false; END IF;
 IF (u->>'revision')::numeric NOT BETWEEN 1 AND 9007199254740991 OR trunc((u->>'revision')::numeric)<>(u->>'revision')::numeric THEN RETURN false; END IF;
 IF (u->>'completedSessionTimeSeconds')::numeric NOT BETWEEN 0 AND 86400 OR (u->>'observedSessionTimeSeconds')::numeric NOT BETWEEN (u->>'completedSessionTimeSeconds')::numeric AND 86400 THEN RETURN false; END IF;
 IF u->>'status' IS NULL OR u->>'status' NOT IN ('provisional','verified','invalidated') THEN RETURN false; END IF;
 IF u->>'status'='invalidated' THEN
  IF NOT (u ? 'seconds') OR u->'seconds' IS DISTINCT FROM 'null'::jsonb THEN RETURN false; END IF;
 ELSE
  IF jsonb_typeof(u->'seconds') IS DISTINCT FROM 'number' OR (u->>'seconds')::numeric<=0 OR (u->>'seconds')::numeric>86400 THEN RETURN false; END IF;
 END IF;
 IF NOT (u ? 'referenceSeconds') THEN RETURN false; END IF;
 IF u->'referenceSeconds' IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(u->'referenceSeconds') IS DISTINCT FROM 'number' OR (u->>'referenceSeconds')::numeric<=0 OR (u->>'referenceSeconds')::numeric>86400) THEN RETURN false; END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$sector$;
REVOKE ALL ON FUNCTION public.simhub_sector_update_valid_v1(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.simhub_sector_update_valid_v1(jsonb) TO postgres,service_role;

CREATE OR REPLACE FUNCTION public.simhub_sector_car_merge_v1(previous_car jsonb, updates jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $sector$
DECLARE
 car jsonb:=previous_car; u jsonb; old_u jsonb; best_u jsonb; guard_u jsonb;
 sectors jsonb; bests jsonb; guards jsonb; arr jsonb;
 lap_n integer; index_n integer; latest_lap integer; count_n integer; rev_n numeric;
BEGIN
 IF jsonb_typeof(car) IS DISTINCT FROM 'object' OR jsonb_typeof(updates) IS DISTINCT FROM 'array' OR jsonb_array_length(updates)>8 THEN RETURN previous_car; END IF;
 sectors:=CASE WHEN jsonb_typeof(car->'sectors')='array' THEN car->'sectors' ELSE '[]'::jsonb END;
 bests:=CASE WHEN jsonb_typeof(car->'sectorBests')='array' THEN car->'sectorBests' ELSE '[]'::jsonb END;
 guards:=CASE WHEN jsonb_typeof(car->'sectorGuards')='array' THEN car->'sectorGuards' ELSE '[]'::jsonb END;
 FOR u IN SELECT value FROM jsonb_array_elements(updates) LOOP
  BEGIN
   IF NOT public.simhub_sector_update_valid_v1(u) OR u->>'id' IS DISTINCT FROM car->>'id' THEN CONTINUE; END IF;
   lap_n:=(u->>'lap')::int; index_n:=(u->>'sectorIndex')::int; count_n:=(u->>'sectorCount')::int; rev_n:=(u->>'revision')::numeric;
   -- Layout changes need a new segment, never mix different partitions in one car.
   IF EXISTS (SELECT 1 FROM jsonb_array_elements(sectors) t(v) WHERE (v->>'sectorCount')::int<>count_n) THEN CONTINUE; END IF;
   SELECT max((v->>'lap')::int) INTO latest_lap FROM jsonb_array_elements(sectors) t(v);
   SELECT v INTO best_u FROM jsonb_array_elements(bests) t(v) WHERE (v->>'sectorIndex')::int=index_n LIMIT 1;
   -- Remember two recent laps and the identities of retained bests. Ancient replays
   -- outside that frontier cannot resurrect a previously invalidated best.
   IF latest_lap IS NOT NULL AND lap_n<latest_lap-1 AND (best_u->>'lap')::int IS DISTINCT FROM lap_n THEN CONTINUE; END IF;
   SELECT v INTO guard_u FROM jsonb_array_elements(guards) t(v) WHERE (v->>0)::int=lap_n AND (v->>1)::int=index_n LIMIT 1;
   IF guard_u IS NOT NULL AND (guard_u->>2)::numeric>=rev_n THEN CONTINUE; END IF;
   IF guard_u->>3='invalidated' AND u->>'status'<>'invalidated' THEN CONTINUE; END IF;
   SELECT v INTO old_u FROM jsonb_array_elements(sectors) t(v) WHERE (v->>'sectorIndex')::int=index_n LIMIT 1;
   IF (old_u->>'lap')::int=lap_n AND u->>'status'<>'invalidated' AND (
       old_u->'seconds' IS DISTINCT FROM u->'seconds' OR
       old_u->'completedSessionTimeSeconds' IS DISTINCT FROM u->'completedSessionTimeSeconds' OR
       old_u->'referenceSeconds' IS DISTINCT FROM u->'referenceSeconds' OR
       (old_u->>'status'='verified' AND u->>'status'='provisional')) THEN CONTINUE; END IF;
   SELECT coalesce(jsonb_agg(v),'[]'::jsonb) INTO guards FROM jsonb_array_elements(guards) t(v) WHERE NOT ((v->>0)::int=lap_n AND (v->>1)::int=index_n);
   guards:=guards||jsonb_build_array(jsonb_build_array(lap_n,index_n,rev_n,u->>'status'));
   IF old_u IS NULL OR (old_u->>'lap')::int<lap_n OR ((old_u->>'lap')::int=lap_n AND (old_u->>'revision')::numeric<rev_n) THEN
    SELECT coalesce(jsonb_agg(v),'[]'::jsonb) INTO sectors FROM jsonb_array_elements(sectors) t(v) WHERE (v->>'sectorIndex')::int<>index_n;
    sectors:=sectors||jsonb_build_array(u);
   END IF;
   IF u->>'status'='verified' AND (best_u IS NULL OR (u->>'seconds')::numeric<(best_u->>'seconds')::numeric) THEN
    SELECT coalesce(jsonb_agg(v),'[]'::jsonb) INTO bests FROM jsonb_array_elements(bests) t(v) WHERE (v->>'sectorIndex')::int<>index_n;
    bests:=bests||jsonb_build_array(jsonb_build_object('sectorIndex',index_n,'lap',lap_n,'seconds',u->'seconds'));
   ELSIF u->>'status'='invalidated' AND (best_u->>'lap')::int=lap_n THEN
    SELECT coalesce(jsonb_agg(v),'[]'::jsonb) INTO bests FROM jsonb_array_elements(bests) t(v) WHERE (v->>'sectorIndex')::int<>index_n;
   END IF;
  EXCEPTION WHEN OTHERS THEN CONTINUE;
  END;
 END LOOP;
 SELECT coalesce(jsonb_agg(v ORDER BY (v->>'sectorIndex')::int),'[]'::jsonb) INTO sectors FROM (SELECT v FROM jsonb_array_elements(sectors) t(v) ORDER BY (v->>'sectorIndex')::int LIMIT 16) q;
 SELECT coalesce(jsonb_agg(v ORDER BY (v->>'sectorIndex')::int),'[]'::jsonb) INTO bests FROM (SELECT v FROM jsonb_array_elements(bests) t(v) ORDER BY (v->>'sectorIndex')::int LIMIT 16) q;
 SELECT max((v->>'lap')::int) INTO latest_lap FROM jsonb_array_elements(sectors) t(v);
 SELECT coalesce(jsonb_agg(v),'[]'::jsonb) INTO guards FROM (
  SELECT v FROM jsonb_array_elements(guards) t(v)
  WHERE (v->>0)::int>=coalesce(latest_lap,1)-1 OR EXISTS (SELECT 1 FROM jsonb_array_elements(bests) b(x) WHERE (x->>'lap')::int=(v->>0)::int AND (x->>'sectorIndex')::int=(v->>1)::int)
  ORDER BY (v->>0)::int DESC,(v->>1)::int LIMIT 48
 ) q;
 RETURN car||jsonb_build_object('sectors',sectors,'sectorBests',bests,'sectorGuards',guards);
EXCEPTION WHEN OTHERS THEN RETURN previous_car;
END;
$sector$;
REVOKE ALL ON FUNCTION public.simhub_sector_car_merge_v1(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.simhub_sector_car_merge_v1(jsonb,jsonb) TO postgres,service_role;

CREATE OR REPLACE FUNCTION public.simhub_pace_merge_v1(previous jsonb, capture jsonb, transport text, at_time timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  h jsonb := previous;
  c jsonb; item jsonb; car jsonb; tr jsonb; old_tr jsonb; pt jsonb;
  arr jsonb; points jsonb;
  idx integer; tidx integer; pid integer;
  cid text; trace_id text; v_time numeric; v_lap integer;
  v_keys text[];
  keep_n integer;
  v_final boolean; v_lap_seconds numeric; v_anchor numeric; v_unc integer;
BEGIN
  IF at_time IS NULL OR transport IS NULL OR char_length(transport) NOT BETWEEN 1 AND 120 THEN
    RETURN NULL;
  END IF;

  -- Een vorige waarde is van ons of is afwezig. Een vreemd/corrupt blok wordt
  -- volledig weggegooid, nooit gedeeltelijk vertrouwd.
  IF h IS NOT NULL THEN
    BEGIN
      IF jsonb_typeof(h) IS DISTINCT FROM 'object'
         OR jsonb_typeof(h->'cars') IS DISTINCT FROM 'array'
         OR (h->>'transportSessionId') IS DISTINCT FROM transport
         OR (h->>'updatedAt') IS NULL
         OR (h->>'updatedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?([+-][0-9]{2}:[0-9]{2}|Z)?$'
         OR (h->>'updatedAt')::timestamptz < at_time - interval '24 hours' THEN
        h := NULL;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      h := NULL;
    END;
  END IF;

  IF capture IS NULL OR jsonb_typeof(capture) IS DISTINCT FROM 'object' THEN RETURN h; END IF;
  -- Let op: IS DISTINCT FROM, niet <>. Een ontbrekende sleutel mag niet als
  -- "gelijk aan 1" doorgaan (NULL <> '1' is NULL en dus nooit waar).
  IF capture->>'schemaRevision' IS DISTINCT FROM '1'
     OR capture->>'observedSessionId' IS NULL
     OR char_length(capture->>'observedSessionId') NOT BETWEEN 1 AND 64
     OR capture->>'segmentId' IS NULL
     OR char_length(capture->>'segmentId') NOT BETWEEN 1 AND 64
     OR octet_length(capture::text) > 8192 THEN
    RETURN h;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(capture) k
              WHERE k NOT IN ('schemaRevision','observedSessionId','segmentId',
                              'opponentMetrics','opponentLaps','traceChunks','sectorUpdates')) THEN
    RETURN h;
  END IF;
  IF (capture ? 'opponentMetrics' AND jsonb_typeof(capture->'opponentMetrics') IS DISTINCT FROM 'array')
     OR (capture ? 'opponentLaps' AND jsonb_typeof(capture->'opponentLaps') IS DISTINCT FROM 'array')
     OR (capture ? 'traceChunks' AND jsonb_typeof(capture->'traceChunks') IS DISTINCT FROM 'array') THEN
    RETURN h;
  END IF;
  -- Invoergrens: het wire-contract is veel kleiner; dit stopt alleen een
  -- vijandige rij en houdt de merge begrensd.
  IF jsonb_array_length(coalesce(capture->'opponentMetrics','[]'::jsonb)) > 64
     OR jsonb_array_length(coalesce(capture->'opponentLaps','[]'::jsonb)) > 128
     OR jsonb_array_length(coalesce(capture->'traceChunks','[]'::jsonb)) > 64 THEN
    RETURN h;
  END IF;

  -- The optional addition is independently filtered; legacy metrics/laps/traces survive.
  IF capture ? 'sectorUpdates' THEN
    arr := '[]'::jsonb;
    IF jsonb_typeof(capture->'sectorUpdates') = 'array' THEN
      IF jsonb_array_length(capture->'sectorUpdates') <= 8 THEN
        SELECT coalesce(jsonb_agg(v),'[]'::jsonb) INTO arr
          FROM jsonb_array_elements(capture->'sectorUpdates') t(v)
          WHERE public.simhub_sector_update_valid_v1(v);
      END IF;
    END IF;
    capture := jsonb_set(capture,'{sectorUpdates}',arr);
  END IF;

  IF h IS NOT NULL AND (h->>'segmentId' IS DISTINCT FROM capture->>'segmentId'
                        OR h->>'observedSessionId' IS DISTINCT FROM capture->>'observedSessionId') THEN
    h := NULL;
  END IF;
  IF h IS NULL THEN
    h := jsonb_build_object('schemaRevision',1,
                            'observedSessionId',capture->>'observedSessionId',
                            'segmentId',capture->>'segmentId',
                            'transportSessionId',transport,
                            'cars','[]'::jsonb);
  END IF;

  -- Auto-identiteiten komen uitsluitend uit dit begrensde transportblok.
  FOR item IN
    SELECT v FROM (
      SELECT value AS v FROM jsonb_array_elements(coalesce(capture->'opponentMetrics','[]'::jsonb))
      UNION ALL
      SELECT value FROM jsonb_array_elements(coalesce(capture->'opponentLaps','[]'::jsonb))
      UNION ALL
      SELECT value FROM jsonb_array_elements(coalesce(capture->'traceChunks','[]'::jsonb))
      UNION ALL
      SELECT value FROM jsonb_array_elements(coalesce(capture->'sectorUpdates','[]'::jsonb))
    ) q
  LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN CONTINUE; END IF;
    cid := item->>'id';
    IF cid IS NULL OR char_length(cid) NOT BETWEEN 1 AND 64 THEN CONTINUE; END IF;
    SELECT n - 1 INTO idx FROM jsonb_array_elements(h->'cars') WITH ORDINALITY t(v,n) WHERE v->>'id' = cid;
    IF idx IS NULL THEN
      IF jsonb_array_length(h->'cars') >= 40 THEN
        SELECT jsonb_agg(v ORDER BY k, id) INTO arr FROM (
          SELECT v,
                 coalesce(CASE WHEN v#>>'{metrics,observedSessionTimeSeconds}' ~ '^[0-9]+([.][0-9]+)?$'
                               THEN (v#>>'{metrics,observedSessionTimeSeconds}')::numeric END, -1) AS k,
                 v->>'id' AS id
            FROM jsonb_array_elements(h->'cars') t(v)
           ORDER BY coalesce(CASE WHEN v#>>'{metrics,observedSessionTimeSeconds}' ~ '^[0-9]+([.][0-9]+)?$'
                                  THEN (v#>>'{metrics,observedSessionTimeSeconds}')::numeric END, -1) DESC,
                    v->>'id'
           LIMIT 39
        ) q;
        h := jsonb_set(h,'{cars}',coalesce(arr,'[]'::jsonb));
      END IF;
      h := jsonb_set(h,'{cars}',(h->'cars') ||
        jsonb_build_array(jsonb_build_object('id',cid,'laps','[]'::jsonb,'traces','[]'::jsonb)));
    END IF;
  END LOOP;

  FOR c IN SELECT value FROM jsonb_array_elements(h->'cars') LOOP
    IF jsonb_typeof(c) IS DISTINCT FROM 'object' THEN CONTINUE; END IF;
    cid := c->>'id'; car := c;
    IF jsonb_typeof(car->'laps') IS DISTINCT FROM 'array' THEN car := jsonb_set(car,'{laps}','[]'::jsonb); END IF;
    IF jsonb_typeof(car->'traces') IS DISTINCT FROM 'array' THEN car := jsonb_set(car,'{traces}','[]'::jsonb); END IF;

    -- Metingen: de nieuwste observatie wint; onbekende sleutels worden geweigerd.
    FOR item IN SELECT value FROM jsonb_array_elements(coalesce(capture->'opponentMetrics','[]'::jsonb))
                 WHERE value->>'id' = cid LOOP
      IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN CONTINUE; END IF;
      v_keys := NULL;
      SELECT array_agg(k) INTO v_keys FROM jsonb_object_keys(item) k
       WHERE k NOT IN ('id','observedSessionTimeSeconds','lastLapSeconds','bestLapSeconds',
                       'lastLapSectorSeconds','bestLapSectorSeconds','bestSectorSeconds',
                       'bestLapDeltaToFieldBestSeconds','bestLapDeltaToPlayerSeconds',
                       'lapValid','lapHighPrecision','trackPositionPercentRaw',
                       'sectorMismatchCount','sectorCount','sectorLap','sectorSource',
                       'sectorErrorSeconds','bestSectorSource','bestSectorErrorSeconds',
                       'sectorDiagnostic');
      IF v_keys IS NOT NULL THEN CONTINUE; END IF;
      IF item->>'observedSessionTimeSeconds' IS NULL
         OR item->>'observedSessionTimeSeconds' !~ '^[0-9]+([.][0-9]+)?$' THEN CONTINUE; END IF;
      v_time := (item->>'observedSessionTimeSeconds')::numeric;
      IF v_time < 0 OR v_time > 86400 THEN CONTINUE; END IF;
      IF coalesce(CASE WHEN car#>>'{metrics,observedSessionTimeSeconds}' ~ '^[0-9]+([.][0-9]+)?$'
                       THEN (car#>>'{metrics,observedSessionTimeSeconds}')::numeric END, -1) <= v_time THEN
        car := jsonb_set(car,'{metrics}',item);
      END IF;
    END LOOP;

    -- Rondes: dedupe op observationId; een conflict vervangt nooit de eerste.
    FOR item IN SELECT value FROM jsonb_array_elements(coalesce(capture->'opponentLaps','[]'::jsonb))
                 WHERE value->>'id' = cid LOOP
      IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN CONTINUE; END IF;
      v_keys := NULL;
      SELECT array_agg(k) INTO v_keys FROM jsonb_object_keys(item) k
       WHERE k NOT IN ('id','lap','seconds','observedSessionTimeSeconds','quality','observationId');
      IF v_keys IS NOT NULL THEN CONTINUE; END IF;
      IF item->>'observationId' IS NULL OR char_length(item->>'observationId') NOT BETWEEN 1 AND 80
         OR item->>'lap' IS NULL OR item->>'lap' !~ '^[0-9]+$'
         OR item->>'seconds' IS NULL OR item->>'seconds' !~ '^[0-9]+([.][0-9]+)?$'
         OR item->>'observedSessionTimeSeconds' IS NULL
         OR item->>'observedSessionTimeSeconds' !~ '^[0-9]+([.][0-9]+)?$'
         OR item->>'quality' IS DISTINCT FROM 'sampled' THEN CONTINUE; END IF;
      v_lap := (item->>'lap')::int;
      IF v_lap NOT BETWEEN 1 AND 100000
         OR (item->>'seconds')::numeric NOT BETWEEN 0.001 AND 86400
         OR (item->>'observedSessionTimeSeconds')::numeric NOT BETWEEN 0 AND 86400 THEN CONTINUE; END IF;
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(car->'laps') t
                      WHERE t->>'observationId' = item->>'observationId') THEN
        SELECT jsonb_agg(v ORDER BY (v->>'lap')::int) INTO arr FROM (
          SELECT v FROM (
            SELECT value AS v FROM jsonb_array_elements(car->'laps')
            UNION ALL SELECT item
          ) q ORDER BY (v->>'lap')::int DESC LIMIT 20
        ) q;
        car := jsonb_set(car,'{laps}',coalesce(arr,'[]'::jsonb));
      END IF;
    END LOOP;

    -- Sporen: chunks met dezelfde traceId worden samengevoegd; 128 bins,
    -- monotone tijden, finishanker én eindduur bepalen `complete`.
    FOR item IN SELECT value FROM jsonb_array_elements(coalesce(capture->'traceChunks','[]'::jsonb))
                 WHERE value->>'id' = cid LOOP
      IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN CONTINUE; END IF;
      v_keys := NULL;
      SELECT array_agg(k) INTO v_keys FROM jsonb_object_keys(item) k
       WHERE k NOT IN ('id','traceId','lap','chunkIndex','finalChunk','anchorSessionTimeMs',
                       'anchorUncertaintyMs','lapSeconds','provenance','speedUnit','points');
      IF v_keys IS NOT NULL THEN CONTINUE; END IF;
      trace_id := item->>'traceId';
      IF trace_id IS NULL OR char_length(trace_id) NOT BETWEEN 1 AND 80
         OR item->>'lap' IS NULL OR item->>'lap' !~ '^[0-9]+$'
         OR item->>'finalChunk' IS NULL OR item->>'finalChunk' NOT IN ('true','false')
         OR item->>'provenance' IS DISTINCT FROM 'simhub-opponent-sampled'
         OR jsonb_typeof(item->'points') IS DISTINCT FROM 'array'
         OR jsonb_array_length(item->'points') > 64 THEN CONTINUE; END IF;
      v_lap := (item->>'lap')::int;
      IF v_lap NOT BETWEEN 1 AND 100000 THEN CONTINUE; END IF;
      v_anchor := NULL; v_unc := NULL; v_lap_seconds := NULL;
      IF item->>'anchorSessionTimeMs' IS NOT NULL THEN
        IF item->>'anchorSessionTimeMs' !~ '^[0-9]+$' THEN CONTINUE; END IF;
        v_anchor := (item->>'anchorSessionTimeMs')::numeric;
        IF v_anchor > 86400000 THEN CONTINUE; END IF;
      END IF;
      IF item->>'anchorUncertaintyMs' IS NOT NULL THEN
        IF item->>'anchorUncertaintyMs' !~ '^[0-9]+$' THEN CONTINUE; END IF;
        v_unc := (item->>'anchorUncertaintyMs')::integer;
        IF v_unc > 250 THEN CONTINUE; END IF;
      END IF;
      IF item->>'lapSeconds' IS NOT NULL THEN
        IF item->>'lapSeconds' !~ '^[0-9]+([.][0-9]+)?$' THEN CONTINUE; END IF;
        v_lap_seconds := (item->>'lapSeconds')::numeric;
        IF v_lap_seconds NOT BETWEEN 0.001 AND 86400 THEN CONTINUE; END IF;
      END IF;
      v_final := (item->>'finalChunk')::boolean;

      SELECT v INTO old_tr FROM jsonb_array_elements(car->'traces') t(v)
       WHERE v->>'traceId' = trace_id;
      tr := coalesce(old_tr,'{}'::jsonb) - 'points' - 'chunkIndex';
      tr := tr || jsonb_build_object('id',cid,'traceId',trace_id,
                                     'provenance','simhub-opponent-sampled');
      IF old_tr IS NOT NULL AND old_tr->>'lap' IS DISTINCT FROM v_lap::text THEN
        tr := tr || '{"conflict":true}'::jsonb;
      ELSE
        tr := tr || jsonb_build_object('lap',v_lap);
      END IF;
      IF old_tr->>'anchorSessionTimeMs' IS NOT NULL THEN
        IF v_anchor IS NOT NULL AND old_tr->>'anchorSessionTimeMs' IS DISTINCT FROM v_anchor::text THEN
          tr := tr || '{"conflict":true}'::jsonb;
        END IF;
      ELSE
        tr := tr || jsonb_build_object('anchorSessionTimeMs',v_anchor);
      END IF;
      IF old_tr->>'anchorUncertaintyMs' IS NOT NULL THEN
        tr := tr || jsonb_build_object('anchorUncertaintyMs',old_tr->'anchorUncertaintyMs');
      ELSE
        tr := tr || jsonb_build_object('anchorUncertaintyMs',v_unc);
      END IF;
      IF old_tr->>'lapSeconds' IS NOT NULL THEN
        IF v_lap_seconds IS NOT NULL AND old_tr->>'lapSeconds' IS DISTINCT FROM v_lap_seconds::text THEN
          tr := tr || '{"conflict":true}'::jsonb;
        END IF;
        tr := tr || jsonb_build_object('lapSeconds',old_tr->'lapSeconds');
      ELSIF v_lap_seconds IS NOT NULL THEN
        tr := tr || jsonb_build_object('lapSeconds',v_lap_seconds);
      END IF;
      tr := tr || jsonb_build_object('finalChunk',
        coalesce((old_tr->>'finalChunk')::boolean,false) OR v_final);
      tr := tr || jsonb_build_object('speedUnit',
        CASE WHEN item->>'speedUnit' = 'km/h' OR old_tr->>'speedUnit' = 'km/h' THEN 'km/h' ELSE NULL END);

      points := coalesce(old_tr->'points','[]'::jsonb);
      IF jsonb_typeof(points) IS DISTINCT FROM 'array' THEN points := '[]'::jsonb; END IF;
      FOR pt IN SELECT value FROM jsonb_array_elements(item->'points') LOOP
        IF jsonb_typeof(pt) IS DISTINCT FROM 'array' OR jsonb_array_length(pt) <> 3 THEN CONTINUE; END IF;
        IF pt->>0 IS NULL OR pt->>0 !~ '^[0-9]+$' THEN CONTINUE; END IF;
        IF pt->>1 IS NOT NULL AND pt->>1 !~ '^[0-9]+$' THEN CONTINUE; END IF;
        IF pt->>2 IS NOT NULL AND pt->>2 !~ '^[0-9]+$' THEN CONTINUE; END IF;
        pid := (pt->>0)::int;
        IF pid NOT BETWEEN 0 AND 127 THEN CONTINUE; END IF;
        IF coalesce((pt->>1)::numeric,0) > 86400000 OR coalesce((pt->>2)::numeric,0) > 6000 THEN CONTINUE; END IF;
        SELECT n - 1 INTO tidx FROM jsonb_array_elements(points) WITH ORDINALITY t(v,n)
         WHERE (v->>0)::int = pid;
        IF tidx IS NULL THEN
          points := points || jsonb_build_array(pt);
        ELSIF points->tidx IS DISTINCT FROM pt THEN
          tr := tr || '{"conflict":true}'::jsonb;
        END IF;
      END LOOP;
      SELECT coalesce(jsonb_agg(v ORDER BY (v->>0)::int),'[]'::jsonb) INTO points
        FROM jsonb_array_elements(points) t(v);
      IF tr->>'conflict' IS DISTINCT FROM 'true' THEN tr := tr - 'conflict'; END IF;
      tr := tr || jsonb_build_object('points',points,'complete',false);

      IF jsonb_array_length(points) = 128
         AND tr->>'conflict' IS DISTINCT FROM 'true'
         AND tr->>'finalChunk' = 'true'
         AND tr->>'anchorUncertaintyMs' IS NOT NULL
         AND (tr->>'anchorUncertaintyMs')::int BETWEEN 0 AND 250
         AND tr->>'anchorSessionTimeMs' IS NOT NULL
         AND tr->>'lapSeconds' IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM (
             SELECT v, lag(CASE WHEN v->>1 ~ '^[0-9]+$' THEN (v->>1)::numeric END)
                          OVER (ORDER BY (v->>0)::int) AS prev
               FROM jsonb_array_elements(points) t(v)
           ) q
           WHERE v->>1 IS NULL OR v->>1 !~ '^[0-9]+$' OR (v->>1)::numeric < prev
         )
         AND abs((points->0->>1)::numeric - (tr->>'anchorSessionTimeMs')::numeric) <= 1
         AND abs(((points->127->>1)::numeric - (tr->>'anchorSessionTimeMs')::numeric)/1000
                 - (tr->>'lapSeconds')::numeric) <= 0.25 THEN
        tr := tr || '{"complete":true}'::jsonb;
      END IF;

      -- Huidig/ontvangen, snelste complete, meest recente andere; harde cap 3.
      SELECT coalesce(jsonb_agg(v ORDER BY o1,o2,o3 DESC),'[]'::jsonb) INTO arr FROM (
        SELECT v,
               CASE WHEN v->>'traceId' = trace_id THEN 0
                    WHEN v->>'complete' = 'true' THEN 1 ELSE 2 END AS o1,
               CASE WHEN v->>'complete' = 'true'
                     AND v->>'lapSeconds' ~ '^[0-9]+([.][0-9]+)?$'
                    THEN (v->>'lapSeconds')::numeric END AS o2,
               CASE WHEN v->>'lap' ~ '^[0-9]+$' THEN (v->>'lap')::int ELSE 0 END AS o3
          FROM (
            SELECT value AS v FROM jsonb_array_elements(car->'traces')
             WHERE value->>'traceId' <> trace_id
            UNION ALL SELECT tr
          ) q
         ORDER BY o1,o2,o3 DESC
         LIMIT 3
      ) q;
      car := jsonb_set(car,'{traces}',coalesce(arr,'[]'::jsonb));
    END LOOP;

    IF capture ? 'sectorUpdates' THEN
      car := public.simhub_sector_car_merge_v1(car,capture->'sectorUpdates');
    END IF;
    SELECT n - 1 INTO idx FROM jsonb_array_elements(h->'cars') WITH ORDINALITY t(v,n)
     WHERE v->>'id' = cid;
    IF idx IS NOT NULL THEN h := jsonb_set(h,ARRAY['cars',idx::text],car); END IF;
  END LOOP;

  IF jsonb_array_length(h->'cars') > 40 THEN RETURN NULL; END IF;
  h := h || jsonb_build_object('updatedAt',at_time);
  -- Sector results outrank optional trace history when the combined block is full.
  IF capture ? 'sectorUpdates' AND octet_length(h::text)>524288 THEN
    FOR keep_n IN REVERSE 2..0 LOOP
      SELECT jsonb_agg(CASE WHEN jsonb_typeof(v)='object' THEN
        jsonb_set(v,'{traces}',coalesce((SELECT jsonb_agg(x ORDER BY n) FROM
          jsonb_array_elements(coalesce(v->'traces','[]'::jsonb)) WITH ORDINALITY t(x,n)
          WHERE n<=keep_n),'[]'::jsonb)) ELSE v END) INTO arr
      FROM jsonb_array_elements(h->'cars') c(v);
      h:=jsonb_set(h,'{cars}',arr);
      EXIT WHEN octet_length(h::text)<=524288;
    END LOOP;
  END IF;
  IF octet_length(h::text) > 524288 THEN RETURN NULL; END IF;
  RETURN h;
EXCEPTION WHEN OTHERS THEN
  -- Het optionele blok mag nooit het frame of de ACK kosten.
  RETURN NULL;
END;
$function$;


COMMIT;
