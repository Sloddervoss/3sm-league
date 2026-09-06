import type { SimHubDeviceDetail } from '@/features/control-room/connectors/types';

export function newestDeviceTelemetry(current: SimHubDeviceDetail | undefined, incoming: SimHubDeviceDetail['telemetry'], deviceId: string) {
  if (!current || current.device.id !== deviceId || !incoming || incoming.device_id !== deviceId) return current;
  const nextTime = Date.parse(incoming.received_at);
  const currentTime = Date.parse(current.telemetry?.received_at ?? '');
  if (!Number.isFinite(nextTime) || (Number.isFinite(currentTime) && nextTime <= currentTime)) return current;
  return { ...current, telemetry: incoming };
}
