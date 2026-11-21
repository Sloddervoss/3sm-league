import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Cable,
  Check,
  Copy,
  Loader2,
  Lock,
  Maximize2,
  Radio,
  RefreshCw,
  Share2,
  Square,
  Users,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { SimHubDeviceDetail } from "@/features/control-room/connectors/types";
import type { V3Normalized } from "@/features/endurance/pitwall/pitwallHelpers";
import {
  devicePace,
  deviceStrategyRow,
  deviceTrackLabel,
  isTelemetryLive,
} from "@/features/endurance/pitwall/devicePitwallAdapters";
import { PitwallPremiumView } from "@/features/endurance/pitwall/test-premium/PitwallPremiumView";
import { PremiumFocusBar } from "@/features/endurance/pitwall/test-premium/PremiumFocusBar";
import { usePitwallFocus } from "@/features/endurance/pitwall/test-premium/usePitwallFocus";
import { deriveStandings } from "@/features/endurance/pitwall/standings";
import { usePitwallStrategy } from "@/features/endurance/pitwall/usePitwallStrategy";
import { useTyreModel } from "@/features/endurance/pitwall/useTyreModel";
import { withoutLiveTelemetry } from "@/features/endurance/pitwall/strategy";
import { naarTyreEstimate } from "@/features/endurance/pitwall/strategy/tyreEstimateV2";
import type { TyreEstimate } from "@/features/endurance/pitwall/strategy/tyreGrade";
import { PitDurationPanel } from "@/features/personal-pitwall/PitDurationPanel";
import {
  buildShareUrl,
  copyText,
  createPersonalShare,
  listMyPitwallDevices,
  loadOwnerDeviceDetail,
  readPersonalPitVisits,
  revokePersonalShare,
  shareWithOs,
  type MyPitwallDevice,
} from "@/features/personal-pitwall/share";
import "./personalPitwall.css";

const ONLINE_WINDOW_MS = 5 * 60_000;

const relTime = (iso?: string | null): string => {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 5) return "nu";
  if (s < 60) return `${s}s geleden`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m geleden`;
  return `${Math.round(m / 60)}u geleden`;
};

const isDeviceOnline = (row: MyPitwallDevice): boolean =>
  Boolean(row.last_seen_at && Date.now() - Date.parse(row.last_seen_at) <= ONLINE_WINDOW_MS);

const isHealthOnline = (iso?: string | null): boolean =>
  Boolean(iso && Date.now() - Date.parse(iso) <= ONLINE_WINDOW_MS);

const shareBlockedText = (reason?: MyPitwallDevice["shareable_reason"]): string => {
  switch (reason) {
    case "not_fresh":
      return "De connector is niet meer vers. Wacht op een nieuw telemetrieframe.";
    case "no_session":
    case "no_track":
      return "De connector meldt nog geen herkenbare sessie op een circuit.";
    case "session_ended":
      return "De sessie is afgelopen; delen kan pas in een nieuwe actieve sessie.";
    case "session_inactive":
      return "De auto staat stil of je bent niet in de auto. Deel alleen tijdens een actieve sessie.";
    case "session_unproven":
      return "De simulatorsessie kan niet met zekerheid worden vastgesteld. Delen blijft uit veiligheid uit.";
    default:
      return "Delen kan zodra je connector een verse, actieve racesessie doorgeeft.";
  }
};

function PersonalDeviceDock({
  rows,
  selectedId,
  onSelect,
  loading,
  focusEntry,
}: {
  rows: MyPitwallDevice[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  focusEntry?: React.ReactNode;
}) {
  return (
    <section className="ptp-dock" aria-label="Mijn SimHub-connectors">
      <div className="ptp-dock-head">
        <div>
          <p className="ptp-kicker">Mijn Pitwall</p>
          <h2>
            Mijn connectors <span className="ptp-count">{rows.length}</span>
          </h2>
        </div>
        <p className="ptp-dock-status">
          <span className={rows.some((r) => r.fresh) ? "is-on" : "is-off"} aria-hidden />
          {rows.filter((r) => r.fresh).length} live
          {loading && <span className="ptp-dock-loading">· verversen</span>}
        </p>
        {focusEntry && <div className="ptp-dock-controls">{focusEntry}</div>}
      </div>

      {rows.length === 0 && <p className="ptp-dock-empty">Nog geen connector gekoppeld.</p>}

      {rows.length > 0 && (
        <div className="ptp-dock-scroll" role="group" aria-label="Kies mijn connector">
          {rows.map((row) => {
            const selected = row.id === selectedId;
            const online = isDeviceOnline(row);
            return (
              <button
                key={row.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(row.id)}
                className="ptp-device"
                data-selected={selected ? "true" : undefined}
                title={`${row.name} · ${row.track_name ?? "geen sessie"}`}
              >
                <span className="ptp-device-line">
                  <span className={row.fresh ? "ptp-device-dot is-on" : online ? "ptp-device-dot is-stale" : "ptp-device-dot"} aria-hidden />
                  <span className="ptp-device-name">{row.name}</span>
                  <span className="ptp-device-version">{row.fresh ? "LIVE" : online ? "ONLINE" : "OFFLINE"}</span>
                </span>
                <span className="ptp-device-meta">
                  <span className="ptp-device-track">{row.track_name ?? "geen sessie"}</span>
                  <span className="ptp-device-presence">{row.share_active ? "delen actief" : row.session_state ?? "—"}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ShareBar({
  device,
  shareUrl,
  busy,
  error,
  onShare,
  onRevoke,
  onCopy,
  onOsShare,
  copied,
}: {
  device: MyPitwallDevice;
  shareUrl: string | null;
  busy: boolean;
  error: string | null;
  onShare: () => void;
  onRevoke: () => void;
  onCopy: () => void;
  onOsShare: () => void;
  copied: boolean;
}) {
  const active = Boolean(shareUrl || device.share_active);
  return (
    <section className="pp-share" aria-label="Race delen" data-pp-share>
      <div className="pp-share-head">
        <div>
          <p className="ptp-kicker">Meekijken</p>
          <h2>Deel deze race</h2>
          <p className="pp-share-note">
            Alleen deze sessie op dit circuit. De link is geheim en werkt zonder account; stoppen maakt hem direct ongeldig.
          </p>
        </div>
        <span className={`pp-share-state${active ? " is-on" : ""}`}>
          <Radio aria-hidden size={13} />
          {active ? "delen actief" : "niet gedeeld"}
        </span>
      </div>

      <div className="pp-share-actions">
        {!active && (
          <button
            type="button"
            className="pp-share-primary"
            onClick={onShare}
            disabled={busy || !device.shareable}
            title={device.shareable ? "Maak een verse, geheim deelbare link" : shareBlockedText(device.shareable_reason)}
          >
            {busy ? <Loader2 className="animate-spin" aria-hidden size={15} /> : <Share2 aria-hidden size={15} />}
            Deel deze race
          </button>
        )}
        {active && (
          <>
            <button type="button" className="pp-share-secondary" onClick={onShare} disabled={busy || !device.shareable}>
              {busy ? <Loader2 className="animate-spin" aria-hidden size={15} /> : <RefreshCw aria-hidden size={15} />}
              Nieuwe link
            </button>
            <button type="button" className="pp-share-stop" onClick={onRevoke} disabled={busy}>
              <Square aria-hidden size={13} /> Delen stoppen
            </button>
          </>
        )}
      </div>

      {shareUrl && (
        <div className="pp-share-link">
          <label htmlFor="pp-share-url">Deelbare link</label>
          <div className="pp-share-link-row">
            <input id="pp-share-url" readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" onClick={onCopy} title="Link kopiëren">
              {copied ? <Check aria-hidden size={15} /> : <Copy aria-hidden size={15} />}
              {copied ? "Gekopieerd" : "Kopiëren"}
            </button>
            <button type="button" onClick={onOsShare} title="Delen via je besturingssysteem">
              <Share2 aria-hidden size={15} /> Delen
            </button>
          </div>
        </div>
      )}

      {active && !shareUrl && (
        <p className="pp-share-hint">
          Deze race wordt al gedeeld. De oude link is niet opnieuw te tonen; maak een nieuwe link om opnieuw te delen.
        </p>
      )}
      {!device.shareable && !active && (
        <p className="pp-share-hint">{shareBlockedText(device.shareable_reason)}</p>
      )}
      {error && <p role="alert" className="pp-share-error">{error}</p>}
    </section>
  );
}

export default function PersonalPitwallPage() {
  const { user, loading, rolesLoading } = useAuth();
  const queryClient = useQueryClient();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [dockOpen, setDockOpen] = useState(true);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareRevokedHere, setShareRevokedHere] = useState(false);
  const [copied, setCopied] = useState(false);
  const archiveRef = useRef<HTMLElement | null>(null);

  const focus = usePitwallFocus({ onExit: () => setDockOpen(true) });
  const { active: focusOn, enter: enterFocusMode, exit: exitFocusMode } = focus;
  const focusActive = focusOn;

  const devicesQuery = useQuery({
    queryKey: ["personal-pitwall", "devices", user?.id],
    enabled: Boolean(user),
    queryFn: listMyPitwallDevices,
    refetchInterval: 5_000,
  });

  const devices = useMemo(() => devicesQuery.data?.devices ?? [], [devicesQuery.data]);
  const fresh = useMemo(() => devices.filter((d) => d.fresh), [devices]);

  useEffect(() => {
    if (deviceId && devices.some((d) => d.id === deviceId)) return;
    if (fresh.length === 1) setDeviceId(fresh[0].id);
    else if (devices.length === 1) setDeviceId(devices[0].id);
    else setDeviceId(null);
  }, [deviceId, devices, fresh]);

  useEffect(() => {
    setShareUrl(null);
    setShareError(null);
    setShareRevokedHere(false);
    setCopied(false);
  }, [deviceId]);

  useEffect(() => {
    if (!focusOn) return;
    // Focus is presentation-only; the same tree, data and share state remain.
    setDockOpen(false);
  }, [focusOn]);

  const selected = devices.find((d) => d.id === deviceId) ?? null;

  const detailQuery = useQuery({
    queryKey: ["personal-pitwall", "detail", deviceId],
    enabled: Boolean(user) && Boolean(deviceId) && Boolean(selected?.fresh),
    queryFn: () => loadOwnerDeviceDetail(deviceId!),
    refetchInterval: 1_000,
    retry: 1,
  });

  const sandboxQuery = useQuery({
    queryKey: ["personal-pitwall", "sandbox", deviceId],
    enabled: Boolean(user) && Boolean(deviceId) && Boolean(selected?.fresh),
    queryFn: async () => {
      const readRpc = supabase.rpc.bind(supabase) as unknown as (
        name: string,
        params?: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: unknown }>;
      const { data, error } = await readRpc("pitwall_sandbox_v1", { p_device_id: deviceId });
      if (error) throw error;
      return data as {
        drivers?: { name: string }[];
        lap_samples?: { lap: number; seconds: number | null; driver: string | null }[];
        pace?: { fastest: number | null; median: number | null; count: number };
      };
    },
    refetchInterval: 5_000,
  });

  const detail = detailQuery.data ?? null;
  const v3: V3Normalized | null = useMemo(
    () => (detail?.telemetry?.v3_normalized as V3Normalized | null) ?? null,
    [detail],
  );
  const tele = detail?.telemetry;
  const live = Boolean(detail) && !detailQuery.error && isTelemetryLive(tele?.received_at);
  const online = isHealthOnline(detail?.health?.received_at);

  const eventId = ((detail?.endurance_event ?? {}) as Record<string, unknown>)["id"] as string | undefined;
  const teamId = ((detail?.endurance_team ?? {}) as Record<string, unknown>)["id"] as string | undefined;
  const tyre = useTyreModel({
    client: supabase as unknown as Parameters<typeof useTyreModel>[0]["client"],
    deviceId,
    eventId,
    teamId,
    enabled: Boolean(user) && Boolean(deviceId) && Boolean(selected?.fresh),
  });
  const tyreEstimate: TyreEstimate | null = useMemo(() => naarTyreEstimate(tyre.estimate), [tyre.estimate]);
  const strategy = useMemo(() => deviceStrategyRow(live ? v3 : null), [v3, live]);
  const strategyAdvice = usePitwallStrategy({ strategy, v3, nowMs: Date.now(), learnedFuelUpper: null });
  const effectiveAdvice = live ? strategyAdvice : withoutLiveTelemetry(strategyAdvice);
  const standings = useMemo(() => deriveStandings(v3, 40), [v3]);
  const pace = devicePace(v3);

  const points = (sandboxQuery.data?.lap_samples ?? [])
    .filter((r) => typeof r.seconds === "number" && Number.isFinite(r.seconds) && r.seconds > 0)
    .sort((a, b) => a.lap - b.lap)
    .slice(-60)
    .map((r) => ({ lap: r.lap, seconds: r.seconds as number }));

  const coureurs = useMemo(() => {
    const perDriver = new Map<string, { rondes: number; snelste: number | null }>();
    for (const lap of sandboxQuery.data?.lap_samples ?? []) {
      const name = lap.driver ?? "Onbekend";
      const current = perDriver.get(name) ?? { rondes: 0, snelste: null };
      current.rondes += 1;
      if (typeof lap.seconds === "number" && (current.snelste == null || lap.seconds < current.snelste)) {
        current.snelste = lap.seconds;
      }
      perDriver.set(name, current);
    }
    return [...perDriver.entries()].map(([naam, value]) => ({ naam, ...value }));
  }, [sandboxQuery.data]);

  const ownDriverName = v3?.identity?.currentDriverName ?? tele?.current_driver_name ?? null;
  const ownCarName = tele?.car_name ?? v3?.identity?.carName ?? null;
  const trackLabel = deviceTrackLabel(v3, tele?.track_name) || "";
  const linkedTeamName = (detail?.endurance_team as Record<string, unknown> | null)?.["name"] as string | null | undefined;
  const sessionPace = sandboxQuery.data?.pace ?? null;
  const contextKey = [
    deviceId ?? "",
    detail?.device?.last_session_id ?? "",
    tele?.session_id ?? "",
    tele?.race_run_id ?? "",
    trackLabel,
    ownDriverName ?? "",
  ].join("|");

  const showArchive = useCallback(() => {
    const archive = archiveRef.current;
    if (!archive) return;
    archive.scrollIntoView?.({ block: "start", behavior: "smooth" });
    archive.focus({ preventScroll: true });
  }, []);

  const enterFocus = useCallback(
    (trigger?: HTMLElement | null) => {
      if (focusOn) return;
      setDockOpen(false);
      enterFocusMode(trigger);
    },
    [focusOn, enterFocusMode],
  );

  useEffect(() => {
    if (!detail && focusOn) exitFocusMode();
  }, [detail, focusOn, exitFocusMode]);

  const handleShare = useCallback(async () => {
    if (!deviceId || !selected?.shareable) return;
    setShareBusy(true);
    setShareError(null);
    try {
      const result = await createPersonalShare(deviceId);
      if (!("token" in result)) {
        setShareError(
          result.code === "not_fresh"
            ? "De connector is niet meer vers genoeg. Wacht op een nieuw telemetrieframe."
            : result.code === "session_unproven"
              ? "De simulatorsessie kan niet met zekerheid worden vastgesteld; delen is uit veiligheid geweigerd."
              : "Delen is nu niet beschikbaar voor deze sessie.",
        );
        return;
      }
      setShareUrl(buildShareUrl(result.token));
      setShareRevokedHere(false);
      setCopied(false);
      await queryClient.invalidateQueries({ queryKey: ["personal-pitwall", "devices", user?.id] });
    } catch (error) {
      setShareError(error instanceof Error ? error.message : "Delen starten mislukt.");
    } finally {
      setShareBusy(false);
    }
  }, [deviceId, selected?.shareable, queryClient, user?.id]);

  const handleRevoke = useCallback(async () => {
    if (!deviceId) return;
    setShareBusy(true);
    setShareError(null);
    try {
      await revokePersonalShare(deviceId);
      setShareUrl(null);
      setShareRevokedHere(true);
      setCopied(false);
      await queryClient.invalidateQueries({ queryKey: ["personal-pitwall", "devices", user?.id] });
    } catch (error) {
      setShareError(error instanceof Error ? error.message : "Delen stoppen mislukt.");
    } finally {
      setShareBusy(false);
    }
  }, [deviceId, queryClient, user?.id]);

  const handleCopy = useCallback(async () => {
    if (!shareUrl) return;
    const ok = await copyText(shareUrl);
    setCopied(ok);
    if (!ok) setShareError("Kopiëren lukte niet. Selecteer de link en kopieer hem handmatig.");
  }, [shareUrl]);

  const handleOsShare = useCallback(async () => {
    if (!shareUrl) return;
    const outcome = await shareWithOs(shareUrl);
    if (outcome === "unsupported") await handleCopy();
  }, [shareUrl, handleCopy]);

  if (loading || rolesLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#07090c]" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-orange-400" />
        <span className="sr-only">Mijn Pitwall laden…</span>
      </div>
    );
  }

  if (!user) return <Navigate to="/auth?redirect=/pitwall/" replace />;

  if (!devicesQuery.isLoading && devices.length === 0) {
    return (
      <div className="min-h-screen bg-[#07090c]" data-no-translate>
        <Navbar />
        <main className="container mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center gap-5 px-4 pt-24 text-center">
          <span className="pp-state-icon"><Cable aria-hidden size={26} /></span>
          <p className="ptp-kicker">Mijn Pitwall</p>
          <h1 className="font-heading text-3xl font-black text-white">Nog geen connector gevonden</h1>
          <p className="max-w-md text-sm text-gray-400">
            Koppel je SimHub-connector aan je account. Daarna opent jouw persoonlijke premium Pitwall hier automatisch.
          </p>
          <Link to="/simhub-koppelen" className="pp-state-cta">
            <Cable aria-hidden size={16} /> SimHub koppelen
          </Link>
          {devicesQuery.error && <p role="alert" className="text-sm text-red-300">Connectors laden mislukt.</p>}
        </main>
        <Footer />
      </div>
    );
  }

  const waiting = Boolean(selected) && !selected?.fresh && !detail;
  const choose = !selected && fresh.length > 1;

  return (
    <div className="min-h-screen bg-[#07090c]" data-no-translate data-ptp-focus={focusActive ? "true" : undefined} data-pitwall-personal="true">
      {!focusActive && <Navbar />}
      <main className={`ptp-shell${focusActive ? " ptp-shell--focus" : ""}`} data-pitwall-test-premium="true">
        <div
          ref={focus.shellRef}
          className="ptp-focus-shell"
          data-ptp-focus-shell={focusActive ? "true" : undefined}
          role={focusActive ? "region" : undefined}
          aria-label={focusActive ? "Mijn Pitwall focusweergave" : undefined}
          tabIndex={focusActive ? -1 : undefined}
        >
          <PremiumFocusBar
            active={focusActive}
            fullscreen={focus.fullscreen}
            message={focus.message}
            profilesOpen={dockOpen}
            deviceCount={devices.length}
            exitButtonRef={focus.exitButtonRef}
            onToggleProfiles={() => setDockOpen((open) => !open)}
            onShowArchive={showArchive}
            onToggleFullscreen={() => void focus.toggleFullscreen()}
            onExit={focus.exit}
          />

          <div className="ptp-focus-dock" id="ptp-focus-profiles" hidden={focusActive && !dockOpen}>
            <PersonalDeviceDock
              rows={devices}
              selectedId={deviceId}
              onSelect={setDeviceId}
              loading={devicesQuery.isFetching}
              focusEntry={
                detail ? (
                  <button
                    type="button"
                    data-pitwall-focus-entry="true"
                    onClick={(event) => enterFocus(event.currentTarget)}
                    disabled={focusActive}
                    className="ptp-focus-entry inline-flex min-h-7 items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-gray-300 hover:border-orange-500/40 hover:text-white disabled:cursor-default disabled:opacity-50"
                  >
                    <Maximize2 aria-hidden size={12} /> Focus mode
                  </button>
                ) : null
              }
            />
          </div>

          {devicesQuery.error && (
            <p role="alert" className="ptp-empty-state">Mijn connectors laden mislukt. We proberen het automatisch opnieuw.</p>
          )}

          {devicesQuery.isLoading && (
            <div className="pp-waiting" role="status">
              <Loader2 className="animate-spin" aria-hidden size={24} />
              <p className="ptp-kicker">Mijn Pitwall</p>
              <h1>Connectors laden</h1>
            </div>
          )}

          {choose && (
            <section className="pp-choose" aria-label="Kies je connector">
              <p className="ptp-kicker">Meer dan één connector live</p>
              <h1>Welke race bekijk je?</h1>
              <p>Kies bewust je eigen connector. Er wordt niets automatisch gekozen als meerdere apparaten verse data sturen.</p>
              <div className="pp-choose-grid">
                {fresh.map((row) => (
                  <button key={row.id} type="button" onClick={() => setDeviceId(row.id)}>
                    <span className="pp-choose-dot" aria-hidden />
                    <strong>{row.name}</strong>
                    <span>{row.track_name ?? "geen sessie"}</span>
                    <small>{row.driver_name ?? "—"} · {relTime(row.telemetry_received_at)}</small>
                  </button>
                ))}
              </div>
            </section>
          )}

          {waiting && selected && (
            <section className="pp-waiting" role="status">
              <span className="pp-state-icon"><Radio aria-hidden size={24} /></span>
              <p className="ptp-kicker">{selected.name}</p>
              <h1>Wachten op live telemetrie</h1>
              <p>
                De connector is gekoppeld maar stuurt nu geen verse racegegevens.
                {selected.telemetry_received_at ? ` Laatste frame ${relTime(selected.telemetry_received_at)}.` : " Nog geen frame ontvangen."}
              </p>
              <p className="pp-waiting-hint">Zodra je in de auto zit, verschijnt de premium Pitwall hier vanzelf.</p>
              {selected.share_active && (
                <ShareBar
                  device={shareRevokedHere ? { ...selected, share_active: false } : selected}
                  shareUrl={shareUrl}
                  busy={shareBusy}
                  error={shareError}
                  onShare={() => void handleShare()}
                  onRevoke={() => void handleRevoke()}
                  onCopy={() => void handleCopy()}
                  onOsShare={() => void handleOsShare()}
                  copied={copied}
                />
              )}
            </section>
          )}

          {!choose && !waiting && !selected && !devicesQuery.isLoading && (
            <section className="pp-waiting" role="status">
              <span className="pp-state-icon"><Radio aria-hidden size={24} /></span>
              <h1>Wachten op een verse sessie</h1>
              <p>Kies een connector hierboven of start een sessie in SimHub.</p>
            </section>
          )}

          {selected && detail && (
            <>
              <ShareBar
                device={shareRevokedHere ? { ...selected, share_active: false } : selected}
                shareUrl={shareUrl}
                busy={shareBusy}
                error={shareError}
                onShare={() => void handleShare()}
                onRevoke={() => void handleRevoke()}
                onCopy={() => void handleCopy()}
                onOsShare={() => void handleOsShare()}
                copied={copied}
              />
              <PitwallPremiumView
                detail={detail as SimHubDeviceDetail}
                deviceId={deviceId!}
                live={live}
                online={online}
                v3={v3}
                trackLabel={trackLabel}
                ownDriverName={ownDriverName}
                ownCarName={ownCarName}
                linkedTeamName={linkedTeamName ?? null}
                standings={standings}
                strategy={strategy}
                strategyAdvice={effectiveAdvice}
                pace={pace}
                points={points}
                sessionPace={sessionPace}
                tyre={tyre}
                tyreEstimate={tyreEstimate}
                motionEnabled={!window.matchMedia("(prefers-reduced-motion: reduce)").matches}
                refreshing={detailQuery.isFetching}
                contextKey={contextKey}
                gap={Boolean(detailQuery.error) || !tele}
                lastSeen={relTime(detail.health?.received_at)}
                tag="MIJN PITWALL"
                pitDuration={<PitDurationPanel deviceId={deviceId} enabled={live} load={readPersonalPitVisits} />}
              />
            </>
          )}

          {detailQuery.error && selected && (
            <p role="alert" className="ptp-empty-state">
              <Lock aria-hidden size={18} /> Live data van deze connector kon niet worden geladen.
            </p>
          )}

          {selected && detail && (
            <section
              ref={archiveRef}
              tabIndex={-1}
              className="mt-4 rounded-xl border border-[#1D2431] bg-[#0B0D11] px-5 py-4"
              data-ptp-archive
              aria-label="Coureurs op dit apparaat"
            >
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-gray-400">
                  <Users aria-hidden size={13} /> Coureurs op dit apparaat
                </h2>
                <span className="text-[11px] text-gray-500">
                  {sandboxQuery.data?.pace?.count ?? 0} rondes vastgelegd
                  {sandboxQuery.data?.pace?.fastest != null ? ` · snelste ${sandboxQuery.data.pace.fastest.toFixed(2)} s` : ""}
                </span>
              </div>
              {coureurs.length === 0 ? (
                <p className="text-sm text-gray-500">Nog niemand gereden in deze sessie.</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {coureurs.map((coureur) => (
                    <li key={coureur.naam} className="flex items-center justify-between rounded-xl border border-[#1D2431] bg-black/30 px-3 py-2">
                      <span className="text-sm text-white">{coureur.naam}</span>
                      <span className="text-xs text-gray-400">
                        {coureur.rondes} rondes{coureur.snelste != null ? ` · ${coureur.snelste.toFixed(2)} s` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </main>
      {!focusActive && <Footer />}
    </div>
  );
}
