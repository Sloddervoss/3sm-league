/**
 * Load a schema-only clone of the production public + pitwall_learning schema
 * into an isolated PGlite database. The fixture is a pg_dump --schema-only
 * (no rows, no owners, no privileges); this loader adds the minimal auth
 * stubs and skips views/comments, which are not on the ingest path.
 *
 * The caller creates the three Supabase roles first (see createRoles).
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

export function splitStatements(sql) {
  const out = [];
  let start = 0;
  let i = 0;
  let inSingle = false;
  let dollar = null;
  while (i < sql.length) {
    const ch = sql[i];
    if (dollar) {
      if (sql.startsWith(dollar, i)) { i += dollar.length; dollar = null; continue; }
      i++; continue;
    }
    if (inSingle) {
      if (ch === "'") {
        if (sql[i + 1] === "'") { i += 2; continue; }
        inSingle = false;
      }
      i++; continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      i = nl < 0 ? sql.length : nl + 1;
      continue;
    }
    if (ch === "'") { inSingle = true; i++; continue; }
    if (ch === "$") {
      const m = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i));
      if (m) { dollar = m[0]; i += dollar.length; continue; }
    }
    if (ch === ";") {
      const stmt = sql.slice(start, i + 1).trim();
      if (stmt) out.push(stmt);
      start = i + 1;
    }
    i++;
  }
  const tail = sql.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

const BASE = /^(SET|SELECT pg_catalog\.set_config|CREATE TYPE|CREATE TABLE|CREATE SEQUENCE|CREATE (UNIQUE )?INDEX|ALTER TABLE|ALTER SEQUENCE|CREATE FUNCTION|CREATE OR REPLACE FUNCTION|CREATE SCHEMA pitwall_learning)/i;
const SECOND = /^(CREATE TRIGGER|CREATE POLICY)/i;
const SKIP = /^(CREATE VIEW|COMMENT ON|CREATE EXTENSION|CREATE SCHEMA public)/i;

export async function createRoles(db) {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE ROLE supabase_admin BYPASSRLS;
  `);
}

export async function loadProductionClone(db, schemaGzPath) {
  const sql = gunzipSync(readFileSync(schemaGzPath)).toString("utf8")
    .replace(/^\\restrict.*$/gm, "")
    .replace(/^\\unrestrict.*$/gm, "");
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE
      AS $$ SELECT current_setting('request.jwt.claim.role', true) $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE SCHEMA extensions;
  `);
  const statements = splitStatements(sql)
    .map((raw) => raw.replace(/^(?:\s*--[^\n]*\n)+/, "").trim())
    .filter(Boolean);
  const failed = [];
  for (const stmt of statements) {
    if (!BASE.test(stmt) || SKIP.test(stmt)) continue;
    try { await db.exec(stmt); } catch (e) { failed.push(`${stmt.slice(0, 120)} :: ${e.message}`); }
  }
  for (const stmt of statements) {
    if (!SECOND.test(stmt)) continue;
    try { await db.exec(stmt); } catch (e) { failed.push(`${stmt.slice(0, 120)} :: ${e.message}`); }
  }
  if (failed.length) throw new Error(`schema clone failed:\n${failed.join("\n")}`);
  // The dump has no owners/privileges; the production migration role owns the
  // schema objects and must be able to run the SECURITY DEFINER bodies.
  await db.exec(`
    GRANT USAGE ON SCHEMA auth TO PUBLIC;
    GRANT USAGE, CREATE ON SCHEMA public, pitwall_learning TO supabase_admin;
    GRANT ALL ON ALL TABLES IN SCHEMA public, pitwall_learning TO supabase_admin;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public, pitwall_learning TO supabase_admin;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, pitwall_learning TO supabase_admin;
  `);
}
