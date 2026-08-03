import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isActiveRaceRegistration, isRaceLiveForDisplay, isRaceRegistrationOpen } from "@/lib/raceRegistration";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");
const migrationPath = join(root, "supabase/migrations/20260711111500_harden_public_race_registration_writes.sql");
const collapseSql = (sql: string) => sql.replace(/\s+/g, " ").toLowerCase();

describe("public race-registration parity", () => {
  it("opens registration only for explicitly upcoming future races", () => {
    const now = new Date("2026-07-11T12:00:00.000Z");

    expect(isRaceRegistrationOpen({ status: "upcoming", race_date: "2026-07-11T12:01:00.000Z" }, now)).toBe(true);
    expect(isRaceRegistrationOpen({ status: "live", race_date: "2026-07-11T12:01:00.000Z" }, now)).toBe(false);
    expect(isRaceRegistrationOpen({ status: "upcoming", race_date: "2026-07-11T11:59:00.000Z" }, now)).toBe(false);
    expect(isRaceRegistrationOpen({ status: "completed", race_date: "2026-07-12T12:00:00.000Z" }, now)).toBe(false);
  });

  it("never promotes a cancelled race to live based on its start time", () => {
    const now = new Date("2026-07-11T12:00:00.000Z");

    expect(isRaceLiveForDisplay({ status: "upcoming", race_date: "2026-07-11T11:59:00.000Z" }, now)).toBe(true);
    expect(isRaceLiveForDisplay({ status: "live", race_date: "2026-07-11T12:01:00.000Z" }, now)).toBe(true);
    expect(isRaceLiveForDisplay({ status: "cancelled", race_date: "2026-07-11T11:59:00.000Z" }, now)).toBe(false);
    expect(isRaceLiveForDisplay({ status: "completed", race_date: "2026-07-11T11:59:00.000Z" }, now)).toBe(false);

    const calendar = source("src/pages/CalendarPage.tsx");
    const card = source("src/components/preview/NewRaceCard.tsx");
    expect(calendar).toContain("races.find((race) => isRaceLiveForDisplay(race, now))");
    expect(calendar).toContain('race.status !== "completed" && race.status !== "cancelled"');
    expect(card).toContain('cancelled: { label: "Geannuleerd"');
  });

  it("uses the canonical predicate in every live public registration surface", () => {
    for (const path of [
      "src/pages/CalendarPage.tsx",
      "src/components/preview/RaceModal.tsx",
      "src/components/StickyRaceBar.tsx",
      "src/pages/HomepagePrototype.tsx",
      "src/components/UpcomingRaces.tsx",
    ]) {
      expect(source(path)).toContain('from "@/lib/raceRegistration"');
      expect(source(path)).toContain("isRaceRegistrationOpen");
    }
  });

  it("makes withdrawn rows inactive and reactivates them through useRegistration", () => {
    expect(isActiveRaceRegistration("registered")).toBe(true);
    expect(isActiveRaceRegistration("withdrawn")).toBe(false);

    const hook = source("src/lib/useRegistration.ts");
    expect(hook).toContain("isActiveRaceRegistration(r.status)");
    expect(hook).toContain('existing?.status === "withdrawn"');
    expect(hook).toContain('.update({ status: "registered" })');
    expect(hook).not.toContain("car_choice: inheritedLock");
    expect(hook).toContain("database trigger");
  });

  it("hardens self-service writes while retaining privileged Discord and admin paths", () => {
    expect(existsSync(migrationPath), "forward hardening migration must exist").toBe(true);
    const sql = collapseSql(readFileSync(migrationPath, "utf8"));

    expect(sql).toContain("create trigger enforce_race_registration_write");
    expect(sql).toContain("new.status <> 'registered'");
    expect(sql).toContain("new.car_choice is not null");
    expect(sql).toContain("new.car_locked is distinct from false");
    expect(sql).toContain("old.status <> 'withdrawn'");
    expect(sql).toContain("races.status = 'upcoming'");
    expect(sql).toContain("races.race_date > now()");
    expect(sql).toContain("registered_race.league_id = v_league_id");
    expect(sql).toContain("security definer/service-role calls bypass the browser trigger above");
    expect(sql).toContain("values (p_race_id, v_user_id, 'registered', v_inherited_car, v_inherited_car is not null)");
    expect(sql).toContain("when public.race_registrations.car_locked then public.race_registrations.car_choice");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = pg_catalog, public");
    expect(sql).toContain("return 'registration_closed'");
    expect(sql).toContain("revoke all on function public.discord_register_race(text, uuid, text) from public");
    expect(sql).toContain("grant execute on function public.discord_register_race(text, uuid, text) to service_role");
  });
});
