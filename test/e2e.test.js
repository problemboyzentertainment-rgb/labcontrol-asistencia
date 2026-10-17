'use strict';
// Prueba de integración extremo a extremo contra un servidor en ejecución.
//   BASE_URL=http://localhost:3000 ADMIN_EMAIL=... ADMIN_PASSWORD=... npm test
const test = require('node:test');
const assert = require('node:assert');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN = process.env.ADMIN_EMAIL || 'admin@labcontrol.edu';
const PASS = process.env.ADMIN_PASSWORD || 'Admin12345!';

async function disponible() { try { return (await fetch(BASE + '/health')).ok; } catch { return false; } }

function cliente() {
  let cookie = '';
  async function req(path, opts = {}) {
    const r = await fetch(BASE + path, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), cookie } });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
    return r;
  }
  const csrf = async (path) => (/name="_csrf" value="([^"]+)"/.exec(await (await req(path)).text()) || [])[1];
  const post = (path, data) => req(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data) });
  return { req, csrf, post };
}

test('flujo completo: login, marcación, uso de dispositivo, reportes', async (t) => {
  if (!(await disponible())) return t.skip('Servidor no disponible en ' + BASE);
  const c = cliente();

  await t.test('login inválido es rechazado', async () => {
    const tk = await c.csrf('/login');
    const r = await c.post('/login', { _csrf: tk, email: ADMIN, password: 'incorrecta' });
    assert.strictEqual(r.status, 401);
  });
  await t.test('POST sin CSRF es rechazado', async () => {
    const r = await c.post('/login', { email: ADMIN, password: PASS });
    assert.strictEqual(r.status, 403);
  });
  await t.test('login válido redirige', async () => {
    const tk = await c.csrf('/login');
    const r = await c.post('/login', { _csrf: tk, email: ADMIN, password: PASS });
    assert.strictEqual(r.status, 302);
  });
  await t.test('dashboard y listados responden 200', async () => {
    for (const p of ['/', '/marcar', '/personal', '/laboratorios', '/dispositivos', '/usos', '/asistencia', '/reportes', '/bitacora', '/kiosco', '/perfil']) {
      const r = await c.req(p); assert.strictEqual(r.status, 200, p);
    }
  });
  await t.test('regla: no se puede usar un dispositivo sin entrada; luego sí (usuario nuevo por corrida)', async () => {
    // El admin crea una persona nueva => la prueba es repetible
    const cod = 'TST-' + Date.now();
    let tk = await c.csrf('/personal/nuevo');
    let r = await c.post('/personal', { _csrf: tk, codigo: cod, nombres: 'Prueba', apellidos: 'Integración', email: cod.toLowerCase() + '@test.edu', password: 'Prueba12345', rol: 'personal', activo: 'on' });
    assert.strictEqual(r.status, 302);
    const u = cliente();
    tk = await u.csrf('/login');
    r = await u.post('/login', { _csrf: tk, email: cod.toLowerCase() + '@test.edu', password: 'Prueba12345' });
    assert.strictEqual(r.status, 302);
    assert.strictEqual((await u.req('/personal')).status, 403, 'el personal no accede a administración');

    const lista = await (await u.req('/dispositivos?estado=disponible')).text();
    const id = /\/dispositivos\/(\d+)\/usar/.exec(lista)[1];
    tk = await u.csrf('/dispositivos');
    await u.post(`/dispositivos/${id}/usar`, { _csrf: tk, proposito: 'prueba e2e' });
    assert.match(await (await u.req('/dispositivos')).text(), /Debes tener tu entrada registrada/);

    tk = await u.csrf('/marcar');
    await u.post('/marcar/entrada', { _csrf: tk });
    tk = await u.csrf('/marcar');
    await u.post('/marcar/entrada', { _csrf: tk });
    assert.match(await (await u.req('/marcar')).text(), /Ya registraste tu entrada hoy/);

    tk = await u.csrf('/dispositivos');
    await u.post(`/dispositivos/${id}/usar`, { _csrf: tk, proposito: 'prueba e2e' });
    assert.match(await (await u.req('/marcar')).text(), /prueba e2e/);

    // Exclusión mutua: el admin no puede tomar el mismo dispositivo
    tk = await c.csrf('/dispositivos');
    await c.post(`/dispositivos/${id}/usar`, { _csrf: tk, proposito: 'duplicado' });
    assert.match(await (await c.req('/dispositivos')).text(), /no está disponible|Debes tener tu entrada/);

    // La salida cierra automáticamente el uso y libera el dispositivo
    tk = await u.csrf('/marcar');
    await u.post('/marcar/salida', { _csrf: tk });
    const m = await (await u.req('/marcar')).text();
    assert.match(m, /No tienes dispositivos en uso/);
    const libre = await (await u.req('/dispositivos?estado=disponible')).text();
    assert.ok(libre.includes(`/dispositivos/${id}/usar`), 'el dispositivo volvió a estar disponible');
  });
  await t.test('CSV de asistencia', async () => {
    const r = await c.req('/reportes/asistencia.csv');
    assert.strictEqual(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/csv/);
  });
  await t.test('rutas protegidas sin sesión redirigen a /login', async () => {
    const r = await cliente().req('/personal');
    assert.strictEqual(r.status, 302); assert.strictEqual(r.headers.get('location'), '/login');
  });
});
