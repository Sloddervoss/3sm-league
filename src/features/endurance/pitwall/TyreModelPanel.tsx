import { Disc3, Layers, TriangleAlert } from "lucide-react";
import { formatLapsRange, formatRate } from "./strategy/tyreGrade";
import { gradeWord, rangeAria } from "./tyreCopy";
import {
  provenanceLabel,
  type TyreCoverageRow,
  type TyreEstimateV2,
  type TyreModelSource,
} from "./strategy/tyreEstimateV2";

/**
 * Het bandenmodel zoals de server het kent, plus hoe ver de dekking reikt.
 *
 * Waarom dit naast de beslissingsband staat en er niet in zit: de band zegt wat
 * je moet dóén, dit blok zegt hoevéél we weten. Twee vragen, twee blokken — en
 * dus ook geen tweede getal dat het eerste tegenspreekt.
 *
 * Drie regels, overgenomen uit `tyreCopy` en hier niet opnieuw bedacht:
 *
 * - Het antwoord is een bereik in rondes. Een percentage rest zegt niets over
 *   het aantal rondes dat je ermee doet; dit blok toont er daarom geen.
 * - Zolang `voorlopig` waar is, staat dat er als woord bij. Een bereik zonder die
 *   waarschuwing leest als een belofte.
 * - De herkomst (gemeten / laatst bekend / geschat / geen data) is een woord,
 *   geen kleur: kleur alleen is voor een deel van de lezers geen informatie.
 */

const provenanceTone: Record<string, string> = {
  gemeten: "border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-300",
  "laatst bekend": "border-sky-400/30 bg-sky-400/[0.08] text-sky-200",
  geschat: "border-amber-400/30 bg-amber-400/[0.08] text-amber-200",
  "geen data": "border-white/10 bg-white/[0.03] text-gray-400",
};

const sourceLabel: Record<TyreModelSource, string> = {
  v2: "v2",
  v1: "v1 · terugval",
  geen: "geen model",
};

export function TyreModelPanel({
  estimate,
  bron,
  coverage,
  coverageLoading = false,
}: {
  estimate: TyreEstimateV2 | null;
  bron: TyreModelSource;
  coverage: TyreCoverageRow[];
  coverageLoading?: boolean;
}) {
  return (
    <section
      className="rounded-2xl border border-white/[0.07] bg-white/[0.025] px-5 py-4"
      data-pitwall-tyre-model={bron}
      aria-label="Bandenmodel"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-gray-400">
          <Disc3 className="h-3.5 w-3.5 text-gray-500" aria-hidden />
          Bandenmodel
        </h2>
        <span className="font-mono text-[10px] text-gray-500">{sourceLabel[bron]}</span>
      </div>

      <BereikRegel estimate={estimate} />
      <DekkingLijst rows={coverage} loading={coverageLoading} />
    </section>
  );
}

/** Graad, bereik en herkomst — of één regel die zegt dat er niets te zeggen is. */
function BereikRegel({ estimate }: { estimate: TyreEstimateV2 | null }) {
  if (estimate == null) {
    return (
      <p className="text-sm text-gray-500" data-pitwall-tyre-range="onbekend">
        Nog geen bandenmodel voor dit apparaat. Zodra er een stop is gemeten, staat hier het bereik in rondes.
      </p>
    );
  }

  const herkomst = provenanceLabel(estimate.provenance);
  const bereik = estimate.rangeLaps;
  // Het label is de uitleg van de server ("één stint, ruime marge"), geen graad:
  // de graad staat als letter met woord in de badge ernaast.
  const uitleg = estimate.gradeLabel;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-0">
          {/* Het bereik in rondes is het antwoord; geen percentage ernaast. */}
          <p className="flex items-baseline gap-1.5" data-pitwall-tyre-range={bereik ? formatLapsRange(bereik) ?? "onbekend" : "onbekend"}>
            {bereik ? (
              <>
                <span
                  className="font-heading text-2xl font-black tabular-nums text-white"
                  aria-label={rangeAria(bereik) ?? undefined}
                >
                  {formatLapsRange(bereik)}
                </span>
                <span className="text-xs font-bold uppercase tracking-wider text-gray-400">rondes</span>
              </>
            ) : (
              <span className="text-lg font-bold text-gray-400">rondes onbekend</span>
            )}
          </p>
          <p className="mt-0.5 text-[11px] text-gray-500">
            {estimate.voorlopig ? "voorlopig bereik" : "gemeten bereik"}
            {estimate.usable ? "" : " · niet bruikbaar voor een advies"}
            {uitleg ? ` · ${uitleg}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-300"
            data-pitwall-tyre-grade-label={estimate.grade}
          >
            {estimate.grade} · {gradeWord(estimate.grade)}
          </span>
          <span
            className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
              provenanceTone[herkomst] ?? provenanceTone["geen data"]
            }`}
            data-pitwall-tyre-provenance={estimate.provenance}
          >
            {herkomst}
          </span>
        </div>
      </div>

      <BasisRegel estimate={estimate} />

      {estimate.voorlopig && (
        <p className="flex items-start gap-1.5 text-[11px] leading-4 text-amber-200/90" data-pitwall-tyre-provisional="true">
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0 text-amber-300" aria-hidden />
          <span>
            Nog geen tweede meting: dit bereik is voorlopig. Elke stop die erbij komt, maakt de band smaller.
          </span>
        </p>
      )}
    </div>
  );
}

/** De basis waarop het bereik rust: auto, circuit, temperatuur, aantal rondes. */
function BasisRegel({ estimate }: { estimate: TyreEstimateV2 }) {
  const { basis } = estimate;
  const delen: string[] = [];
  if (basis.carKey) delen.push(basis.carKey);
  if (basis.trackKey) delen.push(basis.trackKey);
  if (basis.trackTempC != null) delen.push(`${Math.round(basis.trackTempC)} °C`);
  if (basis.rondesInBasis != null) delen.push(`${Math.round(basis.rondesInBasis)} rondes in de basis`);

  const slijtage = formatRate(estimate.wearPerLapPp);

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-400">
      {estimate.stints != null && estimate.stints > 0 && (
        <span data-pitwall-tyre-stints={estimate.stints}>
          {estimate.stints === 1 ? "1 stint" : `${estimate.stints} stints`}
        </span>
      )}
      {estimate.stints != null && estimate.stints > 0 && slijtage != null && (
        <span className="h-2.5 w-px bg-white/10" />
      )}
      {slijtage != null && <span className="font-mono tabular-nums">{slijtage}</span>}
      {(estimate.stints != null && estimate.stints > 0 || slijtage != null) && delen.length > 0 && (
        <span className="h-2.5 w-px bg-white/10" />
      )}
      {delen.length > 0 && <span className="truncate" data-pitwall-tyre-basis>{delen.join(" · ")}</span>}
      {(estimate.stints == null || estimate.stints === 0) && slijtage == null && delen.length === 0 && (
        <span>Geen basis meegestuurd.</span>
      )}
    </div>
  );
}

/**
 * Hoe ver de dekking reikt: per auto en circuit het aantal stints en de graad.
 *
 * De lege staat is geen foutmelding maar een uitleg, want de reden dat hier niets
 * staat is het model zelf: één stop levert één meting op. Zonder die zin leest een
 * lege lijst als "stuk", en dan gaat iemand zoeken naar een bug die er niet is.
 */
function DekkingLijst({ rows, loading }: { rows: TyreCoverageRow[]; loading: boolean }) {
  return (
    <div className="mt-3 border-t border-white/[0.07] pt-3" data-pitwall-tyre-coverage={rows.length}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-500">
          <Layers className="h-3 w-3" aria-hidden />
          Dekking
        </h3>
        <span className="text-[10px] text-gray-500">
          {loading && rows.length === 0
            ? "laden…"
            : rows.length === 0
              ? "nog leeg"
              : `${rows.length} ${rows.length === 1 ? "combinatie" : "combinaties"}`}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="text-[12px] leading-5 text-gray-500">
          Nog geen dekking. Eén stop levert één meting op: na de eerste bandenwissel staat hier per auto en
          circuit hoeveel stints er in de basis zitten.
        </p>
      ) : (
        <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((rij) => (
            <li
              key={`${rij.carKey ?? "?"}|${rij.trackKey ?? "?"}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5"
            >
              <span className="min-w-0 truncate text-[12px] text-gray-200">
                {rij.carKey ?? "onbekende auto"}
                <span className="text-gray-500"> · {rij.trackKey ?? "onbekend circuit"}</span>
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-gray-400">
                {rij.stints === 1 ? "1 stint" : `${rij.stints} stints`}
                {rij.grade != null && (
                  <span className="ml-1.5 text-gray-300" title={gradeWord(rij.grade)}>
                    {rij.grade}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
