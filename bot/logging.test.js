import test from 'node:test';
import assert from 'node:assert/strict';
import { describeError, formatLogArg } from './logging.js';

test('formatLogArg serializes plain objects as JSON for actionable bot logs', () => {
  assert.equal(formatLogArg({ code: 'PGRST123', message: 'broken' }), '{"code":"PGRST123","message":"broken"}');
});

test('describeError includes Supabase/PostgREST details', () => {
  assert.equal(
    describeError({ message: 'bad request', code: 'PGRST123', details: 'column missing', hint: 'check select' }),
    'bad request | code: PGRST123 | details: column missing | hint: check select'
  );
});

test('describeError makes empty Supabase errors recognizable as transient upstream responses', () => {
  assert.equal(
    describeError({ message: '' }),
    'Supabase/PostgREST empty error response (likely upstream 5xx/empty response)'
  );
});
