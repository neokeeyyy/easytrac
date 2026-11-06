'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/01-core.js');
const api = require('../src/70-traspasos.js');

test('previousMondayISO devuelve el lunes de la semana anterior', function () {
  assert.equal(api.previousMondayISO(new Date(2026, 10, 3, 12)), '2026-10-26');
  assert.equal(api.previousMondayISO(new Date(2026, 10, 8, 12)), '2026-10-26');
  assert.equal(api.previousMondayISO(new Date(2026, 10, 9, 12)), '2026-11-02');
});

test('parseMatrix lee formato ancho, resuelve días e ignora Total', function () {
  const text = [
    'Estación\tLunes\tMartes\tMiércoles\tTotal',
    'PLANTA OJUELOS\t1,234.5\t\t800\t2,034.5',
    'ESTACIÓN NORTE\t500\t600.25\t700\t1,800.25',
  ].join('\n');

  const parsed = api.parseMatrix(text, { weekStart: '2026-10-26' });
  assert.equal(parsed.format, 'wide');
  assert.equal(parsed.rows.length, 5);
  assert.deepEqual(
    parsed.rows.map(function (row) {
      return row.date;
    }),
    ['2026-10-26', '2026-10-28', '2026-10-26', '2026-10-27', '2026-10-28']
  );
  assert.equal(parsed.rows[0].station, 'PLANTA OJUELOS');
  assert.equal(parsed.rows[0].volumeKg, 1234.5);
  assert.equal(parsed.rows[2].volumeKg, 500);
});

test('parseMatrix lee formato largo con fechas y nombres de día', function () {
  const text = [
    'Estación,Fecha,Volumen kg',
    'PLANTA OJUELOS,26/10/2026,"1,234.50"',
    'ESTACIÓN NORTE,2026-10-27,800 kg',
    'ESTACIÓN NORTE,Martes,600.25',
  ].join('\n');

  const parsed = api.parseMatrix(text, { weekStart: '2026-10-26' });
  assert.equal(parsed.format, 'long');
  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.rows[0].date, '2026-10-26');
  assert.equal(parsed.rows[1].date, '2026-10-27');
  assert.equal(parsed.rows[2].date, '2026-10-27');
  assert.equal(parsed.rows[0].volumeKg, 1234.5);
  assert.equal(parsed.rows[1].volumeKg, 800);
  assert.equal(parsed.rows[2].volumeKg, 600.25);
});

test('parseMatrix marca fecha y volumen inválidos', function () {
  const parsed = api.parseMatrix('Estación\tFecha\tVolumen\nPLANTA\t32/13/2026\tabc', {
    weekStart: '2026-10-26',
  });
  assert.equal(parsed.format, 'long');
  assert.equal(parsed.rows[0].date, null);
  assert.equal(parsed.rows[0].volumeKg, null);
});

test('evaluateRows y buildTransfers conservan fecha de operación y de registro', function () {
  const permits = [
    { id: 1, permit: 'LP/14432/DIST/PLA/2016', razonSocial: 'GAS DE OJUELOS' },
    { id: 2, permit: 'LP/16385/EXP/ES/2016', razonSocial: 'GAS DE OJUELOS' },
  ];
  const mapping = {
    'planta ojuelos': { name: 'PLANTA OJUELOS', destinationId: '2', sourceId: '1' },
  };
  const parsed = api.parseMatrix('Estación\tLunes\nPLANTA OJUELOS\t100', {
    weekStart: '2026-10-26',
  });
  const rows = api.evaluateRows(parsed, mapping, permits, '1');

  assert.equal(rows[0].status, 'OK');
  assert.equal(rows[0].destination.permit, 'LP/16385/EXP/ES/2016');
  assert.equal(rows[0].source.permit, 'LP/14432/DIST/PLA/2016');

  const transfers = api.buildTransfers(rows, '2026-11-03');
  assert.equal(transfers.length, 1);
  assert.equal(transfers[0].operationDate, '2026-10-26');
  assert.equal(transfers[0].registrationDate, '2026-11-03');
  assert.equal(transfers[0].date, '2026-10-26');
  assert.equal(transfers[0].sourcePermitId, 1);
  assert.equal(transfers[0].destinationPermitId, 2);
});

test('normalizeKey canoniza permiso, fecha y volumen', function () {
  assert.equal(
    api.normalizeKey('lp/16385/exp/es/2016', '2026-10-27', 1234.5),
    'LP/16385/EXP/ES/2016|2026-10-27|1234.500'
  );
});

test('extractAcuses tolera data, result.rows y arreglo directo', function () {
  const response = {
    success: true,
    data: [
      {
        codigoRegistro: 'ABC-1',
        fechaRegistro: '2026-11-03',
        fechaCompra: '2026-10-27',
        permiso_Vendedor: 'LP/16385/EXP/ES/2016',
        volumen_Solicitado: '1,234.5',
        traspaso: true,
      },
      {
        codigoRegistro: 'ABC-2',
        fechaRegistro: '2026-11-03',
        fechaCompra: '2026-10-27',
        permiso_Vendedor: 'LP/16385/EXP/ES/2016',
        volumen_Solicitado: 800,
      },
    ],
  };

  const acuses = api.extractAcuses(response);
  assert.equal(acuses.length, 2);
  assert.equal(acuses[0].permit, 'LP/16385/EXP/ES/2016');
  assert.equal(acuses[0].registrationNumber, 'ABC-1');
  assert.equal(acuses[0].registrationDate, '2026-11-03');
  assert.equal(acuses[0].operationDate, '2026-10-27');
  assert.equal(acuses[0].volumeKg, 1234.5);
  // permiso_Vendedor es el origen; la deduplicación usa el permiso destino seleccionado.
  assert.equal(
    api.acuseKey(acuses[0], 'LP/17563/EXP/ES/2016'),
    'LP/16385/EXP/ES/2016>LP/17563/EXP/ES/2016|2026-10-27|1234.500'
  );

  assert.equal(
    api.extractAcuses({ result: { rows: [{ permiso: 'LP/1', fecha: '2026-10-27', volumen: 10 }] } })
      .length,
    1
  );
  assert.equal(
    api.extractAcuses([{ permiso: 'LP/1', fecha: '2026-10-27', volumen: 10 }]).length,
    1
  );
  assert.equal(api.extractAcuses({ success: true }), null);
});

test('parseMatrix lee la matriz real de traspasos por estación y día', function () {
  const text = [
    'TRASPASOS (KILOS)\t26/10/2026\t27/10/2026\t28/10/2026\t29/10/2026\t30/10/2026\t31/10/2026\t01/11/2026',
    'Ojuelos-Lagos\t3529\t1556\t1656\t1066\t1757\t1180\t1380',
    'Matancillas\t1652\t\t\t\t\t\t1352',
    'Los Campos\t\t\t\t2189\t\t\t',
    'San Agustin\t1030\t\t1494\t\t1158\t945\t1288',
    'El Gallo\t1343\t\t2318\t1121\t\t1264\t',
    'Diligencias\t2078\t\t2248\t\t2156\t840\t',
    'Colon\t2093\t\t1984\t\t1914\t876\t',
  ].join('\n');

  const parsed = api.parseMatrix(text, { weekStart: '2026-10-26' });
  assert.equal(parsed.format, 'wide');
  assert.equal(parsed.rows.length, 27);
  assert.deepEqual(
    Array.from(new Set(parsed.rows.map(function (row) { return row.station; }))),
    ['Ojuelos-Lagos', 'Matancillas', 'Los Campos', 'San Agustin', 'El Gallo', 'Diligencias', 'Colon']
  );

  const first = parsed.rows.find(function (row) {
    return row.station === 'Ojuelos-Lagos' && row.date === '2026-10-26';
  });
  assert.equal(first.volumeKg, 3529);

  const matancillas = parsed.rows.filter(function (row) {
    return row.station === 'Matancillas';
  });
  assert.equal(matancillas.length, 2);
  assert.equal(matancillas[1].date, '2026-11-01');
  assert.equal(matancillas[1].volumeKg, 1352);

  assert.equal(
    parsed.rows.reduce(function (sum, row) { return sum + row.volumeKg; }, 0),
    43467
  );
});

test('parseMatrix ignora filas antes del bloque TRASPASOS y la fila Total', function () {
  const text = [
    'AUTOCONSUMOS\t26/10/2026\t27/10/2026',
    'PLANTA\t930\t1060',
    '',
    'TRASPASOS (KILOS)\t26/10/2026\t27/10/2026',
    'Ojuelos-Lagos\t3529\t1556',
    'Matancillas\t1652\t',
    'Total\t5181\t1556',
  ].join('\n');

  const parsed = api.parseMatrix(text, { weekStart: '2026-10-26' });
  assert.equal(parsed.format, 'wide');
  assert.equal(parsed.rows.length, 3);
  assert.deepEqual(
    parsed.rows.map(function (row) { return row.station; }),
    ['Ojuelos-Lagos', 'Ojuelos-Lagos', 'Matancillas']
  );
  assert.equal(parsed.rows.some(function (row) { return row.station === 'AUTOCONSUMOS'; }), false);
});

test('parseMatrix rechaza dos bloques ENTRADA POR TRASPASO en vez de mezclar sus fechas', function () {
  const text = [
    'ENTRADA POR TRASPASO\t26/10/2026\t27/10/2026',
    'PLANTA A\t100\t200',
    'ENTRADA POR TRASPASO\t28/10/2026\t29/10/2026',
    'PLANTA B\t300\t400',
  ].join('\n');

  assert.throws(function () {
    api.parseMatrix(text, { weekStart: '2026-10-26' });
  }, /más de un bloque/);
});

test('assignByOrder asigna permisos ES libres en orden y respeta los ya asignados', function () {
  const permits = [
    { id: '1', permit: 'LP/14432/DIST/PLA/2016' },
    { id: '2', permit: 'LP/16140/EXP/ES/2016' },
    { id: '3', permit: 'LP/16385/EXP/ES/2016' },
    { id: '4', permit: 'LP/16723/EXP/ES/2016' },
    { id: '5', permit: 'LP/17331/EXP/ES/2016' },
    { id: '6', permit: 'LP/17563/EXP/ES/2016' },
    { id: '7', permit: 'LP/17590/EXP/ES/2016' },
    { id: '8', permit: 'LP/17718/EXP/ES/2016' },
    { id: '9', permit: 'LP/20517/EXP/ES/2017' },
  ];
  const entries = [
    { name: 'Ojuelos-Lagos', destinationId: '' },
    { name: 'Matancillas', destinationId: '3' },
    { name: 'Los Campos', destinationId: '' },
    { name: 'San Agustin', destinationId: '' },
    { name: 'El Gallo', destinationId: '' },
    { name: 'Diligencias', destinationId: '' },
    { name: 'Colon', destinationId: '' },
  ];

  assert.equal(api.assignByOrder(entries, permits, '1'), 6);
  assert.equal(entries[0].destinationId, '2');
  assert.equal(entries[1].destinationId, '3');
  assert.equal(entries[2].destinationId, '4');
  assert.equal(entries[3].destinationId, '5');
  assert.equal(entries[4].destinationId, '6');
  assert.equal(entries[5].destinationId, '7');
  assert.equal(entries[6].destinationId, '8');
});

test('parseVolume trata el punto como decimal y conserva la coma de miles', function () {
  assert.equal(api.parseVolume('0.750'), 0.75);
  assert.equal(api.parseVolume('12.345'), 12.345);
  assert.equal(api.parseVolume('1.250'), 1.25);
  assert.equal(api.parseVolume('1,250'), 1250);
});

test('evaluateRows bloquea un traspaso al mismo permiso', function () {
  const permits = [
    { id: '1', permit: 'LP/14432/DIST/PLA/2016' },
    { id: '2', permit: 'LP/16385/EXP/ES/2016' },
  ];
  const mapping = {
    'planta': { name: 'PLANTA', destinationId: '1', sourceId: '1' },
  };
  const parsed = api.parseMatrix('Estación\tLunes\nPLANTA\t100', {
    weekStart: '2026-10-26',
  });
  const rows = api.evaluateRows(parsed, mapping, permits, '1');
  assert.equal(rows[0].status, 'Origen y destino iguales');
});

test('buildTraspasoBody arma el cuerpo exacto de GuardaCompraGasLP', function () {
  const body = api.buildTraspasoBody(
    { operationDate: '2026-10-28', volumeKg: 2318 },
    '1295',
    '2026-11-03 22:43:44'
  );
  assert.deepEqual(body, {
    'compraNueva[compra][fechaRegistro]': '2026-11-03 22:43:44',
    'compraNueva[compra][fechaCompra]': '28/10/2026',
    'compraNueva[compra][cantidadSolicitada]': '2318.00',
    'compraNueva[compra][precioAcordado]': '',
    'compraNueva[compra][idVendedor]': '1295',
    'compraNueva[compra][entregaParcial]': 'false',
    'compraNueva[compra][traspaso]': 'true',
    cadenaAcuse: '|',
  });
});

test('findRegistrationNumber lee el mensaje solo cuando result es true', function () {
  assert.equal(
    api.findRegistrationNumber('{"result":true,"mensaje":"LP/16385/2026/00174"}'),
    'LP/16385/2026/00174'
  );
  assert.equal(api.findRegistrationNumber('{"result":false,"mensaje":"SC"}'), null);
  assert.equal(api.findRegistrationNumber('<html>sesión expirada</html>'), null);
});

test('sourcePermitStatus interpreta true como activo y false como suspendido', function () {
  assert.equal(api.sourcePermitStatus('true'), 'active');
  assert.equal(api.sourcePermitStatus(' TRUE '), 'active');
  assert.equal(api.sourcePermitStatus('false'), 'suspended');
  assert.equal(api.sourcePermitStatus('<html>sesión expirada</html>'), 'unknown');
});

test('isExpiredSessionHtml ignora el alert de la página normal', function () {
  assert.equal(
    api.isExpiredSessionHtml(
      '<html><script>alert("Sesión expirada.");</script><body>Permisos</body></html>'
    ),
    false
  );
  assert.equal(api.isExpiredSessionHtml('<html><body>Tu sesión ha expirado.</body></html>'), true);
  assert.equal(api.isExpiredSessionHtml('<html><body>Iniciar sesión</body></html>'), true);
});

test('relatePermits relaciona cada permiso con los nombres de la plantilla', function () {
  const permits = [
    { id: '1', permit: 'LP/14432/DIST/PLA/2016' },
    { id: '2', permit: 'LP/16140/EXP/ES/2016' },
    { id: '3', permit: 'LP/16385/EXP/ES/2016' },
  ];
  const relations = api.relatePermits(permits, {
    a: { name: 'Ojuelos-Lagos', destinationId: '2' },
    b: { name: 'Matancillas', destinationId: '2' },
    c: { name: 'Los Campos', destinationId: '1' },
  });

  assert.deepEqual(relations[0].names, ['Los Campos']);
  assert.deepEqual(relations[1].names, ['Ojuelos-Lagos', 'Matancillas']);
  assert.deepEqual(relations[2].names, []);
});

test('los dos traspasos de El Gallo se reconocen aunque traspaso sea false', function () {
  const text = [
    'TRASPASOS (KILOS)\t26/10/2026\t27/10/2026\t28/10/2026',
    'Ojuelos-Lagos\t3529\t1556\t1656',
    'Matancillas\t1652\t\t',
    'Los Campos\t\t\t',
    'San Agustin\t1030\t\t1494',
    'El Gallo\t1343\t\t2318',
  ].join('\n');
  const permits = [
    { id: '1295', permit: 'LP/14432/DIST/PLA/2016', activity: 'Distribuidor por Planta de Distribucion' },
    { id: '3076', permit: 'LP/16385/EXP/ES/2016', activity: 'Expendio al publico mediante ES con Fin Especifico' },
  ];
  const parsed = api.parseMatrix(text, { weekStart: '2026-10-26' });
  const rows = api.evaluateRows(parsed, { 'el gallo': { name: 'El Gallo', destinationId: '3076' } }, permits, '1295');
  const transfers = api.buildTransfers(rows, '2026-11-03');

  assert.equal(transfers.length, 2);
  const acuses = api.extractAcuses({
    success: true,
    data: [
      {
        codigoRegistro: 'LP/16385/2026/00173',
        fechaCompra: '2026-10-26',
        permiso_Vendedor: 'LP/14432/DIST/PLA/2016',
        volumen_Solicitado: 1343,
        traspaso: false,
      },
      {
        codigoRegistro: 'LP/16385/2026/00174',
        fechaCompra: '2026-10-28',
        permiso_Vendedor: 'LP/14432/DIST/PLA/2016',
        volumen_Solicitado: 2318,
        traspaso: false,
      },
    ],
  });
  const existing = api.acuseKeys(acuses, 'LP/16385/EXP/ES/2016');

  for (const transfer of transfers) {
    const key = api.normalizeKey(
      transfer.destinationPermit,
      transfer.operationDate,
      transfer.volumeKg,
      transfer.sourcePermit
    );
    assert.equal(existing.has(key), true);
  }
});

test('buildTraspasoBody agrega idVehiculo y TransportePlaca si el traspaso tiene vehiculo', function () {
  const body = api.buildTraspasoBody(
    {
      operationDate: '2026-10-28',
      volumeKg: 2318,
      vehiculo: { nombre: 'A002252', placas: 'JU47194', id: '77' },
    },
    '1295',
    '2026-11-03 22:43:44'
  );
  assert.equal(body['compraNueva[compra][idVehiculo]'], '77');
  assert.equal(body['compraNueva[compra][TransportePlaca]'], 'JU47194');
});

test('buildTraspasoBody omite idVehiculo si el vehiculo no tiene id', function () {
  const body = api.buildTraspasoBody(
    { operationDate: '2026-10-28', volumeKg: 2318, vehiculo: { nombre: 'CAMION 1', placas: 'JU47194', id: '' } },
    '1295',
    '2026-11-03 22:43:44'
  );
  assert.equal(body['compraNueva[compra][idVehiculo]'], undefined);
  assert.equal(body['compraNueva[compra][TransportePlaca]'], 'JU47194');
});

test('buildTransfers asigna el vehiculo por defecto y vehiculosFaltantes lo detecta', function () {
  const rows = [
    {
      status: 'OK',
      station: 'PLANTA',
      destination: { permit: 'LP/2', id: '2' },
      source: { permit: 'LP/1', id: '1' },
      date: '2026-10-26',
      volumeKg: 100,
    },
  ];
  const vehiculo = { nombre: 'A002252', placas: 'JU47194', id: '77' };
  const conVehiculo = api.buildTransfers(rows, '2026-11-03', [vehiculo]);
  assert.deepEqual(conVehiculo[0].vehiculo, vehiculo);
  assert.deepEqual(api.vehiculosFaltantes(conVehiculo), []);

  const sinVehiculo = api.buildTransfers(rows, '2026-11-03', []);
  assert.equal(sinVehiculo[0].vehiculo, null);
  assert.deepEqual(api.vehiculosFaltantes(sinVehiculo), sinVehiculo);
});

test('evaluateRows resuelve la lista por código LP aunque cambien los ids', function () {
  const permits = [
    { id: '900', permit: 'LP/14432/DIST/PLA/2016', activity: 'Distribuidor por Planta de Distribucion' },
    { id: '901', permit: 'LP/16385/EXP/ES/2016', activity: 'Expendio al publico' },
  ];
  const mapping = {
    'planta ojuelos': {
      name: 'PLANTA OJUELOS',
      permiso: 'LP/16385/EXP/ES/2016',
      origen: 'LP/14432/DIST/PLA/2016',
    },
  };
  const parsed = api.parseMatrix('Estación\tLunes\nPLANTA OJUELOS\t100', {
    weekStart: '2026-10-26',
  });
  const rows = api.evaluateRows(parsed, mapping, permits, '');

  assert.equal(rows[0].status, 'OK');
  assert.equal(rows[0].destination.id, '901');
  assert.equal(rows[0].destination.permit, 'LP/16385/EXP/ES/2016');
  assert.equal(rows[0].source.id, '900');
});

test('evaluateRows cae a permitHint si la lista no resuelve el destino', function () {
  const permits = [
    { id: '900', permit: 'LP/14432/DIST/PLA/2016' },
    { id: '901', permit: 'LP/16385/EXP/ES/2016' },
  ];
  const parsed = {
    rows: [
      { station: 'MATRIZ', date: '2026-10-26', volumeKg: 100, permitHint: 'LP/16385/EXP/ES/2016' },
    ],
  };
  const rows = api.evaluateRows(parsed, {}, permits, '900');

  assert.equal(rows[0].destination.id, '901');
  assert.equal(rows[0].source.id, '900');
});

test('migrateMapping traduce los ids del mapeo viejo a códigos LP', function () {
  const permits = [
    { id: '900', permit: 'LP/14432/DIST/PLA/2016' },
    { id: '901', permit: 'LP/16385/EXP/ES/2016' },
  ];
  const saved = {
    version: 1,
    stations: [
      { name: 'PLANTA OJUELOS', destinationId: '901', sourceId: '900' },
      { name: 'SIN SESION', destinationId: '123', sourceId: '' },
    ],
  };
  const migrated = api.migrateMapping(saved, permits);

  assert.deepEqual(migrated.list, [
    { nombre: 'PLANTA OJUELOS', permiso: 'LP/16385/EXP/ES/2016', origen: 'LP/14432/DIST/PLA/2016' },
    { nombre: 'SIN SESION', permiso: '', origen: '' },
  ]);
  assert.deepEqual(migrated.missing, ['SIN SESION']);
});
