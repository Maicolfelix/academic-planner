import { describe, expect, it } from 'vitest';
import { installUi, isIosDevice, isStandalone } from './pwaState';

const SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
const CHROME_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/120.0 Mobile/15E148 Safari/604.1';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36';

describe('isStandalone', () => {
  it('detects display-mode: standalone and Safari navigator.standalone', () => {
    expect(isStandalone({ displayStandalone: true })).toBe(true);
    expect(isStandalone({ displayStandalone: false, navigatorStandalone: true })).toBe(true);
    expect(isStandalone({ displayStandalone: false })).toBe(false);
    expect(isStandalone({ displayStandalone: false, navigatorStandalone: false })).toBe(false);
  });
});

describe('isIosDevice', () => {
  it('recognises iPhone and iPadOS (Mac with touch), not desktop', () => {
    expect(isIosDevice(SAFARI_IOS, 'iPhone', 5)).toBe(true);
    expect(isIosDevice('Mozilla/5.0 (Macintosh)', 'MacIntel', 5)).toBe(true);
    expect(isIosDevice('Mozilla/5.0 (Macintosh)', 'MacIntel', 0)).toBe(false);
    expect(isIosDevice(CHROME, 'Win32', 0)).toBe(false);
  });
});

describe('installUi', () => {
  const base = { installed: false, hasPrompt: false, ios: false, userAgent: CHROME };

  it('offers nothing when already installed, even with a prompt available', () => {
    expect(installUi({ ...base, installed: true, hasPrompt: true })).toBe('none');
    expect(installUi({ ...base, installed: true, ios: true, userAgent: SAFARI_IOS })).toBe('none');
  });

  it('offers the native prompt only when the browser provided one', () => {
    expect(installUi({ ...base, hasPrompt: true })).toBe('prompt');
    expect(installUi(base)).toBe('none');
  });

  it('shows the iOS hint on Safari only, never a useless button elsewhere', () => {
    expect(installUi({ ...base, ios: true, userAgent: SAFARI_IOS })).toBe('ios-hint');
    expect(installUi({ ...base, ios: true, userAgent: CHROME_IOS })).toBe('none');
  });
});
