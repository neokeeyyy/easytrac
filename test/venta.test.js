'use strict';

const test = require('bun:test').test;
const assert = require('node:assert');
const { norm, resolverFilas, valoresDeLinea } = require('../src/40-venta.js');

function fila(id, estado, municipio, sector) {
  return { idVenta: id, entidadFederativa: estado, municipio: municipio, sector: sector || 'Comercial y Servicio' };
}

function lineas(n, desde) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ celdas: ['', '', ''], nums: [desde + i, 0, (desde + i) * 10] });
  return out;
}

test('empresa con 12 estaciones sin nombres: asigna las 12 por posicion', () => {
  const filas = [];
  for (let i = 0; i < 12; i++) filas.push(fila(500 + i, 'Estado ' + i, 'Municipio ' + i, i % 2 ? 'Residencial' : 'Comercial y Servicio'));
  const bloques = [{ nombre: null, municipio: null, lineas: lineas(12, 1) }];

  const r = resolverFilas(bloques, filas, 0);

  assert.equal(r.asignaciones.length, 12);
  assert.equal(r.warns.length, 0);
  assert.deepEqual(r.asignaciones.map((a) => a.fila.idVenta), filas.map((f) => f.idVenta));
  assert.equal(r.asignaciones[11].valores.vol, 12);
});

test('no se pierde ninguna fila por el antiguo tope de 8', () => {
  const filas = [];
  for (let i = 0; i < 20; i++) filas.push(fila(i + 1, 'E' + i, 'M' + i));
  const bloques = [{ lineas: lineas(20, 1) }];

  const r = resolverFilas(bloques, filas, 0);

  assert.equal(r.asignaciones.length, 20);
  assert.deepEqual(r.asignaciones.map((a) => a.fila.idVenta), filas.map((f) => f.idVenta));
});

test('matriz con nombres fuera de orden: busca por nombre, no por posicion', () => {
  const filas = [
    fila(1, 'Guanajuato', 'San Felipe', 'Comercial y Servicio'),
    fila(2, 'Guanajuato', 'San Felipe', 'Residencial'),
    fila(3, 'Jalisco', 'Ojuelos de Jalisco', 'Comercial y Servicio'),
    fila(4, 'Jalisco', 'Ojuelos de Jalisco', 'Residencial'),
  ];
  const bloques = [
    { nombre: 'Jalisco', municipio: 'Ojuelos de Jalisco', lineas: [{ celdas: ['Residencial', '5', '50'], nums: [5, 0, 50] }] },
    { nombre: 'Guanajuato', municipio: 'San Felipe', lineas: [{ celdas: ['Comercial', '7', '70'], nums: [7, 0, 70] }] },
  ];

  const r = resolverFilas(bloques, filas, 0);

  assert.equal(r.warns.length, 0);
  assert.deepEqual(r.asignaciones.map((a) => a.fila.idVenta), [4, 1]);
  assert.deepEqual(r.asignaciones.map((a) => a.valores.vol), [5, 7]);
});

test('nombres con acentos y mayusculas coinciden con norm', () => {
  assert.equal(norm('SAN LUIS POTOSÍ'), 'san luis potosi');
  const filas = [fila(9, 'San Luis Potosí', 'Villa de Arriaga', 'Comercial y Servicio')];
  const bloques = [{ nombre: 'SAN LUIS POTOSI', municipio: 'villa de arriaga', lineas: [{ celdas: ['COMERCIAL', '3', '30'], nums: [3, 0, 30] }] }];

  const r = resolverFilas(bloques, filas, 0);

  assert.equal(r.warns.length, 0);
  assert.equal(r.asignaciones.length, 1);
  assert.equal(r.asignaciones[0].fila.idVenta, 9);
  assert.ok(r.asignaciones[0].etiqueta.indexOf('San Luis Potos') === 0);
});

test('estacion que no existe: advertencia y sigue con la siguiente linea', () => {
  const filas = [fila(1, 'Guanajuato', 'San Felipe', 'Comercial y Servicio')];
  const bloques = [{
    nombre: 'Zacatecas',
    municipio: 'Pinos',
    lineas: [
      { celdas: ['Comercial', '4', '40'], nums: [4, 0, 40] },
      { celdas: ['Residencial', '6', '60'], nums: [6, 0, 60] },
    ],
  }];

  const r = resolverFilas(bloques, filas, 0);

  assert.equal(r.asignaciones.length, 0);
  assert.equal(r.warns.length, 2);
  assert.ok(r.warns[0].indexOf('No se encontró la fila precargada') === 0);
});

test('bloque sin nombres despues de uno con nombres usa solo filas libres', () => {
  const filas = [
    fila(1, 'Guanajuato', 'San Felipe', 'Comercial y Servicio'),
    fila(2, 'Guanajuato', 'San Felipe', 'Residencial'),
    fila(3, 'Zacatecas', 'Pinos', 'Comercial y Servicio'),
  ];
  const bloques = [
    { nombre: 'Guanajuato', municipio: 'San Felipe', lineas: [{ celdas: ['Residencial', '2', '20'], nums: [2, 0, 20] }] },
    { lineas: lineas(2, 10) },
  ];

  const r = resolverFilas(bloques, filas, 0);

  assert.equal(r.warns.length, 0);
  assert.deepEqual(r.asignaciones.map((a) => a.fila.idVenta), [2, 1, 3]);
  const ids = r.asignaciones.map((a) => a.fila.idVenta);
  assert.equal(new Set(ids).size, ids.length);
});

test('lineas sin volumen/importe se ignoran y la columna 6 valores', () => {
  assert.equal(valoresDeLinea([1, 2], 0), null);
  const filas = [fila(1, 'A', 'B'), fila(2, 'C', 'D')];
  const bloques = [{ lineas: [{ celdas: ['', '', '', '', '', ''], nums: [1, 2, 3, 4, 5, 6] }, { celdas: [''], nums: [9] }] }];

  const r = resolverFilas(bloques, filas, 1);

  assert.deepEqual(r.asignaciones.map((a) => a.valores), [{ vol: 4, imp: 6 }]);
  assert.equal(r.asignaciones[0].fila.idVenta, 1);
});
