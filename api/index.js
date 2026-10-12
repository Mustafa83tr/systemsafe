import url from 'url';

export default async function handler(req, res) {
  // Query parametrelerini güvenli ve hatasız alalım
  const queryObject = url.parse(req.url, true).query;
  const targetUrl = queryObject.url;

  if (!targetUrl) {
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    res.statusCode = 200;
    res.end(`
      <!DOCTYPE html>
      <html>
      <head><title>Vercel Web Proxy</title></head>
      <body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#f4f4f9;">
        <div style="background:white;padding:30px;border-radius:8px;box-shadow:0 4px 10px rgba(0,0,0,0.1);text-align:center;">
          <h3>Vercel Web Proxy Arayüzü</h3>
          <form method="GET" style="margin-top:15px;">
            <input type="text" name="url" placeholder="https://youtube.com" style="width:300px;padding:10px;border:1px solid #ccc;border-radius:4px;" required>
            <button type="submit" style="padding:10px 20px;background:#000;color:#fff;border:none;border-radius:4px;cursor:pointer;margin-left:5px;">Git</button>
          </form>
        </div>
      </body>
      </html>
    `);
    return;
  }

  try {
    let fetchUrl = targetUrl;
    if (!fetchUrl.startsWith('http://') && !fetchUrl.startsWith('https://')) {
      fetchUrl = 'https://' + fetchUrl;
    }

    const response = await fetch(fetchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });

    const body = await response.text();
    res.setHeader('Content-Type', response.headers.get('content-type') || 'text/html;charset=utf-8');
    res.statusCode = response.status;
    res.end(body);
  } catch (err) {
    res.statusCode = 500;
    res.end('Bağlantı Hatası: ' + err.message);
  }
}
