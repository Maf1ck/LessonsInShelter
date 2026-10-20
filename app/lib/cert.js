const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');

const MAX_AGE_MS = 300 * 24 * 3600 * 1000;

// Самопідписаний сертифікат для HTTPS-версії сторінки: тільки на HTTPS браузер дає
// доступ до мікрофона учня. Телефон один раз покаже попередження - його треба прийняти.
async function getCertificate(ips) {
  const file = path.join(app.getPath('userData'), 'https-cert.json');
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Date.now() - saved.at < MAX_AGE_MS && ips.every((ip) => saved.ips.includes(ip))) return saved;
  } catch {
    /* немає збереженого - створимо */
  }

  const altNames = [{ type: 2, value: 'localhost' }, ...ips.map((ip) => ({ type: 7, ip }))];
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'lessons-in-shelter' }], {
    days: 365,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames }],
  });
  const out = { at: Date.now(), ips, key: pems.private, cert: pems.cert };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out));
  return out;
}

module.exports = { getCertificate };
