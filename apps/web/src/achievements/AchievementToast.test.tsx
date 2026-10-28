import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AchievementCard, AchievementToast } from './AchievementToast';

describe('AchievementCard', () => {
  const out = renderToStaticMarkup(<AchievementCard label="¡Racha de 3!" title="Parcial 1" />);

  it('says what was unlocked in words, once, for a screen reader, and draws the rest as decoration', () => {
    expect(out).toContain('role="status"');
    expect(out).toContain('Logro desbloqueado: ¡Racha de 3!. Parcial 1');
    // the pictures (companion, trophy) are hidden from assistive technology and nothing here can be focused or tapped
    for (const svg of out.match(/<svg\b[^>]*>/g) ?? []) expect(svg).toContain('aria-hidden="true"');
    expect(out).not.toMatch(/<(a|button|input)\b/);
  });

  it('moves only with motion-safe, and the confetti is not drawn at all with reduced motion', () => {
    for (const c of [...out.matchAll(/[\w:[\]-]*animate-[\w-]+/g)].map((m) => m[0])) {
      expect(c).toMatch(/^(motion-safe:animate-(achievement|confetti|gloss|companion-[a-z]+))$/);
    }
    expect(out.match(/hidden size-2/g)?.length).toBeGreaterThan(0); // hidden unless motion is allowed
  });
});

describe('AchievementToast', () => {
  it('shows nothing until an activity is finished', () => {
    expect(renderToStaticMarkup(<AchievementToast />)).toBe('');
  });
});
