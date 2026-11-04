import { readFileSync } from 'node:fs';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../src/01-core.js');
require('../src/05-text.js');
require('../src/06-permisos.js');
const acuses = require('../src/30-acuses.js');
const traspasos = require('../src/70-traspasos.js');

const html = readFileSync(new URL('./fixtures/permisos.html', import.meta.url), 'utf8');
const doc = new JSDOM(html).window.document;
const ET = globalThis.EasyTrac;

test('permisosDeDocumento devuelve ids, nombres y orden de aparición', function () {
  const ps = ET.core.permisos.permisosDeDocumento(doc);
  assert.deepEqual(ps.map(p => p.id), ['111', '222', '333']);
  assert.deepEqual(ps.map(p => p.nombre), [
    'LP/14432/DIST/PLA/2016',
    'LP/16140/EXP/ES/2016',
    'LP/20517/EXP/ES/2017',
  ]);
  assert.equal(ps[0].href, '/OrdenDePedido/SeleccionarPermiso?idPermiso=111&permiso=LP%2F14432%2FDIST%2FPLA%2F2016&idPermisionario=0');
});

test('permisosDeDocumento ignora filas sin enlace y la fila "Sin resultados"', function () {
  const ps = ET.core.permisos.permisosDeDocumento(doc);
  assert.equal(ps.length, 3);
  assert.equal(ps.some(p => p.nombre === 'LP/99999/EXP/ES/2016'), false);
  assert.equal(ps.some(p => /SIN ENLACE|Sin resultados/.test(p.nombre)), false);
});

test('el consumidor de acuses conserva su forma y sus valores', function () {
  assert.deepEqual(acuses.permisosDeTabla(doc), [
    { id: '111', codigo: 'LP/14432/DIST/PLA/2016', razon: 'GAS DE OJUELOS SA DE CV', actividad: 'Distribución' },
    { id: '222', codigo: 'LP/16140/EXP/ES/2016', razon: 'OTRA SA DE CV', actividad: 'Expendio' },
    { id: '333', codigo: 'LP/20517/EXP/ES/2017', razon: 'GAS DE OJUELOS SA DE CV', actividad: 'Expendio' },
  ]);
});

test('el consumidor de traspasos conserva su forma y sus valores', function () {
  assert.deepEqual(traspasos.parsePermitsFromDocument(doc), [
    { id: '111', permit: 'LP/14432/DIST/PLA/2016', razonSocial: 'GAS DE OJUELOS SA DE CV', materia: 'LP', activity: 'Distribución' },
    { id: '222', permit: 'LP/16140/EXP/ES/2016', razonSocial: 'OTRA SA DE CV', materia: 'LP', activity: 'Expendio' },
    { id: '333', permit: 'LP/20517/EXP/ES/2017', razonSocial: 'GAS DE OJUELOS SA DE CV', materia: 'LP', activity: 'Expendio' },
  ]);
});

test('ambos consumidores parten del mismo escaneo', function () {
  const ps = ET.core.permisos.permisosDeDocumento(doc);
  assert.deepEqual(acuses.permisosDeTabla(doc).map(p => p.id), ps.map(p => p.id));
  assert.deepEqual(traspasos.parsePermitsFromDocument(doc).map(p => p.id), ps.map(p => p.id));
  assert.deepEqual(acuses.permisosDeTabla(doc).map(p => p.codigo), ps.map(p => p.nombre));
  assert.deepEqual(traspasos.parsePermitsFromDocument(doc).map(p => p.permit), ps.map(p => p.nombre));
});
