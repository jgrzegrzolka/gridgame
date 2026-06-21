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
 *
 * Every envelope is also stamped with the anonymous `deviceId` so the
 * dashboard owner can filter their own traffic out:
 *   - `ai.user.id` tag → first-class `user_Id` field.
 *   - `data.deviceId`  → `customDimensions.deviceId`.
 * Filter with `| where user_Id != "<your deviceId>"` (or the
 * customDimensions variant) to see real visitor traffic only.
 */

import { getOrCreateDeviceId } from '../flags/identity.js';

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
    const deviceId = getOrCreateDeviceId(window.localStorage, () => window.crypto.randomUUID());
    ai.addTelemetryInitializer(
      /** @param {any} item */ (item) => enrichTelemetryItem(item, deviceId),
    );
    ai.trackPageView();
    /** @type {any} */ (window).appInsights = ai;
  };
  document.head.appendChild(script);
}

/**
 * Pure enrichment applied to every Application Insights envelope before
 * it leaves the browser. Mutates `item` in place — that's the shape the
 * SDK's `addTelemetryInitializer` callback expects.
 *
 * - `item.tags['ai.cloud.role']` slices web vs api in queries.
 * - `item.tags['ai.user.id']` overrides the SDK's auto-generated
 *   anonymous user id with the stable per-browser `deviceId`. Surfaces
 *   as the first-class `user_Id` field so the dashboard owner can do
 *   `| where user_Id != "<my deviceId>"`.
 * - `item.data.deviceId` surfaces in `customDimensions.deviceId` as a
 *   parallel handle for the same filter (belt-and-suspenders for the
 *   rare envelope types where the tag doesn't propagate).
 *
 * Preserves any existing tags/data the SDK already attached.
 *
 * @param {{ tags?: Record<string, string>, data?: Record<string, unknown> }} item
 * @param {string} deviceId
 */
export function enrichTelemetryItem(item, deviceId) {
  item.tags = item.tags || {};
  item.tags['ai.cloud.role'] = 'web';
  item.tags['ai.user.id'] = deviceId;
  item.data = item.data || {};
  item.data.deviceId = deviceId;
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
