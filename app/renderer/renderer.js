const $ = (id) => document.getElementById(id);
let state = null;
let tick = null;
let confirmStop = false;
let confirmTimer = null;
let announced = false;       // сигнал "урок пішов" уже прозвучав
let replyTo = null;          // { id, name } - відповідь конкретному учню
let lastChatKey = '';
const armedKick = new Map();   // id -> таймер: «Вигнати» натиснуто один раз
const rxAudio = new Audio();   // живий голос учня, якому дали слово
const rx = { want: null, pc: null, timer: null, speaking: false };

const mmss = (ms) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return (h ? `${h}:` : '') + `${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

// Короткі сигнали на WebAudio: без файлів, працює офлайн.
let audioCtx = null;
function tones(freqs, dur = 0.13, vol = 0.22) {
  try {
    audioCtx = audioCtx || new AudioContext();
    let t = audioCtx.currentTime;
    for (const f of freqs) {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(audioCtx.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
      t += dur;
    }
  } catch {
    /* звук недоступний - не страшно */
  }
}

const isBusyPhase = (s) => s.status.phase !== 'idle' && s.status.phase !== 'error';

function renderChannels(s) {
  const box = $('channels');
  box.replaceChildren(
    ...s.channels.map((ch) => {
      const b = el('button', { className: 'chip', type: 'button' }, [el('b', { textContent: ch.name }), el('span', { textContent: ch.room || '' })]);
      b.setAttribute('aria-pressed', String(ch.id === s.settings.channel));
      b.disabled = isBusyPhase(s);
      b.onclick = () => window.shelter.saveSettings({ channel: ch.id });
      return b;
    }),
  );
}

function renderDevices(s) {
  const sel = $('device');
  sel.disabled = $('refresh').disabled = isBusyPhase(s);
  const options = s.devices.length ? s.devices : ['Мікрофонів не знайдено'];
  sel.replaceChildren(...options.map((d) => el('option', { value: s.devices.length ? d : '', textContent: d })));
  sel.value = s.settings.device;
}

function renderAlerts(s) {
  const items = [];
  if (s.toolsMissing) {
    items.push(el('div', { className: 'alert err' }, [el('span', { textContent: 'Немає mediamtx.exe або ffmpeg.exe у папці server\\bin. Запустіть server\\win\\download-tools.ps1.' })]));
  }
  if (!s.webPort) {
    items.push(el('div', { className: 'alert err' }, [el('span', { textContent: 'Не вдалося відкрити порт для сторінки. Закрийте програми, що займають порти 8080-8100.' })]));
  }
  if (s.diag.firewallDenied && !s.diag.portsOk) {
    items.push(el('div', { className: 'alert' }, [el('span', { textContent: 'Доступ у мережі не дозволено - телефони можуть не побачити сервер. Натисніть «Почати урок» ще раз і погодьтесь у вікні Windows.' })]));
  }
  if (s.diag.publicNet) {
    const btn = el('button', { type: 'button', textContent: 'Виправити' });
    btn.onclick = () => window.shelter.fixNetwork();
    items.push(el('div', { className: 'alert' }, [el('span', { textContent: 'Мережа Windows позначена як «публічна» - телефони можуть не підключитись.' }), btn]));
  }
  $('alerts').replaceChildren(...items);
}

function renderMain(s) {
  const { phase, message } = s.status;
  const btn = $('mainBtn');
  const hint = $('hint');
  hint.className = 'hint';

  if (phase !== 'live' && phase !== 'reconnecting') confirmStop = false;

  if (phase === 'idle' || phase === 'error') {
    btn.dataset.state = 'idle';
    btn.textContent = 'Почати урок';
    btn.disabled = s.toolsMissing || !s.webPort;
    hint.textContent = message || (s.settings.channel && s.settings.device ? 'Усе готово - один клік.' : 'Оберіть клас і мікрофон.');
    if (phase === 'error') hint.classList.add('err');
  } else if (phase === 'starting') {
    btn.dataset.state = 'busy';
    btn.textContent = 'Запускаю…';
    btn.disabled = true;
    hint.textContent = message;
  } else {
    btn.disabled = false;
    btn.dataset.state = confirmStop ? 'confirm' : 'live';
    btn.textContent = confirmStop ? 'Точно завершити? Натисніть ще раз' : 'Завершити урок';
    if (phase === 'reconnecting') {
      hint.textContent = message;
      hint.classList.add('warn');
    } else {
      hint.textContent = s.status.muted ? 'Мікрофон вимкнено.' : 'Урок іде. Вікно можна згорнути.';
    }
  }
}

function renderLive(s) {
  const { phase } = s.status;
  const show = phase === 'live' || phase === 'reconnecting' || (phase === 'starting' && s.links.qr);
  const panel = $('live');
  panel.hidden = !show;
  panel.dataset.phase = phase;
  if (!show) return;

  $('listeners').textContent = s.status.listeners;
  $('qr').innerHTML = s.links.qr;
  $('wifiQr').innerHTML = s.links.wifiQr;
  $('wifiBlock').hidden = !s.links.wifiQr;

  const muted = !!s.status.muted;
  const micLabel = muted ? 'Увімкнути мікрофон' : 'Вимкнути мікрофон';
  $('mute').setAttribute('aria-pressed', String(muted));
  $('mute').setAttribute('aria-label', micLabel);
  $('mute').title = micLabel;
  $('mutedBanner').hidden = !muted;

  const note = $('meterNote');
  note.classList.toggle('warn', s.status.silent);
  note.textContent = s.status.silent
    ? 'Мікрофон мовчить уже 20 секунд - перевірте, чи ввімкнена петличка'
    : 'Говоріть - смужка має рухатись';

  $('urls').replaceChildren(
    ...s.links.urls.map((u) => {
      const copy = el('button', { className: 'ghost', type: 'button', textContent: 'Копіювати' });
      copy.onclick = async () => {
        await window.shelter.copy(u.listen);
        copy.textContent = 'Скопійовано';
        setTimeout(() => (copy.textContent = 'Копіювати'), 1500);
      };
      return el('div', { className: 'url', title: u.adapter }, [el('code', { textContent: u.listen }), copy]);
    }),
  );
}

function renderClassroom(s) {
  const live = s.status.phase === 'live' || s.status.phase === 'reconnecting';
  $('classroom').hidden = !live;
  if (!live) return;

  const c = s.classroom;
  $('studentsLabel').textContent = `Учні (${c.students.length})`;
  if (document.activeElement !== $('chatOpen')) $('chatOpen').checked = c.chatOpen;

  $('students').replaceChildren(
    ...(c.students.length
      ? c.students.map((st) => {
          const has = c.floor === st.id;
          const btn = el('button', { className: 'ghost' + (has ? ' on' : ''), type: 'button', textContent: has ? 'Забрати слово' : 'Дати слово' });
          btn.onclick = () => (has ? window.shelter.takeFloor() : window.shelter.giveFloor(st.id));

          // «Вигнати» - двома натисканнями, щоб не вигнати випадково.
          const armed = armedKick.has(st.id);
          const kick = el('button', { className: 'ghost danger' + (armed ? ' armed' : ''), type: 'button', textContent: armed ? 'Точно?' : 'Вигнати' });
          kick.onclick = () => {
            if (armedKick.has(st.id)) {
              clearTimeout(armedKick.get(st.id));
              armedKick.delete(st.id);
              window.shelter.kick(st.id);
            } else {
              armedKick.set(st.id, setTimeout(() => { armedKick.delete(st.id); lastChatKey = ''; if (state) renderClassroom(state); }, 3000));
              renderClassroom(state);
            }
          };
          const talking = has && rx.speaking;
          return el('div', { className: 'student' + (has ? ' has-floor' : '') }, [
            el('span', { className: 'name', textContent: st.name }),
            el('span', { className: 'state' + (st.listening || talking ? ' on' : ''), textContent: talking ? 'говорить' : st.listening ? 'слухає' : 'на сторінці' }),
            btn,
            kick,
          ]);
        })
      : [el('div', { className: 'empty', textContent: 'Поки ніхто не слухає. Діти зʼявляться тут, коли введуть імʼя і натиснуть «Слухати».' })]),
  );

  const bannedBox = $('banned');
  bannedBox.hidden = !c.banned.length;
  bannedBox.replaceChildren(
    ...(c.banned.length ? [document.createTextNode('Вигнані:')] : []),
    ...c.banned.map((b) => {
      const back = el('button', { type: 'button', textContent: b.name + ' — повернути' });
      back.onclick = () => window.shelter.unban(b.id);
      return back;
    }),
  );

  const talker = c.floor ? c.students.find((st) => st.id === c.floor) : null;
  $('speaking').hidden = !talker;
  if (talker) {
    $('speaking').textContent = rx.speaking
      ? talker.name + ' говорить - ви чуєте учня'
      : talker.name + ' має слово. Чекаю, поки учень увімкне мікрофон…';
  }

  // Чат перемальовуємо лише коли щось змінилось, щоб не збивати прокрутку.
  const key = c.messages.map((m) => m.n).join(',') + '|' + c.students.map((st) => st.id + st.name).join(',');
  if (key !== lastChatKey) {
    lastChatKey = key;
    const box = $('chat');
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    box.replaceChildren(
      ...c.messages.map((m) => {
        if (m.from === 'teacher') {
          const who = m.to ? `Вчитель → ${(c.students.find((x) => x.id === m.to) || {}).name || 'учню'}` : 'Вчитель → всім';
          return el('div', { className: 'msg teacher' }, [el('b', { textContent: who }), document.createTextNode(m.text)]);
        }
        const node = el('div', { className: 'msg' }, [el('b', { textContent: m.name }), document.createTextNode(m.text)]);
        node.append(el('button', { className: 'ghost', type: 'button', textContent: 'Відповісти', onclick: () => { replyTo = { id: m.id, name: m.name }; renderReplying(); $('replyText').focus(); } }));
        return node;

      }),
    );
    if (nearBottom) box.scrollTop = box.scrollHeight;
  }
}

// Живий голос учня: WHEP до локального медіасервера, потік student-<клас>.
function stopRx() {
  clearTimeout(rx.timer);
  if (rx.pc) {
    try { rx.pc.close(); } catch { /* вже закрито */ }
    rx.pc = null;
  }
  rxAudio.srcObject = null;
  if (rx.speaking) {
    rx.speaking = false;
    if (state) renderClassroom(state);
  }
}

function connectRx(channel) {
  if (!rx.want || rx.want.split('|')[0] !== channel) return;
  const retry = (ms) => { rx.timer = setTimeout(() => connectRx(channel), ms); };
  const pc = new RTCPeerConnection({ iceServers: [] });
  rx.pc = pc;
  pc.addTransceiver('audio', { direction: 'recvonly' });
  pc.ontrack = (e) => {
    rxAudio.srcObject = e.streams[0];
    rxAudio.play().catch(() => {});
  };
  pc.onconnectionstatechange = () => {
    if (rx.pc !== pc) return;
    if (pc.connectionState === 'connected') {
      rx.speaking = true;
      if (state) renderClassroom(state);
    } else if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
      stopRx();
      retry(1000);
    }
  };
  pc.createOffer()
    .then((o) => pc.setLocalDescription(o))
    .then(() => new Promise((res) => {
      if (pc.iceGatheringState === 'complete') return res();
      const t = setTimeout(res, 1200);
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); }
      };
    }))
    .then(() => fetch('http://127.0.0.1:8889/student-' + encodeURIComponent(channel) + '/whep', {
      method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: pc.localDescription.sdp,
    }))
    .then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res.text();
    })
    .then((sdp) => (rx.pc === pc ? pc.setRemoteDescription({ type: 'answer', sdp }) : null))
    .catch(() => {
      // Учень ще не почав говорити (404) - пробуємо знову.
      if (rx.pc === pc) { stopRx(); retry(1000); }
    });
}

function syncStudentAudio(s) {
  const liveNow = s.status.phase === 'live' || s.status.phase === 'reconnecting';
  const want = s.classroom.floor && liveNow ? s.settings.channel + '|' + s.classroom.floor : null;
  if (want === rx.want) return;
  stopRx();
  rx.want = want;
  if (want) connectRx(want.split('|')[0]);
}

function renderReplying() {
  const box = $('replying');
  box.hidden = !replyTo;
  if (!replyTo) return;
  const cancel = el('button', { type: 'button', textContent: '✕', title: 'Відповісти всім' });
  cancel.onclick = () => { replyTo = null; renderReplying(); };
  box.replaceChildren(document.createTextNode(`Відповідь для: ${replyTo.name}`), cancel);
}

function renderSettings(s) {
  for (const id of ['autoStart', 'launchAtLogin', 'slow']) $(id).checked = !!s.settings[id];
  for (const id of ['wifiSsid', 'wifiPassword']) {
    if (document.activeElement !== $(id)) $(id).value = s.settings[id] || '';
  }
}

function render(s) {
  const prev = state;
  state = s;

  // Сигнали: "урок пішов" - один раз за урок, коли звук справді пішов; інший - коли урок завершено.
  if (s.status.phase === 'live' && !announced) {
    announced = true;
    tones([660, 880, 1100]);
  }
  if (s.status.phase === 'idle' && announced) {
    announced = false;
    tones([880, 660, 440]);
  }
  if (prev && prev.status.phase === 'live' && s.status.phase === 'reconnecting') tones([440, 440], 0.18, 0.18);

  $('site').textContent = [s.site, s.subtitle].filter(Boolean).join(' · ');
  renderAlerts(s);
  renderChannels(s);
  renderDevices(s);
  renderMain(s);
  renderLive(s);
  syncStudentAudio(s);
  renderClassroom(s);
  renderSettings(s);

  clearInterval(tick);
  const startedAt = s.status.startedAt;
  const paint = () => ($('timer').textContent = startedAt ? mmss(Date.now() - startedAt) : '00:00');
  paint();
  if (startedAt) tick = setInterval(paint, 1000);
}

$('mainBtn').onclick = () => {
  const phase = state.status.phase;
  if (phase !== 'live' && phase !== 'reconnecting') return window.shelter.start();

  // Захист від випадкового кліку: завершення лише другим натисканням упродовж 4 секунд.
  if (confirmStop) {
    clearTimeout(confirmTimer);
    confirmStop = false;
    return window.shelter.stop();
  }
  confirmStop = true;
  renderMain(state);
  clearTimeout(confirmTimer);
  confirmTimer = setTimeout(() => {
    confirmStop = false;
    if (state) renderMain(state);
  }, 4000);
};

$('mute').onclick = () => window.shelter.mute(!state.status.muted);
$('chatOpen').onchange = (e) => window.shelter.setChatOpen(e.target.checked);

function sendReply() {
  const text = $('replyText').value.trim();
  if (!text) return;
  window.shelter.reply(text, replyTo ? replyTo.id : null);
  $('replyText').value = '';
  replyTo = null;
  renderReplying();
}
$('replyBtn').onclick = sendReply;
$('replyText').onkeydown = (e) => { if (e.key === 'Enter') sendReply(); };

$('device').onchange = (e) => window.shelter.saveSettings({ device: e.target.value });
$('refresh').onclick = () => window.shelter.refreshDevices();
$('poster').onclick = () => window.shelter.openPoster();
$('editChannels').onclick = () => window.shelter.openChannelsFile();
$('reloadChannels').onclick = () => window.shelter.reloadChannels();

for (const id of ['autoStart', 'launchAtLogin', 'slow']) {
  $(id).onchange = (e) => window.shelter.saveSettings({ [id]: e.target.checked });
}
for (const id of ['wifiSsid', 'wifiPassword']) {
  $(id).onchange = (e) => window.shelter.saveSettings({ [id]: e.target.value.trim() });
}

window.shelter.onState(render);
window.shelter.onLevel((v) => ($('meter').style.width = `${Math.round(v * 100)}%`));
window.shelter.onQuestion(() => tones([1040], 0.1, 0.12));
window.shelter.getState().then(render);
