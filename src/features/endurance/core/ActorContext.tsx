import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { ENDURANCE_TEST_ACTORS } from "./testActors";

/**
 * ActorContext — oorspronkelijk "test-als" voor de canary.
 *
 * Naast de vaste test-actors kan de geselecteerde actor een ECHTE user-id zijn
 * (bijv. een aangesloten tester/manager). `displayName` lost vandaar altijd een
 * leesbaar label op, in volgorde:
 *   1. eigen zelf-id  -> "Ik (jij)"
 *   2. echte profielnaam (binnenkomt via de `names`-map, gevuld in de shell)
 *   3. test-actor-label
 *   4. id-voorvoegsel (laatste redmiddel)
 *
 * Deze module is bewust onderdeel van de puur geïsoleerde planning-kern en
 * raakt het data-platform dus niet aan. De profielnamen (supabase/public_profiles)
 * worden in de repository-laag opgehaald en als `names`-prop aangeleverd.
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

export function EnduranceActorProvider({
  selfId,
  names,
  children,
}: {
  selfId: string;
  /** Echte profielnamen per user-id (iRacing-naam primair) voor naamresolutie. */
  names: ReadonlyMap<string, string>;
  children: ReactNode;
}) {
  const [actorId, setActorId] = useState<string>(selfId);

  const displayName = useCallback(
    (id: string) => {
      if (id === selfId) return "Ik (jij)";
      const profile = names.get(id);
      if (profile) return profile;
      return ENDURANCE_TEST_ACTORS.find((actor) => actor.id === id)?.label ?? id.slice(0, 8);
    },
    [selfId, names]
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