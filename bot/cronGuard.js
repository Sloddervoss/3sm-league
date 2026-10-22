// Tijdsbewaking voor cron-taken en netwerkaanroepen.
//
// Aanleiding: op 2026-10-22 bleef `syncTeamRoles` vanaf 06:00 hangen op een
// Discord-aanroep die nooit antwoord gaf. Omdat `runningJobs` gevuld bleef,
// sloeg elke volgende run twaalf uur lang over. Twee gaten:
//
//   1. geen time-out op individuele Discord-aanroepen;
//   2. geen harde bovengrens op de looptijd van een taak.
//
// Dit bestand levert beide. Het is bewust dependency-vrij zodat het los te
// testen is zonder Discord-client of database.

export function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}u ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Wacht op `promise`, maar geeft na `ms` op met een fout.
 *
 * De onderliggende promise wordt niet geannuleerd — dat kan niet in JavaScript.
 * Wat er wel gebeurt: de aanroeper gaat verder in plaats van oneindig te wachten.
 * Bij een hangende socket is dat precies wat nodig is.
 */
export async function withTimeout(promise, ms, label) {
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${label} timeout na ${formatDuration(ms)}`)),
      ms
    );
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Bouwt een bewaker voor één cron-taak.
 *
 * `state` wordt gevuld zolang de taak loopt en geleegd als hij klaar is of
 * vastloopt. `isRunning()` vertelt de planner of een nieuwe run mag starten.
 *
 * De harde grens is het vangnet: ook als een aanroep geen eigen time-out heeft,
 * komt `state` nooit permanent vast te staan.
 */
export function createJobGuard({ maxRuntimeMs, stuckWarningMs, onStuck, onTimeout }) {
  let state = null;

  return {
    getState() {
      return state;
    },

    isRunning() {
      return state !== null;
    },

    /**
     * Voert `task` uit met tijdsbewaking. Geeft `{ ok, error, timedOut }` terug
     * in plaats van te gooien, zodat de planner altijd verder kan.
     */
    async run(task) {
      state = { startedAt: Date.now(), step: 'gestart' };

      const warningTimer = stuckWarningMs
        ? setTimeout(() => {
            if (!state) return;
            onStuck?.({
              step: state.step,
              elapsedMs: Date.now() - state.startedAt,
            });
          }, stuckWarningMs)
        : null;

      try {
        await withTimeout(
          task({
            setStep(step) {
              if (state && step) state.step = step;
            },
            get step() {
              return state ? state.step : null;
            },
          }),
          maxRuntimeMs,
          'taak'
        );
        return { ok: true, error: null, timedOut: false };
      } catch (error) {
        const timedOut = /timeout na/.test(error?.message || '');
        if (timedOut) onTimeout?.({ error });
        return { ok: false, error, timedOut };
      } finally {
        if (warningTimer) clearTimeout(warningTimer);
        state = null;
      }
    },
  };
}
