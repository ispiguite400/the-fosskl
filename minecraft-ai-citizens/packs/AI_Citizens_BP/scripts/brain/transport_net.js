/**
 * HTTP transport via @minecraft/server-net (Bedrock Dedicated Server only).
 *
 * Enabled by `tools/build.sh --claude`, which points transport.js here and adds
 * the module to the behaviour pack manifest. The server owner must also grant
 * the pack network permission in the BDS config - see docs/CLAUDE_SETUP.md.
 */
import { http, HttpRequest, HttpRequestMethod, HttpHeader } from "@minecraft/server-net";

export const NET_AVAILABLE = true;

export async function postJson(url, body, headers = {}, timeoutSeconds = 12) {
  const request = new HttpRequest(url);
  request.method = HttpRequestMethod.Post;
  request.body = JSON.stringify(body);
  request.timeout = timeoutSeconds;
  request.headers = [
    new HttpHeader("Content-Type", "application/json"),
    ...Object.entries(headers).map(([k, v]) => new HttpHeader(k, String(v))),
  ];
  const response = await http.request(request);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`bridge returned ${response.status}`);
  }
  return JSON.parse(response.body || "{}");
}

export function transportName() {
  return "@minecraft/server-net";
}
