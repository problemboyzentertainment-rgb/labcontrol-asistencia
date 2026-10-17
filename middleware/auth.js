'use strict';
const crypto = require('crypto');

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  req.session.volverA = req.originalUrl;
  res.redirect('/login');
}
function requireAdmin(req, res, next) {
  if (req.session.user && req.session.user.rol === 'admin') return next();
  res.status(403).render('error', { codigo: 403, mensaje: 'No tienes permisos para acceder a esta sección.' });
}

/** Protección CSRF con token sincronizado en la sesión. */
function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrf = req.session.csrf;
  if (req.method === 'POST') {
    const t = String((req.body && req.body._csrf) || '');
    const a = Buffer.from(t), b = Buffer.from(req.session.csrf);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(403).render('error', { codigo: 403, mensaje: 'Token de seguridad inválido o expirado. Recarga la página e inténtalo de nuevo.' });
    }
  }
  next();
}

function flash(req, res, next) {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.usuario = req.session.user || null;
  res.locals.ruta = req.path;
  next();
}
const msg = (req, tipo, texto) => { req.session.flash = { tipo, texto }; };

module.exports = { requireAuth, requireAdmin, csrf, flash, msg };
