import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

export function useOpenOnNewRoute(open: () => void) {
  const location = useLocation();
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (location.pathname.endsWith('/new')) {
      openRef.current();
    }
  }, [location.pathname]);
}
