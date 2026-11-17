-- Restore captured production function; no change to simhub_persist_v3.
BEGIN;
DO $baseline$
BEGIN
 IF md5((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('public.simhub_pace_merge_v1(jsonb,jsonb,text,timestamptz)'))) IS DISTINCT FROM '365cc2f487cde1e6fbe94f696e1c4d63' THEN
  RAISE EXCEPTION 'Live sector rollback baseline drift: do not overwrite a newer PACE helper';
 END IF;
END;
$baseline$;
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
                              'opponentMetrics','opponentLaps','traceChunks')) THEN
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

    SELECT n - 1 INTO idx FROM jsonb_array_elements(h->'cars') WITH ORDINALITY t(v,n)
     WHERE v->>'id' = cid;
    IF idx IS NOT NULL THEN h := jsonb_set(h,ARRAY['cars',idx::text],car); END IF;
  END LOOP;

  IF jsonb_array_length(h->'cars') > 40 THEN RETURN NULL; END IF;
  h := h || jsonb_build_object('updatedAt',at_time);
  IF octet_length(h::text) > 524288 THEN RETURN NULL; END IF;
  RETURN h;
EXCEPTION WHEN OTHERS THEN
  -- Het optionele blok mag nooit het frame of de ACK kosten.
  RETURN NULL;
END;
$function$;


DROP FUNCTION IF EXISTS public.simhub_sector_car_merge_v1(jsonb,jsonb);
DROP FUNCTION IF EXISTS public.simhub_sector_update_valid_v1(jsonb);
COMMIT;
