import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const timer = readFileSync("ops/systemd/3sm-iracing-endurance-sync.timer", "utf8");
const service = readFileSync("ops/systemd/3sm-iracing-endurance-sync.service", "utf8");
const script = readFileSync("scripts/sync-iracing-endurance-events.sh", "utf8");
const installer = readFileSync("scripts/install-iracing-endurance-sync-timer.sh", "utf8");

describe("dagelijkse iRacing Special Events scheduler", () => {
  it("draait dagelijks persistent met een kleine spreiding", () => {
    expect(timer).toContain("OnCalendar=*-*-* 04:15:00 Europe/Amsterdam");
    expect(timer).toContain("Persistent=true");
    expect(timer).toContain("RandomizedDelaySec=5m");
    expect(timer).not.toContain("OnCalendar=Mon");
  });

  it("roept uitsluitend de beveiligde deterministische Edge-sync aan", () => {
    expect(service).toContain("ExecStart=/usr/bin/bash /usr/local/libexec/3sm-iracing-endurance-sync");
    expect(service).not.toContain("/opt/3sm");
    expect(service).toContain("EnvironmentFile=/etc/3sm/iracing-endurance-sync.env");
    expect(script).toContain("ENDURANCE_IRACING_SYNC_TOKEN");
    expect(script).toContain("Authorization: Bearer");
    expect(`${timer}\n${service}\n${script}\n${installer}`.toLowerCase()).not.toMatch(/hermes|openai|anthropic|\bai\b/);
    expect(installer).toContain("stat -c '%a'");
    expect(installer).toContain('REPO_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)');
    expect(installer).toContain("/usr/local/libexec/3sm-iracing-endurance-sync");
    expect(installer).toContain("3sm-iracing-endurance-sync.service");
    expect(installer).toContain("systemctl start 3sm-iracing-endurance-sync.service");
    expect(installer).toContain("systemctl enable --now 3sm-iracing-endurance-sync.timer");
  });
});
