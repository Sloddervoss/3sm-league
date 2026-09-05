export type PedalSample = { at: number; throttle: number | null; brake: number | null };
const valid = (n: number | null | undefined) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
export function appendPedalSample(samples: PedalSample[], at: number, throttle?: number | null, brake?: number | null): PedalSample[] {
  if (!Number.isFinite(at) || (samples.length && at <= samples[samples.length-1].at)) return samples;
  return [...samples.filter(sample => sample.at >= at-30000), {at,throttle:valid(throttle),brake:valid(brake)}].slice(-60);
}
export function pedalPath(samples: PedalSample[], field: 'throttle'|'brake'): string {
  const end=samples[samples.length-1]?.at;
  if (end == null) return '';
  let previous: PedalSample | null=null;
  return samples.map(sample=>{
    const value=sample[field];
    if(value == null){previous=null;return ''}
    const command=previous && sample.at-previous.at <= 6000 ? 'L' : 'M';
    previous=sample;
    return `${command}${(300-(end-sample.at)/100).toFixed(1)},${(80-value*.7).toFixed(1)}`;
  }).join(' ');
}
