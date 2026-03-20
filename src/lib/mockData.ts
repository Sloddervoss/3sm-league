/**
 * mockData.ts — Nep data voor /preview design review
 * Gebruik MOCK_MODE=true in PreviewPage om dit te activeren.
 */

export const MOCK_TEAMS = [
  { id: "t1", name: "Apex Racing",    color: "#f97316", description: "Het snelste GT3-team van de league" },
  { id: "t2", name: "Midnight Works", color: "#3b82f6", description: "Nacht shift, overdag raceresultaten" },
  { id: "t3", name: "Gravel Kings",   color: "#22c55e", description: "Consistent, snel en gevaarlijk" },
];

export const MOCK_PROFILES = [
  { user_id: "u1", display_name: "Vincent de Vos",   iracing_name: "V. de Vos",    irating: 3421, safety_rating: "A 4.12", team_id: "t1" },
  { user_id: "u2", display_name: "Sander van Dijk",  iracing_name: "S. van Dijk",  irating: 2887, safety_rating: "B 3.75", team_id: "t1" },
  { user_id: "u3", display_name: "Lars Hoekstra",    iracing_name: "L. Hoekstra",  irating: 4105, safety_rating: "A 4.55", team_id: "t2" },
  { user_id: "u4", display_name: "Daan Vermeulen",   iracing_name: "D. Vermeulen", irating: 1942, safety_rating: "B 3.20", team_id: "t2" },
  { user_id: "u5", display_name: "Thijs Janssen",    iracing_name: "T. Janssen",   irating: 2214, safety_rating: "C 2.88", team_id: "t3" },
  { user_id: "u6", display_name: "Rick Brouwers",    iracing_name: "R. Brouwers",  irating: 3650, safety_rating: "A 4.30", team_id: "t3" },
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

export const MOCK_MEMBERSHIPS = [
  { id: "m1", team_id: "t1", user_id: "u1", role: "driver",  profiles: { display_name: "Vincent de Vos",   iracing_name: "V. de Vos"    } },
  { id: "m2", team_id: "t1", user_id: "u2", role: "driver",  profiles: { display_name: "Sander van Dijk",  iracing_name: "S. van Dijk"  } },
  { id: "m3", team_id: "t2", user_id: "u3", role: "driver",  profiles: { display_name: "Lars Hoekstra",    iracing_name: "L. Hoekstra"  } },
  { id: "m4", team_id: "t2", user_id: "u4", role: "reserve", profiles: { display_name: "Daan Vermeulen",   iracing_name: "D. Vermeulen" } },
  { id: "m5", team_id: "t3", user_id: "u5", role: "driver",  profiles: { display_name: "Thijs Janssen",    iracing_name: "T. Janssen"   } },
  { id: "m6", team_id: "t3", user_id: "u6", role: "driver",  profiles: { display_name: "Rick Brouwers",    iracing_name: "R. Brouwers"  } },
];
