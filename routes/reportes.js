'use strict';
// Reportes analíticos con exportación CSV (administrador)
const router = require('express').Router();
const { pool } = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');
const { entero, esFecha, toCsv, fmtFechaHora } = require('../lib/util');

router.use(requireAdmin);

async function rango(req) {
  const d = (await pool.query(`SELECT (CURRENT_DATE - 29)::text AS d, CURRENT_DATE::text AS h`)).rows[0];
  const desde = esFecha(req.query.desde) ? req.query.desde : d.d;
  const hasta = esFecha(req.query.hasta) ? req.query.hasta : d.h;
  return { desde, hasta, lab: entero(req.query.lab) };
}

const SQL_ASIST = `
  WITH dias AS (SELECT COUNT(*)::int n FROM generate_series($1::date,$2::date,interval '1 day') g WHERE EXTRACT(isodow FROM g) < 6)
  SELECT p.codigo, p.nombres||' '||p.apellidos AS nombre, COALESCE(l.nombre,'—') AS lab,
    COUNT(a.id) FILTER (WHERE a.estado='presente')::int AS presentes,
    COUNT(a.id) FILTER (WHERE a.estado='tardanza')::int AS tardanzas,
    COUNT(a.id) FILTER (WHERE a.estado='justificado')::int AS justificados,
    (SELECT n FROM dias) AS dias_laborables,
    GREATEST(0,(SELECT n FROM dias) - COUNT(a.id) FILTER (WHERE a.estado IN ('presente','tardanza','justificado')))::int AS ausencias,
    COALESCE(ROUND(100.0*COUNT(a.id) FILTER (WHERE a.estado IN ('presente','tardanza'))/NULLIF((SELECT n FROM dias),0),1),0) AS pct_asistencia,
    ROUND(COALESCE(SUM(EXTRACT(EPOCH FROM (a.hora_salida-a.hora_entrada))/3600),0)::numeric,1) AS horas
  FROM personal p LEFT JOIN laboratorios l ON l.id=p.laboratorio_id
  LEFT JOIN asistencias a ON a.personal_id=p.id AND a.fecha BETWEEN $1::date AND $2::date
  WHERE p.activo AND p.rol='personal' AND ($3::int IS NULL OR p.laboratorio_id=$3)
  GROUP BY p.id, l.nombre ORDER BY p.apellidos, p.nombres`;

const SQL_USO = `
  SELECT d.codigo, d.nombre, d.tipo, COALESCE(l.nombre,'—') AS lab,
    COUNT(u.id)::int AS usos,
    ROUND(COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(u.fin, now()) - u.inicio))/3600),0)::numeric,1) AS horas,
    COUNT(DISTINCT u.personal_id)::int AS personas
  FROM dispositivos d LEFT JOIN laboratorios l ON l.id=d.laboratorio_id
  LEFT JOIN usos_dispositivo u ON u.dispositivo_id=d.id AND u.inicio::date BETWEEN $1::date AND $2::date
  WHERE ($3::int IS NULL OR d.laboratorio_id=$3)
  GROUP BY d.id, l.nombre ORDER BY horas DESC, d.codigo`;

router.get('/', async (req, res, next) => {
  try {
    const { desde, hasta, lab } = await rango(req);
    const [asis, uso, labs] = await Promise.all([
      pool.query(SQL_ASIST, [desde, hasta, lab]), pool.query(SQL_USO, [desde, hasta, lab]),
      pool.query('SELECT id, nombre FROM laboratorios ORDER BY nombre')]);
    const prom = asis.rows.length ? (asis.rows.reduce((s, r) => s + Number(r.pct_asistencia), 0) / asis.rows.length).toFixed(1) : '0.0';
    res.render('reportes/index', { desde, hasta, lab, labs: labs.rows, asis: asis.rows, uso: uso.rows, prom });
  } catch (e) { next(e); }
});

function enviarCsv(res, nombre, csv) {
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nombre}"` });
  res.send(csv);
}
router.get('/asistencia.csv', async (req, res, next) => {
  try {
    const { desde, hasta, lab } = await rango(req);
    const r = await pool.query(SQL_ASIST, [desde, hasta, lab]);
    enviarCsv(res, `asistencia_${desde}_${hasta}.csv`, toCsv([
      { k: 'codigo', t: 'Código' }, { k: 'nombre', t: 'Nombre' }, { k: 'lab', t: 'Laboratorio' },
      { k: 'dias_laborables', t: 'Días laborables' }, { k: 'presentes', t: 'Presentes' }, { k: 'tardanzas', t: 'Tardanzas' },
      { k: 'justificados', t: 'Justificados' }, { k: 'ausencias', t: 'Ausencias' }, { k: 'pct_asistencia', t: '% Asistencia' },
      { k: 'horas', t: 'Horas trabajadas' }], r.rows));
  } catch (e) { next(e); }
});
router.get('/usos.csv', async (req, res, next) => {
  try {
    const { desde, hasta } = await rango(req);
    const r = await pool.query(
      `SELECT d.codigo AS dcodigo, d.nombre AS dnombre, p.codigo AS pcodigo, p.nombres||' '||p.apellidos AS persona,
              u.inicio, u.fin, u.proposito, u.observacion
       FROM usos_dispositivo u JOIN dispositivos d ON d.id=u.dispositivo_id JOIN personal p ON p.id=u.personal_id
       WHERE u.inicio::date BETWEEN $1::date AND $2::date ORDER BY u.inicio`, [desde, hasta]);
    const filas = r.rows.map((x) => ({ ...x, inicio: fmtFechaHora(x.inicio), fin: x.fin ? fmtFechaHora(x.fin) : 'En uso' }));
    enviarCsv(res, `usos_dispositivos_${desde}_${hasta}.csv`, toCsv([
      { k: 'dcodigo', t: 'Cód. dispositivo' }, { k: 'dnombre', t: 'Dispositivo' }, { k: 'pcodigo', t: 'Cód. persona' },
      { k: 'persona', t: 'Persona' }, { k: 'inicio', t: 'Inicio' }, { k: 'fin', t: 'Fin' },
      { k: 'proposito', t: 'Propósito' }, { k: 'observacion', t: 'Observación' }], filas));
  } catch (e) { next(e); }
});
module.exports = router;
