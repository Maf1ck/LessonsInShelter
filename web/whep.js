/*
 * Мінімальний WHEP-клієнт (WebRTC-HTTP Egress Protocol) для MediaMTX.
 *
 * Навмисно без бібліотек і без CDN: усе має працювати в мережі без інтернету.
 * ICE-сервери не задаємо — сервер і телефон в одній локальній мережі,
 * тому вистачає host-кандидатів.
 */

function WhepPlayer(opts) {
  this.url = opts.url;                 // http://10.0.0.1:8889/klas-5a/whep
  this.audio = opts.audio;             // <audio> елемент
  this.onState = opts.onState || function () {};
  this.pc = null;
  this.stopped = true;
  this.retry = 0;
  this.retryTimer = null;
}

WhepPlayer.prototype.start = function () {
  this.stopped = false;
  this.retry = 0;
  this._connect();
};

WhepPlayer.prototype.stop = function () {
  this.stopped = true;
  clearTimeout(this.retryTimer);
  this._teardown();
  this.onState('idle');
};

WhepPlayer.prototype._teardown = function () {
  if (this.pc) {
    try { this.pc.close(); } catch (e) {}
    this.pc = null;
  }
  if (this.audio) this.audio.srcObject = null;
};

WhepPlayer.prototype._scheduleRetry = function (message) {
  if (this.stopped) return;
  this._teardown();
  this.retry++;
  var delay = Math.min(1000 * this.retry, 6000);
  this.onState('connecting', message || 'Перепідключення…');
  var self = this;
  clearTimeout(this.retryTimer);
  this.retryTimer = setTimeout(function () { self._connect(); }, delay);
};

WhepPlayer.prototype._connect = function () {
  var self = this;
  if (this.stopped) return;
  this.onState('connecting', this.retry ? 'Перепідключення…' : 'Підключення…');

  var pc;
  try {
    pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
  } catch (e) {
    this.onState('error', 'Браузер не підтримує WebRTC');
    return;
  }
  this.pc = pc;

  pc.addTransceiver('audio', { direction: 'recvonly' });

  pc.ontrack = function (ev) {
    if (self.audio.srcObject !== ev.streams[0]) {
      self.audio.srcObject = ev.streams[0];
    }
    var p = self.audio.play();
    if (p && p.catch) {
      p.catch(function () { self.onState('error', 'Натисни кнопку ще раз'); });
    }
  };

  pc.onconnectionstatechange = function () {
    if (self.pc !== pc) return;
    if (pc.connectionState === 'connected') {
      self.retry = 0;
      self.onState('live');
    } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      self._scheduleRetry('Зв\'язок обірвався, відновлюю…');
    }
  };

  pc.createOffer()
    .then(function (offer) { return pc.setLocalDescription(offer); })
    .then(function () { return waitForIce(pc, 1500); })
    .then(function () {
      return fetch(self.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: pc.localDescription.sdp
      });
    })
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    })
    .then(function (sdp) {
      if (self.pc !== pc) return;
      return pc.setRemoteDescription({ type: 'answer', sdp: sdp });
    })
    .catch(function (err) {
      var msg = 'Сервер недоступний';
      if (err && String(err.message).indexOf('404') >= 0) msg = 'Урок ще не почався';
      self._scheduleRetry(msg);
    });
};

/* Не використовуємо trickle ICE: чекаємо кандидатів і шлемо один SDP. */
function waitForIce(pc, timeoutMs) {
  return new Promise(function (resolve) {
    if (pc.iceGatheringState === 'complete') return resolve();
    var done = false;
    var finish = function () {
      if (done) return;
      done = true;
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    var check = function () {
      if (pc.iceGatheringState === 'complete') finish();
    };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(finish, timeoutMs);
  });
}
