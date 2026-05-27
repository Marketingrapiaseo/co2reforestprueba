// server.js - Versión completa con Google Sheets y CSP corregido (permite conexión a script.google.com)
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

// ========== ALMACENAMIENTO TEMPORAL DE ÓRDENES ==========
const pendingOrders = new Map();

// ========== VALIDAR VARIABLES DE ENTORNO ==========
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

// ========== MIDDLEWARES DE SEGURIDAD (CSP CORREGIDO) ==========
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
            connectSrc: ["'self'", "https://api-sandbox.wompi.co", "https://api.wompi.co", "https://script.google.com"], // <-- AGREGADO
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

// ========== FUNCIÓN DE CÁLCULO ==========
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

// ========== ENVÍO A GOOGLE SHEETS ==========
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

// ========== RUTA DE PAGO ==========
app.post('/api/create-payment', limiter, [
    body('a').optional().isInt({ min: 0, max: 2813 }).toInt(),
    body('b').optional().isInt({ min: 0, max: 3058 }).toInt(),
    body('c').optional().isInt({ min: 0, max: 1888 }).toInt(),
    body('placa').optional().isBoolean(),
    body('cliente.nombre').optional().isString().isLength({ max: 100 }),
    body('cliente.email').optional().isEmail().normalizeEmail(),
    body('cliente.cedula').optional().isString().isLength({ max: 20 })
], (req, res) => {
    console.log("📥 POST /api/create-payment recibida");
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const a = req.body.a || 0;
    const b = req.body.b || 0;
    const c = req.body.c || 0;
    const placa = !!req.body.placa;
    const cliente = req.body.cliente || { nombre: '', email: '', cedula: '' };

    const total = calcularTotal(a, b, c, placa);
    if (total <= 0) {
        return res.status(400).json({ error: 'El total debe ser mayor a cero' });
    }

    const amountInCents = Math.round(total * 100);
    const reference = `CO2R-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const integrityPayload = `${reference}${amountInCents}${CURRENCY}${WOMPI_INTEGRITY_SECRET}`;
    const signature = crypto.createHash('sha256').update(integrityPayload, 'utf8').digest('hex');

    // Guardar orden pendiente
    const orderData = {
        a, b, c, placa,
        cliente: { nombre: cliente.nombre, email: cliente.email, cedula: cliente.cedula },
        total,
        referencia: reference,
        fecha_creacion: new Date().toISOString()
    };
    pendingOrders.set(reference, orderData);
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

// ========== WEBHOOK DE WOMPI ==========
app.post('/api/wompi-webhook', async (req, res) => {
    res.status(200).send('OK');
    try {
        const event = req.body;
        console.log("📩 Webhook recibido:", event.event);
        if (event.event === 'transaction.updated' && event.data.transaction.status === 'APPROVED') {
            const transaction = event.data.transaction;
            const transactionReference = transaction.reference;
            console.log(`💰 Pago exitoso confirmado para la referencia: ${transactionReference}`);

            const pendingOrder = pendingOrders.get(transactionReference);
            if (pendingOrder) {
                const now = new Date();
                const orderToSend = {
                    fechaHora: now.toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
                    nombre: pendingOrder.cliente.nombre,
                    cedula: pendingOrder.cliente.cedula || 'No especificada',
                    email: pendingOrder.cliente.email,
                    paqueteA: pendingOrder.a,
                    paqueteB: pendingOrder.b,
                    paqueteC: pendingOrder.c,
                    placa: pendingOrder.placa ? 'Sí' : 'No',
                    total: pendingOrder.total,
                    referencia: transactionReference
                };
                await sendToGoogleSheets(orderToSend);
                pendingOrders.delete(transactionReference);
                console.log(`✅ Orden ${transactionReference} registrada en Google Sheets`);
            } else {
                console.warn(`⚠️ No se encontraron datos locales para la referencia ${transactionReference}.`);
            }
        } else {
            console.log(`ℹ️ Evento ignorado: ${event.event} con estado ${event.data.transaction?.status}`);
        }
    } catch (error) {
        console.error("❌ Error procesando el webhook:", error);
    }
});

// ========== ENDPOINT DE PRUEBA PARA GOOGLE SHEETS ==========
app.get('/api/test-google', async (req, res) => {
    const testOrder = {
        fechaHora: new Date().toLocaleString('es-CO'),
        nombre: "Test Manual",
        cedula: "123456789",
        email: "test@test.com",
        paqueteA: 1,
        paqueteB: 0,
        paqueteC: 0,
        placa: "No",
        total: 180000,
        referencia: "TEST-001"
    };
    await sendToGoogleSheets(testOrder);
    res.json({ status: 'enviado' });
});

// ========== MANEJADOR DE ERRORES GLOBAL ==========
app.use((err, req, res, next) => {
    console.error('❌ Error interno:', err);
    res.status(500).json({ error: 'Error interno del servidor. Intenta de nuevo más tarde.' });
});

// ========== INICIAR SERVIDOR ==========
app.listen(PORT, () => {
    console.log(`✅ Servidor seguro corriendo en http://localhost:${PORT}`);
});