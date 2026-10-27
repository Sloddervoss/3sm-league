import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  loadTyreCoverage,
  loadTyreModel,
  type TyreCoverageRow,
  type TyreEstimateV2,
  type TyreModelSource,
  type TyreRpcClient,
} from "./strategy/tyreEstimateV2";

/**
 * De twee servervragen van het bandenblok, met de query-sleutels op één plek.
 *
 * De sleutel van het model hangt aan het apparaat en niet aan de race: v2 kent
 * geen event en geen team, en zolang de detail-RPC nog onderweg is, zijn die twee
 * undefined. Stonden ze wél in de sleutel, dan veranderde die sleutel halverwege
 * en vroeg de pagina v2 twee keer — één keer te veel, met als enige oorzaak de
 * timing van een andere call.
 *
 * De v1-terugval leest event en team daarom uit de fetch zelf: de zoekfunctie
 * sluit over de actuele waarden en elke verversing (15 s) ziet ze. Wat de
 * sleutel niet kent, kan de sleutel ook niet laten verspringen.
 *
 * De prijs van die keuze is timing: bij de eerste fetch kunnen event en team er
 * nog niet zijn (de detail-RPC loopt), en dan slaat `loadTyreModel` de v1-stap
 * over. Wachten op de verversing van 15 s is te lang voor een apparaat waarvan
 * v2 stuk is. Daarom verzoekt de hook één keer om een refetch zodra event en
 * team voor het eerst gevuld zijn én de vorige uitslag "geen model" was — nog
 * steeds zonder de sleutel te veranderen.
 */
export const tyreModelQueryKey = (deviceId: string | null) =>
  ["pitwall-test", "tyre-model", deviceId] as const;

export const tyreCoverageQueryKey = ["pitwall-test", "tyre-coverage"] as const;

/** Wat het paneel nodig heeft; één vorm, zodat de pagina geen queries hoeft te lezen. */
export interface TyreModelState {
  estimate: TyreEstimateV2 | null;
  bron: TyreModelSource;
  /** Reden dat v2 niet gebruikt is, ook als v1 er wél een antwoord op had. */
  v2Error: string | null;
  /** Tot de eerste uitslag is er niets te zeggen — ook niet "geen model". */
  modelLoading: boolean;
  coverage: TyreCoverageRow[];
  coverageError: string | null;
  coverageLoading: boolean;
}

export function useTyreModel(input: {
  client: TyreRpcClient;
  deviceId: string | null;
  eventId?: string | null;
  teamId?: string | null;
  enabled: boolean;
}): TyreModelState {
  const { client, deviceId, eventId = null, teamId = null, enabled } = input;
  const actief = enabled && Boolean(deviceId);

  const model = useQuery({
    queryKey: tyreModelQueryKey(deviceId),
    enabled: actief,
    queryFn: () => loadTyreModel(client, { deviceId: deviceId!, eventId, teamId }),
    refetchInterval: 15_000,
  });
  // Losse velden, zodat de refetch-effect hieronder geen object als
  // afhankelijkheid heeft.
  const { data: modelData, isFetching: modelBezig, refetch: refetchModel } = model;

  // Kwam de binding (event + team) pas ná de eerste fetch binnen? Dan heeft die
  // fetch de v1-terugval overgeslagen, en is "geen model" het voorlopige gevolg
  // van timing in plaats van van een leeg model. Eén refetch lost dat op; de
  // sleutel blijft die van het apparaat, dus dit is geen tweede query.
  const hadBinding = useRef(Boolean(eventId && teamId));
  const refetchNodig = useRef(false);
  useEffect(() => {
    const gebonden = Boolean(eventId && teamId);
    if (!gebonden) {
      hadBinding.current = false;
      return;
    }
    if (hadBinding.current) return;
    hadBinding.current = true;
    refetchNodig.current = true;
  }, [eventId, teamId]);

  useEffect(() => {
    if (!refetchNodig.current || modelData == null) return;
    // De vlag gaat er af vóór de refetch: één poging, nooit een lus.
    refetchNodig.current = false;
    // v2 is een volledig antwoord; alleen een mislukte v2 zonder v1-antwoord
    // vraagt om een nieuwe poging met de binding erbij.
    if (modelData.source === "geen" && !modelBezig) void refetchModel();
  }, [modelData, modelBezig, refetchModel]);

  const coverage = useQuery({
    queryKey: tyreCoverageQueryKey,
    enabled: actief,
    queryFn: () => loadTyreCoverage(client, 50),
    refetchInterval: 60_000,
  });

  // `loadTyreModel` slikt zijn eigen fouten in en meldt ze als `v2Error`; alleen
  // een fout die daarbuiten valt (client weg, geen `rpc`) komt hier langs.
  const geworpen =
    model.error == null ? null : model.error instanceof Error ? model.error.message : String(model.error);

  return {
    estimate: model.data?.estimate ?? null,
    bron: model.data?.source ?? "geen",
    v2Error: model.data?.v2Error ?? geworpen,
    modelLoading: actief && model.isPending,
    coverage: coverage.data?.rows ?? [],
    coverageError: coverage.data?.error ?? null,
    coverageLoading: coverage.isFetching,
  };
}
