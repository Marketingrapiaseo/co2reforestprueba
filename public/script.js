const ST = { a: 0, b: 0, c: 0 };
const MX = { a: 2813, b: 3058, c: 1888 };
const PR = { a: 180000, b: 186000, c: 198000 };
const CO = { a: 213, b: 243, c: 228 };
const PLACA = 85000;

function fmt(n) { return '$' + Math.round(n).toLocaleString('es-CO'); }
function fN(n) { return Math.round(n).toLocaleString('es-CO'); }

function setVal(pk, rawVal) {
    let v = parseInt(rawVal) || 0;
    v = Math.max(0, Math.min(MX[pk], v));
    ST[pk] = v;
    upd();
}

function ch(pk, d) {
    ST[pk] = Math.max(0, Math.min(MX[pk], ST[pk] + d));
    document.getElementById('i' + pk).value = ST[pk];
    upd();
}

function upd() {
    // Sincronizar inputs
    ['a', 'b', 'c'].forEach(pk => {
        const inp = document.getElementById('i' + pk);
        if (document.activeElement !== inp) inp.value = ST[pk] || '';
    });

    const tg = ST.a + ST.b + ST.c;
    const arb = tg * 5;
    const co2 = ST.a * CO.a + ST.b * CO.b + ST.c * CO.c;
    const sub = ST.a * PR.a + ST.b * PR.b + ST.c * PR.c;
    
    let dp = 0;
    if (tg >= 200) dp = 20;
    else if (tg >= 100) dp = 10;
    else dp = Math.min(Math.floor(tg / 10), 20);
    
    const dam = Math.round(sub * dp / 100);
    const conPlaca = document.getElementById('placa-chk')?.checked || false;
    const tot = (sub - dam) + (conPlaca ? PLACA : 0);
    const autos = (co2 / 4600).toFixed(1);

    document.getElementById('ca').textContent = fN(ST.a * CO.a) + ' kg';
    document.getElementById('cb_').textContent = fN(ST.b * CO.b) + ' kg';
    document.getElementById('cc').textContent = fN(ST.c * CO.c) + ' kg';

    document.getElementById('rg').textContent = fN(tg);
    document.getElementById('ra').textContent = fN(arb);
    document.getElementById('rc').textContent = fN(co2) + ' kg';
    document.getElementById('rc10').textContent = fN(co2 * 10) + ' kg';
    document.getElementById('rauto').textContent = autos + ' autos/año';
    document.getElementById('dpct').textContent = dp + '%';
    document.getElementById('rsub').textContent = fmt(sub);
    document.getElementById('rdisc').textContent = '-' + fmt(dam);
    document.getElementById('rtotal').textContent = fmt(tot);

    const rp = document.getElementById('rrow-placa');
    if (rp) rp.style.display = conPlaca ? 'flex' : 'none';
    
    const dsf = document.getElementById('dsf');
    if (dsf) dsf.style.width = Math.min(tg / 200 * 100, 100) + '%';

    const b = document.getElementById('dbadge');
    if (b) {
        if (dp >= 20) b.style.background = 'linear-gradient(135deg,#1A7A3A,#27ae60)';
        else if (dp >= 10) b.style.background = 'linear-gradient(135deg,#C8972B,#E8A020)';
        else b.style.background = 'linear-gradient(135deg,#2D5F8A,#3a7ab8)';
    }

    const pillsDiv = document.getElementById('pills');
    if (!tg) {
        pillsDiv.innerHTML = '<span class="pill">Ingresa grupos para ver tus beneficios</span>';
        return;
    }
    let bens = [
        fN(arb) + ' árboles nativos',
        fN(co2) + ' kg CO₂/año',
        'Certificado Ley 2173',
        'Registro REAA · Res.1491/2025',
        'Reporte GRI/ODS',
        'Monitoreo 2 años',
        'IVA exento'
    ];
    if (arb >= 50) bens.push('Fotos geolocalizadas');
    if (arb >= 100) bens.push('Reporte ESG completo');
    if (arb >= 250) bens.push('Video del predio');
    if (conPlaca) bens.push('🪧 Placa personalizada (+$85.000)');
    if (dp >= 10) bens.push('🎉 ' + dp + '% descuento activo');
    if (dp >= 20) bens.push('🏆 Descuento máximo 20%');
    const cls = (t) => t.startsWith('🪧') ? 'pill opt' : 'pill';
    pillsDiv.innerHTML = bens.map(t => `<span class="${cls(t)}">${t}</span>`).join('');
}

// Inicializar al cargar la página
document.addEventListener('DOMContentLoaded', () => {
    upd();
    // Asegurar que los inputs tengan listeners para cambios manuales
    document.getElementById('ia')?.addEventListener('input', (e) => setVal('a', e.target.value));
    document.getElementById('ib')?.addEventListener('input', (e) => setVal('b', e.target.value));
    document.getElementById('ic')?.addEventListener('input', (e) => setVal('c', e.target.value));
    document.getElementById('placa-chk')?.addEventListener('change', upd);
});

// Modal de especies (si existe)
const modal = document.getElementById('modal-especie');
const cerrarModal = document.querySelector('.modal-cerrar');
function abrirModal(especieElement) {
    if (!modal) return;
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
if (cerrarModal) {
    cerrarModal.addEventListener('click', () => { modal.style.display = 'none'; });
    window.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
}
document.querySelectorAll('.sp').forEach(tarjeta => {
    tarjeta.style.cursor = 'pointer';
    tarjeta.addEventListener('click', () => abrirModal(tarjeta));
});