require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// 🔧 Solución para el error X-Forwarded-For en Render
app.set('trust proxy', 1);

const WOMPI_PUBLIC_KEY = process.env.WOMPI_PUBLIC_KEY;
const WOMPI_PRIVATE_KEY = process.env.WOMPI_PRIVATE_KEY;
const WOMPI_INTEGRITY_SECRET = process.env.WOMPI_INTEGRITY_SECRET;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

if (!WOMPI_PUBLIC_KEY || !WOMPI_INTEGRITY_SECRET) {
    console.error("❌ ERROR: Variables de Wompi no definidas.");
    process.exit(1);
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

// Guardar pedido en archivo JSON local (siempre funciona)
function saveToLocalJSON(orderData) {
    const filePath = path.join(__dirname, 'pedidos.json');
    let pedidos = [];
    if (fs.existsSync(filePath)) {
        try {
            const data = fs.readFileSync(filePath, 'utf8');
            pedidos = JSON.parse(data);
        } catch(e) {
            pedidos = [];
        }
    }
    pedidos.push(orderData);
    fs.writeFileSync(filePath, JSON.stringify(pedidos, null, 2));
    console.log(`💾 Pedido guardado en pedidos.json para ${orderData.email}`);
    return true;
}

// Envío a Google Sheets (opcional, no crítico)
async function sendToGoogleSheets(orderData, isUpdate = false) {
    if (!GOOGLE_SCRIPT_URL) {
        console.warn("⚠️ GOOGLE_SCRIPT_URL no definida, no se enviará a Sheets.");
        return false;
    }
    try {
        const response = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orden: orderData, update: isUpdate })
        });
        const text = await response.text();
        let result;
        try {
            result = JSON.parse(text);
        } catch(e) {
            console.error("❌ Respuesta no JSON:", text);
            return false;
        }
        if (result.status === 'success') {
            console.log(`📤 Envío a Google Sheets exitoso`);
            return true;
        } else {
            throw new Error(result.message || 'Error desconocido');
        }
    } catch (error) {
        console.error("❌ Error al enviar a Google Sheets (no crítico):", error.message);
        return false;
    }
}

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
    saveToLocalJSON(orderData);
    await sendToGoogleSheets(orderData, false);
    res.json({ status: 'success' });
});

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

    console.log(`📝 Pago creado con referencia: ${reference}, email: ${cliente.email}`);

    const baseUrl = process.env.BASE_URL || 'https://co2reforestprueba.onrender.com';
    // Pasamos el carrito en la URL para que gracias.html lo recupere si localStorage falla
    const cartEncoded = encodeURIComponent(JSON.stringify({
        a, b, c, placa, area, cliente
    }));
    const redirectUrl = `${baseUrl}/gracias.html?id=${reference}&cart=${cartEncoded}`;

    res.json({
        publicKey: WOMPI_PUBLIC_KEY,
        currency: CURRENCY,
        amountInCents: amountInCents.toString(),
        reference,
        signature,
        redirectUrl
    });
});

app.post('/api/confirm-payment', async (req, res) => {
    const { transactionId, cart } = req.body;
    if (!transactionId || !cart) {
        return res.status(400).json({ error: 'Faltan datos: transactionId y cart son requeridos' });
    }

    try {
        const { a, b, c, placa, area, cliente } = cart;
        const total = calcularTotal(a||0, b||0, c||0, placa||false);
        
        const now = new Date();
        const orderToSend = {
            email: cliente.email,
            fechaHora: now.toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
            nombre: cliente.nombre,
            cedula: cliente.cedula,
            telefono: cliente.telefono,
            ciudad: cliente.ciudad,
            packA: a || 0,
            packB: b || 0,
            packC: c || 0,
            placa: placa || false,
            textoPlaca: '',
            total: total,
            estado: 'Pagado',
            area: area || '',
            transactionId: transactionId
        };

        saveToLocalJSON(orderToSend);
        await sendToGoogleSheets(orderToSend, true);
        
        console.log(`✅ Pedido para ${cliente.email} registrado correctamente (local).`);
        res.json({ status: 'success' });
        
    } catch (error) {
        console.error("Error en /api/confirm-payment:", error);
        res.status(500).json({ error: 'Error interno, pero el pedido puede haberse guardado localmente.' });
    }
});

app.post('/api/wompi-webhook', (req, res) => {
    res.status(200).send('OK');
});

app.listen(PORT, () => console.log(`✅ Servidor en puerto ${PORT}`));