BEGIN READ ONLY;
SELECT 'ROLE', rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin,
       rolreplication, rolbypassrls, rolconnlimit
FROM pg_roles WHERE rolname IN ('supabase_functions_admin','supabase_realtime_admin')
ORDER BY rolname;
SELECT 'LOCALE', string_agg(locale, ',' ORDER BY locale) FROM (SELECT DISTINCT locale FROM pg_collation) s;
ROLLBACK;
