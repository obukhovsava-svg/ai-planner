// Russian entry point for the Cloudflare Worker: Russian mobile networks throttle Cloudflare,
// so the wallpaper (~250 KB) and the Shortcut requests go through Yandex Cloud instead.
// API Gateway (/{proxy+}) → this function → the Worker, byte for byte.
const ORIGIN = 'https://ai-planner-brain.savelyobuhov.workers.dev';
const DROP = new Set(['host', 'content-length', 'connection', 'accept-encoding', 'x-forwarded-for', 'x-real-ip', 'x-envoy-original-path', 'x-request-id', 'x-trace-id', 'uber-trace-id', 'traceparent']);
const TEXT = /^(text\/|application\/(json|javascript|xml))/;

exports.handler = async (event) => {
  const tail = event.pathParameters?.proxy ?? event.params?.proxy ?? '';
  const path = tail ? `/${tail}` : event.path && !event.path.includes('{') ? event.path : '/';
  const qs = new URLSearchParams(event.queryStringParameters || {}).toString();
  const method = event.httpMethod || 'GET';
  const headers = {};
  for (const [k, v] of Object.entries(event.headers || {})) if (!DROP.has(k.toLowerCase())) headers[k] = v;
  let body;
  if (event.body && method !== 'GET' && method !== 'HEAD') body = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;

  const res = await fetch(`${ORIGIN}${path}${qs ? `?${qs}` : ''}`, { method, headers, body, redirect: 'manual' });
  const out = {};
  res.headers.forEach((v, k) => {
    if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k)) out[k] = v;
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const text = TEXT.test(res.headers.get('content-type') || '');
  return { statusCode: res.status, headers: out, body: text ? buf.toString('utf8') : buf.toString('base64'), isBase64Encoded: !text };
};
