'use strict';

const test = require('bun:test').test;
const assert = require('node:assert');
const { norm, parsear, parsearEstaciones, parsearReporte, colaDeEstaciones, resolverFilas, valoresDeLinea, xlsxHojaATexto, rutaHojaReporte } = require('../src/40-venta.js');
const { readFileSync } = require('node:fs');


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

test('estado fuera de la lista ESTADOS: iguala contra la tabla de la empresa', () => {
  const filas = [
    fila(1, 'Puebla', 'Zacatlan', 'Comercial y Servicio'),
    fila(2, 'Puebla', 'Zacatlan', 'Residencial'),
    fila(3, 'Yucatan', 'Merida', 'Comercial y Servicio'),
  ];
  const bloques = [
    { primera: 'Yucatan', lineas: [{ celdas: ['Comercial', '9', '90'], nums: [9, 0, 90] }] },
    { primera: 'Puebla', lineas: [{ celdas: ['Residencial', '4', '40'], nums: [4, 0, 40] }] },
  ];

  const r = resolverFilas(bloques, filas, 0);

  assert.deepEqual(r.asignaciones.map((a) => a.fila.idVenta), [3, 2]);
});

test('parsear reconoce las estaciones por forma de fila, sin lista de estados', () => {
  const texto = readFileSync(__dirname + '/fixtures/venta-dia.txt', 'utf8');
  const res = parsear(texto);

  // Cinco municipios, el quinto (Puebla) fuera de la antigua lista y fuera del
  // tope de 4 bloques: antes el quinto cabecera se tomaba por recipientes.
  assert.equal(res.bloques.length, 5);
  assert.deepEqual(
    res.bloques.map((b) => [b.nombre, b.municipio]),
    [
      ['GUANAJUATO', 'SAN FELIPE'],
      ['ZACATECAS', 'PINOS'],
      ['SAN LUIS POTOSI', 'VILLA DE ARRIAGA'],
      ['JALISCO', 'OJUELOS DE JALISCO'],
      ['PUEBLA', 'CHOLULA'],
    ]
  );
  assert.deepEqual(res.bloques[4].lineas.map((l) => l.nums), [
    [700, 11, 7700],
    [2500, 11, 27500],
  ]);
  assert.deepEqual(res.totalLitros, [10000]);
  assert.deepEqual(res.autoconsumo, [100]);
  assert.equal(res.recipientes.lineas.length, 1);
});

test('bloque semanal de 7 dias: toma el dia elegido y no descarta la fila', () => {
  const nums = [];
  for (let d = 1; d <= 7; d++) nums.push(d * 100, 11.5, d * 1000);
  assert.deepEqual(valoresDeLinea(nums, 2), { vol: 300, imp: 3000 });
  assert.deepEqual(valoresDeLinea([745, 11.44, 8520.34], 0), { vol: 745, imp: 8520.34 });
  assert.equal(valoresDeLinea(nums, 7), null);

  const texto = [
    'MUNICIPIO\tLOCALIDAD\tSEGMENTO\tVOLUMEN\tPRECIO\tIMPORTE',
    ['PUEBLA', 'CHOLULA', 'COMERCIAL'].concat(nums).join('\t'),
  ].join('\n');
  const res = parsear(texto);
  assert.equal(res.bloques.length, 1);
  assert.equal(res.bloques[0].nombre, 'PUEBLA');
  assert.equal(res.bloques[0].lineas[0].nums.length, 21);
});

test('parsearEstaciones: nombres y permisos de las 8 estaciones del REPORTE', () => {
  const texto = readFileSync(__dirname + '/fixtures/venta-reporte.txt', 'utf8');
  const est = parsearEstaciones(texto);

  assert.equal(est.length, 8);
  assert.deepEqual(est.map((e) => e.nombre), [
    'ESTACION A', 'ESTACION B', 'ESTACION C', 'ESTACION D',
    'ESTACION E', 'ESTACION F', 'ESTACION G', 'ESTACION H',
  ]);
  assert.deepEqual(est.map((e) => e.permiso), [
    'LP/14432/DIST/PLA/2016',
    'LP/16140/EXP/ES/2016',
    'LP/16385',
    'LP/16723',
    'LP/17331',
    'LP/17563',
    'LP/17590',
    '',
  ]);
  assert.equal(est[0].tipo, 'ESTACIÓN DE SERVICO');
  assert.equal(est[0].sucursal, 'ESTACION A');
});

test('parsearEstaciones: 7 ventas y 7 traspasos, y días con guiones', () => {
  const texto = readFileSync(__dirname + '/fixtures/venta-reporte.txt', 'utf8');
  const est = parsearEstaciones(texto);

  assert.equal(est[0].ventas.length, 7);
  assert.deepEqual(est[0].ventas[0], { vol: '100', precio: '11.40', imp: '1140.00' });
  assert.deepEqual(est[0].ventas[6], { vol: '160', precio: '11.40', imp: '1824.00' });
  assert.deepEqual(est[0].traspasos, [120, 130, 140, 150, 160, 170, 180]);

  assert.equal(est[1].ventas.length, 7);
  assert.ok(est[1].ventas.every((v) => v.vol === '-' && v.precio === '-' && v.imp === '-'));
});

test('parsearReporte: municipios y estaciones conviven en el bloque completo', () => {
  const texto = readFileSync(__dirname + '/fixtures/venta-reporte.txt', 'utf8');
  const r = parsearReporte(texto);

  assert.equal(r.municipios.bloques.length, 5);
  assert.equal(r.municipios.bloques[4].nombre, 'PUEBLA');
  assert.deepEqual(r.municipios.fechas, [
    '01/12/2025', '02/12/2025', '03/12/2025', '04/12/2025',
    '05/12/2025', '06/12/2025', '07/12/2025',
  ]);
  assert.equal(r.estaciones.length, 8);
  assert.equal(r.municipios.recipientes.lineas.length, 1);
  assert.equal(r.municipios.recipientes.lineas[0].nums.length, 3);
});

test('colaDeEstaciones: omite estaciones sin permiso y arrastra la semana', () => {
  const texto = readFileSync(__dirname + '/fixtures/venta-reporte.txt', 'utf8');
  const r = parsearReporte(texto);
  const cola = colaDeEstaciones(r.estaciones, r.municipios.fechas);

  assert.equal(cola.length, 7);
  assert.ok(cola.every((e) => e.permiso));
  assert.ok(!cola.some((e) => e.nombre === 'ESTACION H'));
  assert.deepEqual(cola[0].fechas, r.municipios.fechas);
  assert.equal(cola[0].ventas.length, 7);
  assert.equal(cola[6].permiso, 'LP/17590');
});

test('parsearEstaciones: permiso numérico y nombre fuera de la etiqueta SUCURSAL', () => {
  const texto = [
    'TIPO DE PERMISO:\t\tPLANTA',
    'N° DE PERMISO:\t\t12345',
    'SUCURSAL:\tPLANTA NORTE',
    'VENTA LITROS\t\t\t1\t2\t3',
  ].join('\n');
  const est = parsearEstaciones(texto);

  assert.equal(est.length, 1);
  assert.equal(est[0].permiso, '12345');
  assert.equal(est[0].nombre, 'PLANTA NORTE');
});

test('parsearEstaciones: nombre en fila aparte y TIPO en la cuarta fila anterior', () => {
  const texto = [
    'CAP. AL 100% 4,913 LTS.\t\t\t\t4,913',
    'TIPO DE PERMISO:\t\tESTACIÓN DE SERVICIO',
    'N° DE PERMISO:\t\t99887',
    'SUCURSAL:\tCENTRAL',
    'ESTACION NORTE',
    'VENTA LITROS\t\t\t1\t2\t3',
  ].join('\n');
  const est = parsearEstaciones(texto);

  assert.equal(est.length, 1);
  assert.equal(est[0].nombre, 'ESTACION NORTE');
  assert.equal(est[0].permiso, '99887');
  assert.equal(est[0].tipo, 'ESTACIÓN DE SERVICIO');
  assert.equal(est[0].sucursal, 'CENTRAL');
});

test('xlsxHojaATexto: celdas compartidas, numeros, inlineStr y huecos como TSV', () => {
  const sharedStringsXml =
    '<sst count="3" uniqueCount="3">' +
    '<si><t>ESTACION NORTE</t></si>' +
    '<si><t>LP/17590</t></si>' +
    '<si><t>sin usar</t></si>' +
    '</sst>';
  const sheetXml =
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>42</v></c>' +
    '<c r="C1" s="9"/><c r="D1" t="s"><v>1</v></c></row>' +
    '<row r="2"><c r="A2" t="inlineStr"><is><t>Volumen &amp; Litros</t></is></c>' +
    '<c r="B2"><v>7</v></c><c r="D2"><v>3</v></c></row>' +
    '</sheetData></worksheet>';

  const tsv = xlsxHojaATexto({ sheetXml, sharedStringsXml });

  assert.equal(tsv, 'ESTACION NORTE\t42\t\tLP/17590\nVolumen & Litros\t7\t\t3');
});

test('rutaHojaReporte: resuelve REPORTE por rId y falla si no existe', () => {
  const workbook =
    '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    '<sheet name="DATOS" sheetId="4" r:id="rId1"/>' +
    '<sheet name="REPORTE" sheetId="2" r:id="rId3"/>' +
    '</sheets></workbook>';
  const rels =
    '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId3" Type="worksheet" Target="worksheets/sheet3.xml"/></Relationships>';

  assert.equal(rutaHojaReporte(workbook, rels), 'xl/worksheets/sheet3.xml');
  assert.throws(
    () => rutaHojaReporte('<workbook><sheets><sheet name="DATOS" r:id="rId1"/></sheets></workbook>', rels),
    /El archivo no tiene una hoja REPORTE/
  );
});


