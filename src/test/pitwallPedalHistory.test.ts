import {describe,it,expect} from 'vitest';
import {appendPedalSample,pedalPath} from '../features/endurance/pitwall/pedalHistory';
describe('display-only pedal history',()=>{
  it('does not duplicate or reorder timestamps',()=>{const samples=appendPedalSample([],1000,0,50);expect(appendPedalSample(samples,1000,100,0)).toBe(samples);expect(appendPedalSample(samples,999,100,0)).toBe(samples)});
  it('bounds samples and time window',()=>{let samples=[] as ReturnType<typeof appendPedalSample>;for(let i=0;i<100;i++)samples=appendPedalSample(samples,i*1000,20,0);expect(samples.length).toBe(31);expect(samples[0].at).toBe(69000)});
  it('keeps zero but never invents unavailable pedal values',()=>{expect(appendPedalSample([],1000,0,NaN)[0]).toEqual({at:1000,throttle:0,brake:null})});
  it('breaks lines at time gaps and unavailable samples',()=>{const samples=[{at:0,throttle:10,brake:0},{at:1000,throttle:20,brake:null},{at:10000,throttle:80,brake:30}];expect(pedalPath(samples,'throttle').match(/M/g)).toHaveLength(2);expect(pedalPath(samples,'brake').match(/M/g)).toHaveLength(2)});
});
