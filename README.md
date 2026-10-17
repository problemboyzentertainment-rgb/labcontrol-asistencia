# LabControl · Control de asistencia del personal tecnológico y uso de dispositivos de laboratorio

Aplicación web en la nube (Node.js + Express + PostgreSQL) para **registrar la asistencia del personal tecnológico**
y **trazar el uso de dispositivos de laboratorio** (servidores, equipos de red, instrumentación, kits IoT, estaciones GPU).
Trabajo N.º 3 · *Sistemas Distribuidos y Cloud Computing*.

**Idea central:** un dispositivo solo puede usarse si la persona tiene su asistencia vigente (entrada marcada y salida pendiente),
y un dispositivo solo puede tener **un** uso abierto a la vez (garantizado por un índice único parcial en PostgreSQL).
Esto vincula la asistencia con la trazabilidad de activos de forma consistente aun con varias instancias del servicio.

## Funcionalidades
| Módulo | Descripción |
|---|---|
| Autenticación | Login con bcrypt, sesiones en PostgreSQL, CSRF, rate limiting, roles `admin` / `personal` |
| Marcación | Entrada/salida con hora **del servidor**; estado automático *presente* / *tardanza* según el horario y tolerancia del laboratorio |
| Modo kiosco | Equipo compartido del laboratorio: la persona se identifica con código + contraseña |
| Dispositivos | CRUD de inventario, estados (disponible, en uso, mantenimiento, baja), tomar y devolver con propósito |
| Reglas | Sin entrada no hay uso de dispositivos; máx. N usos simultáneos; la salida cierra usos abiertos |
| Asistencia diaria | Consulta y registro manual masivo (presente, tardanza, ausente, justificado) |
| Dashboard | KPIs, gráfico de 7 días, quién está en el laboratorio, dispositivos en uso |
| Reportes | % de asistencia sobre días laborables, horas trabajadas, utilización de dispositivos, exportación **CSV** |
| Bitácora | Auditoría de acciones (quién, qué, cuándo, IP) |
| Responsive | Usable desde PC, tablet y celular |

## Stack
Node.js 20 · Express 4 · EJS · PostgreSQL (`pg`) · `express-session` + `connect-pg-simple` · `bcryptjs` · `helmet` · `express-rate-limit` · Chart.js (CDN).

## Ejecución local
```bash
npm install
cp .env.example .env        # ajusta DATABASE_URL
npm start                   # http://localhost:3000
npm test                    # unitarias (+ e2e si el servidor está en BASE_URL)
```
Con PostgreSQL local: `createdb labcontrol`. Las tablas y los datos de demostración se crean solos al arrancar.

**Credenciales por defecto** (cámbialas con variables de entorno):
- Administrador: `admin@labcontrol.edu` / `Admin12345!`
- Personal de demo: `carlos.mendoza@labcontrol.edu` / `Demo12345!` (también `lucia.paredes@…`, `andres.vera@…`, etc.; códigos `TEC-001`…`TEC-008`)

## Pruebas
- `test/util.test.js`: unitarias (CSV seguro, formatos, validadores, paginación).
- `test/e2e.test.js`: flujo extremo a extremo (login, CSRF, roles, regla asistencia→uso, exclusión mutua, cierre automático por salida, CSV).
  `BASE_URL=http://localhost:3000 npm test` (consume 3 logins; el limitador permite 15 por 15 min por IP).

## Despliegue
Ver **[DESPLIEGUE.md](DESPLIEGUE.md)** (GitHub + Render Blueprint, plan gratuito) y **[docs/ARQUITECTURA.md](docs/ARQUITECTURA.md)** (diseño, consistencia, seguridad, límites).

## Estructura
```
server.js            arranque, middlewares, rutas
render.yaml          Blueprint de Render (web + PostgreSQL, plan free)
db/                  schema.sql · bootstrap.js (migración + semilla) · pool.js
lib/                 servicios.js (reglas transaccionales) · util.js
middleware/auth.js   autenticación, CSRF, flash
routes/              auth · panel · personal · laboratorios · dispositivos · usos · asistencia · reportes · bitacora
views/               plantillas EJS
public/              CSS y JS del cliente
test/                pruebas
docs/                arquitectura
```
