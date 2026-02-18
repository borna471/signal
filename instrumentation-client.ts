import posthog from "posthog-js";

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;

if (typeof window !== "undefined" && posthogKey) {
  posthog.init(posthogKey, {
    api_host: posthogHost,
    defaults: "2026-01-30",
    capture_pageview: "history_change",
    capture_pageleave: "if_capture_pageview",
    disable_session_recording: false,
    loaded: (client) => {
      // Ensure replay collection is active across the app.
      client.startSessionRecording();
    }
  });
}
