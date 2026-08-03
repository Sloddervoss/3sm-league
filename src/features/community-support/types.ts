export type SupportLedgerCategory =
  | "contribution"
  | "merchandise_income"
  | "referral_income"
  | "hosting"
  | "server"
  | "race_hosting"
  | "domain"
  | "software"
  | "development"
  | "event"
  | "payment_fee"
  | "payment_refund"
  | "merchandise_purchase"
  | "shipping"
  | "other";

export type SupportLedgerEntry = {
  id: string;
  date: string;
  direction: "income" | "expense";
  category: SupportLedgerCategory;
  description: string;
  amount: number;
  isPublic: boolean;
  supporterName?: string;
  showSupporterName?: boolean;
  showAmount?: boolean;
  automatic?: boolean;
};

export type PublicSupportLedgerEntry = Omit<SupportLedgerEntry, "amount" | "isPublic" | "supporterName" | "showSupporterName" | "showAmount"> & {
  amount: number | null;
  isPublic: true;
  supporterName?: string;
  sourceAmountUsd?: number;
  exchangeRateUsdEur?: number;
  vatRate?: number;
  vatAmountUsd?: number;
  grossAmountUsd?: number;
  netAmount?: number;
  vatAmount?: number;
};

export type SupportRecurringCost = {
  id: string;
  startsOn: string;
  category: Extract<SupportLedgerCategory, "hosting" | "server" | "domain" | "software" | "development" | "other">;
  description: string;
  amount: number;
  frequency: "monthly" | "yearly";
  isPublic: boolean;
  active: boolean;
};

export type SupportRaceCost = {
  id: string;
  raceId: string;
  raceScope: "season" | "standalone";
  leagueId?: string;
  leagueName?: string;
  season?: string;
  raceName: string;
  track: string;
  date: string;
  raceFormat?: string;
  hostedHours: number;
  discountApplied: boolean;
  sourceAmountUsd: number;
  exchangeRateUsdEur: number;
  vatRate: number;
  vatAmountUsd: number;
  grossAmountUsd: number;
  netAmount: number;
  vatAmount: number;
  amount: number;
  isPublic: boolean;
  note?: string;
};

export type PublicSupportRaceCost = Pick<SupportRaceCost, "raceScope" | "leagueName" | "season" | "raceName" | "track" | "date" | "hostedHours" | "discountApplied" | "sourceAmountUsd" | "exchangeRateUsdEur" | "vatRate" | "vatAmountUsd" | "grossAmountUsd" | "netAmount" | "vatAmount" | "amount"> & {
  isPublic: true;
};

export type SupportProduct = {
  id: string;
  name: string;
  description: string;
  price: number;
  purchasePrice: number;
  shippingCost: number;
  fulfillmentMode: "physical" | "digital";
  stock: number;
  active: boolean;
  concept: boolean;
  imageUrls: string[];
};

export type CommunitySupportSettings = {
  reserve: number;
  reserveStartYear?: string;
  racePricingInitialized: boolean;
  usdEurRate: number;
  publicSupporterNamesByDefault: boolean;
  publicSupporterAmountsByDefault: boolean;
  paypalEnabled: boolean;
  paypalCheckoutEnabled: boolean;
  paypalCheckoutEnvironment: "sandbox" | "live";
  paypalMeUrl: string;
  paypalSuggestedAmounts: number[];
  paymentAdminDiscordId: string;
  iracingReferralEnabled: boolean;
  iracingReferralUrl: string;
};

export type SupportPaymentIntentStatus = "pending" | "approved" | "confirmed" | "partially_refunded" | "refunded" | "reversed" | "not_found";

export type SupportPaymentIntentDraft = {
  requestedAmount: number;
  payerName: string;
  showSupporterName: boolean;
  showAmount: boolean;
};

export type SupportPaymentIntent = SupportPaymentIntentDraft & {
  id: string;
  status: SupportPaymentIntentStatus;
  createdAt: string;
  resolvedAt?: string;
  grossAmount?: number;
  feeAmount?: number;
  resolutionNote?: string;
};

export type CommunitySupportState = {
  ledger: SupportLedgerEntry[];
  recurringCosts: SupportRecurringCost[];
  raceCosts: SupportRaceCost[];
  products: SupportProduct[];
  paymentIntents: SupportPaymentIntent[];
  settings: CommunitySupportSettings;
};

export const SUPPORT_CATEGORY_LABELS: Record<SupportLedgerCategory, { nl: string; en: string }> = {
  contribution: { nl: "Vrijwillige bijdrage", en: "Voluntary contribution" },
  merchandise_income: { nl: "Merchandise", en: "Merchandise" },
  referral_income: { nl: "iRacing-referral", en: "iRacing referral" },
  hosting: { nl: "Hosting", en: "Hosting" },
  server: { nl: "Servers", en: "Servers" },
  race_hosting: { nl: "Racehosting", en: "Race hosting" },
  domain: { nl: "Domeinen", en: "Domains" },
  software: { nl: "Software", en: "Software" },
  development: { nl: "Websiteontwikkeling", en: "Website development" },
  event: { nl: "Community-evenementen", en: "Community events" },
  payment_fee: { nl: "Betaalkosten", en: "Payment fees" },
  payment_refund: { nl: "Terugbetaling", en: "Refund" },
  merchandise_purchase: { nl: "Merchandise-inkoop", en: "Merchandise purchasing" },
  shipping: { nl: "Verzendkosten", en: "Shipping costs" },
  other: { nl: "Overig", en: "Other" },
};
