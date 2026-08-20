import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { LayeredTrackManifest } from "@/lib/layeredTrackMaps";

const { manifest } = vi.hoisted(() => ({
  manifest: {
    schemaVersion: 1,
    sourceSnapshot: "2026-05-05",
    count: 3,
    tracks: [
      { trackId: 202, name: "Oran Park Raceway - Grand Prix", configName: "Grand Prix", path: "/tracks/layered/track-202.svg" },
      { trackId: 203, name: "Oran Park Raceway - North", configName: "North", path: "/tracks/layered/track-203.svg" },
      { trackId: 523, name: "Circuit de Spa-Francorchamps - Grand Prix Pits", configName: "Grand Prix Pits", path: "/tracks/layered/track-523.svg" },
    ],
  } satisfies LayeredTrackManifest,
}));

vi.mock("@/lib/layeredTrackMaps", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/layeredTrackMaps")>();
  return { ...actual, loadLayeredTrackManifest: vi.fn().mockResolvedValue(manifest) };
});

import { TrackSelect } from "@/components/admin/TrackSelect";

const ControlledTrackSelect = ({ onChange }: { onChange: (name: string, trackId: number | null) => void }) => {
  const [selection, setSelection] = useState({ name: "", trackId: null as number | null });
  return <TrackSelect value={selection.name} trackId={selection.trackId} onChange={(name, trackId) => { setSelection({ name, trackId }); onChange(name, trackId); }} />;
};

describe("authoritative TrackSelect", () => {
  it("requires a concrete configuration and emits its readable name plus TrackID", async () => {
    const onChange = vi.fn();
    render(<ControlledTrackSelect onChange={onChange} />);

    await waitFor(() => expect(screen.getByLabelText("Circuit")).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("Circuit"), { target: { value: "Oran Park Raceway" } });
    expect(onChange).toHaveBeenLastCalledWith("Oran Park Raceway", null);

    fireEvent.change(screen.getByLabelText("Configuratie"), { target: { value: "202" } });
    expect(onChange).toHaveBeenLastCalledWith("Oran Park Raceway - Grand Prix", 202);
  });

  it("selects a single-layout circuit authoritatively in one step", async () => {
    const onChange = vi.fn();
    render(<ControlledTrackSelect onChange={onChange} />);

    await waitFor(() => expect(screen.getByLabelText("Circuit")).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("Circuit"), { target: { value: "Circuit de Spa-Francorchamps" } });
    expect(onChange).toHaveBeenLastCalledWith("Circuit de Spa-Francorchamps - Grand Prix Pits", 523);
  });
});
