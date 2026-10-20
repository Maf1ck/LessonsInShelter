const { execFile } = require('child_process');
const paths = require('./paths');

const ps = (command, timeout = 15000) =>
  new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true, timeout },
      (err, stdout) => resolve({ ok: !err, out: String(stdout || '') }),
    );
  });

// Запускає PowerShell-скрипт з підвищенням прав (одне вікно UAC).
function elevated(script, timeout = 120000) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return ps(
    `Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}'`,
    timeout,
  );
}

// Які порти вже відкриті правилами проєкту і чи не "публічна" Wi-Fi мережа.
async function check(webPort, httpsPort) {
  const { ok, out } = await ps(
    "Get-NetFirewallRule -DisplayName 'Lessons in Shelter*' -ErrorAction SilentlyContinue | Get-NetFirewallPortFilter | ForEach-Object { $_.Protocol + ':' + $_.LocalPort };" +
      "Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.IPv4Connectivity -ne 'Disconnected' } | ForEach-Object { 'NET:' + $_.NetworkCategory }",
  );
  if (!ok) return { known: false, portsOk: true, publicNet: false };

  const lines = out.split(/\r?\n/).map((l) => l.trim());
  const need = [`TCP:${webPort}`, 'TCP:8889', 'UDP:8189', 'TCP:8888'];
  if (httpsPort) need.push(`TCP:${httpsPort}`);
  return {
    known: true,
    portsOk: need.every((n) => lines.includes(n)),
    publicNet: lines.includes('NET:Public'),
  };
}

// Той самий allow-firewall.ps1, що й у ручній інструкції.
async function openPorts(webPort, httpsPort) {
  const p = paths.firewallScript.replace(/'/g, "''");
  const r = await elevated(`& '${p}' -WebPort ${Number(webPort)} -HttpsPort ${Number(httpsPort) || 8443}`);
  return r.ok;
}

async function makeNetworkPrivate() {
  const r = await elevated(
    "Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq 'Public' } | Set-NetConnectionProfile -NetworkCategory Private",
  );
  return r.ok;
}

module.exports = { check, openPorts, makeNetworkPrivate };
