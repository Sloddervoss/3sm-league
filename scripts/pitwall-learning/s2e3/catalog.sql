-- S2E3 read-only production catalog capture.
-- Runs inside ONE READ ONLY transaction with short timeouts and ends in ROLLBACK.
-- Emits marker lines (=== SECTION) plus one compact JSON array per section on stdout.
-- No row data, no auth.users content, no secrets, no pg_shadow passwords.
\set QUIET on
BEGIN READ ONLY;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '500ms';
SET LOCAL idle_in_transaction_session_timeout = '30s';

-- Hard identity guard: refuse to run as anything but the approved admin identity.
DO $guard$
BEGIN
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION 's2e3 identity guard: current_user=% (expected supabase_admin)', current_user;
  END IF;
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 's2e3 identity guard: database=% (expected postgres)', current_database();
  END IF;
  IF current_setting('transaction_read_only') <> 'on' THEN
    RAISE EXCEPTION 's2e3 identity guard: transaction is not READ ONLY';
  END IF;
END
$guard$;

\echo === IDENT
SELECT jsonb_build_array(
  current_user, current_database(),
  current_setting('transaction_read_only'),
  current_setting('server_version'),
  (SELECT rolsuper::text FROM pg_roles WHERE rolname = current_user),
  (SELECT system_identifier::text FROM pg_control_system()),
  txid_current_snapshot()::text,
  now()::text
);

\echo === SECRET_PRESENCE
SELECT jsonb_build_array(
  'pg_subscription', (SELECT count(*) FROM pg_subscription),
  'pg_foreign_server', (SELECT count(*) FROM pg_foreign_server),
  'pg_user_mapping', (SELECT count(*) FROM pg_user_mapping),
  'pg_foreign_data_wrapper', (SELECT count(*) FROM pg_foreign_data_wrapper),
  'pg_event_trigger', (SELECT count(*) FROM pg_event_trigger),
  'pg_shadow_rows', (SELECT count(*) FROM pg_shadow),
  'auth_users_rows', (SELECT count(*) FROM auth.users),
  'dblink_extension', (SELECT count(*) FROM pg_extension WHERE extname = 'dblink'),
  'postgres_fdw_extension', (SELECT count(*) FROM pg_extension WHERE extname = 'postgres_fdw'),
  'pgsodium_keytable', (SELECT count(*) FROM pg_tables WHERE schemaname = 'pgsodium' AND tablename = 'key')
);

\echo === SCHEMAS
SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname, pg_get_userbyid(n.nspowner),
       coalesce(n.nspacl::text[], '{}'::text[])) ORDER BY n.nspname), '[]'::jsonb)
FROM pg_namespace n
WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname NOT IN ('information_schema');

\echo === ROLES
SELECT coalesce(jsonb_agg(jsonb_build_array(r.rolname, r.rolsuper, r.rolinherit,
       r.rolcreaterole, r.rolcreatedb, r.rolcanlogin, r.rolreplication,
       r.rolbypassrls, r.rolconnlimit) ORDER BY r.rolname), '[]'::jsonb)
FROM pg_roles r WHERE r.rolname NOT LIKE 'pg\_%';

\echo === ROLE_MEMBERSHIPS
SELECT coalesce(jsonb_agg(jsonb_build_array(g.rolname, m.rolname, am.admin_option)
       ORDER BY g.rolname, m.rolname), '[]'::jsonb)
FROM pg_auth_members am
JOIN pg_roles g ON g.oid = am.roleid
JOIN pg_roles m ON m.oid = am.member;

\echo === TABLES
SELECT coalesce(jsonb_agg(jsonb_build_array(
         n.nspname, c.relname, c.relkind, pg_get_userbyid(c.relowner),
         c.relrowsecurity, c.relforcerowsecurity, c.relpersistence,
         (SELECT count(*) FROM pg_attribute a
            WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
         coalesce(c.relacl::text[], '{}'::text[]),
         (SELECT string_agg(r.role || ':' || p.priv, ',' ORDER BY r.role, p.priv)
            FROM (VALUES ('anon'), ('authenticated'), ('service_role')) r(role)
            CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                               ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
            WHERE has_table_privilege(r.role, c.oid, p.priv))
       ) ORDER BY n.nspname, c.relname), '[]'::jsonb)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public','auth') AND c.relkind IN ('r','p','v','m','f');

\echo === COLUMNS
SELECT coalesce(jsonb_agg(jsonb_build_array(
         n.nspname, c.relname, a.attnum, a.attname,
         format_type(a.atttypid, a.atttypmod),
         a.attnotnull, a.attidentity, a.attgenerated,
         pg_get_expr(d.adbin, d.adrelid),
         CASE WHEN a.attcollation <> 0 AND a.attcollation <> t.typcollation
              THEN (SELECT collname FROM pg_collation WHERE oid = a.attcollation) END,
         coalesce(a.attacl::text[], '{}'::text[])
       ) ORDER BY n.nspname, c.relname, a.attnum), '[]'::jsonb)
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_type t ON t.oid = a.atttypid
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname IN ('public','auth') AND c.relkind IN ('r','p','v','m','f')
  AND a.attnum > 0 AND NOT a.attisdropped;

\echo === CONSTRAINTS
SELECT coalesce(jsonb_agg(jsonb_build_array(
         n.nspname, c.relname, con.conname, con.contype, con.condeferrable,
         con.condeferred, pg_get_constraintdef(con.oid, true),
         (SELECT string_agg(att.attname, ',' ORDER BY k.ord)
            FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
            JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum)
       ) ORDER BY n.nspname, c.relname, con.conname), '[]'::jsonb)
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public','auth');

\echo === INDEXES
SELECT coalesce(jsonb_agg(jsonb_build_array(
         n.nspname, c.relname, ic.relname, i.indisunique, i.indisprimary,
         i.indisvalid, pg_get_indexdef(i.indexrelid),
         (SELECT spcname FROM pg_tablespace ts WHERE ts.oid = ic.reltablespace)
       ) ORDER BY n.nspname, c.relname, ic.relname), '[]'::jsonb)
FROM pg_index i
JOIN pg_class ic ON ic.oid = i.indexrelid
JOIN pg_class c ON c.oid = i.indrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public','auth');

\echo === POLICIES
SELECT coalesce(jsonb_agg(jsonb_build_array(
         n.nspname, c.relname, p.polname, p.polpermissive, p.polcmd,
         coalesce((SELECT string_agg(r.rolname, ',' ORDER BY r.rolname)
                     FROM unnest(p.polroles) pr(oid)
                     JOIN pg_roles r ON r.oid = pr.oid), '*'),
         pg_get_expr(p.polqual, p.polrelid),
         pg_get_expr(p.polwithcheck, p.polrelid)
       ) ORDER BY n.nspname, c.relname, p.polname), '[]'::jsonb)
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public','auth');

\echo === FUNCTIONS
SELECT coalesce(jsonb_agg(jsonb_build_array(
         n.nspname, p.proname, pg_get_function_identity_arguments(p.oid),
         format_type(p.prorettype, NULL), pg_get_userbyid(p.proowner),
         p.prosecdef, p.provolatile, p.proisstrict,
         coalesce(p.proacl::text[], '{}'::text[]),
         md5(coalesce(p.prosrc, '')),
         p.proconfig,
         (SELECT string_agg(r.role || ':' || x.ok::text, ',' ORDER BY r.role)
            FROM (VALUES ('anon'), ('authenticated'), ('service_role'), ('PUBLIC')) r(role)
            CROSS JOIN LATERAL (
              SELECT CASE WHEN r.role = 'PUBLIC'
                          THEN has_function_privilege('public', p.oid, 'EXECUTE')
                          ELSE has_function_privilege(r.role, p.oid, 'EXECUTE') END AS ok
            ) x
            WHERE x.ok)
       ) ORDER BY n.nspname, p.proname, 3), '[]'::jsonb)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public','auth');

\echo === TRIGGERS
SELECT coalesce(jsonb_agg(jsonb_build_array(
         n.nspname, c.relname, t.tgname, t.tgenabled, t.tgtype,
         t.tgconstraint <> 0, pg_get_triggerdef(t.oid, true)
       ) ORDER BY n.nspname, c.relname, t.tgname), '[]'::jsonb)
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public','auth') AND NOT t.tgisinternal;

\echo === TYPES
SELECT coalesce(jsonb_agg(jsonb_build_array(
         n.nspname, t.typname, t.typtype, pg_get_userbyid(t.typowner),
         CASE WHEN t.typtype = 'e' THEN (SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
                                           FROM pg_enum e WHERE e.enumtypid = t.oid) END,
         CASE WHEN t.typtype = 'd' THEN pg_catalog.format_type(t.typbasetype, t.typtypmod) END,
         coalesce(t.typacl::text[], '{}'::text[])
       ) ORDER BY n.nspname, t.typname), '[]'::jsonb)
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname IN ('public','auth') AND t.typtype IN ('e','d','c','r');

\echo === SEQUENCES
SELECT coalesce(jsonb_agg(jsonb_build_array(
         schemaname, sequencename, pg_get_userbyid(c.relowner),
         coalesce(c.relacl::text[], '{}'::text[])
       ) ORDER BY schemaname, sequencename), '[]'::jsonb)
FROM pg_sequences s
JOIN pg_class c ON c.relname = s.sequencename
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = s.schemaname
WHERE s.schemaname IN ('public','auth');

\echo === EXTENSIONS
SELECT coalesce(jsonb_agg(jsonb_build_array(e.extname, e.extversion, n.nspname, e.extrelocatable)
       ORDER BY e.extname), '[]'::jsonb)
FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace;

\echo === PUBLICATIONS
SELECT coalesce(jsonb_agg(jsonb_build_array(p.pubname, pg_get_userbyid(p.pubowner),
       p.puballtables, p.pubinsert, p.pubupdate, p.pubdelete, p.pubtruncate,
       (SELECT string_agg(n.nspname || '.' || c.relname, ',' ORDER BY n.nspname, c.relname)
          FROM pg_publication_rel pr
          JOIN pg_class c ON c.oid = pr.prrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE pr.prpubid = p.oid)
       ) ORDER BY p.pubname), '[]'::jsonb)
FROM pg_publication p;

\echo === DEFAULT_ACLS
SELECT coalesce(jsonb_agg(jsonb_build_array(
         CASE WHEN d.defaclnamespace = 0 THEN NULL
              ELSE (SELECT nspname FROM pg_namespace WHERE oid = d.defaclnamespace) END,
         pg_get_userbyid(d.defaclrole), d.defaclobjtype,
         d.defaclacl::text[]
       ) ORDER BY 1 NULLS FIRST, 2, 3), '[]'::jsonb)
FROM pg_default_acl d;

\echo === COUNTS
SELECT jsonb_build_object(
  'public_tables', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                     WHERE n.nspname='public' AND c.relkind IN ('r','p')),
  'public_views', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                     WHERE n.nspname='public' AND c.relkind IN ('v','m')),
  'public_functions', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                     WHERE n.nspname='public'),
  'public_secdef', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                     WHERE n.nspname='public' AND p.prosecdef),
  'public_policies', (SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
                     JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
  'auth_tables', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                     WHERE n.nspname='auth' AND c.relkind IN ('r','p')),
  'pitwall_learning_schema', (SELECT count(*) FROM pg_namespace WHERE nspname='pitwall_learning'),
  'simhub_devices', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                     WHERE n.nspname='public' AND c.relname='simhub_devices'),
  'observation_policy_rpc', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                     WHERE n.nspname='public' AND p.proname='simhub_observation_policy_v1'),
  'snapshot_ts', now()::text
);

\echo === END
ROLLBACK;
