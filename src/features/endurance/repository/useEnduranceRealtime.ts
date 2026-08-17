import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { enduranceChannel, type EnduranceOnlyTableName } from "./dataAccess";

/**
 * 3SM Endurance — Realtime-binding (additief, zero-downtime).
 *
 * Abonneert op `postgres_changes` voor één of meer endurance-tabellen en
 * invalideert de gekoppelde TanStack-Query keys wanneer een rij wijzigt. Zo
 * zien ándere gebruikers een wijziging zonder handmatig te verversen (de
 * schrijvende gebruiker zelf heeft al een invalidatie via de mutation-hooks).
 *
 * De subscriptie respecteert RLS: een client ontvangt uitsluitend rijen waarop
 * hij SELECT-recht heeft. Omdat de endurance-tabellen super-admin-only zijn,
 * krijgt alleen super-admin realtime-gebeurtenissen — precies het gewenste
 * gedrag voor deze beheerfuncties. Geen data-escape.
 *
 * BINDING:
 *   table     — de endurance-tabel om op te luisteren.
 *   queryKeys — de React-Query keys om te invalideren (elke key is een array).
 *               Gebruik dezelfde keys als in de bijbehorende repository.
 */
export type EnduranceRealtimeBinding = {
  table: EnduranceOnlyTableName;
  queryKeys: unknown[][];
};

/**
 * Genereer de volledige binding-set voor een event. Centrale plek zodat de
 * modules en de unit-test naar hetzelfde contract verwijzen.
 */
export const enduranceRealtimeBindingsForEvent = (eventId: string): EnduranceRealtimeBinding[] => [
  {
    table: "endurance_events",
    queryKeys: [
      ["endurance", "events"],
      ["endurance", "events", eventId],
    ],
  },
  {
    table: "endurance_stints",
    queryKeys: [
      ["endurance", "stints", eventId],
      ["endurance", "stints", "all"],
    ],
  },
  {
    table: "endurance_teams",
    queryKeys: [
      ["endurance", "teams", eventId],
      ["endurance", "teams", "all"],
    ],
  },
  {
    table: "endurance_team_members",
    queryKeys: [
      ["endurance", "teams", eventId],
      ["endurance", "teams", "all"],
    ],
  },
];

/**
 * Hook die een Realtime-channel opent voor de gegeven bindings en de
 * gekoppelde queries invalideert bij elke INSERT/UPDATE/DELETE.
 *
 * De `bindings`-array wordt memoized op basis van een dependency-signatuur:
 * geef `eventId` en (optioneel) een `deps`-array mee zodat het channel niet
 * onnodig wordt herbouwd. Bij unmount wordt het channel netjes verwijderd.
 */
export function useEnduranceRealtime(
  bindings: EnduranceRealtimeBinding[],
  deps: React.DependencyList = []
) {
  const queryClient = useQueryClient();

  // Stabiliseer bindings op basis van de gegeven deps, zodat de effect-loop
  // alleen draait wanneer eventId/afhankelijkheden daadwerkelijk veranderen.
  const stableBindings = useMemo(
    () => bindings,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps
  );

  useEffect(() => {
    if (!stableBindings.length) return;
    let channel = supabase.channel(enduranceChannel("realtime-event"));

    for (const binding of stableBindings) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: binding.table },
        () => {
          for (const key of binding.queryKeys) {
            void queryClient.invalidateQueries({ queryKey: key });
          }
        }
      );
    }

    channel.subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        // Best-effort: channel kan opnieuw opengaan. Fout wordt niet
        // gegooid zodat de pagina bruikbaar blijft bij tijdelijke netwerkdrop.
        void channel.subscribe();
      }
    });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, stableBindings]);
}

/** Gemaks-hook: alle bindings voor één event (events + stints + teams). */
export function useEnduranceEventRealtime(eventId?: string) {
  const bindings = useMemo(
    () => (eventId ? enduranceRealtimeBindingsForEvent(eventId) : []),
    [eventId]
  );
  useEnduranceRealtime(bindings, [eventId]);
}
