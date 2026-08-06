import { Bell, Check } from "lucide-react";
import { useEnduranceActor } from "../core/ActorContext";
import { useEnduranceNotifications, useMarkEnduranceNotificationRead } from "../repository/notificationsRepository";
import { formatAmsterdam } from "../core/selectors";
import { Panel, SecondaryButton, SectionHeading, StatusPill } from "../shared/ui";

/**
 * Meldingen — Fase 3 (test-als).
 * Leest notificaties uit de DB (actor-gefilterd). Markeren als gelezen via de
 * repository. Discord-status wordt getoond maar blijft uitgeschakeld in de canary.
 */
export const NotificationCenter = ({ eventId }: { eventId?: string }) => {
  const { actorId } = useEnduranceActor();
  const { data: notifications = [] } = useEnduranceNotifications();
  const markRead = useMarkEnduranceNotificationRead();
  const mine = notifications.filter((n) => n.user_id === actorId && (!eventId || n.event_id === eventId));
  return <Panel><SectionHeading title="Meldingen" description="Websiteberichten zijn actief. Discord blijft in deze testomgeving bewust uitgeschakeld." />
    <div className="space-y-2">{mine.map((notification) => <div key={notification.id} className={`flex items-start justify-between gap-3 rounded-xl p-3 ring-1 ${notification.read ? "bg-white/[0.025] ring-white/5" : "bg-orange-500/[0.07] ring-orange-500/15"}`}><div className="flex gap-3"><Bell className="mt-0.5 h-4 w-4 text-orange-400" /><div><div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-white">{notification.title}</strong><StatusPill>{notification.discord_status === "disabled" ? "Discord uit" : notification.discord_status}</StatusPill></div><p className="mt-1 text-sm text-gray-400">{notification.message}</p><p className="mt-1 text-[11px] text-gray-600">{formatAmsterdam(notification.created_at)}</p></div></div>{!notification.read && <SecondaryButton className="min-h-8 px-2 py-1" onClick={() => void markRead.mutateAsync(notification.id)} aria-label="Markeer melding als gelezen"><Check className="h-3.5 w-3.5" /></SecondaryButton>}</div>)}{!mine.length && <p className="text-sm text-gray-500">Geen openstaande meldingen.</p>}</div>
  </Panel>;
};
