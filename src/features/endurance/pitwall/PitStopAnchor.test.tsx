import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const readTyreStops = vi.fn();
const answerTyreStop = vi.fn();

vi.mock("@/lib/pitwallTyreStops", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pitwallTyreStops")>("@/lib/pitwallTyreStops");
  return {
    ...actual,
    readTyreStops: (...a: unknown[]) => readTyreStops(...a),
    answerTyreStop: (...a: unknown[]) => answerTyreStop(...a),
  };
});

import { PitStopAnchor } from "./PitStopAnchor";

const source = { eventId: "e1", teamId: "t1" };

const stop = (over: Record<string, unknown> = {}) => ({
  visitKey: "seq:8812",
  anchorSeq: 8812,
  lap: 23,
  sessionTimeSeconds: 872,
  setsUsed: 1,
  setFl: 1,
  setFr: 1,
  setRl: 1,
  setRr: 1,
  fuelBeforeLitres: 12.4,
  fuelAfterLitres: 54.7,
  answer: null,
  ...over,
});

describe("PitStopAnchor", () => {
  beforeEach(() => {
    readTyreStops.mockReset();
    answerTyreStop.mockReset();
    window.sessionStorage.clear();
  });

  it("toont niets als de pitwall niet live is", () => {
    const { container } = render(<PitStopAnchor source={source} enabled={false} />);
    expect(container).toBeEmptyDOMElement();
    expect(readTyreStops).not.toHaveBeenCalled();
  });

  it("vraagt een nieuwe stop en toont de gemeten liters", async () => {
    readTyreStops.mockResolvedValue({ sessionKey: "simhub-abc", stops: [stop()] });
    render(<PitStopAnchor source={source} enabled />);
    await waitFor(() => expect(screen.getByText(/Ronde 23/)).toBeInTheDocument());
    expect(screen.getByText(/Tankverschil: 42,3 L/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Banden gewisseld" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alleen getankt" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Beide" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Geen van beide" })).toBeInTheDocument();
    expect(screen.getByText(/Niets invullen betekent onbekend/)).toBeInTheDocument();
  });

  it("legt het antwoord vast en sluit de vraag", async () => {
    readTyreStops.mockResolvedValue({ sessionKey: "simhub-abc", stops: [stop()] });
    answerTyreStop.mockResolvedValue(true);
    render(<PitStopAnchor source={source} enabled />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Beide" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Beide" }));
    await waitFor(() => expect(answerTyreStop).toHaveBeenCalledTimes(1));
    expect(answerTyreStop.mock.calls[0][2]).toBe("both");
    expect(answerTyreStop.mock.calls[0][3]).toBe("simhub-abc");
    await waitFor(() => expect(screen.getByText(/Bevestigd — bedankt\./)).toBeInTheDocument());
  });

  it("vraagt een al gevraagde stop niet opnieuw, maar houdt hem bereikbaar", async () => {
    window.sessionStorage.setItem("pitwall.pitstop.gevraagd", JSON.stringify(["e1:t1|simhub-abc|seq:8812"]));
    readTyreStops.mockResolvedValue({ sessionKey: "simhub-abc", stops: [stop()] });
    render(<PitStopAnchor source={source} enabled />);
    await waitFor(() => expect(screen.getByText("1 stop nog te bevestigen")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Beide" })).toBeNull();
    fireEvent.click(screen.getByText("1 stop nog te bevestigen"));
    expect(screen.getByRole("button", { name: "Beide" })).toBeInTheDocument();
  });

  it("toont geen liters als het niveau ontbreekt", async () => {
    readTyreStops.mockResolvedValue({
      sessionKey: "simhub-abc",
      stops: [stop({ fuelBeforeLitres: null, fuelAfterLitres: 30, lap: null, sessionTimeSeconds: null })],
    });
    render(<PitStopAnchor source={source} enabled />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Beide" })).toBeInTheDocument());
    expect(screen.queryByText(/Tankverschil:/)).toBeNull();
  });

  it("zet een bevestigde stop niet terug als een oude poll binnenkomt", async () => {
    let calls = 0;
    let resolveTweede: (v: unknown) => void = () => {};
    readTyreStops.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve({ sessionKey: "simhub-abc", stops: [stop()] });
      if (calls === 2) return new Promise((r) => { resolveTweede = r; });
      // Latere polls melden de stop nog steeds als onbeantwoord (oude data).
      return Promise.resolve({ sessionKey: "simhub-abc", stops: [stop()] });
    });
    answerTyreStop.mockResolvedValue(true);
    render(<PitStopAnchor source={source} enabled pollMs={40} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Beide" })).toBeInTheDocument());
    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(2));
    fireEvent.click(screen.getByRole("button", { name: "Beide" }));
    await waitFor(() => expect(answerTyreStop).toHaveBeenCalledTimes(1));
    // De tweede (nog lopende) poll komt pas nu terug, met de oude stand.
    resolveTweede({ sessionKey: "simhub-abc", stops: [stop()] });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Beide" })).toBeNull());
  });

  it("toont één stop tegelijk en schuift na bevestiging door", async () => {
    let calls = 0;
    let resolveAnswer: (v: boolean) => void = () => {};
    const tweede = stop({ visitKey: "seq:9000", anchorSeq: 9000, lap: 24, sessionTimeSeconds: 980 });
    readTyreStops.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve({ sessionKey: "simhub-abc", stops: [stop()] });
      return Promise.resolve({ sessionKey: "simhub-abc", stops: [stop(), tweede] });
    });
    answerTyreStop.mockImplementation(() => new Promise<boolean>((r) => { resolveAnswer = r; }));
    render(<PitStopAnchor source={source} enabled pollMs={40} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Beide" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Beide" }));
    // De poll zet een tweede stop erbij: die komt pas na de eerste aan de beurt.
    await waitFor(() => expect(screen.getByText(/Nog 1 stop te bevestigen/)).toBeInTheDocument());
    expect(screen.queryByText(/Ronde 24/)).toBeNull();
    resolveAnswer(true);
    await waitFor(() => expect(screen.getByText(/Ronde 24/)).toBeInTheDocument());
    expect(screen.queryByText(/Ronde 23/)).toBeNull();
  });

  it("toont een voorbeeldkaart als er nog geen pitstop is", async () => {
    readTyreStops.mockResolvedValue({ sessionKey: null, stops: [] });
    render(<PitStopAnchor source={source} enabled showExample />);
    await waitFor(() => expect(screen.getByText(/Nog geen pitstop waargenomen/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Beide" }));
    expect(screen.getByText(/niet opgeslagen/)).toBeInTheDocument();
    expect(answerTyreStop).not.toHaveBeenCalled();
  });
});
