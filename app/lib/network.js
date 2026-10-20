const os = require('os');
const net = require('net');

const VIRTUAL = /vethernet|virtualbox|vmware|hyper-v|wsl|docker|loopback|vpn|tailscale|zerotier|bluetooth|vbox/i;
const WIFI = /wi-?fi|wlan|wireless|бездрот/i;

// IPv4-адреси, які реально можуть бачити телефони (без віртуальних адаптерів).
function getAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL.test(name)) continue;
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      out.push({ name, ip: a.address });
    }
  }
  return out.sort((a, b) => Number(WIFI.test(b.name)) - Number(WIFI.test(a.name)));
}

function isPortOpen(port, host = '127.0.0.1', timeout = 400) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    const done = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(timeout, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

async function waitForPort(port, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await isPortOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

module.exports = { getAddresses, isPortOpen, waitForPort };
