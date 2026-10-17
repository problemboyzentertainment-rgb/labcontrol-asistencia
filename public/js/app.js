(function () {
  'use strict';
  // Menú móvil
  var side = document.getElementById('side'), burger = document.getElementById('burger');
  if (burger && side) {
    burger.addEventListener('click', function (e) { e.stopPropagation(); side.classList.toggle('abierto'); });
    document.addEventListener('click', function (e) { if (!side.contains(e.target)) side.classList.remove('abierto'); });
  }
  // Confirmaciones declarativas (CSP no permite onclick inline)
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-confirm]');
    if (b && !window.confirm(b.getAttribute('data-confirm'))) e.preventDefault();
  });
  // Reloj en la zona horaria institucional (solo visual)
  document.querySelectorAll('[data-reloj]').forEach(function (el) {
    var tz = el.getAttribute('data-tz'), seg = el.hasAttribute('data-seg');
    function t() {
      var o = { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' };
      if (seg) o.second = '2-digit';
      var f = new Date().toLocaleDateString('es-EC', { timeZone: tz, weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
      el.textContent = (seg ? '' : f + ' · ') + new Date().toLocaleTimeString('es-EC', o);
    }
    t(); setInterval(t, 1000);
  });
  // Gráficos del dashboard
  if (window.Chart) {
    var a = document.getElementById('grafico-asistencia');
    if (a) {
      var s = JSON.parse(a.getAttribute('data-serie'));
      new Chart(a, { type: 'bar', data: { labels: s.map(function (x) { return x.fecha.slice(5); }), datasets: [
        { label: 'Presentes', data: s.map(function (x) { return x.presentes; }), backgroundColor: '#16a34a' },
        { label: 'Tardanzas', data: s.map(function (x) { return x.tardanzas; }), backgroundColor: '#d97706' },
        { label: 'Ausentes/justif.', data: s.map(function (x) { return x.ausentes; }), backgroundColor: '#dc2626' }] },
        options: { responsive: true, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } } } });
    }
    var d = document.getElementById('grafico-disp');
    if (d) {
      var e = JSON.parse(d.getAttribute('data-estados')), col = { disponible: '#16a34a', en_uso: '#2563eb', mantenimiento: '#d97706', baja: '#dc2626' };
      new Chart(d, { type: 'doughnut', data: { labels: e.map(function (x) { return x.estado.replace('_', ' '); }),
        datasets: [{ data: e.map(function (x) { return x.n; }), backgroundColor: e.map(function (x) { return col[x.estado]; }) }] } });
    }
  }
})();
