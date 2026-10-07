# Gazda – verzia pre Cloudflare

Nová verzia Gazdy na **Cloudflare Workers** s databázou **D1**. Beží zadarmo
(bezplatný plán Cloudflare), bez platobnej karty. Upozornenia budú len ako
push notifikácie priamo z aplikácie.

> Stav: **fáza 3 – aplikácia.** Gazda na Cloudflare má všetky funkcie verzie Apps Script
> okrem upozornení (push notifikácie pribudnú vo fáze 4) a dá sa nainštalovať na plochu.
> Dáta sa z Google tabuľky prenesú vo fáze 5; dovtedy Gazda beží aj na Apps Script.

## Súbory

| Súbor / priečinok | Obsah |
|---|---|
| `src/index.js` | Server (Worker): smerovanie `/api/*`, ostatné sú statické súbory |
| `src/api.js` | Funkcie API (rovnaké ako vo verzii Apps Script) |
| `src/domain.js` | Doménová logika: opakovanie, počet pri položkách, validácie |
| `src/auth.js` | Osobné odkazy (SHA-256 odtlačok kľúča, ako vo verzii Apps Script) |
| `src/notifications.js` | Push notifikácie (fáza 4) |
| `public/index.html`, `app.js`, `app.css`, `produkty.js` | Aplikácia (prevzatá z `apps_script/`, volá `/api/*` cez `fetch`) |
| `public/sw.js` | Service worker: otvorenie bez internetu (neskôr push) |
| `public/icons/` | Ikony aplikácie na plochu |
| `migrations/` | Štruktúra databázy D1 (SQL), aplikuje sa pri každom nasadení |
| `wrangler.json` | Nastavenie Workera; `database_id` doplní CI automaticky |
| `scripts/ensure-d1.mjs` | Nájde alebo pri prvom nasadení vytvorí databázu D1 |
| `test/` | Testy (lokálna D1, `npm test`) |

## API

`POST /api/<funkcia>` s telom `{"args": [...]}` a hlavičkou
`Authorization: Bearer <kľúč z osobného odkazu>`. Odpoveď je `{"result": …}`,
pri chybe `{"error": "text pre používateľa"}` (neplatný odkaz: HTTP 401 a text
začína `NEPLATNY_ODKAZ:`).

Funkcie: `getHouseholds`, `getStartData`, `createHousehold`, `shareHousehold`,
`createMemberLink`, `regenerateMyLink`, `deleteHousehold`, `getHouseholdData`,
`addPriestor`, `addCinnost`, `updateCinnost`, `addItem`, `toggleItem`,
`deleteCinnost`, `completeCinnost`. `GET /api/health` overí databázu.

Zápisy, ktoré patria k sebe (napr. činnosť s checklistom a našepkávaním), idú
jedným `batch` – D1 ich vykoná ako jednu transakciu.

## Aplikácia v telefóne

- Vstup cez osobný odkaz `https://gazda.<subdoména>.workers.dev/?k=<kľúč>`; kľúč sa
  uloží v telefóne, takže ďalšie otvorenie funguje aj bez neho.
- **Inštalácia na plochu:** Android/Chrome – menu ⋮ → *Pridať na plochu* (alebo
  *Inštalovať aplikáciu*); iPhone/Safari – *Zdieľať* → *Pridať na plochu*.
  Manifest (`/manifest.webmanifest?k=…`) generuje server a do `start_url` dá osobný
  kľúč, aby bola aplikácia z plochy hneď prihlásená (iPhone nezdieľa úložisko so Safari).
- **Automatická obnova:** otvorená domácnosť sa každých 20 s (a po návrate do
  aplikácie) potichu obnoví, takže zmeny od ostatných sa ukážu samé.
- **Bez internetu** sa Gazda otvorí z pamäte telefónu s poslednými údajmi.

## Databáza

Tabuľky zodpovedajú listom Google tabuľky: `households`, `members`, `priestory`,
`cinnosti`, `polozky`, `obchody`, `produkty`, `users`. Databáza sa vytvorí
v západnej Európe. Obchody a produkty sa porovnávajú podľa `name_key` (názov
malými písmenami aj s diakritikou), aby „Šunka“ a „šunka“ boli jeden produkt.

## Automatické nasadenie (GitHub Actions)

Workflow `.github/workflows/deploy-cloudflare.yml`:

- **Pull request** → testy a nasadenie na **náhľad** – samostatný worker
  `gazda-preview` s vlastnou databázou, takže skúšanie nezasiahne ostré údaje.
  Adresa náhľadu je v súhrne behu (Actions → beh → Summary).
- **Push do `main`** → testy, migrácie databázy a nasadenie na `gazda`.
- Kým nie sú nastavené secrets, nasadenie sa len preskočí (s upozornením).

### Jednorazové nastavenie

1. **Účet Cloudflare** – zaregistruj sa zadarmo na <https://dash.cloudflare.com/sign-up>.
2. **Subdoména workers.dev** – Cloudflare ju novým účtom pridelí sám (nič netreba
   nastavovať). Nájdeš ju v **Workers & Pages** vpravo v časti **Account details →
   Subdomain** (tlačidlom *Change* sa dá premenovať). Gazda pobeží na
   `https://gazda.<subdoména>.workers.dev`.
3. **ID účtu** – v tej istej časti **Account details** (alebo v URL po
   `dash.cloudflare.com/`) je **Account ID**. Skopíruj ho.
4. **API token** – vpravo hore ikona profilu → **Profile → API Tokens → Create Token**:
   - šablóna **Edit Cloudflare Workers** → *Use template*
   - pridaj riadok oprávnení: **Account → D1 → Edit**
   - *Account Resources*: tvoj účet; *Zone Resources*: **All zones** (alebo nechaj predvolené)
   - **Continue to summary → Create Token** a token skopíruj (zobrazí sa len raz).
5. **GitHub secrets** – v repozitári **Settings → Secrets and variables → Actions →
   New repository secret**:
   - `CLOUDFLARE_API_TOKEN` = token z kroku 4
   - `CLOUDFLARE_ACCOUNT_ID` = ID z kroku 3
6. Spusti nasadenie: **Actions → Nasadenie Cloudflare → Run workflow** (vetva `main`).
   Adresa Gazdy je v súhrne behu.

7. **Heslo správcu (nepovinné)** – v GitHub secrets pridaj `GAZDA_ADMIN_KEY` = dlhé
   heslo, ktoré si vymyslíš (aspoň 12 znakov, ulož si ho do správcu hesiel).
   Pri nasadení sa nastaví do Cloudflare a otvorí stránku
   `https://gazda.<subdoména>.workers.dev/admin.html`, kde po zadaní hesla a e-mailu
   vznikne osobný odkaz (náhrada funkcie `mojOdkaz` z Apps Script). Repozitár je
   verejný, preto sa odkazy nikdy nevypisujú do GitHub Actions.

Token aj heslo správcu sú ako heslá – vkladaj ich len do GitHub secrets, nikomu ich neposielaj.

## Lokálne

```sh
cd cloudflare
npm install
npm test          # testy na lokálnej databáze
npm run dev       # lokálny server na http://localhost:8787
```

Pred `npm run dev` treba lokálne aplikovať migrácie:
`npx wrangler d1 migrations apply DB --local --env=""`.
