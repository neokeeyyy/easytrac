/* One-shot splitter: slices the legacy userscripts into src/ modules.
   Prints every line that differs from the source, so a review can confirm that only
   wrappers, aliases and the SHub copy were touched. */
import { readFileSync, writeFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n?/g, '\n');
const write = (p, s) => writeFileSync(p, s, 'utf8');

/* ---------- brace extraction that ignores strings, templates, comments and regexes ---------- */
function matchBrace(src, open) {
  let depth = 0, i = open, mode = null, last = '';
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (mode === 'line') { if (c === '\n') mode = null; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = null; i++; } continue; }
    if (mode === 'sq' || mode === 'dq' || mode === 'tpl') {
      if (c === '\\') { i++; continue; }
      if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tpl' && c === '`')) mode = null;
      continue;
    }
    if (mode === 're') {
      if (c === '\\') { i++; continue; }
      if (c === '[') { mode = 'cls'; continue; }
      if (c === '/') mode = null;
      continue;
    }
    if (mode === 'cls') {
      if (c === '\\') { i++; continue; }
      if (c === ']') mode = 're';
      continue;
    }
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === "'") { mode = 'sq'; last = c; continue; }
    if (c === '"') { mode = 'dq'; last = c; continue; }
    if (c === '`') { mode = 'tpl'; last = c; continue; }
    if (c === '/' && (/[=(,:[!&|?{};+\-*%~^<>]/.test(last) || last === '')) { mode = 're'; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
    if (!/\s/.test(c)) last = c;
  }
  throw new Error('unbalanced braces');
}

function extractFn(src, name) {
  const m = new RegExp('(^|\\n)([ \\t]*)function\\s+' + name + '\\s*\\(', 'm').exec(src);
  if (!m) throw new Error('function not found: ' + name);
  const start = m.index + m[1].length;
  const open = src.indexOf('{', start);
  const close = matchBrace(src, open);
  return { start, end: close + 1, text: src.slice(start, close + 1) };
}

function takeFns(src, names) {
  const out = [];
  let rest = src;
  for (const n of names) {
    try {
      const f = extractFn(rest, n);
      out.push(f.text);
      rest = rest.slice(0, f.start) + rest.slice(f.end);
    } catch (e) {
      throw new Error(n + ': ' + e.message);
    }
  }
  return { rest, texts: out };
}

/* ---------- modules ---------- */
const banner = (title, note) => `/* EasyTrac ${title}${note ? '\n   ' + note : ''} */\n`;

function coreModule(title, note, ns, fns, aliasLines) {
  return banner(title, note) +
    '(function () {\n' +
    "  'use strict';\n" +
    '  var ET = globalThis.EasyTrac;\n' +
    (aliasLines.length ? '  ' + aliasLines.join('\n  ') + '\n\n' : '\n') +
    fns.join('\n\n') + '\n\n' +
    '  ET.core = ET.core || {};\n' +
    '  ET.core.' + ns + ' = {\n' +
    fns.map((f) => '    ' + /function\s+(\w+)/.exec(f)[1] + ': ' + /function\s+(\w+)/.exec(f)[1]).join(',\n') + '\n' +
    '  };\n' +
    '})();\n';
}

const ACS = read('legacy/ACS.user.js');
const ACUSES = read('legacy/ACUSES.DOWNLOADER.user.js');
const VENTA = read('legacy/AUTOFILL.SIRETRAC.VENTA.user.js');
const FECHA = read('legacy/FECHA.SIRETRAC.FRC.user.js');
const TRASPASOS = read('legacy/siretrac-traspasos.user.js');

function inner(src, file) {
  const a = src.indexOf('(function () {');
  if (a < 0) throw new Error('no IIFE in ' + file);
  const b = src.lastIndexOf('})();');
  if (b < a) throw new Error('no IIFE close in ' + file);
  return src.slice(a + '(function () {'.length, b);
}

function stripShub(body) {
  const a = body.indexOf('/* ===== SHub');
  if (a < 0) return body;
  const b = body.indexOf('fin SHub');
  if (b < 0) throw new Error('SHub start without end');
  const end = body.indexOf('*/', b) + 2;
  return body.slice(0, a) + body.slice(end);
}

/* --- ACS: pull the shared helpers out, then wrap what is left --- */
let acsBody = stripShub(inner(ACS, 'ACS'));
const groups = {
  dates: ['pad2', 'toISO', 'isoToDMA', 'parseDia', 'parseISO', 'ahoraHora'],
  text: ['limpiarHtml', 'pick', 'matchInput', 'matchText'],
  http: ['esperarMs', 'textoRespuesta', 'apiPost', 'respuestaReintentable', 'conReintentos', 'apiPostDatos', 'getJsonDatos', 'datosDe', 'postMultipart'],
  permisos: ['escanearPermisos', 'permisoUrlPorId', 'permisoDeUrl'],
};
const pulled = {};
for (const [k, names] of Object.entries(groups)) {
  const r = takeFns(acsBody, names);
  acsBody = r.rest;
  pulled[k] = r.texts;
}

write('src/04-dates.js', coreModule('dates', 'Pure date helpers (ACS semantics: local time).', 'dates', pulled.dates, []));
write('src/05-text.js', coreModule('text', 'Small string and HTML helpers.', 'text', pulled.text, []));
write('src/06-permisos.js',
  coreModule('permisos', 'Permission discovery shared by the features.', 'permisos', pulled.permisos,
    ['var matchInput = ET.core.text.matchInput, matchText = ET.core.text.matchText;']));
write('src/03-http.js',
  coreModule('http', 'fetch helpers: retries, JSON in datos, multipart.', 'http', pulled.http, []));

const aliasAcs =
  '  var pad2 = ET.core.dates.pad2, toISO = ET.core.dates.toISO, isoToDMA = ET.core.dates.isoToDMA,\n' +
  '    parseDia = ET.core.dates.parseDia, parseISO = ET.core.dates.parseISO, ahoraHora = ET.core.dates.ahoraHora;\n' +
  '  var limpiarHtml = ET.core.text.limpiarHtml, pick = ET.core.text.pick,\n' +
  '    matchInput = ET.core.text.matchInput, matchText = ET.core.text.matchText;\n' +
  '  var esperarMs = ET.core.http.esperarMs, textoRespuesta = ET.core.http.textoRespuesta,\n' +
  '    apiPost = ET.core.http.apiPost, respuestaReintentable = ET.core.http.respuestaReintentable,\n' +
  '    conReintentos = ET.core.http.conReintentos, apiPostDatos = ET.core.http.apiPostDatos,\n' +
  '    getJsonDatos = ET.core.http.getJsonDatos, datosDe = ET.core.http.datosDe,\n' +
  '    postMultipart = ET.core.http.postMultipart;\n' +
  '  var escanearPermisos = ET.core.permisos.escanearPermisos,\n' +
  '    permisoUrlPorId = ET.core.permisos.permisoUrlPorId, permisoDeUrl = ET.core.permisos.permisoDeUrl;';

function featureModule(title, note, body, ns) {
  return banner(title, note) +
    '(function () {\n' +
    "  'use strict';\n" +
    '  var ET = globalThis.EasyTrac;\n' +
    body.replace(/^\s*\n\s*'use strict';\s*\n/, '').replace(/^\s*\n/, '') + '\n' +
    '  ET.' + ns + ' = ET.' + ns + ' || {};\n' +
    '})();\n';
}

/* --- ACS --- */
let acs = acsBody.replace(/^\s*\n\s*'use strict';\s*\n/, '');
const acsFixed = acs.replace(
  /var url = URL\.createObjectURL\(blob\);\n(\s*)try \{\n\s*GM_download[^\n]*\n/,
  'var url = URL.createObjectURL(blob);\n$1try {\n$1  var a = document.createElement("a");\n$1  a.href = url; a.download = filename;\n$1  document.body.appendChild(a); a.click(); a.remove();\n$1  setTimeout(function () { URL.revokeObjectURL(url); }, 10000);\n'
);
if (acsFixed === acs) throw new Error('GM_download block not replaced');

const acsOut = aliasAcs + '\n' + acsFixed
  .replace(/JSON\.parse\(GM_getValue\('acs_cfg', '\{\}'\)\)/g, "ET.store.get('acs_cfg', {})")
  .replace(/JSON\.parse\(GM_getValue\('acs_ui', '\{\}'\)\)/g, "ET.store.get('acs_ui', {})")
  .replace(/GM_setValue\('acs_cfg', JSON\.stringify\(CONFIG\)\)/g, "ET.store.set('acs_cfg', CONFIG)")
  .replace(/GM_setValue\('acs_ui', JSON\.stringify\(UI_STATE\)\)/g, "ET.store.set('acs_ui', UI_STATE)")
  .replace(/GM_addStyle\(/g, 'ET.ui.style(')
  .replace(/shubTab\(/g, 'ET.ui.tab(');
if (/GM_(getValue|setValue|addStyle|download)\s*\(/.test(acsOut)) throw new Error('ACS still calls GM_*');

write('src/20-acs.js', featureModule('ACS', 'Accept, dispatch, receive, close purchases and build the transfer PDF.', acsOut, 'acs'));

/* --- the rest: unwrap, drop the SHub copy, mount as a sidebar tab --- */
const simple = [
  ['ACUSES', ACUSES, '30-acuses.js', 'acuses', 'Acuse downloader: analyse, download ZIP, print.'],
  ['VENTA', VENTA, '40-venta.js', 'venta', 'Auto-fill of the sales registration forms.'],
  ['FECHA', FECHA, '50-fecha.js', 'fecha', 'SToolkit: unlock the date fields.'],
  ['TRASPASOS', TRASPASOS, '70-traspasos.js', 'traspasos', 'Transfers between permits, mounted in the sidebar.'],
];

for (const [label, src, out, ns, note] of simple) {
  let body = stripShub(inner(src, label)).replace(/shubTab\(/g, 'ET.ui.tab(');
  write('src/' + out, featureModule(label, note, body, ns));
}

console.log('modules written');

