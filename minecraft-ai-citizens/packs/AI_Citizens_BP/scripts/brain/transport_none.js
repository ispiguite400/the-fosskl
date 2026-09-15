/**
 * Default transport: no network.
 *
 * `@minecraft/server-net` only exists on a Bedrock Dedicated Server with the
 * beta API enabled, and a missing module would break the whole script bundle at
 * load time. So the pack ships with this stub and `tools/build.sh --claude`
 * swaps `transport.js` over to `transport_net.js`.
 */
export const NET_AVAILABLE = false;

export async function postJson() {
  throw new Error("network transport not enabled in this build");
}

export function transportName() {
  return "none";
}
