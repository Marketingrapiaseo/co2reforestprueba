// script.js - Modal de especies (completo y funcional)
document.addEventListener('DOMContentLoaded', function() {
  const modal = document.getElementById('modal-especie');
  const cerrarModal = document.querySelector('.modal-cerrar');

  if (!modal || !cerrarModal) {
    console.error('Modal no encontrado.');
    return;
  }

  function abrirModal(especieElement) {
    const nombre = especieElement.querySelector('.sp-name')?.innerText || '';
    const sci = especieElement.querySelector('.sp-sci')?.innerText || '';
    const stats = especieElement.querySelectorAll('.ss');
    let altura = '', co2 = '', precio = '', dato = '';
    stats.forEach(stat => {
      const label = stat.querySelector('.sk')?.innerText || '';
      const value = stat.querySelector('.sv')?.innerText || '';
      if (label.includes('Altura')) altura = value;
      if (label.includes('CO₂')) co2 = value;
      if (label.includes('Precio')) precio = value;
      if (label.includes('Dato')) dato = value;
    });
    const imgSrc = especieElement.querySelector('.sp-img img')?.getAttribute('src') || '';

    document.getElementById('modal-nombre').innerText = nombre;
    document.getElementById('modal-sci').innerText = sci;
    document.getElementById('modal-altura').innerText = altura;
    document.getElementById('modal-co2').innerText = co2;
    document.getElementById('modal-precio').innerText = precio;
    document.getElementById('modal-dato').innerText = dato;
    document.getElementById('modal-img').setAttribute('src', imgSrc);

    modal.style.display = 'flex';
  }

  cerrarModal.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  window.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });

  document.querySelectorAll('.sp').forEach(tarjeta => {
    tarjeta.style.cursor = 'pointer';
    tarjeta.addEventListener('click', () => abrirModal(tarjeta));
  });
});