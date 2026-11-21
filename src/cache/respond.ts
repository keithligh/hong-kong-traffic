export function bytesResponse(body: Uint8Array, contentType: string, maxAge: number): Response {
  return new Response(Buffer.from(body), {
    headers: {
      "content-type": contentType,
      "cache-control": `public, max-age=${maxAge}`,
    },
  });
}

export function empty(status: number): Response {
  return new Response(null, { status, headers: { "cache-control": "no-store" } });
}
