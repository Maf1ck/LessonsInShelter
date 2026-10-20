const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const WEBRTC_PORT = 8889;

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// На HTTPS-сторінці браузер забороняє звертатись до http://:8889 (змішаний контент),
// тому WHEP (слухати) і WHIP (говорити) проходять через цей же сервер до локального медіасервера.
function proxyRtc(req, res, mediaPath, kind) {
  readBody(req, 64 * 1024)
    .then((body) => {
      const up = http.request(
        { host: '127.0.0.1', port: WEBRTC_PORT, path: `/${encodeURIComponent(mediaPath)}/${kind}`, method: 'POST', headers: { 'Content-Type': 'application/sdp', 'Content-Length': body.length } },
        (r) => {
          res.writeHead(r.statusCode, { 'Content-Type': r.headers['content-type'] || 'application/sdp', 'Cache-Control': 'no-store' });
          r.pipe(res);
        },
      );
      up.on('error', () => res.writeHead(502).end());
      up.end(body);
    })
    .catch(() => res.writeHead(400).end());
}

// Сторінка для дітей + API класу. Замінює python -m http.server / static-server.ps1:
// не потрібні ні Python, ні права адміністратора.
// api(req, res, pathname, query) -> true, якщо запит оброблено.
function createHandler(webDir, channelsFile, api = () => false) {
  const root = path.resolve(webDir);

  return (req, res) => {
    let pathname;
    let query;
    try {
      const url = new URL(req.url, 'http://x');
      pathname = decodeURIComponent(url.pathname);
      query = url.searchParams;
    } catch {
      res.writeHead(400).end();
      return;
    }

    if (api(req, res, pathname, query)) return;

    if (pathname.endsWith('/')) pathname += 'index.html';

    const file = pathname === '/channels.json' ? channelsFile : path.resolve(root, '.' + pathname);
    if (file !== channelsFile && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }

    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Не знайдено');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  };
}

const createWebServer = (handler) => http.createServer(handler);
const createSecureServer = (handler, { key, cert }) => https.createServer({ key, cert }, handler);

// Пробує порт, а якщо зайнятий (pgAdmin, Jenkins...) - наступні.
function listenOnFreePort(server, firstPort, attempts = 20) {
  return new Promise((resolve, reject) => {
    let port = firstPort;
    const tryListen = () => {
      const onError = (e) => {
        if (e.code === 'EADDRINUSE' && port < firstPort + attempts) {
          port += 1;
          tryListen();
        } else {
          reject(e);
        }
      };
      server.once('error', onError);
      server.listen(port, '0.0.0.0', () => {
        server.removeListener('error', onError);
        resolve(port);
      });
    };
    tryListen();
  });
}

module.exports = { createHandler, createWebServer, createSecureServer, listenOnFreePort, readBody, proxyRtc };
