#!/usr/bin/env python3
"""Databáza lekárov pre Zdravko z kódov poskytovateľov zdravotnej starostlivosti (ÚDZS).

ÚDZS zverejňuje zoznam všetkých pracovísk poskytovateľov (ambulancie, oddelenia, lekárne…)
s adresou na https://www.udzs-sk.sk/urad/kody-poskytovatelov-zdravotnej-starostlivosti-a-zdravotnickych-pracovnikov/
(súbor VyberKpWeb_<dátum>.xlsx, aktualizuje sa zhruba mesačne). Odbornosť je v kóde poskytovateľa
(znaky 7–9) a jej názov v číselníku NCZI „Odborné zameranie v zariadení“ (OID …100.10.39):
https://www.nczisk.sk/Documents/standardy/standardy_zdravotnickej_informatiky/Ciselniky/39.xml

Použitie:

    pip install openpyxl
    curl -O https://www.udzs-sk.sk/wp-content/uploads/<rok>/<mesiac>/VyberKpWeb_<dátum>.xlsx
    curl -o 39.xml https://www.nczisk.sk/Documents/standardy/standardy_zdravotnickej_informatiky/Ciselniky/39.xml
    python3 scripts/udzs_lekari.py VyberKpWeb_<dátum>.xlsx 39.xml > public/zdravko/doctors.js

Štruktúra kódu poskytovateľa (napr. P58480032206): písmeno a 5 číslic = poskytovateľ, 3 číslice =
odborné zameranie, 1 číslica = typ pracoviska (2 ambulancia, 8 centrálny príjem / ústavná pohotovosť,
3 pracovisko – napr. lekáreň, 1 lôžkové oddelenie…), 2 číslice = poradové číslo.

Do databázy idú ambulancie (typ 2 a 8) a verejné lekárne. Vynechané sú lôžkové oddelenia, laboratóriá,
zariadenia sociálnych služieb, mobilné odberové miesta a dopravná zdravotná služba. Rovnaké pracovisko
(poskytovateľ, odbornosť, adresa) s viacerými kódmi je v databáze raz.
"""
import datetime
import json
import re
import sys
from collections import Counter

import openpyxl

CATEGORIES = [
    ['gp', 'Všeobecný lekár', 'stethoscope'],
    ['kids', 'Pre deti', 'child_care'],
    ['dent', 'Zubár', 'dentistry'],
    ['gyn', 'Gynekológ', 'female'],
    ['spec', 'Špecialisti', 'medical_services'],
    ['er', 'Pohotovosť', 'emergency'],
    ['pharm', 'Lekárne', 'local_pharmacy'],
]

# mobilné odberové miesto, dopravná zdravotná služba, stanice záchrannej služby (nie sú pre pacientov s príchodom)
SKIP = {'647', '649', '179', '180', '181', '238'}
PHARMACY = '160'  # lekárenstvo (verejná lekáreň, typ pracoviska 3)


def categories(code, name):
    """Kategórie odbornosti pre filter – napr. zubná pohotovosť pre deti je v Pohotovosti, Zubároch aj Pre deti."""
    n = name.lower()
    if code == PHARMACY:
        return ['pharm']
    cats = []
    if re.search(r'pohotovostn|urgentn|centrálny príjem', n):
        cats.append('er')
    if code == '020':
        cats.append('gp')
    if code in ('007', '008') or re.search(r'pediatr|detsk|dorast|neonatol', n):
        cats.append('kids')
    if re.search(r'zub|stomatol|dent|čeľust|implantol|parodont|ortodont', n):
        cats.append('dent')
    if 'gynekol' in n:
        cats.append('gyn')
    return cats or ['spec']


def codelist(path):
    """Číselník NCZI (XML): skratka → názov."""
    text = open(path, encoding='utf-8-sig').read()
    out = {}
    for item in re.findall(r'<PolozkaCiselnika>(.*?)</PolozkaCiselnika>', text, re.S):
        code = re.search(r'<Skratka>(.*?)</Skratka>', item)
        name = re.search(r'<displayName>(.*?)</displayName>', item)
        if code and name:
            out.setdefault(code.group(1).strip(), re.sub(r'\s+', ' ', name.group(1)).strip())
    return out


def clean(s):
    return re.sub(r'\s+', ' ', str(s or '')).strip()


def main(xlsx, xml):
    names = codelist(xml)
    m = re.search(r'(\d{1,2})\.(\d{1,2})\.(\d{4})', xlsx)
    date = '%s-%02d-%02d' % (m.group(3), int(m.group(2)), int(m.group(1))) if m else datetime.date.today().isoformat()
    today = datetime.datetime.now()

    ws = openpyxl.load_workbook(xlsx, read_only=True).worksheets[0]
    rows = ws.iter_rows(values_only=True)
    head = [clean(h) for h in next(rows)]
    col = {h: i for i, h in enumerate(head)}
    for need in ('pzs_kod', 'nazov_pzs', 'Ulica cislo OU', 'Obec OU', 'PSC OU', 'Platnost_do'):
        if need not in col:
            sys.exit('V tabuľke chýba stĺpec ' + need + ' (stĺpce: ' + ', '.join(head) + ')')

    seen = set()
    entries = []
    used = {}
    unknown = Counter()
    for r in rows:
        kod = clean(r[col['pzs_kod']])
        if len(kod) != 12:
            continue
        code, kind = kod[6:9], kod[9]
        until = r[col['Platnost_do']]
        if isinstance(until, datetime.datetime) and until < today:
            continue
        if code in SKIP:
            continue
        if not (kind in '28' or (code == PHARMACY and kind == '3')):
            continue
        if code not in names:
            unknown[code] += 1
            continue
        name = clean(r[col['nazov_pzs']])
        street = clean(r[col['Ulica cislo OU']])
        town = clean(r[col['Obec OU']])
        psc = re.sub(r'\s', '', clean(r[col['PSC OU']]))
        if len(psc) == 5:
            psc = psc[:3] + ' ' + psc[3:]
        er = 1 if kind == '8' else 0
        key = (name, code, street, town, er)
        if not name or not town or key in seen:
            continue
        seen.add(key)
        # ambulancia centrálneho príjmu / ústavnej pohotovosti (typ 8) má v kóde odbornosť oddelenia –
        # do kategórie Pohotovosť ju dá príznak v riadku, odbornosť ostáva podľa číselníka
        used[code] = [names[code]] + categories(code, names[code])
        entries.append((town, name, code, street, psc, er))

    entries.sort(key=lambda e: (e[0].lower(), e[1].lower(), e[2], e[3]))
    provs = sorted({e[1] for e in entries}, key=str.lower)
    towns = sorted({e[0] for e in entries}, key=str.lower)
    pi = {n: i for i, n in enumerate(provs)}
    ti = {n: i for i, n in enumerate(towns)}

    out = sys.stdout
    out.write('// Databáza lekárov pre Zdravko – vygenerované skriptom scripts/udzs_lekari.py z kódov poskytovateľov\n')
    out.write('// zdravotnej starostlivosti ÚDZS a číselníka NCZI „Odborné zameranie v zariadení“. Needitovať ručne.\n')
    out.write('// spec: odbornosť → [názov, kategórie…]\n')
    out.write('// rows: [poskytovateľ (index v names), odbornosť (kľúč v spec), ulica a číslo, obec (index v towns), PSČ, 1 = pohotovosť / centrálny príjem]\n')
    out.write('window.ZDRAVKO_DOCTORS = {\n')
    out.write(' "source": ' + json.dumps('ÚDZS – kódy poskytovateľov zdravotnej starostlivosti, ' + date, ensure_ascii=False) + ',\n')
    out.write(' "categories": ' + json.dumps(CATEGORIES, ensure_ascii=False) + ',\n')
    spec = dict(sorted(used.items()))
    out.write(' "spec": ' + json.dumps(spec, ensure_ascii=False, separators=(',', ':')) + ',\n')
    out.write(' "names": ' + json.dumps(provs, ensure_ascii=False, separators=(',', ':')) + ',\n')
    out.write(' "towns": ' + json.dumps(towns, ensure_ascii=False, separators=(',', ':')) + ',\n')
    out.write(' "rows": [\n' + ',\n'.join(
        json.dumps([pi[e[1]], e[2], e[3], ti[e[0]], e[4]] + ([1] if e[5] else []), ensure_ascii=False, separators=(',', ':'))
        for e in entries) + '\n ]\n};\n')
    print(len(entries), 'pracovísk,', len(provs), 'poskytovateľov,', len(towns), 'obcí,', len(spec), 'odborností', file=sys.stderr)
    print(Counter(c for e in entries for c in set(spec[e[2]][1:] + (['er'] if e[5] else []))), file=sys.stderr)
    if unknown:
        print('Odbornosti mimo číselníka (vynechané):', dict(unknown), file=sys.stderr)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
