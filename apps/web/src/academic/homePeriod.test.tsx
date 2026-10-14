import { readFileSync } from 'node:fs';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AcademicPeriod } from '@planner/core';
import { ME_KEY } from '../auth/useAuth';
import { DASHBOARD_KEY } from '../dashboard/useDashboard';
import { PROFILE_KEY } from '../profile/useProfile';
import { homeGate } from './homeGate';
import {
  homePeriodKey,
  invalidateAfterHomeChange,
  invalidateAfterPeriodChange,
  periodsKey,
  subjectsKey,
  useCurrentPeriod,
} from './useAcademic';

const period = (over: Partial<AcademicPeriod> = {}): AcademicPeriod => ({
  id: '5f0c3a4e-9a52-4c1e-8f6a-3f1d2c4b6a70',
  name: 'P',
  startDate: '2026-08-03',
  endDate: '2026-11-28',
  isCurrent: true,
  studyTrackId: null,
  studyLevel: null,
  studyLevelNote: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});
const SECONDARY = period({
  id: '7c1d5f10-1b2e-4a38-8f6a-5b9c0d3e2a41',
  studyTrackId: '00000000-0000-4000-8000-0000000000f2',
});

describe('the gate of the app asks for the HOME period, which the server decides', () => {
  const state = (over: Partial<Parameters<typeof homeGate>[0]> = {}) => ({
    isPending: false,
    isError: false,
    data: undefined as AcademicPeriod | null | undefined,
    ...over,
  });

  it('a home period lets the user in (a legacy account with one general current period too)', () => {
    expect(homeGate(state({ data: period() }))).toBe('ENTER');
  });

  it('no home period (null) sends the user to the onboarding', () => {
    expect(homeGate(state({ data: null }))).toBe('ONBOARD');
  });

  it('while it loads there is a message, and a failed load without data is a retry, never an entrance', () => {
    expect(homeGate(state({ isPending: true }))).toBe('LOADING');
    expect(homeGate(state({ isError: true }))).toBe('ERROR');
    // a failed refresh that still has the period shown keeps the user in
    expect(homeGate(state({ isError: true, data: period() }))).toBe('ENTER');
    expect(homeGate(state({ isError: true, data: null }))).toBe('ONBOARD');
  });

  it('a secondary study’s current period never satisfies it: the server answers null and nothing else is consulted', () => {
    // the periods list holds a current period of a secondary study, but HOME is null: the gate follows HOME
    const client = new QueryClient();
    client.setQueryData(periodsKey, [SECONDARY]);
    client.setQueryData(homePeriodKey, null);
    expect(
      homeGate({ isPending: false, isError: false, data: client.getQueryData(homePeriodKey) }),
    ).toBe('ONBOARD');
  });
});

describe('useCurrentPeriod means HOME CURRENT and never falls back to another current period', () => {
  function Probe() {
    const { period: p } = useCurrentPeriod();
    return <p data-home={p?.id ?? 'none'} />;
  }
  const render = (home: AcademicPeriod | null | undefined, list: AcademicPeriod[]) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(periodsKey, list);
    if (home !== undefined) client.setQueryData(homePeriodKey, home);
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
  };

  it('returns the home period the server said', () => {
    const home = period();
    expect(render(home, [SECONDARY, home])).toContain(`data-home="${home.id}"`);
  });

  it('with HOME null it returns nothing, even though the list has a current period of a secondary study', () => {
    expect(render(null, [SECONDARY])).toContain('data-home="none"');
  });

  it('while HOME is not loaded it returns nothing: it does not guess from the list', () => {
    expect(render(undefined, [SECONDARY, period()])).toContain('data-home="none"');
  });

  it('a legacy account (one general current period) gets exactly that period', () => {
    const only = period();
    expect(render(only, [only])).toContain(`data-home="${only.id}"`);
  });
});

describe('the cache is refreshed when HOME can change', () => {
  const seeded = () => {
    const client = new QueryClient();
    for (const key of [
      periodsKey,
      homePeriodKey,
      DASHBOARD_KEY,
      ['radar'],
      ['activities', {}],
      subjectsKey('p1'),
      ME_KEY,
      PROFILE_KEY,
    ])
      client.setQueryData(key, { stale: false });
    return client;
  };
  const stale = (client: QueryClient, key: readonly unknown[]) =>
    client.getQueryState(key)?.isInvalidated === true;

  it('making another study the primary one, archiving or restoring one: the home period and everything read from it are stale', async () => {
    const client = seeded();
    await invalidateAfterHomeChange(client);
    for (const key of [
      homePeriodKey,
      periodsKey,
      DASHBOARD_KEY,
      ['radar'],
      ['activities', {}],
      subjectsKey('p1'),
    ]) {
      expect(stale(client, key), JSON.stringify(key)).toBe(true);
    }
  });

  it('...but who the user is and their profile are not refetched for nothing', async () => {
    const client = seeded();
    await invalidateAfterHomeChange(client);
    expect(stale(client, ME_KEY)).toBe(false);
    expect(stale(client, PROFILE_KEY)).toBe(false);
  });

  it('creating or editing a period refreshes the list, the home period and the dashboard', async () => {
    const client = seeded();
    await invalidateAfterPeriodChange(client);
    expect(stale(client, periodsKey)).toBe(true);
    expect(stale(client, homePeriodKey)).toBe(true);
    expect(stale(client, DASHBOARD_KEY)).toBe(true);
    expect(stale(client, ME_KEY)).toBe(false);
  });
});

describe('the hooks are wired to those refreshes', () => {
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

  it('every study action that can move HOME refreshes it: make-primary, archive and restore', () => {
    const hooks = src('../studyTracks/useStudyTracks.ts');
    expect(hooks).toMatch(/invalidateAfterHomeChange\(qc\)/);
    for (const name of [
      'useMakeStudyTrackPrimary',
      'useArchiveStudyTrack',
      'useRestoreStudyTrack',
    ]) {
      expect(hooks, name).toContain(name);
    }
    const api = src('../api/studyTracks.ts');
    for (const action of ['make-primary', 'archive', 'restore'])
      expect(api).toContain(`'${action}'`);
  });

  it('creating and updating a period refresh the home period too', () => {
    const hooks = src('./useAcademic.ts');
    const uses = hooks.match(/onSuccess: \(\) => invalidateAfterPeriodChange\(qc\)/g) ?? [];
    expect(uses).toHaveLength(2); // useCreatePeriod and useUpdatePeriod
  });

  it('the gate, the current-period hook and the onboarding take HOME from the server, not from the list', () => {
    const guards = src('../auth/guards.tsx');
    expect(guards).toMatch(/useHomePeriod\(\)/);
    expect(guards).toMatch(/homeGate\(home\)/);
    expect(guards).not.toMatch(/usePeriods|isCurrent/);
    const hooks = src('./useAcademic.ts');
    expect(hooks).toMatch(/useCurrentPeriod\(\) \{\s*const query = useHomePeriod\(\)/);
    expect(hooks).not.toMatch(/\.(find|some)\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.isCurrent/);
    const onboarding = src('../pages/OnboardingPage.tsx');
    expect(onboarding).toMatch(/useHomePeriod\(\)/);
    expect(onboarding).not.toMatch(/usePeriods|\.isCurrent/);
  });
});
