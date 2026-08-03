export type PayPalButtonsInstance = { render: (target: HTMLElement) => Promise<void>; close?: () => Promise<void> };
export type PayPalNamespace = {
  Buttons: (options: {
    createOrder: () => Promise<string>;
    onApprove: () => Promise<void>;
    onCancel: () => void;
    onError: (error: unknown) => void;
  }) => PayPalButtonsInstance;
};

declare global {
  interface Window { paypal?: PayPalNamespace }
}

let loadedClientId = "";
export const loadPayPalSdk = async (clientId: string): Promise<PayPalNamespace> => {
  if (window.paypal && loadedClientId === clientId) return window.paypal;
  const existing = document.getElementById("paypal-checkout-sdk");
  if (existing) existing.remove();
  delete window.paypal;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.id = "paypal-checkout-sdk";
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=EUR&intent=capture&components=buttons`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("PayPal SDK could not be loaded"));
    document.head.appendChild(script);
  });
  if (!window.paypal) throw new Error("PayPal SDK is unavailable");
  loadedClientId = clientId;
  return window.paypal;
};
