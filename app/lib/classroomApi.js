const { readBody, proxyRtc } = require('./webserver');

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

const clientIp = (req) => String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');

// HTTP-маршрути, якими користуються сторінки учнів (див. web/classroom.js).
function createApi(classroom, getInfo) {
  const C = classroom.constructor;

  return (req, res, pathname, q) => {
    const ip = clientIp(req);

    if (pathname === '/info') {
      json(res, 200, getInfo());
      return true;
    }

    if (pathname === '/ping') {
      classroom.ping(q.get('ch'), q.get('id'), q.get('name'), q.get('bye') === '1', ip);
      res.writeHead(204, { 'Cache-Control': 'no-store' }).end();
      return true;
    }

    if (pathname === '/chat/poll' && req.method === 'GET') {
      const ch = q.get('ch');
      const id = q.get('id');
      if (!C.validChannel(ch) || !C.validId(id)) json(res, 400, { error: 'bad request' });
      else json(res, 200, classroom.poll(ch, id, Number(q.get('since')) || 0, q.get('name'), ip));
      return true;
    }

    if (pathname === '/chat/send' && req.method === 'POST') {
      readBody(req, 4096)
        .then((buf) => {
          const b = JSON.parse(buf.toString('utf8'));
          const r = classroom.send(b.ch, b.id, b.name, b.text, ip);
          json(res, r.ok ? 200 : 429, r);
        })
        .catch(() => json(res, 400, { ok: false, error: 'bad request' }));
      return true;
    }

    // Слухати через HTTPS-сторінку: той самий WHEP, але вигнаним проксі відмовляє
    // (їхні сесії медіасервер бачить як localhost, тому за IP їх там не відрізнити).
    const whep = pathname.match(/^\/whep\/([\w-]{1,40})$/);
    if (whep && req.method === 'POST') {
      const id = q.get('id') || '';
      if (classroom.isBanned(id, ip)) json(res, 403, { ok: false, error: 'kicked' });
      else proxyRtc(req, res, whep[1], 'whep');
      return true;
    }

    // Голос учня наживо: WHIP-запит проходить сюди лише від того, кому вчитель дав слово,
    // і тільки в окремий потік `student-<клас>`, а не в потік самого уроку.
    const whip = pathname.match(/^\/whip\/([\w-]{1,40})$/);
    if (whip && req.method === 'POST') {
      const id = q.get('id');
      if (!C.validId(id) || !classroom.canSpeak(whip[1], id, ip)) {
        json(res, 403, { ok: false, error: 'Слово не надано' });
      } else {
        proxyRtc(req, res, `student-${whip[1]}`, 'whip');
      }
      return true;
    }

    return false;
  };
}

module.exports = { createApi };
