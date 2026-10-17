'use strict';
require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const helmet = require('helmet');
const { pool, isProd, TZ } = require('./db/pool');
const { migrar } = require('./db/bootstrap');
const { csrf, flash, requireAuth } = require('./middleware/auth');
const util = require('./lib/util');

const app = express();
app.set('trust proxy', 1);                  // Render termina TLS en un proxy inverso
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'script-src': ["'self'", 'https://cdn.jsdelivr.net'],
      'style-src': ["'self'", "'unsafe-inline'"],
      'upgrade-insecure-requests': isProd ? [] : null,
    },
  },
}));

// Health check (antes de la sesión: no genera filas en la BD). Usado por Render.
app.get('/health', async (req, res) => {
  try {
    const r = await pool.query('SELECT now() AS ahora');
    res.json({ status: 'ok', db: 'ok', hora_servidor: r.rows[0].ahora, tz: TZ });
  } catch (e) {
    res.status(503).json({ status: 'error', db: 'down' });
  }
});

app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProd ? '1d' : 0 }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

if (isProd && !process.env.SESSION_SECRET) {
  console.error('Falta SESSION_SECRET en producción.'); process.exit(1);
}
app.use(session({
  store: new PgSession({ pool, tableName: 'session', createTableIfMissing: false }),
  secret: process.env.SESSION_SECRET || 'dev-secret-solo-local',
  name: 'labcontrol.sid',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 8 * 60 * 60 * 1000 },
}));

app.use(flash);
app.use(csrf);
Object.assign(app.locals, util, { TZ, appNombre: 'LabControl' });

app.use('/', require('./routes/auth'));
app.use('/', requireAuth, require('./routes/panel'));
app.use('/personal', requireAuth, require('./routes/personal'));
app.use('/laboratorios', requireAuth, require('./routes/laboratorios'));
app.use('/dispositivos', requireAuth, require('./routes/dispositivos'));
app.use('/usos', requireAuth, require('./routes/usos'));
app.use('/asistencia', requireAuth, require('./routes/asistencia'));
app.use('/reportes', requireAuth, require('./routes/reportes'));
app.use('/bitacora', requireAuth, require('./routes/bitacora'));

app.use((req, res) => res.status(404).render('error', { codigo: 404, mensaje: 'La página solicitada no existe.' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { codigo: 500, mensaje: isProd ? 'Ocurrió un error interno. Inténtalo nuevamente.' : err.message });
});

const PORT = process.env.PORT || 3000;
migrar()
  .then(() => app.listen(PORT, () => console.log(`LabControl escuchando en :${PORT} (${isProd ? 'producción' : 'desarrollo'}, TZ ${TZ})`)))
  .catch((e) => { console.error('Error al migrar la base de datos:', e); process.exit(1); });

module.exports = app;
