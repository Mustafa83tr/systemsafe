const url = require('url');

module.exports = async function handler(req, res) {
  const queryObject = url.parse(req.url, true).query;
  let targetUrl = queryObject.url;

  // Hedef yoksa şık arayüzü sun
  if (!targetUrl) {
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    res.statusCode = 200;
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>YouTube Güvenli Tünel</title>
      </head>
      <body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#0f0f0f;color:#fff;margin:0;">
        <div style="background:#212121;padding:40px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.6);text-align:center;width:400px;">
          <h2 style="margin-bottom:10px;color:#ff0033;">YouTube Tüneli</h2>
          <p style="color:#aaa;font-size:14px;margin-bottom:20px;">Kurumsal ağ geçidi aktif.</p>
          <form method="GET" style="display:flex;flex-direction:column;gap:15px;">
            <input type="text" name="url" value="https://m.youtube.com" placeholder="https://m.youtube.com" style="width:100%;padding:12px;border:1px solid #3f3f3f;border-radius:6px;background:#121212;color:#fff;box-sizing:border-box;outline:none;" required>
            <button type="submit" style="width:100%;padding:12px;background:#cc0000;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:bold;font-size:15px;">YouTube'u Başlat</button>
          </form>
        </div>
      </body>
      </html>
    `);
    return;
  }

  try {
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }

    const parsedTarget = new URL(targetUrl);
    const proxyHost = req.headers['x-forwarded-host'] || req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const proxyBase = `${protocol}://${proxyHost}/api?url=`;

    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/605.1.15',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': 'https://m.youtube.com/'
      }
    });

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/html')) {
      let html = await response.text();

      // Göreceli yolları proxy üzerinden akacak şekilde yeniden yazıyoruz
      html = html.replace(/(href|src)="\/([^"]*)"/g, (match, attr, path) => {
        return `${attr}="${proxyBase}https://${parsedTarget.host}/${path}"`;
      });

      res.setHeader('Content-Type', 'text/html;charset=utf-8');
      res.statusCode = response.status;
      res.end(html);
    } else {
      const buffer = await response.arrayBuffer();
      res.setHeader('Content-Type', contentType);
      res.statusCode = response.status;
      res.end(Buffer.from(buffer));
    }
  } catch (err) {
    res.statusCode = 500;
    res.end('Tünel Bağlantı Hatası: ' + err.message);
  }
};
 
