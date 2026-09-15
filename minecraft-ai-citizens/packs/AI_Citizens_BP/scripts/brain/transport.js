/**
 * Transport selector.
 *
 * Re-exports the stub by default. `tools/build.sh --claude` rewrites this file
 * to point at ./transport_net.js. Keep the export surface identical in both.
 */
export { NET_AVAILABLE, postJson, transportName } from "./transport_none.js";
