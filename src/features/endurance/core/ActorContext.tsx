import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { ENDURANCE_TEST_ACTORS } from "./testActors";

/**
 * ActorContext — Fase 3 (test-als).
 *
 * Binnen de super-admin-canary "speelt" de super-admin verschillende coureurs
 * via de Test-als-slider. De geselecteerde `actorId` wordt als `user_id`
 * gebruikt bij alle endurance-lees/schrijf-acties van die coureur. De sessie
 * blijft de echte super-admin (anders zou de RLS weigeren); alleen de
 * `user_id`-waarde in de endurance-tabellen varieert.
 */
interface EnduranceActorContextValue {
  /** Geselecteerde actor-id (default: de echte user-id = "Ik"). */
  actorId: string;
  /** Kies een actor. */
  setActorId: (id: string) => void;
  /** Naam van een actor-id als prettig label (voor tonen van coureurs). */
  displayName: (id: string) => string;
  /** Lijst met test-coureurs (excl. "Ik"). */
  testActors: typeof ENDURANCE_TEST_ACTORS;
}

const EnduranceActorContext = createContext<EnduranceActorContextValue | null>(null);

export function EnduranceActorProvider({ selfId, children }: { selfId: string; children: ReactNode }) {
  const [actorId, setActorId] = useState<string>(selfId);

  const displayName = useCallback(
    (id: string) => {
      if (id === selfId) return "Ik (super-admin)";
      return ENDURANCE_TEST_ACTORS.find((actor) => actor.id === id)?.label ?? id.slice(0, 8);
    },
    [selfId]
  );

  const value = useMemo(
    () => ({ actorId, setActorId, displayName, testActors: ENDURANCE_TEST_ACTORS }),
    [actorId, displayName]
  );

  return <EnduranceActorContext.Provider value={value}>{children}</EnduranceActorContext.Provider>;
}

export function useEnduranceActor(): EnduranceActorContextValue {
  const context = useContext(EnduranceActorContext);
  if (!context) throw new Error("useEnduranceActor moet binnen EnduranceActorProvider gebruikt worden");
  return context;
}
