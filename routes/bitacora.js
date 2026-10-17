'use strict';
const router = require('express').Router();
const { pool } = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');
const { paginar } = require('../lib/util');

router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const accion = String(req.query.accion || '').trim();
    const total = (await pool.query(`SELECT COUNT(*)::int n FROM bitacora WHERE $1='' OR accion=$1`, [accion])).rows[0].n;
    const pag = paginar(req, total, 25);
    const filas = (await pool.query(
      `SELECT b.*, p.nombres||' '||p.apellidos AS persona FROM bitacora b LEFT JOIN personal p ON p.id=b.personal_id
       WHERE $1='' OR b.accion=$1 ORDER BY b.creado_en DESC LIMIT $2 OFFSET $3`, [accion, pag.por, pag.offset])).rows;
    const acciones = (await pool.query('SELECT DISTINCT accion FROM bitacora ORDER BY accion')).rows.map((r) => r.accion);
    res.render('bitacora/index', { filas, pag, accion, acciones });
  } catch (e) { next(e); }
});
module.exports = router;
