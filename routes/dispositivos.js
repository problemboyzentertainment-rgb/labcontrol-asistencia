'use strict';
// Inventario de dispositivos (CRUD admin) + tomar/devolver (todo el personal)
const router = require('express').Router();
const { pool } = require('../db/pool');
const { requireAdmin, msg } = require('../middleware/auth');
const { entero, paginar } = require('../lib/util');
const S = require('../lib/servicios');

const ESTADOS = ['disponible', 'en_uso', 'mantenimiento', 'baja'];
const labs = () => pool.query('SELECT id, nombre FROM laboratorios ORDER BY nombre').then((r) => r.rows);

router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const estado = ESTADOS.includes(req.query.estado) ? req.query.estado : '';
    const lab = entero(req.query.lab);
    const w = `WHERE ($1='' OR d.nombre ILIKE '%'||$1||'%' OR d.codigo ILIKE '%'||$1||'%' OR d.tipo ILIKE '%'||$1||'%')
               AND ($2='' OR d.estado=$2) AND ($3::int IS NULL OR d.laboratorio_id=$3)`;
    const total = (await pool.query(`SELECT COUNT(*)::int n FROM dispositivos d ${w}`, [q, estado, lab])).rows[0].n;
    const pag = paginar(req, total, 15);
    const filas = (await pool.query(
      `SELECT d.*, l.nombre AS lab,
         (SELECT p.nombres||' '||p.apellidos FROM usos_dispositivo u JOIN personal p ON p.id=u.personal_id
          WHERE u.dispositivo_id=d.id AND u.fin IS NULL) AS usuario_actual
       FROM dispositivos d LEFT JOIN laboratorios l ON l.id=d.laboratorio_id ${w}
       ORDER BY d.codigo LIMIT $4 OFFSET $5`, [q, estado, lab, pag.por, pag.offset])).rows;
    res.render('dispositivos/index', { filas, q, estado, lab, labs: await labs(), pag, ESTADOS });
  } catch (e) { next(e); }
});

router.get('/nuevo', requireAdmin, async (req, res, next) => {
  try { res.render('dispositivos/form', { d: { estado: 'disponible' }, labs: await labs(), ESTADOS, error: null }); } catch (e) { next(e); }
});
router.get('/:id/editar', requireAdmin, async (req, res, next) => {
  try {
    const d = (await pool.query('SELECT * FROM dispositivos WHERE id=$1', [entero(req.params.id)])).rows[0];
    if (!d) return next();
    res.render('dispositivos/form', { d, labs: await labs(), ESTADOS, error: null });
  } catch (e) { next(e); }
});

async function guardar(req, res, next, id) {
  const b = req.body;
  const d = { id, codigo: (b.codigo || '').trim().toUpperCase(), nombre: (b.nombre || '').trim(), tipo: (b.tipo || '').trim(),
    marca: (b.marca || '').trim(), modelo: (b.modelo || '').trim(), serie: (b.serie || '').trim(),
    laboratorio_id: entero(b.laboratorio_id), estado: ESTADOS.includes(b.estado) ? b.estado : 'disponible' };
  try {
    if (!d.codigo || !d.nombre || !d.tipo)
      return res.status(400).render('dispositivos/form', { d, labs: await labs(), ESTADOS, error: 'Código, nombre y tipo son obligatorios.' });
    if (id) {
      const abierto = (await pool.query('SELECT 1 FROM usos_dispositivo WHERE dispositivo_id=$1 AND fin IS NULL', [id])).rows[0];
      if (abierto) d.estado = 'en_uso'; // el estado lo gobierna el uso abierto
      await pool.query('UPDATE dispositivos SET codigo=$1,nombre=$2,tipo=$3,marca=$4,modelo=$5,serie=$6,laboratorio_id=$7,estado=$8 WHERE id=$9',
        [d.codigo, d.nombre, d.tipo, d.marca, d.modelo, d.serie, d.laboratorio_id, d.estado, id]);
    } else {
      if (d.estado === 'en_uso') d.estado = 'disponible';
      await pool.query('INSERT INTO dispositivos (codigo,nombre,tipo,marca,modelo,serie,laboratorio_id,estado) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [d.codigo, d.nombre, d.tipo, d.marca, d.modelo, d.serie, d.laboratorio_id, d.estado]);
    }
    await S.auditar(req.session.user.id, id ? 'editar_dispositivo' : 'crear_dispositivo', 'dispositivo', id, { codigo: d.codigo }, req.ip);
    msg(req, 'ok', 'Dispositivo guardado.');
    res.redirect('/dispositivos');
  } catch (e) {
    if (e.code === '23505') return res.status(400).render('dispositivos/form', { d, labs: await labs(), ESTADOS, error: 'Ya existe un dispositivo con ese código.' });
    next(e);
  }
}
router.post('/', requireAdmin, (req, res, next) => guardar(req, res, next, null));
router.post('/:id/eliminar', requireAdmin, async (req, res, next) => {
  try {
    const id = entero(req.params.id);
    await pool.query('DELETE FROM dispositivos WHERE id=$1', [id]);
    await S.auditar(req.session.user.id, 'eliminar_dispositivo', 'dispositivo', id, null, req.ip);
    msg(req, 'ok', 'Dispositivo eliminado.');
    res.redirect('/dispositivos');
  } catch (e) { next(e); }
});

// Tomar / devolver
router.post('/:id/usar', async (req, res, next) => {
  try {
    const r = await S.iniciarUso(req.session.user.id, entero(req.params.id), req.body.proposito, req.ip);
    await S.auditar(req.session.user.id, 'iniciar_uso', 'uso', r.uso.id, { dispositivo: r.dispositivo.codigo }, req.ip);
    msg(req, 'ok', `Uso iniciado: ${r.dispositivo.nombre}.`);
  } catch (e) { if (!(e instanceof S.ReglaError)) return next(e); msg(req, 'error', e.message); }
  res.redirect(req.get('referer') && req.get('referer').includes('/marcar') ? '/marcar' : '/dispositivos');
});
router.post('/uso/:usoId/devolver', async (req, res, next) => {
  try {
    const u = await S.devolverUso(entero(req.params.usoId), req.session.user.id, req.session.user.rol === 'admin', req.body.observacion);
    await S.auditar(req.session.user.id, 'finalizar_uso', 'uso', u.id, null, req.ip);
    msg(req, 'ok', 'Dispositivo devuelto y marcado como disponible.');
  } catch (e) { if (!(e instanceof S.ReglaError)) return next(e); msg(req, 'error', e.message); }
  res.redirect(req.body.volver === 'marcar' ? '/marcar' : req.body.volver === 'usos' ? '/usos' : '/dispositivos');
});
router.post('/:id', requireAdmin, (req, res, next) => guardar(req, res, next, entero(req.params.id)));

module.exports = router;
