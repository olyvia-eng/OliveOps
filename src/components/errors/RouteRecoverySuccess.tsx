import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { clearChunkRecovery, getSessionStorage } from '../../errors/routeErrorRecovery.js';

export default function RouteRecoverySuccess() {
  const location = useLocation();

  useEffect(() => {
    clearChunkRecovery({
      storage: getSessionStorage(),
      route: location.pathname,
    });
  }, [location.pathname]);

  return null;
}