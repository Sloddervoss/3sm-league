import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("production deploy artifact safety", () => {
  const deploy = readFileSync("deploy.sh", "utf8");
  const zipBuilder = readFileSync("scripts/zip-extension.mjs", "utf8");

  it("publishes new hashed assets before HTML without emptying the live webroot", () => {
    expect(deploy).not.toContain("rm -rf /var/www/3sm/*");
    const assetPublish = deploy.indexOf("rsync -a dist/assets/ /var/www/3sm/assets/");
    const htmlPublish = deploy.indexOf("rsync -a --delete-after --exclude='assets/' dist/ /var/www/3sm/");
    expect(assetPublish).toBeGreaterThan(-1);
    expect(htmlPublish).toBeGreaterThan(assetPublish);
  });

  it("keeps old hashed assets available for tabs holding previous HTML", () => {
    expect(deploy).toContain("--exclude='assets/'");
    expect(deploy).not.toContain("--delete-excluded");
  });

  it("builds the tracked extension archive with deterministic metadata", () => {
    expect(zipBuilder).toContain("files = sorted(");
    expect(zipBuilder).toContain("date_time=(1980, 1, 1, 0, 0, 0)");
    expect(zipBuilder).toContain("info.external_attr = (0o100644 & 0xFFFF) << 16");
  });
});
