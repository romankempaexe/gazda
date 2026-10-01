# Gazda – Google Apps Script web app

Webová verzia aplikácie Gazda (plánovanie domácich prác), ktorá beží ako
**Google Apps Script web app** a dáta ukladá do **Google tabuľky**.
Nepotrebuje Firebase ani Flutter.

## Súbory

| Súbor | Obsah |
|---|---|
| `Code.gs` | Server: práca s tabuľkou, oprávnenia, API pre prehliadač |
| `Index.html` | Kostra stránky |
| `Styles.html` | CSS (farby rovnaké ako vo Flutter verzii) |
| `App.html` | Klientsky JavaScript (zoznam domácností, kalendár, formuláre) |
| `appsscript.json` | Manifest: časová zóna, oprávnenia, nastavenie web app |

## Dátová štruktúra (Google tabuľka)

Funkcia `setup()` vytvorí štyri listy. Prvý riadok je hlavička, všetky hodnoty
sú uložené ako text a dátumy vo formáte `yyyy-MM-dd`.

**households** – domácnosti

| id | name | createdByEmail | createdAt |
|---|---|---|---|

**members** – kto má prístup k domácnosti (`role` = `owner` alebo `member`)

| householdId | email | role | addedAt |
|---|---|---|---|

**priestory** – priestory v domácnosti (kuchyňa, kúpeľňa, …)

| id | householdId | name | createdAt |
|---|---|---|---|

**cinnosti** – činnosti (úlohy)

| id | householdId | priestorId | name | description | assignedTo | icon | color | dueDate | periodicity | repeatInterval | createdAt |
|---|---|---|---|---|---|---|---|---|---|---|---|

- `assignedTo` – e-mail člena domácnosti (prázdne = nepriradené)
- `periodicity` – `none`, `weekly`, `monthly` alebo `annually`
- `repeatInterval` – každých X týždňov/mesiacov/rokov (pri `none` prázdne)
- `icon` – názov ikony (`home`, `kitchen`, `trash`, …), `color` – hex farba (`#4CAF50`)

## Funkcie

- Prihlásenie Google účtom (rieši Google automaticky)
- Domácnosti: vytvorenie, zdieľanie podľa e-mailu, vymazanie (len zakladateľ)
- **Môj rozpis** – moje činnosti na vybraný deň, tlačidlo *Hotové*
  (jednorazová činnosť sa vymaže, opakovaná sa posunie na ďalší termín)
- **Plánovanie** – všetky činnosti domácnosti na vybraný deň, filter podľa člena,
  pridanie a vymazanie činnosti
- Priestory, ikony, farby a opakovanie ako vo Flutter verzii

## Nasadenie (ručne, cez prehliadač)

1. Otvor [sheets.new](https://sheets.new) a tabuľku pomenuj napr. *Gazda – dáta*.
2. V tabuľke otvor **Rozšírenia → Apps Script**.
3. V editore:
   - prepíš obsah `Code.gs` obsahom súboru `Code.gs`,
   - cez **+ → HTML** vytvor súbory `Index`, `Styles` a `App` a vlož do nich
     obsah príslušných `.html` súborov,
   - v **Nastavenia projektu** zapni *Zobraziť súbor manifestu „appsscript.json“*
     a jeho obsah nahraď obsahom `appsscript.json`.
4. Hore vyber funkciu `setup` a klikni **Spustiť**. Povoľ požadované oprávnenia.
   Do tabuľky sa vytvoria listy s hlavičkami.
5. **Nasadiť → Nové nasadenie → typ Webová aplikácia**:
   - *Spustiť ako:* **Používateľ, ktorý pristupuje k webovej aplikácii**
   - *Kto má prístup:* **Ktokoľvek s účtom Google**
6. Skopíruj URL webovej aplikácie (končí na `/exec`) a pošli ju ostatným.

Po zmene kódu treba urobiť **Nasadiť → Spravovať nasadenia → upraviť → Nová verzia**,
inak sa na `/exec` URL zmena neprejaví.

### Alternatíva: clasp (z príkazového riadku)

```bash
npm install -g @google/clasp
clasp login
cd apps_script
cp .clasp.json.example .clasp.json   # doplň scriptId (Nastavenia projektu → ID skriptu)
clasp push
```

Potom pokračuj krokmi 4–6.

## Prístup a zdieľanie – dôležité

Web app beží pod účtom toho, kto ju otvorí. Len tak Apps Script spoľahlivo zistí
e-mail používateľa aj pri bežných @gmail.com účtoch. Dôsledok je, že **každý člen
musí mať k tabuľke prístup ako Editor**:

- Keď v aplikácii zdieľaš domácnosť s e-mailom, aplikácia sa pokúsi pridať ho
  ako editora tabuľky automaticky (Google mu pošle e-mail).
- Ak sa to nepodarí, aplikácia zobrazí upozornenie a tabuľku treba zdieľať ručne
  (**Zdieľať → Editor**).
- Pri prvom otvorení web app musí každý používateľ povoliť oprávnenia.

Aplikácia sama kontroluje, že používateľ vidí a mení len domácnosti, ktorých je
členom. Kto má prístup k tabuľke, však v nej môže priamo vidieť a upravovať všetky
dáta. Aplikácia je preto vhodná pre rodinu alebo malú skupinu ľudí, ktorí si dôverujú.

## Rozdiely oproti Flutter verzii

- Používatelia sa identifikujú e-mailom (nie Firebase UID).
- Pri mesačnom opakovaní sa termín 31. posunie na posledný deň kratšieho mesiaca
  (Flutter verzia by z 31. 1. spravila 3. 3.).
- Ikona *dishes* používa symbol umývačky riadu (pôvodný symbol vo fonte Material
  Symbols neexistuje).
- Pozadie s textúrou nie je použité (obrázky sú príliš veľké na vloženie do Apps Script).
