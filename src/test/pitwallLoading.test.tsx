import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { usePitwallData } from "@/features/endurance/pitwall/usePitwallData";
import { fetchPitwallData } from "@/features/endurance/repository/pitwallRepository";

vi.mock("@/features/endurance/repository/pitwallRepository", () => ({ fetchPitwallData: vi.fn(async () => ({ telemetry: null })) }));

describe("Pitwall asynchronous selection", () => {
  it("starts loading when the team arrives and resets on a different event", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const hook = renderHook(({ event, team }: { event: string; team: string | null }) => usePitwallData(event, team), { initialProps: { event: "one", team: null }, wrapper });
    expect(hook.result.current.selectedTeamId).toBeNull();
    hook.rerender({ event: "one", team: "team-a" });
    await waitFor(() => expect(fetchPitwallData).toHaveBeenCalledWith("one", "team-a"));
    act(() => hook.result.current.setSelectedTeamId("team-b"));
    expect(hook.result.current.selectedTeamId).toBe("team-b");
    hook.rerender({ event: "two", team: "team-c" });
    expect(hook.result.current.selectedTeamId).toBe("team-c");
    expect(hook.result.current.isLive).toBe(false);
    hook.unmount();
    client.clear();
  });
});
