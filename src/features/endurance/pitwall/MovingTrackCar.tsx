import { useEffect, useRef } from 'react';
import type { V3Opponent } from './pitwallHelpers';
import { lapMotion, pointOnTrack, wrapLap } from './trackMotion';

export function MovingTrackCar({ car, points, capturedAt }: {
  car: V3Opponent; points: { x: number; y: number }[]; capturedAt?: string;
}) {
  const node = useRef<SVGGElement>(null);
  const displayed = useRef(car.lapDistancePct!);
  const previousTime = useRef<number | null>(null);
  const pct = car.lapDistancePct!;
  const inPit = car.inPit;
  const previousPit = useRef(inPit);
  useEffect(() => {
    const sampleTime = capturedAt ? Date.parse(capturedAt) : NaN;
    const elapsed = previousTime.current == null ? 0 : sampleTime - previousTime.current;
    const motion = lapMotion(displayed.current, pct, elapsed);
    const duration = previousPit.current !== inPit || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : motion.duration;
    previousPit.current = inPit;
    previousTime.current = sampleTime;
    const from = displayed.current;
    const start = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      const progress = duration ? Math.min(1, Math.max(0, (now - start) / duration)) : 1;
      displayed.current = progress === 1 ? pct : wrapLap(from + motion.delta * progress);
      const point = pointOnTrack(points, displayed.current);
      node.current?.setAttribute('transform', `translate(${point.x} ${point.y})`);
      if (progress < 1) frame = requestAnimationFrame(draw);
    };
    draw(start);
    return () => cancelAnimationFrame(frame);
  }, [pct, capturedAt, points, inPit]);
  return <g ref={node}><title>{car.driverName ?? car.carNumber ?? car.id}{car.inPit ? ' · PIT (baanprojectie)' : ''}</title><circle r={car.isPlayer ? 32 : 25} fill={car.isPlayer ? '#fb923c' : car.inPit ? '#fbbf24' : '#38bdf8'} stroke="#101418" strokeWidth="7" /><text textAnchor="middle" dominantBaseline="central" fill="#07111a" fontSize="23" fontWeight="900">{car.carNumber ?? '·'}</text></g>;
}
