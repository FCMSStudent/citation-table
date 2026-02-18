import { Routes, Route } from 'react-router-dom';
import AuthPage from '@/features/auth/ui/AuthPage';
import LandingPage from '@/features/auth/ui/LandingPage';
import SearchPage from '@/features/research-search/ui/SearchPage';
import ReportsPage from '@/features/reports-list/ui/ReportsPage';
import ReportDetailPage from '@/features/report-detail/ui/ReportDetailPage';
import NotFound from '@/pages/NotFound';
import { ProtectedRoute } from '@/app/routes/ProtectedRoute';
import { RouteErrorBoundary } from '@/app/routes/RouteErrorBoundary';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/auth" element={<RouteErrorBoundary><AuthPage /></RouteErrorBoundary>} />
      <Route path="/" element={<RouteErrorBoundary><LandingPage /></RouteErrorBoundary>} />
      <Route
        path="/app"
        element={
          <RouteErrorBoundary>
            <ProtectedRoute>
              <SearchPage />
            </ProtectedRoute>
          </RouteErrorBoundary>
        }
      />
      <Route
        path="/reports"
        element={
          <RouteErrorBoundary>
            <ProtectedRoute>
              <ReportsPage />
            </ProtectedRoute>
          </RouteErrorBoundary>
        }
      />
      <Route
        path="/reports/:id"
        element={
          <RouteErrorBoundary>
            <ProtectedRoute>
              <ReportDetailPage />
            </ProtectedRoute>
          </RouteErrorBoundary>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
