// Invidious ters proxy (birden çok sunucu arasında yedekli).
// Tüm yollar vercel.json ile bu fonksiyona yönlendirilir (?_p_=<yol>).
// Sadece aşağıdaki listedeki sunuculara bağlanır, yani herkese açık bir "açık proxy" değildir.
// İstersen Vercel'de INSTANCES ortam değişkeniyle (virgülle ayırarak) listeyi değiştirebilirsin.

const DEFAULTS = [
  'invidious.f5.si',
  'invidious.nerdvpn.de',
  'invidious.tiekoetter.com',
  'inv.zoomerville.com',
  'yt.chocolatemoo53.com',
  'inv.nadeko.net',
  'yewtu.be',
];
const INSTANCES = (process.env.INSTANCES || DEFAULTS.join(','))
  .split(',')
  .map((s) => s.trim().replace(/^https?:\/\//, '').replace(/\/+$/, ''))
  .filter(Boolean);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PASS_HEADERS = ['content-type', 'cache-control', 'content-disposition', 'content-language', 'etag', 'last-modified', 'accept-ranges', 'content-range'];
const TEXT_TYPE = /(text\/|javascript|json|xml|svg)/i;
const CHALLENGE = /(verifying your browser|checking your browser|just a moment|go-away|attention required|enable javascript and cookies|anubis|making sure you.?re not a bot|bot olmad[ıi]ğ[ıi]n[ıi]zdan|proof.of.work|techaro|captcha|cap\W{0,12}challenge|not a bot|bot de[ğg]il|hcaptcha|request id)/i;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HOST_RE = new RegExp('(https?:)?(\\\\?\\/){2}(' + INSTANCES.map(esc).join('|') + ')', 'g');

let preferred = 0; // son çalışan sunucu (sıcak fonksiyon örneğinde hatırlanır)

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

// Bir sunucuya istek at; bot kontrolü / hata ise { fail: sebep } döndür.
async function tryInstance(inst, path, query, req, body) {
  const headers = {
    'user-agent': UA,
    accept: req.headers['accept'] || '*/*',
    'accept-language': req.headers['accept-language'] || 'tr-TR,tr;q=0.9,en;q=0.8',
    'accept-encoding': 'identity',
    referer: `https://${inst}/`,
  };
  if (req.headers.cookie) headers.cookie = req.headers.cookie;
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  if (req.headers.range) headers.range = req.headers.range;
  if (req.headers.origin) headers.origin = `https://${inst}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const r = await fetch(`https://${inst}/${path}${query}`, {
      method: req.method,
      headers,
      body,
      redirect: 'manual',
      signal: ctrl.signal,
    });
    if ([403, 429, 502, 503, 504].includes(r.status) || r.status >= 520) return { fail: 'HTTP ' + r.status };
    const type = r.headers.get('content-type') || '';
    if (TEXT_TYPE.test(type)) {
      const text = await r.text();
      // Bot kontrolü sayfaları küçüktür; gerçek sayfalar (video, arama) çok daha büyüktür.
      const m = type.includes('text/html') && text.length < 40000 && text.match(CHALLENGE);
      if (m) return { fail: 'bot kontrolü (' + m[0] + ')' };
      return { r, text };
    }
    return { r, buf: Buffer.from(await r.arrayBuffer()) };
  } catch (e) {
    return { fail: e && e.name === 'AbortError' ? 'zaman aşımı' : 'bağlantı hatası' };
  } finally {
    clearTimeout(timer);
  }
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
    const debug = rest.includes('_debug_=1');
    if (debug) rest.splice(rest.indexOf('_debug_=1'), 1);
    const query = rest.length ? '?' + rest.join('&') : '';
    const body = await readBody(req);

    // Teşhis: her sunucunun ham yanıtının özetini göster
    if (debug) {
      const lines = await Promise.all(
        INSTANCES.map(async (inst) => {
          try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 8000);
            const r = await fetch(`https://${inst}/${path}${query}`, {
              headers: { 'user-agent': UA, 'accept-language': 'tr-TR,tr;q=0.9,en;q=0.8', 'accept-encoding': 'identity' },
              redirect: 'manual',
              signal: ctrl.signal,
            });
            const t = await r.text();
            clearTimeout(timer);
            const title = (t.match(/<title[^>]*>([^<]*)/i) || [])[1] || '';
            const plain = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            return `[${inst}] HTTP ${r.status} | type=${r.headers.get('content-type')} | len=${t.length} | location=${r.headers.get('location') || '-'} | title=${title.trim()}\n   ${plain.slice(0, 350)}`;
          } catch (e) {
            return `[${inst}] HATA: ${e && e.name === 'AbortError' ? 'zaman aşımı' : e.message}`;
          }
        })
      );
      res.statusCode = 200;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end(lines.join('\n\n'));
      return;
    }

    // Sunucuları sırayla dene (en son çalışandan başla), en fazla 4 deneme
    let result = null;
    const fails = [];
    const order = INSTANCES.map((_, i) => (preferred + i) % INSTANCES.length).slice(0, 5);
    for (const idx of order) {
      const t = await tryInstance(INSTANCES[idx], path, query, req, body);
      if (t && !t.fail) {
        result = t;
        preferred = idx;
        break;
      }
      fails.push(INSTANCES[idx] + ': ' + (t ? t.fail : 'bilinmiyor'));
    }

    if (!result) {
      res.statusCode = 502;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end('Hiçbir Invidious sunucusu yanıt vermedi.\n\n' + fails.join('\n'));
      return;
    }

    const { r } = result;
    for (const h of PASS_HEADERS) {
      const v = r.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    const loc = r.headers.get('location');
    if (loc) res.setHeader('location', loc.replace(HOST_RE, proxyOrigin));

    const cookies = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
    if (cookies.length) {
      res.setHeader('set-cookie', cookies.map((c) => c.replace(/;\s*domain=[^;]*/i, '')));
    }

    let out;
    if (result.text !== undefined) {
      const text = result.text.replace(HOST_RE, (m) => (m.includes('\\') ? proxyOrigin.replace(/\//g, '\\/') : proxyOrigin));
      out = Buffer.from(text, 'utf8');
    } else {
      out = result.buf;
    }

    res.statusCode = r.status;
    res.setHeader('content-length', out.length);
    res.end(req.method === 'HEAD' ? undefined : out);
  } catch (err) {
    res.statusCode = 502;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('Proxy hatası: ' + (err && err.message ? err.message : err));
  }
};
