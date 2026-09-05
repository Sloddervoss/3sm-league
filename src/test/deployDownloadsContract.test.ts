import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('website deployment release-artifact boundary', () => {
  it('excludes both release-managed downloads and old hashed assets from deletion', () => {
    const script = readFileSync('deploy.sh', 'utf8');
    const publish = script.split('\n').find(line => line.startsWith('rsync ') && line.includes('--delete-after'));
    expect(publish).toContain("--exclude='assets/'");
    expect(publish).toContain("--exclude='downloads/'");
  });
});
