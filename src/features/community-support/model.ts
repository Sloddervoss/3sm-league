import communitySupportConfig from "../../../community-support.config.json";
import type {
  CommunitySupportState,
  PublicSupportCreditPurchase,
  PublicSupportLedgerEntry,
  PublicSupportRaceCost,
  SupportCreditPurchase,
  SupportLedgerEntry,
  SupportRaceCost,
  SupportRecurringCost,
} from "./types";
import { isSupportedCommunitySupportRace } from "./raceEligibility";

export const COMMUNITY_SUPPORT_HAS_SHARED_DATA = communitySupportConfig.dataSource === "supabase";
// Fail closed: a local browser/session dataset can never be made public by a visibility toggle alone.
export const COMMUNITY_SUPPORT_PUBLIC = communitySupportConfig.public && COMMUNITY_SUPPORT_HAS_SHARED_DATA;

export const canViewCommunitySupport = (isSuperAdmin: boolean) => COMMUNITY_SUPPORT_PUBLIC || isSuperAdmin;
export const canManageCommunitySupport = (isSuperAdmin: boolean) => isSuperAdmin;

const COMMERCIAL_COSTS = new Set(["payment_fee", "merchandise_purchase", "shipping"]);
const SUPPORT_INCOME = new Set(["contribution", "merchandise_income", "referral_income"]);
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const sumAmounts = <T extends { amount: number }>(values: T[]) => roundMoney(values.reduce((sum, value) => sum + value.amount, 0));
const sumCreditCostsUsd = (values: SupportRaceCost[]) => roundMoney(values.reduce((sum, value) => sum + value.creditCostUsd, 0));
const sumCreditPurchasesEur = (values: SupportCreditPurchase[]) => roundMoney(values.reduce((sum, value) => sum + value.amountEur, 0));
const sumCreditsPurchasedUsd = (values: SupportCreditPurchase[]) => roundMoney(values.reduce((sum, value) => sum + value.creditsUsd, 0));
const supportedRaceCosts = (state: CommunitySupportState) => (state.raceCosts ?? []).filter(isSupportedCommunitySupportRace);

export const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
export const isValidSupportMonth = (value: string | null, year: string): value is string => Boolean(value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value.startsWith(`${year}-`));
export const entryMonth = (value: string) => value.slice(0, 7);
export const entryYear = (value: string) => value.slice(0, 4);
const monthsForYear = (year: string) => Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);

export const recurringCostsForMonth = (costs: SupportRecurringCost[], selectedMonth: string) => costs.filter((cost) => {
  const startMonth = cost.startsOn.slice(0, 7);
  if (!cost.active || startMonth > selectedMonth) return false;
  return cost.frequency !== "yearly" || startMonth.slice(5, 7) === selectedMonth.slice(5, 7);
});

export const recurringCostOccurrencesForYear = (costs: SupportRecurringCost[], selectedYear: string): SupportRecurringCost[] => monthsForYear(selectedYear).flatMap((month) =>
  recurringCostsForMonth(costs, month).map((cost) => ({ ...cost, id: `${month}-${cost.id}`, startsOn: `${month}-01` })),
);

export const raceCostsForMonth = (state: CommunitySupportState, selectedMonth: string) => supportedRaceCosts(state)
  .filter((cost) => entryMonth(cost.date) === selectedMonth);

export const raceCostsForYear = (state: CommunitySupportState, selectedYear: string) => supportedRaceCosts(state)
  .filter((cost) => entryYear(cost.date) === selectedYear);

export const creditPurchasesForMonth = (state: CommunitySupportState, selectedMonth: string) => (state.creditPurchases ?? [])
  .filter((purchase) => entryMonth(purchase.date) === selectedMonth);

export const creditPurchasesForYear = (state: CommunitySupportState, selectedYear: string) => (state.creditPurchases ?? [])
  .filter((purchase) => entryYear(purchase.date) === selectedYear);

const calculateMetrics = (
  state: CommunitySupportState,
  entries: SupportLedgerEntry[],
  recurring: SupportRecurringCost[],
  creditPurchases: SupportCreditPurchase[],
  raceCosts: SupportRaceCost[],
  openingReserve = state.settings.reserve,
  useOpeningReserve = false,
) => {
  const recurringTotal = sumAmounts(recurring);
  const creditPurchaseTotalEur = sumCreditPurchasesEur(creditPurchases);
  const creditPurchasedTotalUsd = sumCreditsPurchasedUsd(creditPurchases);
  const raceCreditCostTotalUsd = sumCreditCostsUsd(raceCosts);
  const operationalExpenses = roundMoney(
    sumAmounts(entries.filter((entry) => entry.direction === "expense" && !COMMERCIAL_COSTS.has(entry.category)))
    + recurringTotal
    + creditPurchaseTotalEur,
  );
  const supportIncome = sumAmounts(entries.filter((entry) => entry.direction === "income" && SUPPORT_INCOME.has(entry.category)));
  const commercialCosts = sumAmounts(entries.filter((entry) => entry.direction === "expense" && COMMERCIAL_COSTS.has(entry.category)));
  const netCommunitySupport = roundMoney(Math.max(0, supportIncome - commercialCosts));
  const availableCommunityFunds = roundMoney(netCommunitySupport + (useOpeningReserve ? openingReserve : 0));
  const communityCovered = roundMoney(Math.min(operationalExpenses, availableCommunityFunds));
  const selfFunded = roundMoney(Math.max(0, operationalExpenses - availableCommunityFunds));
  const surplus = roundMoney(Math.max(0, netCommunitySupport - operationalExpenses));
  const reserveUsed = useOpeningReserve
    ? roundMoney(Math.min(openingReserve, Math.max(0, operationalExpenses - netCommunitySupport)))
    : 0;
  const closingReserve = useOpeningReserve
    ? roundMoney(Math.max(0, openingReserve + netCommunitySupport - operationalExpenses))
    : roundMoney(openingReserve + surplus);
  const coveragePercent = operationalExpenses > 0 ? Math.min(100, Math.round((communityCovered / operationalExpenses) * 100)) : 0;
  const totalIncome = sumAmounts(entries.filter((entry) => entry.direction === "income"));
  const totalExpenses = roundMoney(sumAmounts(entries.filter((entry) => entry.direction === "expense")) + recurringTotal + creditPurchaseTotalEur);

  return {
    entries,
    recurring,
    creditPurchases,
    raceCosts,
    creditPurchaseTotalEur,
    creditPurchasedTotalUsd,
    raceCreditCostTotalUsd,
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
    openingReserve: roundMoney(openingReserve),
    reserveUsed,
    closingReserve,
    reserve: closingReserve,
  };
};

export const supportMetrics = (state: CommunitySupportState, selectedMonth: string) => calculateMetrics(
  state,
  state.ledger.filter((entry) => entryMonth(entry.date) === selectedMonth),
  recurringCostsForMonth(state.recurringCosts, selectedMonth),
  creditPurchasesForMonth(state, selectedMonth),
  raceCostsForMonth(state, selectedMonth),
);

const yearPeriod = (state: CommunitySupportState, selectedYear: string) => ({
  entries: state.ledger.filter((entry) => entryYear(entry.date) === selectedYear),
  recurring: recurringCostOccurrencesForYear(state.recurringCosts, selectedYear),
  creditPurchases: creditPurchasesForYear(state, selectedYear),
  raceCosts: raceCostsForYear(state, selectedYear),
});

const reserveStartYear = (state: CommunitySupportState, selectedYear: string) => {
  if (state.settings.reserveStartYear && /^\d{4}$/.test(state.settings.reserveStartYear)) return state.settings.reserveStartYear;
  const activityYears = [
    ...state.ledger.map((entry) => entryYear(entry.date)),
    ...state.recurringCosts.map((cost) => entryYear(cost.startsOn)),
    ...(state.creditPurchases ?? []).map((purchase) => entryYear(purchase.date)),
    ...supportedRaceCosts(state).map((cost) => entryYear(cost.date)),
  ].filter((year) => /^\d{4}$/.test(year));
  return activityYears.sort()[0] ?? selectedYear;
};

export const supportMetricsForYear = (state: CommunitySupportState, selectedYear: string) => {
  const selected = Number(selectedYear);
  const startYear = Number(reserveStartYear(state, selectedYear));
  let openingReserve = selected >= startYear ? roundMoney(state.settings.reserve) : 0;

  for (let year = startYear; year < selected; year += 1) {
    const period = yearPeriod(state, String(year));
    openingReserve = calculateMetrics(state, period.entries, period.recurring, period.creditPurchases, period.raceCosts, openingReserve, true).closingReserve;
  }

  const period = yearPeriod(state, selectedYear);
  return calculateMetrics(state, period.entries, period.recurring, period.creditPurchases, period.raceCosts, openingReserve, true);
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

const publicRecurringEntriesForMonth = (state: CommunitySupportState, selectedMonth: string): PublicSupportLedgerEntry[] => recurringCostsForMonth(state.recurringCosts, selectedMonth)
  .filter((cost) => cost.isPublic)
  .map((cost) => ({
    id: `recurring-${selectedMonth}-${cost.id}`,
    date: `${selectedMonth}-01`,
    direction: "expense",
    category: cost.category,
    description: cost.description,
    amount: cost.amount,
    isPublic: true,
  }));

const toPublicCreditPurchase = (purchase: SupportCreditPurchase): PublicSupportCreditPurchase => ({
  date: purchase.date,
  description: purchase.description,
  creditsUsd: purchase.creditsUsd,
  amountEur: purchase.amountEur,
  isPublic: true,
});

export const publicCreditPurchasesForMonth = (state: CommunitySupportState, selectedMonth: string): PublicSupportCreditPurchase[] => creditPurchasesForMonth(state, selectedMonth)
  .filter((purchase) => purchase.isPublic)
  .map(toPublicCreditPurchase)
  .sort((a, b) => b.date.localeCompare(a.date));

export const publicCreditPurchasesForYear = (state: CommunitySupportState, selectedYear: string): PublicSupportCreditPurchase[] => creditPurchasesForYear(state, selectedYear)
  .filter((purchase) => purchase.isPublic)
  .map(toPublicCreditPurchase)
  .sort((a, b) => b.date.localeCompare(a.date));

const toPublicRaceCost = (cost: SupportRaceCost): PublicSupportRaceCost => ({
  raceScope: cost.raceScope,
  ...(cost.leagueName ? { leagueName: cost.leagueName } : {}),
  ...(cost.season ? { season: cost.season } : {}),
  raceName: cost.raceName,
  track: cost.track,
  date: cost.date,
  hostedHours: cost.hostedHours,
  discountApplied: cost.discountApplied,
  creditCostUsd: cost.creditCostUsd,
  isPublic: true,
});

export const publicRaceCostsForMonth = (state: CommunitySupportState, selectedMonth: string): PublicSupportRaceCost[] => raceCostsForMonth(state, selectedMonth)
  .filter((cost) => cost.isPublic)
  .map(toPublicRaceCost)
  .sort((a, b) => b.date.localeCompare(a.date));

export const publicRaceCostsForYear = (state: CommunitySupportState, selectedYear: string): PublicSupportRaceCost[] => raceCostsForYear(state, selectedYear)
  .filter((cost) => cost.isPublic)
  .map(toPublicRaceCost)
  .sort((a, b) => b.date.localeCompare(a.date));

const creditPurchaseLedgerEntries = (purchases: PublicSupportCreditPurchase[]): PublicSupportLedgerEntry[] => purchases.map((purchase, index) => ({
  id: `credit-purchase-${purchase.date}-${index}`,
  date: purchase.date,
  direction: "expense",
  category: "race_hosting",
  description: purchase.description,
  amount: purchase.amountEur,
  sourceAmount: purchase.creditsUsd,
  sourceCurrency: "USD",
  isPublic: true,
}));

export const publicLedgerForMonth = (state: CommunitySupportState, selectedMonth: string): PublicSupportLedgerEntry[] => {
  const manual = state.ledger
    .filter((entry) => entry.isPublic && entryMonth(entry.date) === selectedMonth)
    .map(redactPublicEntry);
  return [
    ...manual,
    ...publicRecurringEntriesForMonth(state, selectedMonth),
    ...creditPurchaseLedgerEntries(publicCreditPurchasesForMonth(state, selectedMonth)),
  ].sort((a, b) => b.date.localeCompare(a.date));
};

export const publicLedgerForYear = (state: CommunitySupportState, selectedYear: string): PublicSupportLedgerEntry[] => {
  const manual = state.ledger
    .filter((entry) => entry.isPublic && entryYear(entry.date) === selectedYear)
    .map(redactPublicEntry);
  const recurring = monthsForYear(selectedYear).flatMap((month) => publicRecurringEntriesForMonth(state, month));
  return [
    ...manual,
    ...recurring,
    ...creditPurchaseLedgerEntries(publicCreditPurchasesForYear(state, selectedYear)),
  ].sort((a, b) => b.date.localeCompare(a.date));
};
