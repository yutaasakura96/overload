// Builds the one self-contained file: node docs/prototype/m2/src/build.mjs, from the repository root.
// It inlines the two font families, the app's stylesheet as it is today, and the files beside this one.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../../..');
const read = (path) => readFileSync(path, 'utf8');

const fonts = [
  ['IBM Plex Sans', 'ibm-plex-sans'],
  ['JetBrains Mono', 'jetbrains-mono'],
]
  .flatMap(([family, pkg]) =>
    [400, 500, 600].map((weight) => {
      const file = join(repo, `apps/web/node_modules/@fontsource/${pkg}/files/${pkg}-latin-${weight}-normal.woff2`);
      const data = readFileSync(file).toString('base64');
      return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${data}) format('woff2');}`;
    }),
  )
  .join('\n');

// A replacer function, so a `$` in the sources is never read as a pattern.
const html = read(join(here, 'index.html'))
  .replace('/*FONTS*/', () => fonts)
  .replace('/*APP_CSS*/', () => read(join(repo, 'apps/web/src/styles.css')))
  .replace('/*PROTO_CSS*/', () => read(join(here, 'proto.css')))
  .replace('/*DATA_JS*/', () => read(join(here, 'data.js')))
  .replace('/*APP_JS*/', () => read(join(here, 'app.js')))
  .replace('/*SIDE_JS*/', () => read(join(here, 'side.js')));

writeFileSync(join(here, '../overload-m2-prototype.html'), html);
console.log(`docs/prototype/m2/overload-m2-prototype.html, ${Math.round(html.length / 1024)} KB`);
