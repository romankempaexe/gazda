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

Funkcia `setup()` vytvorí päť listov (chýbajúci list sa vytvorí aj automaticky pri prvom použití). Prvý riadok je hlavička, všetky hodnoty
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

**users** – nastavenia používateľov

| email | ntfyTopic | createdAt |
|---|---|---|

- `ntfyTopic` – náhodný názov témy v ntfy, na ktorú chodia upozornenia (vytvorí sa
  pri prvom otvorení okna *Upozornenia*)

## Funkcie

- Prihlásenie Google účtom (rieši Google automaticky)
- Domácnosti: vytvorenie, zdieľanie podľa e-mailu, vymazanie (len zakladateľ)
- **Môj rozpis** – moje činnosti na vybraný deň, tlačidlo *Hotové*
  (jednorazová činnosť sa vymaže, opakovaná sa posunie na ďalší termín)
- **Plánovanie** – všetky činnosti domácnosti na vybraný deň, filter podľa člena,
  pridanie a vymazanie činnosti
- Priestory, ikony, farby a opakovanie ako vo Flutter verzii
- **Upozornenia na telefón** cez ntfy: ranný prehľad o 8:00, nová pridelená úloha,
  úlohy po termíne (pozri nižšie)

## Upozornenia (ntfy)

Upozornenia chodia ako push notifikácie cez bezplatnú aplikáciu
[ntfy](https://ntfy.sh) (Android aj iPhone):

| Upozornenie | Kedy |
|---|---|
| **Dnes ťa čaká X úloh** | každé ráno medzi 8:00 a 8:15 – úlohy s termínom dnes |
| **Po termíne: X úloh** | ráno spolu s prehľadom – úlohy, ktorých termín už prešiel |
| **Nová úloha od …** | hneď, keď ti niekto iný pridelí činnosť |

Upozornenie sa posiela len tým, kto má priradenú úlohu a otvoril si v aplikácii
okno *Upozornenia* (zvonček vpravo hore).

### Zapnutie (raz, robí vlastník skriptu)

1. Nahraj nový kód a v editore spusti funkciu **`setup`** – Google si vypýta nové
   oprávnenie *Pripojenie k externej službe*. Zaškrtni **Vybrať všetko**.
2. V editore klikni vľavo na ⏰ **Spúšťače → + Pridať spúšťač** a nastav:
   - Funkcia: **`notificationTick`**
   - Nasadenie: **Head**
   - Zdroj udalosti: **Časovo riadený**
   - Typ: **Časovač minút**, interval **Každých 15 minút**
3. Ulož. Ranný prehľad sa dá vyskúšať hneď funkciou **`testRannyPrehlad`**.
4. Vytvor novú verziu nasadenia (alebo pushni do `main`, ak používaš GitHub Actions).

Pri ďalšom otvorení aplikácie si všetci členovia musia povoliť nové oprávnenie –
aplikácia im ukáže tlačidlo **Povoliť prístup**.

### Prihlásenie na odber (každý člen)

1. Nainštaluj si aplikáciu **ntfy**.
2. V Gazdovi ťukni na 🔔 vpravo hore, skopíruj názov svojej témy a v ntfy ťukni
   na **+**, vlož ho a ťukni **Prihlásiť odber** (alebo ťukni na **Otvoriť v ntfy**).
3. Ťukni na **Poslať skúšobné upozornenie**.

### Voliteľné nastavenia (Nastavenia projektu → Vlastnosti skriptu)

| Vlastnosť | Význam |
|---|---|
| `NTFY_TOKEN` | prístupový token z bezplatného účtu na ntfy.sh – limity sa potom počítajú na tvoj účet, nie na zdieľané IP adresy Google |
| `NTFY_SERVER` | vlastný ntfy server (predvolene `https://ntfy.sh`) |
| `APP_URL` | adresa web app, ktorá sa otvorí po ťuknutí na upozornenie (nastaví sa sama pri otvorení `/exec`) |

> Názov témy funguje ako heslo – kto ho pozná, vidí upozornenia. V upozorneniach sú
> len názvy úloh, priestorov a domácností.

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
inak sa na `/exec` URL zmena neprejaví. Toto sa dá zautomatizovať (pozri nižšie).

### Alternatíva: clasp (z príkazového riadku)

```bash
npm install -g @google/clasp@3.4.1
clasp login
cd apps_script
cp .clasp.json.example .clasp.json   # doplň scriptId (Nastavenia projektu → ID skriptu)
clasp push
```

Potom pokračuj krokmi 4–6.

## Automatické nasadenie (GitHub Actions)

Workflow `.github/workflows/deploy-apps-script.yml` sa spustí po každom pushnutí
zmien v `apps_script/` do vetvy `main`. Nahrá kód do Apps Script (`clasp push`),
vytvorí novú verziu a aktualizuje existujúce nasadenie (`clasp redeploy`), takže
URL web app zostáva rovnaká. Pri pull requeste len skontroluje syntax. Dá sa
spustiť aj ručne: **Actions → Nasadenie Apps Script → Run workflow**.

### Jednorazové nastavenie

1. Urob prvé nasadenie ručne (kroky 1–6 vyššie), aby existoval projekt aj nasadenie web app.
2. Zapni **Google Apps Script API** na
   [script.google.com/home/usersettings](https://script.google.com/home/usersettings).
3. Na svojom počítači sa prihlás do clasp tým istým Google účtom, ktorý vlastní skript:

   ```bash
   npx @google/clasp@3.4.1 login
   ```

   Vytvorí sa súbor `~/.clasprc.json` (vo Windows `C:\Users\<meno>\.clasprc.json`).
4. Zisti ID:
   - **ID skriptu:** Apps Script editor → ⚙️ Nastavenia projektu → *ID skriptu*
   - **ID nasadenia:** **Nasadiť → Spravovať nasadenia** → pri webovej aplikácii
     *ID nasadenia* (začína `AKfycb…`)
5. V GitHub repozitári otvor **Settings → Secrets and variables → Actions → New repository secret**
   a pridaj:

   | Názov | Hodnota |
   |---|---|
   | `CLASPRC_JSON` | celý obsah súboru `~/.clasprc.json` |
   | `APPS_SCRIPT_ID` | ID skriptu |
   | `APPS_SCRIPT_DEPLOYMENT_ID` | ID nasadenia web app |

Odvtedy stačí zmeny zmergovať do `main` a o minútu sú nasadené.

> `CLASPRC_JSON` obsahuje prístup k tvojim Apps Script projektom, nikdy ho nedávaj
> do kódu. Ak ho chceš zneplatniť, odober prístup aplikácii *clasp* na
> [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

Ak workflow zlyhá na prihlásení (`invalid_grant`), zopakuj krok 3 a aktualizuj
secret `CLASPRC_JSON`. Ak sa zmenil `appsscript.json` a pribudli nové oprávnenia,
otvor web app raz v prehliadači a oprávnenia povoľ.

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
