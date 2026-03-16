// ─── Demo data for 3 Stripe Motorsport ───────────────────────────────────────

export const DEMO_USER_ID = "demo-admin-0001-0000-000000000001";

export const DEMO_USER = {
  id: DEMO_USER_ID,
  email: "admin@3sm.nl",
  user_metadata: { display_name: "Vincent de Vos" },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  aud: "authenticated",
  role: "authenticated",
};

export const DEMO_SESSION = {
  access_token: "demo-token",
  refresh_token: "demo-refresh",
  expires_in: 3600,
  token_type: "bearer",
  user: DEMO_USER,
};

export function getInitialStore() {
  return {
    profiles: [
      { id: "p1", user_id: DEMO_USER_ID,    display_name: "Vincent de Vos", iracing_name: "V. de Vos",    iracing_id: "412301", irating: 3450, safety_rating: "A 4.50", team_id: "t1", avatar_url: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      { id: "p2", user_id: "driver-0002",    display_name: "Sander Bakker",   iracing_name: "S. Bakker",    iracing_id: "382910", irating: 3120, safety_rating: "A 3.99", team_id: "t1", avatar_url: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      { id: "p3", user_id: "driver-0003",    display_name: "Luca van Dijk",   iracing_name: "L. van Dijk",  iracing_id: "391045", irating: 2890, safety_rating: "B 3.20", team_id: "t2", avatar_url: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      { id: "p4", user_id: "driver-0004",    display_name: "Tom Smeets",      iracing_name: "T. Smeets",    iracing_id: "401233", irating: 3310, safety_rating: "A 4.10", team_id: "t2", avatar_url: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      { id: "p5", user_id: "driver-0005",    display_name: "Niels Hendriks",  iracing_name: "N. Hendriks",  iracing_id: "375542", irating: 2650, safety_rating: "B 2.80", team_id: "t3", avatar_url: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      { id: "p6", user_id: "driver-0006",    display_name: "Bram de Groot",   iracing_name: "B. de Groot",  iracing_id: "388821", irating: 2980, safety_rating: "A 3.60", team_id: "t3", avatar_url: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      { id: "p7", user_id: "driver-0007",    display_name: "Kevin Martens",   iracing_name: "K. Martens",   iracing_id: "402019", irating: 3050, safety_rating: "A 4.00", team_id: null,  avatar_url: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      { id: "p8", user_id: "driver-0008",    display_name: "Daan Visser",     iracing_name: "D. Visser",    iracing_id: "367410", irating: 2420, safety_rating: "C 2.10", team_id: null,  avatar_url: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
    ],

    user_roles: [
      { id: "ur1", user_id: DEMO_USER_ID, role: "admin" },
    ],

    leagues: [
      { id: "league1", name: "GT3 Pro Series", description: "De hoogste klasse van het 3SM kampioenschap", season: "2026 S1", car_class: "GT3", status: "active", created_by: DEMO_USER_ID, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      { id: "league2", name: "GT4 Amateur Cup", description: "Toegankelijk kampioenschap voor gevorderde rijders", season: "2026 S1", car_class: "GT4", status: "upcoming", created_by: DEMO_USER_ID, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
    ],

    races: [
      { id: "race1", league_id: "league1", round: 1, name: "Ronde 1 — Spa-Francorchamps",  track: "Spa-Francorchamps",       race_date: "2026-02-03T20:00:00Z", status: "completed", car: "Ferrari 296 GT3", total_laps: 20, iracing_session_id: "58291001", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      { id: "race2", league_id: "league1", round: 2, name: "Ronde 2 — Monza",              track: "Autodromo di Monza",      race_date: "2026-02-17T20:00:00Z", status: "completed", car: "Ferrari 296 GT3", total_laps: 22, iracing_session_id: "58391002", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      { id: "race3", league_id: "league1", round: 3, name: "Ronde 3 — Silverstone",        track: "Silverstone Circuit",     race_date: "2026-03-03T20:00:00Z", status: "completed", car: "Ferrari 296 GT3", total_laps: 18, iracing_session_id: "58491003", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      { id: "race4", league_id: "league1", round: 4, name: "Ronde 4 — Nürburgring",        track: "Nürburgring GP",          race_date: "2026-03-31T20:00:00Z", status: "upcoming", car: "Ferrari 296 GT3", total_laps: 19, iracing_session_id: null,         created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      { id: "race5", league_id: "league1", round: 5, name: "Ronde 5 — Zandvoort",          track: "Circuit Zandvoort",       race_date: "2026-04-14T20:00:00Z", status: "upcoming", car: "Ferrari 296 GT3", total_laps: 25, iracing_session_id: null,         created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      { id: "race6", league_id: "league1", round: 6, name: "Ronde 6 — Brands Hatch",       track: "Brands Hatch GP",         race_date: "2026-04-28T20:00:00Z", status: "upcoming", car: "Ferrari 296 GT3", total_laps: 21, iracing_session_id: null,         created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
    ],

    race_registrations: [
      { id: "rr1", race_id: "race4", user_id: DEMO_USER_ID, status: "registered", created_at: "2026-03-10T12:00:00Z" },
      { id: "rr2", race_id: "race4", user_id: "driver-0002", status: "registered", created_at: "2026-03-10T12:00:00Z" },
      { id: "rr3", race_id: "race5", user_id: DEMO_USER_ID, status: "registered", created_at: "2026-03-10T12:00:00Z" },
    ],

    race_results: [
      // Race 1 — Spa
      { id: "res1",  race_id: "race1", user_id: DEMO_USER_ID, position: 1, points: 26, fastest_lap: true,  laps: 20, best_lap: "2:17.441", incidents: 0, dnf: false, gap_to_leader: null,    iracing_cust_id: null, created_at: "2026-02-03T22:00:00Z" },
      { id: "res2",  race_id: "race1", user_id: "driver-0004", position: 2, points: 20, fastest_lap: false, laps: 20, best_lap: "2:18.102", incidents: 2, dnf: false, gap_to_leader: "+4.2s",  iracing_cust_id: null, created_at: "2026-02-03T22:00:00Z" },
      { id: "res3",  race_id: "race1", user_id: "driver-0002", position: 3, points: 16, fastest_lap: false, laps: 20, best_lap: "2:18.550", incidents: 1, dnf: false, gap_to_leader: "+9.1s",  iracing_cust_id: null, created_at: "2026-02-03T22:00:00Z" },
      { id: "res4",  race_id: "race1", user_id: "driver-0003", position: 4, points: 13, fastest_lap: false, laps: 20, best_lap: "2:19.210", incidents: 4, dnf: false, gap_to_leader: "+15.3s", iracing_cust_id: null, created_at: "2026-02-03T22:00:00Z" },
      { id: "res5",  race_id: "race1", user_id: "driver-0007", position: 5, points: 11, fastest_lap: false, laps: 20, best_lap: "2:19.880", incidents: 0, dnf: false, gap_to_leader: "+22.0s", iracing_cust_id: null, created_at: "2026-02-03T22:00:00Z" },
      { id: "res6",  race_id: "race1", user_id: "driver-0005", position: 6, points: 10, fastest_lap: false, laps: 20, best_lap: "2:20.441", incidents: 6, dnf: false, gap_to_leader: "+28.4s", iracing_cust_id: null, created_at: "2026-02-03T22:00:00Z" },
      { id: "res7",  race_id: "race1", user_id: "driver-0006", position: 7, points:  9, fastest_lap: false, laps: 20, best_lap: "2:20.990", incidents: 2, dnf: false, gap_to_leader: "+35.1s", iracing_cust_id: null, created_at: "2026-02-03T22:00:00Z" },
      { id: "res8",  race_id: "race1", user_id: "driver-0008", position: 8, points:  8, fastest_lap: false, laps: 19, best_lap: "2:22.100", incidents: 8, dnf: false, gap_to_leader: "+1L",    iracing_cust_id: null, created_at: "2026-02-03T22:00:00Z" },
      // Race 2 — Monza
      { id: "res9",  race_id: "race2", user_id: "driver-0004", position: 1, points: 25, fastest_lap: false, laps: 22, best_lap: "1:44.882", incidents: 0, dnf: false, gap_to_leader: null,    iracing_cust_id: null, created_at: "2026-02-17T22:00:00Z" },
      { id: "res10", race_id: "race2", user_id: DEMO_USER_ID,  position: 2, points: 21, fastest_lap: true,  laps: 22, best_lap: "1:44.210", incidents: 1, dnf: false, gap_to_leader: "+1.8s",  iracing_cust_id: null, created_at: "2026-02-17T22:00:00Z" },
      { id: "res11", race_id: "race2", user_id: "driver-0007", position: 3, points: 16, fastest_lap: false, laps: 22, best_lap: "1:45.551", incidents: 2, dnf: false, gap_to_leader: "+5.5s",  iracing_cust_id: null, created_at: "2026-02-17T22:00:00Z" },
      { id: "res12", race_id: "race2", user_id: "driver-0002", position: 4, points: 13, fastest_lap: false, laps: 22, best_lap: "1:46.001", incidents: 0, dnf: false, gap_to_leader: "+8.2s",  iracing_cust_id: null, created_at: "2026-02-17T22:00:00Z" },
      { id: "res13", race_id: "race2", user_id: "driver-0003", position: 5, points: 11, fastest_lap: false, laps: 22, best_lap: "1:46.330", incidents: 2, dnf: false, gap_to_leader: "+11.1s", iracing_cust_id: null, created_at: "2026-02-17T22:00:00Z" },
      { id: "res14", race_id: "race2", user_id: "driver-0006", position: 6, points: 10, fastest_lap: false, laps: 22, best_lap: "1:47.200", incidents: 0, dnf: false, gap_to_leader: "+18.3s", iracing_cust_id: null, created_at: "2026-02-17T22:00:00Z" },
      { id: "res15", race_id: "race2", user_id: "driver-0005", position: 7, points:  9, fastest_lap: false, laps: 22, best_lap: "1:47.990", incidents: 4, dnf: false, gap_to_leader: "+24.0s", iracing_cust_id: null, created_at: "2026-02-17T22:00:00Z" },
      { id: "res16", race_id: "race2", user_id: "driver-0008", position: 8, points:  8, fastest_lap: false, laps: 21, best_lap: "1:49.100", incidents: 6, dnf: false, gap_to_leader: "+1L",    iracing_cust_id: null, created_at: "2026-02-17T22:00:00Z" },
      // Race 3 — Silverstone
      { id: "res17", race_id: "race3", user_id: DEMO_USER_ID,  position: 1, points: 25, fastest_lap: false, laps: 18, best_lap: "1:59.001", incidents: 0, dnf: false, gap_to_leader: null,    iracing_cust_id: null, created_at: "2026-03-03T22:00:00Z" },
      { id: "res18", race_id: "race3", user_id: "driver-0002", position: 2, points: 21, fastest_lap: true,  laps: 18, best_lap: "1:58.440", incidents: 0, dnf: false, gap_to_leader: "+2.1s",  iracing_cust_id: null, created_at: "2026-03-03T22:00:00Z" },
      { id: "res19", race_id: "race3", user_id: "driver-0004", position: 3, points: 16, fastest_lap: false, laps: 18, best_lap: "2:00.110", incidents: 2, dnf: false, gap_to_leader: "+6.8s",  iracing_cust_id: null, created_at: "2026-03-03T22:00:00Z" },
      { id: "res20", race_id: "race3", user_id: "driver-0003", position: 4, points: 13, fastest_lap: false, laps: 18, best_lap: "2:00.880", incidents: 4, dnf: false, gap_to_leader: "+14.2s", iracing_cust_id: null, created_at: "2026-03-03T22:00:00Z" },
      { id: "res21", race_id: "race3", user_id: "driver-0006", position: 5, points: 11, fastest_lap: false, laps: 18, best_lap: "2:01.220", incidents: 0, dnf: false, gap_to_leader: "+19.5s", iracing_cust_id: null, created_at: "2026-03-03T22:00:00Z" },
      { id: "res22", race_id: "race3", user_id: "driver-0007", position: 6, points: 10, fastest_lap: false, laps: 18, best_lap: "2:01.990", incidents: 2, dnf: false, gap_to_leader: "+27.1s", iracing_cust_id: null, created_at: "2026-03-03T22:00:00Z" },
      { id: "res23", race_id: "race3", user_id: "driver-0005", position: 7, points:  9, fastest_lap: false, laps: 18, best_lap: "2:02.550", incidents: 2, dnf: false, gap_to_leader: "+31.0s", iracing_cust_id: null, created_at: "2026-03-03T22:00:00Z" },
      { id: "res24", race_id: "race3", user_id: "driver-0008", position: 8, points:  0, fastest_lap: false, laps: 10, best_lap: "2:05.100", incidents: 12, dnf: true,  gap_to_leader: "DNF",   iracing_cust_id: null, created_at: "2026-03-03T22:00:00Z" },
    ],

    teams: [
      { id: "t1", name: "Apex Racing",    color: "#f97316", description: "Het snelste team van het grid",          logo_url: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      { id: "t2", name: "Dutch Lions RT", color: "#3b82f6", description: "Trots vertegenwoordiger van Nederland",  logo_url: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      { id: "t3", name: "Night Shift RC", color: "#8b5cf6", description: "Altijd bereikbaar, altijd snel",         logo_url: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
    ],

    team_memberships: [
      { id: "tm1", user_id: DEMO_USER_ID,  team_id: "t1", role: "driver",  created_at: "2026-01-01T00:00:00Z" },
      { id: "tm2", user_id: "driver-0002", team_id: "t1", role: "driver",  created_at: "2026-01-01T00:00:00Z" },
      { id: "tm3", user_id: "driver-0003", team_id: "t2", role: "driver",  created_at: "2026-01-01T00:00:00Z" },
      { id: "tm4", user_id: "driver-0004", team_id: "t2", role: "driver",  created_at: "2026-01-01T00:00:00Z" },
      { id: "tm5", user_id: "driver-0005", team_id: "t3", role: "driver",  created_at: "2026-01-01T00:00:00Z" },
      { id: "tm6", user_id: "driver-0006", team_id: "t3", role: "reserve", created_at: "2026-01-01T00:00:00Z" },
    ],

    protests: [
      { id: "prot1", race_id: "race1", reporter_user_id: "driver-0003", accused_user_id: "driver-0005", lap_number: 8, description: "Buitenspoor gaan in bocht 1 en mij van de baan geduwd bij het remmen. Duidelijk te zien in de video.", video_link: null, status: "resolved", steward_notes: "Incident onderzocht. Driver 0005 krijgt een waarschuwing. Geen puntenaftrek.", created_at: "2026-02-04T10:00:00Z", updated_at: "2026-02-05T14:00:00Z" },
      { id: "prot2", race_id: "race2", reporter_user_id: "driver-0007", accused_user_id: "driver-0003", lap_number: 14, description: "Onnodig inhalen onder een gele vlag. Heb er flink last van gehad in mijn race.", video_link: null, status: "pending", steward_notes: null, created_at: "2026-02-18T09:00:00Z", updated_at: "2026-02-18T09:00:00Z" },
    ],

    penalties: [
      { id: "pen1", protest_id: "prot1", race_id: "race1", user_id: "driver-0005", penalty_type: "warning", time_penalty_seconds: 0, points_deduction: 0, reason: "Onveilig rijgedrag bocht 1", applied_by: DEMO_USER_ID, created_at: "2026-02-05T14:00:00Z" },
    ],

    team_creation_requests: [],

    season_registrations: [
      { id: "sr1", league_id: "league1", user_id: DEMO_USER_ID,  status: "registered", created_at: "2026-01-15T10:00:00Z" },
      { id: "sr2", league_id: "league1", user_id: "driver-0002",  status: "registered", created_at: "2026-01-15T11:00:00Z" },
      { id: "sr3", league_id: "league1", user_id: "driver-0003",  status: "registered", created_at: "2026-01-16T09:00:00Z" },
      { id: "sr4", league_id: "league1", user_id: "driver-0004",  status: "registered", created_at: "2026-01-16T10:00:00Z" },
      { id: "sr5", league_id: "league1", user_id: "driver-0005",  status: "registered", created_at: "2026-01-17T12:00:00Z" },
      { id: "sr6", league_id: "league1", user_id: "driver-0006",  status: "registered", created_at: "2026-01-17T13:00:00Z" },
      { id: "sr7", league_id: "league1", user_id: "driver-0007",  status: "registered", created_at: "2026-01-18T08:00:00Z" },
      { id: "sr8", league_id: "league1", user_id: "driver-0008",  status: "registered", created_at: "2026-01-18T09:00:00Z" },
    ],

    points_config: [
      { id: "pc1",  league_id: "league1", position:  1, points: 25 },
      { id: "pc2",  league_id: "league1", position:  2, points: 20 },
      { id: "pc3",  league_id: "league1", position:  3, points: 16 },
      { id: "pc4",  league_id: "league1", position:  4, points: 13 },
      { id: "pc5",  league_id: "league1", position:  5, points: 11 },
      { id: "pc6",  league_id: "league1", position:  6, points: 10 },
      { id: "pc7",  league_id: "league1", position:  7, points:  9 },
      { id: "pc8",  league_id: "league1", position:  8, points:  8 },
      { id: "pc9",  league_id: "league1", position:  9, points:  7 },
      { id: "pc10", league_id: "league1", position: 10, points:  6 },
    ],
  };
}
