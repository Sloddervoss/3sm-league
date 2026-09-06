import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { parseVehicleTelemetry, type VehicleTelemetry } from '../../supabase/functions/_shared/vehicleTelemetry';
import { VehicleTelemetryPanel } from '../features/endurance/pitwall/VehicleTelemetryPanel';
import { parseTelemetryV3Envelope } from '../../supabase/functions/_shared/simhub';
afterEach(cleanup);
const vehicle: VehicleTelemetry = { speedKph:210,throttlePct:70,brakePct:0,rpm:7000,gear:'4',sector1Seconds:20,sector2Seconds:30,sector3Seconds:25,tyreDataMode:'last_available',pressureUnit:'psi',temperatureUnit:'C',frontLeft:{wearPercent:93,temperature:83,pressure:26},frontRight:null,rearLeft:null,rearRight:null };
const envelope = () => ({protocolVersion:3,sequence:1,capturedAt:'2026-09-05T12:00:00Z',transportSessionId:'test-session',identity:{currentDriverId:null,currentDriverName:null,carId:null,carName:null,trackName:'Road Atlanta',trackConfig:'Full Course'},session:{isInCar:true,sessionTimeSeconds:10,sessionTimeRemainingSeconds:100,sessionLapsRemaining:null,flags:null,sessionState:'racing'},timing:{currentLapElapsedSeconds:10,lastLapTimeSeconds:null,bestLapTimeSeconds:null,completedLaps:0},position:{position:null,classPosition:null,gapToLeaderSeconds:null},track:{lapDistancePct:0,trackSurface:'on_track',onPitRoad:false},fuel:{fuelLitres:50,fuelPct:null},raceState:{incidents:0},pitService:{pitServiceFlagsRaw:null,requiredRepairSeconds:null,optionalRepairSeconds:null}});
describe('optional Pitwall vehicle telemetry', () => {
  it('accepts optional official track IDs without breaking legacy payloads', () => {
    const old = envelope();
    expect(parseTelemetryV3Envelope(old).identity.trackId).toBeNull();
    expect(parseTelemetryV3Envelope({...old, identity:{...old.identity, trackId:345}}).identity.trackId).toBe(345);
    for (const trackId of [0,-1,1.5,'345',NaN,Infinity,2147483648]) {
      expect(() => parseTelemetryV3Envelope({...old, identity:{...old.identity,trackId}})).toThrow();
    }
  });
  it('keeps older plugin payloads compatible', () => { expect(parseVehicleTelemetry(undefined)).toBeNull(); expect(parseVehicleTelemetry(null)).toBeNull(); });
  it('accepts old and extended V3 envelopes through the actual ingest parser', () => { expect(parseTelemetryV3Envelope(envelope()).vehicle).toBeNull(); expect(parseTelemetryV3Envelope({...envelope(),vehicle}).vehicle).toEqual(vehicle); });
  it('does not let optional telemetry change server-owned identity', () => { const parsed=parseTelemetryV3Envelope({...envelope(),vehicle}); expect(parsed.deviceId).toBeNull(); expect(parsed.authority).toBeNull(); expect(() => parseTelemetryV3Envelope({...envelope(),vehicle,eventId:'injected'})).toThrow(); });
  it('preserves real zero pedal values and unknown corners', () => { expect(parseVehicleTelemetry(vehicle)).toEqual(vehicle); });
  it.each([NaN,Infinity,-1,101,'50'])('rejects malformed throttle %s', value => { expect(() => parseVehicleTelemetry({...vehicle,throttlePct:value})).toThrow(); });
  it('rejects server identity injection and unjustified live tyre claims', () => { expect(() => parseVehicleTelemetry({...vehicle,deviceId:'x'})).toThrow(); expect(() => parseVehicleTelemetry({...vehicle,tyreDataMode:'live'})).toThrow(); });
  it('shows real tyre values with their source units and freshness caveat', () => { render(<VehicleTelemetryPanel v3={{vehicle}} live />); expect(screen.getByText('93%')).toBeTruthy(); expect(screen.getByText('83.0 °C')).toBeTruthy(); expect(screen.getByText('Laatst beschikbare bandenmeting')).toBeTruthy(); });
  it('does not present stale tyre or pedal values as live', () => { render(<VehicleTelemetryPanel v3={{vehicle}} live={false} />); expect(screen.queryByText('93%')).toBeNull(); expect(screen.getByText('Telemetrie offline')).toBeTruthy(); });
  it('hides own-car readings outside the car even if the relay is connected', () => { render(<VehicleTelemetryPanel v3={{vehicle,session:{isInCar:false}}} live />); expect(screen.queryByText('93%')).toBeNull(); expect(screen.getByText('Niet in de auto')).toBeTruthy(); });
});
