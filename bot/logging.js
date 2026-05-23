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
