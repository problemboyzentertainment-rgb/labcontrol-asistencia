'use strict';
const router = require('express').Router();
const { pool } = require('../db/pool');
const { requireAdmin, msg } = require('../middleware/auth');
const { entero } = require('../lib/util');
const { auditar } = require('../lib/servicios');

router.use(requireAdmin);
const hora = (s, def) => (/^\d{2}:\d{2}$/.test(s || '') ? s : def);

router.get('/', async (req, res, next) => {
  try {
    const filas = (await pool.query(
      `SELECT l.*, (SELECT COUNT(*)::int FROM personal p WHERE p.laboratorio_id=l.id) AS n_personal,
              (SELECT COUNT(*)::int FROM dispositivos d WHERE d.laboratorio_id=l.id) AS n_disp
       FROM laboratorios l ORDER BY l.nombre`)).rows;
    res.render('laboratorios/index', { filas });
  } catch (e) { next(e); }
});
router.get('/nuevo', (req, res) => res.render('laboratorios/form', { l: { aforo: 10, hora_apertura: '08:00', hora_cierre: '17:00', tolerancia_min: 10, activo: true }, error: null }));
router.get('/:id/editar', async (req, res, next) => {
  try {
    const l = (await pool.query('SELECT * FROM laboratorios WHERE id=$1', [entero(req.params.id)])).rows[0];
    if (!l) return next();
    res.render('laboratorios/form', { l, error: null });
  } catch (e) { next(e); }
});

async function guardar(req, res, next, id) {
  const b = req.body;
  const l = { id, nombre: (b.nombre || '').trim(), ubicacion: (b.ubicacion || '').trim(), aforo: entero(b.aforo) || 0,
    hora_apertura: hora(b.hora_apertura, '08:00'), hora_cierre: hora(b.hora_cierre, '17:00'),
    tolerancia_min: entero(b.tolerancia_min) ?? 10, activo: b.activo === 'on' };
  try {
    let error = null;
    if (!l.nombre) error = 'El nombre es obligatorio.';
    else if (l.aforo < 1) error = 'El aforo debe ser mayor que 0.';
    else if (l.tolerancia_min < 0) error = 'La tolerancia no puede ser negativa.';
    else if (l.hora_cierre <= l.hora_apertura) error = 'La hora de cierre debe ser posterior a la de apertura.';
    if (error) return res.status(400).render('laboratorios/form', { l, error });
    const v = [l.nombre, l.ubicacion, l.aforo, l.hora_apertura, l.hora_cierre, l.tolerancia_min, l.activo];
    if (id) await pool.query('UPDATE laboratorios SET nombre=$1,ubicacion=$2,aforo=$3,hora_apertura=$4,hora_cierre=$5,tolerancia_min=$6,activo=$7 WHERE id=$8', [...v, id]);
    else await pool.query('INSERT INTO laboratorios (nombre,ubicacion,aforo,hora_apertura,hora_cierre,tolerancia_min,activo) VALUES ($1,$2,$3,$4,$5,$6,$7)', v);
    await auditar(req.session.user.id, id ? 'editar_laboratorio' : 'crear_laboratorio', 'laboratorio', id, { nombre: l.nombre }, req.ip);
    msg(req, 'ok', 'Laboratorio guardado.');
    res.redirect('/laboratorios');
  } catch (e) {
    if (e.code === '23505') return res.status(400).render('laboratorios/form', { l, error: 'Ya existe un laboratorio con ese nombre.' });
    next(e);
  }
}
router.post('/', (req, res, next) => guardar(req, res, next, null));
router.post('/:id', (req, res, next) => guardar(req, res, next, entero(req.params.id)));
router.post('/:id/eliminar', async (req, res, next) => {
  try {
    const id = entero(req.params.id);
    await pool.query('DELETE FROM laboratorios WHERE id=$1', [id]);
    await auditar(req.session.user.id, 'eliminar_laboratorio', 'laboratorio', id, null, req.ip);
    msg(req, 'ok', 'Laboratorio eliminado (personal y dispositivos quedan sin laboratorio asignado).');
    res.redirect('/laboratorios');
  } catch (e) { next(e); }
});
module.exports = router;
