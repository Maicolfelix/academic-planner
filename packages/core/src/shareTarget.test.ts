import { describe, expect, it } from 'vitest';
import { CAPTURE_MAX_LENGTH } from './captureProposals.js';
import { SHARE_LIMITS, composeSharedText, safeHttpUrl, safeReturnTo } from './shareTarget.js';

describe('composeSharedText', () => {
  it('title + text + url, one per line', () => {
    expect(
      composeSharedText({ title: 'Tarea 3', text: 'Entrega mañana', url: 'https://x.edu/t/3' }),
    ).toEqual({ text: 'Tarea 3\nEntrega mañana\nhttps://x.edu/t/3', notices: [] });
  });

  it('does not repeat a title that equals (or is inside) the text', () => {
    expect(composeSharedText({ title: 'Parcial', text: 'Parcial' }).text).toBe('Parcial');
    expect(composeSharedText({ title: 'parcial', text: 'Parcial de redes el viernes' }).text).toBe(
      'Parcial de redes el viernes',
    );
  });

  it('only text, only url, and nothing', () => {
    expect(composeSharedText({ text: 'Quiz el lunes' }).text).toBe('Quiz el lunes');
    expect(composeSharedText({ url: 'http://a.co/x' }).text).toBe('http://a.co/x');
    expect(composeSharedText({})).toEqual({ text: '', notices: ['EMPTY'] });
    expect(composeSharedText({ title: '  ', text: '\n', url: ' ' }).notices).toEqual(['EMPTY']);
  });

  it('does not add a link the text already carries (Android puts it in the text)', () => {
    const r = composeSharedText({ text: 'Mira https://x.co/a', url: 'https://x.co/a' });
    expect(r.text).toBe('Mira https://x.co/a');
  });

  it('only http and https links travel; the rest is dropped and reported', () => {
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,<b>x',
      'intent://x#Intent;end',
      'ftp://x',
      'not a url',
      '//evil.com',
    ]) {
      const r = composeSharedText({ text: 'Tarea', url: bad });
      expect(r.text).toBe('Tarea');
      expect(r.notices).toContain('URL_DROPPED');
    }
    expect(safeHttpUrl('https://x.co/a?b=1')).toBe('https://x.co/a?b=1');
    expect(safeHttpUrl('JAVASCRIPT:alert(1)')).toBeNull();
  });

  it('a huge payload is cut at explicit limits and reported (never silently)', () => {
    const r = composeSharedText({
      title: 'T'.repeat(5000),
      text: 'x'.repeat(100_000),
      url: 'https://a.co/' + 'p'.repeat(5000),
    });
    expect(r.text.length).toBeLessThanOrEqual(CAPTURE_MAX_LENGTH.QUICK);
    expect(r.notices).toContain('TRUNCATED');
    expect(r.text).not.toContain('https://a.co/p');
    expect(SHARE_LIMITS).toEqual({ title: 200, text: 5000, url: 2048 });
  });

  it('keeps accents, ñ, emoji and line breaks intact; strips control characters', () => {
    const text = 'Parcial de Bioquímica 🧪\nmañana a las 8';
    expect(composeSharedText({ text }).text).toBe(text);
    expect(composeSharedText({ text: 'a\r\nb\u0000c\u001b' }).text).toBe('a\nbc');
  });
});

describe('safeReturnTo', () => {
  it('accepts internal paths of the app', () => {
    for (const ok of ['/', '/dashboard', '/activities?status=PENDING', '/calendar#x'])
      expect(safeReturnTo(ok)).toBe(ok);
  });

  it('rejects every way out of the origin', () => {
    for (const bad of [
      'https://evil.com',
      'http://evil.com/a',
      '//evil.com',
      '///evil.com',
      '/\\evil.com',
      '\\\\evil.com',
      'javascript:alert(1)',
      'data:text/html,x',
      'dashboard',
      '',
      '/a\nb',
      '/%5Cevil.com',
      '/%2f%2fevil.com',
      null,
      undefined,
      42,
    ])
      expect(safeReturnTo(bad), String(bad)).toBeNull();
  });
});
