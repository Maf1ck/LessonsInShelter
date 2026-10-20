const { EventEmitter } = require('events');

const NAME_MIN = 2;
const NAME_MAX = 20;
const TEXT_MAX = 200;
const ALIVE_MS = 20000;       // скільки учень вважається присутнім після останнього звернення сторінки
const CHAT_GAP_MS = 2500;     // не частіше одного повідомлення на 2.5 с від учня
const MAX_STUDENTS = 500;
const MAX_MESSAGES = 200;

const ID_RE = /^[a-z0-9]{6,40}$/;
const CH_RE = /^[\w-]{1,40}$/;

// Імена тільки з літер, цифр, пробілу, дефіса, апострофа і крапки: без розмітки і керуючих символів.
function cleanName(raw) {
  const s = String(raw || '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} \-'’ʼ.]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(s).slice(0, NAME_MAX).join('').trim();
}

function cleanText(raw) {
  const s = String(raw || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(s).slice(0, TEXT_MAX).join('');
}

// Учні в класі, чат "питання - відповідь", слово для живої розмови і вигнання.
// Усе в пам'яті: після закриття застосунку нічого не зберігається.
class Classroom extends EventEmitter {
  constructor() {
    super();
    this.students = new Map(); // id -> { id, ch, name, ip, at, listenAt, lastChatAt }
    this.messages = [];        // { n, ch, from, id, name, text, to, at }
    this.floor = new Map();    // ch -> id учня, якому дали слово
    this.bannedIds = new Map(); // id -> { name, ip }
    this.chatOpen = true;
    this.seq = 0;
  }

  static validChannel(ch) { return CH_RE.test(String(ch || '')); }
  static validId(id) { return ID_RE.test(String(id || '')); }

  isBanned(id, ip) {
    if (this.bannedIds.has(id)) return true;
    if (!ip) return false;
    for (const b of this.bannedIds.values()) if (b.ip === ip) return true;
    return false;
  }

  bannedIps() {
    return new Set([...this.bannedIds.values()].map((b) => b.ip).filter(Boolean));
  }

  touch(ch, id, name, ip) {
    if (!Classroom.validChannel(ch) || !Classroom.validId(id)) return null;
    if (this.isBanned(id, ip)) return null;
    let s = this.students.get(id);
    if (!s) {
      if (this.students.size >= MAX_STUDENTS) return null;
      s = { id, ch, name: '', ip: '', at: 0, listenAt: 0, lastChatAt: 0 };
      this.students.set(id, s);
      this.emit('change');
    }
    const n = cleanName(name);
    const changed = s.ch !== ch || (n.length >= NAME_MIN && n !== s.name);
    s.ch = ch;
    if (ip) s.ip = ip;
    if (n.length >= NAME_MIN) s.name = n;
    s.at = Date.now();
    if (changed) this.emit('change');
    return s;
  }

  // Пульс приходить, поки учень слухає звук. "bye" - натиснув «Зупинити» або закрив сторінку.
  ping(ch, id, name, bye, ip) {
    if (bye) {
      const s = this.students.get(id);
      if (s && s.ch === ch) {
        s.listenAt = 0;
        this.emit('change');
      }
      return;
    }
    const s = this.touch(ch, id, name, ip);
    if (!s) return;
    const was = Date.now() - s.listenAt < ALIVE_MS;
    s.listenAt = Date.now();
    if (!was) this.emit('change');
  }

  sweep() {
    const fresh = Date.now() - ALIVE_MS;
    let dropped = false;
    for (const [id, s] of this.students) {
      if (s.at < fresh) {
        this.students.delete(id);
        if (this.floor.get(s.ch) === id) this.floor.delete(s.ch);
        dropped = true;
      }
    }
    if (dropped) this.emit('change');
  }

  list(ch) {
    this.sweep();
    return [...this.students.values()]
      .filter((s) => s.ch === ch)
      .sort((a, b) => (a.name || '~').localeCompare(b.name || '~', 'uk'));
  }

  // Скільки учнів слухають звук просто зараз (а не просто відкрили сторінку).
  count(ch) {
    const fresh = Date.now() - ALIVE_MS;
    return this.list(ch).filter((s) => s.listenAt >= fresh).length;
  }

  push(msg) {
    const m = { n: ++this.seq, at: Date.now(), ...msg };
    this.messages.push(m);
    if (this.messages.length > MAX_MESSAGES) this.messages.shift();
    this.emit('change');
    return m;
  }

  send(ch, id, name, text, ip) {
    if (!this.chatOpen) return { ok: false, error: 'Вчитель вимкнув чат' };
    const s = this.touch(ch, id, name, ip);
    if (!s) return { ok: false, error: 'Невірний запит' };
    if (s.name.length < NAME_MIN) return { ok: false, error: 'Спочатку введи імʼя' };
    const t = cleanText(text);
    if (!t) return { ok: false, error: 'Порожнє повідомлення' };
    if (Date.now() - s.lastChatAt < CHAT_GAP_MS) return { ok: false, error: 'Зачекай секунду' };
    s.lastChatAt = Date.now();
    const m = this.push({ ch, from: 'student', id, name: s.name, text: t });
    this.emit('question', m);
    return { ok: true, n: m.n };
  }

  reply(ch, text, to) {
    const t = cleanText(text);
    if (!t) return false;
    this.push({ ch, from: 'teacher', name: 'Вчитель', text: t, to: to || null });
    return true;
  }

  setChatOpen(open) {
    this.chatOpen = !!open;
    this.emit('change');
  }

  // Слово: учень може вмикнути мікрофон і говорити наживо, а вчитель його чує.
  giveFloor(ch, id) {
    if (!this.students.has(id)) return;
    this.floor.set(ch, id);
    this.emit('change');
  }

  takeFloor(ch) {
    if (this.floor.delete(ch)) this.emit('change');
  }

  canSpeak(ch, id, ip) {
    return this.floor.get(ch) === id && !this.isBanned(id, ip);
  }

  kick(id) {
    const s = this.students.get(id);
    if (!s) return;
    this.bannedIds.set(id, { name: s.name || 'Без імені', ip: s.ip });
    this.students.delete(id);
    if (this.floor.get(s.ch) === id) this.floor.delete(s.ch);
    this.emit('change');
  }

  unban(id) {
    if (this.bannedIds.delete(id)) this.emit('change');
  }

  // Що бачить учень: свої повідомлення, відповіді вчителя йому або всім,
  // чи є в нього слово і чи не вигнали його.
  poll(ch, id, since, name, ip) {
    if (this.isBanned(id, ip)) return { kicked: true };
    this.touch(ch, id, name, ip);
    const messages = this.messages
      .filter((m) => m.ch === ch && m.n > since && ((m.from === 'student' && m.id === id) || (m.from === 'teacher' && (!m.to || m.to === id))))
      .map((m) => ({ n: m.n, from: m.from, name: m.name, text: m.text }));
    return { messages, floor: this.floor.get(ch) === id, chat: this.chatOpen, last: this.seq };
  }

  // Знімок для вікна вчителя.
  view(ch) {
    return {
      chatOpen: this.chatOpen,
      floor: this.floor.get(ch) || null,
      students: this.list(ch).map((s) => ({
        id: s.id,
        name: s.name || 'Без імені',
        listening: s.listenAt >= Date.now() - ALIVE_MS,
      })),
      banned: [...this.bannedIds].map(([id, b]) => ({ id, name: b.name })),
      messages: this.messages
        .filter((m) => m.ch === ch)
        .slice(-60)
        .map((m) => ({ n: m.n, from: m.from, id: m.id, name: m.name, text: m.text, to: m.to, at: m.at })),
    };
  }

  reset() {
    this.messages = [];
    this.floor.clear();
    this.bannedIds.clear();
    this.emit('change');
  }
}

module.exports = { Classroom, cleanName, cleanText, NAME_MIN, NAME_MAX, TEXT_MAX };
