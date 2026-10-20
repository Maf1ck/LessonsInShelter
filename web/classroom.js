// Клас на боці учня: імʼя перед входом, питання вчителю, голосова відповідь.
// Без бібліотек і CDN - сторінка працює в укритті без інтернету.
(function () {
  var NAME_MIN = 2, NAME_MAX = 20, TEXT_MAX = 200, REC_MAX_MS = 30000;
  var params = new URLSearchParams(location.search);
  var ch = params.get('ch') || '';

  function $(id) { return document.getElementById(id); }
  function store(key, val) {
    try {
      if (val === undefined) return sessionStorage.getItem(key) || localStorage.getItem(key) || '';
      localStorage.setItem(key, val);
      sessionStorage.setItem(key, val);
    } catch (e) {}
    return val || '';
  }

  // Той самий набір символів, що й на сервері: літери, цифри, пробіл, дефіс, апостроф, крапка.
  function cleanName(s) {
    s = String(s || '');
    try { s = s.replace(/[^\p{L}\p{N} \-'’ʼ.]/gu, ''); }
    catch (e) { s = s.replace(/[<>&"`\\\/\u0000-\u001f]/g, ''); }
    s = s.replace(/\s+/g, ' ').replace(/^\s+/, '');
    return Array.from(s).slice(0, NAME_MAX).join('');
  }

  var id = store('shelter.id') || (Math.random().toString(36).slice(2, 10) + Date.now().toString(36)).replace(/[^a-z0-9]/g, '');
  store('shelter.id', id);

  var name = cleanName(params.get('name') || store('shelter.name')).trim();
  if (name.length < NAME_MIN) name = '';

  var since = 0, pollTimer = null, httpsPort = 0, floorOn = false, kicked = false;
  var pulse = null;

  function ping(bye) {
    if (!ch || kicked) return;
    var url = 'ping?ch=' + encodeURIComponent(ch) + '&id=' + id + '&name=' + encodeURIComponent(name) + (bye ? '&bye=1' : '');
    try {
      if (bye && navigator.sendBeacon) navigator.sendBeacon(url);
      else fetch(url, { cache: 'no-store' }).catch(function () {});
    } catch (e) {}
  }

  // Пульс: поки звук іде, раз на кілька секунд повідомляємо серверу, що ми тут.
  function setPulse(on) {
    if (on && !pulse) { ping(); pulse = setInterval(ping, 7000); }
    if (!on && pulse) { clearInterval(pulse); pulse = null; ping(true); }
  }
  window.addEventListener('pagehide', function () { setPulse(false); });

  // ---- імʼя ----
  var gate = $('nameGate'), nameInput = $('nameInput'), nameOk = $('nameOk');

  function showGate() {
    document.body.classList.add('need-name');
    gate.hidden = false;
    nameInput.value = name;
    syncGate();
  }

  function syncGate() {
    var v = cleanName(nameInput.value);
    if (v !== nameInput.value) nameInput.value = v;
    nameOk.disabled = v.trim().length < NAME_MIN;
    $('nameCount').textContent = Array.from(v).length + ' / ' + NAME_MAX;
  }

  function applyName() {
    $('who').textContent = name;
    $('chatbox').hidden = false;
    gate.hidden = true;
    document.body.classList.remove('need-name');
    startPolling();
  }

  if (gate) {
    nameInput.addEventListener('input', syncGate);
    gate.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = cleanName(nameInput.value).trim();
      if (v.length < NAME_MIN) return;
      name = v;
      store('shelter.name', name);
      if (pulse) ping();
      applyName();
    });
    $('renameLink').addEventListener('click', function (e) {
      e.preventDefault();
      stopPolling();
      $('chatbox').hidden = true;
      showGate();
    });
    if (name) applyName(); else showGate();
  }

  // ---- чат ----
  var log = $('chatLog'), input = $('chatInput'), note = $('chatNote');

  function addLine(m) {
    var div = document.createElement('div');
    div.className = 'cl ' + (m.from === 'teacher' ? 'teacher' : 'me');
    var b = document.createElement('b');
    b.textContent = m.from === 'teacher' ? 'Вчитель' : 'Ти';
    div.appendChild(b);
    div.appendChild(document.createTextNode(m.text));
    var stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.appendChild(div);
    if (stick) log.scrollTop = log.scrollHeight;
  }

  function poll() {
    fetch('chat/poll?ch=' + encodeURIComponent(ch) + '&id=' + id + '&since=' + since + '&name=' + encodeURIComponent(name), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.kicked) return gotKicked();
        (d.messages || []).forEach(addLine);
        since = Math.max(since, d.last || 0);
        input.disabled = $('chatSend').disabled = !d.chat;
        note.textContent = d.chat ? '' : 'Вчитель вимкнув чат';
        setFloor(!!d.floor);
      })
      .catch(function () {});
  }

  // Вчитель вигнав з уроку: зупиняємо все і показуємо повідомлення.
  function gotKicked() {
    if (kicked) return;
    kicked = true;
    stopPolling();
    stopTalk();
    setPulse(false);
    document.body.classList.add('kicked');
    $('kickedBox').hidden = false;
    try { window.dispatchEvent(new Event('shelter:kicked')); } catch (e) {}
  }

  function startPolling() {
    stopPolling();
    poll();
    pollTimer = setInterval(poll, 2500);
  }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

  $('chatForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = Array.from(input.value.replace(/\s+/g, ' ').trim()).slice(0, TEXT_MAX).join('');
    if (!text) return;
    $('chatSend').disabled = true;
    fetch('chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ch: ch, id: id, name: name, text: text })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) { input.value = ''; note.textContent = ''; poll(); }
        else note.textContent = d.error || 'Не вдалося надіслати';
      })
      .catch(function () { note.textContent = 'Немає зв’язку з сервером'; })
      .then(function () { $('chatSend').disabled = false; });
  });

  // ---- слово і голосова відповідь ----
  var floorBox = $('floor'), floorBtn = $('floorBtn'), floorNote = $('floorNote');
  var talk = null;   // { pc, stream } поки учень говорить
  var canRecord = !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.RTCPeerConnection);

  fetch('info', { cache: 'no-store' }).then(function (r) { return r.json(); })
    .then(function (d) { httpsPort = d.httpsPort || 0; }).catch(function () {});

  function idleFloorUi() {
    floorBtn.classList.remove('rec');
    floorBtn.disabled = false;
    if (canRecord) {
      floorBtn.hidden = false;
      floorBtn.textContent = 'Увімкнути мікрофон';
      floorNote.textContent = 'Вчитель дав тобі слово. Натисни кнопку і говори - вчитель тебе чує.';
    } else if (httpsPort && location.protocol !== 'https:') {
      floorBtn.hidden = false;
      floorBtn.textContent = 'Відкрити для голосу';
      floorNote.textContent = 'Телефон покаже попередження про сертифікат: обери «Додатково» → «Все одно перейти». Це безпечно, сервер у цій самій мережі.';
    } else {
      floorBtn.hidden = true;
      floorNote.textContent = 'Цей браузер не може увімкнути мікрофон. Напиши питання в чаті.';
    }
  }

  function setFloor(on) {
    if (on === floorOn) return;
    floorOn = on;
    floorBox.hidden = !on;
    if (on) {
      if (navigator.vibrate) try { navigator.vibrate(200); } catch (e) {}
      idleFloorUi();
    } else if (talk) {
      stopTalk();
    }
  }

  function waitIce(pc, ms) {
    return new Promise(function (resolve) {
      if (pc.iceGatheringState === 'complete') return resolve();
      var t = setTimeout(resolve, ms);
      pc.addEventListener('icegatheringstatechange', function () {
        if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); }
      });
    });
  }

  // Голос іде наживо: WebRTC (WHIP) на сервер, вчитель чує одразу, без запису.
  function startTalk() {
    floorBtn.disabled = true;
    floorNote.textContent = 'Вмикаю мікрофон…';
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then(function (stream) {
        var pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
        talk = { pc: pc, stream: stream };
        stream.getTracks().forEach(function (t) { pc.addTrack(t, stream); });
        pc.onconnectionstatechange = function () {
          if (!talk || talk.pc !== pc) return;
          if (pc.connectionState === 'connected') {
            floorBtn.disabled = false;
            floorBtn.classList.add('rec');
            floorBtn.textContent = 'Вимкнути мікрофон';
            floorNote.textContent = 'Ти говориш - вчитель тебе чує.';
          } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
            stopTalk();
            floorNote.textContent = 'Звʼязок перервався. Натисни ще раз.';
          }
        };
        return pc.createOffer()
          .then(function (o) { return pc.setLocalDescription(o); })
          .then(function () { return waitIce(pc, 1500); })
          .then(function () {
            return fetch('whip/' + encodeURIComponent(ch) + '?id=' + id, {
              method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: pc.localDescription.sdp
            });
          })
          .then(function (res) {
            if (!res.ok) throw new Error(res.status === 403 ? 'floor' : 'http');
            return res.text();
          })
          .then(function (sdp) { if (talk && talk.pc === pc) return pc.setRemoteDescription({ type: 'answer', sdp: sdp }); });
      })
      .catch(function (err) {
        var denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
        stopTalk();
        floorNote.textContent = denied ? 'Не вдалося увімкнути мікрофон. Дозволь доступ у браузері.'
          : (err && err.message === 'floor' ? 'Вчитель забрав слово.' : 'Не вдалося підключитись до вчителя.');
      });
  }

  function stopTalk() {
    if (talk) {
      try { talk.pc.close(); } catch (e) {}
      talk.stream.getTracks().forEach(function (t) { t.stop(); });
      talk = null;
    }
    if (floorOn) idleFloorUi();
  }

  floorBtn.addEventListener('click', function () {
    if (!canRecord) {
      if (httpsPort) location.href = 'https://' + location.hostname + ':' + httpsPort + '/listen.html?ch=' + encodeURIComponent(ch) + '&name=' + encodeURIComponent(name);
      return;
    }
    if (talk) { stopTalk(); floorNote.textContent = 'Мікрофон вимкнено.'; } else startTalk();
  });

  window.ShelterClass = { setPulse: setPulse, channel: ch, id: id };
})();
