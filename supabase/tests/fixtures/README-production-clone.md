# Production schema clone fixture

`simhub-production-schema-20261121.sql.gz` is a `pg_dump --schema-only` of the
production `public` and `pitwall_learning` schemas. It contains no rows, no
owners and no grants. The corresponding hashes and object counts are in
`simhub-production-schema-20261121.manifest.json`.

Recapture from the read-only runbook route:

```bash
ssh 3sm-docker \
  "docker exec -i supabase-db pg_dump -U supabase_admin -d postgres \
     --schema-only --no-owner --no-privileges \
     --schema=public --schema=pitwall_learning" \
  | gzip -9 -n > supabase/tests/fixtures/simhub-production-schema-20261121.sql.gz
sha256sum supabase/tests/fixtures/simhub-production-schema-20261121.sql.gz
```

The loader (`supabase/tests/support/production-clone.mjs`) adds the minimal
Supabase auth stubs and skips views/comments. Tables, types, constraints,
indexes, functions, triggers and policies are loaded; no production data is
present.

`pit-edges-edge-normalized.json` is the output of the real Edge normalizer for
`pit-edges-connector.json`:

```bash
~/.deno/bin/deno run --allow-read --allow-env \
  supabase/tests/fixtures/pit-edges-edge-normalized.ts \
  > supabase/tests/fixtures/pit-edges-edge-normalized.json
```

The Node SQL test re-runs that Deno command when Deno is available and compares
the fresh output with the committed fixture.
