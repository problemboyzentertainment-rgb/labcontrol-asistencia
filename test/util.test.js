'use strict';
// Pruebas unitarias de utilidades puras (no requieren base de datos).
const test = require('node:test');
const assert = require('node:assert');
process.env.APP_TZ = 'America/Guayaquil';
const u = require('../lib/util');

test('csvEscape neutraliza fórmulas y escapa comillas', () => {
  const csv = u.toCsv([{ k: 'a', t: 'A' }], [{ a: '=SUM(A1)' }, { a: 'dice "hola", ok' }]);
  assert.match(csv, /'=SUM\(A1\)/);
  assert.match(csv, /"dice ""hola"", ok"/);
  assert.ok(csv.startsWith('﻿'));
});
test('fmtFecha formatea YYYY-MM-DD a DD/MM/YYYY', () => assert.strictEqual(u.fmtFecha('2026-10-16'), '16/10/2026'));
test('fmtDur calcula horas y minutos', () => assert.strictEqual(u.fmtDur('2026-01-01T08:00:00Z', '2026-01-01T10:05:00Z'), '2 h 05 min'));
test('validadores', () => {
  assert.ok(u.esEmail('a@b.co')); assert.ok(!u.esEmail('x'));
  assert.ok(u.esFecha('2026-01-31')); assert.ok(!u.esFecha('31/01/2026'));
  assert.strictEqual(u.entero('12'), 12); assert.strictEqual(u.entero('x'), null);
});
test('paginar limita la página al rango', () => {
  const p = u.paginar({ query: { pagina: '99' } }, 45, 20);
  assert.strictEqual(p.paginas, 3); assert.strictEqual(p.pagina, 3); assert.strictEqual(p.offset, 40);
});
