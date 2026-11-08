#!/usr/bin/env python3
"""Popisy liekov pre Zdravko z príbalových letákov (PIL) ŠÚKL.

Z archívu https://www.sukl.sk/verejne/Zoznam_SPC_PIL/spc_pil_aktualny.zip (≈ 3,6 GB) stiahne cez HTTP Range
len letáky liekov z databázy (public/zdravko/drugs.js, ≈ 1,6 GB), vytiahne z každého časť
„1. Čo je X a na čo sa používa“ a zapíše ju do public/zdravko/drug-info/NN.json (32 častí podľa názvu
lieku, aplikácia načíta len tú, ktorú práve potrebuje).

Potrebné: pdftotext (poppler-utils) a LibreOffice (soffice) na staré letáky vo formáte .doc/.docx.

    python3 scripts/sukl_lieky.py zoznam_liekov_aktualny.zip > public/zdravko/drugs.js
    python3 scripts/sukl_letaky.py --cache /tmp/sukl-pil

Stiahnuté letáky ostanú v --cache, ďalší beh stiahne len nové.
"""
import argparse
import html
import json
import os
import re
import ssl
import struct
import subprocess
import sys
import urllib.request
import zipfile
import zlib
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor

URL = 'https://www.sukl.sk/verejne/Zoznam_SPC_PIL/spc_pil_aktualny.zip'
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SHARDS = 32
LIMIT = 1100  # znakov popisu


def ssl_context():
    ca = os.environ.get('SSL_CERT_FILE') or os.environ.get('REQUESTS_CA_BUNDLE')
    return ssl.create_default_context(cafile=ca) if ca else ssl.create_default_context()


CTX = ssl_context()


def fetch(start, end, tries=6):
    req = urllib.request.Request(URL, headers={'Range': f'bytes={start}-{end}'})
    for i in range(tries):
        try:
            return urllib.request.urlopen(req, context=CTX, timeout=300).read()
        except Exception:
            if i == tries - 1:
                raise


class RemoteFile:
    """Súbor na serveri ako seekovateľný súbor (pre zipfile: prečíta len zoznam súborov archívu)."""

    def __init__(self):
        head = urllib.request.urlopen(urllib.request.Request(URL, method='HEAD'), context=CTX, timeout=60)
        self.size = int(head.headers['Content-Length'])
        self.pos = 0
        self.cache = (0, b'')

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=0):
        self.pos = offset if whence == 0 else self.pos + offset if whence == 1 else self.size + offset
        return self.pos

    def read(self, n=-1):
        if n < 0:
            n = self.size - self.pos
        if n == 0 or self.pos >= self.size:
            return b''
        start, data = self.cache
        if start <= self.pos and self.pos + n <= start + len(data):
            out = data[self.pos - start:self.pos - start + n]
        elif n < 1 << 16:
            self.cache = (self.pos, fetch(self.pos, min(self.size, self.pos + (1 << 16)) - 1))
            return self.read(n)
        else:
            out = fetch(self.pos, min(self.size, self.pos + n) - 1)
        self.pos += len(out)
        return out


def download(info, cache):
    """Jeden súbor z archívu podľa lokálnej hlavičky (Range na jeho bajty)."""
    out = os.path.join(cache, 'files', os.path.basename(info.filename))
    if os.path.exists(out):
        return out
    data = fetch(info.header_offset, info.header_offset + 30 + len(info.filename.encode()) + 1024 + info.compress_size)
    sig, _, _, method, _, _, _, _, _, nlen, elen = struct.unpack('<IHHHHHIIIHH', data[:30])
    assert sig == 0x04034B50, info.filename
    body = data[30 + nlen + elen:30 + nlen + elen + info.compress_size]
    raw = zlib.decompress(body, -15) if method == 8 else body
    with open(out + '.tmp', 'wb') as f:
        f.write(raw)
    os.replace(out + '.tmp', out)
    return out


# ---- Vytiahnutie „Čo je X a na čo sa používa“ ------------------------------------------------------

HEAD1 = re.compile(r'(?is)č\s*o\s+(?:je|sú)\s+[^\n]{0,120}?(?:\n[^\n]{0,80}?)?\s+a\s+na\s+čo\s+sa\s+(?:používa|používajú|užíva|užívajú)[^\n]*')
HEAD2 = re.compile(
    r'(?i)(?:^|\n|\s)2\s*\.?\s*(?:\n\s*)?(?:čo\s+potrebujete|čo\s+musíte|skôr\s+ako|predtým|čo\s+by\s+ste)'
    r'|\n\s*(?:čo\s+potrebujete\s+vedieť|čo\s+musíte\s+vedieť|skôr\s+ako\s+(?:užijete|použijete))'
)
JUNK = re.compile(r'(?i)^(príloha|strana|page|\d+\s*/\s*\d+$|\d+$|sp\.\s*zn|ev\.\s*č|schválený text|.*notifikáci)')
BULLETS = re.compile('[-•▪●‣⁃]\\s*')
HOMEOPATHIC = re.compile(r'(?i)homeopatický liek bez schválených terapeutických indikácií')


def text_of(path, cache):
    if path.lower().endswith('.pdf'):
        return subprocess.run(['pdftotext', '-enc', 'UTF-8', path, '-'], capture_output=True, timeout=120).stdout.decode('utf-8', 'replace')
    txt = os.path.join(cache, 'txt', os.path.splitext(os.path.basename(path))[0] + '.txt')
    return open(txt, encoding='utf-8', errors='replace').read() if os.path.exists(txt) else ''


def section(text):
    text = text.replace('\r', '').replace('\f', '\n').replace('­', '').replace('\xa0', ' ')
    text = BULLETS.sub('\n\n• ', text)
    best = ''
    for m in HEAD1.finditer(text):
        n = HEAD2.search(text, m.end())
        body = text[m.end():n.start() if n else m.end() + 5000][:5000]
        if len(body.strip()) > len(best.strip()):
            best = body
    return best


def clean(body):
    paras, cur = [], []
    for line in body.split('\n'):
        line = re.sub(r'\s+', ' ', line).strip()
        if not line:
            if cur:
                paras.append(' '.join(cur))
                cur = []
            continue
        if JUNK.match(line):
            continue
        if cur and cur[-1].endswith('-') and line[:1].islower():
            cur[-1] = cur[-1][:-1] + line
        else:
            cur.append(line)
    if cur:
        paras.append(' '.join(cur))
    paras = [p for p in paras if p and p not in ('•', '1.', '2.')]
    out = '\n'.join(paras).strip()
    if len(out) > LIMIT:
        cut = out[:LIMIT]
        i = max(cut.rfind('. '), cut.rfind('.\n'))
        out = (cut[:i + 1] if i > LIMIT * 0.5 else cut.rstrip()) + ' …'
    return out


def describe(args):
    path, cache = args
    try:
        text = text_of(path, cache)
        desc = clean(section(text))
        if len(desc) < 40 and HOMEOPATHIC.search(text):
            desc = 'Homeopatický liek bez schválených terapeutických indikácií.'
        return os.path.basename(path), desc if len(desc) >= 40 or desc.startswith('Homeopatický') else ''
    except Exception:
        return os.path.basename(path), ''


def shard(name):
    """Rovnaký výpočet ako v aplikácii (app.js: drugShard)."""
    h = 0
    for ch in name:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return h % SHARDS


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default='sukl-pil-cache', help='priečinok na stiahnuté letáky')
    ap.add_argument('--drugs', default=os.path.join(ROOT, 'public/zdravko/drugs.js'))
    ap.add_argument('--out', default=os.path.join(ROOT, 'public/zdravko/drug-info'))
    a = ap.parse_args()
    for d in ('files', 'txt'):
        os.makedirs(os.path.join(a.cache, d), exist_ok=True)

    names = [json.loads(line.rstrip().rstrip(','))[0] for line in open(a.drugs, encoding='utf-8') if line.startswith('[')]

    print('Zoznam súborov archívu…', file=sys.stderr)
    z = zipfile.ZipFile(RemoteFile())
    infos = {os.path.basename(i.filename): i for i in z.infolist()}
    index_name = next(n for n in z.namelist() if n.lower().endswith('.html'))
    index = z.read(index_name).decode('cp1250', 'replace')

    # názov lieku → najčastejší leták (rovnaký pre všetky balenia)
    by_name = defaultdict(Counter)
    for row in index.split('<tr>'):
        cells = re.findall(r'<td>(.*?)</td>', row, re.S)
        if len(cells) < 10:
            continue
        name, links = re.sub(r'\s+', ' ', html.unescape(cells[2])).strip(), cells[9]
        for pil in re.findall(r'Dokumenty/(PIL[^"]+)', links):
            by_name[name][pil] += 1
    pil_of = {n: by_name[n].most_common(1)[0][0] for n in names if n in by_name and by_name[n].most_common(1)[0][0] in infos}
    needed = sorted(set(pil_of.values()))
    print(f'{len(pil_of)} z {len(names)} liekov má leták, sťahujem {len(needed)} letákov…', file=sys.stderr)

    with ThreadPoolExecutor(12) as ex:
        paths = list(ex.map(lambda p: download(infos[p], a.cache), needed))

    docs = [p for p in paths if not p.lower().endswith('.pdf')
            and not os.path.exists(os.path.join(a.cache, 'txt', os.path.splitext(os.path.basename(p))[0] + '.txt'))]
    for i in range(0, len(docs), 100):
        subprocess.run(['soffice', '--headless', '--convert-to', 'txt:Text (encoded):UTF8', '--outdir', os.path.join(a.cache, 'txt'), *docs[i:i + 100]],
                       capture_output=True, timeout=1800)

    with ProcessPoolExecutor() as ex:
        desc = dict(ex.map(describe, [(p, a.cache) for p in paths], chunksize=20))

    shards = [{'pil': {}, 'names': {}} for _ in range(SHARDS)]
    count = 0
    for name, pil in pil_of.items():
        if not desc.get(pil):
            continue
        s = shards[shard(name)]
        key = pil.split('.')[0]
        s['pil'][key] = desc[pil]
        s['names'][name] = key
        count += 1
    os.makedirs(a.out, exist_ok=True)
    for i, s in enumerate(shards):
        with open(os.path.join(a.out, '%02d.json' % i), 'w', encoding='utf-8') as f:
            json.dump(s, f, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    print(f'Popis má {count} liekov ({len(set(desc.values()) - {""})} letákov).', file=sys.stderr)


if __name__ == '__main__':
    main()
