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

**users** – používatelia

| email | ntfyTopic | createdAt | lastHouseholdId | tokenHash |
|---|---|---|---|---|

- `ntfyTopic` – náhodný názov témy v ntfy, na ktorú chodia upozornenia (vytvorí sa
  pri prvom otvorení okna *Upozornenia*)
- `lastHouseholdId` – naposledy otvorená domácnosť; pri ďalšom spustení sa otvorí rovno ona
- `tokenHash` – SHA-256 odtlačok kľúča z osobného odkazu (samotný kľúč sa neukladá)

## Funkcie

- Vstup cez **osobný odkaz** (`…/exec?k=…`) – funguje na každom telefóne aj s viacerými Google účtami, bez prihlasovania
- Domácnosti: vytvorenie, zdieľanie podľa e-mailu, vymazanie (len zakladateľ)
- Aplikácia si pamätá naposledy otvorenú domácnosť a pri spustení ju rovno otvorí
  (na každom zariadení; šípka späť vráti na zoznam domácností)
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

Oprávnenia povoľuje len vlastník skriptu (aplikácia beží pod jeho účtom).

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
4. Hore vyber funkciu `setup` a klikni **Spustiť**. Povoľ požadované oprávnenia
   (zaškrtni **Vybrať všetko**).
   Do tabuľky sa vytvoria listy s hlavičkami.
5. **Nasadiť → Nové nasadenie → typ Webová aplikácia**:
   - *Spustiť ako:* **Ja**
   - *Kto má prístup:* **Ktokoľvek**
6. Otvor raz URL webovej aplikácie (končí na `/exec`) – aplikácia si tak zapamätá
   svoju adresu. Zobrazí sa „Otvor Gazdu cez svoj odkaz“, to je v poriadku.
7. V editore spusti funkciu **`mojOdkaz`**. V *Denníku spustení* sa vypíše tvoj osobný
   odkaz. Otvor ho v telefóne a ulož si ho na plochu (menu prehliadača → *Pridať na plochu*).
8. Ostatných pozveš v aplikácii: pri domácnosti ťukni na **Zdieľať**, zadaj ich e-mail
   a pošli im odkaz, ktorý sa zobrazí (WhatsApp, SMS…).

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

## Prístup a osobné odkazy

Web app beží pod účtom vlastníka skriptu (*Spustiť ako: Ja*, *Kto má prístup:
Ktokoľvek*). Používateľov neidentifikuje Google prihlásenie, ale **osobný odkaz**:

```
https://script.google.com/macros/s/AKfycb…/exec?k=8f3a9c1e…   (32 znakov)
```

- Kľúč z odkazu patrí jednému e-mailu. Všetko ostatné (členstvo v domácnostiach,
  pridelené úlohy, upozornenia) sa ďalej viaže na e-mail.
- V liste `users` je len **SHA-256 odtlačok** kľúča (`tokenHash`), samotný kľúč sa
  nikde neukladá. Každé volanie z prehliadača kľúč posiela a server ho overí.
- Prehliadač si kľúč zapamätá, takže sa aplikácia otvorí aj z upozornenia (adresa bez `?k=`).
- **Funguje na každom zariadení** – aj s viacerými Google účtami, aj bez Google účtu.
- **Tabuľku netreba s nikým zdieľať** – vidí ju len vlastník. Ak si ju predtým
  zdieľal s členmi ako Editor, zdieľanie môžeš zrušiť.

### Kto môže vytvoriť odkaz

| Situácia | Kto |
|---|---|
| Vlastník skriptu (prvý odkaz) | funkcia `mojOdkaz` v editore |
| Nový člen pri zdieľaní domácnosti | ktokoľvek z domácnosti – odkaz sa ukáže hneď |
| Člen, ktorý odkaz ešte nemá | ktokoľvek z domácnosti – tlačidlo **Vytvoriť odkaz** v okne Zdieľať |
| Nový odkaz pre seba (stratený / prezradený) | každý sám – ťukni na svoj avatar → **Vytvoriť nový odkaz** |
| Nový odkaz pre iného člena | zakladateľ domácnosti – **Nový odkaz** v okne Zdieľať |

Vytvorením nového odkazu prestane starý fungovať.

> Odkaz funguje ako heslo – kto ho má, vystupuje v aplikácii ako daný človek.
> Posielaj ho len tomu, komu patrí. Funkcie pre editor (`setup`, `mojOdkaz`,
> `testRannyPrehlad`) sa z webu spustiť nedajú.

## Rozdiely oproti Flutter verzii

- Používatelia sa identifikujú e-mailom cez osobný odkaz (nie Firebase UID / Google prihlásenie).
- Pri mesačnom opakovaní sa termín 31. posunie na posledný deň kratšieho mesiaca
  (Flutter verzia by z 31. 1. spravila 3. 3.).
- Ikona *dishes* používa symbol umývačky riadu (pôvodný symbol vo fonte Material
  Symbols neexistuje).
- Pozadie s textúrou nie je použité (obrázky sú príliš veľké na vloženie do Apps Script).
