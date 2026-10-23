// Čítanie súboru Excel (.xlsx) bez knižníc: .xlsx je ZIP s XML súbormi. Stačí nám
// mriežka hodnôt buniek (uložené výsledky vzorcov, texty zo sharedStrings) – vzorce,
// formáty ani grafy nepotrebujeme.

const MAX_FILES = 2000;
const MAX_UNZIPPED = 30 * 1024 * 1024;

/** Súbory v ZIP archíve: Map(názov → Uint8Array) – len tie, ktoré prejdú filtrom. */
export async function unzip(bytes, wanted = () => true) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Koniec centrálneho adresára (EOCD) je na konci súboru, za ním najviac 64 kB komentára.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  if (count > MAX_FILES) throw new Error('too many files');
  const files = new Map();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('bad central directory');
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    total += size;
    if (total > MAX_UNZIPPED) throw new Error('too large');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + compSize);
    if (method === 0) files.set(name, data);
    else if (method === 8) files.set(name, await inflate(data));
    else throw new Error('unsupported compression');
  }
  return files;
}

async function inflate(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeXml(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()]
  );
}

/** Text vnútri <si> / <is>: všetky <t>, bez fonetických prepisov (<rPh>). */
const richText = (xml) =>
  decodeXml(
    [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join('')
  );

function sharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((m) => (m[1] ? richText(m[1]) : ''));
}

/** „AB12“ → { row: 12, col: 28 }. */
function cellRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref || '');
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + ch.charCodeAt(0) - 64;
  return { row: Number(m[2]), col };
}

/** Bunky listu: [{ row, col, value }] – value je číslo alebo text (prázdne bunky vynechá). */
function sheetCells(xml, strings) {
  const cells = [];
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1];
    const body = m[2] || '';
    const ref = cellRef((/\br="([A-Z]+\d+)"/.exec(attrs) || [])[1]);
    if (!ref) continue;
    const type = (/\bt="(\w+)"/.exec(attrs) || [])[1] || 'n';
    const v = /<v>([\s\S]*?)<\/v>/.exec(body);
    let value;
    if (type === 's') value = v ? strings[Number(v[1])] : undefined;
    else if (type === 'inlineStr') value = richText((/<is>([\s\S]*?)<\/is>/.exec(body) || [])[1] || '');
    else if (type === 'str' || type === 'e') value = v ? decodeXml(v[1]) : undefined;
    else if (type === 'b') value = v ? v[1] === '1' : undefined;
    else value = v && v[1].trim() !== '' ? Number(v[1]) : undefined;
    if (value === undefined || value === '' || (typeof value === 'number' && !Number.isFinite(value))) continue;
    cells.push({ row: ref.row, col: ref.col, value });
  }
  return cells;
}

/** Všetky listy zošita: [{ name, cells }] v poradí ako v Exceli. */
export async function readWorkbook(bytes) {
  const files = await unzip(bytes, (n) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(n));
  const text = (name) => (files.has(name) ? new TextDecoder().decode(files.get(name)) : '');
  const strings = sharedStrings(text('xl/sharedStrings.xml'));
  const rels = new Map(
    [...text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
      (/\bId="([^"]+)"/.exec(m[0]) || [])[1],
      (/\bTarget="([^"]+)"/.exec(m[0]) || [])[1],
    ])
  );
  const sheets = [];
  for (const m of text('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const name = decodeXml((/\bname="([^"]*)"/.exec(m[0]) || [])[1] || '');
    let target = rels.get((/\br:id="([^"]+)"/.exec(m[0]) || [])[1]) || '';
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
    if (files.has(target)) sheets.push({ name, cells: sheetCells(text(target), strings) });
  }
  if (!sheets.length) {
    // zošit bez zoznamu listov (iné programy) – zober listy v poradí názvov
    for (const name of [...files.keys()].filter((n) => n.startsWith('xl/worksheets/')).sort()) {
      sheets.push({ name: name.replace(/^.*\/|\.xml$/g, ''), cells: sheetCells(text(name), strings) });
    }
  }
  return sheets;
}
