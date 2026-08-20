import type { EnduranceRealtimeBinding } from "./enduranceRealtimeMatrix";

export type FilteredEnduranceRealtimeBinding = EnduranceRealtimeBinding;
export type EnduranceChannelStatus = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED" | string;

export interface EnduranceRealtimeChannel {
  onPostgresChanges(binding: FilteredEnduranceRealtimeBinding, onRow: () => void): void;
  subscribe(callback: (status: EnduranceChannelStatus) => void): void;
  remove(): void;
}

export const ENDURANCE_REALTIME_INITIAL_BACKOFF_MS = 500;
export const ENDURANCE_REALTIME_MAX_BACKOFF_MS = 8_000;
export const ENDURANCE_REALTIME_MAX_RECONNECT_ATTEMPTS = 5;

export const enduranceReconnectDelayMs = (attempt: number) => Math.min(
  ENDURANCE_REALTIME_MAX_BACKOFF_MS,
  ENDURANCE_REALTIME_INITIAL_BACKOFF_MS * (2 ** Math.max(0, attempt - 1)),
);
export const enduranceReconnectAttemptAllowsRetry = (attempt: number) =>
  attempt >= 0 && attempt < ENDURANCE_REALTIME_MAX_RECONNECT_ATTEMPTS;

const safeChannelPart = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
export const enduranceRealtimeChannelName = ({ kind, id, instanceId }: {
  kind: "event" | "user";
  id: string;
  instanceId: string;
}) => `endurance:realtime:${kind}:${safeChannelPart(id)}:${safeChannelPart(instanceId)}`;

type CancelHandle = void | (() => void) | { cancel: () => void };
const cancelHandle = (handle: CancelHandle) => {
  if (typeof handle === "function") handle();
  else if (handle && typeof handle === "object") handle.cancel();
};

export class EnduranceRealtimeSubscription {
  private readonly channelName: string;
  private readonly bindings: FilteredEnduranceRealtimeBinding[];
  private readonly createChannel: (name: string) => EnduranceRealtimeChannel;
  private readonly invalidate: (keys: unknown[][]) => void;
  private readonly scheduleReconnect: (delayMs: number, fire: () => void) => CancelHandle;
  private channel: EnduranceRealtimeChannel | null = null;
  private reconnectCancel: CancelHandle;
  private reconnectAttempts = 0;
  private closed = false;

  constructor(options: {
    channelName: string;
    bindings: FilteredEnduranceRealtimeBinding[];
    createChannel: (name: string) => EnduranceRealtimeChannel;
    invalidate: (keys: unknown[][]) => void;
    scheduleReconnect: (delayMs: number, fire: () => void) => CancelHandle;
  }) {
    this.channelName = options.channelName;
    this.bindings = options.bindings;
    this.createChannel = options.createChannel;
    this.invalidate = options.invalidate;
    this.scheduleReconnect = options.scheduleReconnect;
  }

  start() {
    if (this.closed || this.channel) return;
    this.openFreshChannel();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    cancelHandle(this.reconnectCancel);
    this.reconnectCancel = undefined;
    this.removeCurrentChannel();
  }

  private removeCurrentChannel() {
    const current = this.channel;
    this.channel = null;
    current?.remove();
  }

  private openFreshChannel() {
    if (this.closed) return;
    this.reconnectCancel = undefined;
    const channel = this.createChannel(this.channelName);
    this.channel = channel;
    for (const binding of this.bindings) {
      channel.onPostgresChanges(binding, () => this.invalidate(binding.queryKeys));
    }
    channel.subscribe((status) => {
      if (this.closed || channel !== this.channel) return;
      if (status === "SUBSCRIBED") {
        this.reconnectAttempts = 0;
        return;
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        this.removeCurrentChannel();
        this.scheduleNextReconnect();
      }
    });
  }

  private scheduleNextReconnect() {
    if (this.closed || this.reconnectCancel || !enduranceReconnectAttemptAllowsRetry(this.reconnectAttempts)) return;
    this.reconnectAttempts += 1;
    const delayMs = enduranceReconnectDelayMs(this.reconnectAttempts);
    this.reconnectCancel = this.scheduleReconnect(delayMs, () => {
      this.reconnectCancel = undefined;
      this.openFreshChannel();
    });
  }
}
