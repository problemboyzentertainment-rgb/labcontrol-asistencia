'use strict';
// Pool de conexiones PostgreSQL + configuración de zona horaria y tipos.
const { Pool, types } = require('pg');

types.setTypeParser(1082, (v) => v);        // DATE -> 'YYYY-MM-DD' (sin desfase de zona)
types.setTypeParser(20, (v) => parseInt(v, 10)); // BIGINT -> number

const TZ = /^[A-Za-z_\/+\-0-9]+$/.test(process.env.APP_TZ || '') ? process.env.APP_TZ : 'America/Guayaquil';
const isProd = process.env.NODE_ENV === 'production';
const sslEnv = process.env.DATABASE_SSL;
const useSsl = sslEnv ? sslEnv === 'true' : isProd;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Todas las conexiones trabajan en la zona horaria de la institución
pool.on('connect', (client) => client.query(`SET TIME ZONE '${TZ}'`));
pool.on('error', (err) => console.error('[pg] error en cliente inactivo:', err.message));

module.exports = { pool, TZ, isProd };
