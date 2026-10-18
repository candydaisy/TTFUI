// ================================
// FISH.AUDIO RELAY (Cloudflare Worker)
// ================================
// fish.audio refuses requests from web pages, so the Voice page on the website
// sends speech requests here and this passes them on. The page sends your key
// with each request; nothing is stored here. Deploy steps: README, "Voice-over
// on the website".

// Sites that may use this relay. A fork on another GitHub account adds its own.
const SITES = ['https://candydaisy.github.io', 'http://localhost:8000', 'http://127.0.0.1:8000'];

export default {
  async fetch(req) {
    const origin = req.headers.get('Origin') || '';
    if (!SITES.includes(origin)) return new Response('This site may not use the relay', { status: 403 });
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'authorization, content-type, model',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST' || new URL(req.url).pathname !== '/v1/tts') return new Response('Not found', { status: 404, headers: cors });

    const res = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: {
        authorization: req.headers.get('Authorization') || '',
        'content-type': 'application/json',
        model: req.headers.get('model') || 's2.1-pro',
      },
      body: await req.arrayBuffer(),
    });
    return new Response(res.body, { status: res.status, headers: { ...cors, 'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream' } });
  },
};
