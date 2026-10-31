import { Disc3, Layers, TriangleAlert } from "lucide-react";
import { formatLapsRange, formatRate } from "./strategy/tyreGrade";
import {
  eigenRegel,
  gedeeldRegel,
  gradeWord,
  rangeAria,
  redenIsWaarschuwing,
  redenRegel,
  staleRegel,
  stapRegel,
  uiteenloopRegel,
  voorlopigRegel,
} from "./tyreCopy";
import {
  heeftBronDetails,
  priorUitleg,
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
 * - Zolang `voorlopig` waar is, staat dat er als woord bij — maar alleen bij een
 *   bereik dat er echt is. Een waarschuwing over een bereik dat niet bestaat,
 *   waarschuwt nergens voor.
 * - De herkomst (gemeten / laatst bekend / geschat / geen data) is een woord,
 *   geen kleur: kleur alleen is voor een deel van de lezers geen informatie.
 *   De herkomst wint en staat er dus altijd. Het graadlabel ernaast is een
 *   graadwoord (sterk/matig/zwak/plan) en nooit een herkomstwoord, zodat er
 *   nooit twee woorden naast elkaar staan die hetzelfde lijken te zeggen en het
 *   toch oneens zijn (`A · gemeten` naast `geschat`, enzovoort).
 * - Waar het getal vandaan komt, staat als gewone zin onder het bereik. Niet als
 *   tweede badge: de herkomst zegt al dát het geschat is, deze regel zegt waaróm
 *   en hoeveel stints eronder liggen. Bij een eigen meting zwijgt hij.
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
  coverageError = null,
  modelLoading = false,
  v2Error = null,
}: {
  estimate: TyreEstimateV2 | null;
  bron: TyreModelSource;
  coverage: TyreCoverageRow[];
  coverageLoading?: boolean;
  coverageError?: string | null;
  modelLoading?: boolean;
  v2Error?: string | null;
}) {
  // Tijdens de eerste load is er nog geen uitslag: "geen model" is dan een
  // conclusie die de pagina niet kan trekken. "laden" is de eerlijke staat.
  const bronTekst = modelLoading && bron === "geen" ? "laden" : sourceLabel[bron];

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
        <span className="font-mono text-[10px] text-gray-500" data-pitwall-tyre-source={bronTekst === "laden" ? "laden" : bron}>
          {bronTekst}
        </span>
      </div>

      <BereikRegel estimate={estimate} loading={modelLoading} v2Error={v2Error} />
      <DekkingLijst rows={coverage} loading={coverageLoading} error={coverageError} />
    </section>
  );
}

/**
 * Graad, bereik en herkomst — of één regel die zegt dat er niets te zeggen is.
 *
 * Drie lege staten, en ze zijn niet inwisselbaar: `laden` betekent dat het
 * antwoord nog komt, `fout` betekent dat het antwoord er niet komt (met de reden
 * erbij), en pas als geen van beide waar is, is "nog geen model" een uitkomst.
 * Een mislukte call als "nog geen meting" tonen is de pagina laten liegen.
 */
function BereikRegel({
  estimate,
  loading,
  v2Error,
}: {
  estimate: TyreEstimateV2 | null;
  loading: boolean;
  v2Error: string | null;
}) {
  if (estimate == null) {
    if (loading) {
      return (
        <p className="text-sm text-gray-500" data-pitwall-tyre-range="laden">
          Bandenmodel laden…
        </p>
      );
    }
    if (v2Error != null) {
      return (
        <p className="text-sm text-red-300" role="alert" data-pitwall-tyre-range="fout">
          Bandenmodel niet geladen: {v2Error}
        </p>
      );
    }
    return (
      <p className="text-sm text-gray-500" data-pitwall-tyre-range="onbekend">
        Nog geen bandenmodel voor dit apparaat. Zodra er een stop is gemeten, staat hier het bereik in rondes.
      </p>
    );
  }

  const herkomst = provenanceLabel(estimate.provenance);
  const bereik = estimate.rangeLaps;
  // Het label is de uitleg van de server ("één stint, ruime marge"), geen graad:
  // de graad staat als letter met graadwoord in de badge ernaast.
  const uitleg = estimate.gradeLabel;
  const woord = gradeWord(estimate.grade);
  // `{0, 0}` is geen bereik maar een uitkomst: de band is op. "0–0 rondes"
  // leest als een rekenfout en verbergt het enige dat er staat.
  const geenRondes = bereik != null && bereik.low === 0 && bereik.high === 0;
  // Een bereik dat de server zelf buiten advies zet, is het antwoord niet. Het
  // staat er alleen als gedempte regel bij: "295–1181 rondes" bovenaan leest als
  // een advies dat niemand mag opvolgen.
  const toonBereik = bereik != null && !geenRondes && estimate.usable;
  const rangeAttr = toonBereik
    ? formatLapsRange(bereik) ?? "onbekend"
    : geenRondes && estimate.usable
      ? "geen"
      : "onbekend";
  // Alleen zeggen dat het bereik voorlopig (of gemeten) is als dat bereik er
  // staat. "voorlopig bereik" boven "rondes onbekend" waarschuwt voor een getal
  // dat de lezer nergens ziet.
  const ondertitel = [
    toonBereik ? (estimate.voorlopig ? "voorlopig bereik" : "gemeten bereik") : null,
    estimate.usable ? null : "niet bruikbaar voor een advies",
    uitleg,
  ]
    .filter((deel): deel is string => deel != null)
    .join(" · ");
  // De regel onder een voorlopig bereik is een teller, geen belofte: hoeveel
  // stints er echt liggen en wanneer de band smaller wordt.
  const voorlopigTekst = voorlopigRegel(estimate);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-0">
          {/* Het bereik in rondes is het antwoord; geen percentage ernaast. */}
          <p className="flex items-baseline gap-1.5" data-pitwall-tyre-range={rangeAttr}>
            {toonBereik ? (
              <>
                <span
                  className="font-heading text-2xl font-black tabular-nums text-white"
                  aria-label={rangeAria(bereik) ?? undefined}
                >
                  {formatLapsRange(bereik)}
                </span>
                <span className="text-xs font-bold uppercase tracking-wider text-gray-400">rondes</span>
              </>
            ) : geenRondes && estimate.usable ? (
              <span className="text-lg font-bold text-gray-300">geen rondes over</span>
            ) : (
              <span className="text-lg font-bold text-gray-400">rondes onbekend</span>
            )}
          </p>
          {ondertitel !== "" && (
            <p className="mt-0.5 text-[11px] text-gray-500" data-pitwall-tyre-subtitle>
              {ondertitel}
            </p>
          )}
          {/* Eén regel in gewone taal onder het bereik: waar komt dit getal
              vandaan? De nieuwe bronregels (gedeeld én eigen) staan er altijd
              als de server ze stuurde — ook zonder bruikbaar bereik, want een
              niet-verse meting moet je kunnen uitleggen. De oudere priorregel
              valt stil zodra `basis.gedeeld` het verhaal overneemt, en houdt
              dezelfde gate als voorheen: geen uitleg over een bereik dat er
              niet staat. */}
          <BronRegels estimate={estimate} />
          {toonBereik && <PriorRegel estimate={estimate} />}
          {bereik != null && !estimate.usable && (
            <p className="mt-0.5 text-[11px] text-gray-500" data-pitwall-tyre-range-raw={formatLapsRange(bereik) ?? undefined}>
              {geenRondes
                ? "Het model telt nul rondes, maar dat is geen advies."
                : `Het model rekent ${formatLapsRange(bereik)} rondes, maar dat bereik is niet bruikbaar als advies.`}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-300"
            data-pitwall-tyre-grade-label={estimate.grade}
            data-pitwall-tyre-grade-word={woord}
            data-pitwall-tyre-provenance={estimate.provenance}
          >
            {estimate.grade} · {woord}
          </span>
          {/* De herkomst wint en staat er altijd, ook als de graad "sterk" is:
              het graadwoord zegt hoe sterk de basis is, dit woord waar het getal
              vandaan komt. Ze delen geen enkel woord, dus ze kunnen elkaar niet
              tegenspreken. */}
          <span
            className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
              provenanceTone[herkomst] ?? provenanceTone["geen data"]
            }`}
            data-pitwall-tyre-provenance-label={estimate.provenance}
          >
            {herkomst}
          </span>
        </div>
      </div>

      {v2Error != null && (
        <p className="text-[11px] leading-4 text-amber-200/80" data-pitwall-tyre-v2-error={v2Error}>
          v2 gaf geen antwoord: {v2Error}
        </p>
      )}

      <BasisRegel estimate={estimate} />

      {/* Het voorlopig-verhaal: bij een antwoord met de nieuwe velden doet de
          teller in `BronRegels` dit werk (en telt hij de stints die er echt
          zijn). Zonder die velden blijft deze regel staan, maar zonder de twee
          onwaarheden van de oude tekst: "nog geen tweede meting" bij zestien
          stints, en "elke stop maakt de band smaller". */}
      {estimate.voorlopig && toonBereik && !heeftBronDetails(estimate) && voorlopigTekst != null && (
        <p className="flex items-start gap-1.5 text-[11px] leading-4 text-amber-200/90" data-pitwall-tyre-provisional="true">
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0 text-amber-300" aria-hidden />
          <span>{voorlopigTekst}</span>
        </p>
      )}
    </div>
  );
}

/**
 * Eén regel onder het bereik: waar komt dit cijfer vandaan?
 *
 * De woorden komen uit `priorUitleg`, niet uit dit bestand: de tests eisen de
 * letterlijke zin, en een zin die op twee plekken staat verandert op een dag op
 * één van de twee. Bij een eigen meting is er niets te zeggen en staat er ook
 * niets — dat is de gewone situatie. Rust het getal op andermans stints, dan
 * staat het aantal erbij en heet een dunne basis een grove schatting.
 *
 * Geen badge, geen kleur, geen veldnaam: dit is uitleg, geen status. De regel
 * telt de echte rondes uit de basis (`prior_rondes`, met `prior_n` als terugval)
 * en de titeltip geeft de aantallen zonder te beweren dat het om eigen data
 * gaat. De waarschuwing eronder krijgt wél hetzelfde driehoekje als de
 * voorlopig-regel, want dat is dezelfde soort boodschap.
 */
function PriorRegel({ estimate }: { estimate: TyreEstimateV2 }) {
  const { regel, waarschuwing, detail } = priorUitleg(estimate);
  if (regel == null) return null;

  return (
    <div data-pitwall-tyre-prior={estimate.basis.bron ?? "onbekend"}>
      {/* De opbouw van de server (aantallen per trap) is te lang voor de regel
          zelf en staat daarom als titeltip: zichtbaar voor wie erom vraagt,
          weg uit de blik van wie het bereik leest. */}
      <p className="mt-0.5 text-[11px] leading-4 text-gray-400" title={detail ?? undefined}>
        {regel}
      </p>
      {waarschuwing != null && (
        <p
          className="mt-0.5 flex items-start gap-1.5 text-[11px] leading-4 text-amber-200/90"
          data-pitwall-tyre-prior-warning="true"
        >
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0 text-amber-300" aria-hidden />
          <span>{waarschuwing}</span>
        </p>
      )}
    </div>
  );
}

/**
 * Het eerlijke bronverhaal onder het bereik: twee regels, één teller.
 *
 * Waarom dit naast `PriorRegel` bestaat en niet erin: de oude regel keek naar
 * `basis.bron` en zweeg bij "eigen". Dat was één fout met twee gezichten — de
 * lezer zag een getal dat met de pool geblend was zonder dat te weten, en bij
 * zestien stints stond er "nog geen tweede meting". De nieuwe velden maken het
 * mogelijk beide te zeggen: wat de pool vindt (`gedeeld`) en wat je zelf meet
 * (`eigen`), allebei met de combinatie erbij, plus een teller die de stints telt
 * die er echt zijn.
 *
 * Wat hier met opzet niet staat: een badge per regel. Dit is uitleg, geen status
 * — de graad en de herkomst hebben al hun eigen badge, en een derde woord naast
 * hetzelfde getal is er één te veel. Wel een driehoekje bij de regels die een
 * waarschuwing zijn (niet-vers, dunne pool, andere context, geen helling), want
 * dat is dezelfde vorm als de rest van het paneel al gebruikt.
 *
 * Alles wat de server niet stuurde blijft weg. Ontbreken de velden helemaal, dan
 * komt deze component niet in beeld en doet `PriorRegel` het oude werk — een oude
 * RPC mag geen lege regels of verzonnen aantallen opleveren.
 */
function BronRegels({ estimate }: { estimate: TyreEstimateV2 }) {
  const gedeeld = gedeeldRegel(estimate);
  const eigen = eigenRegel(estimate);
  // De niet-verse stand heeft zijn eigen regel met de leeftijd; daar hangt geen
  // teller en geen vooruitblik aan, want de huidige band is onbekend.
  const stale = staleRegel(estimate);
  const stap = stale == null ? stapRegel(estimate) : null;
  const uiteen = stale == null ? uiteenloopRegel(estimate) : null;
  // `stale_state` valt af: `staleRegel` zegt het al, met meer informatie.
  const redenen = estimate.basis.redenen
    .filter((code) => code !== "stale_state")
    .flatMap((code) => {
      const tekst = redenRegel(code);
      return tekst == null ? [] : [{ code, tekst }];
    });

  if (gedeeld == null && eigen == null && stale == null && stap == null && uiteen == null && redenen.length === 0) {
    return null;
  }

  const minuten = estimate.basis.actualiteit?.wearOuderheidMin;

  return (
    <div className="mt-0.5 space-y-0.5" data-pitwall-tyre-bron="contract">
      {gedeeld != null && (
        <p className="text-[11px] leading-4 text-gray-400" data-pitwall-tyre-gedeeld="true">
          {gedeeld}
        </p>
      )}
      {eigen != null && (
        <p className="text-[11px] leading-4 text-gray-400" data-pitwall-tyre-eigen="true">
          {eigen}
        </p>
      )}
      {stap != null && (
        <p className="text-[11px] leading-4 text-gray-300" data-pitwall-tyre-stap="true">
          {stap}
        </p>
      )}
      {stale != null && (
        <p
          className="flex items-start gap-1.5 text-[11px] leading-4 text-amber-200/90"
          data-pitwall-tyre-stale={minuten != null ? String(Math.round(minuten)) : "onbekend"}
        >
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0 text-amber-300" aria-hidden />
          <span>{stale}</span>
        </p>
      )}
      {uiteen != null && (
        <p
          className="flex items-start gap-1.5 text-[11px] leading-4 text-amber-200/90"
          data-pitwall-tyre-uiteenloop="true"
        >
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0 text-amber-300" aria-hidden />
          <span>{uiteen}</span>
        </p>
      )}
      {redenen.map(({ code, tekst }) => (
        <p
          key={code}
          className={
            redenIsWaarschuwing(code)
              ? "flex items-start gap-1.5 text-[11px] leading-4 text-amber-200/90"
              : "text-[11px] leading-4 text-gray-400"
          }
          data-pitwall-tyre-reden={code}
        >
          {redenIsWaarschuwing(code) && (
            <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0 text-amber-300" aria-hidden />
          )}
          <span>{tekst}</span>
        </p>
      ))}
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

  // Geen tempo bij C en D (zie `tyreCopy`): een slijtagesnelheid suggereert een
  // helling die er bij een schatting of een plan niet is.
  const metTempo = estimate.grade === "A" || estimate.grade === "B";
  const slijtage = metTempo ? formatRate(estimate.wearPerLapPp) : null;

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
 * Een míslukte dekking is het omgekeerde en krijgt dus een eigen regel: "nog
 * leeg" zou de lezer dezelfde uitleg geven bij een rechtenfout.
 */
function DekkingLijst({
  rows,
  loading,
  error,
}: {
  rows: TyreCoverageRow[];
  loading: boolean;
  error: string | null;
}) {
  const status =
    error != null
      ? "mislukt"
      : loading && rows.length === 0
        ? "laden…"
        : rows.length === 0
          ? "nog leeg"
          : `${rows.length} ${rows.length === 1 ? "combinatie" : "combinaties"}`;

  return (
    <div className="mt-3 border-t border-white/[0.07] pt-3" data-pitwall-tyre-coverage={rows.length}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-500">
          <Layers className="h-3 w-3" aria-hidden />
          Dekking
        </h3>
        <span className="text-[10px] text-gray-500">{status}</span>
      </div>

      {error != null && (
        <p
          className="text-[12px] leading-5 text-red-300/90"
          role="alert"
          data-pitwall-tyre-coverage-error={error}
        >
          Dekking laden mislukt: {error}
        </p>
      )}

      {rows.length === 0 ? (
        error == null && (
          <p className="text-[12px] leading-5 text-gray-500">
            Nog geen dekking. Eén stop levert één meting op: na de eerste bandenwissel staat hier per auto en
            circuit hoeveel stints er in de basis zitten.
          </p>
        )
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
