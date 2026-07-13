import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { vi } from "vitest";

const session = { user: { id: "admin-test" } } as Session;
let authHandler: ((event: string, nextSession: Session | null) => void) | null = null;
let roleRequestCount = 0;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session } })),
      onAuthStateChange: vi.fn((handler: (event: string, nextSession: Session | null) => void) => {
        authHandler = handler;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signOut: vi.fn(async () => undefined),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => {
          roleRequestCount += 1;
          if (roleRequestCount === 1) return Promise.resolve({ data: [{ role: "admin" }], error: null });
          return new Promise(() => undefined);
        }),
      })),
    })),
  },
}));

import { AuthProvider, useAuth } from "@/contexts/AuthContext";

const ProtectedDraft = () => {
  const { loading, rolesLoading } = useAuth();
  if (loading || rolesLoading) return <div>Toegangsrechten laden</div>;
  return <input aria-label="Conceptnaam" defaultValue="" />;
};

describe("auth refresh draft persistence", () => {
  it("does not unmount protected forms when the same user's token refreshes", async () => {
    render(<AuthProvider><ProtectedDraft /></AuthProvider>);

    const input = await screen.findByLabelText("Conceptnaam");
    fireEvent.change(input, { target: { value: "Raceconcept blijft staan" } });

    act(() => authHandler?.("TOKEN_REFRESHED", session));

    await waitFor(() => expect(screen.queryByText("Toegangsrechten laden")).not.toBeInTheDocument());
    expect((screen.getByLabelText("Conceptnaam") as HTMLInputElement).value).toBe("Raceconcept blijft staan");
  });
});
