import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export function RouteFocusManager() {
  const location = useLocation();

  useEffect(() => {
    const main = document.getElementById('app-main');
    if (main) main.focus();
  }, [location.pathname]);

  return null;
}
