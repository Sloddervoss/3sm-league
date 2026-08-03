import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupportProduct } from "../types";
import type { PayPalMerchRecoveryResult } from "../paymentApi";
import MerchandiseCheckout from "./MerchandiseCheckout";

const mocks = vi.hoisted(() => ({
  createPayPalMerchOrder: vi.fn(async () => ({ orderId: "PAYPAL-ORDER", merchOrderId: "merch-order" })),
  capturePayPalMerchOrder: vi.fn(async () => ({ result: "confirmed", orderId: "merch-order", captureId: "capture", grossAmount: 5 })),
  cancelPayPalMerchOrder: vi.fn(async () => ({ result: "cancelled" })),
  recoverPayPalMerchOrder: vi.fn<() => Promise<PayPalMerchRecoveryResult>>(async () => ({ result: "none" })),
  paypalOptions: null as { createOrder: () => Promise<string>; onApprove: () => Promise<void>; onCancel: () => void } | null,
}));

vi.mock("../paymentApi", () => ({
  fetchPayPalCheckoutConfig: vi.fn(async () => ({ clientId: "client", environment: "sandbox", currency: "EUR" })),
  createPayPalMerchOrder: mocks.createPayPalMerchOrder,
  capturePayPalMerchOrder: mocks.capturePayPalMerchOrder,
  cancelPayPalMerchOrder: mocks.cancelPayPalMerchOrder,
  recoverPayPalMerchOrder: mocks.recoverPayPalMerchOrder,
}));
vi.mock("./paypalSdk", () => ({
  loadPayPalSdk: vi.fn(async () => ({
    Buttons: (options: typeof mocks.paypalOptions) => {
      mocks.paypalOptions = options;
      return { render: async () => undefined, close: async () => undefined };
    },
  })),
}));

const product: SupportProduct = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Digitale pas",
  description: "Levering per e-mail",
  price: 5,
  purchasePrice: 1,
  shippingCost: 0,
  fulfillmentMode: "digital",
  stock: 5,
  active: true,
  concept: false,
  imageUrls: [],
};

afterEach(() => {
  vi.clearAllMocks();
  mocks.paypalOptions = null;
});

describe("MerchandiseCheckout", () => {
  it("explains digital delivery and confirms the reserved server order", async () => {
    const completed = vi.fn();
    render(<MerchandiseCheckout product={product} language="nl" onCompleted={completed} onCancelled={vi.fn()} />);
    expect(screen.getByText(/Digitale levering gebruikt je PayPal-e-mailadres/i)).toBeInTheDocument();
    await waitFor(() => expect(mocks.paypalOptions).not.toBeNull());
    await expect(mocks.paypalOptions!.createOrder()).resolves.toBe("PAYPAL-ORDER");
    await act(async () => { await mocks.paypalOptions!.onApprove(); });
    expect(mocks.createPayPalMerchOrder).toHaveBeenCalledWith(product.id);
    expect(mocks.capturePayPalMerchOrder).toHaveBeenCalledWith("merch-order");
    expect(completed).toHaveBeenCalledTimes(1);
  });

  it("reuses a durable pending order instead of reserving stock twice", async () => {
    mocks.recoverPayPalMerchOrder.mockResolvedValueOnce({ result: "pending", merchOrderId: "existing-merch", orderId: "EXISTING-PAYPAL" });
    render(<MerchandiseCheckout product={product} language="nl" onCompleted={vi.fn()} onCancelled={vi.fn()} />);
    await waitFor(() => expect(mocks.paypalOptions).not.toBeNull());
    await expect(mocks.paypalOptions!.createOrder()).resolves.toBe("EXISTING-PAYPAL");
    expect(mocks.createPayPalMerchOrder).not.toHaveBeenCalled();
  });

  it("ignores a late capture callback after another product checkout replaces it", async () => {
    let resolveCapture: (() => void) | undefined;
    mocks.capturePayPalMerchOrder.mockImplementationOnce(() => new Promise((resolve) => {
      resolveCapture = () => resolve({ result: "confirmed", orderId: "merch-order", captureId: "capture", grossAmount: 5 });
    }));
    const completedA = vi.fn();
    const completedB = vi.fn();
    const view = render(<MerchandiseCheckout product={product} language="nl" onCompleted={completedA} onCancelled={vi.fn()} />);
    await waitFor(() => expect(mocks.paypalOptions).not.toBeNull());
    const firstButtons = mocks.paypalOptions!;
    await firstButtons.createOrder();
    let pendingCapture!: Promise<void>;
    act(() => {
      pendingCapture = firstButtons.onApprove();
    });

    view.rerender(<MerchandiseCheckout product={{ ...product, id: "33333333-3333-4333-8333-333333333333", name: "Andere pas" }} language="nl" onCompleted={completedB} onCancelled={vi.fn()} />);
    await act(async () => {
      resolveCapture?.();
      await pendingCapture;
    });

    expect(completedA).not.toHaveBeenCalled();
    expect(completedB).not.toHaveBeenCalled();
  });

  it("rejects PayPal handlers from a checkout that was replaced before invocation", async () => {
    const completedA = vi.fn();
    const completedB = vi.fn();
    const cancelledA = vi.fn();
    const cancelledB = vi.fn();
    const view = render(<MerchandiseCheckout product={product} language="nl" onCompleted={completedA} onCancelled={cancelledA} />);
    await waitFor(() => expect(mocks.paypalOptions).not.toBeNull());
    const firstButtons = mocks.paypalOptions!;
    await firstButtons.createOrder();

    mocks.paypalOptions = null;
    view.rerender(<MerchandiseCheckout product={{ ...product, id: "44444444-4444-4444-8444-444444444444", name: "Vervangende pas" }} language="nl" onCompleted={completedB} onCancelled={cancelledB} />);
    await waitFor(() => expect(mocks.paypalOptions).not.toBeNull());
    await act(async () => {
      await firstButtons.onApprove();
      firstButtons.onCancel();
    });

    expect(mocks.capturePayPalMerchOrder).not.toHaveBeenCalled();
    expect(completedA).not.toHaveBeenCalled();
    expect(completedB).not.toHaveBeenCalled();
    expect(cancelledA).not.toHaveBeenCalled();
    expect(cancelledB).not.toHaveBeenCalled();
  });
});
