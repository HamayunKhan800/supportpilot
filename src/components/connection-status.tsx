"use client";

import { Wifi, WifiOff } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}
const isOnline = () => navigator.onLine;
const serverOnline = () => true;

/** How long "Back online" stays before the notice goes away. */
const BACK_ONLINE_MS = 3000;

/**
 * Says so when the connection drops (design step 8.6), before someone types a reply that
 * can't be sent. The browser's online/offline events drive it; it is announced politely and
 * says "Back online" for a moment when the connection returns. Nothing shows while online.
 */
export function ConnectionStatus() {
  const online = useSyncExternalStore(subscribe, isOnline, serverOnline);
  // "Adjusting state when a prop changes" (react.dev): note the moment we come back.
  const [wasOffline, setWasOffline] = useState(false);
  const [previous, setPrevious] = useState(online);
  if (previous !== online) {
    setPrevious(online);
    setWasOffline(online && !previous);
  }

  useEffect(() => {
    if (!wasOffline) return;
    const timer = window.setTimeout(() => setWasOffline(false), BACK_ONLINE_MS);
    return () => window.clearTimeout(timer);
  }, [wasOffline]);

  const show = !online || wasOffline;
  return (
    // Always in the tree (empty while online), so the change is announced. A plain live
    // region rather than role="status", so it never competes with a page's own status message.
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-0 top-2 z-[70] flex justify-center px-3"
    >
      {show && (
        <p className="enter-fade bg-foreground text-background pointer-events-auto flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium shadow-lg">
          {online ? (
            <>
              <Wifi aria-hidden="true" className="size-4" />
              Back online.
            </>
          ) : (
            <>
              <WifiOff aria-hidden="true" className="size-4" />
              You&apos;re offline. Changes can&apos;t be saved until the connection is back.
            </>
          )}
        </p>
      )}
    </div>
  );
}
