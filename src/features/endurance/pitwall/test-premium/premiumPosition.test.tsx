import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {RaceTelemetryStrip} from '../RaceTelemetryStrip';

describe('premium positie zonder dubbele klassepositie',()=>{
 it('kan K test-only weglaten zonder P en ronde te verliezen',()=>{
  render(<RaceTelemetryStrip v3={{position:{position:16,classPosition:5},timing:{completedLaps:8}}} live showClassPosition={false}/>);
  expect(screen.queryByText('K',{exact:true})).toBeNull();
  expect(screen.queryByText('K5',{exact:true})).toBeNull();
  expect(screen.getByText('P16',{exact:true})).toBeTruthy();
  expect(screen.getByText('8',{exact:true})).toBeTruthy();
 });
 it('behoudt de bestaande klassieke/endurance-default',()=>{
  render(<RaceTelemetryStrip v3={{position:{position:16,classPosition:5}}} live/>);
  expect(screen.getByText('K',{exact:true})).toBeTruthy();
  expect(screen.getByText('K5',{exact:true})).toBeTruthy();
 });
});
