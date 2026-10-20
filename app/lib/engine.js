const { app } = require('electron');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const { isPortOpen, waitForPort } = require('./network');

const API_PORT = 9997;
const FILTER_BASE = 'highpass=f=90,acompressor=threshold=-18dB:ratio=3:attack=10:release=200,alimiter=limit=0.95';
const filterFor = (muted) => `volume@m=${muted ? 0 : 1},${FILTER_BASE}`;
const SILENCE_DB = -55;
const SILENCE_AFTER_MS = 20000;

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  } catch {
    child.kill();
  }
}

// Один урок = медіасервер (MediaMTX) + ffmpeg, що знімає мікрофон.
// Те саме, що робили start-server.ps1 і start-mic.ps1, але під керуванням застосунку.
class Engine extends EventEmitter {
  constructor() {
    super();
    this.mtx = null;
    this.ffmpeg = null;
    this.timer = null;
    this.retry = null;
    this.running = false;
    this.opts = null;
    this.muted = false;
    this.lastLoudAt = 0;
    this.lastLevelEmit = 0;
    this.status = this.idle();
  }

  idle() {
    return { phase: 'idle', message: '', listeners: 0, startedAt: 0, silent: false, muted: false };
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.emit('status', this.status);
  }

  async start(opts) {
    if (this.running) return;
    this.running = true;
    this.opts = opts;
    this.muted = false;
    this.status = { ...this.idle(), phase: 'starting', message: 'Запускаю медіасервер…', startedAt: Date.now() };
    this.emit('status', this.status);

    try {
      await this.startMediaServer();
      this.setStatus({ message: 'Вмикаю мікрофон…' });
      this.spawnFfmpeg();
      this.timer = setInterval(() => this.poll(), 1500);
    } catch (e) {
      await this.stop();
      this.setStatus({ phase: 'error', message: e.message });
    }
  }

  async startMediaServer() {
    if (!fs.existsSync(paths.mediamtx)) throw new Error('Не знайдено mediamtx.exe (папка server\\bin).');
    if (!fs.existsSync(paths.ffmpeg)) throw new Error('Не знайдено ffmpeg.exe (папка server\\bin).');

    // Залишок від аварійно закритого попереднього запуску.
    if (await isPortOpen(8554)) {
      await new Promise((r) => spawn('taskkill', ['/IM', 'mediamtx.exe', '/F'], { windowsHide: true }).on('exit', r));
      await new Promise((r) => setTimeout(r, 500));
    }

    // Той самий конфіг, що й у ручному запуску, плюс локальний API для лічильника слухачів.
    const config = fs
      .readFileSync(paths.mediamtxYml, 'utf8')
      .replace(/^api:.*$/m, `api: yes\napiAddress: 127.0.0.1:${API_PORT}`);
    const runtime = path.join(app.getPath('userData'), 'mediamtx.runtime.yml');
    fs.mkdirSync(path.dirname(runtime), { recursive: true });
    fs.writeFileSync(runtime, config);

    this.mtxLog = '';
    this.mtx = spawn(paths.mediamtx, [runtime], { windowsHide: true });
    const collect = (d) => { this.mtxLog = (this.mtxLog + d).slice(-2000); };
    this.mtx.stdout.on('data', collect);
    this.mtx.stderr.on('data', collect);
    this.mtx.on('exit', () => {
      if (!this.running) return;
      this.stop().then(() => this.setStatus({ phase: 'error', message: 'Медіасервер несподівано зупинився. Спробуйте ще раз.' }));
    });

    if (!(await waitForPort(8554, 8000))) {
      const hint = /address already in use/i.test(this.mtxLog) ? ' Порт зайнятий іншою програмою.' : '';
      throw new Error('Медіасервер не стартував.' + hint);
    }
  }

  spawnFfmpeg() {
    const { device, channel, bitrate, slow } = this.opts;
    const FILTER = filterFor(this.muted);
    const out = (url) => ['-f', 'rtsp', '-rtsp_transport', 'tcp', url];
    const args = [
      '-hide_banner', '-loglevel', 'warning',
      '-f', 'dshow', '-audio_buffer_size', '20', '-i', `audio=${device}`,
      '-af', FILTER,
      '-c:a', 'libopus', '-b:a', `${bitrate}k`, '-ar', '48000', '-ac', '1',
      '-application', 'voip', '-frame_duration', '20',
      ...out(`rtsp://127.0.0.1:8554/${channel}`),
    ];
    if (slow) {
      args.push(
        '-af', FILTER,
        '-c:a', 'aac', '-b:a', '64k', '-ar', '48000', '-ac', '1',
        ...out(`rtsp://127.0.0.1:8554/${channel}-slow`),
      );
    }
    // Третій вихід - сирий звук у stdout, з нього рахуємо рівень сигналу для індикатора.
    args.push('-af', FILTER, '-f', 's16le', '-ac', '1', '-ar', '8000', 'pipe:1');

    const startedAt = Date.now();
    this.ffLog = '';
    this.lastLoudAt = Date.now();
    this.ffmpeg = spawn(paths.ffmpeg, args, { windowsHide: true });
    this.ffmpeg.stderr.on('data', (d) => {
      // Відповіді ffmpeg на команди вимкнення звуку - не помилки.
      this.ffLog = (this.ffLog + String(d).replace(/Enter command:.*|Command reply.*/g, '')).slice(-1500);
    });
    this.ffmpeg.stdin.on('error', () => {});
    this.ffmpeg.stdout.on('data', (buf) => this.onAudio(buf));
    this.ffmpeg.on('exit', () => {
      this.ffmpeg = null;
      if (!this.running) return;
      const lines = this.ffLog.trim().split(/\r?\n/).filter(Boolean);
      const reason = lines[lines.length - 1] || '';
      const quick = Date.now() - startedAt < 3000;
      this.setStatus({
        phase: 'reconnecting',
        message: quick
          ? `Не вдається відкрити мікрофон. Перевірте, що він увімкнений і вибраний правильно. ${reason}`
          : 'Мікрофон відключився. Шукаю знову…',
        silent: false,
      });
      this.emit('level', 0);
      this.retry = setTimeout(() => this.running && this.spawnFfmpeg(), 2000);
    });
  }

  onAudio(buf) {
    const samples = Math.floor(buf.length / 2);
    if (!samples) return;
    let sum = 0;
    for (let i = 0; i < samples; i++) {
      const v = buf.readInt16LE(i * 2) / 32768;
      sum += v * v;
    }
    const db = 20 * Math.log10(Math.sqrt(sum / samples) || 1e-6);
    if (db > SILENCE_DB) this.lastLoudAt = Date.now();

    const now = Date.now();
    if (now - this.lastLevelEmit >= 80) {
      this.lastLevelEmit = now;
      this.emit('level', Math.max(0, Math.min(1, (db + 60) / 60)));
    }
  }

  // Вигнані учні: закриваємо їхні WebRTC-сесії (і повторні спроби підключитись) за IP.
  async enforceBans() {
    const banned = this.bannedIps ? this.bannedIps() : null;
    if (!banned || !banned.size) return;
    try {
      const res = await fetch(`http://127.0.0.1:${API_PORT}/v3/webrtcsessions/list`, { signal: AbortSignal.timeout(1000) });
      const data = await res.json();
      for (const it of data.items || []) {
        const ip = String(it.remoteAddr || '').replace(/:\d+$/, '');
        if (banned.has(ip)) {
          fetch(`http://127.0.0.1:${API_PORT}/v3/webrtcsessions/kick/${it.id}`, { method: 'POST', signal: AbortSignal.timeout(1000) }).catch(() => {});
        }
      }
    } catch {
      /* API ще не піднялось */
    }
  }

  async poll() {
    if (!this.running) return;
    const { channel } = this.opts;
    let ready = false;
    let listeners = 0;
    for (const name of [channel, `${channel}-slow`]) {
      try {
        const res = await fetch(`http://127.0.0.1:${API_PORT}/v3/paths/get/${encodeURIComponent(name)}`, {
          signal: AbortSignal.timeout(1000),
        });
        if (!res.ok) continue;
        const info = await res.json();
        if (name === channel) ready = !!info.ready;
        listeners += (info.readers || []).length;
      } catch {
        /* API ще не піднялось - спробуємо наступного разу */
      }
    }
    if (!this.running) return;
    await this.enforceBans();

    // Сторінки слухачів самі шлють пульс - це точніше за сесії медіасервера
    // (враховує і резервний HLS-режим, і телефони, що вже закрили сторінку).
    const pulses = this.pulseCount ? this.pulseCount(channel) : 0;
    if (pulses > 0) listeners = pulses;

    const silent = ready && !this.muted && Date.now() - this.lastLoudAt > SILENCE_AFTER_MS;
    if (ready) {
      this.setStatus({ phase: 'live', message: '', listeners, silent });
    } else if (this.status.phase === 'live') {
      this.setStatus({ phase: 'reconnecting', message: 'Звук тимчасово зник, відновлюю…', listeners: 0, silent: false });
    } else {
      this.setStatus({ listeners });
    }
  }

  async stop() {
    this.running = false;
    clearInterval(this.timer);
    clearTimeout(this.retry);
    this.timer = this.retry = null;
    killTree(this.ffmpeg);
    killTree(this.mtx);
    this.ffmpeg = this.mtx = null;
    this.status = this.idle();
    this.emit('status', this.status);
    this.emit('level', 0);
  }

  // "Тиша": ffmpeg не перезапускається, тому слухачі не відключаються, просто звук нульовий.
  setMuted(muted) {
    this.muted = !!muted;
    if (this.ffmpeg && this.ffmpeg.exitCode === null) {
      const ff = this.ffmpeg;
      ff.stdin.write('c');
      setTimeout(() => ff.exitCode === null && ff.stdin.write(`volume@m -1 volume ${this.muted ? 0 : 1}\n`), 150);
    }
    this.lastLoudAt = Date.now();
    this.setStatus({ muted: this.muted, silent: false });
  }

  // Синхронне прибирання при виході із застосунку.
  killNow() {
    this.running = false;
    for (const c of [this.ffmpeg, this.mtx]) {
      if (c && c.exitCode === null) {
        try { process.kill(c.pid); } catch { /* вже завершився */ }
      }
    }
  }
}

module.exports = { Engine };
