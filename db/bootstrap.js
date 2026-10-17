'use strict';
// Migración idempotente + semilla. Se ejecuta al arrancar el servidor.
// Usa un advisory lock para que varias instancias no migren a la vez.
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool } = require('./pool');

const LOCK_ID = 727272;

async function migrar() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const c = await pool.connect();
  try {
    await c.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await c.query(sql);
    await sembrarBase(c);
    if (process.env.SEED_DEMO === 'true') await sembrarDemo(c);
  } finally {
    await c.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    c.release();
  }
}

async function sembrarBase(c) {
  const email = (process.env.ADMIN_EMAIL || 'admin@labcontrol.edu').toLowerCase();
  const pass = process.env.ADMIN_PASSWORD || 'Admin12345!';
  const hash = await bcrypt.hash(pass, 10);
  await c.query(
    `INSERT INTO personal (codigo, nombres, apellidos, email, cargo, password_hash, rol)
     VALUES ('ADM-001','Administrador','del Sistema',$1,'Administrador',$2,'admin')
     ON CONFLICT (email) DO NOTHING`, [email, hash]);
}

async function sembrarDemo(c) {
  const { rows } = await c.query('SELECT COUNT(*)::int n FROM asistencias');
  if (rows[0].n > 0) return; // ya sembrado

  const hash = await bcrypt.hash(process.env.DEMO_PASSWORD || 'Demo12345!', 10);

  await c.query(`INSERT INTO laboratorios (nombre, ubicacion, aforo, hora_apertura, hora_cierre, tolerancia_min) VALUES
    ('Laboratorio de Redes y Cloud','Edificio A · Piso 2',12,'08:00','17:00',10),
    ('Laboratorio de IoT y Sistemas Embebidos','Edificio B · Piso 1',10,'08:30','17:30',10),
    ('Laboratorio de Cómputo de Alto Rendimiento','Edificio C · Piso 3',8,'07:30','16:30',5)
    ON CONFLICT (nombre) DO NOTHING`);
  const labs = (await c.query('SELECT id FROM laboratorios ORDER BY id')).rows.map((r) => r.id);

  const personas = [
    ['TEC-001','Carlos','Mendoza','carlos.mendoza@labcontrol.edu','Técnico de redes'],
    ['TEC-002','Lucía','Paredes','lucia.paredes@labcontrol.edu','Ingeniera de infraestructura cloud'],
    ['TEC-003','Andrés','Vera','andres.vera@labcontrol.edu','Técnico de IoT'],
    ['TEC-004','María','Zambrano','maria.zambrano@labcontrol.edu','Investigadora asistente'],
    ['TEC-005','Jorge','Alcívar','jorge.alcivar@labcontrol.edu','Administrador de servidores HPC'],
    ['TEC-006','Paola','Cedeño','paola.cedeno@labcontrol.edu','Técnica de laboratorio'],
    ['TEC-007','Diego','Loor','diego.loor@labcontrol.edu','Técnico de redes'],
    ['TEC-008','Valeria','Moreira','valeria.moreira@labcontrol.edu','Analista de seguridad'],
  ];
  for (let i = 0; i < personas.length; i++) {
    const p = personas[i];
    await c.query(
      `INSERT INTO personal (codigo,nombres,apellidos,email,cargo,laboratorio_id,password_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
      [p[0], p[1], p[2], p[3], p[4], labs[i % labs.length], hash]);
  }

  const disp = [
    ['DSP-001','Switch Cisco Catalyst 9200','Red','Cisco','C9200-24P'],
    ['DSP-002','Router MikroTik CCR','Red','MikroTik','CCR1036'],
    ['DSP-003','Servidor Dell PowerEdge','Servidor','Dell','R750'],
    ['DSP-004','Osciloscopio Digital','Instrumentación','Rigol','DS1054Z'],
    ['DSP-005','Raspberry Pi 5 Kit','Embebido','Raspberry Pi','Pi 5 8GB'],
    ['DSP-006','Kit Arduino + Sensores','Embebido','Arduino','Mega 2560'],
    ['DSP-007','Laptop de pruebas','Cómputo','Lenovo','ThinkPad T14'],
    ['DSP-008','Estación GPU','Cómputo','NVIDIA','RTX 4090 WS'],
    ['DSP-009','Analizador de espectro','Instrumentación','Keysight','N9000B'],
    ['DSP-010','Access Point Wi-Fi 6','Red','Ubiquiti','U6-Pro'],
  ];
  for (let i = 0; i < disp.length; i++) {
    const d = disp[i];
    await c.query(
      `INSERT INTO dispositivos (codigo,nombre,tipo,marca,modelo,serie,laboratorio_id,estado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (codigo) DO NOTHING`,
      [d[0], d[1], d[2], d[3], d[4], 'SN' + (100000 + i * 137), labs[i % labs.length],
       i === 8 ? 'mantenimiento' : 'disponible']);
  }

  // Asistencias históricas de los últimos 14 días (solo días laborables, pasados)
  const ids = (await c.query(`SELECT p.id, COALESCE(l.hora_apertura,'08:00') ap, p.laboratorio_id
                              FROM personal p LEFT JOIN laboratorios l ON l.id=p.laboratorio_id
                              WHERE p.rol='personal' ORDER BY p.id`)).rows;
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let d = 14; d >= 1; d--) {
    for (const p of ids) {
      const r = rnd();
      let estado = 'presente', minutos = Math.floor(rnd() * 8) - 5;
      if (r > 0.93) estado = 'ausente';
      else if (r > 0.88) estado = 'justificado';
      else if (r > 0.75) { estado = 'tardanza'; minutos = 12 + Math.floor(rnd() * 40); }
      await c.query(
        `INSERT INTO asistencias (personal_id, fecha, hora_entrada, hora_salida, estado, laboratorio_id, origen)
         SELECT $1::int, f, 
           CASE WHEN $3::text IN ('ausente','justificado') THEN NULL ELSE (f + $2::time + ($4::int * interval '1 minute')) END,
           CASE WHEN $3::text IN ('ausente','justificado') THEN NULL ELSE (f + $2::time + interval '9 hours' + ($4::int * interval '1 minute')) END,
           $3::text, $5::int, 'manual'
         FROM (SELECT (CURRENT_DATE - $6::int) AS f) x
         WHERE EXTRACT(isodow FROM f) < 6
         ON CONFLICT DO NOTHING`,
        [p.id, p.ap, estado, minutos, p.laboratorio_id, d]);
    }
  }
  // Usos históricos de dispositivos
  const dids = (await c.query('SELECT id FROM dispositivos WHERE estado <> $1 ORDER BY id', ['mantenimiento'])).rows;
  for (let d = 12; d >= 1; d--) {
    for (let k = 0; k < 3; k++) {
      const p = ids[Math.floor(rnd() * ids.length)];
      const dv = dids[Math.floor(rnd() * dids.length)];
      await c.query(
        `INSERT INTO usos_dispositivo (dispositivo_id, personal_id, inicio, fin, proposito)
         SELECT $1::int, $2::int, ts, ts + ($3::int * interval '1 minute'), $4::text
         FROM (SELECT (CURRENT_DATE - $5::int) + time '09:00' + ($6::int * interval '1 hour') AS ts) x
         WHERE EXTRACT(isodow FROM ts) < 6 AND NOT EXISTS
           (SELECT 1 FROM usos_dispositivo u WHERE u.dispositivo_id=$1 AND u.inicio = ts)`,
        [dv.id, p.id, 30 + Math.floor(rnd() * 150),
         ['Práctica de laboratorio','Pruebas de conectividad','Mantenimiento preventivo','Experimento de investigación','Calibración'][k % 5],
         d, k * 2]);
    }
  }
}

module.exports = { migrar };
