const { app, BrowserWindow, Tray, Menu, ipcMain, shell, clipboard, powerSaveBlocker, nativeImage } = require('electron');
const QRCode = require('qrcode');
const path = require('path');

const paths = require('./lib/paths');
const settingsStore = require('./lib/settings');
const { getAddresses } = require('./lib/network');
const { createWebServer, listenOnFreePort } = require('./lib/webserver');
const { listMics } = require('./lib/devices');
const firewall = require('./lib/firewall');
const { Engine } = require('./lib/engine');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;
let tray = null;
let settings = null;
let channelsCfg = null;
let devices = [];
let webServer = null;
let webPort = 0;
let blockerId = null;
let quitting = false;
let busy = false; // йде підготовка до запуску (фаєрвол тощо)
let diag = { known: false, portsOk: true, publicNet: false, firewallDenied: false };
let links = { urls: [], qr: '', wifiQr: '' };
const engine = new Engine();
const pulses = new Map(); // id слухача -> { ch, at }
const PULSE_TTL_MS = 20000;

const isLive = () => engine.running;

function snapshot() {
  const status = busy && !engine.running
    ? { phase: 'starting', message: busy, listeners: 0, startedAt: 0, silent: false }
    : engine.status;
  return {
    settings,
    site: channelsCfg.site,
    subtitle: channelsCfg.subtitle,
    channels: channelsCfg.channels,
    devices,
    webPort,
    status,
    diag,
    links,
    toolsMissing: [paths.mediamtx, paths.ffmpeg].filter((f) => !require('fs').existsSync(f)).length > 0,
  };
}

const push = () => win && !win.isDestroyed() && win.webContents.send('state', snapshot());

const wifiEscape = (s) => String(s).replace(/([\\;,:"])/g, '\\$1');

async function rebuildLinks() {
  const addresses = getAddresses();
  const ch = settings.channel;
  const urls = addresses.map((a) => ({
    ip: a.ip,
    adapter: a.name,
    listen: `http://${a.ip}:${webPort}/listen.html?ch=${encodeURIComponent(ch)}`,
    home: `http://${a.ip}:${webPort}/`,
  }));
  const qrOpts = { type: 'svg', margin: 1, width: 220, color: { dark: '#12151a', light: '#ffffff' } };
  const qr = urls.length && ch ? await QRCode.toString(urls[0].listen, qrOpts) : '';
  const wifi = settings.wifiSsid
    ? `WIFI:T:${settings.wifiPassword ? 'WPA' : 'nopass'};S:${wifiEscape(settings.wifiSsid)};${
        settings.wifiPassword ? `P:${wifiEscape(settings.wifiPassword)};` : ''
      };`
    : '';
  const wifiQr = wifi ? await QRCode.toString(wifi, qrOpts) : '';
  links = { urls, qr, wifiQr };
}

async function refreshDevices() {
  devices = await listMics(paths.ffmpeg);
  // Запам'ятаний мікрофон зник - беремо єдиний/перший доступний, а не лишаємо порожнім.
  if (!devices.includes(settings.device)) {
    const usb = devices.find((d) => /usb|петличк|lav|wireless|fifine/i.test(d));
    settings.device = settings.device && devices.length === 0 ? settings.device : usb || devices[0] || '';
    settingsStore.save(settings);
  }
}

function setBlocker(on) {
  if (on && blockerId === null) blockerId = powerSaveBlocker.start('prevent-app-suspension');
  if (!on && blockerId !== null) {
    powerSaveBlocker.stop(blockerId);
    blockerId = null;
  }
}

async function startLesson() {
  if (isLive() || busy) return;
  if (!settings.channel) return engineError('Оберіть клас.');
  if (!settings.device) return engineError('Оберіть мікрофон. Якщо його немає у списку - підключіть і натисніть «Оновити».');

  busy = 'Перевіряю мережу…';
  push();
  try {
    diag = { ...diag, ...(await firewall.check(webPort)) };
    if (diag.known && !diag.portsOk) {
      busy = 'Дозвольте доступ у вікні Windows (потрібно один раз)…';
      push();
      diag.firewallDenied = !(await firewall.openPorts(webPort));
      diag = { ...diag, ...(await firewall.check(webPort)) };
    }
    await rebuildLinks();
    busy = false;
    await engine.start({
      device: settings.device,
      channel: settings.channel,
      bitrate: settings.bitrate,
      slow: settings.slow,
    });
  } finally {
    busy = false;
    push();
  }
}

function engineError(message) {
  engine.setStatus({ phase: 'error', message });
}

async function stopLesson() {
  await engine.stop();
  push();
}

function createWindow() {
  win = new BrowserWindow({
    width: 540,
    height: 860,
    minWidth: 440,
    minHeight: 640,
    backgroundColor: '#12151a',
    title: 'Lessons in Shelter',
    icon: paths.icon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Під час уроку хрестик згортає у трей, а не вбиває звук.
  win.on('close', (e) => {
    if (!quitting && isLive()) {
      e.preventDefault();
      win.hide();
      tray?.displayBalloon?.({
        title: 'Lessons in Shelter',
        content: 'Урок іде далі. Відкрити вікно - значок біля годинника.',
      });
    }
  });
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  win.show();
  win.focus();
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(paths.icon).resize({ width: 16, height: 16 }));
  tray.setToolTip('Lessons in Shelter');
  const rebuild = () =>
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Відкрити', click: showWindow },
        isLive()
          ? { label: 'Завершити урок', click: stopLesson }
          : { label: 'Почати урок', click: () => { showWindow(); startLesson(); } },
        { type: 'separator' },
        { label: 'Вийти', click: () => app.quit() },
      ]),
    );
  rebuild();
  engine.on('status', rebuild);
  tray.on('click', showWindow);
}

function registerIpc() {
  ipcMain.handle('state', () => snapshot());
  ipcMain.handle('start', () => startLesson());
  ipcMain.handle('stop', () => stopLesson());

  ipcMain.handle('settings', async (_e, patch) => {
    settings = { ...settings, ...patch };
    settingsStore.save(settings);
    if ('launchAtLogin' in patch) app.setLoginItemSettings({ openAtLogin: !!patch.launchAtLogin });
    await rebuildLinks();
    push();
  });

  ipcMain.handle('refreshDevices', async () => {
    await refreshDevices();
    push();
  });

  ipcMain.handle('copy', (_e, text) => clipboard.writeText(String(text)));
  ipcMain.handle('openChannelsFile', () => shell.openPath(settingsStore.ensureChannelsFile()));
  ipcMain.handle('reloadChannels', async () => {
    channelsCfg = settingsStore.loadChannels();
    push();
  });
  ipcMain.handle('openPoster', () => shell.openExternal(`http://127.0.0.1:${webPort}/print.html`));
  ipcMain.handle('fixNetwork', async () => {
    await firewall.makeNetworkPrivate();
    diag = { ...diag, ...(await firewall.check(webPort)) };
    push();
  });
}

app.on('second-instance', showWindow);

app.whenReady().then(async () => {
  settings = settingsStore.load();
  channelsCfg = settingsStore.loadChannels();
  if (!settings.channel && channelsCfg.channels[0]) settings.channel = channelsCfg.channels[0].id;

  webServer = createWebServer(paths.webDir, settingsStore.ensureChannelsFile(), (ch, id, bye) => {
    if (!ch || !id) return;
    if (bye) pulses.delete(id);
    else pulses.set(id, { ch, at: Date.now() });
  });
  engine.pulseCount = (ch) => {
    const fresh = Date.now() - PULSE_TTL_MS;
    let n = 0;
    for (const [id, p] of pulses) {
      if (p.at < fresh) pulses.delete(id);
      else if (p.ch === ch) n++;
    }
    return n;
  };
  try {
    webPort = await listenOnFreePort(webServer, settings.webPort);
  } catch (e) {
    webPort = 0;
  }

  registerIpc();
  engine.on('status', (s) => {
    setBlocker(s.phase !== 'idle');
    push();
  });
  engine.on('level', (v) => win && !win.isDestroyed() && win.webContents.send('level', v));

  createWindow();
  createTray();

  await refreshDevices();
  await rebuildLinks();
  push();

  // Режим "нуль кліків": відкрив застосунок - урок уже йде.
  if (settings.autoStart && settings.channel && settings.device) startLesson();
});

app.on('before-quit', () => {
  quitting = true;
  engine.killNow();
  webServer?.close();
});

app.on('window-all-closed', () => {
  if (!isLive()) app.quit();
});
