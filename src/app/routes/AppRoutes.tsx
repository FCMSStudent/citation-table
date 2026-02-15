import { Routes, Route } from 'react-router-dom';
import AuthPage from '@/features/auth/ui/AuthPage';
import LandingPage from '@/features/auth/ui/LandingPage';
import SearchPage from '@/features/research-search/ui/SearchPage';
import ReportsPage from '@/features/reports-list/ui/ReportsPage';
import ReportDetailPage from '@/features/report-detail/ui/ReportDetailPage';
import NotFound from '@/pages/NotFound';
import { ProtectedRoute } from '@/app/routes/ProtectedRoute';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/" element={<LandingPage />} />
      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <SearchPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports"
        element={
          <ProtectedRoute>
            <ReportsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports/:id"
        element={
          <ProtectedRoute>
            <ReportDetailPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
