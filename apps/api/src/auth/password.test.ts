import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password hashing (Argon2id)', () => {
  it('produces an argon2id hash that never contains the password and verifies', async () => {
    const hash = await hashPassword('s3cret-pass-phrase');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('s3cret');
    expect(await verifyPassword(hash, 's3cret-pass-phrase')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });

  it('salts: the same password hashes differently each time', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('treats a malformed hash as a non-match instead of throwing', async () => {
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
});
