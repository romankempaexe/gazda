# Gazda – verzia pre Cloudflare

Nová verzia Gazdy na **Cloudflare Workers** s databázou **D1**. Beží zadarmo
(bezplatný plán Cloudflare), bez platobnej karty. Upozornenia budú len ako
push notifikácie priamo z aplikácie.

> Stav: **fáza 2 – server.** API má všetky funkcie Gazdy (domácnosti, odkazy, priestory,
> činnosti, checklist, nákup); aplikácia v prehliadači sa naň napojí vo fáze 3.
> Gazda ďalej beží na Google Apps Script (`apps_script/`).

## Súbory

| Súbor / priečinok | Obsah |
|---|---|
| `src/index.js` | Server (Worker): smerovanie `/api/*`, ostatné sú statické súbory |
| `src/api.js` | Funkcie API (rovnaké ako vo verzii Apps Script) |
| `src/domain.js` | Doménová logika: opakovanie, počet pri položkách, validácie |
| `src/auth.js` | Osobné odkazy (SHA-256 odtlačok kľúča, ako vo verzii Apps Script) |
| `src/notifications.js` | Push notifikácie (fáza 4) |
| `public/` | Statické súbory stránky |
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

Token je ako heslo – vkladaj ho len do GitHub secrets, nikomu ho neposielaj.

## Lokálne

```sh
cd cloudflare
npm install
npm test          # testy na lokálnej databáze
npm run dev       # lokálny server na http://localhost:8787
```

Pred `npm run dev` treba lokálne aplikovať migrácie:
`npx wrangler d1 migrations apply DB --local --env=""`.
