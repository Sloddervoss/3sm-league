import { supabase } from "@/integrations/supabase/client";

/**
 * 3SM Endurance — data-access-contract (Fase 3)
 * ============================================================================
 * VEILIGHEIDSCHECKER-CONTRACT voor alle Supabase-toegang in de Endurance-tab.
 *
 * HARD E REGELS:
 * 1. Uitsluitend lezen/schrijven op `endurance_*`-tabellen.
 *    NOOIT op races, teams, profiles, seasons, simhub_*, community_support_*,
 *    announcements, race_registrations, etc.
 * 2. Alle toegang loopt door de browser-sessie van de ingelogde super-admin.
 *    De RLS op endurance_* tables staat alleen super_admin toe (zie Fase 2).
 *    Als de RLS een niet-super-admin weigert, faalt de query — dat is correct
 *    en bedoeld; er is GEEN fallback naar seed/lokaal op de canary.
 * 3. Geen service_role key in de frontend. Geen SECURITY DEFINER RPC's die
 *    endurance op bestaande data laten schrijven.
 * 4. Alleen fatsoenlijke querys via supabase-js; geen RAW SQL, geen fetch naar
 *    andere origins.
 * 5. Elke data-read/mutation-locatie draaide een expliciet kolommen- of
 *    typecontrole tegen src/integrations/supabase/types.ts.
 *
 * Dit bestand staat de types + vierkant-contracten centraal; concrete queries
 * leven in module-specifieke repositories (endurance/repository/).
 */

// Wrapper die per constructie alleen endurance_-tabellen toestaat. Wordt in de
// repository gebruikt en compileert als er een niet-endurance-tabelnaam wordt
// doorgegeven (Typescript-veiligheid).
export type EnduranceOnlyTableName =
  | "endurance_events"
  | "endurance_registrations"
  | "endurance_availability"
  | "endurance_pace_entries"
  | "endurance_teams"
  | "endurance_team_members"
  | "endurance_stints"
  | "endurance_planning_versions"
  | "endurance_confirmations"
  | "endurance_notifications"
  | "endurance_audit_log"
  | "endurance_practice_sessions"
  | "endurance_practice_laps"
  | "endurance_race_control_audit"
  | "endurance_realtime_stream"
  | "endurance_iracing_events"
  | "endurance_iracing_event_slots"
  | "endurance_iracing_sync_runs";

export const assertEnduranceTable = (table: string): EnduranceOnlyTableName => {
  if (!table.startsWith("endurance_")) {
    throw new Error(`Endurance data-access weigert tabel "${table}": alleen endurance_*-tabellen zijn toegestaan.`);
  }
  return table as EnduranceOnlyTableName;
};

/** Supabase client die de Endurance-repositories mogen gebruiken. */
export const enduranceClient = () => supabase;

/** Genereer een Supabase-Realtime channel-naam namespaced voor endurance. */
export const enduranceChannel = (suffix: string) => `endurance:${suffix}`;
