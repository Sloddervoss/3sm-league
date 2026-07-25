import communitySupportConfig from "../../../community-support.config.json";
import type { CommunitySupportState, PublicSupportLedgerEntry, SupportLedgerEntry, SupportRecurringCost } from "./types";

export const COMMUNITY_SUPPORT_HAS_SHARED_DATA = communitySupportConfig.dataSource === "supabase";
// Fail closed: a local browser/session dataset can never be made public by a visibility toggle alone.
export const COMMUNITY_SUPPORT_PUBLIC = communitySupportConfig.public && COMMUNITY_SUPPORT_HAS_SHARED_DATA;

export const canViewCommunitySupport = (isSuperAdmin: boolean) => COMMUNITY_SUPPORT_PUBLIC || isSuperAdmin;
export const canManageCommunitySupport = (isSuperAdmin: boolean) => isSuperAdmin;

const COMMERCIAL_COSTS = new Set(["payment_fee", "merchandise_purchase", "shipping"]);
const SUPPORT_INCOME = new Set(["contribution", "merchandise_income", "referral_income"]);
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const sumAmounts = <T extends { amount: number }>(values: T[]) => roundMoney(values.reduce((sum, value) => sum + value.amount, 0));

export const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
export const entryMonth = (value: string) => value.slice(0, 7);

export const recurringCostsForMonth = (costs: SupportRecurringCost[], selectedMonth: string) => costs.filter((cost) => cost.active && cost.startsOn.slice(0, 7) <= selectedMonth);

export const supportMetrics = (state: CommunitySupportState, selectedMonth: string) => {
  const entries = state.ledger.filter((entry) => entryMonth(entry.date) === selectedMonth);
  const recurring = recurringCostsForMonth(state.recurringCosts, selectedMonth);
  const recurringTotal = sumAmounts(recurring);
  const operationalExpenses = roundMoney(sumAmounts(entries.filter((entry) => entry.direction === "expense" && !COMMERCIAL_COSTS.has(entry.category))) + recurringTotal);
  const supportIncome = sumAmounts(entries.filter((entry) => entry.direction === "income" && SUPPORT_INCOME.has(entry.category)));
  const commercialCosts = sumAmounts(entries.filter((entry) => entry.direction === "expense" && COMMERCIAL_COSTS.has(entry.category)));
  const netCommunitySupport = roundMoney(Math.max(0, supportIncome - commercialCosts));
  const communityCovered = roundMoney(Math.min(operationalExpenses, netCommunitySupport));
  const selfFunded = roundMoney(Math.max(0, operationalExpenses - netCommunitySupport));
  const surplus = roundMoney(Math.max(0, netCommunitySupport - operationalExpenses));
  const coveragePercent = operationalExpenses > 0 ? Math.min(100, Math.round((communityCovered / operationalExpenses) * 100)) : 0;
  const totalIncome = sumAmounts(entries.filter((entry) => entry.direction === "income"));
  const totalExpenses = roundMoney(sumAmounts(entries.filter((entry) => entry.direction === "expense")) + recurringTotal);

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
    reserve: roundMoney(state.settings.reserve + surplus),
  };
};

const redactPublicEntry = (entry: SupportLedgerEntry): PublicSupportLedgerEntry => {
  const isContribution = entry.direction === "income" && entry.category === "contribution";
  return {
    id: entry.id,
    date: entry.date,
    direction: entry.direction,
    category: entry.category,
    description: entry.description,
    amount: isContribution && entry.showAmount !== true ? null : entry.amount,
    isPublic: true,
    ...(isContribution && entry.showSupporterName === true && entry.supporterName?.trim()
      ? { supporterName: entry.supporterName.trim() }
      : {}),
  };
};

export const publicLedgerForMonth = (state: CommunitySupportState, selectedMonth: string): PublicSupportLedgerEntry[] => {
  const manual = state.ledger
    .filter((entry) => entry.isPublic && entryMonth(entry.date) === selectedMonth)
    .map(redactPublicEntry);
  const recurring = recurringCostsForMonth(state.recurringCosts, selectedMonth)
    .filter((cost) => cost.isPublic)
    .map<PublicSupportLedgerEntry>((cost) => ({
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
