import communitySupportConfig from "../../../community-support.config.json";
import type { CommunitySupportState, SupportLedgerEntry, SupportRecurringCost } from "./types";

// This shared flag also controls crawler noindex/sitemap behavior in the route generator.
export const COMMUNITY_SUPPORT_PUBLIC = communitySupportConfig.public;

export const canViewCommunitySupport = (isSuperAdmin: boolean) => COMMUNITY_SUPPORT_PUBLIC || isSuperAdmin;
export const canManageCommunitySupport = (isSuperAdmin: boolean) => isSuperAdmin;

const COMMERCIAL_COSTS = new Set(["payment_fee", "merchandise_purchase", "shipping"]);
const SUPPORT_INCOME = new Set(["contribution", "merchandise_income", "referral_income"]);

export const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
export const entryMonth = (value: string) => value.slice(0, 7);

export const recurringCostsForMonth = (costs: SupportRecurringCost[], selectedMonth: string) => costs.filter((cost) => cost.active && cost.startsOn.slice(0, 7) <= selectedMonth);

export const supportMetrics = (state: CommunitySupportState, selectedMonth: string) => {
  const entries = state.ledger.filter((entry) => entryMonth(entry.date) === selectedMonth);
  const recurring = recurringCostsForMonth(state.recurringCosts, selectedMonth);
  const operationalExpenses = entries
    .filter((entry) => entry.direction === "expense" && !COMMERCIAL_COSTS.has(entry.category))
    .reduce((sum, entry) => sum + entry.amount, 0) + recurring.reduce((sum, cost) => sum + cost.amount, 0);
  const supportIncome = entries
    .filter((entry) => entry.direction === "income" && SUPPORT_INCOME.has(entry.category))
    .reduce((sum, entry) => sum + entry.amount, 0);
  const commercialCosts = entries
    .filter((entry) => entry.direction === "expense" && COMMERCIAL_COSTS.has(entry.category))
    .reduce((sum, entry) => sum + entry.amount, 0);
  const netCommunitySupport = Math.max(0, supportIncome - commercialCosts);
  const communityCovered = Math.min(operationalExpenses, netCommunitySupport);
  const selfFunded = Math.max(0, operationalExpenses - netCommunitySupport);
  const surplus = Math.max(0, netCommunitySupport - operationalExpenses);
  const coveragePercent = operationalExpenses > 0 ? Math.min(100, Math.round((communityCovered / operationalExpenses) * 100)) : 0;
  const totalIncome = entries.filter((entry) => entry.direction === "income").reduce((sum, entry) => sum + entry.amount, 0);
  const totalExpenses = entries.filter((entry) => entry.direction === "expense").reduce((sum, entry) => sum + entry.amount, 0) + recurring.reduce((sum, cost) => sum + cost.amount, 0);

  return {
    entries,
    recurring,
    operationalExpenses,
    supportIncome,
    commercialCosts,
    netCommunitySupport,
    communityCovered,
    selfFunded,
    surplus,
    coveragePercent,
    totalIncome,
    totalExpenses,
    reserve: state.settings.reserve + surplus,
  };
};

export const publicLedgerForMonth = (state: CommunitySupportState, selectedMonth: string): SupportLedgerEntry[] => {
  const manual = state.ledger.filter((entry) => entry.isPublic && entryMonth(entry.date) === selectedMonth);
  const recurring = recurringCostsForMonth(state.recurringCosts, selectedMonth)
    .filter((cost) => cost.isPublic)
    .map<SupportLedgerEntry>((cost) => ({
      id: `recurring-${selectedMonth}-${cost.id}`,
      date: `${selectedMonth}-01`,
      direction: "expense",
      category: cost.category,
      description: cost.description,
      amount: cost.amount,
      isPublic: true,
    }));
  return [...manual, ...recurring].sort((a, b) => b.date.localeCompare(a.date));
};
