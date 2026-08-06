import { supabase } from "@/integrations/supabase/client";

export type AdminMerchOrder = {
  id: string;
  productName: string;
  quantity: number;
  amount: number;
  status: string;
  fulfillmentMode: "physical" | "digital";
  deliveryEmail: string | null;
  shippingName: string | null;
  shippingAddress: Record<string, string> | null;
  capturedAt: string | null;
  createdAt: string;
};

type RpcResult = { data: unknown; error: { message: string } | null };
const rpcClient = supabase as unknown as { rpc: (name: string) => PromiseLike<RpcResult> };

export const fetchAdminMerchOrders = async (): Promise<AdminMerchOrder[]> => {
  const { data, error } = await rpcClient.rpc("get_admin_community_support_merch_orders");
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];
  return data.map((row) => {
    const value = row as Record<string, unknown>;
    return {
      id: String(value.id),
      productName: String(value.product_name),
      quantity: Number(value.quantity),
      amount: Number(value.unit_price_eur),
      status: String(value.status),
      fulfillmentMode: value.fulfillment_mode === "digital" ? "digital" : "physical",
      deliveryEmail: value.delivery_email ? String(value.delivery_email) : null,
      shippingName: value.shipping_name ? String(value.shipping_name) : null,
      shippingAddress: value.shipping_address && typeof value.shipping_address === "object" && !Array.isArray(value.shipping_address)
        ? Object.fromEntries(Object.entries(value.shipping_address as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
        : null,
      capturedAt: value.captured_at ? String(value.captured_at) : null,
      createdAt: String(value.created_at),
    };
  });
};

export const fetchOwnedActiveMerchProductIds = async (): Promise<string[]> => {
  const { data, error } = await rpcClient.rpc("get_owned_active_community_support_merch_product_ids");
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];
  return Array.from(new Set(data.map((row) => {
    const value = row as Record<string, unknown>;
    return typeof value.product_id === "string" ? value.product_id : null;
  }).filter((id): id is string => Boolean(id))));
};
