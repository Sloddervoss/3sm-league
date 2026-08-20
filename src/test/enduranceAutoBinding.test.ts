import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mig = readFileSync("supabase/migrations/20260806103000_endurance_auto_binding.sql", "utf8");
const rollback = readFileSync("supabase/rollback/20260806103000_endurance_auto_binding.rollback.sql", "utf8");
const types = readFileSync("src/integrations/supabase/types.ts", "utf8");
const panel = readFileSync("src/features/endurance/devices/DeviceAssignmentPanel.tsx", "utf8");

describe("endurance auto-bind device -> team via lidmaatschap", () => {
  it("voegt de bronmarkering toe en markeert bestaande bindings als manual", () => {
    expect(mig).toContain("endurance_binding_source TEXT");
    expect(mig).toContain("SET endurance_binding_source = 'manual'");
    expect(mig).toContain("endurance_team_members");
    expect(mig).toContain("ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()");
  });

  it("laat handmatige toewijzing de default overrulen (manual = leidend)", () => {
    expect(mig).toContain("endurance_binding_source = 'manual'");
    expect(mig).toContain("IF v_source = 'manual' THEN");
    expect(mig).toContain("auto");
  });

  it("definieert de trigger op insert én delete en verwijst oproepbaar", () => {
    expect(mig).toContain("CREATE OR REPLACE FUNCTION public.endurance_auto_bind_member_device()");
    expect(mig).toContain("CREATE TRIGGER trg_endurance_auto_bind");
    expect(mig).toContain("AFTER INSERT OR DELETE ON public.endurance_team_members");
    expect(mig).toContain("EXECUTE FUNCTION public.endurance_auto_bind_member_device()");
  });

  it("heeft een retourneerbare rollback", () => {
    expect(rollback).toContain("DROP TRIGGER IF EXISTS trg_endurance_auto_bind");
    expect(rollback).toContain("DROP FUNCTION IF EXISTS public.endurance_auto_bind_member_device");
    expect(rollback).toContain("DROP COLUMN IF EXISTS endurance_binding_source");
  });

  it("type + panel weerspiegelen de nieuwe binding", () => {
    expect(types).toContain("endurance_binding_source: string | null");
    expect(panel).toContain("auto-bind");
    expect(panel).toContain("OVERRIDE");
  });
});
