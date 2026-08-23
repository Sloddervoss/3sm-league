import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PayPalCheckoutButtons from "@/features/community-support/public/PayPalCheckoutButtons";

const draft = {
  requestedAmount: 10,
  payerName: "Sandbox Buyer",
  showSupporterName: true,
  showAmount: false,
};

describe("PayPal Checkout buttons", () => {
  afterEach(() => {
    document.getElementById("paypal-checkout-sdk")?.remove();
    delete window.paypal;
    vi.restoreAllMocks();
  });

  it("creates one intent/order and only reports success after server capture confirmation", async () => {
    const createIntent = vi.fn(async () => "2a9ad46e-f4c1-4c77-94fd-cde7531b76d7");
    const createOrder = vi.fn(async () => "5O190127TN364715T");
    const captureOrder = vi.fn(async () => ({ result: "confirmed" as const, captureId: "3C679366HH908993F", grossAmount: 10, feeAmount: 0.69, netAmount: 9.31 }));
    const onCompleted = vi.fn();
    let callbacks: { createOrder: () => Promise<string>; onApprove: () => Promise<void> } | null = null;

    vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
      window.paypal = {
        Buttons: (options) => {
          callbacks = options;
          return {
            render: async (target) => {
              const marker = document.createElement("button");
              marker.textContent = "Sandbox PayPal button";
              target.appendChild(marker);
            },
          };
        },
      };
      queueMicrotask(() => node.dispatchEvent(new Event("load")));
      return node;
    });

    render(<PayPalCheckoutButtons
      draft={draft}
      language="nl"
      onCompleted={onCompleted}
      onCancelled={vi.fn()}
      getConfig={async () => ({ clientId: "public-sandbox-client-id", environment: "sandbox", currency: "EUR" })}
      createIntent={createIntent}
      createOrder={createOrder}
      captureOrder={captureOrder}
      recoverIntent={async () => null}
    />);

    expect(await screen.findByRole("button", { name: "Sandbox PayPal button" })).toBeInTheDocument();
    expect(onCompleted).not.toHaveBeenCalled();
    expect(callbacks).not.toBeNull();

    await act(async () => {
      expect(await callbacks!.createOrder()).toBe("5O190127TN364715T");
      await callbacks!.onApprove();
    });
    await waitFor(() => expect(onCompleted).toHaveBeenCalledWith(expect.objectContaining({ result: "confirmed", grossAmount: 10, feeAmount: 0.69, netAmount: 9.31 })));
    expect(createIntent).toHaveBeenCalledOnce();
    expect(createIntent).toHaveBeenCalledWith(draft);
    expect(createOrder).toHaveBeenCalledWith("2a9ad46e-f4c1-4c77-94fd-cde7531b76d7");
    expect(captureOrder).toHaveBeenCalledWith("2a9ad46e-f4c1-4c77-94fd-cde7531b76d7");
  });

  it("keeps an uncertain capture recoverable and blocks cancellation until reconciliation succeeds", async () => {
    const intentId = "2a9ad46e-f4c1-4c77-94fd-cde7531b76d7";
    const captureOrder = vi.fn()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce({ result: "already_confirmed" as const, captureId: "3C679366HH908993F", grossAmount: 10, feeAmount: 0.69, netAmount: 9.31 });
    const cancelIntent = vi.fn(async () => undefined);
    const onCompleted = vi.fn();
    let callbacks: { createOrder: () => Promise<string>; onApprove: () => Promise<void> } | null = null;

    vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
      window.paypal = {
        Buttons: (options) => {
          callbacks = options;
          return { render: async (target) => { target.appendChild(document.createElement("button")); } };
        },
      };
      queueMicrotask(() => node.dispatchEvent(new Event("load")));
      return node;
    });

    render(<PayPalCheckoutButtons
      draft={draft}
      language="nl"
      onCompleted={onCompleted}
      onCancelled={vi.fn()}
      getConfig={async () => ({ clientId: "public-sandbox-client-id", environment: "sandbox", currency: "EUR" })}
      createIntent={async () => intentId}
      createOrder={async () => "5O190127TN364715T"}
      captureOrder={captureOrder}
      cancelIntent={cancelIntent}
      recoverIntent={async () => null}
    />);

    await waitFor(() => expect(callbacks).not.toBeNull());
    await act(async () => {
      await callbacks!.createOrder();
      await callbacks!.onApprove();
    });

    expect(screen.getByRole("button", { name: "Controleer betaling opnieuw" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bedrag of privacykeuzes wijzigen" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Controleer betaling opnieuw" }));
    await waitFor(() => expect(onCompleted).toHaveBeenCalledWith(expect.objectContaining({ result: "already_confirmed" })));
    expect(captureOrder).toHaveBeenCalledTimes(2);
    expect(cancelIntent).not.toHaveBeenCalled();
  });

  it("expires an owned pending intent before leaving Checkout", async () => {
    const intentId = "2a9ad46e-f4c1-4c77-94fd-cde7531b76d7";
    const cancelIntent = vi.fn(async () => undefined);
    const onCancelled = vi.fn();
    let callbacks: { createOrder: () => Promise<string> } | null = null;

    vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
      window.paypal = {
        Buttons: (options) => {
          callbacks = options;
          return { render: async (target) => { target.appendChild(document.createElement("button")); } };
        },
      };
      queueMicrotask(() => node.dispatchEvent(new Event("load")));
      return node;
    });

    render(<PayPalCheckoutButtons
      draft={draft}
      language="nl"
      onCompleted={vi.fn()}
      onCancelled={onCancelled}
      getConfig={async () => ({ clientId: "public-sandbox-client-id", environment: "sandbox", currency: "EUR" })}
      createIntent={async () => intentId}
      createOrder={async () => "5O190127TN364715T"}
      captureOrder={vi.fn()}
      cancelIntent={cancelIntent}
      recoverIntent={async () => null}
    />);

    await waitFor(() => expect(callbacks).not.toBeNull());
    await act(async () => { await callbacks!.createOrder(); });
    fireEvent.click(screen.getByRole("button", { name: "Bedrag of privacykeuzes wijzigen" }));
    await waitFor(() => expect(cancelIntent).toHaveBeenCalledWith(intentId));
    expect(onCancelled).toHaveBeenCalledOnce();
  });

  it("recovers an approved intent after remount without creating a new order", async () => {
    const intentId = "2a9ad46e-f4c1-4c77-94fd-cde7531b76d7";
    const captureOrder = vi.fn(async () => ({ result: "already_confirmed" as const, captureId: "3C679366HH908993F", grossAmount: 10, feeAmount: 0.69, netAmount: 9.31 }));
    const createIntent = vi.fn();
    const createOrder = vi.fn();
    const onCompleted = vi.fn();

    render(<PayPalCheckoutButtons
      draft={draft}
      language="nl"
      onCompleted={onCompleted}
      onCancelled={vi.fn()}
      getConfig={vi.fn()}
      createIntent={createIntent}
      createOrder={createOrder}
      captureOrder={captureOrder}
      recoverIntent={async () => ({ intentId, status: "approved" })}
    />);

    expect(await screen.findByRole("button", { name: "Controleer betaling opnieuw" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bedrag of privacykeuzes wijzigen" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Controleer betaling opnieuw" }));
    await waitFor(() => expect(onCompleted).toHaveBeenCalledWith(expect.objectContaining({ result: "already_confirmed" })));
    expect(captureOrder).toHaveBeenCalledWith({ intentId, status: "approved" });
    expect(createIntent).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("expires an orphaned pending intent on remount before allowing a new order", async () => {
    const oldIntentId = "2a9ad46e-f4c1-4c77-94fd-cde7531b76d7";
    const newIntentId = "3b9ad46e-f4c1-4c77-94fd-cde7531b76d8";
    const cancelIntent = vi.fn(async () => undefined);
    const createIntent = vi.fn(async () => ({ intentId: newIntentId }));
    const createOrder = vi.fn(async () => "5O190127TN364715T");
    let callbacks: { createOrder: () => Promise<string> } | null = null;

    vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
      window.paypal = {
        Buttons: (options) => {
          callbacks = options;
          return { render: async (target) => {
            const marker = document.createElement("button");
            marker.textContent = "Sandbox PayPal button";
            target.appendChild(marker);
          } };
        },
      };
      queueMicrotask(() => node.dispatchEvent(new Event("load")));
      return node;
    });

    render(<PayPalCheckoutButtons
      draft={draft}
      language="nl"
      onCompleted={vi.fn()}
      onCancelled={vi.fn()}
      getConfig={async () => ({ clientId: "public-sandbox-client-id", environment: "sandbox", currency: "EUR" })}
      createIntent={createIntent}
      createOrder={createOrder}
      captureOrder={vi.fn()}
      cancelIntent={cancelIntent}
      recoverIntent={async () => ({ intentId: oldIntentId, status: "pending" })}
    />);

    expect(await screen.findByRole("button", { name: "Sandbox PayPal button" })).toBeInTheDocument();
    expect(cancelIntent).toHaveBeenCalledWith({ intentId: oldIntentId, status: "pending" });
    await act(async () => { await callbacks!.createOrder(); });
    expect(createIntent).toHaveBeenCalledWith(draft);
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ intentId: newIntentId }));
  });
});
