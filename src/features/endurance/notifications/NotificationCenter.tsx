import { Bell, Check } from "lucide-react";
import { useEnduranceStore } from "../core/EnduranceStore";
import { formatAmsterdam } from "../core/selectors";
import { Panel, SecondaryButton, SectionHeading, StatusPill } from "../shared/ui";

export const NotificationCenter = ({ eventId }: { eventId?: string }) => {
  const { state, activePersona, dispatch } = useEnduranceStore();
  const notifications = state.notifications.filter((notification) => notification.userId === activePersona.id && (!eventId || notification.eventId === eventId));
  return <Panel><SectionHeading title="Meldingen" description="Websiteberichten zijn actief. Discord blijft in deze lokale omgeving bewust uitgeschakeld." />
    <div className="space-y-2">{notifications.map((notification) => <div key={notification.id} className={`flex items-start justify-between gap-3 rounded-xl p-3 ring-1 ${notification.read ? "bg-white/[0.025] ring-white/5" : "bg-orange-500/[0.07] ring-orange-500/15"}`}><div className="flex gap-3"><Bell className="mt-0.5 h-4 w-4 text-orange-400" /><div><div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-white">{notification.title}</strong><StatusPill>{notification.discordStatus === "disabled" ? "Discord uit" : notification.discordStatus}</StatusPill></div><p className="mt-1 text-sm text-gray-400">{notification.message}</p><p className="mt-1 text-[11px] text-gray-600">{formatAmsterdam(notification.createdAt)}</p></div></div>{!notification.read && <SecondaryButton className="min-h-8 px-2 py-1" onClick={() => dispatch({ type: "mark_notification_read", id: notification.id })} aria-label="Markeer melding als gelezen"><Check className="h-3.5 w-3.5" /></SecondaryButton>}</div>)}{!notifications.length && <p className="text-sm text-gray-500">Geen openstaande meldingen.</p>}</div>
  </Panel>;
};
