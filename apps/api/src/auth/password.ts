import argon2 from 'argon2';

// Argon2id with explicit parameters (above the OWASP minimum) so a library default change
// can never silently weaken stored hashes.
const OPTIONS = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 } as const;

export const hashPassword = (password: string): Promise<string> => argon2.hash(password, OPTIONS);

/** Never throws on a malformed hash: that is just "not a match". */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/** Burns the same CPU as a real check, so unknown emails cannot be told apart by response time. */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  await verifyPassword(await dummyHash, password);
}
