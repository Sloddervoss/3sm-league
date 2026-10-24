import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PracticePaceWorkspace } from "@/features/endurance/practice/PracticePaceWorkspace";
import { isCurrentStint } from "@/features/endurance/shared/stintTiming";
import type { EnduranceEvent } from "@/features/endurance/core/types";
vi.mock("@/features/endurance/pace/PacePanel", () => ({ PacePanel: () => <p>Pace results</p> }));
vi.mock("@/features/endurance/practice/PracticeSessionPanel", () => ({ PracticeSessionPanel: ({ onPaceSynced }: { onPaceSynced: () => void }) => <button onClick={onPaceSynced}>Sync session</button> }));
afterEach(cleanup);
it("opens pace by default and returns to results after syncing a session", () => {
  // Sinds de realtime-fix mount dit scherm useEnduranceRealtime, en die eist een
  // QueryClient. Zonder provider klapt de test om op de hook, niet op de UI.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PracticePaceWorkspace event={{ id: "race" } as EnduranceEvent} />
    </QueryClientProvider>,
  );
  expect(screen.getByText("Pace results")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sessies" }));
  fireEvent.click(screen.getByRole("button", { name: "Sync session" }));
  expect(screen.getByText("Pace results")).toBeInTheDocument();
});
it("uses identical stint boundaries and excludes terminal stints", () => {
  const start = "2026-09-08T12:00:00Z", end = "2026-09-08T13:00:00Z";
  expect(isCurrentStint("confirmed", start, end, start)).toBe(true);
  expect(isCurrentStint("in_car", start, end, end)).toBe(false);
  for (const status of ["completed", "replaced", "expired"]) expect(isCurrentStint(status, start, end, start)).toBe(false);
});
