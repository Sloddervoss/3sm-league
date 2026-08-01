export const RACE_HOSTING_HOURLY_CREDIT_RATE_USD = 0.5;
export const RACE_HOSTING_DISCOUNT_RATE = 0.25;
export const DEFAULT_RACE_HOSTING_HOURS = 1;

export const normalizeHostedHours = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.min(24, Math.max(1, Math.round(value)));
};

export const calculateRaceHostingCreditCostUsd = (hostedHours: number, discountApplied: boolean) => {
  const normalizedHours = normalizeHostedHours(hostedHours);
  if (normalizedHours === null) return 0;
  const multiplier = discountApplied ? 1 - RACE_HOSTING_DISCOUNT_RATE : 1;
  return Math.round((normalizedHours * RACE_HOSTING_HOURLY_CREDIT_RATE_USD * multiplier + Number.EPSILON) * 100) / 100;
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
