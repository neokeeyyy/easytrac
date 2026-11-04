/* Pruebas de la lógica pura de la pestaña Ajustes (src/14-ui-config.js). */
import { test, expect } from 'bun:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../src/01-core.js');
require('../src/02-store.js');
const config = require('../src/14-ui-config.js');

test('necesitaRevision compara la versión guardada con la instalada', () => {
  expect(config.necesitaRevision('', '1.0.15')).toBe(true);
  expect(config.necesitaRevision(undefined, '1.0.15')).toBe(true);
  expect(config.necesitaRevision('1.0.14', '1.0.15')).toBe(true);
  expect(config.necesitaRevision('1.0.15', '1.0.15')).toBe(false);
  // Sin versión del loader todavía (marcador), no se pregunta: si no, el modal sale en cada carga.
  expect(config.necesitaRevision('1.0.15', '')).toBe(false);
  expect(config.necesitaRevision('1.0.15', '0.0.0-dev')).toBe(false);
  expect(config.necesitaRevision('', '0.0.0-dev')).toBe(false);
});

test('marcarVisto escribe cfg_visto con la versión instalada', () => {
  const guardados = {};
  const ET = globalThis.EasyTrac;
  const original = ET.store;
  ET.store = {
    get: (k, d) => (k in guardados ? guardados[k] : d),
    set: (k, v) => { guardados[k] = v; return true; },
    del: (k) => { delete guardados[k]; },
  };
  try {
    expect(ET.config.marcarVisto('1.0.15')).toBe('1.0.15');
    expect(guardados.cfg_visto).toBe('1.0.15');
    ET.config.marcarVisto('1.0.16');
    expect(guardados.cfg_visto).toBe('1.0.16');
    expect(config.necesitaRevision(guardados.cfg_visto, '1.0.16')).toBe(false);
  } finally {
    ET.store = original;
  }
});

test('valor y set pasan por el leer/guardar del registro', () => {
  let guardado = 'inicial';
  const ET = globalThis.EasyTrac;
  ET.config.add({
    seccion: 'Prueba',
    clave: 'test.campo',
    etiqueta: 'Campo',
    tipo: 'text',
    defecto: '',
    leer: () => guardado,
    guardar: (v) => { guardado = v; },
  });
  expect(ET.config.valor('test.campo')).toBe('inicial');
  ET.config.set('test.campo', 'nuevo');
  expect(guardado).toBe('nuevo');
  expect(ET.config.valor('test.campo')).toBe('nuevo');
  expect(ET.config.valor('test.inexistente', 'por defecto')).toBe('por defecto');
});

test('los campos numéricos no aceptan negativos ni texto', () => {
  let guardado = 800;
  const ET = globalThis.EasyTrac;
  ET.config.add({
    seccion: 'Prueba',
    clave: 'test.numero',
    etiqueta: 'Número',
    tipo: 'number',
    defecto: 800,
    leer: () => guardado,
    guardar: (v) => { guardado = v; },
  });
  ET.config.set('test.numero', '-5');
  expect(guardado).toBe(0);
  ET.config.set('test.numero', 'abc');
  expect(guardado).toBe(0);
  ET.config.set('test.numero', '250');
  expect(guardado).toBe(250);
});

test('parseVehiculos lee nombre|placas, solo placas y descarta líneas vacías y duplicados', () => {
  const lista = globalThis.EasyTrac.config.parseVehiculos(
    'A002252|JU47194\n\n  \nJU47194\nA003|MX12345|77\n  A004 | MX 999  '
  );
  expect(lista).toEqual([
    { nombre: 'A002252', placas: 'JU47194', id: '' },
    { nombre: 'A003', placas: 'MX12345', id: '77' },
    { nombre: 'A004', placas: 'MX 999', id: '' },
  ]);
});

test('parseVehiculos devuelve lista vacía sin texto', () => {
  expect(globalThis.EasyTrac.config.parseVehiculos('')).toEqual([]);
  expect(globalThis.EasyTrac.config.parseVehiculos(null)).toEqual([]);
  expect(globalThis.EasyTrac.config.parseVehiculos('\n | \n')).toEqual([]);
});

test('vehiculos acepta el array nuevo, el texto legado y recupera lo guardado', () => {
  const ET = globalThis.EasyTrac;
  let guardado = [
    { nombre: 'A002252', placas: 'JU47194', id: '77' },
    { nombre: '', placas: 'MX12345', id: '' },
    { nombre: 'Duplicado', placas: 'ju47194', id: '' },
    { nombre: 'Sin placas', placas: '  ', id: '5' },
  ];
  ET.config.add({
    seccion: 'Prueba',
    clave: 'acs.vehiculos',
    etiqueta: 'Vehículos',
    tipo: 'lista',
    defecto: '',
    leer: () => guardado,
    guardar: (v) => { guardado = v; },
  });
  expect(ET.config.vehiculos()).toEqual([
    { nombre: 'A002252', placas: 'JU47194', id: '77' },
    { nombre: '', placas: 'MX12345', id: '' },
  ]);

  guardado = 'A002252|JU47194|77\nMX12345';
  expect(ET.config.vehiculos()).toEqual([
    { nombre: 'A002252', placas: 'JU47194', id: '77' },
    { nombre: '', placas: 'MX12345', id: '' },
  ]);

  const lista = [{ nombre: 'A003', placas: 'MX999', id: '9' }];
  ET.config.set('acs.vehiculos', lista);
  expect(guardado).toEqual(lista);
  expect(ET.config.vehiculos()).toEqual(lista);
});
