import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const readTyreStops = vi.fn();
const answerTyreStop = vi.fn();

vi.mock("@/lib/pitwallTyreStops", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pitwallTyreStops")>("@/lib/pitwallTyreStops");
  return { ...actual, readTyreStops: (...a: unknown[]) => readTyreStops(...a), answerTyreStop: (...a: unknown[]) => answerTyreStop(...a) };
});

import { PitStopAnchor } from "./PitStopAnchor";

const source = { eventId: "e1", teamId: "t1" };

describe("PitStopAnchor", () => {
  beforeEach(() => {
    readTyreStops.mockReset();
    answerTyreStop.mockReset();
  });

  it("toont niets als de pitwall niet live is", () => {
    const { container } = render(<PitStopAnchor source={source} enabled={false} />);
    expect(container).toBeEmptyDOMElement();
    expect(readTyreStops).not.toHaveBeenCalled();
  });

  it("vraagt het één keer en toont de gemeten liters", async () => {
    readTyreStops.mockResolvedValue({
      sessionKey: "simhub-abc",
      stops: [{
        visitKey: "seq:8812", anchorSeq: 8812, lap: 23, sessionTimeSeconds: 872,
        setsUsed: 1, setFl: 1, setFr: 1, setRl: 1, setRr: 1,
        fuelBeforeLitres: 12.4, fuelAfterLitres: 54.7, answer: null,
      }],
    });
    render(<PitStopAnchor source={source} enabled />);
    await waitFor(() => expect(screen.getByText(/ronde 23/)).toBeInTheDocument());
    expect(screen.getByText(/Tankverschil: 42,3 L/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Banden gewisseld" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alleen getankt" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Beide" })).toBeInTheDocument();
  });

  it("legt het antwoord vast en sluit het vak", async () => {
    readTyreStops.mockResolvedValue({
      sessionKey: "simhub-abc",
      stops: [{
        visitKey: "seq:8812", anchorSeq: 8812, lap: 23, sessionTimeSeconds: 872,
        setsUsed: 1, setFl: 1, setFr: 1, setRl: 1, setRr: 1,
        fuelBeforeLitres: null, fuelAfterLitres: null, answer: null,
      }],
    });
    answerTyreStop.mockResolvedValue(true);
    render(<PitStopAnchor source={source} enabled />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Beide" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Beide" }));
    await waitFor(() => expect(answerTyreStop).toHaveBeenCalledTimes(1));
    expect(answerTyreStop.mock.calls[0][2]).toBe("both");
    expect(answerTyreStop.mock.calls[0][3]).toBe("simhub-abc");
    await waitFor(() => expect(screen.getByText("Bedankt — vastgelegd.")).toBeInTheDocument());
  });

  it("toont geen liters als het niveau ontbreekt", async () => {
    readTyreStops.mockResolvedValue({
      sessionKey: "simhub-abc",
      stops: [{
        visitKey: "seq:1", anchorSeq: 1, lap: null, sessionTimeSeconds: null,
        setsUsed: null, setFl: null, setFr: null, setRl: null, setRr: null,
        fuelBeforeLitres: null, fuelAfterLitres: 30, answer: null,
      }],
    });
    render(<PitStopAnchor source={source} enabled />);
    await waitFor(() => expect(screen.getByText("Wat is er gebeurd?")).toBeInTheDocument());
    expect(screen.queryByText(/Tankverschil:/)).toBeNull();
  });
});
