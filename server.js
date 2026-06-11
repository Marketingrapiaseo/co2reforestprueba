require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const pendingOrders = new Map();

const WOMPI_PUBLIC_KEY = process.env.WOMPI_PUBLIC_KEY;
const WOMPI_PRIVATE_KEY = process.env.WOMPI_PRIVATE_KEY;
const WOMPI_INTEGRITY_SECRET = process.env.WOMPI_INTEGRITY_SECRET;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

if (!WOMPI_PUBLIC_KEY || !WOMPI_INTEGRITY_SECRET) {
    console.error("❌ ERROR: Variables de Wompi no definidas.");
    process.exit(1);
}
if (!WOMPI_PRIVATE_KEY) {
    console.warn("⚠️ WOMPI_PRIVATE_KEY no definida. La verificación de transacciones podría fallar.");
}
if (!GOOGLE_SCRIPT_URL) {
    console.warn("⚠️ GOOGLE_SCRIPT_URL no definida.");
}

const CURRENCY = 'COP';
const PLACA_COST = 85000;

// Middlewares
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            styleSrcElem: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https://api.wompi.co", "https://script.google.com"],
            formAction: ["'self'", "https://checkout.wompi.co"],
        },
    },
}));

const allowedOrigins = [
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'https://co2reforest.com',
    'https://co2reforestprueba.onrender.com'
];
app.use(cors({ origin: allowedOrigins, optionsSuccessStatus: 200 }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });

function calcularTotal(a, b, c, placa) {
    const subtotal = a * 180000 + b * 186000 + c * 198000;
    const grupos = a + b + c;
    let porcentaje = 0;
    if (grupos >= 200) porcentaje = 20;
    else if (grupos >= 100) porcentaje = 10;
    else porcentaje = Math.min(Math.floor(grupos / 10), 20);
    const descuento = Math.round(subtotal * porcentaje / 100);
    let total = subtotal - descuento;
    if (placa) total += PLACA_COST;
    return total;
}

async function sendToGoogleSheets(orderData, isUpdate = false) {
    if (!GOOGLE_SCRIPT_URL) return;
    try {
        const response = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orden: orderData, update: isUpdate })
        });
        const result = await response.json();
        console.log(`📤 Envío a Google Sheets: ${result.status}`);
    } catch (error) {
        console.error("❌ Error enviando a Google Sheets:", error);
    }
}

// Endpoint para guardar solo datos personales (interés)
app.post('/api/save-client', [
    body('nombre').notEmpty(),
    body('cedula').notEmpty(),
    body('email').isEmail(),
    body('telefono').notEmpty(),
    body('ciudad').notEmpty(),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { nombre, cedula, email, telefono, ciudad } = req.body;
    const orderData = {
        fechaHora: new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
        nombre,
        cedula,
        email,
        telefono,
        ciudad,
        packA: 0,
        packB: 0,
        packC: 0,
        placa: false,
        textoPlaca: '',
        total: 0,
        estado: 'Solicitud',
        area: ''
    };
    await sendToGoogleSheets(orderData, false);
    res.json({ status: 'success' });
});

// Endpoint para crear pago
app.post('/api/create-payment', limiter, [
    body('a').optional().isInt({ min: 0, max: 2813 }).toInt(),
    body('b').optional().isInt({ min: 0, max: 3058 }).toInt(),
    body('c').optional().isInt({ min: 0, max: 1888 }).toInt(),
    body('placa').optional().isBoolean(),
    body('textoPlaca').optional().isString(),
    body('area').notEmpty().isString(),
    body('cliente.nombre').notEmpty(),
    body('cliente.cedula').notEmpty(),
    body('cliente.email').isEmail(),
    body('cliente.telefono').notEmpty(),
    body('cliente.ciudad').notEmpty(),
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const a = req.body.a || 0;
    const b = req.body.b || 0;
    const c = req.body.c || 0;
    const placa = !!req.body.placa;
    const textoPlaca = req.body.textoPlaca || '';
    const area = req.body.area;
    const cliente = req.body.cliente;

    const total = calcularTotal(a, b, c, placa);
    if (total <= 0) return res.status(400).json({ error: 'Total inválido' });

    const amountInCents = Math.round(total * 100);
    const reference = `CO2R-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const integrityPayload = `${reference}${amountInCents}${CURRENCY}${WOMPI_INTEGRITY_SECRET}`;
    const signature = crypto.createHash('sha256').update(integrityPayload, 'utf8').digest('hex');

    pendingOrders.set(reference, { a, b, c, placa, textoPlaca, cliente, total, area });
    console.log(`📝 Orden pendiente guardada con referencia: ${reference}, área: ${area}`);

    const baseUrl = process.env.BASE_URL || 'https://co2reforestprueba.onrender.com';
    const redirectUrl = `${baseUrl}/gracias.html`;

    res.json({
        publicKey: WOMPI_PUBLIC_KEY,
        currency: CURRENCY,
        amountInCents: amountInCents.toString(),
        reference,
        signature,
        redirectUrl
    });
});

// Endpoint para confirmar pago y actualizar Google Sheets
app.post('/api/confirm-payment', async (req, res) => {
    const { transactionId } = req.body;
    if (!transactionId) return res.status(400).json({ error: 'Falta transactionId' });

    try {
        const authToken = WOMPI_PRIVATE_KEY || WOMPI_PUBLIC_KEY;
        const wompiResponse = await fetch(`https://api.wompi.co/v1/transactions/${transactionId}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const wompiData = await wompiResponse.json();
        if (!wompiData.data || wompiData.data.status !== 'APPROVED') {
            return res.status(400).json({ error: 'Pago no aprobado o no encontrado' });
        }
        const transaction = wompiData.data;
        const reference = transaction.reference;
        const pending = pendingOrders.get(reference);
        if (!pending) return res.status(404).json({ error: 'Orden no encontrada' });

        const now = new Date();
        const orderToSend = {
            email: pending.cliente.email,
            fechaHora: now.toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
            packA: pending.a,
            packB: pending.b,
            packC: pending.c,
            placa: pending.placa,
            textoPlaca: pending.textoPlaca || '',
            total: pending.total,
            estado: 'Pagado',
            area: pending.area
        };
        await sendToGoogleSheets(orderToSend, true);
        pendingOrders.delete(reference);
        console.log(`✅ Orden ${reference} actualizada correctamente con área ${pending.area}`);
        res.json({ status: 'success' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error interno' });
    }
});

// Webhook
app.post('/api/wompi-webhook', async (req, res) => {
    res.status(200).send('OK');
    try {
        const event = req.body;
        if (event.event === 'transaction.updated' && event.data.transaction.status === 'APPROVED') {
            const transaction = event.data.transaction;
            const reference = transaction.reference;
            const pending = pendingOrders.get(reference);
            if (pending) {
                const now = new Date();
                const orderToSend = {
                    email: pending.cliente.email,
                    fechaHora: now.toLocaleString('es-CO'),
                    packA: pending.a,
                    packB: pending.b,
                    packC: pending.c,
                    placa: pending.placa,
                    textoPlaca: pending.textoPlaca || '',
                    total: pending.total,
                    estado: 'Pagado',
                    area: pending.area
                };
                await sendToGoogleSheets(orderToSend, true);
                pendingOrders.delete(reference);
                console.log(`✅ Webhook: Orden ${reference} actualizada con área ${pending.area}`);
            }
        }
    } catch (error) {
        console.error(error);
    }
});

app.listen(PORT, () => console.log(`✅ Servidor en puerto ${PORT}`));