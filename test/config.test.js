/* Pruebas de la lógica pura de la pestaña Ajustes (src/14-ui-config.js). */
import { test, expect } from 'bun:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../src/01-core.js');
require('../src/02-store.js');
const config = require('../src/14-ui-config.js');

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
