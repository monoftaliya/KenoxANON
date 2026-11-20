// Запуск PowerShell: только фиксированные скрипты приложения, без пользовательского ввода в коде.
// Обычный режим — без прав администратора; admin() поднимает права через окно UAC, которое подтверждает человек.
const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PRE = '$ProgressPreference="SilentlyContinue"; $ErrorActionPreference="Continue"; [Console]::OutputEncoding=[Text.Encoding]::UTF8; ';
const enc = (s) => Buffer.from(s, 'utf16le').toString('base64');

function run(script, { timeout = 30000 } = {}) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc(PRE + script)],
      { timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || (err && err.message) || '').trim() }));
  });
}

async function json(script, opts) {
  const r = await run(script, opts);
  if (!r.out) return { ok: false, err: r.err || 'пустой ответ' };
  try { return { ok: true, data: JSON.parse(r.out) }; } catch (e) { return { ok: false, err: 'не удалось разобрать ответ: ' + r.out.slice(0, 160) }; }
}

// Скрипт с правами администратора: Windows покажет окно UAC, результат вернётся через временный файл.
async function admin(script, { timeout = 120000 } = {}) {
  const tmp = path.join(os.tmpdir(), 'kenox-' + crypto.randomUUID() + '.json');
  const inner = PRE + 'try { ' + script + ' ; @{ ok = $true } | ConvertTo-Json -Compress | Set-Content -Encoding UTF8 -LiteralPath \'' + tmp + '\' } ' +
    'catch { @{ ok = $false; err = $_.Exception.Message } | ConvertTo-Json -Compress | Set-Content -Encoding UTF8 -LiteralPath \'' + tmp + '\' }';
  const outer = 'try { $p = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList \'-NoProfile\',\'-ExecutionPolicy\',\'Bypass\',\'-EncodedCommand\',\'' + enc(inner) + '\'; "started" } catch { "denied" }';
  const r = await run(outer, { timeout });
  if (r.out.includes('denied')) return { ok: false, err: 'Права администратора не выданы: окно UAC закрыто или отклонено.' };
  try {
    const data = JSON.parse(fs.readFileSync(tmp, 'utf8').replace(/^﻿/, ''));
    fs.unlink(tmp, () => {});
    return data;
  } catch (e) { return { ok: false, err: 'Команда с правами администратора не вернула результат.' }; }
}

// Безопасная строка для подстановки в одинарные кавычки PowerShell
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

module.exports = { run, json, admin, q };
