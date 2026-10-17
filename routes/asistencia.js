'use strict';
// Consulta diaria y registro manual masivo de asistencia (administrador)
const router = require('express').Router();
const { pool } = require('../db/pool');
const { requireAdmin, msg } = require('../middleware/auth');
const { entero, esFecha } = require('../lib/util');
const { auditar } = require('../lib/servicios');

router.use(requireAdmin);
const ESTADOS = ['presente', 'tardanza', 'ausente', 'justificado'];

router.get('/', async (req, res, next) => {
  try {
    const hoy = (await pool.query('SELECT CURRENT_DATE AS f')).rows[0].f;
    const fecha = esFecha(req.query.fecha) ? req.query.fecha : hoy;
    const lab = entero(req.query.lab);
    const filas = (await pool.query(
      `SELECT p.id, p.codigo, p.nombres||' '||p.apellidos AS nombre, l.nombre AS lab,
              a.estado, a.hora_entrada, a.hora_salida, a.observacion, a.origen
       FROM personal p LEFT JOIN laboratorios l ON l.id=p.laboratorio_id
       LEFT JOIN asistencias a ON a.personal_id=p.id AND a.fecha=$1::date
       WHERE p.activo AND p.rol='personal' AND ($2::int IS NULL OR p.laboratorio_id=$2)
       ORDER BY p.apellidos, p.nombres`, [fecha, lab])).rows;
    const labs = (await pool.query('SELECT id, nombre FROM laboratorios ORDER BY nombre')).rows;
    res.render('asistencia/index', { filas, fecha, lab, labs, ESTADOS });
  } catch (e) { next(e); }
});

router.post('/manual', async (req, res, next) => {
  try {
    const fecha = req.body.fecha;
    if (!esFecha(fecha)) { msg(req, 'error', 'Fecha inválida.'); return res.redirect('/asistencia'); }
    let n = 0;
    for (const [k, v] of Object.entries(req.body)) {
      const m = /^estado_(\d+)$/.exec(k);
      if (!m || !ESTADOS.includes(v)) continue;
      const pid = parseInt(m[1], 10);
      const obs = String(req.body['obs_' + pid] || '').trim().slice(0, 255) || null;
      await pool.query(
        `INSERT INTO asistencias (personal_id, fecha, estado, laboratorio_id, observacion, origen)
         SELECT p.id, $2::date, $3, p.laboratorio_id, $4, 'manual' FROM personal p WHERE p.id=$1
         ON CONFLICT (personal_id, fecha) DO UPDATE SET estado=EXCLUDED.estado, observacion=EXCLUDED.observacion, origen='manual'
           WHERE asistencias.estado IS DISTINCT FROM EXCLUDED.estado OR asistencias.observacion IS DISTINCT FROM EXCLUDED.observacion`,
        [pid, fecha, v, obs]);
      n++;
    }
    await auditar(req.session.user.id, 'asistencia_manual', 'asistencia', fecha, { registros: n }, req.ip);
    msg(req, 'ok', `Asistencia guardada para ${n} persona(s).`);
    res.redirect(`/asistencia?fecha=${fecha}${req.body.lab ? '&lab=' + encodeURIComponent(req.body.lab) : ''}`);
  } catch (e) { next(e); }
});
module.exports = router;
