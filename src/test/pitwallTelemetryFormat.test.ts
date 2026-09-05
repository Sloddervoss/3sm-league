import {it,expect} from 'vitest';
import {preciseLapTime} from '../features/endurance/pitwall/telemetryFormat';
it('formats lap milliseconds with carry and never renders invalid values',()=>{
 expect(preciseLapTime(69.929)).toBe('1:09.929');
 expect(preciseLapTime(59.9999)).toBe('1:00.000');
 for(const input of [null,undefined,NaN,Infinity,0,-1])expect(preciseLapTime(input)).toBe('—');
});
