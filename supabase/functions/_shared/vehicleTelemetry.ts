/** Optional V3 extension. No device identity, authority, or strategy inputs. */
export type TyreReading = {
  wearPercent: number | null;
  temperature: number | null;
  pressure: number | null;
};
export type VehicleTelemetry = {
  speedKph: number | null;
  throttlePct: number | null;
  brakePct: number | null;
  rpm: number | null;
  gear: string | null;
  sector1Seconds: number | null;
  sector2Seconds: number | null;
  sector3Seconds: number | null;
  tyreDataMode: 'last_available';
  pressureUnit: 'psi' | 'kPa' | 'bar' | null;
  temperatureUnit: 'C' | 'F' | null;
  frontLeft: TyreReading | null;
  frontRight: TyreReading | null;
  rearLeft: TyreReading | null;
  rearRight: TyreReading | null;
};
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid vehicle object');
  return value as Record<string, unknown>;
};
const keys = (value: Record<string, unknown>, allowed: string[]) => {
  if (Object.keys(value).length !== allowed.length || Object.keys(value).some(key => !allowed.includes(key))) throw Error('invalid vehicle fields');
};
const num = (value: unknown, min: number, max: number): number | null => {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw Error('invalid vehicle number');
  return value;
};
const unit = <T extends string>(value: unknown, allowed: T[]): T | null => {
  if (value === null) return null;
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw Error('invalid vehicle unit');
  return value as T;
};
const tyre = (value: unknown): TyreReading | null => {
  if (value === null) return null;
  const r = record(value);
  keys(r, ['wearPercent','temperature','pressure']);
  return { wearPercent: num(r.wearPercent,0,100), temperature: num(r.temperature,-100,1000), pressure: num(r.pressure,0,2000) };
};
export const parseVehicleTelemetry = (value: unknown): VehicleTelemetry | null => {
  if (value === undefined || value === null) return null;
  const r = record(value);
  keys(r, ['speedKph','throttlePct','brakePct','rpm','gear','sector1Seconds','sector2Seconds','sector3Seconds','tyreDataMode','pressureUnit','temperatureUnit','frontLeft','frontRight','rearLeft','rearRight']);
  if (r.tyreDataMode !== 'last_available') throw Error('invalid tyre freshness claim');
  if (r.gear !== null && (typeof r.gear !== 'string' || !/^(R|N|[0-9]{1,2})$/.test(r.gear))) throw Error('invalid gear');
  return {
    speedKph:num(r.speedKph,0,600), throttlePct:num(r.throttlePct,0,100), brakePct:num(r.brakePct,0,100), rpm:num(r.rpm,0,30000), gear:r.gear as string|null,
    sector1Seconds:num(r.sector1Seconds,0.001,86400), sector2Seconds:num(r.sector2Seconds,0.001,86400), sector3Seconds:num(r.sector3Seconds,0.001,86400),
    tyreDataMode:'last_available', pressureUnit:unit(r.pressureUnit,['psi','kPa','bar']), temperatureUnit:unit(r.temperatureUnit,['C','F']),
    frontLeft:tyre(r.frontLeft), frontRight:tyre(r.frontRight), rearLeft:tyre(r.rearLeft), rearRight:tyre(r.rearRight),
  };
};
