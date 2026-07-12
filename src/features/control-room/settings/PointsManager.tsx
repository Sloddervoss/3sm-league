import { Check, CircleAlert, RotateCcw, Save, Trophy } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usePointsConfig } from "./usePointsConfig";

/**
 * Native Control Room Points Manager.
 *
 * Real points_config reads and production upserts per league, with a
 * 15-position editor, refetch after save, and local draft reset support.
 */
export const PointsManager = () => {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const canRead = Boolean(user && (isAdmin || isSuperAdmin));
  const {
    leagues,
    leagueId,
    setLeagueId,
    loading,
    error,
    draft,
    updatePosition,
    resetToDefault,
    dirty,
    save,
    saving,
    saveError,
    saveSuccess,
  } = usePointsConfig();

  if (!canRead) {
    return (
      <section className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-6 text-sm text-gray-400">
        <CircleAlert className="mb-2 h-5 w-5 text-orange-300" />
        Meld je aan met een adminrol om puntensystemen te beheren.
      </section>
    );
  }

  return (
    <section aria-label="Puntensysteem beheren" className="space-y-5 text-gray-100">
      <header className="flex flex-col gap-4 border-b border-white/[0.08] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-300">
            Control Room
          </p>
          <h2 className="mt-1 font-heading text-2xl font-black">PUNTENSYSTEEM</h2>
          <p className="mt-1 text-sm text-gray-400">
            Beheer de puntenverdeling per seizoen. Opslaan werkt direct door in de
            productieconfiguratie.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={resetToDefault}
            disabled={!dirty || saving}
            title={dirty ? "Standaardwaarden herstellen (lokaal)" : "Geen wijzigingen om terug te draaien"}
            className="flex items-center gap-1.5 rounded-md border border-white/[0.10] px-3 py-1.5 text-xs font-bold text-gray-200 transition hover:border-orange-400/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Stel terug naar standaard
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || !leagueId || saving}
            title={!dirty ? "Geen wijzigingen om op te slaan" : "Puntensysteem opslaan"}
            className="flex items-center gap-1.5 rounded-md border border-orange-400/40 bg-orange-500/15 px-3 py-1.5 text-xs font-bold text-orange-100 transition hover:border-orange-400 hover:bg-orange-500/25 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "Opslaan…" : "Opslaan"}
          </button>
        </div>
      </header>

      <label className="block max-w-md text-xs font-bold uppercase tracking-wider text-gray-500">
        Seizoen
        <select
          value={leagueId || ""}
          onChange={(event) => setLeagueId(event.target.value || null)}
          disabled={saving}
          className="mt-1.5 block w-full rounded-md border border-white/[0.1] bg-[#151820] px-3 py-2 text-sm font-semibold text-white outline-none focus:border-orange-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="">Kies een seizoen</option>
          {leagues.map((league) => (
            <option key={league.id} value={league.id}>
              {league.name}{league.season ? ` (${league.season})` : ""}
            </option>
          ))}
        </select>
      </label>

      {error && (
        <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {saveError && (
        <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          Opslaan mislukt: {saveError}
        </div>
      )}

      {saveSuccess && (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-500/[0.08] p-3 text-sm text-emerald-100">
          <Check className="h-4 w-4" />
          Puntensysteem opgeslagen en opnieuw geladen.
        </div>
      )}

      {loading && (
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.025] p-6 text-sm text-gray-400">
          Puntensysteem laden…
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            {draft.map((entry) => (
              <label
                key={entry.position}
                className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.015] p-3 transition hover:border-white/[0.14]"
              >
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
                  P{entry.position}
                </span>
                <input
                  type="number"
                  min={0}
                  max={999}
                  value={entry.points}
                  disabled={saving}
                  onChange={(event) =>
                    updatePosition(entry.position, Math.max(0, Math.min(999, Number(event.target.value) || 0)))
                  }
                  className="w-20 rounded-md border border-white/[0.1] bg-[#151820] px-2 py-1.5 text-right text-sm font-bold text-white outline-none focus:border-orange-400 disabled:cursor-not-allowed disabled:opacity-60 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </label>
            ))}
          </div>

          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <Trophy className="h-3.5 w-3.5 text-orange-300/60" />
              <strong className="font-bold text-gray-400">Snelste ronde</strong>
              — Het punt voor de snelste ronde wordt apart toegekend via het
              resultatenimportproces en wordt niet via dit formulier beheerd.
            </span>
          </div>

          {dirty && (
            <div className="rounded-lg border border-orange-400/20 bg-orange-500/[0.06] px-4 py-2 text-xs text-orange-200">
              Er zijn niet-opgeslagen wijzigingen.
            </div>
          )}
        </>
      )}
    </section>
  );
};

export default PointsManager;
