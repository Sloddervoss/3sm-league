import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { EnduranceRealtimeSubscription, enduranceRealtimeChannelName, type EnduranceRealtimeChannel } from "./enduranceRealtimeClient";
import { enduranceRealtimeBindingsForEvent, type EnduranceRealtimeBinding } from "./enduranceRealtimeMatrix";
import { useEnduranceCapabilities } from "./capabilitiesRepository";

export type { EnduranceRealtimeBinding } from "./enduranceRealtimeMatrix";
export { enduranceRealtimeBindingsForEvent } from "./enduranceRealtimeMatrix";

let realtimeInstanceSequence = 0;
const nextInstanceId = () => `instance-${++realtimeInstanceSequence}`;

const createSupabaseChannel = (name: string): EnduranceRealtimeChannel => {
  const channel = supabase.channel(name);
  return {
    onPostgresChanges(binding, onRow) {
      channel.on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: binding.subscriptionTable,
          filter: `${binding.filter.column}=eq.${binding.filter.value}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (row.source_table === binding.table) onRow();
        },
      );
    },
    subscribe(callback) {
      channel.subscribe((status) => callback(status));
    },
    remove() {
      void supabase.removeChannel(channel);
    },
  };
};

export function useEnduranceRealtime(
  bindings: EnduranceRealtimeBinding[],
  deps: React.DependencyList = [],
  options: { enabled?: boolean; kind?: "event" | "user"; identity?: string } = {},
) {
  const queryClient = useQueryClient();
  const instanceId = useRef(nextInstanceId());
  const stableBindings = useMemo(
    () => bindings,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );
  const enabled = options.enabled ?? true;
  const kind = options.kind ?? "event";
  const identity = options.identity ?? "workspace";

  useEffect(() => {
    if (!enabled || !stableBindings.length) return;
    const subscription = new EnduranceRealtimeSubscription({
      channelName: enduranceRealtimeChannelName({ kind, id: identity, instanceId: instanceId.current }),
      bindings: stableBindings,
      createChannel: createSupabaseChannel,
      invalidate: (keys) => {
        for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
      },
      scheduleReconnect: (delayMs, fire) => {
        const timer = window.setTimeout(fire, delayMs);
        return () => window.clearTimeout(timer);
      },
    });
    subscription.start();
    return () => subscription.close();
  }, [enabled, identity, kind, queryClient, stableBindings]);
}

/** Eventworkspace: alpha-staff blijft live; gewone leden alleen via runtimeflag. */
export function useEnduranceEventRealtime(eventId?: string) {
  const { user, isSuperAdmin, isEnduranceManager, isTester } = useAuth();
  const { capabilities } = useEnduranceCapabilities(user?.id, { isSuperAdmin, isEnduranceManager, isTester });
  const enabled = Boolean(eventId && (isSuperAdmin || isEnduranceManager || isTester || capabilities.multi_user_realtime_enabled));
  const bindings = useMemo(
    () => eventId ? enduranceRealtimeBindingsForEvent(eventId, { userId: user?.id }) : [],
    [eventId, user?.id],
  );
  useEnduranceRealtime(bindings, [eventId, user?.id], {
    enabled,
    kind: "event",
    identity: eventId ?? "none",
  });
}
