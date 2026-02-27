'use client';

import { useEffect, useMemo, useRef } from 'react';

type RRWebEvent = Record<string, unknown>;

type RRWebPlayerProps = {
  events: RRWebEvent[];
};

const PLAYER_WIDTH = 1100;
const PLAYER_HEIGHT = 620;

export default function RRWebDemoPlayer({ events }: RRWebPlayerProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<{ pause?: () => void } | null>(null);

  const sortedEvents = useMemo(() => {
    return [...events].sort(
      (a, b) => Number((a as { timestamp?: number }).timestamp ?? 0) - Number((b as { timestamp?: number }).timestamp ?? 0)
    );
  }, [events]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!mountRef.current || !sortedEvents.length) {
        return;
      }

      const module = (await import('rrweb-player')) as unknown as { default: any };
      const RRWebPlayer = module.default;

      if (cancelled || !mountRef.current) {
        return;
      }

      mountRef.current.innerHTML = '';
      playerRef.current = new RRWebPlayer({
        target: mountRef.current,
        props: {
          events: sortedEvents,
          width: PLAYER_WIDTH,
          height: PLAYER_HEIGHT,
          autoPlay: false,
          showController: true,
          speed: 1,
          speedOption: [0.5, 1, 2, 4]
        }
      });
    }

    init();

    return () => {
      cancelled = true;
      try {
        playerRef.current?.pause?.();
      } catch {
        // best effort cleanup
      }

      if (mountRef.current) {
        mountRef.current.innerHTML = '';
      }
      playerRef.current = null;
    };
  }, [sortedEvents]);

  if (!sortedEvents.length) {
    return <div className="empty-state">No processed snapshots available for rrweb playback.</div>;
  }

  return (
    <div className="rrweb-player-shell">
      <div className="rrweb-player-mount" ref={mountRef} />
    </div>
  );
}
