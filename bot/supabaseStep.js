// Eén deadline per Supabase-aanroep, inclusief het lezen van de responsebody.
//
// Aanleiding: de oude grens was 10 s en zat bóven een buitenste grens van 8 s.
// Daardoor gaf de buitenste laag als eerste op, bleef de query doorlopen en
// verscheen twee seconden later een foutregel uit een poging waar niemand meer
// op wachtte. De query werd ook nooit afgebroken.
//
// Deze module is los testbaar: de Supabase-client, de klok en de logfuncties
// worden ingeplugd.

import { formatDuration } from './cronGuard.js';
import { describeError } from './logging.js';

/**
 * @param {object} opts
 * @param {(label: string, ...args: unknown[]) => Promise<void>} opts.log
 * @param {(label: string) => Promise<void>|void} [opts.onSuccess]
 * @param {number} [opts.ms] deadline per aanroep
 */
export function createSupabaseStep({ log, onSuccess = () => {}, ms = 25_000 } = {}) {
  if (typeof log !== 'function') throw new TypeError('createSupabaseStep: log is verplicht');
  if (!Number.isFinite(ms) || ms <= 0) throw new TypeError('createSupabaseStep: ongeldige deadline');

  return async function supabaseStep(label, query, { ms: eigenMs = ms } = {}) {
    const controller = new AbortController();
    // `query` is een fabriek die de AbortSignal krijgt. Zo stopt een afgebroken
    // aanroep de onderliggende fetch echt, in plaats van hem te laten doorlopen.
    const queryPromise = typeof query === 'function' ? query(controller.signal) : query;
    let timer;

    try {
      const grens = new Promise((_, reject) => {
        timer = setTimeout(() => {
          const fout = new Error(`timeout na ${eigenMs} ms: ${label}`);
          fout.name = 'SupabaseTimeoutError';
          fout.subsystem = 'supabase';
          fout.kind = 'timeout';
          controller.abort(fout);
          reject(fout);
        }, eigenMs);
      });

      const result = await Promise.race([queryPromise, grens]);
      if (result?.error) {
        await log(`${label}:${describeError(result.error)}`, `${label} fout:`, describeError(result.error));
      } else {
        await onSuccess(label);
      }
      return result;
    } catch (e) {
      await log(`${label}:${describeError(e)}`, `${label} fout:`, describeError(e));
      return { data: null, error: e };
    } finally {
      clearTimeout(timer);
    }
  };
}

export function beschrijfDeadline(ms) {
  return formatDuration(ms);
}
