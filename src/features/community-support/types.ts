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
};

export type PublicSupportLedgerEntry = Omit<SupportLedgerEntry, "amount" | "isPublic" | "supporterName" | "showSupporterName" | "showAmount"> & {
  amount: number | null;
  isPublic: true;
  supporterName?: string;
};

export type SupportRecurringCost = {
  id: string;
  startsOn: string;
  category: Extract<SupportLedgerCategory, "hosting" | "server" | "domain" | "software" | "development" | "other">;
  description: string;
  amount: number;
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
  amount: number;
  isPublic: boolean;
  note?: string;
};

export type PublicSupportRaceCost = Pick<SupportRaceCost, "raceScope" | "leagueName" | "season" | "raceName" | "track" | "date" | "amount"> & {
  isPublic: true;
};

export type SupportProduct = {
  id: string;
  name: string;
  description: string;
  price: number;
  purchasePrice: number;
  shippingCost: number;
  stock: number;
  active: boolean;
  concept: boolean;
  imageUrl?: string;
};

export type CommunitySupportSettings = {
  reserve: number;
  reserveStartYear?: string;
  publicSupporterNamesByDefault: boolean;
  publicSupporterAmountsByDefault: boolean;
  paypalEnabled: boolean;
};

export type CommunitySupportState = {
  ledger: SupportLedgerEntry[];
  recurringCosts: SupportRecurringCost[];
  raceCosts: SupportRaceCost[];
  products: SupportProduct[];
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
  merchandise_purchase: { nl: "Merchandise-inkoop", en: "Merchandise purchasing" },
  shipping: { nl: "Verzendkosten", en: "Shipping costs" },
  other: { nl: "Overig", en: "Other" },
};
