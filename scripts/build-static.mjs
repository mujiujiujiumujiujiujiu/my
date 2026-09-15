import { readFile, writeFile } from 'node:fs/promises';

const indexUrl = new URL('../index.html', import.meta.url);
const stylesUrl = new URL('../styles.css', import.meta.url);
const simUrl = new URL('../src/sim.js', import.meta.url);
const webglUrl = new URL('../src/webgl.js', import.meta.url);
const mainUrl = new URL('../src/main.js', import.meta.url);
const unitsUrl = new URL('../data/units.json', import.meta.url);
const levelsUrl = new URL('../data/levels.json', import.meta.url);
const styleStartMarker = '<!-- MEME_WAR_STATIC_STYLE_START -->';
const styleEndMarker = '<!-- MEME_WAR_STATIC_STYLE_END -->';
const startMarker = '<!-- MEME_WAR_EMBEDDED_DATA_START -->';
const endMarker = '<!-- MEME_WAR_EMBEDDED_DATA_END -->';
const runtimeStartMarker = '<!-- MEME_WAR_STATIC_RUNTIME_START -->';
const runtimeEndMarker = '<!-- MEME_WAR_STATIC_RUNTIME_END -->';
const checkOnly = process.argv.includes('--check');

const [indexHtml, stylesCss, simSource, webglSource, mainSource, unitsJson, levelsJson] = await Promise.all([
  readFile(indexUrl, 'utf8'),
  readFile(stylesUrl, 'utf8'),
  readFile(simUrl, 'utf8'),
  readFile(webglUrl, 'utf8'),
  readFile(mainUrl, 'utf8'),
  readFile(unitsUrl, 'utf8'),
  readFile(levelsUrl, 'utf8'),
]);

const embeddedData = {
  './data/units.json': JSON.parse(unitsJson),
  './data/levels.json': JSON.parse(levelsJson),
};
const embeddedScript = `<script>window.MEME_WAR_EMBEDDED_DATA = ${JSON.stringify(embeddedData).replaceAll('<', '\\u003c')};</script>`;
const escapeInlineScript = (source) => source.replace(/<\/script/gi, '<\\/script');
const escapeInlineStyle = (source) => source.replace(/<\/style/gi, '<\\/style');
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&');
const markerPattern = (start, end) => new RegExp(`${escapeRegex(start)}[\\s\\S]*?${escapeRegex(end)}`);

for (const [start, end, label] of [
  [styleStartMarker, styleEndMarker, '静态样式'],
  [startMarker, endMarker, '静态数据'],
  [runtimeStartMarker, runtimeEndMarker, '静态运行时代码'],
]) {
  if (!markerPattern(start, end).test(indexHtml)) throw new Error(`index.html 缺少${label}标记`);
}

const embeddedStyle = `<style data-meme-war-static-source>${escapeInlineStyle(stylesCss)}</style>`;
const embeddedTexture = `<script>window.MEME_WAR_TEXTURE_URL = './assets/units-handdrawn-atlas-low.webp';</script>`;
const embeddedRuntime = [
  embeddedTexture,
  `<script>${escapeInlineScript(simSource)}</script>`,
  `<script>${escapeInlineScript(webglSource)}</script>`,
  `<script>${escapeInlineScript(mainSource)}</script>`,
].join('\n    ');

const styleReplacement = `${styleStartMarker}\n    ${embeddedStyle}\n    ${styleEndMarker}`;
const dataReplacement = `${startMarker}\n    ${embeddedScript}\n    ${endMarker}`;
const runtimeReplacement = `${runtimeStartMarker}\n    ${embeddedRuntime}\n    ${runtimeEndMarker}`;
const nextHtml = indexHtml
  .replace(markerPattern(styleStartMarker, styleEndMarker), styleReplacement)
  .replace(markerPattern(startMarker, endMarker), dataReplacement)
  .replace(markerPattern(runtimeStartMarker, runtimeEndMarker), runtimeReplacement);

if (checkOnly) {
  if (nextHtml !== indexHtml) throw new Error('index.html 中的内嵌数据已过期，请运行 npm run build');
  console.log('static entry ok: index.html contains current embedded data');
} else {
  await writeFile(indexUrl, nextHtml, 'utf8');
  console.log('static entry built: index.html now contains current embedded data');
}
