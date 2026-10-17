'use strict';
// Dashboard (admin), marcación (todos), kiosco (admin) y perfil.
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../db/pool');
const { requireAdmin, msg } = require('../middleware/auth');
const S = require('../lib/servicios');

router.get('/', async (req, res, next) => {
  try {
    if (req.session.user.rol !== 'admin') return res.redirect('/marcar');
    const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
    const [[k], serie, enLab, usosActivos, estados] = await Promise.all([
      q(`SELECT
          (SELECT COUNT(*)::int FROM personal WHERE activo AND rol='personal') AS total,
          (SELECT COUNT(*)::int FROM asistencias WHERE fecha=CURRENT_DATE AND estado='presente') AS presentes,
          (SELECT COUNT(*)::int FROM asistencias WHERE fecha=CURRENT_DATE AND estado='tardanza') AS tardanzas,
          (SELECT COUNT(*)::int FROM asistencias WHERE fecha=CURRENT_DATE AND estado='justificado') AS justificados,
          (SELECT COUNT(*)::int FROM usos_dispositivo WHERE fin IS NULL) AS usos_activos,
          (SELECT COUNT(*)::int FROM usos_dispositivo WHERE inicio::date=CURRENT_DATE) AS usos_hoy`),
      q(`SELECT d::date AS fecha,
          COUNT(a.id) FILTER (WHERE a.estado='presente')::int AS presentes,
          COUNT(a.id) FILTER (WHERE a.estado='tardanza')::int AS tardanzas,
          COUNT(a.id) FILTER (WHERE a.estado IN ('ausente','justificado'))::int AS ausentes
         FROM generate_series(CURRENT_DATE-6, CURRENT_DATE, interval '1 day') d
         LEFT JOIN asistencias a ON a.fecha = d::date GROUP BY d ORDER BY d`),
      q(`SELECT p.codigo, p.nombres||' '||p.apellidos AS nombre, a.hora_entrada, a.estado, l.nombre AS lab
         FROM asistencias a JOIN personal p ON p.id=a.personal_id LEFT JOIN laboratorios l ON l.id=a.laboratorio_id
         WHERE a.fecha=CURRENT_DATE AND a.hora_entrada IS NOT NULL AND a.hora_salida IS NULL ORDER BY a.hora_entrada`),
      q(`SELECT u.id, u.inicio, u.proposito, d.codigo AS dcodigo, d.nombre AS dnombre, p.nombres||' '||p.apellidos AS persona
         FROM usos_dispositivo u JOIN dispositivos d ON d.id=u.dispositivo_id JOIN personal p ON p.id=u.personal_id
         WHERE u.fin IS NULL ORDER BY u.inicio`),
      q(`SELECT estado, COUNT(*)::int AS n FROM dispositivos GROUP BY estado ORDER BY estado`),
    ]);
    k.ausentes = Math.max(0, k.total - k.presentes - k.tardanzas - k.justificados);
    res.render('dashboard', { k, serie, enLab, usosActivos, estados });
  } catch (e) { next(e); }
});

async function estadoPersona(id) {
  const asis = (await pool.query('SELECT * FROM asistencias WHERE personal_id=$1 AND fecha=CURRENT_DATE', [id])).rows[0] || null;
  const usos = (await pool.query(
    `SELECT u.*, d.codigo, d.nombre FROM usos_dispositivo u JOIN dispositivos d ON d.id=u.dispositivo_id
     WHERE u.personal_id=$1 AND u.fin IS NULL ORDER BY u.inicio`, [id])).rows;
  const hist = (await pool.query(
    `SELECT fecha, hora_entrada, hora_salida, estado FROM asistencias WHERE personal_id=$1 ORDER BY fecha DESC LIMIT 7`, [id])).rows;
  return { asis, usos, hist };
}

router.get('/marcar', async (req, res, next) => {
  try { res.render('marcar', await estadoPersona(req.session.user.id)); } catch (e) { next(e); }
});

router.post('/marcar/:accion(entrada|salida)', async (req, res, next) => {
  const u = req.session.user;
  try {
    if (req.params.accion === 'entrada') {
      const a = await S.marcarEntrada(u.id, req.ip);
      await S.auditar(u.id, 'marcar_entrada', 'asistencia', a.id, { estado: a.estado }, req.ip);
      msg(req, 'ok', a.estado === 'tardanza' ? 'Entrada registrada con TARDANZA.' : 'Entrada registrada correctamente.');
    } else {
      const r = await S.marcarSalida(u.id, req.ip);
      await S.auditar(u.id, 'marcar_salida', 'asistencia', r.asistencia.id, { usos_cerrados: r.cerrados }, req.ip);
      msg(req, 'ok', 'Salida registrada.' + (r.cerrados ? ` Se cerraron ${r.cerrados} uso(s) de dispositivos.` : ''));
    }
  } catch (e) {
    if (!(e instanceof S.ReglaError)) return next(e);
    msg(req, 'error', e.message);
  }
  res.redirect('/marcar');
});

// ---- Kiosco: equipo del laboratorio con sesión de administrador; la persona se identifica con código + contraseña
router.get('/kiosco', requireAdmin, (req, res) => res.render('kiosco'));
router.post('/kiosco', requireAdmin, async (req, res, next) => {
  try {
    const codigo = String(req.body.codigo || '').trim().toUpperCase();
    const accion = req.body.accion === 'salida' ? 'salida' : 'entrada';
    const p = (await pool.query('SELECT * FROM personal WHERE UPPER(codigo)=$1 AND activo', [codigo])).rows[0];
    const ok = p && await bcrypt.compare(String(req.body.password || ''), p.password_hash);
    if (!ok) { msg(req, 'error', 'Código o contraseña incorrectos.'); return res.redirect('/kiosco'); }
    if (accion === 'entrada') {
      const a = await S.marcarEntrada(p.id, req.ip, 'kiosco');
      await S.auditar(p.id, 'kiosco_entrada', 'asistencia', a.id, { estado: a.estado }, req.ip);
      msg(req, 'ok', `${p.nombres} ${p.apellidos}: entrada registrada (${a.estado}).`);
    } else {
      const r = await S.marcarSalida(p.id, req.ip);
      await S.auditar(p.id, 'kiosco_salida', 'asistencia', r.asistencia.id, null, req.ip);
      msg(req, 'ok', `${p.nombres} ${p.apellidos}: salida registrada.`);
    }
  } catch (e) {
    if (!(e instanceof S.ReglaError)) return next(e);
    msg(req, 'error', e.message);
  }
  res.redirect('/kiosco');
});

// ---- Perfil
router.get('/perfil', async (req, res, next) => {
  try {
    const p = (await pool.query('SELECT p.*, l.nombre AS lab FROM personal p LEFT JOIN laboratorios l ON l.id=p.laboratorio_id WHERE p.id=$1', [req.session.user.id])).rows[0];
    res.render('perfil', { p });
  } catch (e) { next(e); }
});
router.post('/perfil/password', async (req, res, next) => {
  try {
    const { actual, nueva, confirmar } = req.body;
    const p = (await pool.query('SELECT password_hash FROM personal WHERE id=$1', [req.session.user.id])).rows[0];
    if (!(await bcrypt.compare(String(actual || ''), p.password_hash))) msg(req, 'error', 'La contraseña actual no es correcta.');
    else if (!nueva || nueva.length < 8) msg(req, 'error', 'La nueva contraseña debe tener al menos 8 caracteres.');
    else if (nueva !== confirmar) msg(req, 'error', 'La confirmación no coincide.');
    else {
      await pool.query('UPDATE personal SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(nueva, 10), req.session.user.id]);
      await S.auditar(req.session.user.id, 'cambio_password', 'personal', req.session.user.id, null, req.ip);
      msg(req, 'ok', 'Contraseña actualizada.');
    }
    res.redirect('/perfil');
  } catch (e) { next(e); }
});

module.exports = router;
