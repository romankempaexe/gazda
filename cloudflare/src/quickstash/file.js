// QuickStash – súbor na synchronizáciu: stiahnutie podľa odkazu Google (bez prihlásenia,
// súbor zdieľaný „Ktokoľvek s odkazom“) a prečítanie obsahu (JSON QuickStashu alebo tabuľka).

import { AppError } from '../domain.js';

const MAX_FILE = 1024 * 1024;

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Riadky CSV (Google Tabuľka) alebo textu oddeleného tabulátorom / bodkočiarkou → polia buniek. */
export function parseRows(text) {
  const first = text.split('\n', 1)[0];
  const sep = first.includes('\t') ? '\t' : first.includes(';') && !first.includes(',') ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && !cell) quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

/** Obsah súboru → { "<názov>": { value, type } } (JSON QuickStashu alebo tabuľka Názov | Hodnota | Typ). */
export function parseFileText(text) {
  const t = String(text || '').replace(/^﻿/, '').trim();
  if (t.startsWith('{')) {
    try {
      return JSON.parse(t);
    } catch (e) {
      throw new AppError('Súbor vyzerá ako JSON, ale je poškodený (' + e.message + ').');
    }
  }
  if (/^<(!doctype|html)/i.test(t)) throw new AppError('Namiesto súboru prišla webová stránka – skontroluj odkaz a zdieľanie súboru.');
  const out = {};
  parseRows(t).forEach((r, i) => {
    const name = (r[0] || '').trim();
    const value = (r[1] || '').trim();
    if (!name || !value) return;
    if (i === 0 && /^(nazov|name|kluc|key|polozka)$/.test(fold(name))) return; // hlavička
    out[name] = { value, type: /^(heslo|password|pass|h)$/.test(fold(r[2] || '').trim()) ? 'password' : 'text' };
  });
  if (!Object.keys(out).length) {
    throw new AppError('V súbore nie sú položky. Čakám JSON z QuickStashu alebo tabuľku so stĺpcami Názov, Hodnota, Typ (heslo / text).');
  }
  return out;
}

/**
 * Odkaz Google → { id, download, kind }. Podporuje súbor na Drive (…/file/d/<id>/…, ?id=<id>),
 * Google Tabuľku (stiahne sa ako CSV, aj zvolený hárok gid) a Google Dokument (ako text).
 */
export function googleLink(url) {
  let u;
  try {
    u = new URL(String(url || '').trim());
  } catch {
    throw new AppError('Vlož celý odkaz na súbor z Google Drive (začína https://).');
  }
  const id = (/\/d\/([A-Za-z0-9_-]{10,200})/.exec(u.pathname) || [])[1] || (/^[A-Za-z0-9_-]{10,200}$/.test(u.searchParams.get('id') || '') ? u.searchParams.get('id') : '');
  if (u.protocol !== 'https:' || !id) throw new AppError('Toto nie je odkaz na súbor z Google Drive.');
  if (u.hostname === 'docs.google.com' && u.pathname.startsWith('/spreadsheets/')) {
    const gid = (/gid=(\d+)/.exec(u.hash + '&' + u.search) || [])[1];
    return { id, kind: 'sheet', download: 'https://docs.google.com/spreadsheets/d/' + id + '/export?format=csv' + (gid ? '&gid=' + gid : '') };
  }
  if (u.hostname === 'docs.google.com' && u.pathname.startsWith('/document/')) {
    return { id, kind: 'doc', download: 'https://docs.google.com/document/d/' + id + '/export?format=txt' };
  }
  if (u.hostname === 'drive.google.com' || u.hostname === 'drive.usercontent.google.com') {
    return { id, kind: 'file', download: 'https://drive.usercontent.google.com/download?id=' + id + '&export=download&confirm=t' };
  }
  throw new AppError('Toto nie je odkaz na súbor z Google Drive.');
}

/** Názov súboru z hlavičky Content-Disposition. */
function fileName(res) {
  const cd = res.headers.get('content-disposition') || '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      // nižšie
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  return plain ? plain[1].trim() : '';
}

/** Stiahne súbor podľa odkazu Google (bez prihlásenia) → { id, name, text }. */
export async function downloadLink(c, url) {
  const link = googleLink(url);
  let res;
  try {
    res = await (c.fetch || fetch)(link.download, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (FamilyGrid QuickStash sync)' } });
  } catch {
    throw new AppError('Google Drive je nedostupný – skús to o chvíľu.');
  }
  const type = res.headers.get('content-type') || '';
  if (res.status === 404) throw new AppError('Súbor sa nenašiel – skontroluj odkaz a či je zdieľaný „Ktokoľvek s odkazom“.');
  if (res.status === 401 || res.status === 403 || (res.ok && type.includes('text/html') && link.kind !== 'doc')) {
    throw new AppError('Súbor nie je zdieľaný odkazom. Na Google Drive: Zdieľať → Všeobecný prístup → „Ktokoľvek s odkazom“.');
  }
  if (!res.ok) throw new AppError('Google Drive vrátil chybu ' + res.status + '.');
  const text = await res.text();
  if (text.length > MAX_FILE) throw new AppError('Súbor je príliš veľký (najviac 1 MB).');
  if (/^\s*<(!doctype|html)/i.test(text)) {
    throw new AppError('Súbor nie je zdieľaný odkazom. Na Google Drive: Zdieľať → Všeobecný prístup → „Ktokoľvek s odkazom“.');
  }
  return { id: link.id, name: fileName(res) || { sheet: 'Google Tabuľka', doc: 'Google Dokument', file: 'Súbor z Google Drive' }[link.kind], text };
}
