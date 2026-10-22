// Tijdsbewaking voor cron-taken en netwerkaanroepen.
//
// Aanleiding: op 2026-10-22 bleef `syncTeamRoles` vanaf 06:00 hangen op een
// Discord-aanroep die nooit antwoord gaf. Omdat de lock gevuld bleef, sloeg
// elke volgende run twaalf uur lang over.
//
// Dit bestand is de ENIGE implementatie van de bewaking. De planner die de bot
// gebruikt (createGuardedRunner) staat hier ook, zodat wat getest wordt precies
// is wat draait.
//
// Dependency-vrij: geen discord.js, geen Supabase, geen env.

/** Fout die alleen door withTimeout wordt gegooid. */
export class TimeoutError extends Error {
  constructor(label, ms) {
    super(`${label} timeout na ${formatDuration(ms)}`);
    this.name = 'TimeoutError';
    this.code = 'ETIMEOUT';
  }
}

/**
 * Fout voor de harde grens van een hele taak, los van een time-out op één
 * aanroep. Zonder dit onderscheid meldt een Discord-aanroep die na 20 seconden
 * afbreekt dat de hele taak na 15 minuten is afgebroken, en verdwijnt de echte
 * fout uit het log.
 */
export class TaskTimeoutError extends TimeoutError {
  constructor(label, ms) {
    super(label, ms);
    this.name = 'TaskTimeoutError';
    this.code = 'ETIMEOUT_TASK';
  }
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'onbekend';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}u ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Wacht op `promise`, maar geeft na `ms` op met een TimeoutError.
 *
 * De onderliggende promise wordt niet geannuleerd — dat kan niet in JavaScript.
 * De aanroeper gaat verder in plaats van oneindig te wachten. Een late reject
 * is veilig: Promise.race heeft de promise dan al van een handler voorzien.
 */
export async function withTimeout(promise, ms, label, ErrorClass = TimeoutError) {
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new TypeError(`withTimeout: ongeldige termijn ${ms}`);
  }

  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new ErrorClass(label, ms)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Roep een callback aan zonder de aanroeper te laten vallen. */
function safeCall(callback, ...args) {
  if (typeof callback !== 'function') return;
  try {
    callback(...args);
  } catch (error) {
    console.warn(`[cronGuard] callback faalde: ${error?.message || error}`);
  }
}

/**
 * Bewaker voor één taaknaam.
 *
 * De staat is per run, niet per bewaker. Daardoor kan een achtergebleven run de
 * staat van een nieuwe run niet overschrijven, en vertelt isRunning() altijd de
 * waarheid.
 */
export function createJobGuard({
  maxRuntimeMs,
  stuckWarningMs = 0,
  onStuck,
  onTimeout,
} = {}) {
  if (!Number.isFinite(maxRuntimeMs) || maxRuntimeMs <= 0) {
    throw new TypeError('createJobGuard: maxRuntimeMs moet een positief getal zijn');
  }

  let currentRun = null;
  let generation = 0;

  return {
    isRunning() {
      return currentRun !== null;
    },

    getState() {
      return currentRun ? { ...currentRun } : null;
    },

    getGeneration() {
      return generation;
    },

    async run(task) {
      if (typeof task !== 'function') {
        throw new TypeError('createJobGuard.run: task moet een functie zijn');
      }
      if (currentRun !== null) {
        return { ok: false, skipped: true, error: null, timedOut: false };
      }

      generation += 1;
      const runState = {
        generation,
        startedAt: Date.now(),
        step: 'gestart',
        finished: false,
      };
      currentRun = runState;

      const warningTimer = stuckWarningMs > 0
        ? setTimeout(() => {
            if (runState.finished) return;
            safeCall(onStuck, {
              step: runState.step,
              elapsedMs: Date.now() - runState.startedAt,
              generation: runState.generation,
            });
          }, stuckWarningMs)
        : null;

      const ctx = {
        generation: runState.generation,
        get step() {
          return runState.step;
        },
        setStep(step) {
          if (runState.finished) return;
          if (step) runState.step = step;
        },
        /** True als deze run niet meer de actieve is. */
        isStale() {
          return runState.finished || currentRun !== runState;
        },
      };

      try {
        await withTimeout(task(ctx), maxRuntimeMs, 'taak', TaskTimeoutError);
        return { ok: true, skipped: false, error: null, timedOut: false };
      } catch (error) {
        // Alleen de harde taakgrens is een taak-time-out. Een aanroep die zijn
        // eigen termijn heeft bereikt is een gewone fout van de taak.
        const timedOut = error instanceof TaskTimeoutError;
        if (timedOut) safeCall(onTimeout, { error, generation: runState.generation });
        return { ok: false, skipped: false, error, timedOut };
      } finally {
        if (warningTimer) clearTimeout(warningTimer);
        runState.finished = true;
        if (currentRun === runState) currentRun = null;
      }
    },
  };
}

/**
 * De planner: één bewaker per taaknaam, met overlap-afwijzing.
 *
 * Dit is wat de bot gebruikt. De logfuncties zijn injecteerbaar, zodat het
 * gedrag te testen is zonder Discord.
 */
export function createGuardedRunner({
  maxRuntimeMs,
  stuckWarningMs = 0,
  logOverlap,
  logStuck,
  logTimeout,
  logError,
} = {}) {
  const guards = new Map();

  function guardFor(name) {
    let guard = guards.get(name);
    if (!guard) {
      guard = createJobGuard({
        maxRuntimeMs,
        stuckWarningMs,
        onStuck: (info) => safeCall(logStuck, name, info),
        onTimeout: () => safeCall(logTimeout, name),
      });
      guards.set(name, guard);
    }
    return guard;
  }

  return {
    isRunning(name) {
      return guardFor(name).isRunning();
    },

    async runGuarded(name, task) {
      const guard = guardFor(name);
      const state = guard.getState();

      if (state) {
        safeCall(logOverlap, name, state);
        return { ok: false, skipped: true, error: null, timedOut: false };
      }

      const result = await guard.run(task);
      if (!result.ok && !result.skipped && !result.timedOut) {
        safeCall(logError, name, result.error);
      }
      return result;
    },
  };
}
