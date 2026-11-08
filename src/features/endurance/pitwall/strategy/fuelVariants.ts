/**
 * Vier brandstofschattingen naast elkaar, zoals iRacing's eigen fuel-calculator
 * ze toont: een schatting, het gemiddelde van de laatste vijf, en het hoogste en
 * laagste gemeten verbruik.
 *
 * Twee regels die dit bestand bewaken:
 *
 * 1. **EST is de bestaande schatting**, niet een tweede die er net naast zit. De
 *    rekenkern levert `estimateFuelPerLap` (mediaan met uitbijterfilter en een
 *    uplift); die waarde komt hier binnen als `estPerLap`. Zonder die waarde is
 *    EST leeg, ook als er monsters zijn.
 * 2. **MAX is een vergelijking, geen advies.** Het hoogste gemeten verbruik geeft
 *    het kleinste bereik en het grootste bij te tanken aantal liters; het is geen
 *    garantie voor de toekomst. Alleen EST stuurt het advies.
 *
 * De monsters komen uit de pitwall-RPC (`fuel_samples`): de laatste geldige
 * metingen, nieuwste eerst, met hun echte rondenummer. Er wordt niets
 * aaneengeregen wat niet gemeten is.
 */

export interface FuelSample {
  lap: number;
  used: number | null;
  lap_time?: number | null;
  captured_at?: string | null;
}

export type FuelVariantKey = "est" | "avg5" | "max" | "min";

export interface FuelVariant {
  key: FuelVariantKey;
  /** Kort label voor de kolomkop. */
  label: string;
  /** Liter per ronde volgens deze variant. */
  perLap: number | null;
  /** Hoeveel hele rondes de huidige tank hiermee meegaat. */
  lapsLeft: number | null;
  /** Liters die tot de finish bijgetankt moeten worden (0 = het past). */
  toAddLitres: number | null;
  /** Aantal monsters waarop deze variant rust; 0 voor EST (die komt van elders). */
  samples: number;
}

export interface FuelVariantInput {
  samples: ReadonlyArray<FuelSample> | null | undefined;
  /** De schatting uit de rekenkern; zonder deze blijft EST leeg. */
  estPerLap: number | null;
  fuelLitres: number | null;
  lapsToFinish: number | null;
  /** Alleen gebruikt om te melden dat het tekort niet in één tank past. */
  tankCapacityLitres?: number | null;
}

const MIN_PLAUSIBLE = 0.2;
const MAX_PLAUSIBLE = 15;

const bruikbaar = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= MIN_PLAUSIBLE && value <= MAX_PLAUSIBLE;

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Geldige verbruiksmetingen, nieuwste eerst, met hun rondenummer. */
export function usableFuelSamples(samples: ReadonlyArray<FuelSample> | null | undefined): Array<{ lap: number; used: number }> {
  if (!samples) return [];
  return samples
    .filter((sample) => Number.isFinite(sample.lap) && bruikbaar(sample.used))
    .map((sample) => ({ lap: sample.lap, used: sample.used as number }));
}

const gemiddelde = (waarden: number[]): number | null =>
  waarden.length === 0 ? null : round2(waarden.reduce((som, w) => som + w, 0) / waarden.length);

export function fuelVariants(input: FuelVariantInput): FuelVariant[] {
  const bruikbaarSamples = usableFuelSamples(input.samples);
  const waarden = bruikbaarSamples.map((sample) => sample.used);
  const nieuwsteVijf = waarden.slice(0, 5);

  const fuel = typeof input.fuelLitres === "number" && Number.isFinite(input.fuelLitres) && input.fuelLitres >= 0
    ? input.fuelLitres
    : null;
  const afstand = typeof input.lapsToFinish === "number" && Number.isFinite(input.lapsToFinish) && input.lapsToFinish > 0
    ? input.lapsToFinish
    : null;

  const maak = (key: FuelVariantKey, label: string, perLap: number | null, samples: number): FuelVariant => {
    const bruikbaarPerLap = typeof perLap === "number" && Number.isFinite(perLap) && perLap > 0 ? perLap : null;
    const lapsLeft = bruikbaarPerLap != null && fuel != null ? Math.floor(fuel / bruikbaarPerLap) : null;
    let toAdd: number | null = null;
    if (bruikbaarPerLap != null && fuel != null && afstand != null) {
      // Naar boven afronden: een halve liter tekort is nog steeds te weinig.
      toAdd = Math.max(0, Math.ceil((afstand * bruikbaarPerLap - fuel) * 10) / 10);
    }
    return { key, label, perLap: bruikbaarPerLap != null ? round2(bruikbaarPerLap) : null, lapsLeft, toAddLitres: toAdd, samples };
  };

  const est = typeof input.estPerLap === "number" && Number.isFinite(input.estPerLap) && input.estPerLap > 0 ? input.estPerLap : null;

  return [
    maak("est", "EST", est, 0),
    maak("avg5", "Laatste 5", gemiddelde(nieuwsteVijf), nieuwsteVijf.length),
    maak("max", "Max", waarden.length > 0 ? Math.max(...waarden) : null, waarden.length),
    maak("min", "Min", waarden.length > 0 ? Math.min(...waarden) : null, waarden.length),
  ];
}

/**
 * Past het tekort van een variant in één tankstop? Onbekend tekort of onbekende
 * tank geeft null — liever geen uitspraak dan een verkeerde.
 */
export function fitsInOneStop(variant: FuelVariant, tankCapacityLitres: number | null | undefined): boolean | null {
  if (variant.toAddLitres == null) return null;
  if (variant.toAddLitres <= 0) return true;
  if (typeof tankCapacityLitres !== "number" || !Number.isFinite(tankCapacityLitres) || tankCapacityLitres <= 0) return null;
  return variant.toAddLitres <= tankCapacityLitres;
}
