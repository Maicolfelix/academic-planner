import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { PublicOnly, RequireAuth, RequirePeriod } from './auth/guards';
import { AppShell } from './components/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { RegisterPage } from './pages/RegisterPage';
import { PwaNotices } from './pwa/PwaNotices';

// The first screens (login, Dashboard) load with the app; the rest are fetched on first visit (and precached by
// the service worker, so they also open offline once the app has been used).
/** One more attempt when a screen's file fails to download (a flaky connection must not end in an error page). */
const withRetry = async <T,>(load: () => Promise<T>): Promise<T> => {
  try {
    return await load();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return load();
  }
};

const named = <T extends Record<string, React.ComponentType>>(
  load: () => Promise<T>,
  name: keyof T,
) => lazy(() => withRetry(load).then((m) => ({ default: m[name] as React.ComponentType })));

const ActivitiesPage = named(() => import('./pages/ActivitiesPage'), 'ActivitiesPage');
const CalendarPage = named(() => import('./pages/CalendarPage'), 'CalendarPage');
const InboxPage = named(() => import('./pages/InboxPage'), 'InboxPage');
const ProgressPage = named(() => import('./pages/ProgressPage'), 'ProgressPage');
const RadarPage = named(() => import('./pages/RadarPage'), 'RadarPage');
const ScheduleImportPage = named(() => import('./pages/ScheduleImportPage'), 'ScheduleImportPage');
const IcsImportPage = named(() => import('./pages/IcsImportPage'), 'IcsImportPage');
const SharePage = named(() => import('./pages/SharePage'), 'SharePage');
const StatusPage = named(() => import('./pages/StatusPage'), 'StatusPage');
const StudiesPage = named(() => import('./pages/StudiesPage'), 'StudiesPage');
const SubjectsPage = named(() => import('./pages/SubjectsPage'), 'SubjectsPage');
const SubjectGradesPage = named(() => import('./pages/SubjectGradesPage'), 'SubjectGradesPage');

export function App() {
  return (
    <>
      <PwaNotices />
      <Suspense
        fallback={
          <p role="status" className="p-6">
            Cargando…
          </p>
        }
      >
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/share" element={<SharePage />} />
          <Route element={<PublicOnly />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
          </Route>
          <Route element={<RequireAuth />}>
            <Route path="/onboarding" element={<OnboardingPage />} />
            {/* Outside the HOME gate: Mis estudios is where a missing HOME period gets fixed, and /subjects asks for HOME
                itself ONLY when no `?period=` names the period to open (an explicit, owned period needs no HOME). */}
            <Route element={<AppShell />}>
              <Route path="/settings/studies" element={<StudiesPage />} />
              <Route path="/subjects" element={<SubjectsPage />} />
              {/* Like /subjects it needs no HOME: the subject (and so its period) is resolved by the API, owned or 404. */}
              <Route path="/subjects/:subjectId/grades" element={<SubjectGradesPage />} />
            </Route>
            <Route element={<RequirePeriod />}>
              <Route element={<AppShell />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/activities" element={<ActivitiesPage />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/radar" element={<RadarPage />} />
                <Route path="/progress" element={<ProgressPage />} />
                <Route path="/calendar/import" element={<ScheduleImportPage />} />
                <Route path="/calendar/import-ics" element={<IcsImportPage />} />
                <Route path="/inbox" element={<InboxPage />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </>
  );
}
