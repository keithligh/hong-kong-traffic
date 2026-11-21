import { HoldError } from "./store";

/** Fetch a URL this server already decided is allowed. Redirects are not followed. */
export async function fetchLimited(
  url: string,
  allow: (candidate: string) => boolean,
  maxBytes: number,
): Promise<{ body: Uint8Array; contentType: string }> {
  if (!allow(url)) throw new Error("blocked-url");
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(8_000),
  });
  if (response.status === 429) throw new HoldError(120_000);
  if (response.status >= 300 && response.status < 400) throw new HoldError(60_000);
  if (!response.ok || !response.body) throw new Error(`upstream-${response.status}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new HoldError(60_000);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const contentType = (response.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim().toLowerCase();
  if (contentType.startsWith("text/html")) throw new HoldError(60_000);
  return { body, contentType };
}
