document.addEventListener('DOMContentLoaded', function() {
  var modal = document.getElementById('modal-especie');
  var cerrarModal = document.querySelector('.modal-cerrar');

  if (!modal || !cerrarModal) {
    console.error('Modal no encontrado.');
    return;
  }

  function abrirModal(especieElement) {
6    var nombre = especieElement.querySelector('.sp-name') ? especieElement.querySelector('.sp-name').innerText : '';
    var sci = especieElement.querySelector('.sp-sci') ? especieElement.querySelector('.sp-sci').innerText : '';
    var stats = especieElement.querySelectorAll('.ss');
    var altura = '', co2 = '', precio = '', dato = '';
    stats.forEach(function(stat) {
      var label = stat.querySelector('.sk') ? stat.querySelector('.sk').innerText : '';
      var value = stat.querySelector('.sv') ? stat.querySelector('.sv').innerText : '';
      if (label.indexOf('Altura') !== -1) altura = value;
      if (label.indexOf('CO2') !== -1 || label.indexOf('CO₂') !== -1) co2 = value;
      if (label.indexOf('Precio') !== -1) precio = value;
      if (label.indexOf('Dato') !== -1 || label.indexOf('Curioso') !== -1) dato = value;
    });
    var imgSrc = especieElement.querySelector('.sp-img img') ? especieElement.querySelector('.sp-img img').getAttribute('src') : '';

    document.getElementById('modal-nombre').innerText = nombre;
    document.getElementById('modal-sci').innerText = sci;
    document.getElementById('modal-altura').innerText = altura;
    document.getElementById('modal-co2').innerText = co2;
    document.getElementById('modal-precio').innerText = precio;
    document.getElementById('modal-dato').innerText = dato;
    document.getElementById('modal-img').setAttribute('src', imgSrc);

    var curiosoEl = document.getElementById('modal-curioso');
    if (curiosoEl) curiosoEl.style.display = dato ? 'block' : 'none';

    modal.style.display = 'flex';
  }

  cerrarModal.addEventListener('click', function() {
    modal.style.display = 'none';
  });

  window.addEventListener('click', function(e) {
    if (e.target === modal) modal.style.display = 'none';
  });

  window.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && modal.style.display === 'flex') modal.style.display = 'none';
  });

  document.querySelectorAll('.sp').forEach(function(tarjeta) {
    tarjeta.style.cursor = 'pointer';
    tarjeta.addEventListener('click', function() { abrirModal(tarjeta); });
  });

  /* Animar contadores hero */
  function animateCounters() {
    document.querySelectorAll('.kpi-n[data-target]').forEach(function(el) {
      if (el.dataset.animated === 'true') return;
      var target = parseFloat(el.dataset.target);
      var suffix = el.dataset.suffix || '';
      var duration = 2000;
      var start = performance.now();
      function update(now) {
        var progress = Math.min((now - start) / duration, 1);
        var eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(target * eased).toLocaleString('es-CO') + suffix;
        if (progress < 1) requestAnimationFrame(update);
        else { el.textContent = target.toLocaleString('es-CO') + suffix; el.dataset.animated = 'true'; }
      }
      requestAnimationFrame(update);
    });
  }
  var heroKpis = document.querySelector('.hero-kpis');
  if (heroKpis && 'IntersectionObserver' in window) {
    var obs = new IntersectionObserver(function(entries) {
      entries.forEach(function(e) { if (e.isIntersecting) { animateCounters(); obs.unobserve(e.target); } });
    }, { threshold: 0.3 });
    obs.observe(heroKpis);
  } else { animateCounters(); }

  /* Smooth scroll */
  document.querySelectorAll('a[href^="#"]').forEach(function(link) {
    link.addEventListener('click', function(e) {
      var target = document.querySelector(link.getAttribute('href'));
      if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
  });
});