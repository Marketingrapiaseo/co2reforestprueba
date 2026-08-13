document.addEventListener('DOMContentLoaded', function() {
  var modal = document.getElementById('modal-especie');
  var cerrarModal = document.querySelector('.modal-cerrar');

  if (modal && cerrarModal) {
    function abrirModal(el) {
      var nombre = el.querySelector('.sp-name') ? el.querySelector('.sp-name').innerText : '';
      var sci = el.querySelector('.sp-sci') ? el.querySelector('.sp-sci').innerText : '';
      var stats = el.querySelectorAll('.ss');
      var altura = '', co2 = '', precio = '', dato = '', funcion = '';
      stats.forEach(function(s) {
        var k = s.querySelector('.sk') ? s.querySelector('.sk').innerText : '';
        var v = s.querySelector('.sv') ? s.querySelector('.sv').innerText : '';
        if (k.indexOf('Altura') !== -1) altura = v;
        if (k.indexOf('CO2') !== -1 || k.indexOf('CO₂') !== -1) co2 = v;
        if (k.indexOf('Precio') !== -1) precio = v;
      });
      // Buscar dato curioso desde el elemento específico
      var curiosoEl = el.querySelector('.sp-curioso');
      if (curiosoEl) {
        dato = curiosoEl.textContent.replace('✦ Dato curioso:', '').trim();
      }
      var funcionEl = el.querySelector('.sp-funcion');
      if (funcionEl) {
        funcion = funcionEl.textContent.replace('🌱 Función:', '').trim();
      }
      var imgSrc = el.querySelector('.sp-img img') ? el.querySelector('.sp-img img').getAttribute('src') : '';
      document.getElementById('modal-nombre').innerText = nombre;
      document.getElementById('modal-sci').innerText = sci;
      document.getElementById('modal-altura').innerText = altura || '—';
      document.getElementById('modal-co2').innerText = co2 || '—';
      document.getElementById('modal-precio').innerText = precio || '—';
      document.getElementById('modal-dato').innerText = dato || '';
      document.getElementById('modal-img').setAttribute('src', imgSrc);
      var cEl = document.getElementById('modal-curioso');
      if (cEl) cEl.style.display = dato ? 'block' : 'none';
      var fEl = document.getElementById('modal-funcion');
      if (fEl) { fEl.innerText = funcion || ''; fEl.parentElement.style.display = funcion ? 'block' : 'none'; }
      modal.style.display = 'flex';
    }
    cerrarModal.addEventListener('click', function() { modal.style.display = 'none'; });
    window.addEventListener('click', function(e) { if (e.target === modal) modal.style.display = 'none'; });
    window.addEventListener('keydown', function(e) { if (e.key === 'Escape' && modal.style.display === 'flex') modal.style.display = 'none'; });
    document.querySelectorAll('.sp').forEach(function(t) { t.style.cursor = 'pointer'; t.addEventListener('click', function() { abrirModal(t); }); });
  }

  /* Contadores hero */
  function animateCounters() {
    document.querySelectorAll('.kpi-n[data-target]').forEach(function(el) {
      if (el.dataset.animated === 'true') return;
      var target = parseFloat(el.dataset.target);
      var suffix = el.dataset.suffix || '';
      var start = performance.now();
      function update(now) {
        var p = Math.min((now - start) / 2000, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * eased).toLocaleString('es-CO') + suffix;
        if (p < 1) requestAnimationFrame(update);
        else { el.textContent = target.toLocaleString('es-CO') + suffix; el.dataset.animated = 'true'; }
      }
      requestAnimationFrame(update);
    });
  }
  var hk = document.querySelector('.hero-kpis');
  if (hk && 'IntersectionObserver' in window) { var o = new IntersectionObserver(function(e) { e.forEach(function(x) { if (x.isIntersecting) { animateCounters(); o.unobserve(x.target); } }); }, {threshold:.3}); o.observe(hk); } else { animateCounters(); }

  /* FAQ toggle - CORREGIDO */
  document.querySelectorAll('.faq-q').forEach(function(q) {
    q.addEventListener('click', function() {
      var item = q.closest('.faq-item');
      var wasOpen = item.classList.contains('open');
      // Cerrar todos los demás
      document.querySelectorAll('.faq-item.open').forEach(function(i) {
        if (i !== item) i.classList.remove('open');
      });
      // Alternar el actual
      if (wasOpen) {
        item.classList.remove('open');
      } else {
        item.classList.add('open');
      }
    });
  });

  /* Empleado options */
  document.querySelectorAll('.emp-opt').forEach(function(opt) {
    opt.addEventListener('click', function() {
      document.querySelectorAll('.emp-opt').forEach(function(o) { o.classList.remove('active'); });
      opt.classList.add('active');
      var n = parseInt(opt.dataset.emp || '0');
      var inp = document.getElementById('calc-empleados');
      if (inp && n > 0) { inp.value = n; updateCalc(); }
    });
  });

  /* Input de empleados */
  var empInput = document.getElementById('calc-empleados');
  if (empInput) {
    empInput.addEventListener('input', function() {
      document.querySelectorAll('.emp-opt').forEach(function(o) { o.classList.remove('active'); });
      updateCalc();
    });
  }

  /* Smooth scroll */
  document.querySelectorAll('a[href^="#"]').forEach(function(l) {
    l.addEventListener('click', function(e) {
      var t = document.querySelector(l.getAttribute('href'));
      if (t) { e.preventDefault(); t.scrollIntoView({behavior:'smooth',block:'start'}); }
    });
  });

  /* Inicializar calculadora */
  updateCalc();
});

/* ===== CALCULADORA - CORREGIDA ===== */
function changeCnt(btn, delta) {
  var input = btn.parentElement.querySelector('.cnt-input');
  var v = Math.max(0, parseInt(input.value || '0') + delta);
  input.value = v;
  updateCalc();
}

function updateCalc() {
  var trees = 0, co2 = 0, total = 0;
  document.querySelectorAll('.cnt-input').forEach(function(inp) {
    var n = parseInt(inp.value || '0');
    var p = parseInt(inp.dataset.price || '0');
    var c = parseInt(inp.dataset.co2 || '0');
    trees += n;
    total += n * p;
    co2 += n * c;
    var row = inp.closest('.cr');
    if (row) {
      var co2El = row.querySelector('.cr-co2');
      if (co2El) co2El.textContent = (n * c) + ' kg CO₂/año';
    }
  });
  var te = document.getElementById('r-trees');
  if (te) te.textContent = trees;
  var ce = document.getElementById('r-co2');
  if (ce) ce.textContent = co2.toLocaleString('es-CO') + ' kg';
  var tl = document.getElementById('r-total');
  if (tl) tl.textContent = '$' + total.toLocaleString('es-CO');
  var av = document.getElementById('r-avg');
  if (av) av.textContent = trees > 0 ? '$' + Math.round(total / trees).toLocaleString('es-CO') : '$0';
  var gr = document.getElementById('r-groups');
  if (gr) gr.textContent = trees > 0 ? Math.ceil(trees / 50) : '0';
}

/* Asegurar que los inputs de la calculadora escuchen cambios */
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.cnt-input').forEach(function(i) {
    i.addEventListener('input', updateCalc);
    i.addEventListener('change', updateCalc);
  });
});