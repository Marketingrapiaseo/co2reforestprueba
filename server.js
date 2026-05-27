// server.js - Con soporte para dirección y texto de placa
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
const WOMPI_INTEGRITY_SECRET = process.env.WOMPI_INTEGRITY_SECRET;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

if (!WOMPI_PUBLIC_KEY || !WOMPI_INTEGRITY_SECRET) {
    console.error("❌ ERROR CRÍTICO: Variables de Wompi no definidas en el entorno.");
    process.exit(1);
}
if (!GOOGLE_SCRIPT_URL) {
    console.warn("⚠️ GOOGLE_SCRIPT_URL no definida. Los datos NO se guardarán en Google Sheets.");
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
            connectSrc: ["'self'", "https://api-sandbox.wompi.co", "https://api.wompi.co", "https://script.google.com"],
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

async function sendToGoogleSheets(orderData) {
    if (!GOOGLE_SCRIPT_URL) return;
    try {
        const response = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orden: orderData })
        });
        const result = await response.json();
        console.log(`📤 Envío a Google Sheets: ${result.status}`);
        if (result.status !== 'success') {
            console.error('Respuesta de Google Sheets:', result);
        }
    } catch (error) {
        console.error("❌ Error enviando a Google Sheets:", error);
    }
}

// Ruta de pago
app.post('/api/create-payment', limiter, [
    body('a').optional().isInt({ min: 0, max: 2813 }).toInt(),
    body('b').optional().isInt({ min: 0, max: 3058 }).toInt(),
    body('c').optional().isInt({ min: 0, max: 1888 }).toInt(),
    body('placa').optional().isBoolean(),
    body('textoPlaca').optional().isString(),
    body('cliente.nombre').notEmpty(),
    body('cliente.cedula').notEmpty(),
    body('cliente.email').isEmail(),
    body('cliente.direccion').notEmpty(),
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const a = req.body.a || 0;
    const b = req.body.b || 0;
    const c = req.body.c || 0;
    const placa = !!req.body.placa;
    const textoPlaca = req.body.textoPlaca || '';
    const cliente = req.body.cliente;

    const total = calcularTotal(a, b, c, placa);
    if (total <= 0) return res.status(400).json({ error: 'El total debe ser mayor a cero' });

    const amountInCents = Math.round(total * 100);
    const reference = `CO2R-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const integrityPayload = `${reference}${amountInCents}${CURRENCY}${WOMPI_INTEGRITY_SECRET}`;
    const signature = crypto.createHash('sha256').update(integrityPayload, 'utf8').digest('hex');

    pendingOrders.set(reference, { a, b, c, placa, textoPlaca, cliente, total });
    console.log(`📝 Orden pendiente guardada con referencia: ${reference}`);

    res.json({
        publicKey: WOMPI_PUBLIC_KEY,
        currency: CURRENCY,
        amountInCents: amountInCents.toString(),
        reference,
        signature,
        redirectUrl: 'https://co2reforestprueba.onrender.com/gracias.html'
    });
});

// Webhook de Wompi
app.post('/api/wompi-webhook', async (req, res) => {
    res.status(200).send('OK');
    try {
        const event = req.body;
        if (event.event === 'transaction.updated' && event.data.transaction.status === 'APPROVED') {
            const ref = event.data.transaction.reference;
            const pend = pendingOrders.get(ref);
            if (pend) {
                const now = new Date();
                const orderToSend = {
                    fechaHora: now.toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
                    nombre: pend.cliente.nombre,
                    cedula: pend.cliente.cedula,
                    email: pend.cliente.email,
                    direccion: pend.cliente.direccion,
                    packA: pend.a,
                    packB: pend.b,
                    packC: pend.c,
                    textoPlaca: pend.textoPlaca || '',
                    total: pend.total
                };
                await sendToGoogleSheets(orderToSend);
                pendingOrders.delete(ref);
                console.log(`✅ Orden ${ref} registrada en Google Sheets`);
            } else {
                console.warn(`⚠️ No se encontraron datos locales para la referencia ${ref}`);
            }
        }
    } catch (error) {
        console.error("❌ Error procesando el webhook:", error);
    }
});

// Endpoint de prueba
app.get('/api/test-google', async (req, res) => {
    const testOrder = {
        fechaHora: new Date().toLocaleString('es-CO'),
        nombre: "Test Manual",
        cedula: "123456789",
        email: "test@test.com",
        direccion: "Calle Falsa 123",
        packA: 1,
        packB: 0,
        packC: 0,
        textoPlaca: "Placa de prueba",
        total: 180000
    };
    await sendToGoogleSheets(testOrder);
    res.json({ status: 'enviado' });
});

app.listen(PORT, () => {
    console.log(`✅ Servidor seguro corriendo en http://localhost:${PORT}`);
});