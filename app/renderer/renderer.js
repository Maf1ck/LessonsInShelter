const $ = (id) => document.getElementById(id);
let state = null;
let tick = null;

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

function renderChannels(s) {
  const box = $('channels');
  box.replaceChildren(
    ...s.channels.map((ch) => {
      const b = el('button', { className: 'chip', type: 'button' }, [el('b', { textContent: ch.name }), el('span', { textContent: ch.room || '' })]);
      b.setAttribute('aria-pressed', String(ch.id === s.settings.channel));
      b.disabled = s.status.phase !== 'idle' && s.status.phase !== 'error';
      b.onclick = () => window.shelter.saveSettings({ channel: ch.id });
      return b;
    }),
  );
}

function renderDevices(s) {
  const sel = $('device');
  const busy = s.status.phase !== 'idle' && s.status.phase !== 'error';
  sel.disabled = $('refresh').disabled = busy;
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
    btn.dataset.state = 'live';
    btn.textContent = 'Завершити урок';
    btn.disabled = false;
    if (phase === 'reconnecting') {
      hint.textContent = message;
      hint.classList.add('warn');
    } else {
      hint.textContent = 'Урок іде. Вікно можна згорнути.';
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

function renderSettings(s) {
  for (const id of ['autoStart', 'launchAtLogin', 'slow']) $(id).checked = !!s.settings[id];
  for (const id of ['wifiSsid', 'wifiPassword']) {
    if (document.activeElement !== $(id)) $(id).value = s.settings[id] || '';
  }
}

function render(s) {
  state = s;
  $('site').textContent = [s.site, s.subtitle].filter(Boolean).join(' · ');
  renderAlerts(s);
  renderChannels(s);
  renderDevices(s);
  renderMain(s);
  renderLive(s);
  renderSettings(s);

  clearInterval(tick);
  const startedAt = s.status.startedAt;
  const paint = () => ($('timer').textContent = startedAt ? mmss(Date.now() - startedAt) : '00:00');
  paint();
  if (startedAt) tick = setInterval(paint, 1000);
}

$('mainBtn').onclick = () => {
  const phase = state.status.phase;
  if (phase === 'live' || phase === 'reconnecting') window.shelter.stop();
  else window.shelter.start();
};
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
window.shelter.getState().then(render);
