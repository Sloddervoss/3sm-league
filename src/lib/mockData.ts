/**
 * mockData.ts — Nep data voor /preview design review
 */

// ── Basis ──────────────────────────────────────────────────────
export const MOCK_LEAGUE = { id: "mock-league-1", name: "GT Master Challenge Cup", season: "2025", car_class: "GT3" };

export const MOCK_TEAMS = [
  { id: "t1", name: "Apex Racing",    color: "#f97316", description: "Het snelste GT3-team van de league" },
  { id: "t2", name: "Midnight Works", color: "#3b82f6", description: "Nacht shift, overdag raceresultaten" },
  { id: "t3", name: "Gravel Kings",   color: "#22c55e", description: "Consistent, snel en gevaarlijk" },
];

export const MOCK_PROFILES = [
  { user_id: "u1", display_name: "Vincent de Vos",   iracing_name: "V. de Vos",    iracing_id: 481231, irating: 3421, safety_rating: "A 4.12", team_id: "t1" },
  { user_id: "u2", display_name: "Sander van Dijk",  iracing_name: "S. van Dijk",  iracing_id: 502847, irating: 2887, safety_rating: "B 3.75", team_id: "t1" },
  { user_id: "u3", display_name: "Lars Hoekstra",    iracing_name: "L. Hoekstra",  iracing_id: 398201, irating: 4105, safety_rating: "A 4.55", team_id: "t2" },
  { user_id: "u4", display_name: "Daan Vermeulen",   iracing_name: "D. Vermeulen", iracing_id: 612954, irating: 1942, safety_rating: "B 3.20", team_id: "t2" },
  { user_id: "u5", display_name: "Thijs Janssen",    iracing_name: "T. Janssen",   iracing_id: 445671, irating: 2214, safety_rating: "C 2.88", team_id: "t3" },
  { user_id: "u6", display_name: "Rick Brouwers",    iracing_name: "R. Brouwers",  iracing_id: 573390, irating: 3650, safety_rating: "A 4.30", team_id: "t3" },
];

export const MOCK_STATS: Record<string, { races: number; wins: number; podiums: number; points: number; incidents: number }> = {
  u1: { races: 5, wins: 2, podiums: 4, points: 107, incidents: 8  },
  u2: { races: 5, wins: 0, podiums: 2, points: 68,  incidents: 12 },
  u3: { races: 5, wins: 1, podiums: 3, points: 92,  incidents: 5  },
  u4: { races: 5, wins: 0, podiums: 1, points: 51,  incidents: 18 },
  u5: { races: 4, wins: 0, podiums: 0, points: 34,  incidents: 22 },
  u6: { races: 5, wins: 2, podiums: 4, points: 115, incidents: 7  },
};

export const MOCK_STANDINGS = [
  { user_id: "u6", display_name: "Rick Brouwers",   total_points: 115, wins: 2, team: { name: "Gravel Kings",   color: "#22c55e" } },
  { user_id: "u1", display_name: "Vincent de Vos",  total_points: 107, wins: 2, team: { name: "Apex Racing",    color: "#f97316" } },
  { user_id: "u3", display_name: "Lars Hoekstra",   total_points: 92,  wins: 1, team: { name: "Midnight Works", color: "#3b82f6" } },
  { user_id: "u2", display_name: "Sander van Dijk", total_points: 68,  wins: 0, team: { name: "Apex Racing",    color: "#f97316" } },
  { user_id: "u4", display_name: "Daan Vermeulen",  total_points: 51,  wins: 0, team: { name: "Midnight Works", color: "#3b82f6" } },
  { user_id: "u5", display_name: "Thijs Janssen",   total_points: 34,  wins: 0, team: { name: "Gravel Kings",   color: "#22c55e" } },
];

// Standings pagina: drivers met extra velden
export const MOCK_STANDINGS_FULL = [
  { user_id: "u6", display_name: "Rick Brouwers",   irating: 3650, points: 115, wins: 2, podiums: 4, races: 5, fastest: 1, incidents: 7,  team: { id: "t3", name: "Gravel Kings",   color: "#22c55e" } },
  { user_id: "u1", display_name: "Vincent de Vos",  irating: 3421, points: 107, wins: 2, podiums: 4, races: 5, fastest: 2, incidents: 8,  team: { id: "t1", name: "Apex Racing",    color: "#f97316" } },
  { user_id: "u3", display_name: "Lars Hoekstra",   irating: 4105, points: 92,  wins: 1, podiums: 3, races: 5, fastest: 1, incidents: 5,  team: { id: "t2", name: "Midnight Works", color: "#3b82f6" } },
  { user_id: "u2", display_name: "Sander van Dijk", irating: 2887, points: 68,  wins: 0, podiums: 2, races: 5, fastest: 0, incidents: 12, team: { id: "t1", name: "Apex Racing",    color: "#f97316" } },
  { user_id: "u4", display_name: "Daan Vermeulen",  irating: 1942, points: 51,  wins: 0, podiums: 1, races: 5, fastest: 0, incidents: 18, team: { id: "t2", name: "Midnight Works", color: "#3b82f6" } },
  { user_id: "u5", display_name: "Thijs Janssen",   irating: 2214, points: 34,  wins: 0, podiums: 0, races: 4, fastest: 1, incidents: 22, team: { id: "t3", name: "Gravel Kings",   color: "#22c55e" } },
];

export const MOCK_TEAM_STANDINGS = [
  { id: "t3", name: "Gravel Kings",   color: "#22c55e", points: 149, wins: 2 },
  { id: "t1", name: "Apex Racing",    color: "#f97316", points: 175, wins: 2 },
  { id: "t2", name: "Midnight Works", color: "#3b82f6", points: 143, wins: 1 },
];

export const MOCK_MEMBERSHIPS = [
  { id: "m1", team_id: "t1", user_id: "u1", role: "driver",  profiles: { user_id: "u1", display_name: "Vincent de Vos",   iracing_name: "V. de Vos",    irating: 3421, safety_rating: "A 4.12", iracing_id: 481231 } },
  { id: "m2", team_id: "t1", user_id: "u2", role: "driver",  profiles: { user_id: "u2", display_name: "Sander van Dijk",  iracing_name: "S. van Dijk",  irating: 2887, safety_rating: "B 3.75", iracing_id: 502847 } },
  { id: "m3", team_id: "t2", user_id: "u3", role: "driver",  profiles: { user_id: "u3", display_name: "Lars Hoekstra",    iracing_name: "L. Hoekstra",  irating: 4105, safety_rating: "A 4.55", iracing_id: 398201 } },
  { id: "m4", team_id: "t2", user_id: "u4", role: "reserve", profiles: { user_id: "u4", display_name: "Daan Vermeulen",   iracing_name: "D. Vermeulen", irating: 1942, safety_rating: "B 3.20", iracing_id: 612954 } },
  { id: "m5", team_id: "t3", user_id: "u5", role: "driver",  profiles: { user_id: "u5", display_name: "Thijs Janssen",    iracing_name: "T. Janssen",   irating: 2214, safety_rating: "C 2.88", iracing_id: 445671 } },
  { id: "m6", team_id: "t3", user_id: "u6", role: "driver",  profiles: { user_id: "u6", display_name: "Rick Brouwers",    iracing_name: "R. Brouwers",  irating: 3650, safety_rating: "A 4.30", iracing_id: 573390 } },
];

// Mock races voor race history
const MOCK_RACES_REF = [
  { id: "r1", name: "Race 1", track: "Summit Point Raceway",                    race_date: "2025-04-02T19:00:00Z", league_id: "mock-league-1", leagues: { name: "GT Master Challenge Cup" } },
  { id: "r2", name: "Race 2", track: "Okayama International Circuit",           race_date: "2025-04-16T19:00:00Z", league_id: "mock-league-1", leagues: { name: "GT Master Challenge Cup" } },
  { id: "r3", name: "Race 3", track: "Lime Rock Park",                          race_date: "2025-04-30T19:00:00Z", league_id: "mock-league-1", leagues: { name: "GT Master Challenge Cup" } },
  { id: "r4", name: "Race 4", track: "Oulton Park Circuit",                     race_date: "2025-05-14T19:00:00Z", league_id: "mock-league-1", leagues: { name: "GT Master Challenge Cup" } },
  { id: "r5", name: "Race 5", track: "Circuit de Spa-Francorchamps",            race_date: "2025-05-28T19:00:00Z", league_id: "mock-league-1", leagues: { name: "GT Master Challenge Cup" } },
];

// Race history per driver (voor DriverProfilePreview)
export const MOCK_DRIVER_RESULTS: Record<string, any[]> = {
  u1: [
    { id: "res-u1-1", user_id: "u1", race_id: "r5", position: 1, points: 25, incidents: 2, fastest_lap: true,  best_lap: "1:42.381", races: MOCK_RACES_REF[4] },
    { id: "res-u1-2", user_id: "u1", race_id: "r4", position: 3, points: 15, incidents: 1, fastest_lap: false, best_lap: "1:28.904", races: MOCK_RACES_REF[3] },
    { id: "res-u1-3", user_id: "u1", race_id: "r3", position: 1, points: 25, incidents: 0, fastest_lap: true,  best_lap: "0:58.741", races: MOCK_RACES_REF[2] },
    { id: "res-u1-4", user_id: "u1", race_id: "r2", position: 4, points: 12, incidents: 3, fastest_lap: false, best_lap: "1:25.113", races: MOCK_RACES_REF[1] },
    { id: "res-u1-5", user_id: "u1", race_id: "r1", position: 2, points: 18, incidents: 2, fastest_lap: false, best_lap: "1:18.552", races: MOCK_RACES_REF[0] },
  ],
  u2: [
    { id: "res-u2-1", user_id: "u2", race_id: "r5", position: 4, points: 12, incidents: 3, fastest_lap: false, best_lap: "1:43.102", races: MOCK_RACES_REF[4] },
    { id: "res-u2-2", user_id: "u2", race_id: "r4", position: 2, points: 18, incidents: 2, fastest_lap: false, best_lap: "1:29.440", races: MOCK_RACES_REF[3] },
    { id: "res-u2-3", user_id: "u2", race_id: "r3", position: 5, points: 10, incidents: 1, fastest_lap: false, best_lap: "0:59.210", races: MOCK_RACES_REF[2] },
    { id: "res-u2-4", user_id: "u2", race_id: "r2", position: 3, points: 15, incidents: 2, fastest_lap: false, best_lap: "1:26.007", races: MOCK_RACES_REF[1] },
    { id: "res-u2-5", user_id: "u2", race_id: "r1", position: 5, points: 10, incidents: 4, fastest_lap: false, best_lap: "1:19.881", races: MOCK_RACES_REF[0] },
  ],
  u3: [
    { id: "res-u3-1", user_id: "u3", race_id: "r5", position: 2, points: 18, incidents: 1, fastest_lap: true,  best_lap: "1:41.998", races: MOCK_RACES_REF[4] },
    { id: "res-u3-2", user_id: "u3", race_id: "r4", position: 4, points: 12, incidents: 0, fastest_lap: false, best_lap: "1:28.640", races: MOCK_RACES_REF[3] },
    { id: "res-u3-3", user_id: "u3", race_id: "r3", position: 2, points: 18, incidents: 1, fastest_lap: false, best_lap: "0:58.920", races: MOCK_RACES_REF[2] },
    { id: "res-u3-4", user_id: "u3", race_id: "r2", position: 1, points: 25, incidents: 0, fastest_lap: false, best_lap: "1:24.831", races: MOCK_RACES_REF[1] },
    { id: "res-u3-5", user_id: "u3", race_id: "r1", position: 3, points: 15, incidents: 3, fastest_lap: false, best_lap: "1:18.770", races: MOCK_RACES_REF[0] },
  ],
  u4: [
    { id: "res-u4-1", user_id: "u4", race_id: "r5", position: 5, points: 10, incidents: 4, fastest_lap: false, best_lap: "1:44.210", races: MOCK_RACES_REF[4] },
    { id: "res-u4-2", user_id: "u4", race_id: "r4", position: 5, points: 10, incidents: 5, fastest_lap: false, best_lap: "1:30.112", races: MOCK_RACES_REF[3] },
    { id: "res-u4-3", user_id: "u4", race_id: "r3", position: 3, points: 15, incidents: 2, fastest_lap: false, best_lap: "0:59.550", races: MOCK_RACES_REF[2] },
    { id: "res-u4-4", user_id: "u4", race_id: "r2", position: 6, points: 8,  incidents: 4, fastest_lap: false, best_lap: "1:27.340", races: MOCK_RACES_REF[1] },
    { id: "res-u4-5", user_id: "u4", race_id: "r1", position: 4, points: 12, incidents: 3, fastest_lap: false, best_lap: "1:19.440", races: MOCK_RACES_REF[0] },
  ],
  u5: [
    { id: "res-u5-1", user_id: "u5", race_id: "r5", position: 6, points: 8,  incidents: 6, fastest_lap: false, best_lap: "1:45.330", races: MOCK_RACES_REF[4] },
    { id: "res-u5-2", user_id: "u5", race_id: "r4", position: 6, points: 8,  incidents: 7, fastest_lap: false, best_lap: "1:31.005", races: MOCK_RACES_REF[3] },
    { id: "res-u5-3", user_id: "u5", race_id: "r2", position: 5, points: 10, incidents: 5, fastest_lap: true,  best_lap: "1:24.550", races: MOCK_RACES_REF[1] },
    { id: "res-u5-4", user_id: "u5", race_id: "r1", position: 6, points: 8,  incidents: 4, fastest_lap: false, best_lap: "1:20.115", races: MOCK_RACES_REF[0] },
  ],
  u6: [
    { id: "res-u6-1", user_id: "u6", race_id: "r5", position: 3, points: 15, incidents: 1, fastest_lap: false, best_lap: "1:42.771", races: MOCK_RACES_REF[4] },
    { id: "res-u6-2", user_id: "u6", race_id: "r4", position: 1, points: 25, incidents: 0, fastest_lap: false, best_lap: "1:27.992", races: MOCK_RACES_REF[3] },
    { id: "res-u6-3", user_id: "u6", race_id: "r3", position: 4, points: 12, incidents: 2, fastest_lap: false, best_lap: "0:59.030", races: MOCK_RACES_REF[2] },
    { id: "res-u6-4", user_id: "u6", race_id: "r2", position: 2, points: 18, incidents: 1, fastest_lap: false, best_lap: "1:25.220", races: MOCK_RACES_REF[1] },
    { id: "res-u6-5", user_id: "u6", race_id: "r1", position: 1, points: 25, incidents: 3, fastest_lap: false, best_lap: "1:18.301", races: MOCK_RACES_REF[0] },
  ],
};

// Race 1 uitslag (voor RaceDetailPreview — "completed" race)
export const MOCK_RACE_DETAIL_RESULTS = [
  { id: "rd1", race_id: "r1", user_id: "u6", position: 1, points: 25, incidents: 3, fastest_lap: false, best_lap: "1:18.301", dnf: false, profiles: { display_name: "Rick Brouwers",   iracing_name: "R. Brouwers", team_id: "t3" } },
  { id: "rd2", race_id: "r1", user_id: "u1", position: 2, points: 18, incidents: 2, fastest_lap: false, best_lap: "1:18.552", dnf: false, profiles: { display_name: "Vincent de Vos",   iracing_name: "V. de Vos",   team_id: "t1" } },
  { id: "rd3", race_id: "r1", user_id: "u3", position: 3, points: 15, incidents: 3, fastest_lap: false, best_lap: "1:18.770", dnf: false, profiles: { display_name: "Lars Hoekstra",    iracing_name: "L. Hoekstra", team_id: "t2" } },
  { id: "rd4", race_id: "r1", user_id: "u4", position: 4, points: 12, incidents: 3, fastest_lap: false, best_lap: "1:19.440", dnf: false, profiles: { display_name: "Daan Vermeulen",   iracing_name: "D. Vermeulen",team_id: "t2" } },
  { id: "rd5", race_id: "r1", user_id: "u2", position: 5, points: 10, incidents: 4, fastest_lap: true,  best_lap: "1:18.221", dnf: false, profiles: { display_name: "Sander van Dijk",  iracing_name: "S. van Dijk", team_id: "t1" } },
  { id: "rd6", race_id: "r1", user_id: "u5", position: 6, points: 8,  incidents: 4, fastest_lap: false, best_lap: "1:20.115", dnf: false, profiles: { display_name: "Thijs Janssen",    iracing_name: "T. Janssen",  team_id: "t3" } },
];

// Alle resultaten gecombineerd (voor TeamProfilePreview)
export const MOCK_ALL_RESULTS = Object.values(MOCK_DRIVER_RESULTS).flat();

// Mock deelnemers voor upcoming race (ingeschreven via race of seizoen)
export const MOCK_RACE_REGISTRANTS = [
  { user_id: "u1", display_name: "Vincent de Vos",  team_id: "t1" },
  { user_id: "u2", display_name: "Sander van Dijk", team_id: "t1" },
  { user_id: "u3", display_name: "Lars Hoekstra",   team_id: "t2" },
  { user_id: "u4", display_name: "Daan Vermeulen",  team_id: "t2" },
  { user_id: "u6", display_name: "Rick Brouwers",   team_id: "t3" },
];
