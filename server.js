// server.js - VERSIÓN CORREGIDA Y SEGURA
require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const app = express();
const PORT = process.env.PORT || 3000;

// ========== VALIDAR VARIABLES DE ENTORNO ==========
const WOMPI_PUBLIC_KEY = process.env.WOMPI_PUBLIC_KEY;
const WOMPI_INTEGRITY_SECRET = process.env.WOMPI_INTEGRITY_SECRET;

if (!WOMPI_PUBLIC_KEY || !WOMPI_INTEGRITY_SECRET) {
    console.error("❌ ERROR CRÍTICO: Variables WOMPI_PUBLIC_KEY y WOMPI_INTEGRITY_SECRET no definidas en .env");
    process.exit(1);
}

const CURRENCY = 'COP';
const PLACA_COST = 85000;

// ========== MIDDLEWARES ==========
// Helmet para cabeceras seguras
app.use(helmet());

// CORS configurado correctamente
const allowedOrigins = [
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'https://co2reforest.com'
];

const corsOptions = {
    origin: function (origin, callback) {
        // Permitir solicitudes sin origen (como Postman) solo en desarrollo
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        } else {
            console.warn(`CORS bloqueado para origen: ${origin}`);
            return callback(new Error('CORS no permitido desde este origen'), false);
        }
    },
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json(public));

// Rate limiting: máximo 100 peticiones por IP cada 15 minutos
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Demasiadas peticiones. Intenta de nuevo en 15 minutos.' }
});

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

// ========== RUTA DE PAGO ==========
app.post('/api/create-payment', limiter, [
    body('a').optional().isInt({ min: 0, max: 2813 }).toInt(),
    body('b').optional().isInt({ min: 0, max: 3058 }).toInt(),
    body('c').optional().isInt({ min: 0, max: 1888 }).toInt(),
    body('placa').optional().isBoolean(),
    body('cliente.nombre').optional().isString().isLength({ max: 100 }),
    body('cliente.email').optional().isEmail().normalizeEmail(),
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const a = req.body.a || 0;
    const b = req.body.b || 0;
    const c = req.body.c || 0;
    const placa = !!req.body.placa;
    const cliente = req.body.cliente || { nombre: '', email: '' };

    const total = calcularTotal(a, b, c, placa);
    if (total <= 0) {
        return res.status(400).json({ error: 'El total debe ser mayor a cero' });
    }

    const amountInCents = Math.round(total * 100);
    const reference = `CO2R-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const integrityPayload = `${reference}${amountInCents}${CURRENCY}${WOMPI_INTEGRITY_SECRET}`;
    const signature = crypto.createHash('sha256').update(integrityPayload, 'utf8').digest('hex');

    console.log(`📧 Nueva orden: ${cliente.email} | Ref: ${reference} | Total: ${total} COP`);

    res.json({
        publicKey: WOMPI_PUBLIC_KEY,
        currency: CURRENCY,
        amountInCents: amountInCents.toString(),
        reference,
        signature,
        redirectUrl: 'hthttps://forest.infinityfreeapp.com/gracias.html'
    });
});

// Manejador de errores global
app.use((err, req, res, next) => {
    console.error('❌ Error interno:', err);
    res.status(500).json({ error: 'Error interno del servidor. Intenta de nuevo más tarde.' });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`✅ Servidor seguro corriendo en http://localhost:${PORT}`);