export function sseResponse(body) {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

export function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function mockFetch(responder) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url: typeof url === 'string' ? url : url.toString(), opts });
    return responder(url, opts);
  };
  fn.calls = calls;
  return fn;
}
