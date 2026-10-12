// Tek bir Invidious sunucusuna bağlı ters proxy.
// Tüm yollar vercel.json ile bu fonksiyona yönlendirilir (?_p_=<yol>).
// Sadece INSTANCE adresine bağlanır, yani herkese açık bir "açık proxy" değildir.

const INSTANCE = (process.env.INSTANCE || 'yewtu.be').replace(/^https?:\/\//, '').replace(/\/+$/, '');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const PASS_HEADERS = ['content-type', 'cache-control', 'content-disposition', 'content-language', 'etag', 'last-modified', 'accept-ranges', 'content-range'];
const TEXT_TYPE = /(text\/|javascript|json|xml|svg)/i;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HOST_RE = new RegExp('(https?:)?(\\\\?\\/){2}' + esc(INSTANCE), 'g');

async function readBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const b = req.body;
  const ct = String(req.headers['content-type'] || '');
  if (b !== undefined && b !== null) {
    if (Buffer.isBuffer(b) || typeof b === 'string') return b;
    if (ct.includes('application/x-www-form-urlencoded')) return new URLSearchParams(b).toString();
    return JSON.stringify(b);
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

module.exports = async function handler(req, res) {
  try {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proxyOrigin = `${proto}://${host}`;

    // Gelen adresten yol ve sorgu parçalarını ayır
    const raw = req.url || '/';
    const qi = raw.indexOf('?');
    const parts = qi >= 0 ? raw.slice(qi + 1).split('&') : [];
    let path = '';
    const rest = [];
    for (const part of parts) {
      if (part.startsWith('_p_=')) {
        try {
          path = encodeURI(decodeURIComponent(part.slice(4)));
        } catch (e) {
          path = part.slice(4);
        }
      } else if (part) {
        rest.push(part);
      }
    }
    const target = `https://${INSTANCE}/${path}${rest.length ? '?' + rest.join('&') : ''}`;

    // İstek başlıkları
    const headers = {
      'user-agent': UA,
      'accept': req.headers['accept'] || '*/*',
      'accept-language': req.headers['accept-language'] || 'tr-TR,tr;q=0.9,en;q=0.8',
      'accept-encoding': 'identity',
    };
    if (req.headers.cookie) headers.cookie = req.headers.cookie;
    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
    if (req.headers.range) headers.range = req.headers.range;
    if (req.headers.origin) headers.origin = `https://${INSTANCE}`;
    headers.referer = `https://${INSTANCE}/`;

    const body = await readBody(req);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);

    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      redirect: 'manual',
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    // Yanıt başlıkları
    for (const h of PASS_HEADERS) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    const loc = upstream.headers.get('location');
    if (loc) res.setHeader('location', loc.replace(HOST_RE, proxyOrigin));

    const cookies = typeof upstream.headers.getSetCookie === 'function' ? upstream.headers.getSetCookie() : [];
    if (cookies.length) {
      res.setHeader(
        'set-cookie',
        cookies.map((c) => c.replace(/;\s*domain=[^;]*/i, ''))
      );
    }

    const type = upstream.headers.get('content-type') || '';
    let out;
    if (TEXT_TYPE.test(type)) {
      let text = await upstream.text();
      text = text.replace(HOST_RE, (m) => (m.includes('\\') ? proxyOrigin.replace(/\//g, '\\/') : proxyOrigin));
      out = Buffer.from(text, 'utf8');
    } else {
      out = Buffer.from(await upstream.arrayBuffer());
    }

    res.statusCode = upstream.status;
    res.setHeader('content-length', out.length);
    res.end(req.method === 'HEAD' ? undefined : out);
  } catch (err) {
    res.statusCode = 502;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('Proxy hatası: ' + (err && err.message ? err.message : err));
  }
};
