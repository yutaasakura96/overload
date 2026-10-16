// The MEXT catalogue (S12): 日本食品標準成分表（八訂）増補2023年, as `reference_food` (docs/04).
//
// Two steps, both in this file:
//
// 1. `pnpm --filter @overload/api seed:mext extract <ja.xlsx> <en.xlsx>` reads MEXT's own Excel
//    files and writes `mext-2023.tsv`, the five values per 100 g this app uses and nothing else.
//    - <ja.xlsx>: 第2章（データ） of the 増補2023年 page, as republished with the 正誤表 of
//      2026-03-27 (https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html,
//      content/20260327-mxt_kagsei-mext-000029402_02.xlsx). Its values already carry the errata.
//    - <en.xlsx>: the English table of the 2015 seventh edition
//      (https://www.mext.go.jp/en/policy/science_technology/policy/title01/detail01/sdetail01/sdetail01/1385122.htm,
//      component/english/__icsFiles/afieldfile/2017/12/25/1374049_1r12_1.xlsx). MEXT published no
//      English 八訂, and a 食品番号 keeps its food across editions, so a food in both gets the 2015
//      English name; one added since has none, and shows its Japanese name only.
// 2. `pnpm --filter @overload/api seed:mext` writes the seed migration from the TSV. The migration
//    is what ships; a correction is a new migration (docs/12 §3).
//
// The columns, by MEXT's 成分識別子 (docs/06, 2026-10-16):
// - energy: ENERC_KCAL. protein: PROT- (たんぱく質), what a 栄養成分表示 prints, rather than PROTCAA.
//   fat: FAT- (脂質), likewise. fiber: FIB- (食物繊維総量).
// - carbohydrate: CHOAVL, 利用可能炭水化物（質量計）, the sugars and starch by mass, without fibre,
//   which is its own value. A food MEXT gives none for falls back to CHOAVLDF-, 差引き法による利用可能
//   炭水化物. Chicken breast is 0.1 g by the first and 3.4 g by the second, the remainder of its
//   protein and fat sums, so the difference method is only the fallback.
// - `Tr` (trace) is 0. A value in parentheses, MEXT's estimate, is taken as it stands. `-` (not
//   measured) is 0 for fibre; a food without energy, protein, fat or either carbohydrate is left out.
// - `state` is `cooked` when the name has one of MEXT's cooking words (ゆで, 焼き, めし…), else `raw`.
//
// Credited in the app as edited from the MEXT source (docs/06, 2026-09-19).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

export type ReferenceFoodRow = {
  code: string;
  foodGroup: number;
  state: 'raw' | 'cooked';
  name: string;
  nameEn: string | null;
  energyKcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fiberG: number;
};

export const tsvPath = fileURLToPath(new URL('./mext-2023.tsv', import.meta.url));
export const seedMigrationPath = fileURLToPath(
  new URL('../migrations/0018_seed_reference_food.sql', import.meta.url),
);

const TSV_COLUMNS = [
  'code',
  'foodGroup',
  'state',
  'name',
  'nameEn',
  'energyKcal',
  'proteinG',
  'carbG',
  'fatG',
  'fiberG',
] as const;

// ------------------------------------------------------------------------------------------------
// Reading an .xlsx: a zip of XML parts. Only what MEXT's files use: the first sheet, shared strings,
// inline strings and numbers.

function unzip(file: Buffer): Map<string, Buffer> {
  // The end of central directory record: signature 0x06054b50, within the last 64 KB.
  let end = -1;
  for (let i = file.length - 22; i >= Math.max(0, file.length - 65_557); i -= 1) {
    if (file.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('Not a zip file');
  const entries = file.readUInt16LE(end + 10);
  let at = file.readUInt32LE(end + 16);
  const parts = new Map<string, Buffer>();
  for (let n = 0; n < entries; n += 1) {
    if (file.readUInt32LE(at) !== 0x02014b50) throw new Error('Bad central directory');
    const method = file.readUInt16LE(at + 10);
    const compressed = file.readUInt32LE(at + 20);
    const nameLength = file.readUInt16LE(at + 28);
    const extraLength = file.readUInt16LE(at + 30);
    const commentLength = file.readUInt16LE(at + 32);
    const local = file.readUInt32LE(at + 42);
    const name = file.toString('utf8', at + 46, at + 46 + nameLength);
    const dataStart = local + 30 + file.readUInt16LE(local + 26) + file.readUInt16LE(local + 28);
    const data = file.subarray(dataStart, dataStart + compressed);
    parts.set(name, method === 0 ? Buffer.from(data) : inflateRawSync(data));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return parts;
}

const unescapeXml = (text: string) =>
  text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replaceAll('&amp;', '&');

/** The text of a string item: every `<t>` in it, phonetic runs (`<rPh>`) left out. */
const itemText = (xml: string) =>
  [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
    .map((match) => unescapeXml(match[1] ?? ''))
    .join('');

/** `A` is 0, `Z` 25, `AA` 26: the column of a cell reference such as `AB13`. */
function columnIndex(ref: string) {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? '';
  let index = 0;
  for (let i = 0; i < letters.length; i += 1) index = index * 26 + letters.charCodeAt(i) - 64;
  return index - 1;
}

/** The first sheet as rows of cell text, by row and column index from 0. */
export function readFirstSheet(path: string): string[][] {
  const parts = unzip(readFileSync(path));
  const shared = [
    ...(parts.get('xl/sharedStrings.xml')?.toString('utf8') ?? '').matchAll(
      /<si>([\s\S]*?)<\/si>/g,
    ),
  ].map((match) => itemText(match[1] ?? ''));
  const sheet = parts.get('xl/worksheets/sheet1.xml')?.toString('utf8');
  if (sheet === undefined) throw new Error('No first sheet');
  const rows: string[][] = [];
  for (const row of sheet.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cell of (row[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cell[1] ?? '';
      const ref = attributes.match(/\br="([A-Z]+\d+)"/)?.[1] ?? '';
      const type = attributes.match(/\bt="(\w+)"/)?.[1];
      const body = cell[2] ?? '';
      const value = unescapeXml(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '');
      cells[columnIndex(ref)] =
        type === 's'
          ? (shared[Number(value)] ?? '')
          : type === 'inlineStr'
            ? itemText(body)
            : value;
    }
    rows[Number(row[1]) - 1] = Array.from(cells, (text) => text ?? '');
  }
  return Array.from(rows, (row) => row ?? []);
}

// ------------------------------------------------------------------------------------------------
// From MEXT's cells to the five values.

/** A MEXT value: `Tr` is 0, `(3.4)` is 3.4, `-` and an empty cell are no value. */
export function mextValue(cell: string | undefined): number | null {
  const text = (cell ?? '').replace(/[()（）†*\s]/g, '');
  if (text === '' || text === '-') return null;
  if (text === 'Tr') return 0;
  const value = Number(text);
  if (!Number.isFinite(value)) throw new Error(`Unreadable MEXT value: ${cell}`);
  return Math.round(value * 100) / 100;
}

/** MEXT's cooking words, as they appear in its food names. */
const COOKED = [
  'ゆで',
  '焼き',
  '焼',
  '蒸し',
  '煮',
  'いため',
  '揚げ',
  '天ぷら',
  'フライ',
  'ソテー',
  '電子レンジ調理',
  'めし',
  'かゆ',
  'おもゆ',
  'とんかつ',
];

export const mextState = (name: string): 'raw' | 'cooked' =>
  COOKED.some((word) => name.includes(word)) ? 'cooked' : 'raw';

/** An English 2015 name without its footnote marks: `Common oats*, oatmeal, raw\n［*Syn. Oats］`. */
const cleanEnglish = (name: string) =>
  name
    .replace(/[［[][^］\]]*[］\]]/g, '')
    .replaceAll('*', '')
    .replace(/\s+/g, ' ')
    .trim();

/** MEXT's name as it prints it, trimmed. */
const cleanName = (name: string) => name.replace(/^[\s　]+|[\s　]+$/g, '');

const isCode = (text: string | undefined) => /^\d{5}$/.test(text ?? '');

export function extract(jaPath: string, enPath: string): ReferenceFoodRow[] {
  const english = new Map<string, string>();
  for (const row of readFirstSheet(enPath)) {
    if (isCode(row[1]) && (row[3] ?? '') !== '')
      english.set(row[1] ?? '', cleanEnglish(row[3] ?? ''));
  }
  const foods: ReferenceFoodRow[] = [];
  for (const row of readFirstSheet(jaPath)) {
    const code = row[1];
    if (code === undefined || !isCode(code)) continue;
    const name = cleanName(row[3] ?? '');
    const energyKcal = mextValue(row[6]);
    const proteinG = mextValue(row[9]);
    const fatG = mextValue(row[12]);
    const carbG = mextValue(row[15]) ?? mextValue(row[16]);
    if (energyKcal === null || proteinG === null || fatG === null || carbG === null) continue;
    foods.push({
      code,
      foodGroup: Number(row[0]),
      state: mextState(name),
      name,
      nameEn: english.get(code) ?? null,
      energyKcal,
      proteinG,
      carbG,
      fatG,
      fiberG: mextValue(row[18]) ?? 0,
    });
  }
  return foods;
}

// ------------------------------------------------------------------------------------------------
// The TSV and the migration.

export function toTsv(foods: ReferenceFoodRow[]): string {
  const lines = foods.map((food) =>
    TSV_COLUMNS.map((column) => (food[column] === null ? '' : String(food[column]))).join('\t'),
  );
  return `${[TSV_COLUMNS.join('\t'), ...lines].join('\n')}\n`;
}

export function readTsv(text = readFileSync(tsvPath, 'utf8')): ReferenceFoodRow[] {
  const [, ...lines] = text.trimEnd().split('\n');
  return lines.map((line) => {
    const [code, group, state, name, nameEn, kcal, protein, carb, fat, fiber] = line.split('\t');
    if (state !== 'raw' && state !== 'cooked') throw new Error(`Bad state on ${code}`);
    return {
      code: code ?? '',
      foodGroup: Number(group),
      state,
      name: name ?? '',
      nameEn: nameEn === undefined || nameEn === '' ? null : nameEn,
      energyKcal: Number(kcal),
      proteinG: Number(protein),
      carbG: Number(carb),
      fatG: Number(fat),
      fiberG: Number(fiber),
    };
  });
}

const quote = (text: string | null) => (text === null ? 'NULL' : `'${text.replaceAll("'", "''")}'`);
const figure = (value: number) => value.toFixed(2);

export function seedMigration(foods: ReferenceFoodRow[] = readTsv()): string {
  const rows = foods.map(
    (food) =>
      `  (${quote(food.code)}, ${quote(food.name)}, ${quote(food.nameEn)}, ${food.foodGroup}, ` +
      `${quote(food.state)}, ${figure(food.energyKcal)}, ${figure(food.proteinG)}, ` +
      `${figure(food.carbG)}, ${figure(food.fatG)}, ${figure(food.fiberG)})`,
  );
  return [
    '-- Generated by apps/api/seed/mext.ts from seed/mext-2023.tsv. Do not edit by hand; a correction',
    '-- is a new migration. Source: 日本食品標準成分表（八訂）増補2023年 (MEXT), edited: five values per',
    '-- 100 g, and English names from the 2015 English table where the food number matches.',
    '-- Custom migration (docs/12 §3): drizzle-kit made the empty file and its journal entry.',
    '',
    'INSERT INTO reference_food',
    '  (code, name, name_en, food_group, state, energy_kcal, protein_g, carb_g, fat_g, fiber_g)',
    'VALUES',
    `${rows.join(',\n')};`,
    '',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, jaPath, enPath] = process.argv.slice(2);
  if (command === 'extract') {
    if (jaPath === undefined || enPath === undefined) {
      throw new Error('Usage: seed:mext extract <ja.xlsx> <en.xlsx>');
    }
    writeFileSync(tsvPath, toTsv(extract(jaPath, enPath)));
  } else {
    writeFileSync(seedMigrationPath, seedMigration());
  }
}
