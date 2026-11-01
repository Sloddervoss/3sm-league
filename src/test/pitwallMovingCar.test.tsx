import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MovingTrackCar } from '@/features/endurance/pitwall/MovingTrackCar';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('moves between samples, does not run past the latest measurement and cancels on unmount', () => {
  let now = 0;
  let nextId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++nextId, cb); return nextId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const points = [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];
  const draw = (pct:number, second:number) => <svg><MovingTrackCar car={{id:'a',lapDistancePct:pct}} points={points} capturedAt={`2026-09-06T20:00:0${second}Z`} /></svg>;
  const view = render(draw(0,0));
  view.rerender(draw(.1,1));
  const tick = (time:number) => act(() => {
    now = time;
    const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(cb => cb(now));
  });
  tick(500);
  const x = () => Number(view.container.querySelector('g')!.getAttribute('transform')!.match(/translate\(([^ ]+)/)![1]);
  expect(x()).toBeCloseTo(2);
  tick(1000);
  expect(x()).toBeCloseTo(4);
  expect(frames.size).toBe(0);
  tick(2000);
  expect(x()).toBeCloseTo(4);
  view.rerender(draw(.12,2));
  expect(frames.size).toBe(1);
  view.unmount();
  expect(frames.size).toBe(0);
});
