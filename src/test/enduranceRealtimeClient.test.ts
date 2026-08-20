import { describe, expect, it, vi } from "vitest";
import {
  ENDURANCE_REALTIME_INITIAL_BACKOFF_MS,
  ENDURANCE_REALTIME_MAX_RECONNECT_ATTEMPTS,
  EnduranceRealtimeSubscription,
  enduranceRealtimeChannelName,
  type EnduranceChannelStatus,
  type EnduranceRealtimeChannel,
  type FilteredEnduranceRealtimeBinding,
} from "../features/endurance/repository/enduranceRealtimeClient";

/** Minimal fake superset of the RealtimeChannel surface the client uses. */
class FakeChannel implements EnduranceRealtimeChannel {
  name: string;
  removed = false;
  subscriber: ((status: EnduranceChannelStatus) => void) | null = null;
  changes: Array<{ table: string; filter: string | null; onRow: () => void }> = [];
  constructor(name: string) {
    this.name = name;
  }
  onPostgresChanges(binding: FilteredEnduranceRealtimeBinding, onRow: () => void): void {
    this.changes.push({
      table: binding.table,
      filter: binding.filter ? `${binding.filter.column}=eq.${binding.filter.value}` : null,
      onRow,
    });
  }
  subscribe(cb: (status: EnduranceChannelStatus) => void): void {
    this.subscriber = cb;
  }
  remove(): void {
    this.removed = true;
  }
}

const binding = (table: FilteredEnduranceRealtimeBinding["table"]): FilteredEnduranceRealtimeBinding => ({
  table,
  filter: { column: "event_id", value: "evt-123" },
  queryKeys: [["endurance", table, "evt-123"]],
});

/** Fake scheduler capturing the fire callback so tests can trigger/inspect it. */
const captureScheduler = (captured: Array<{ delayMs: number; fire: () => void; cancel: ReturnType<typeof vi.fn> }>) => ({
  scheduleReconnect: (delayMs: number, fire: () => void) => {
    const entry = { delayMs, fire, cancel: vi.fn() };
    captured.push(entry);
    return entry.cancel;
  },
});

const silent = { scheduleReconnect: () => ({ cancel: () => {} }) };

describe("EnduranceRealtimeSubscription (client lifecycle)", () => {
  it("opens one channel, narrow-subscribes every table, and invalidates on a row change", () => {
    const factory = vi.fn((name: string) => new FakeChannel(name));
    const invalidated: unknown[][] = [];
    const sub = new EnduranceRealtimeSubscription({
      channelName: enduranceRealtimeChannelName({ kind: "event", id: "evt-123", instanceId: "x" }),
      bindings: [binding("endurance_stints"), binding("endurance_teams")],
      createChannel: factory,
      invalidate: (keys) => invalidated.push(...keys),
      scheduleReconnect: silent.scheduleReconnect,
    });
    sub.start();

    expect(factory).toHaveBeenCalledTimes(1);
    const channel = factory.mock.results[0].value as FakeChannel;
    expect(channel.changes.map((c) => c.table)).toEqual(["endurance_stints", "endurance_teams"]);
    // Every table is narrow-subscribed — never an unfiltered broad subscription.
    expect(channel.changes.every((c) => c.filter === "event_id=eq.evt-123")).toBe(true);
    expect(invalidated).toEqual([]);
    channel.changes[0].onRow();
    expect(invalidated).toEqual([["endurance", "endurance_stints", "evt-123"]]);
  });

  it("reconnects with bounded exponential backoff, always on a fresh channel, and gives up at the cap", () => {
    const created: FakeChannel[] = [];
    const pendings: { delayMs: number; fire: () => void; cancel: ReturnType<typeof vi.fn> }[] = [];
    const sub = new EnduranceRealtimeSubscription({
      channelName: "endurance:realtime:event:evt-1:i",
      bindings: [binding("endurance_stints")],
      createChannel: (name) => {
        const ch = new FakeChannel(name);
        created.push(ch);
        return ch;
      },
      invalidate: () => {},
      scheduleReconnect: (d, f) => {
        const entry = { delayMs: d, fire: f, cancel: vi.fn() };
        pendings.push(entry);
        return entry.cancel;
      },
    });
    sub.start();

    // First channel drops → a backoff is scheduled (NOT an immediate re-subscribe() on the same channel).
    created[0].subscriber?.("CHANNEL_ERROR");
    expect(pendings).toHaveLength(1);
    expect(pendings[0].delayMs).toBe(ENDURANCE_REALTIME_INITIAL_BACKOFF_MS);

    // Elke timer opent een nieuw channel; een volgende fout plant pas de volgende backoff.
    for (let step = 1; step <= ENDURANCE_REALTIME_MAX_RECONNECT_ATTEMPTS; step += 1) {
      const latestPending = pendings[pendings.length - 1];
      const previousChannel = created[created.length - 1];
      latestPending.fire();
      expect(created[created.length - 1]).not.toBe(previousChannel);
      const current = created[created.length - 1];
      current.subscriber?.("CHANNEL_ERROR");
    }
    // Na vijf reconnects wordt geen zesde timer meer gepland.
    expect(created.length).toBe(1 + ENDURANCE_REALTIME_MAX_RECONNECT_ATTEMPTS);
    expect(pendings).toHaveLength(ENDURANCE_REALTIME_MAX_RECONNECT_ATTEMPTS);
  });

  it("cleanup cancels the pending reconnect timer and removes the current channel", () => {
    const factory = vi.fn((name: string) => new FakeChannel(name));
    const pendings: { delayMs: number; fire: () => void; cancel: ReturnType<typeof vi.fn> }[] = [];
    const sub = new EnduranceRealtimeSubscription({
      channelName: "endurance:realtime:event:evt-1:i",
      bindings: [binding("endurance_stints")],
      createChannel: factory,
      invalidate: () => {},
      scheduleReconnect: (d, f) => {
        const entry = { delayMs: d, fire: f, cancel: vi.fn() };
        pendings.push(entry);
        return entry.cancel;
      },
    });
    sub.start();
    const first = factory.mock.results[0].value as FakeChannel;
    first.subscriber?.("CHANNEL_ERROR");
    expect(pendings).toHaveLength(1);
    expect(first.removed).toBe(true); // failed channel torn down immediately

    sub.close();
    expect(pendings[0].cancel).toHaveBeenCalledTimes(1); // pending backoff timer cancelled

    sub.close(); // idempotent
  });

  it("gives two hook instances distinct channel names (no cross-instance collision)", () => {
    const names: string[] = [];
    const factory = (name: string) => {
      names.push(name);
      return new FakeChannel(name);
    };
    const a = new EnduranceRealtimeSubscription({
      channelName: enduranceRealtimeChannelName({ kind: "event", id: "evt-123", instanceId: "iA" }),
      bindings: [binding("endurance_teams")],
      createChannel: factory,
      invalidate: () => {},
      scheduleReconnect: silent.scheduleReconnect,
    });
    const b = new EnduranceRealtimeSubscription({
      channelName: enduranceRealtimeChannelName({ kind: "event", id: "evt-123", instanceId: "iB" }),
      bindings: [binding("endurance_stints")],
      createChannel: factory,
      invalidate: () => {},
      scheduleReconnect: silent.scheduleReconnect,
    });
    a.start();
    b.start();
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });
});