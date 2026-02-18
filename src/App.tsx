import { AppProviders } from '@/app/providers/AppProviders';
import { AppRoutes } from '@/app/routes/AppRoutes';

const App = () => (
  <AppProviders>
    <AppRoutes />
  </AppProviders>
);

export default App;
