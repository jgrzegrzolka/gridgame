/**
 * Frontend telemetry (Feature Q). Loads the Application Insights JS
 * SDK from Microsoft's CDN and starts capturing page views, unhandled
 * JS exceptions, fetch failures, and performance timings across every
 * page. Server-side telemetry for `api/*` is handled separately by
 * the SWA Function App's auto-instrumentation from the
 * `APPLICATIONINSIGHTS_CONNECTION_STRING` env var.
 *
 * The connection string IS safe to commit — it's a public identifier
 * for the AI instance (like a GA measurement ID), not a secret. It
 * has to be visible in the browser for the SDK to send telemetry at
 * all. Microsoft's docs explicitly call this out.
 *
 * Role-tagged `web` so frontend events can be sliced separately from
 * the api side (which auto-tags `swa-api` via the Function App role
 * name). Use `where cloud_RoleName == "web"` in AI queries.
 */

const CONNECTION_STRING =
  'InstrumentationKey=4158d8f2-63f5-49d6-a7b4-79b4e97e5af5;' +
  'IngestionEndpoint=https://westeurope-5.in.applicationinsights.azure.com/;' +
  'LiveEndpoint=https://westeurope.livediagnostics.monitor.azure.com/;' +
  'ApplicationId=a1f63bb5-52b8-4631-8600-a12d9a16d325';

const CDN_URL = 'https://js.monitor.azure.com/scripts/b/ai.3.gbl.min.js';

let initialised = false;

/**
 * Loads the AI SDK CDN bundle, configures it, and starts tracking.
 * Idempotent — calling it twice is a no-op. The SDK ships as a UMD
 * bundle so we inject a `<script>` tag rather than `import()`-ing.
 * Async-loads so first paint isn't blocked.
 */
export function initAppInsights() {
  if (initialised) return;
  initialised = true;
  if (typeof document === 'undefined') return; // SSR / tests

  // Don't ship telemetry from dev. The local SWA emulator runs on
  // localhost; rows generated there shouldn't pollute prod telemetry.
  // Same idea as `local: true` tagging on Cosmos rows.
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(window.location.host)) return;

  const script = document.createElement('script');
  script.src = CDN_URL;
  script.crossOrigin = 'anonymous';
  script.async = true;
  script.onload = () => {
    const sdk = /** @type {any} */ (window).Microsoft?.ApplicationInsights;
    if (!sdk?.ApplicationInsights) return; // CDN load failed mid-flight
    const ai = new sdk.ApplicationInsights({
      config: {
        connectionString: CONNECTION_STRING,
        // Track navigation timings + exception/perf observers.
        enableAutoRouteTracking: false, // full-page nav, not SPA
        disableFetchTracking: false,
        enableUnhandledPromiseRejectionTracking: true,
        enableCorsCorrelation: true,
        autoTrackPageVisitTime: true,
      },
    });
    ai.loadAppInsights();
    ai.addTelemetryInitializer(
      /** @param {any} item */ (item) => {
        item.tags = item.tags || {};
        item.tags['ai.cloud.role'] = 'web';
      },
    );
    ai.trackPageView();
    /** @type {any} */ (window).appInsights = ai;
  };
  document.head.appendChild(script);
}

/**
 * Emit a custom event. No-op if the SDK hasn't loaded yet (CDN slow,
 * ad blocker, etc.) — caller doesn't have to gate. Use for signals
 * that aren't already auto-captured (TTT-online WebSocket lifecycle
 * is the canonical case — PartyKit's WebSocket server runs on
 * Cloudflare, separate from AI's reach, so the client side is the
 * only surface where these events are observable).
 *
 * @param {string} name
 * @param {Record<string, string | number | boolean>} [properties]
 */
export function trackEvent(name, properties) {
  /** @type {any} */
  const ai = typeof window !== 'undefined' ? /** @type {any} */ (window).appInsights : null;
  if (!ai || typeof ai.trackEvent !== 'function') return;
  ai.trackEvent({ name, properties: properties ?? {} });
}
