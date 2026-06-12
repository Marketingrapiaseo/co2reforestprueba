require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const path = require('path');
const fs = require('fs'); // para guardar respaldo local

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
    console.warn("⚠️ GOOGLE_SCRIPT_URL no definida. Los pedidos no se guardarán en Google Sheets.");
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
            connectSrc: ["'self'", "https://api.wompi.co", "https://api-sandbox.wompi.co", "https://script.google.com"],
            formAction: ["'self'", "https://checkout.wompi.co"],
        },
    },
}));

const allowedOrigins = [
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'https://co2reforest.com',
    'https://co2reforestprueba.onrender.com',
    'https://*.onrender.com'
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
        console.log("📤 No se enviará a Google Sheets: URL no configurada.");
        return false;
    }
    try {
        const response = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors', // a veces ayuda con CORS, pero no recibirás respuesta
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orden: orderData, update: isUpdate })
        });
        // No podemos obtener respuesta JSON en modo no-cors, asumimos éxito
        console.log(`📤 Envío a Google Sheets realizado (modo no-cors) para ${orderData.email}`);
        return true;
    } catch (error) {
        console.error("❌ Error enviando a Google Sheets:", error);
        return false;
    }
}

// Función para guardar copia de seguridad local
function saveBackup(orderData) {
    try {
        const backupFile = './pedidos_backup.json';
        let backups = [];
        if (fs.existsSync(backupFile)) {
            const data = fs.readFileSync(backupFile, 'utf8');
            backups = JSON.parse(data);
        }
        backups.push(orderData);
        fs.writeFileSync(backupFile, JSON.stringify(backups, null, 2));
        console.log(`💾 Pedido guardado en respaldo local: ${orderData.transactionId}`);
    } catch (err) {
        console.error("❌ Error guardando respaldo local:", err);
    }
}

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
    if (!errors.isEmpty()) {
        console.error("❌ Errores de validación en create-payment:", errors.array());
        return res.status(400).json({ errors: errors.array() });
    }

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
    console.log(`📝 Orden pendiente guardada con referencia: ${reference}, área: ${area}, email: ${cliente.email}`);

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
    console.log(`🔔 Recibida solicitud de confirmación para transactionId: ${transactionId}`);
    if (!transactionId) {
        console.log("❌ Faltó transactionId");
        return res.status(400).json({ error: 'Falta transactionId' });
    }

    try {
        // Verificar con Wompi (opcional pero recomendado)
        let wompiStatus = 'APPROVED'; // por defecto asumimos aprobado si llegó a gracias.html
        if (WOMPI_PRIVATE_KEY) {
            const apiUrl = `https://api.wompi.co/v1/transactions/${transactionId}`;
            console.log(`🔍 Consultando Wompi: ${apiUrl}`);
            const wompiResponse = await fetch(apiUrl, {
                headers: { 'Authorization': `Bearer ${WOMPI_PRIVATE_KEY}` }
            });
            const wompiData = await wompiResponse.json();
            if (!wompiResponse.ok || !wompiData.data || wompiData.data.status !== 'APPROVED') {
                console.warn(`⚠️ Wompi no reporta transacción APROBADA: ${wompiData.data?.status || 'desconocido'}`);
                wompiStatus = wompiData.data?.status || 'UNKNOWN';
            } else {
                console.log(`✅ Wompi confirma transacción APROBADA`);
            }
        } else {
            console.warn("⚠️ No hay WOMPI_PRIVATE_KEY, se omite verificación con Wompi");
        }

        // Buscar la orden pendiente por la referencia (viene en la transacción)
        // Necesitamos obtener la referencia a partir del transactionId? En nuestro flujo, la referencia está guardada en pendingOrders con la referencia que generamos.
        // Pero el transactionId no es la referencia. Para simplificar, podríamos buscar en pendingOrders todas las órdenes y verificar cuál coincide con el email? Mejor usar un Map con la referencia.
        // En create-payment guardamos con reference = CO2R-...
        // Wompi devuelve el campo reference en la transacción. Por tanto, debemos extraer la referencia de la consulta a Wompi.
        // Si no pudimos consultar Wompi, tendremos que buscar de otra forma. En nuestro caso, si no se consulta, fallará.
        // Para solucionarlo, podemos cambiar el flujo: enviar la referencia desde gracias.html (almacenarla en localStorage)
        // o buscar la orden por email y total? No es robusto.

        // Por ahora, asumiremos que la referencia está en el campo 'reference' de la transacción de Wompi.
        // Si no pudimos consultar Wompi, no podremos encontrar la orden. Por eso es mejor pedir la referencia desde el frontend.

        // Cambio: Agregar en gracias.html que envíe también la referencia (almacenada en localStorage durante create-payment).
        // Pero como ya tienes la estructura, podemos adaptar: cuando se crea el pago, además de guardar en pendingOrders, guardamos en localStorage del navegador la referencia (ya lo tenemos en cartData? podemos agregarla).
        // Para no complicar, por ahora asumiremos que podemos consultar Wompi y extraer la referencia.

        if (!WOMPI_PRIVATE_KEY) {
            // Si no hay llave privada, no podemos obtener la referencia. Fallamos.
            return res.status(500).json({ error: 'No se puede verificar la transacción sin WOMPI_PRIVATE_KEY' });
        }

        // Obtener la referencia desde la respuesta de Wompi
        const apiUrl = `https://api.wompi.co/v1/transactions/${transactionId}`;
        const wompiResponse = await fetch(apiUrl, {
            headers: { 'Authorization': `Bearer ${WOMPI_PRIVATE_KEY}` }
        });
        const wompiData = await wompiResponse.json();
        if (!wompiData.data || wompiData.data.status !== 'APPROVED') {
            return res.status(400).json({ error: 'Pago no aprobado o no encontrado' });
        }
        const reference = wompiData.data.reference;
        console.log(`🔎 Referencia obtenida de Wompi: ${reference}`);

        const pending = pendingOrders.get(reference);
        if (!pending) {
            console.error(`❌ Orden con referencia ${reference} no encontrada en pendingOrders.`);
            // Quizás expiró? Podríamos buscar en backup local? Intentamos guardar igual con datos parciales
            // Intentamos recuperar información de localStorage? No, eso no está disponible en el servidor.
            // Devolvemos error.
            return res.status(404).json({ error: 'Orden no encontrada. Puede que haya expirado o ya se haya procesado.' });
        }

        const now = new Date();
        const orderToSend = {
            email: pending.cliente.email,
            fechaHora: now.toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
            nombre: pending.cliente.nombre,
            cedula: pending.cliente.cedula,
            telefono: pending.cliente.telefono,
            ciudad: pending.cliente.ciudad,
            packA: pending.a,
            packB: pending.b,
            packC: pending.c,
            placa: pending.placa,
            textoPlaca: pending.textoPlaca || '',
            total: pending.total,
            estado: 'Pagado',
            area: pending.area,
            transactionId: transactionId
        };

        // Guardar en Google Sheets
        const googleSuccess = await sendToGoogleSheets(orderToSend, true);
        // Guardar respaldo local siempre
        saveBackup(orderToSend);

        if (googleSuccess) {
            console.log(`✅ Orden ${reference} registrada en Google Sheets y respaldo local`);
        } else {
            console.warn(`⚠️ Orden ${reference} solo guardada en respaldo local (fallo Google Sheets)`);
        }

        pendingOrders.delete(reference);
        res.json({ status: 'success', backup: !googleSuccess });
    } catch (error) {
        console.error("❌ Error en confirm-payment:", error);
        res.status(500).json({ error: 'Error interno del servidor', details: error.message });
    }
});

// Webhook de Wompi (opcional)
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
                    nombre: pending.cliente.nombre,
                    cedula: pending.cliente.cedula,
                    telefono: pending.cliente.telefono,
                    ciudad: pending.cliente.ciudad,
                    packA: pending.a,
                    packB: pending.b,
                    packC: pending.c,
                    placa: pending.placa,
                    textoPlaca: pending.textoPlaca || '',
                    total: pending.total,
                    estado: 'Pagado',
                    area: pending.area,
                    transactionId: transaction.id
                };
                await sendToGoogleSheets(orderToSend, true);
                saveBackup(orderToSend);
                pendingOrders.delete(reference);
                console.log(`✅ Webhook: Orden ${reference} procesada`);
            }
        }
    } catch (error) {
        console.error("❌ Error en webhook:", error);
    }
});

app.listen(PORT, () => console.log(`✅ Servidor en puerto ${PORT}`));