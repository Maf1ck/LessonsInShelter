const { execFile } = require('child_process');

// Мікрофони, які бачить ffmpeg (DirectShow). Підтримує і новий формат
// `"Назва" (audio)`, і старий з розділом "DirectShow audio devices".
function listMics(ffmpeg) {
  return new Promise((resolve) => {
    execFile(
      ffmpeg,
      ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'],
      { windowsHide: true, timeout: 8000, encoding: 'utf8' },
      (_err, stdout, stderr) => {
        // На "dummy" ffmpeg завжди завершується з помилкою - це нормально.
        const text = `${stdout}\n${stderr}`;
        const names = [];

        for (const m of text.matchAll(/"([^"]+)"\s+\(audio\)/g)) names.push(m[1]);

        if (!names.length) {
          let inAudio = false;
          for (const line of text.split(/\r?\n/)) {
            if (/DirectShow audio devices/i.test(line)) inAudio = true;
            else if (/DirectShow video devices/i.test(line)) inAudio = false;
            else if (inAudio && !/Alternative name/i.test(line)) {
              const m = line.match(/"([^"]+)"/);
              if (m) names.push(m[1]);
            }
          }
        }
        resolve([...new Set(names)]);
      },
    );
  });
}

module.exports = { listMics };
