import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The worker image inherits the supabase/postgres healthcheck
 * (`pg_isready -U postgres -h localhost`). The worker container runs no
 * database, so that test can only ever report unhealthy. The deployment
 * template must override it with the same PG* variables the worker uses.
 */
describe("pitwall learning worker deployment", () => {
  const compose = readFileSync(
    resolve(process.cwd(), "deploy/pitwall-learning.compose.yml"),
    "utf8",
  );
  const healthcheck = compose.slice(
    compose.indexOf("healthcheck:"),
    compose.indexOf("restart:"),
  );

  it("healthchecks the configured PostgreSQL host, not localhost", () => {
    expect(healthcheck).toContain("pg_isready");
    expect(healthcheck).toContain('"$${PGHOST:-supabase-db}"');
    expect(healthcheck).not.toMatch(/\blocalhost\b/);
  });

  it("does not healthcheck with the database image's postgres superuser", () => {
    expect(healthcheck).not.toMatch(/-U\s+postgres\b/);
    expect(healthcheck).toContain('"$${PGUSER:-pitwall_learning_worker}"');
  });

  it("overrides the inherited short interval with a bounded, realistic one", () => {
    expect(healthcheck).toMatch(/interval:\s*30s/);
    expect(healthcheck).toMatch(/timeout:\s*5s/);
    expect(healthcheck).toMatch(/retries:\s*3/);
    expect(healthcheck).toMatch(/start_period:\s*30s/);
  });
});
