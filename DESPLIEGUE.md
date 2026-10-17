# Guía de despliegue: GitHub + Render (Blueprint, plan gratuito)

## 0. Requisitos
Cuenta de GitHub y cuenta de Render (https://render.com). No necesitas tarjeta para el plan *Free*.

## 1. Subir el proyecto a GitHub
```bash
cd labcontrol
git init
git add .
git commit -m "LabControl: control de asistencia y uso de dispositivos"
git branch -M main
# crea un repositorio vacío en GitHub (p. ej. labcontrol-asistencia) y luego:
git remote add origin https://github.com/TU_USUARIO/labcontrol-asistencia.git
git push -u origin main
```
> `.env` y `node_modules` están en `.gitignore`: no se suben.

## 2. Crear los servicios con el Blueprint
1. Render Dashboard → **New +** → **Blueprint**.
2. Conecta GitHub y elige el repositorio. Render lee `render.yaml` y propone:
   - **labcontrol-db** (PostgreSQL, plan *Free*)
   - **labcontrol-asistencia** (Web Service Node, plan *Free*)
3. Render pedirá los valores marcados `sync: false`:
   - `ADMIN_EMAIL`: correo del administrador (ej. `admin@labcontrol.edu`)
   - `ADMIN_PASSWORD`: contraseña del administrador (mín. 8 caracteres)
   - `DEMO_PASSWORD`: contraseña de las cuentas de demostración
4. **Apply**. El primer build tarda unos minutos.

`SESSION_SECRET` se genera solo y `DATABASE_URL` se enlaza automáticamente a la base de datos.
Las tablas y los datos de demostración se crean al arrancar (migración idempotente con *advisory lock*).

## 3. Verificar
- `https://TU-SERVICIO.onrender.com/health` → `{"status":"ok","db":"ok",...}`
- `https://TU-SERVICIO.onrender.com/` → inicia sesión con `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
- Abre la URL desde tu celular para demostrar el acceso multidispositivo.

## 4. Despliegue continuo
`autoDeploy: true`: cada `git push` a `main` redespliega automáticamente.

## 5. Limitaciones del plan gratuito (tenlas presentes)
| Tema | Detalle |
|---|---|
| Suspensión por inactividad | El Web Service *Free* se duerme tras ~15 min sin tráfico; la primera petición tarda ~30–60 s. Abre la URL unos minutos antes de una demo. |
| Base de datos *Free* | Expira a los 30 días (con aviso previo). Para conservar datos, exporta con `pg_dump` o cambia de plan. |
| Recursos | 512 MB de RAM y CPU compartida: suficiente para esta aplicación. |
| Datos de demo | Para producción real usa `SEED_DEMO=false`. |

## 6. Problemas frecuentes
- **No inicia sesión / cookie no persiste**: la app ya usa `trust proxy` y cookies `secure` en producción; accede siempre por `https://`.
- **`SESSION_SECRET` ausente**: en producción la app se detiene a propósito; el Blueprint ya lo genera.
- **Error de conexión a la BD**: revisa que `DATABASE_URL` provenga de `labcontrol-db`; el SSL se activa solo en producción (`DATABASE_SSL=false` para desactivarlo).
- **Gráficos vacíos**: los gráficos cargan Chart.js desde `cdn.jsdelivr.net`; verifica que la red no lo bloquee.
- **Cambiar zona horaria**: variable `APP_TZ` (por defecto `America/Guayaquil`).

## 7. Alternativa: crear los servicios a mano
1. New + → PostgreSQL (Free) → copia la *Internal Database URL*.
2. New + → Web Service → repositorio → Build `npm install`, Start `node server.js`, Health check `/health`.
3. Variables: `NODE_ENV=production`, `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `APP_TZ`, `SEED_DEMO`, `DEMO_PASSWORD`.

## Anexo: Azure (si tu docente exige Azure)
El mismo código funciona en **Azure App Service (Linux, Node 20)** + **Azure Database for PostgreSQL Flexible Server**:
```bash
az group create -n rg-labcontrol -l eastus
az postgres flexible-server create -g rg-labcontrol -n labcontrol-pg --admin-user lcadmin --admin-password '<ClaveSegura1!>' --sku-name Standard_B1ms --tier Burstable --public-access 0.0.0.0
az postgres flexible-server db create -g rg-labcontrol -s labcontrol-pg -d labcontrol
az webapp up -g rg-labcontrol -n labcontrol-<tu-id> --runtime "NODE:20-lts" --sku F1
az webapp config appsettings set -g rg-labcontrol -n labcontrol-<tu-id> --settings \
  NODE_ENV=production SESSION_SECRET='<aleatorio>' ADMIN_EMAIL=admin@labcontrol.edu ADMIN_PASSWORD='<clave>' SEED_DEMO=true \
  DATABASE_URL='postgres://lcadmin:<ClaveSegura1!>@labcontrol-pg.postgres.database.azure.com:5432/labcontrol?sslmode=require'
```
Azure exige SSL hacia PostgreSQL (la app lo activa en producción).
