import { describe, expect, it } from 'vitest';
import { loginSchema, registerSchema } from './auth.js';

const valid = { name: 'Ana Pérez', email: 'ana@example.com', password: 'longenough' };

describe('registerSchema', () => {
  it('accepts valid input and normalises email and name', () => {
    const out = registerSchema.parse({ ...valid, name: '  Ana  ', email: '  ANA@Example.COM ' });
    expect(out).toMatchObject({ name: 'Ana', email: 'ana@example.com' });
  });

  it.each([
    ['invalid email', { email: 'not-an-email' }, 'email'],
    ['empty email', { email: '   ' }, 'email'],
    ['short password', { password: '1234567' }, 'password'],
    ['empty name', { name: '   ' }, 'name'],
    ['name too long', { name: 'x'.repeat(81) }, 'name'],
    ['password too long', { password: 'x'.repeat(129) }, 'password'],
  ])('rejects %s', (_label, patch, field) => {
    const res = registerSchema.safeParse({ ...valid, ...patch });
    expect(res.success).toBe(false);
    expect(res.error?.issues.some((i) => i.path[0] === field)).toBe(true);
  });

  it('accepts a password of exactly 8 characters and does not trim it', () => {
    expect(registerSchema.parse({ ...valid, password: '  abcdef ' }).password).toBe('  abcdef ');
    expect(registerSchema.safeParse({ ...valid, password: '12345678' }).success).toBe(true);
  });
});

describe('loginSchema', () => {
  it('lowercases the email and does not apply the registration length policy', () => {
    expect(loginSchema.parse({ email: 'A@B.CO', password: 'x' })).toEqual({
      email: 'a@b.co',
      password: 'x',
    });
  });

  it('rejects an empty password', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });
});
