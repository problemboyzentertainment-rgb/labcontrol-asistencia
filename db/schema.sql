-- =====================================================================
-- LabControl · Esquema relacional (PostgreSQL). Idempotente.
-- =====================================================================

CREATE TABLE IF NOT EXISTS laboratorios (
  id             SERIAL PRIMARY KEY,
  nombre         VARCHAR(120) NOT NULL UNIQUE,
  ubicacion      VARCHAR(160),
  aforo          INTEGER NOT NULL DEFAULT 10 CHECK (aforo > 0),
  hora_apertura  TIME NOT NULL DEFAULT '08:00',
  hora_cierre    TIME NOT NULL DEFAULT '17:00',
  tolerancia_min INTEGER NOT NULL DEFAULT 10 CHECK (tolerancia_min >= 0),
  activo         BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Personal tecnológico (cada registro es a la vez persona y cuenta de acceso)
CREATE TABLE IF NOT EXISTS personal (
  id             SERIAL PRIMARY KEY,
  codigo         VARCHAR(30)  NOT NULL UNIQUE,
  nombres        VARCHAR(100) NOT NULL,
  apellidos      VARCHAR(100) NOT NULL,
  email          VARCHAR(160) NOT NULL UNIQUE,
  cargo          VARCHAR(100) NOT NULL DEFAULT 'Técnico de laboratorio',
  laboratorio_id INTEGER REFERENCES laboratorios(id) ON DELETE SET NULL,
  password_hash  TEXT NOT NULL,
  rol            VARCHAR(10) NOT NULL DEFAULT 'personal' CHECK (rol IN ('admin','personal')),
  activo         BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_personal_lab ON personal(laboratorio_id);

CREATE TABLE IF NOT EXISTS asistencias (
  id             BIGSERIAL PRIMARY KEY,
  personal_id    INTEGER NOT NULL REFERENCES personal(id) ON DELETE CASCADE,
  fecha          DATE NOT NULL DEFAULT CURRENT_DATE,
  hora_entrada   TIMESTAMPTZ,
  hora_salida    TIMESTAMPTZ,
  estado         VARCHAR(12) NOT NULL CHECK (estado IN ('presente','tardanza','ausente','justificado')),
  laboratorio_id INTEGER REFERENCES laboratorios(id) ON DELETE SET NULL,
  observacion    VARCHAR(255),
  origen         VARCHAR(12) NOT NULL DEFAULT 'marcacion' CHECK (origen IN ('marcacion','kiosco','manual')),
  ip             VARCHAR(64),
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Invariante: una sola fila por persona y día
  CONSTRAINT uq_asistencia_persona_dia UNIQUE (personal_id, fecha),
  CONSTRAINT ck_salida_posterior CHECK (hora_salida IS NULL OR hora_entrada IS NULL OR hora_salida >= hora_entrada)
);
CREATE INDEX IF NOT EXISTS idx_asistencias_fecha ON asistencias(fecha);

CREATE TABLE IF NOT EXISTS dispositivos (
  id             SERIAL PRIMARY KEY,
  codigo         VARCHAR(40)  NOT NULL UNIQUE,
  nombre         VARCHAR(140) NOT NULL,
  tipo           VARCHAR(60)  NOT NULL,
  marca          VARCHAR(80),
  modelo         VARCHAR(80),
  serie          VARCHAR(80),
  laboratorio_id INTEGER REFERENCES laboratorios(id) ON DELETE SET NULL,
  estado         VARCHAR(15) NOT NULL DEFAULT 'disponible'
                 CHECK (estado IN ('disponible','en_uso','mantenimiento','baja')),
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dispositivos_lab ON dispositivos(laboratorio_id);

CREATE TABLE IF NOT EXISTS usos_dispositivo (
  id             BIGSERIAL PRIMARY KEY,
  dispositivo_id INTEGER NOT NULL REFERENCES dispositivos(id) ON DELETE CASCADE,
  personal_id    INTEGER NOT NULL REFERENCES personal(id) ON DELETE CASCADE,
  inicio         TIMESTAMPTZ NOT NULL DEFAULT now(),
  fin            TIMESTAMPTZ,
  proposito      VARCHAR(255) NOT NULL,
  observacion    VARCHAR(255),
  CONSTRAINT ck_fin_posterior CHECK (fin IS NULL OR fin >= inicio)
);
-- Invariante de exclusión mutua: un dispositivo solo puede tener UN uso abierto.
-- Protege contra condiciones de carrera entre varias instancias del servicio.
CREATE UNIQUE INDEX IF NOT EXISTS uq_uso_abierto_por_dispositivo
  ON usos_dispositivo(dispositivo_id) WHERE fin IS NULL;
CREATE INDEX IF NOT EXISTS idx_usos_personal ON usos_dispositivo(personal_id, inicio DESC);
CREATE INDEX IF NOT EXISTS idx_usos_inicio ON usos_dispositivo(inicio DESC);

-- Bitácora de auditoría (quién hizo qué, cuándo y desde dónde)
CREATE TABLE IF NOT EXISTS bitacora (
  id          BIGSERIAL PRIMARY KEY,
  personal_id INTEGER REFERENCES personal(id) ON DELETE SET NULL,
  accion      VARCHAR(40) NOT NULL,
  entidad     VARCHAR(40),
  entidad_id  VARCHAR(40),
  detalle     JSONB,
  ip          VARCHAR(64),
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bitacora_fecha ON bitacora(creado_en DESC);

-- Sesiones (connect-pg-simple): servicio sin estado local => escalable horizontalmente
CREATE TABLE IF NOT EXISTS "session" (
  sid    VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  sess   JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_expire ON "session"(expire);
