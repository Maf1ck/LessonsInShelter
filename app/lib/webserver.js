const http = require('http');
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

// Сторінка для дітей. Замінює python -m http.server / static-server.ps1:
// не потрібні ні Python, ні права адміністратора.
function createWebServer(webDir, channelsFile, onPing = () => {}) {
  const root = path.resolve(webDir);

  return http.createServer((req, res) => {
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

    // Пульс зі сторінки слухача (див. listen.html).
    if (pathname === '/ping') {
      onPing(query.get('ch'), query.get('id'), query.get('bye') === '1');
      res.writeHead(204, { 'Cache-Control': 'no-store' }).end();
      return;
    }
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
  });
}

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

module.exports = { createWebServer, listenOnFreePort };
