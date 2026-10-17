'use strict';
const { TZ } = require('../db/pool');

const fmtFecha = (v) => {
  if (!v) return '—';
  const s = typeof v === 'string' ? v : new Date(v).toISOString().slice(0, 10);
  const [y, m, d] = s.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};
const fmtHora = (v) => (v ? new Date(v).toLocaleTimeString('es-EC', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }) : '—');
const fmtFechaHora = (v) => (v ? new Date(v).toLocaleString('es-EC', { timeZone: TZ, hour12: false }) : '—');
const fmtTime = (t) => (t ? String(t).slice(0, 5) : '—');
const fmtDur = (ini, fin) => {
  if (!ini) return '—';
  const min = Math.max(0, Math.round(((fin ? new Date(fin) : new Date()) - new Date(ini)) / 60000));
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
};

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  // Mitiga inyección de fórmulas en hojas de cálculo
  const seguro = /^[=+\-@]/.test(s) ? "'" + s : s;
  return /[",\n;]/.test(seguro) ? '"' + seguro.replace(/"/g, '""') + '"' : seguro;
}
function toCsv(columnas, filas) {
  const head = columnas.map((c) => csvEscape(c.t)).join(',');
  const body = filas.map((f) => columnas.map((c) => csvEscape(f[c.k])).join(','));
  return '﻿' + [head, ...body].join('\r\n');
}

function paginar(req, total, por = 20) {
  const paginas = Math.max(1, Math.ceil(total / por));
  const pagina = Math.min(Math.max(parseInt(req.query.pagina, 10) || 1, 1), paginas);
  const q = new URLSearchParams(req.query); q.delete('pagina');
  return { total, por, paginas, pagina, offset: (pagina - 1) * por, base: q.toString() };
}

const esEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s || '');
const entero = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const esFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

module.exports = { fmtFecha, fmtHora, fmtFechaHora, fmtTime, fmtDur, toCsv, paginar, esEmail, entero, esFecha };
