import { test, expect } from 'bun:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../src/01-core.js');
const update = require('../src/12-ui-notice.js');

test('hayNueva compara segmento a segmento, no como texto', () => {
  expect(update.hayNueva('1.0.9', '1.0.10')).toBe(true);
  expect(update.hayNueva('1.0.12', '1.0.12')).toBe(false);
  expect(update.hayNueva('1.2.0', '1.1.99')).toBe(false);
  expect(update.hayNueva('1.0.12', '1.1.0')).toBe(true);
  expect(update.hayNueva('2.0.0', '1.9.9')).toBe(false);
});

test('hayNueva tolera versiones cortas o vacías', () => {
  expect(update.hayNueva('1.0', '1.0.1')).toBe(true);
  expect(update.hayNueva('', '0.0.1')).toBe(true);
  expect(update.hayNueva('1.0.0', '')).toBe(false);
});

test('versionDe saca el @version de la cabecera publicada', () => {
  const cabecera = '// ==UserScript==\n// @name EasyTRAC\n// @version      1.2.3\n// ==/UserScript==';
  expect(update.versionDe(cabecera)).toBe('1.2.3');
  expect(update.versionDe('sin cabecera')).toBe('');
  expect(update.versionDe('')).toBe('');
});

test('la fuente apunta al mismo archivo que @updateURL', () => {
  expect(update.fuente).toBe('https://raw.githubusercontent.com/neokeeyyy/easytrac/main/EasyTrac.user.js');
});
