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
 * sluit over de actuele waarden en elke verversing (15 s) ziet ze. Wat de sleutel
 * niet kent, kan de sleutel ook niet laten verspringen.
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
