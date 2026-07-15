import { createContext, type Dispatch, type ReactNode, useContext, useEffect, useMemo, useReducer } from "react";
import { reduceEnduranceState, type EnduranceAction } from "./actions";
import { assertLocalEnduranceEnvironment } from "./environment";
import { createEnduranceSeed } from "./seed";
import { getActivePersona } from "./selectors";
import { ENDURANCE_SCHEMA_VERSION, ENDURANCE_STORAGE_KEY, type EndurancePersona, type EnduranceState } from "./types";

interface EnduranceStoreValue {
  state: EnduranceState;
  activePersona: EndurancePersona;
  dispatch: Dispatch<EnduranceAction>;
  reset: () => void;
}

const EnduranceStoreContext = createContext<EnduranceStoreValue | null>(null);

const isValidState = (value: unknown): value is EnduranceState => {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<EnduranceState>;
  return state.schemaVersion === ENDURANCE_SCHEMA_VERSION
    && typeof state.activePersonaId === "string"
    && Array.isArray(state.personas)
    && Array.isArray(state.events)
    && Array.isArray(state.registrations)
    && Array.isArray(state.stints)
    && Array.isArray(state.auditLog);
};

export const loadEnduranceState = (): EnduranceState => {
  assertLocalEnduranceEnvironment();
  if (typeof window === "undefined") return createEnduranceSeed();
  try {
    const raw = window.localStorage.getItem(ENDURANCE_STORAGE_KEY);
    if (!raw) return createEnduranceSeed();
    const parsed: unknown = JSON.parse(raw);
    return isValidState(parsed) ? parsed : createEnduranceSeed();
  } catch {
    return createEnduranceSeed();
  }
};

export const EnduranceStoreProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(reduceEnduranceState, undefined, loadEnduranceState);

  useEffect(() => {
    window.localStorage.setItem(ENDURANCE_STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const activePersona = useMemo(() => getActivePersona(state), [state]);
  const reset = () => {
    window.localStorage.removeItem(ENDURANCE_STORAGE_KEY);
    window.location.reload();
  };

  return (
    <EnduranceStoreContext.Provider value={{ state, activePersona, dispatch, reset }}>
      {children}
    </EnduranceStoreContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useEnduranceStore = () => {
  const context = useContext(EnduranceStoreContext);
  if (!context) throw new Error("useEnduranceStore moet binnen EnduranceStoreProvider worden gebruikt.");
  return context;
};
