import { Clock, FileText, CheckCircle, XCircle } from "lucide-react";
import type { ElementType } from "react";

// ── Categorie systeem ─────────────────────────────────────────────────────────

export const CATEGORY_PRESETS = {
  A: { penalty_type: "time_penalty",   time_penalty_seconds: 5,  grid_penalty_places: 0, race_ban_next: false, penalty_sp: 1 },
  B: { penalty_type: "time_penalty",   time_penalty_seconds: 10, grid_penalty_places: 0, race_ban_next: false, penalty_sp: 3 },
  C: { penalty_type: "grid_penalty",   time_penalty_seconds: 0,  grid_penalty_places: 3, race_ban_next: false, penalty_sp: 5 },
  D: { penalty_type: "race_ban",       time_penalty_seconds: 0,  grid_penalty_places: 0, race_ban_next: true,  penalty_sp: 10 },
} as const;

export const CATEGORY_META = {
  A: { label: "A — Licht",   desc: "+5 sec · 1 SP",          color: "bg-blue-500/20 text-blue-400 border-blue-500/30",   activeColor: "bg-blue-500 text-white border-blue-500" },
  B: { label: "B — Matig",   desc: "+10 sec · 3 SP",         color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", activeColor: "bg-yellow-500 text-white border-yellow-500" },
  C: { label: "C — Ernstig", desc: "Gridstraf · 5 SP",       color: "bg-orange-500/20 text-orange-400 border-orange-500/30", activeColor: "bg-orange-500 text-white border-orange-500" },
  D: { label: "D — Zwaar",   desc: "Race ban · 10 SP",       color: "bg-red-500/20 text-red-400 border-red-500/30",       activeColor: "bg-red-600 text-white border-red-600" },
};

export const SP_THRESHOLDS = [
  { sp: 6,  label: "Officiële waarschuwing",       color: "text-yellow-400" },
  { sp: 10, label: "1 race ban",                   color: "text-orange-400" },
  { sp: 15, label: "2 race ban",                   color: "text-red-400" },
  { sp: 20, label: "Exclusie rest seizoen",        color: "text-red-600" },
];

// ── Labels ────────────────────────────────────────────────────────────────────

export const statusStyles: Record<string, { color: string; label: string; icon: ElementType }> = {
  pending:      { color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",  label: "In behandeling", icon: Clock },
  under_review: { color: "bg-blue-500/20 text-blue-400 border-blue-500/30",        label: "Onder review",   icon: FileText },
  resolved:     { color: "bg-green-500/20 text-green-400 border-green-500/30",     label: "Afgehandeld",    icon: CheckCircle },
  dismissed:    { color: "bg-muted text-muted-foreground border-border",            label: "Afgewezen",      icon: XCircle },
};

export const penaltyLabels: Record<string, string> = {
  warning:          "Waarschuwing",
  points_deduction: "Puntenaftrek",
  disqualification: "Diskwalificatie",
  time_penalty:     "Tijdstraf",
  grid_penalty:     "Gridstraf",
  race_ban:         "Race ban",
  pit_lane_start:   "Pitlane start",
};

export const PROTEST_DEADLINE_HOURS = 48;

// ── Types ─────────────────────────────────────────────────────────────────────

export type Category = "A" | "B" | "C" | "D" | "";

export interface DecisionState {
  status: string;
  steward_notes: string;
  penalty_category: Category;
  penalty_type: string;
  penalty_sp: number;
  time_penalty_seconds: number;
  grid_penalty_places: number;
  race_ban_next: boolean;
  points_deduction: number;
}

export const EMPTY_DECISION: DecisionState = {
  status: "", steward_notes: "", penalty_category: "",
  penalty_type: "", penalty_sp: 0, time_penalty_seconds: 0,
  grid_penalty_places: 0, race_ban_next: false, points_deduction: 0,
};

export interface StewardActionState {
  race_id: string;
  accused_user_id: string;
  penalty_category: Category;
  description: string;
  penalty_type: string;
  penalty_sp: number;
  time_penalty_seconds: number;
  grid_penalty_places: number;
  race_ban_next: boolean;
  points_deduction: number;
}

export const EMPTY_ACTION: StewardActionState = {
  race_id: "", accused_user_id: "", penalty_category: "", description: "",
  penalty_type: "", penalty_sp: 0, time_penalty_seconds: 0,
  grid_penalty_places: 0, race_ban_next: false, points_deduction: 0,
};

// ── Helper: penalty samenvatting voor weergave ────────────────────────────────

export function buildPenaltySummary(protest: any): string {
  if (protest.status === "dismissed") return "Protest afgewezen";
  if (!protest.penalty_type) return "Geen straf";
  let text = penaltyLabels[protest.penalty_type] || protest.penalty_type;
  if (protest.penalty_type === "time_penalty" && protest.time_penalty_seconds)
    text += ` (+${protest.time_penalty_seconds} sec)`;
  if (protest.penalty_type === "grid_penalty" && protest.grid_penalty_places)
    text += ` (${protest.grid_penalty_places} plaatsen)`;
  if (protest.penalty_type === "points_deduction" && protest.penalty_points > 0)
    text += ` (-${protest.penalty_points} punten)`;
  if (protest.race_ban_next) text += " (volgende race gemist)";
  return text;
}
