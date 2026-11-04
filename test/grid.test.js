const test = require('node:test');
const assert = require('node:assert');

require('../src/01-core.js');
const grid = require('../src/13-ui-grid.js');

test('TSV de ida y vuelta conserva la matriz', () => {
  const tsv = 'Estacion\tPermiso\tLitros\nGuanajuato\tA001\t1,234.50\nZacatecas\tA002\t9';
  const matriz = grid.gridSplit(tsv);
  assert.equal(matriz.length, 3);
  assert.deepEqual(matriz[0], ['Estacion', 'Permiso', 'Litros']);
  assert.equal(grid.gridToTSV(matriz), tsv);
});

test('normaliza CRLF y quita la fila vacia final', () => {
  assert.deepEqual(grid.gridSplit('a\tb\r\nc\td\r\n'), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(grid.gridSplit(''), []);
});

test('conserva celdas vacias intermedias', () => {
  assert.deepEqual(grid.gridSplit('a\t\tc\n\tb\t'), [['a', '', 'c'], ['', 'b', '']]);
});

test('detecta numeros para alinear a la derecha', () => {
  ['1', '1,234.50', '-3', '12%', '0.5'].forEach((v) => assert.ok(grid.esNumero(v), v));
  ['A001', '', 'Total', '1 234', 'n/a'].forEach((v) => assert.ok(!grid.esNumero(v), v));
});

test('la matriz del tope de filas sobrevive la serializacion', () => {
  const filas = Array.from({ length: 40 }, (_, i) => [`E${i}`, String(i)]);
  const tsv = filas.map((f) => f.join('\t')).join('\n');
  assert.equal(grid.gridToTSV(grid.gridSplit(tsv)), tsv);
});
