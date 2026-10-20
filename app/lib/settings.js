const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const paths = require('./paths');

const DEFAULTS = {
  channel: '',
  device: '',
  autoStart: false,   // починати урок одразу після відкриття застосунку
  launchAtLogin: false,
  slow: true,         // резервний AAC/HLS-потік для iPhone
  bitrate: 48,
  webPort: 8080,
  wifiSsid: '',
  wifiPassword: '',
};

const file = () => path.join(app.getPath('userData'), 'settings.json');
const channelsFile = () => path.join(app.getPath('userData'), 'channels.json');

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(settings) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(settings, null, 2));
}

// Список класів учитель може правити - тримаємо копію в профілі,
// щоб вона переживала оновлення застосунку.
function ensureChannelsFile() {
  const target = channelsFile();
  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(paths.webDir, 'channels.json'), target);
  }
  return target;
}

function loadChannels() {
  try {
    const cfg = JSON.parse(fs.readFileSync(ensureChannelsFile(), 'utf8'));
    return {
      site: cfg.site || '',
      subtitle: cfg.subtitle || '',
      channels: Array.isArray(cfg.channels) ? cfg.channels : [],
    };
  } catch {
    return { site: '', subtitle: '', channels: [] };
  }
}

module.exports = { load, save, loadChannels, ensureChannelsFile };
