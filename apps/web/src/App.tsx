import { Navigate, Route, Routes } from 'react-router';
import { PublicOnly, RequireAuth, RequirePeriod } from './auth/guards';
import { AppShell } from './components/AppShell';
import { ActivitiesPage } from './pages/ActivitiesPage';
import { CalendarPage } from './pages/CalendarPage';
import { DashboardPage } from './pages/DashboardPage';
import { InboxPage } from './pages/InboxPage';
import { LoginPage } from './pages/LoginPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { ProgressPage } from './pages/ProgressPage';
import { ScheduleImportPage } from './pages/ScheduleImportPage';
import { RadarPage } from './pages/RadarPage';
import { RegisterPage } from './pages/RegisterPage';
import { StatusPage } from './pages/StatusPage';
import { SubjectsPage } from './pages/SubjectsPage';
import { PwaNotices } from './pwa/PwaNotices';

export function App() {
  return (
    <>
      <PwaNotices />
      <Routes>
        <Route path="/status" element={<StatusPage />} />
        <Route element={<PublicOnly />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>
        <Route element={<RequireAuth />}>
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route element={<RequirePeriod />}>
            <Route element={<AppShell />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/subjects" element={<SubjectsPage />} />
              <Route path="/activities" element={<ActivitiesPage />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/radar" element={<RadarPage />} />
              <Route path="/progress" element={<ProgressPage />} />
              <Route path="/calendar/import" element={<ScheduleImportPage />} />
              <Route path="/inbox" element={<InboxPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </>
  );
}
