'use strict';
// Reglas de negocio transaccionales (asistencia y uso de dispositivos).
const { pool } = require('../db/pool');

const MAX_USOS = parseInt(process.env.MAX_USOS_SIMULTANEOS || '3', 10);

class ReglaError extends Error {}

async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

async function auditar(personalId, accion, entidad, entidadId, detalle, ip) {
  try {
    await pool.query(
      'INSERT INTO bitacora (personal_id, accion, entidad, entidad_id, detalle, ip) VALUES ($1,$2,$3,$4,$5,$6)',
      [personalId || null, accion, entidad || null, entidadId != null ? String(entidadId) : null,
       detalle ? JSON.stringify(detalle) : null, ip || null]);
  } catch (e) {
    console.error('[bitacora] no se pudo registrar:', e.message);
  }
}

/** Registra la entrada del día. Estado: presente o tardanza según horario del laboratorio. */
async function marcarEntrada(personalId, ip, origen = 'marcacion') {
  return tx(async (c) => {
    const p = (await c.query(
      `SELECT p.id, p.activo, p.laboratorio_id, l.hora_apertura, l.tolerancia_min
       FROM personal p LEFT JOIN laboratorios l ON l.id = p.laboratorio_id WHERE p.id = $1`, [personalId])).rows[0];
    if (!p || !p.activo) throw new ReglaError('La persona no existe o está inactiva.');
    const apertura = p.hora_apertura || '08:00:00';
    const tol = p.tolerancia_min != null ? p.tolerancia_min : 10;
    const r = await c.query(
      `INSERT INTO asistencias (personal_id, fecha, hora_entrada, estado, laboratorio_id, origen, ip)
       VALUES ($1, CURRENT_DATE, now(),
         CASE WHEN localtime(0) > ($2::time + ($3::int * interval '1 minute')) THEN 'tardanza' ELSE 'presente' END,
         $4, $5, $6)
       ON CONFLICT (personal_id, fecha) DO UPDATE
         SET hora_entrada = now(), estado = EXCLUDED.estado, origen = EXCLUDED.origen, ip = EXCLUDED.ip
         WHERE asistencias.hora_entrada IS NULL
       RETURNING *`,
      [personalId, apertura, tol, p.laboratorio_id, origen, ip || null]);
    if (!r.rows.length) throw new ReglaError('Ya registraste tu entrada hoy.');
    return r.rows[0];
  });
}

/** Registra la salida y cierra automáticamente los usos de dispositivos abiertos. */
async function marcarSalida(personalId, ip) {
  return tx(async (c) => {
    const r = await c.query(
      `UPDATE asistencias SET hora_salida = now()
       WHERE personal_id = $1 AND fecha = CURRENT_DATE AND hora_entrada IS NOT NULL AND hora_salida IS NULL
       RETURNING *`, [personalId]);
    if (!r.rows.length) {
      const e = (await c.query('SELECT hora_entrada, hora_salida FROM asistencias WHERE personal_id=$1 AND fecha=CURRENT_DATE', [personalId])).rows[0];
      throw new ReglaError(!e || !e.hora_entrada ? 'Primero debes registrar tu entrada.' : 'Ya registraste tu salida hoy.');
    }
    const cerrados = (await c.query(
      `UPDATE usos_dispositivo SET fin = now(),
         observacion = COALESCE(observacion || ' | ', '') || 'Cierre automático por salida'
       WHERE personal_id = $1 AND fin IS NULL RETURNING dispositivo_id`, [personalId])).rows;
    if (cerrados.length) {
      await c.query(`UPDATE dispositivos SET estado = 'disponible' WHERE id = ANY($1::int[]) AND estado = 'en_uso'`,
        [cerrados.map((x) => x.dispositivo_id)]);
    }
    return { asistencia: r.rows[0], cerrados: cerrados.length };
  });
}

/** Inicia el uso de un dispositivo. Exige asistencia vigente (entrada sin salida). */
async function iniciarUso(personalId, dispositivoId, proposito, ip) {
  if (!proposito || !proposito.trim()) throw new ReglaError('Indica el propósito del uso.');
  try {
    return await tx(async (c) => {
      const a = (await c.query(
        `SELECT 1 FROM asistencias WHERE personal_id=$1 AND fecha=CURRENT_DATE
         AND hora_entrada IS NOT NULL AND hora_salida IS NULL`, [personalId])).rows[0];
      if (!a) throw new ReglaError('Debes tener tu entrada registrada hoy (y no la salida) para usar un dispositivo.');
      const abiertos = (await c.query(
        'SELECT COUNT(*)::int n FROM usos_dispositivo WHERE personal_id=$1 AND fin IS NULL', [personalId])).rows[0].n;
      if (abiertos >= MAX_USOS) throw new ReglaError(`Alcanzaste el máximo de ${MAX_USOS} dispositivos en uso simultáneo.`);
      const d = (await c.query(
        `UPDATE dispositivos SET estado='en_uso' WHERE id=$1 AND estado='disponible' RETURNING *`, [dispositivoId])).rows[0];
      if (!d) throw new ReglaError('El dispositivo no está disponible (en uso, en mantenimiento o dado de baja).');
      const u = (await c.query(
        `INSERT INTO usos_dispositivo (dispositivo_id, personal_id, proposito) VALUES ($1,$2,$3) RETURNING *`,
        [dispositivoId, personalId, proposito.trim().slice(0, 255)])).rows[0];
      return { uso: u, dispositivo: d };
    });
  } catch (e) {
    if (e.code === '23505') throw new ReglaError('El dispositivo acaba de ser tomado por otra persona.');
    throw e;
  }
}

/** Finaliza un uso. El personal solo puede cerrar los suyos; el admin cualquiera. */
async function devolverUso(usoId, personalId, esAdmin, observacion) {
  return tx(async (c) => {
    const u = (await c.query(
      `UPDATE usos_dispositivo SET fin = now(), observacion = NULLIF($4,'')
       WHERE id=$1 AND fin IS NULL AND ($3::boolean OR personal_id=$2) RETURNING *`,
      [usoId, personalId, !!esAdmin, (observacion || '').trim().slice(0, 255)])).rows[0];
    if (!u) throw new ReglaError('No se encontró un uso abierto que puedas finalizar.');
    await c.query(`UPDATE dispositivos SET estado='disponible' WHERE id=$1 AND estado='en_uso'`, [u.dispositivo_id]);
    return u;
  });
}

module.exports = { ReglaError, marcarEntrada, marcarSalida, iniciarUso, devolverUso, auditar, tx, MAX_USOS };
