import { describe, expect, it, vi } from 'vitest';
import { resolveTelemetryContext } from '../../supabase/functions/simhub-ingest-v3/context';

vi.mock('../../supabase/functions/_shared/simhub.ts', () => ({
  parseTelemetryV3Envelope: (body: { valid?: boolean }) => {
    if (body.valid === false) throw new Error('invalid payload');
    return { protocolVersion: 3, sequence: 1 };
  },
  normalizeTelemetryEnvelope: () => ({ protocolVersion: 2 }),
}));

const device = {
  id: 'device', owner_user_id: 'owner', connector_id: 'connector', device_name: 'test',
  endurance_event_id: null, endurance_team_id: null, device_status: 'inactive',
  device_role: null, revoked_at: null,
};
async function resolve(overrides: Record<string, unknown> | null, body = { protocolVersion: 3, valid: true }) {
  const rpc = vi.fn().mockResolvedValue({ data: 'run', error: null });
  const db = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: overrides === null ? null : { ...device, ...overrides }, error: null }) }) }) }), rpc };
  const result = await resolveTelemetryContext('test-token', body, db, async () => 'hash');
  return { result, rpc };
}

describe('device-scoped Edge context before persistence', () => {
  it.each([
    {},
    { endurance_event_id: 'event', endurance_team_id: 'team' },
    { endurance_event_id: 'event', endurance_team_id: 'team', device_status: 'active_binding', device_role: 'standby' },
    { endurance_event_id: 'event', device_status: 'active_binding', device_role: 'primary' },
  ])('accepts valid devices without granting team authority: %j', async overrides => {
    const { result, rpc } = await resolve(overrides);
    expect(result.result).toBe('accepted_device_context');
    expect(result.normalized).not.toBeNull();
    expect(result.deviceId).toBe('device');
    expect(result.eventId).toBeNull();
    expect(result.teamId).toBeNull();
    expect(result.raceRunId).toBeNull();
    expect(result.isAuthority).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('preserves active primary routing', async () => {
    const { result } = await resolve({ endurance_event_id: 'event', endurance_team_id: 'team', device_status: 'active_binding', device_role: 'primary' });
    expect(result.result).toBe('accepted_context');
    expect(result.teamId).toBe('team');
    expect(result.isAuthority).toBe(true);
  });
  it('still rejects invalid tokens, revoked devices and invalid payloads', async () => {
    expect((await resolve(null)).result.result).toBe('invalid_device');
    expect((await resolve({ revoked_at: '2026-09-06' })).result.result).toBe('revoked');
    expect((await resolve({}, { protocolVersion: 3, valid: false })).result.result).toBe('invalid_payload');
    expect((await resolve({}, { protocolVersion: 99, valid: true })).result.result).toBe('unsupported_version');
  });
});
