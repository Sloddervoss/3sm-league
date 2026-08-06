import { useCallback, useEffect, useState } from "react";
import { Cable, Crown, Loader2, RefreshCw, Trash2, Unplug } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { assignCentralSimHubDevice, clearCentralSimHubDeviceAssignment, listCentralSimHubDevices, type CentralSimHubDevice } from "@/lib/centralSimHubRelay";
import { useEnduranceTeamWorkspace } from "../repository/teamsRepository";
import type { EnduranceEvent } from "../core/types";
import { Field, inputClass, Panel, PrimaryButton, SecondaryButton, SectionHeading, StatusPill } from "../shared/ui";

/**
 * DeviceAssignmentPanel — Fase 4.
 * Super-admin koppelt een (eenmalig aangemaakte) SimHub-installatie aan een
 * endurance event + team. De plugin hoeft niet opnieuw gekoppeld te worden;
 * de routing gebeurt server-side op basis van deze binding.
 */
export const DeviceAssignmentPanel = ({ event }: { event: EnduranceEvent }) => {
  const { isSuperAdmin } = useAuth();
  // Alleen super-admin tijdens de canary (zelfde afscherming als Race Control).
  const staff = Boolean(isSuperAdmin);
  const { data: teamWorkspace } = useEnduranceTeamWorkspace(event.id);
  const teams = teamWorkspace?.teams ?? [];

  const [devices, setDevices] = useState<CentralSimHubDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [teamId, setTeamId] = useState("");

  const load = useCallback(async (silent = false) => {
    if (!staff) return;
    if (!silent) setLoading(true);
    try {
      setDevices(await listCentralSimHubDevices());
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Apparaten konden niet worden geladen.");
    } finally {
      setLoading(false);
    }
  }, [staff]);

  useEffect(() => { void load(); }, [load]);

  const boundHere = devices.filter((d) => d.endurance_event_id === event.id);
  const available = devices.filter((d) => !d.revoked_at && !d.endurance_event_id);

  const assign = async () => {
    if (!deviceId || !teamId) return;
    setBusy(true); setError("");
    try {
      await assignCentralSimHubDevice(deviceId, event.id, teamId);
      setDeviceId(""); setTeamId("");
      await load(true);
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : "Koppelen mislukt.");
    } finally {
      setBusy(false);
    }
  };

  const clearBinding = async (id: string) => {
    setBusy(true); setError("");
    try {
      await clearCentralSimHubDeviceAssignment(id);
      await load(true);
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "Ontkoppelen mislukt.");
    } finally {
      setBusy(false);
    }
  };

  if (!staff) return <Panel><div className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.07] p-4 text-sm text-amber-100"><Crown className="h-4 w-4" />Device-koppeling is tijdens de canary uitsluitend beschikbaar voor super-admin.</div></Panel>;

  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? id.slice(0, 8);

  return <div className="space-y-5">
    <Panel>
      <SectionHeading eyebrow="Eénmalig gekoppeld · server-side routing" title="SimHub-apparaten" description="Koppel een reeds gepaarde SimHub-installatie aan dit endurance-event en het team. De plugin zelf verandert niet; alle routing gebeurt op de server." action={<SecondaryButton onClick={() => void load()} disabled={loading}><Loader2 className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Verversen</SecondaryButton>} />
      {error && <p role="alert" className="mt-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-200 ring-1 ring-red-500/20">{error}</p>}

      <div className="mb-5 grid gap-3 rounded-xl bg-black/20 p-4 ring-1 ring-white/5">
        <strong className="text-sm text-white">Nieuwe koppeling</strong>
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
          <Field label="Apparaat"><select className={inputClass} value={deviceId} onChange={(e) => setDeviceId(e.target.value)}><option value="">Selecteer een ongebonden apparaat</option>{available.map((d) => <option key={d.id} value={d.id}>{d.device_name} · {d.connector_id}</option>)}</select></Field>
          <Field label={`Team (${event.name})`}><select className={inputClass} value={teamId} onChange={(e) => setTeamId(e.target.value)}><option value="">Selecteer een team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name} #{t.car_number}</option>)}</select></Field>
          <div className="flex items-end"><PrimaryButton onClick={() => void assign()} disabled={busy || !deviceId || !teamId}><Cable className="h-4 w-4" /> Koppel</PrimaryButton></div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm"><thead className="text-[11px] uppercase tracking-wider text-gray-500"><tr><th className="pb-3">Apparaat</th><th>Koppeling</th><th>Status</th><th /></tr></thead>
          <tbody className="divide-y divide-white/5">
            {boundHere.map((d) => <tr key={d.id}><td className="py-3 font-bold text-white">{d.device_name}<span className="ml-2 block text-xs font-normal text-gray-500">{d.connector_id}</span></td><td className="text-gray-300">{teamName(d.endurance_team_id ?? "")}</td><td><StatusPill tone={d.revoked_at ? "red" : "green"}>{d.revoked_at ? "Ingetrokken" : "Gekoppeld"}</StatusPill></td><td className="text-right"><SecondaryButton onClick={() => void clearBinding(d.id)} disabled={busy}><Unplug className="h-4 w-4" /> Ontkoppel</SecondaryButton></td></tr>)}
            {boundHere.length === 0 && <tr><td colSpan={4} className="py-5 text-center text-sm text-gray-500">Nog geen apparaat aan dit event gekoppeld.</td></tr>}
          </tbody>
        </table>
      </div>
    </Panel>

    {available.length > 0 && <Panel><SectionHeading title="Overige gepaarde apparaten" description="Nog niet aan een event gekoppeld — beschikbaar op dit of een ander event." />
      <div className="flex flex-wrap gap-2">{available.map((d) => <span key={d.id} className="inline-flex items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-1.5 text-xs text-gray-400 ring-1 ring-white/10"><Cable className="h-3.5 w-3.5" />{d.device_name}</span>)}</div>
      {available.length === 0 && <p className="text-sm text-gray-500">Geen ongebonden apparaten. <Trash2 className="mb-0.5 inline h-3.5 w-3.5" /> Shown voor deelnemers die zich nog niet gekoppeld hebben.</p>}
    </Panel>}
  </div>;
};
