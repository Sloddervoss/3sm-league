/**
 * SeasonBanner — seizoensinschrijving card boven de kalender
 */
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, CheckCircle2, LogIn, LogOut, Loader2, AlertCircle } from "lucide-react";

interface Props {
  leagueId: string;
  leagueName?: string;
  season?: string;
  carClass?: string;
  registrantCount: number;
  isRegistered: boolean;
  profileComplete: boolean;
  isLoading?: boolean;
  onRegister: () => void;
  onUnregister: () => void;
}

const SeasonBanner = ({
  leagueId,
  leagueName,
  season,
  carClass,
  registrantCount,
  isRegistered,
  profileComplete,
  isLoading,
  onRegister,
  onUnregister,
}: Props) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-2xl mb-6 p-5"
      style={{
        background: "linear-gradient(135deg, #111118 0%, #0d0d14 100%)",
        border: isRegistered
          ? "1px solid rgba(34,197,94,0.25)"
          : "1px solid rgba(249,115,22,0.2)",
      }}
    >
      {/* Top accent bar */}
      <div
        className="absolute top-0 left-0 right-0 h-0.5"
        style={{
          background: isRegistered
            ? "linear-gradient(90deg, #22c55e, transparent)"
            : "linear-gradient(90deg, #f97316, transparent)",
        }}
      />

      <div className="flex items-center justify-between gap-4">
        {/* Left: info */}
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: isRegistered ? "rgba(34,197,94,0.12)" : "rgba(249,115,22,0.1)",
              border: isRegistered ? "1px solid rgba(34,197,94,0.25)" : "1px solid rgba(249,115,22,0.2)",
            }}
          >
            <Trophy className="w-4 h-4" style={{ color: isRegistered ? "#22c55e" : "#f97316" }} />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-heading font-black text-sm text-white truncate">
                {leagueName || "Seizoen"}
              </span>
              {season && (
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                  style={{ background: "rgba(255,255,255,0.05)", color: "#6b7280" }}
                >
                  {season}
                </span>
              )}
              {carClass && (
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                  style={{ background: "rgba(249,115,22,0.1)", color: "#f97316" }}
                >
                  {carClass}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-[11px] text-gray-600">
                {registrantCount} ingeschreven voor seizoen
              </span>
              {isRegistered && (
                <span className="flex items-center gap-1 text-[11px] font-bold text-green-400">
                  <CheckCircle2 className="w-3 h-3" />
                  Jij ook
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right: button */}
        <div className="shrink-0">
          {!profileComplete ? (
            <div className="flex items-center gap-1.5 text-[11px] text-yellow-500/80 px-3 py-2 rounded-xl"
              style={{ background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.15)" }}>
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Profiel incompleet</span>
            </div>
          ) : isRegistered ? (
            <button
              onClick={onUnregister}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl transition-all text-sm font-bold"
              style={{
                background: "rgba(34,197,94,0.1)",
                border: "1px solid rgba(34,197,94,0.25)",
                color: "#22c55e",
                opacity: isLoading ? 0.6 : 1,
              }}
            >
              {isLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <LogOut className="w-3.5 h-3.5" />
              )}
              Uitschrijven
            </button>
          ) : (
            <button
              onClick={onRegister}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl transition-all text-sm font-bold"
              style={{
                background: "rgba(249,115,22,0.15)",
                border: "1px solid rgba(249,115,22,0.3)",
                color: "#f97316",
                opacity: isLoading ? 0.6 : 1,
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = "rgba(249,115,22,0.25)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = "rgba(249,115,22,0.15)";
              }}
            >
              {isLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <LogIn className="w-3.5 h-3.5" />
              )}
              Schrijf in voor seizoen
            </button>
          )}
        </div>
      </div>

      {/* Registered → subtle glow */}
      {isRegistered && (
        <div
          className="absolute inset-0 pointer-events-none rounded-2xl"
          style={{ boxShadow: "inset 0 0 40px rgba(34,197,94,0.04)" }}
        />
      )}
    </motion.div>
  );
};

export default SeasonBanner;
