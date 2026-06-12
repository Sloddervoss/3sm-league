const SENSITIVE_ENV_NAME_PATTERN = /(TOKEN|KEY|SECRET|PASSWORD|PASS|PRIVATE|CREDENTIAL)/i;
const MIN_SECRET_LENGTH = 8;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function redactSensitiveText(input) {
  let output = String(input ?? '');

  for (const [name, rawValue] of Object.entries(process.env)) {
    if (!SENSITIVE_ENV_NAME_PATTERN.test(name)) continue;

    const value = rawValue?.trim();
    if (!value || value.length < MIN_SECRET_LENGTH) continue;

    output = output.replace(new RegExp(escapeRegExp(value), 'g'), `[REDACTED:${name}]`);
  }

  return output;
}

export function formatLogArg(value) {
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return String(value);

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }

  return String(value);
}

export function describeError(error) {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;

  const parts = [];
  if (error.name) parts.push(error.name);
  if (error.message) parts.push(error.message);
  if (error.code) parts.push(`code: ${error.code}`);
  if (error.status) parts.push(`status: ${error.status}`);
  if (error.statusText) parts.push(`statusText: ${error.statusText}`);
  if (error.details) parts.push(`details: ${error.details}`);
  if (error.hint) parts.push(`hint: ${error.hint}`);

  const cause = error.cause;
  if (cause) {
    const causeParts = [];
    if (cause.code) causeParts.push(cause.code);
    if (cause.errno && cause.errno !== cause.code) causeParts.push(cause.errno);
    if (cause.syscall) causeParts.push(cause.syscall);
    if (cause.hostname) causeParts.push(cause.hostname);
    if (cause.message) causeParts.push(cause.message);
    if (causeParts.length) parts.push(`cause: ${causeParts.join(' ')}`);
  }

  let message = parts.length ? parts.join(' | ') : formatLogArg(error);
  if (message === '{}' || message === '[object Object]' || message === '{"message":""}') {
    message = 'Supabase/PostgREST empty error response (likely upstream 5xx/empty response)';
  }
  return redactSensitiveText(message);
}
