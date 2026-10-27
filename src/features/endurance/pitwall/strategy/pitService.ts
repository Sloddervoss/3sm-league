/**
 * De reparatiestrook: wat er tijdens de stop aan reparatie bekend is.
 *
 * De regel staat in `DecisionBand` en verschijnt alleen als de auto in de
 * pitstraat staat (`track.onPitRoad`). Buiten de stop is "moet er gerepareerd
 * worden" geen vraag maar ruis.
 *
 * De drie woorden zijn de hele uitkomst, en ze zijn niet inwisselbaar:
 *
 *   verplicht   requiredRepairSeconds > 0 — de auto gaat er niet zonder weg
 *   optioneel   required = 0 en optional > 0 — tijdwinst, geen voorwaarde
 *   onbekend    de connector gaf geen verplichte reparatietijd
 *
 * Wat hier bewust NIET gebeurt:
 *   * Nul verplichte tijd en nul optionele tijd levert géén strook. Dat is een
 *     meting ("niets te repareren"), geen "onbekend", en al helemaal geen nul
 *     seconden die als schade leest.
 *   * Een optionele tijd zonder verplichte tijd wordt niet "optioneel": dan is
 *     onbekend of er alsnog een verplichte reparatie bijkomt. Welke van de twee
 *     de auto gaat kosten is dan niet te zeggen, dus zeggen we het niet.
 *   * Geen tijd verzonnen als de bron zweeg: `repairSeconds` blijft null en de
 *     UI toont een streepje.
 */

import type { PitBoxRepair } from "./types";

export interface PitBoxRepairInput {
  /** `v3_normalized.track.onPitRoad`; null als de meting zweeg. */
  onPitRoad: boolean | null | undefined;
  /** `v3_normalized.pitService.requiredRepairSeconds`. */
  requiredRepairSeconds: number | null | undefined;
  /** `v3_normalized.pitService.optionalRepairSeconds`. */
  optionalRepairSeconds: number | null | undefined;
}

/** Seconden uit de bron, of null als het geen bruikbare meting is. */
function seconden(waarde: number | null | undefined): number | null {
  if (typeof waarde !== "number" || !Number.isFinite(waarde) || waarde < 0) return null;
  return waarde;
}

export function pitBoxRepair(input: PitBoxRepairInput): PitBoxRepair | null {
  // Alleen in de pitstraat. false en null betekenen allebei "niet in de box".
  if (input.onPitRoad !== true) return null;

  const verplicht = seconden(input.requiredRepairSeconds);
  const optioneel = seconden(input.optionalRepairSeconds);

  if (verplicht != null && verplicht > 0) {
    return { phase: "IN_BOX", repair: "mandatory", repairSeconds: verplicht };
  }

  if (verplicht === 0) {
    // Nul is gemeten: geen verplichte reparatie. Alleen dan mag "optioneel"
    // vallen, en alleen als er ook echt een optionele tijd staat.
    return optioneel != null && optioneel > 0
      ? { phase: "IN_BOX", repair: "optional", repairSeconds: optioneel }
      : null;
  }

  // Geen verplichte tijd gemeten: de vraag is niet te beantwoorden.
  return { phase: "IN_BOX", repair: "unknown", repairSeconds: null };
}
