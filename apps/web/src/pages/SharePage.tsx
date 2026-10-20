import { composeSharedText } from '@planner/core';
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { stashShared } from '../share/sharedCapture';

/**
 * Where the OS "Share" menu lands (Web Share Target, GET). It reads title/text/url, keeps the composed text in this tab only,
 * and leaves for the Quick Capture with a `replace` navigation, so the shared text is gone from the address bar and the history.
 * It creates nothing and calls no API. It is OUTSIDE the login guard on purpose: a signed-out student is sent to log in by the
 * destination, and the share is still waiting (ten minutes) when they come back.
 */
export function SharePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    stashShared(
      composeSharedText({
        title: params.get('title'),
        text: params.get('text'),
        url: params.get('url'),
      }),
    );
    navigate('/dashboard', { replace: true });
  }, [params, navigate]);

  // Nothing to read (someone typed /share) is stashed too: the capture then says, discreetly, that nothing was received.
  return <p className="p-6 text-center text-sm text-muted-foreground">Abriendo Captura rápida…</p>;
}
