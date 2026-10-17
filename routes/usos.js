'use strict';
// Historial de uso de dispositivos (admin: todos; personal: los propios)
const router = require('express').Router();
const { pool } = require('../db/pool');
const { paginar, esFecha } = require('../lib/util');

router.get('/', async (req, res, next) => {
  try {
    const admin = req.session.user.rol === 'admin';
    const desde = esFecha(req.query.desde) ? req.query.desde : '';
    const hasta = esFecha(req.query.hasta) ? req.query.hasta : '';
    const w = `WHERE ($1::boolean OR u.personal_id=$2) AND ($3='' OR u.inicio::date >= $3::date) AND ($4='' OR u.inicio::date <= $4::date)`;
    const prm = [admin, req.session.user.id, desde, hasta];
    const total = (await pool.query(`SELECT COUNT(*)::int n FROM usos_dispositivo u ${w}`, prm)).rows[0].n;
    const pag = paginar(req, total);
    const filas = (await pool.query(
      `SELECT u.*, d.codigo, d.nombre AS dnombre, p.nombres||' '||p.apellidos AS persona
       FROM usos_dispositivo u JOIN dispositivos d ON d.id=u.dispositivo_id JOIN personal p ON p.id=u.personal_id
       ${w} ORDER BY u.inicio DESC LIMIT $5 OFFSET $6`, [...prm, pag.por, pag.offset])).rows;
    res.render('usos/index', { filas, desde, hasta, pag, admin });
  } catch (e) { next(e); }
});
module.exports = router;
