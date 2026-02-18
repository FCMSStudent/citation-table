import { AppProviders } from '@/app/providers/AppProviders';
import { AppRoutes } from '@/app/routes/AppRoutes';
import { RouteFocusManager } from '@/shared/ui/RouteFocusManager';

const App = () => (
  <AppProviders>
    <a
      href="#app-main"
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-background focus:px-3 focus:py-2 focus:outline-none focus:ring-2 focus:ring-primary"
    >
      Skip to main content
    </a>
    <RouteFocusManager />
    <main id="app-main" tabIndex={-1} className="outline-none">
      <AppRoutes />
    </main>
  </AppProviders>
);

export default App;
