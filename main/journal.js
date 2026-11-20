// Журнал действий с хэш-цепочкой (как «Твой след» на сайте, только о реальных изменениях).
// Каждая запись хранит SHA-256 от предыдущего хэша и своего содержимого — подмену видно сразу.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ZERO = '0'.repeat(64);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

class Journal {
  constructor(dir) {
    this.file = path.join(dir, 'journal.json');
    this.items = [];
    try { this.items = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { this.items = []; }
  }
  head() { return this.items.length ? this.items[this.items.length - 1].hash : ZERO; }
  add(kind, title, detail = '') {
    const ts = new Date().toISOString();
    const prev = this.head();
    const hash = sha([prev, ts, kind, title, detail].join('|'));
    const item = { ts, kind, title, detail, prev, hash };
    this.items.push(item);
    if (this.items.length > 2000) this.items = this.items.slice(-2000);
    this.save();
    return item;
  }
  verify() {
    let prev = this.items.length ? this.items[0].prev : ZERO;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.prev !== prev || sha([it.prev, it.ts, it.kind, it.title, it.detail].join('|')) !== it.hash) return { ok: false, at: i };
      prev = it.hash;
    }
    return { ok: true, count: this.items.length };
  }
  clear() { this.items = []; this.save(); }
  save() { try { fs.writeFileSync(this.file, JSON.stringify(this.items, null, 1)); } catch (e) { /* диск недоступен */ } }
}

// Хранилище «как было»: прежние значения настроек для отката, переживает перезапуск
class UndoStore {
  constructor(dir) {
    this.file = path.join(dir, 'undo.json');
    try { this.map = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { this.map = {}; }
  }
  get(id) { return this.map[id]; }
  set(id, v) { this.map[id] = v; this.save(); }
  del(id) { delete this.map[id]; this.save(); }
  save() { try { fs.writeFileSync(this.file, JSON.stringify(this.map, null, 1)); } catch (e) { /* диск недоступен */ } }
}

module.exports = { Journal, UndoStore };
