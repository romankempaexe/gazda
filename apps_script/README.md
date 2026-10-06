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
| `Produkty.html` | Vstavaný zoznam bežných potravín a drogérie pre našepkávanie |
| `appsscript.json` | Manifest: časová zóna, oprávnenia, nastavenie web app |

## Dátová štruktúra (Google tabuľka)

Funkcia `setup()` vytvorí osem listov (chýbajúci list sa vytvorí aj automaticky pri prvom použití). Prvý riadok je hlavička, všetky hodnoty
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

| id | householdId | priestorId | name | description | assignedTo | icon | color | dueDate | periodicity | repeatInterval | createdAt | kind | store |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

- `assignedTo` – e-mail člena domácnosti (prázdne = nepriradené)
- `periodicity` – `none`, `weekly`, `monthly` alebo `annually`
- `repeatInterval` – každých X týždňov/mesiacov/rokov (pri `none` prázdne)
- `icon` – názov ikony (`home`, `kitchen`, `trash`, …), `color` – hex farba (`#4CAF50`)
- `kind` – `nakup` pri nákupe, inak prázdne; `store` – obchod (len pri nákupe)
- `priestorId` – pri nákupe môže byť prázdne

**polozky** – položky checklistu činnosti (`done` = `1` ak je odškrtnutá)

| id | cinnostId | householdId | text | done | position | createdAt | createdBy | qty |
|---|---|---|---|---|---|---|---|---|

- `qty` – počet, napr. `2 ks`, `1,5 kg`, `1 bal.` (prázdne = bez počtu)

**obchody** – obchody, ktoré domácnosť už zadala (našepkávajú sa)

| householdId | name | createdAt |
|---|---|---|

**produkty** – produkty, ktoré domácnosť už nakupovala (`uses` = koľkokrát; častejšie sa našepkávajú skôr)

| householdId | name | uses | lastUsed |
|---|---|---|---|

**users** – používatelia

| email | ntfyTopic | createdAt | lastHouseholdId | tokenHash | notifyChannel | telegramChatId | telegramLinkCode |
|---|---|---|---|---|---|---|---|

- `lastHouseholdId` – naposledy otvorená domácnosť; pri ďalšom spustení sa otvorí rovno ona
- `tokenHash` – SHA-256 odtlačok kľúča z osobného odkazu (samotný kľúč sa neukladá)
- `notifyChannel` – `telegram`, `email` alebo `none` (prázdne = e-mail, resp. Telegram ak je prepojený)
- `telegramChatId` – chat s Telegram botom; `telegramLinkCode` – jednorazový kód na prepojenie
- `ntfyTopic` – už sa nepoužíva (zostáva, aby sa neposunuli stĺpce)

## Funkcie

- Vstup cez **osobný odkaz** (`…/exec?k=…`) – funguje na každom telefóne aj s viacerými Google účtami, bez prihlasovania
- Domácnosti: vytvorenie, zdieľanie podľa e-mailu, vymazanie (len zakladateľ)
- Aplikácia si pamätá naposledy otvorenú domácnosť a pri spustení ju rovno otvorí
  (na každom zariadení; šípka späť vráti na zoznam domácností)
- **Môj rozpis** – moje činnosti na vybraný deň, tlačidlo *Hotové*
  (jednorazová činnosť sa vymaže, opakovaná sa posunie na ďalší termín; ak bola
  po termíne, na najbližší termín po dnešku)
- **Po termíne** – v *Môj rozpis* hore blok úloh, ktorých termín prešiel, a červené
  číslo na záložke
- **Checklist pri každej činnosti** – položky s počtom sú priamo na karte úlohy a dajú
  sa odškrtávať rovno tam (na karte je aj stav, napr. `2/5`); ťuknutím na kartu sa otvorí
  detail, kde sa dajú pridávať ďalšie položky
- **Nákup** – prepínač *Nákup* vo formulári: obchod (zapamätá sa pre ďalšie použitie
  a našepkáva sa) a zoznam produktov s našepkávaním z vstavaného zoznamu ~340 potravín
  a vecí do domácnosti plus produktov, ktoré domácnosť už kupovala.
  Pri položke sa dá zadať **počet** – tlačidlami **− / +** (kusy po 1, kg a l po 0,5,
  g a ml po 100), prepísaním políčka alebo priamo v texte: `2x mlieko`, `mlieko 2 ks`,
  `1,5 kg zemiaky`; do našepkávania sa ukladá len názov.
- **Nákup bez priestoru** – pri *Nová činnosť* je hore voľba *Nákup*, ktorá nepýta
  priestor (v úprave je možnosť *Bez priestoru*); ostatné činnosti priestor potrebujú
  Pri opakovanom nákupe sa po *Hotové* odškrtnuté položky odstránia a neodškrtnuté zostanú
- **Úprava činnosti** – tlačidlom *Upraviť* v detaile (alebo ✏️ v Plánovaní) sa dá zmeniť názov,
  popis, priestor, pridelenie, termín, opakovanie, ikona, farba aj checklist; úlohu možno
  vo formulári aj vymazať
- **Plánovanie** – všetky činnosti domácnosti na vybraný deň, filter podľa člena,
  pridanie a vymazanie činnosti
- Priestory, ikony, farby a opakovanie ako vo Flutter verzii
- **Upozornenia** e-mailom alebo cez Telegram: ranný prehľad o 8:00, nová pridelená úloha,
  úlohy po termíne (pozri nižšie)

## Upozornenia (e-mail / Telegram)

| Upozornenie | Kedy |
|---|---|
| 🏠 **Dnes ťa čaká X úloh** | každé ráno medzi 8:00 a 8:15 – úlohy s termínom dnes |
| ⚠️ **Po termíne: X úloh** | ráno spolu s prehľadom – úlohy, ktorých termín už prešiel |
| 📝 **Nová úloha od …** | hneď, keď ti niekto iný pridelí činnosť – s obchodom, termínom, popisom a celým checklistom |

Každý si v Gazdovi cez 🔔 vyberie, ako mu majú chodiť:

- **E-mail** (predvolené) – z Gmailu vlastníka skriptu na e-mail člena. Nič netreba
  nastavovať; s aplikáciou Gmail príde aj push notifikácia. Limit Gmailu je 100 e-mailov denne.
- **Telegram** – okamžité push notifikácie od bota s tlačidlom *Otvoriť Gazdu*.
- **Vypnuté**.

Ak člen bota v Telegrame zablokuje alebo pošle `/stop`, prepojenie sa zruší a upozornenia
mu ďalej chodia e-mailom.

### Zapnutie (raz, robí vlastník skriptu)

1. Nahraj nový kód a v editore spusti funkciu **`setup`** – povoľ oprávnenia
   (posielanie e-mailov a pripojenie k externým službám, zaškrtni **Vybrať všetko**).
2. V editore klikni vľavo na ⏰ **Spúšťače → + Pridať spúšťač** a nastav:
   - Funkcia: **`notificationTick`**, Nasadenie: **Head**
   - Zdroj udalosti: **Časovo riadený**, Typ: **Časovač minút**, **Každých 15 minút**
3. Ranný prehľad sa dá vyskúšať hneď funkciou **`testRannyPrehlad`**.

### Telegram bot (voliteľné, raz)

1. V Telegrame otvor **@BotFather**, pošli `/newbot`, zadaj meno (napr. *Gazda*) a
   používateľské meno končiace na `bot` (napr. *GazdaNovakovciBot*).
2. BotFather pošle **token** (`123456789:AA…`). V editore otvor ⚙️ **Nastavenia projektu →
   Vlastnosti skriptu** a pridaj vlastnosť **`TELEGRAM_BOT_TOKEN`** s týmto tokenom.

Token bota je tajný – patrí len do Vlastností skriptu.

### Prepojenie Telegramu (každý člen)

1. Nainštaluj si Telegram.
2. V Gazdovi ťukni na 🔔 → **Prepojiť s Telegramom** → v Telegrame ťukni **Štart**.
3. Vráť sa do Gazdu a ťukni **Overiť prepojenie** (inak sa prepojenie dokončí samo do 15 minút).
4. Ťukni **Vyskúšať**.

Bot správy číta cez `getUpdates` (pri overení a pri každom spustení `notificationTick`),
webhook netreba nastavovať.

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

## Výkon

- **Server:** každý list tabuľky sa v rámci jedného volania číta najviac raz (jedným
  `getDataRange().getValues()`) a obsah sa na 5 minút drží v `CacheService`. Každý zápis
  z aplikácie pamäť okamžite zneplatní. **Ručné úpravy priamo v tabuľke** sa v aplikácii
  prejavia najneskôr do 5 minút.
- **Prehliadač:** posledné načítané údaje sú uložené v telefóne, takže sa aplikácia
  zobrazí hneď a čerstvé údaje dotiahne na pozadí (ak je otvorené okno, neprekreslí sa).
- **Ikony:** z Google Fonts sa sťahujú len ikony, ktoré aplikácia používa (parameter
  `icon_names` v `Index.html`, ~32 kB namiesto ~5 MB). **Pri pridaní novej ikony** ju treba
  doplniť do tohto zoznamu (abecedne), inak sa zobrazí ako text.

## Rozdiely oproti Flutter verzii

- Používatelia sa identifikujú e-mailom cez osobný odkaz (nie Firebase UID / Google prihlásenie).
- Pri mesačnom opakovaní sa termín 31. posunie na posledný deň kratšieho mesiaca
  (Flutter verzia by z 31. 1. spravila 3. 3.).
- Ikona *dishes* používa symbol umývačky riadu (pôvodný symbol vo fonte Material
  Symbols neexistuje).
- Pozadie s textúrou nie je použité (obrázky sú príliš veľké na vloženie do Apps Script).
