/**
 * Ordening van pollantwoorden. De pitwall pollt elke seconde; twee requests
 * kunnen in omgekeerde volgorde terugkomen. Een ouder antwoord mag het nieuwere
 * beeld niet overschrijven, ook niet als de server intussen al verder is.
 *
 * De vergelijking is bewust conservatief: alleen een harde, bekende orde
 * (zelfde sessie + lagere sequence, of een oudere capturedAt) maakt een
 * antwoord ouder. Ontbrekende velden zijn "onbekend" en blokkeren niets.
 */
export type SnapshotOrder = {
  sessionId?: string | null;
  sequence?: number | null;
  capturedAt?: string | null;
};

const timeOf = (value: string | null | undefined): number | null => {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const sequenceOf = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Is `next` aantoonbaar ouder dan `previous`? */
export function snapshotIsOlder(previous: SnapshotOrder | null | undefined, next: SnapshotOrder | null | undefined): boolean {
  if (!previous || !next) return false;
  const previousSession = typeof previous.sessionId === "string" && previous.sessionId.length > 0 ? previous.sessionId : null;
  const nextSession = typeof next.sessionId === "string" && next.sessionId.length > 0 ? next.sessionId : null;
  const previousTime = timeOf(previous.capturedAt);
  const nextTime = timeOf(next.capturedAt);

  if (previousSession != null && nextSession != null && previousSession !== nextSession) {
    // Nieuwe sessie: de klok van het frame bepaalt, niet de sequence (die
    // begint per sessie opnieuw).
    return previousTime != null && nextTime != null && nextTime < previousTime;
  }

  const previousSequence = sequenceOf(previous.sequence);
  const nextSequence = sequenceOf(next.sequence);
  if (previousSequence != null && nextSequence != null && previousSequence !== nextSequence) {
    return nextSequence < previousSequence;
  }

  return previousTime != null && nextTime != null && nextTime < previousTime;
}
