// Kalkulačka liekov na teplotu pre deti – podľa tabuliek MUDr. Miroslavy Moravčíkovej
// (https://www.drmoravcikova.sk/teplota-u-dietata/). Čisté výpočty bez DOM, aby sa dali otestovať.
//
// Tabuľky sú podľa váhy. Riadky stránky („6 – 8 kg“, „8 – 10 kg“) sa prekrývajú alebo majú medzery
// („4 – 5 kg“, „6 – 7 kg“); pravidlo: váha patrí do prvého riadku, ktorého horná hranica ju pokryje,
// a celé kilá v zápise „4 – 5 kg“ znamenajú do 5,99 kg. Na spoločnej hranici sa teda vždy použije
// nižšia dávka. Mimo tabuľky kalkulačka dávku nevymýšľa.
//
// Ibuprofen v sirupe: hodnoty presne z tabuľky stránky (6 – 20 kg po 2 kg; priemerná dávka 25 mg/kg/deň
// po 8 h, maximum 30 mg/kg/deň); váha medzi riadkami → nižší riadok. Sirup 40 mg/ml = polovičné dávky.

(function (root) {
  const SOURCE = {
    name: 'MUDr. Miroslava Moravčíková – Teplota u dieťaťa',
    url: 'https://www.drmoravcikova.sk/teplota-u-dietata/',
  };

  // bands: [horná hranica váhy v kg (vrátane), dávka, zápis riadku na stránke, { amount, unit } na zápis podania]
  const MEDS = {
    paracetamol: {
      name: 'Paracetamol',
      brands: 'Panadol, Paralen, Coldrex, Medipirin',
      interval: 'Interval medzi dvoma dávkami je minimálne 6 hodín.',
      forms: {
        syrup: {
          name: 'Sirup',
          product: 'Panadol Baby sirup',
          from: 6,
          bands: [
            [8, '4,0 ml', '6 – 8 kg (3 – 6 mesiacov)', { amount: 4, unit: 'ml' }],
            [10, '5,0 ml', '8 – 10 kg (6 – 12 mesiacov)', { amount: 5, unit: 'ml' }],
            [13, '7,0 ml', '10 – 13 kg (1 – 2 roky)', { amount: 7, unit: 'ml' }],
            [15, '9,0 ml', '13 – 15 kg (2 – 3 roky)', { amount: 9, unit: 'ml' }],
            [21, '10,0 ml', '15 – 21 kg (3 – 6 rokov)', { amount: 10, unit: 'ml' }],
            [29, '14,0 ml', '21 – 29 kg (6 – 9 rokov)', { amount: 14, unit: 'ml' }],
            [42, '20,0 ml', '29 – 42 kg (9 – 12 rokov)', { amount: 20, unit: 'ml' }],
          ],
        },
        supp: {
          name: 'Čípky 100 mg',
          product: 'Paralen čípky 100 mg',
          from: 4,
          bands: [
            [5.99, '½ čípku (50 mg)', '4 – 5 kg', { amount: 0.5, unit: 'čípok' }],
            [7, '¾ čípku (75 mg)', '6 – 7 kg', { amount: 0.75, unit: 'čípok' }],
            [10.99, '1 čípok (100 mg)', '7 – 10 kg', { amount: 1, unit: 'čípok' }],
            [14.99, '1½ čípku (150 mg)', '11 – 14 kg', { amount: 1.5, unit: 'čípok' }],
          ],
        },
        tablets: {
          name: 'Tablety',
          product: 'Paralen tablety 125 mg / 500 mg',
          from: 9,
          bands: [
            [12.99, '1 tabletka 125 mg', '9 – 12 kg', { amount: 1, unit: 'tbl' }],
            [16.99, '1½ tabletky 125 mg', '13 – 16 kg', { amount: 1.5, unit: 'tbl' }],
            [20.99, '2 tabletky 125 mg alebo ½ tabletky 500 mg', '17 – 20 kg', { amount: 2, unit: 'tbl' }],
            [32.99, '¾ tabletky 500 mg (375 mg)', '21 – 32 kg', { amount: 0.75, unit: 'tbl' }],
            [Infinity, '1 tabletka 500 mg', 'nad 33 kg', { amount: 1, unit: 'tbl' }],
          ],
        },
      },
    },
    ibuprofen: {
      name: 'Ibuprofen',
      brands: 'Ibalgin, Nurofen, Brufen',
      interval: 'Interval medzi dvoma dávkami je minimálne 6 hodín.',
      forms: {
        syrup20: { name: 'Sirup 20 mg/ml', product: 'Ibuprofen sirup 20 mg/ml (Ibalgin, Nurofen, Brufen)', ibuSyrup: 1 },
        syrup40: { name: 'Sirup 40 mg/ml', product: 'Ibuprofen sirup 40 mg/ml – polovičné dávky', ibuSyrup: 0.5 },
        supp: {
          name: 'Čípky',
          product: 'Nurofen čípky 60 mg / 125 mg',
          from: 6,
          bands: [
            [12, '1 čípok 60 mg', '6 – 12 kg', { amount: 1, unit: 'čípok' }],
            [17, '1 čípok 125 mg', '12 – 17 kg', { amount: 1, unit: 'čípok' }],
          ],
        },
        tablets: {
          name: 'Tablety',
          product: 'Ibalgin, Nurofen, Ibuprofen tablety / prášok',
          byAge: true,
          from: 6,
          bands: [
            [11.99, '1 tabletka 200 mg', '6 – 12 rokov', { amount: 1, unit: 'tbl' }],
            [Infinity, '1 – 2 tabletky 200 mg alebo 1 tabletka 400 mg', 'od 12 rokov', { amount: 1, unit: 'tbl' }],
          ],
        },
      },
    },
  };

  // Ibuprofen 20 mg/ml – tabuľka zo stránky: [kg, ml po 8 h, max. denná dávka ml, ml á 6 h, ml á 8 h]
  const IBU_SYRUP = [
    [6, 2.5, 9, 2.2, 3],
    [8, 3.3, 12, 3.0, 4],
    [10, 4.2, 15, 3.7, 5],
    [12, 5.0, 18, 4.5, 6],
    [14, 5.8, 21, 5.2, 7],
    [16, 6.7, 24, 6.0, 8],
    [18, 7.5, 27, 6.7, 9],
    [20, 8.4, 30, 7.5, 10],
  ];

  const RULES = [
    'Teplotu znižuj u dojčaťa nad 37,5 °C, u staršieho dieťaťa nad 38 °C – zvýšená teplota pomáha imunite.',
    'Pri meraní v konečníku odpočítaj 0,7 °C u detí do 6 mesiacov, 0,5 °C u starších detí.',
    'Dostatočný pitný režim – dieťa by malo močiť približne každé 4 hodiny.',
    'Ak dieťa vracia, podávaj čípky; ak má hnačku, tabletky.',
    'Deťom do 12 rokov nepodávaj lieky s kyselinou acetylsalicylovou (Aspirin, Acylpyrin)!',
  ];
  const ALTERNATE =
    'Rovnaký liek najskôr o 6 hodín. Ak počas 6-hodinového intervalu vystúpi teplota nad 39 °C, ' +
    'strieda sa liek s paracetamolom a liek s ibuprofenom s odstupom minimálne 4 hodiny ' +
    '(napr. o 6:00 Paralen, o 10:00 Ibalgin, o 14:00 Paralen, o 18:00 Ibalgin). Vždy zabezpeč dostatok tekutín.';
  const WRAPS = [
    'Ak teplota napriek liekom neklesá: plachtu alebo plienku namoč do vlažnej vody a dobre vyžmýkaj.',
    'Dieťa do nej zabaľ tak, aby mu trčala hlavička, ruky a nohy, prikry suchou plachtou a nechaj pôsobiť 10 minút.',
    'Opakuj, kým teplota neklesne pod 38,5 °C.',
    'Zábaly nerob, ak má dieťa studené alebo mramorovo sfarbené ručičky a nožičky.',
  ];

  const num = (v, d) => {
    const s = (Math.round(v * 10 ** d) / 10 ** d).toFixed(d).replace('.', ',');
    return s;
  };
  /** Riadok tabuľky pre hodnotu (váha v kg alebo vek v rokoch) – alebo dôvod, prečo žiadny. */
  function band(form, value) {
    if (value < form.from) return { below: true };
    const i = form.bands.findIndex((b) => value <= b[0]);
    return i < 0 ? { above: true } : { row: form.bands[i], index: i };
  }

  // ml na 1 – 2 desatinné miesta (polovičné dávky pri 40 mg/ml: 1,65 ml)
  const ml = (v) => num(v, 2).replace(/0$/, '');

  /** Ibuprofen v sirupe podľa tabuľky stránky: riadok s najväčšou váhou ≤ váha dieťaťa (do 20,99 kg). */
  function ibuprofenSyrup(factor, w) {
    if (!(w >= IBU_SYRUP[0][0]) || w >= 21) return null;
    let i = 0;
    while (i + 1 < IBU_SYRUP.length && IBU_SYRUP[i + 1][0] <= w) i++;
    const [kg, ml, maxDay, h6, h8] = IBU_SYRUP[i].map((v, k) => (k ? v * factor : v));
    return { index: i, kg, ml, maxDay, h6, h8 };
  }

  /**
   * Výpočet dávky. weight v kg, ageYears v rokoch (len pre tablety ibuprofenu).
   * Vráti { ok, dose, product, row, lines[], record?: { amount, unit } } alebo { ok: false, message }.
   */
  function calc(medId, formId, weight, ageYears) {
    const med = MEDS[medId];
    const form = med && med.forms[formId];
    if (!form) return { ok: false, message: 'Vyber liek a formu.' };
    const base = { product: form.product, interval: med.interval };

    if (form.byAge) {
      if (!(ageYears >= 0)) return { ok: false, message: 'Zadaj vek dieťaťa.' };
      const b = band(form, ageYears);
      if (b.below) return { ok: false, message: 'Tablety ibuprofenu sú podľa tabuľky až od 6 rokov – mladšiemu dieťaťu sirup alebo čípky.' };
      return { ok: true, ...base, dose: b.row[1], row: b.row[2], lines: [], record: b.row[3] };
    }

    if (!(weight > 0)) return { ok: false, message: 'Zadaj váhu dieťaťa.' };
    const kg = num(weight, 1).replace(/,0$/, '') + ' kg';

    if (form.ibuSyrup) {
      const r = ibuprofenSyrup(form.ibuSyrup, weight);
      if (!r) return { ok: false, message: 'Tabuľka na stránke je pre 6 – 20 kg (' + kg + ' je mimo) – poraď sa s lekárom' + (weight >= 21 ? ', staršiemu dieťaťu tablety podľa veku.' : '.') };
      return {
        ok: true,
        ...base,
        dose: ml(r.ml) + ' ml sirupu po 8 hod.',
        row: 'Riadok tabuľky: ' + r.kg + ' kg' + (r.kg === weight ? '' : ' (' + kg + ' v tabuľke nie je – nižší riadok)'),
        lines: ['Max. denná dávka ' + ml(r.maxDay) + ' ml (' + ml(r.h6) + ' ml á 6 hod alebo ' + ml(r.h8) + ' ml á 8 hod).'],
        record: { amount: r.ml, unit: 'ml' },
        index: r.index,
      };
    }

    const b = band(form, weight);
    if (b.below) return { ok: false, message: 'Pre ' + kg + ' tabuľka na stránke dávku neuvádza (od ' + form.from + ' kg) – poraď sa s lekárom.' };
    if (b.above) return { ok: false, message: 'Pre ' + kg + ' tabuľka pre túto formu dávku neuvádza – zvoľ inú formu alebo sa poraď s lekárom.' };
    return { ok: true, ...base, dose: b.row[1], row: 'Riadok tabuľky: ' + b.row[2], lines: [], record: b.row[3], index: b.index };
  }

  // tabuľka na zobrazenie (rovnaký tvar ako bands): [kg, dávka, riadok]
  for (const f of Object.values(MEDS.ibuprofen.forms)) {
    if (!f.ibuSyrup) continue;
    f.bands = IBU_SYRUP.map((r) => [r[0], ml(r[1] * f.ibuSyrup) + ' ml po 8 hod. (max. ' + ml(r[2] * f.ibuSyrup) + ' ml/deň)', r[0] + ' kg']);
  }

  root.ZDRAVKO_FEVER = { SOURCE, MEDS, IBU_SYRUP, RULES, ALTERNATE, WRAPS, calc, ibuprofenSyrup };
})(typeof window !== 'undefined' ? window : globalThis);
