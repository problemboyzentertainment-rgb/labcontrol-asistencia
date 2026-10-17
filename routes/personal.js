'use strict';
// CRUD de personal tecnológico (solo administrador)
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../db/pool');
const { requireAdmin, msg } = require('../middleware/auth');
const { paginar, esEmail, entero } = require('../lib/util');
const { auditar } = require('../lib/servicios');

router.use(requireAdmin);
const labs = () => pool.query('SELECT id, nombre FROM laboratorios WHERE activo ORDER BY nombre').then((r) => r.rows);

router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const lab = entero(req.query.lab);
    const w = `WHERE ($1 = '' OR p.nombres ILIKE '%'||$1||'%' OR p.apellidos ILIKE '%'||$1||'%' OR p.codigo ILIKE '%'||$1||'%' OR p.email ILIKE '%'||$1||'%')
               AND ($2::int IS NULL OR p.laboratorio_id = $2)`;
    const total = (await pool.query(`SELECT COUNT(*)::int n FROM personal p ${w}`, [q, lab])).rows[0].n;
    const pag = paginar(req, total);
    const filas = (await pool.query(
      `SELECT p.*, l.nombre AS lab FROM personal p LEFT JOIN laboratorios l ON l.id=p.laboratorio_id ${w}
       ORDER BY p.apellidos, p.nombres LIMIT $3 OFFSET $4`, [q, lab, pag.por, pag.offset])).rows;
    res.render('personal/index', { filas, q, lab, labs: await labs(), pag });
  } catch (e) { next(e); }
});

router.get('/nuevo', async (req, res, next) => {
  try { res.render('personal/form', { p: {}, labs: await labs(), error: null }); } catch (e) { next(e); }
});

router.get('/:id/editar', async (req, res, next) => {
  try {
    const p = (await pool.query('SELECT * FROM personal WHERE id=$1', [entero(req.params.id)])).rows[0];
    if (!p) return next();
    res.render('personal/form', { p, labs: await labs(), error: null });
  } catch (e) { next(e); }
});

async function guardar(req, res, next, id) {
  const b = req.body;
  const p = { id, codigo: (b.codigo || '').trim().toUpperCase(), nombres: (b.nombres || '').trim(), apellidos: (b.apellidos || '').trim(),
    email: (b.email || '').trim().toLowerCase(), cargo: (b.cargo || '').trim(), laboratorio_id: entero(b.laboratorio_id),
    rol: b.rol === 'admin' ? 'admin' : 'personal', activo: b.activo === 'on' };
  try {
    let error = null;
    if (!p.codigo || !p.nombres || !p.apellidos) error = 'Código, nombres y apellidos son obligatorios.';
    else if (!esEmail(p.email)) error = 'Correo electrónico inválido.';
    else if (!id && (!b.password || b.password.length < 8)) error = 'La contraseña inicial debe tener al menos 8 caracteres.';
    else if (id && b.password && b.password.length < 8) error = 'La contraseña debe tener al menos 8 caracteres.';
    if (id && id === req.session.user.id && (!p.activo || p.rol !== 'admin')) error = 'No puedes desactivarte ni quitarte el rol de administrador.';
    if (error) return res.status(400).render('personal/form', { p, labs: await labs(), error });
    if (id) {
      await pool.query(
        `UPDATE personal SET codigo=$1,nombres=$2,apellidos=$3,email=$4,cargo=$5,laboratorio_id=$6,rol=$7,activo=$8 WHERE id=$9`,
        [p.codigo, p.nombres, p.apellidos, p.email, p.cargo || 'Técnico de laboratorio', p.laboratorio_id, p.rol, p.activo, id]);
      if (b.password) await pool.query('UPDATE personal SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(b.password, 10), id]);
      await auditar(req.session.user.id, 'editar_personal', 'personal', id, { codigo: p.codigo }, req.ip);
    } else {
      const r = await pool.query(
        `INSERT INTO personal (codigo,nombres,apellidos,email,cargo,laboratorio_id,rol,activo,password_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [p.codigo, p.nombres, p.apellidos, p.email, p.cargo || 'Técnico de laboratorio', p.laboratorio_id, p.rol, p.activo, await bcrypt.hash(b.password, 10)]);
      await auditar(req.session.user.id, 'crear_personal', 'personal', r.rows[0].id, { codigo: p.codigo }, req.ip);
    }
    msg(req, 'ok', 'Personal guardado.');
    res.redirect('/personal');
  } catch (e) {
    if (e.code === '23505') return res.status(400).render('personal/form', { p, labs: await labs(), error: 'Ya existe una persona con ese código o correo.' });
    next(e);
  }
}
router.post('/', (req, res, next) => guardar(req, res, next, null));
router.post('/:id', (req, res, next) => guardar(req, res, next, entero(req.params.id)));

router.post('/:id/eliminar', async (req, res, next) => {
  try {
    const id = entero(req.params.id);
    if (id === req.session.user.id) { msg(req, 'error', 'No puedes eliminar tu propia cuenta.'); return res.redirect('/personal'); }
    await pool.query('DELETE FROM personal WHERE id=$1', [id]);
    await auditar(req.session.user.id, 'eliminar_personal', 'personal', id, null, req.ip);
    msg(req, 'ok', 'Persona eliminada junto con su historial.');
    res.redirect('/personal');
  } catch (e) { next(e); }
});

module.exports = router;
