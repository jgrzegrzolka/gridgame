// Cloudflare Worker: edge proxy for www.yetanotherquiz.com.
//
// What it does. Intercepts every www request and forwards it to the *raw*
// Azure Static Web Apps hostname (`wonderful-ground-...azurestaticapps.net`)
// instead of letting Cloudflare route it to SWA via the configured custom
// domain. The HTTP response goes back to the user through the Worker.
//
// Why it exists. Azure SWA Free SKU has a flaky custom-domain edge: after
// every deploy, ~30 % of requests to www hit POPs that are still missing
// the latest artifact and return Azure's blue 404 page, sometimes for
// hours. The raw `*.azurestaticapps.net` hostname doesn't suffer this —
// it's fully propagated by the time the deploy reports success. Routing
// www through the raw hostname makes www stable without leaving Azure.
// History: see infra/operations.md "Known issues" and the surrounding PR.
//
// Where it lives. The source of truth is the CF dashboard (account
// `jangrzegrzolka`, Worker `yetanotherquiz-edge-proxy`). This file is a
// repo-side copy for version history + reviewability; edits to the
// dashboard are NOT auto-mirrored here. If you change the Worker in CF,
// update this file in the same PR. CI does not deploy this Worker today
// (would need a CF API token scoped to Account:Workers Scripts:Edit —
// over-engineering for six lines that rarely change).
//
// Route binding. `www.yetanotherquiz.com/*` → this Worker (configured in
// the CF dashboard under the Worker's Domains tab). The apex
// (`yetanotherquiz.com`) keeps its existing 301-to-www redirect rule —
// the Worker only handles requests that already hit www.

const SWA_ORIGIN = 'https://wonderful-ground-01bf3091e.7.azurestaticapps.net';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    return fetch(`${SWA_ORIGIN}${url.pathname}${url.search}`, request);
  },
};
