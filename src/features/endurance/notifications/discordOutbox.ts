import type { EnduranceEvent, EnduranceNotification } from "../core/types";

export interface DiscordOutboxItem { eventId: string; userId: string; content: string; privatePath: string; enabled: false }

export const buildDiscordOutboxItem = (notification: EnduranceNotification, event: EnduranceEvent): DiscordOutboxItem => ({
  eventId: event.id,
  userId: notification.userId,
  content: `${notification.title} — open je privé-racepagina voor de details.`,
  privatePath: notification.privatePath,
  enabled: false,
});
