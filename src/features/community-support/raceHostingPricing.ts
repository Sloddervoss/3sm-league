export const RACE_HOSTING_HOURLY_RATE_USD = 0.5;
export const RACE_HOSTING_DISCOUNT_RATE = 0.25;
export const RACE_HOSTING_VAT_RATE = 0.21;
export const DEFAULT_RACE_HOSTING_HOURS = 1;
export const DEFAULT_USD_EUR_RATE = 0.92;

const RATE_SCALE = 10_000;
const CENTS_PER_UNIT = 100;

// All race-hosting inputs are non-negative. This matches PostgreSQL NUMERIC
// round(..., 2): exact decimal arithmetic with half-cent values rounded up.
const roundPositiveRatio = (numerator: number, denominator: number) => Math.floor((numerator + denominator / 2) / denominator);

export const normalizeHostedHours = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.min(24, Math.max(1, Math.round(value)));
};

export const normalizeUsdEurRate = (value: number) => {
  if (!Number.isFinite(value) || value <= 0 || value > 10) return null;
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
};

export const calculateRaceHostingAmountUsd = (hostedHours: number, discountApplied: boolean) => {
  const normalizedHours = normalizeHostedHours(hostedHours);
  if (normalizedHours === null) return 0;
  const hourlyRateCents = Math.round(RACE_HOSTING_HOURLY_RATE_USD * CENTS_PER_UNIT);
  const multiplierScaled = Math.round((discountApplied ? 1 - RACE_HOSTING_DISCOUNT_RATE : 1) * RATE_SCALE);
  return roundPositiveRatio(normalizedHours * hourlyRateCents * multiplierScaled, RATE_SCALE) / CENTS_PER_UNIT;
};

export const convertUsdToEur = (amountUsd: number, usdEurRate: number) => {
  const rate = normalizeUsdEurRate(usdEurRate);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0 || rate === null) return 0;
  const amountUsdCents = Math.round(amountUsd * CENTS_PER_UNIT);
  const rateScaled = Math.round(rate * RATE_SCALE);
  return roundPositiveRatio(amountUsdCents * rateScaled, RATE_SCALE) / CENTS_PER_UNIT;
};

export const calculateRaceHostingEurBreakdown = (amountUsd: number, usdEurRate: number, vatRate = RACE_HOSTING_VAT_RATE) => {
  const normalizedVatRate = Number.isFinite(vatRate) && vatRate >= 0 && vatRate <= 1
    ? Math.round(vatRate * RATE_SCALE) / RATE_SCALE
    : RACE_HOSTING_VAT_RATE;
  const netAmount = convertUsdToEur(amountUsd, usdEurRate);
  const netAmountCents = Math.round(netAmount * CENTS_PER_UNIT);
  const vatRateScaled = Math.round(normalizedVatRate * RATE_SCALE);
  const vatAmountCents = roundPositiveRatio(netAmountCents * vatRateScaled, RATE_SCALE);
  const vatAmount = vatAmountCents / CENTS_PER_UNIT;
  return {
    vatRate: normalizedVatRate,
    netAmount,
    vatAmount,
    amount: (netAmountCents + vatAmountCents) / CENTS_PER_UNIT,
  };
};

export const configuredRaceHours = (duration?: string | null) => {
  if (!duration?.trim()) return null;
  const value = duration.trim().toLowerCase();
  const hoursMatch = value.match(/(\d+(?:[.,]\d+)?)\s*(?:h|hour|hours|uur)/);
  if (hoursMatch) return normalizeHostedHours(Number(hoursMatch[1].replace(",", ".")));
  const minutesMatch = value.match(/(\d+)\s*(?:m|min|mins|minute|minutes|minuten)/);
  if (minutesMatch) return normalizeHostedHours(Math.ceil(Number(minutesMatch[1]) / 60));
  const numeric = Number(value.replace(",", "."));
  if (Number.isFinite(numeric)) return normalizeHostedHours(numeric > 10 ? Math.ceil(numeric / 60) : numeric);
  return null;
};
