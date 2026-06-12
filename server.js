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

const WOMPI_PUBLIC_KEY = process.env.WOMPI_PUBLIC_KEY;
const WOMPI_PRIVATE_KEY = process.env.WOMPI_PRIVATE_KEY;
const WOMPI_INTEGRITY_SECRET = process.env.WOMPI_INTEGRITY_SECRET;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

if (!WOMPI_PUBLIC_KEY || !WOMPI_INTEGRITY_SECRET) {
    console.error("❌ ERROR: Variables de Wompi no definidas.");
    process.exit(1);
}
if (!GOOGLE_SCRIPT_URL) {
    console.warn("⚠️ GOOGLE_SCRIPT_URL no definida. No se guardarán datos en Google Sheets.");
}

const CURRENCY = 'COP';
const PLACA_COST = 85000;

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
    if (!GOOGLE_SCRIPT_URL) {
        console.error("❌ No se enviará a Google Sheets: URL no configurada.");
        return false;
    }
    try {
        console.log(`📤 Enviando a Google Sheets (update=${isUpdate})...`);
        const response = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orden: orderData, update: isUpdate })
        });
        const result = await response.json();
        console.log(`📤 Respuesta de Google Sheets:`, result);
        if (result.status === 'success') return true;
        else throw new Error(result.message || 'Error desconocido');
    } catch (error) {
        console.error("❌ Error detallado al enviar a Google Sheets:", error.message);
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
    const success = await sendToGoogleSheets(orderData, false);
    if (success) {
        res.json({ status: 'success' });
    } else {
        res.status(500).json({ error: 'No se pudo guardar en Google Sheets' });
    }
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

app.post('/api/confirm-payment', async (req, res) => {
    const { transactionId, cart } = req.body;
    if (!transactionId || !cart) {
        return res.status(400).json({ error: 'Faltan datos: transactionId y cart son requeridos' });
    }

    try {
        // Verificación opcional con Wompi
        if (WOMPI_PRIVATE_KEY) {
            try {
                const wompiResponse = await fetch(`https://api.wompi.co/v1/transactions/${transactionId}`, {
                    headers: { 'Authorization': `Bearer ${WOMPI_PRIVATE_KEY}` }
                });
                const wompiData = await wompiResponse.json();
                if (wompiData.data && wompiData.data.status === 'APPROVED') {
                    console.log(`✅ Transacción ${transactionId} verificada en Wompi: APROBADA`);
                } else {
                    console.warn(`⚠️ Transacción ${transactionId} no aprobada o no encontrada.`);
                }
            } catch (err) {
                console.warn(`⚠️ No se pudo verificar transacción en Wompi: ${err.message}`);
            }
        }

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

        const success = await sendToGoogleSheets(orderToSend, true);
        if (success) {
            console.log(`✅ Pedido para ${cliente.email} actualizado correctamente`);
            res.json({ status: 'success' });
        } else {
            console.error(`❌ Falló la actualización en Google Sheets para ${cliente.email}`);
            res.status(500).json({ error: 'Error al actualizar el pedido en Google Sheets' });
        }
    } catch (error) {
        console.error("Error en /api/confirm-payment:", error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.post('/api/wompi-webhook', (req, res) => {
    res.status(200).send('OK');
});

app.listen(PORT, () => console.log(`✅ Servidor en puerto ${PORT}`));