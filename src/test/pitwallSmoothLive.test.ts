import { describe, expect, it } from 'vitest';
import { lapMotion, pointOnTrack, wrapLap } from '@/features/endurance/pitwall/trackMotion';
import { newestDeviceTelemetry } from '@/features/endurance/pitwall/deviceTelemetryCache';
import type { SimHubDeviceDetail } from '@/features/control-room/connectors/types';

describe('measurement-based track animation', () => {
  it('crosses start/finish forward without traversing the lap backwards', () => {
    const motion = lapMotion(.99, .01, 1000);
    expect(motion.delta).toBeCloseTo(.02);
    expect(wrapLap(.99 + motion.delta / 2)).toBeCloseTo(0);
    expect(motion.duration).toBe(1000);
  });
  it('snaps on reset, reconnect, missing timestamp or duplicate sample', () => {
    for (const elapsed of [0, -100, 4000, NaN]) expect(lapMotion(.1, .12, elapsed).duration).toBe(0);
    expect(lapMotion(.1, .5, 1000).duration).toBe(0);
    expect(lapMotion(.01, .99, 1000).delta).toBeCloseTo(-.02);
  });
  it('interpolates between adjacent geometry samples instead of stepping between them', () => {
    const points = [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];
    expect(pointOnTrack(points,.125)).toEqual({x:5,y:0});
    expect(pointOnTrack(points,1)).toEqual({x:0,y:0});
    expect(pointOnTrack(points,.875)).toEqual({x:0,y:5});
  });
});

describe('device Realtime cache ordering', () => {
  const row = (time: string, device_id = 'a') => ({ device_id, received_at:time }) as SimHubDeviceDetail['telemetry'];
  const current = { device:{id:'a'}, telemetry:row('2026-09-06T20:00:02Z') } as SimHubDeviceDetail;
  it('updates only the authorized loaded device with newer telemetry', () => {
    const newer = row('2026-09-06T20:00:03Z');
    expect(newestDeviceTelemetry(current,newer,'a')?.telemetry).toBe(newer);
    expect(newestDeviceTelemetry(undefined,newer,'a')).toBeUndefined();
    expect(newestDeviceTelemetry(current,row('2026-09-06T20:00:04Z','b'),'a')).toBe(current);
  });
  it('does not regress from a late RPC or duplicate realtime packet', () => {
    for (const time of ['2026-09-06T20:00:01Z','2026-09-06T20:00:02Z','invalid'])
      expect(newestDeviceTelemetry(current,row(time),'a')).toBe(current);
  });
});
