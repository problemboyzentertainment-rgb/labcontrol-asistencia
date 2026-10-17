'use strict';
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db/pool');
const { msg } = require('../middleware/auth');
const { auditar } = require('../lib/servicios');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => res.status(429).render('login', { error: 'Demasiados intentos. Espera 15 minutos.', email: '' }),
});
const DUMMY = bcrypt.hashSync('dummy-password', 10);

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null, email: '' });
});

router.post('/login', limiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const pass = String(req.body.password || '');
    const u = (await pool.query('SELECT * FROM personal WHERE email=$1', [email])).rows[0];
    const ok = await bcrypt.compare(pass, u ? u.password_hash : DUMMY); // tiempo constante
    if (!u || !u.activo || !ok) {
      await auditar(u && u.id, 'login_fallido', 'personal', u && u.id, { email }, req.ip);
      return res.status(401).render('login', { error: 'Credenciales inválidas.', email });
    }
    const destino = req.session.volverA || '/';
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: u.id, nombre: `${u.nombres} ${u.apellidos}`, rol: u.rol, codigo: u.codigo };
      req.session.save(async () => {
        await auditar(u.id, 'login', 'personal', u.id, null, req.ip);
        res.redirect(destino.startsWith('/') ? destino : '/');
      });
    });
  } catch (e) { next(e); }
});

router.post('/logout', (req, res) => {
  const id = req.session.user && req.session.user.id;
  auditar(id, 'logout', 'personal', id, null, req.ip);
  req.session.destroy(() => { res.clearCookie('labcontrol.sid'); res.redirect('/login'); });
});

module.exports = router;
