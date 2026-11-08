#!/usr/bin/env python3
"""Databáza liekov pre Zdravko zo zoznamu registrovaných liekov ŠÚKL.

Zoznam sa mesačne aktualizuje na https://www.sukl.sk/verejne/Zoznam_liekov/
(zoznam_liekov_aktualny.zip → zoznam_liekov.xlsx). Použitie:

    pip install openpyxl xlrd
    curl -O https://www.sukl.sk/verejne/Zoznam_liekov/zoznam_liekov_aktualny.zip
    python3 scripts/sukl_lieky.py zoznam_liekov_aktualny.zip > public/zdravko/drugs.js

Jeden riadok databázy = jeden prípravok (rovnaký názov), formy a sily sú zlúčené zo všetkých balení.
Vynechané sú rádiofarmaká, diagnostiká a kontrastné látky (ATC V04, V07, V08, V09, V10).
"""
import io
import os
import json
import re
import sys
import zipfile
from collections import Counter, defaultdict

import openpyxl
import xlrd

CATEGORIES = [
    ['pain', 'Bolesť a horúčka', 'healing'],
    ['cold', 'Prechladnutie, kašeľ, nádcha, hrdlo', 'sick'],
    ['allergy', 'Alergia', 'spa'],
    ['digest', 'Trávenie, žalúdok, črevá', 'restaurant'],
    ['infection', 'Antibiotiká a infekcie', 'coronavirus'],
    ['vaccines', 'Očkovanie', 'vaccines'],
    ['heart', 'Srdce, tlak a cievy', 'cardiology'],
    ['diabetes', 'Cukrovka', 'glucose'],
    ['hormones', 'Štítna žľaza a hormóny', 'science'],
    ['mind', 'Nervy, spánok a psychika', 'psychology'],
    ['lungs', 'Astma a dýchanie', 'pulmonology'],
    ['skin', 'Koža, rany a vlasy', 'dermatology'],
    ['eyes', 'Oči a uši', 'visibility'],
    ['joints', 'Kĺby, svaly a kosti', 'orthopedics'],
    ['urinary', 'Močové cesty, obličky a prostata', 'water_drop'],
    ['women', 'Gynekológia a antikoncepcia', 'female'],
    ['vitamins', 'Vitamíny, minerály a krvotvorba', 'nutrition'],
    ['cancer', 'Onkológia a imunita', 'medical_services'],
    ['other', 'Iné (nemocničné, anestézia, roztoky)', 'medical_services'],
]

# ATC predpona → oblasť (najdlhšia zhoda vyhráva)
ATC_CATS = {
    'A': 'digest', 'A10': 'diabetes', 'A11': 'vitamins', 'A12': 'vitamins', 'A13': 'vitamins',
    'B': 'other', 'B01': 'heart', 'B03': 'vitamins',
    'C': 'heart', 'C05A': 'digest',
    'D': 'skin',
    'G': 'women', 'G04': 'urinary',
    'H': 'hormones',
    'J': 'infection', 'J07': 'vaccines',
    'L': 'cancer',
    'M': 'joints', 'M01': 'pain',
    'N': 'mind', 'N01': 'other', 'N02': 'pain', 'N07B': 'mind',
    'P': 'infection',
    'R': 'cold', 'R03': 'lungs', 'R06': 'allergy', 'R07': 'lungs',
    'S': 'eyes', 'S01G': 'allergy',
    'V': 'other', 'V01': 'allergy', 'V03AE': 'urinary', 'V06': 'vitamins',
}
SKIP_ATC = ('V04', 'V07', 'V08', 'V09', 'V10')

# Látka pre pripomienky striedania liekov proti horúčke v Zdravkovi (len systémové podanie).
SUBSTANCE_IDS = {
    'M01AE01': 'ibuprofen', 'M01AE51': 'ibuprofen',
    'N02BE01': 'paracetamol', 'N02BE51': 'paracetamol', 'N02BE71': 'paracetamol',
    'N02BA01': 'acetylsalicylic_acid', 'N02BA51': 'acetylsalicylic_acid',
}

# Liekové formy (kód ŠÚKL) → slovenský názov; neznáme sa poskladajú z FORM_BASE + FORM_ROUTE.
FORMS = {
    'TBL': 'tablety', 'TBL FLM': 'filmom obalené tablety', 'TBL OBD': 'obalené tablety',
    'TBL PLG': 'tablety s predĺženým uvoľňovaním', 'TBL ENT': 'gastrorezistentné tablety',
    'TBL ORO': 'orodispergovateľné tablety', 'TBL MOD': 'tablety s riadeným uvoľňovaním',
    'TBL MND': 'žuvacie tablety', 'TBL SLG': 'sublingválne tablety', 'TBL DSP': 'dispergovateľné tablety',
    'TBL EFF': 'šumivé tablety', 'TBL VAG': 'vaginálne tablety', 'TBL BUC': 'bukálne tablety',
    'TBL SOL': 'rozpustné tablety',
    'CPS': 'kapsuly', 'CPS DUR': 'tvrdé kapsuly', 'CPS MOL': 'mäkké kapsuly',
    'CPS END': 'gastrorezistentné tvrdé kapsuly', 'CPS ENM': 'gastrorezistentné mäkké kapsuly',
    'CPS PLD': 'tvrdé kapsuly s predĺženým uvoľňovaním', 'CPS PLG': 'kapsuly s predĺženým uvoľňovaním',
    'CPS MDD': 'tvrdé kapsuly s riadeným uvoľňovaním', 'CPS MDL': 'žuvacie mäkké kapsuly',
    'CPS VAM': 'vaginálne mäkké kapsuly',
    'SOL INJ': 'injekčný roztok', 'SOL INF': 'infúzny roztok', 'CON INF': 'infúzny koncentrát',
    'SOL IRU': 'injekčný roztok v naplnenej injekčnej striekačke', 'SOL POR': 'perorálny roztok',
    'SUS INJ': 'injekčná suspenzia', 'SUS POR': 'perorálna suspenzia', 'SIR': 'sirup',
    'GTT POR': 'perorálne kvapky', 'INT OPO': 'očné kvapky (roztok)', 'INT OPU': 'očné kvapky (suspenzia)',
    'INT NAO': 'nosové kvapky', 'INT OTS': 'ušné kvapky', 'UNG OPH': 'očná masť', 'GEL OPH': 'očný gél',
    'AER NAO': 'nosová aerodisperzia', 'AER NAU': 'nosová aerodisperzia (suspenzia)',
    'SUS INH': 'inhalačná suspenzia v tlakovom obale', 'SOL INH': 'inhalačný roztok', 'PLV INH': 'inhalačný prášok',
    'SOL NEB': 'roztok na rozprašovač', 'SUS NEB': 'suspenzia na rozprašovač',
    'GRA': 'granulát', 'GRA EFF': 'šumivý granulát',
    'PLV POR': 'perorálny prášok', 'PLO POR': 'prášok na perorálny roztok', 'PLU POR': 'prášok na perorálnu suspenziu',
    'PLV INO': 'prášok na injekčný roztok', 'PLV IOL': 'prášok a rozpúšťadlo na injekčný roztok',
    'SOL IJF': 'injekčný/infúzny roztok', 'SOL IRA': 'injekčný roztok v naplnenom pere',
    'AER ORS': 'orálny sprej', 'AER DEO': 'dermálny sprej', 'SPC': 'iná forma (napr. čaj)',
    'CRM': 'krém', 'CRM DER': 'dermálny krém', 'CRM VAG': 'vaginálny krém', 'UNG': 'masť', 'UNG DER': 'dermálna masť',
    'UNG REC': 'rektálna masť', 'GEL': 'gél', 'GEL DER': 'dermálny gél', 'SOL DER': 'dermálny roztok',
    'EMU DER': 'dermálna emulzia', 'SHP': 'šampón', 'SUP': 'čípky', 'SUP VAG': 'vaginálne čípky',
    'EMP TDM': 'transdermálna náplasť', 'EMP MED': 'liečivá náplasť', 'GUM MED': 'liečivá žuvačka',
    'PAS ORD': 'pastilky', 'IMP': 'implantát', 'INS VAG': 'vaginálny inzert', 'KIT': 'súprava',
}
FORM_BASE = {
    'TBL': 'tablety', 'CPS': 'kapsuly', 'SOL': 'roztok', 'SUS': 'suspenzia', 'PLV': 'prášok', 'GRA': 'granulát',
    'UNG': 'masť', 'CRM': 'krém', 'GEL': 'gél', 'AER': 'aerodisperzia', 'INT': 'kvapky', 'GTT': 'kvapky',
    'SUP': 'čípky', 'EMP': 'náplasť', 'EMU': 'emulzia', 'SIR': 'sirup', 'PAS': 'pastilky', 'LIF': 'lyofilizát',
    'LYO': 'lyofilizát', 'IMP': 'implantát', 'GAS': 'medicinálny plyn', 'DIS': 'disperzia', 'CON': 'koncentrát',
    'PLO': 'prášok a rozpúšťadlo', 'PLC': 'prášok na koncentrát', 'PLU': 'prášok na roztok', 'GUM': 'žuvačka',
    'FLM': 'film', 'SHP': 'šampón', 'KIT': 'súprava', 'SPC': 'špeciálna forma', 'LIQ': 'tekutina',
}
FORM_ROUTE = {
    'POR': 'ústami', 'ORA': 'do úst', 'ORS': 'do úst', 'ORO': 'do úst', 'INJ': 'injekcia', 'IJF': 'injekcia',
    'IJP': 'injekcia', 'IRU': 'injekcia', 'IRA': 'injekcia', 'INO': 'injekcia', 'IOL': 'injekcia/infúzia',
    'INF': 'infúzia', 'IFO': 'infúzia', 'IFC': 'infúzia', 'OPO': 'oči', 'OPU': 'oči', 'OPH': 'oči',
    'NAO': 'nos', 'NAU': 'nos', 'NAS': 'nos', 'DER': 'koža', 'VAG': 'vaginálne', 'REC': 'rektálne',
    'INH': 'inhalácia', 'NEB': 'inhalácia', 'SLG': 'pod jazyk', 'BUC': 'líce', 'OTS': 'uši', 'OTO': 'uši',
}


def form_name(code):
    code = re.sub(r'\s+', ' ', (code or '').strip().upper())
    if code in FORMS:
        return FORMS[code]
    parts = code.split(' ')
    base = FORM_BASE.get(parts[0])
    if not base:
        return code.lower() or 'iná forma'
    route = FORM_ROUTE.get(parts[1]) if len(parts) > 1 else None
    return base + (' (' + route + ')' if route else '')


def category(atc):
    best = ''
    for prefix in ATC_CATS:
        if atc.startswith(prefix) and len(prefix) > len(best):
            best = prefix
    return ATC_CATS.get(best, 'other')


def nice(name):
    """Názov skupiny ATC: bez nezlomiteľných medzier, VEĽKÉ PÍSMENÁ → prvé veľké."""
    name = re.sub(r'\s+', ' ', str(name).replace('\xa0', ' ')).strip()
    return name[:1] + name[1:].lower() if name.isupper() else name


def atc_groups(z, codes):
    """Skupina lieku podľa ATC číselníka (atc.xls): „3. úroveň › 4. úroveň“ pre každý 5-znakový kód."""
    name = next((n for n in z.namelist() if n.lower().endswith('atc.xls')), None)
    if not name:
        return {}
    sheet = xlrd.open_workbook(file_contents=z.read(name), logfile=open(os.devnull, 'w')).sheet_by_index(0)
    names = {str(sheet.cell_value(i, 0)).strip(): nice(sheet.cell_value(i, 2)) for i in range(1, sheet.nrows)}
    out = {}
    for code in sorted({c[:5] for c in codes if len(c) >= 5}):
        parts = [names.get(code[:4]), names.get(code)]
        parts = [p for i, p in enumerate(parts) if p and (i == 0 or p != parts[0])]
        if parts:
            out[code] = ' › '.join(parts)
    return out


def natural(s):
    return [float(x.replace(',', '.')) if re.fullmatch(r'[\d,]+', x) and x.count(',') <= 1 else x
            for x in re.findall(r'[\d,]+|\D+', s)]


def main(path):
    z = zipfile.ZipFile(path)
    name = next(n for n in z.namelist() if n.lower().endswith('zoznam_liekov.xlsx'))
    info = z.getinfo(name)
    data = z.read(name)
    ws = openpyxl.load_workbook(io.BytesIO(data), read_only=True).worksheets[0]
    rows = ws.iter_rows(values_only=True)
    head = list(next(rows))
    col = {k: head.index(k) for k in ('Názov', 'lie_sila', 'ATC kód', 'atc_nazov_sk', 'Výdaj', 'form_kod')}

    products = defaultdict(lambda: {'atc': Counter(), 'forms': defaultdict(set), 'otc': False})
    atc_names = {}
    for r in rows:
        name = re.sub(r'\s+', ' ', str(r[col['Názov']] or '')).strip()
        atc = str(r[col['ATC kód']] or '').strip().upper()
        if not name or not atc or atc == '?' or atc.startswith(SKIP_ATC):
            continue
        p = products[name]
        p['atc'][atc] += 1
        atc_names.setdefault(atc, re.sub(r'\s+', ' ', str(r[col['atc_nazov_sk']] or '')).strip())
        sila = re.sub(r'\s+', ' ', str(r[col['lie_sila']] or '')).strip()
        if sila in ('?', '-', 'None'):
            sila = ''
        p['forms'][form_name(r[col['form_kod']])].add(sila)
        if str(r[col['Výdaj']] or '').strip() == 'F':
            p['otc'] = True

    drugs = []
    used_atc = {}
    for name in sorted(products, key=lambda s: s.lower()):
        p = products[name]
        atc = p['atc'].most_common(1)[0][0]
        used_atc[atc] = [atc_names.get(atc, ''), category(atc)]
        forms = '|'.join(
            f + (':' + ', '.join(sorted((s for s in sily if s), key=natural)) if any(sily) else '')
            for f, sily in sorted(p['forms'].items())
        )
        row = [name, atc, forms, 1 if p['otc'] else 0]
        if atc in SUBSTANCE_IDS:
            row.append(SUBSTANCE_IDS[atc])
        drugs.append(row)

    date = '%04d-%02d-%02d' % info.date_time[:3]
    out = sys.stdout
    out.write('// Databáza liekov pre Zdravko – vygenerované skriptom scripts/sukl_lieky.py zo zoznamu\n')
    out.write('// registrovaných liekov ŠÚKL (https://www.sukl.sk/verejne/Zoznam_liekov/). Needitovať ručne.\n')
    out.write('// drugs: [názov, ATC kód, formy „forma:sily|forma:sily“, 1 = bez lekárskeho predpisu, látka pre pripomienky?]\n')
    out.write('window.ZDRAVKO_DRUGS = {\n')
    out.write(' "source": ' + json.dumps('ŠÚKL – zoznam registrovaných liekov, ' + date, ensure_ascii=False) + ',\n')
    out.write(' "categories": ' + json.dumps(CATEGORIES, ensure_ascii=False) + ',\n')
    out.write(' "groups": ' + json.dumps(atc_groups(z, used_atc), ensure_ascii=False, separators=(',', ':')) + ',\n')
    out.write(' "atc": ' + json.dumps(dict(sorted(used_atc.items())), ensure_ascii=False, separators=(',', ':')) + ',\n')
    out.write(' "drugs": [\n' + ',\n'.join(json.dumps(d, ensure_ascii=False, separators=(',', ':')) for d in drugs) + '\n ]\n};\n')
    print(len(drugs), 'prípravkov,', len(used_atc), 'ATC kódov', file=sys.stderr)
    print(Counter(c for _, c in used_atc.values()), file=sys.stderr)


if __name__ == '__main__':
    main(sys.argv[1])
