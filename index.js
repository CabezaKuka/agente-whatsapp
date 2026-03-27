const express = require('express');
const bodyParser = require('body-parser');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(bodyParser.json());

const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const WA_TOKEN     = process.env.WA_TOKEN;
const WA_PHONE_ID  = process.env.WA_PHONE_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'mi_token_secreto';

// ── CATÁLOGO ──────────────────────────────────────────────────────────────
// Pegá acá la info de tus máquinas. Cada línea es un producto.
// Formato: Modelo | Precio | Descripción | Características | Stock
const CATALOGO = `
Modelo: CLASIFICADORA DE GRANOS | Precio: $5.000 | Descripción: Clasificadora de granos | Características: 5 toneladas/hora, motor 10HP | Stock: disponible
Modelo: Zaranda Z500 | Precio: $8.500 | Descripción: Zaranda vibratoria industrial | Características: 10 toneladas/hora, motor 15HP | Stock: disponible
Modelo: Elevador E100 | Precio: $3.200 | Descripción: Elevador de cangilones | Características: altura 6m, capacidad 3 ton/h | Stock: consultar
`;
// ─────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres el Asistente de Ventas de Maquinarias S.A. en WhatsApp.
Tu tono es amigable y profesional. Respondés de forma concisa.
SOLO usás la información del catálogo para responder. Si algo no está en el catálogo, decilo honestamente.
Si el cliente quiere hacer un pedido o cotización formal, pedile su nombre y empresa y decile que un asesor lo contactará en menos de 2 horas.

CATÁLOGO DE MÁQUINAS:
${CATALOGO}`;

// Historial de conversaciones por número de teléfono
const conversaciones = {};

// ── VERIFICACIÓN DEL WEBHOOK (Meta lo llama una sola vez al registrar) ────
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verificado correctamente');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Token incorrecto:', token);
    res.sendStatus(403);
  }
});

// ── RECEPCIÓN DE MENSAJES DE WHATSAPP ─────────────────────────────────────
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Responder rápido a Meta (menos de 5 segundos)

  try {
    const entry   = req.body.entry?.[0];
    const change  = entry?.changes?.[0];
    const msg     = change?.value?.messages?.[0];

    // Ignorar si no es un mensaje de texto
    if (!msg || msg.type !== 'text') return;

    const from = msg.from;           // Número del cliente
    const text = msg.text.body;      // Texto del mensaje

    console.log(`📩 Mensaje de ${from}: ${text}`);

    // Mantener historial (máximo 20 mensajes por conversación)
    if (!conversaciones[from]) conversaciones[from] = [];
    conversaciones[from].push({ role: 'user', content: text });
    if (conversaciones[from].length > 20) {
      conversaciones[from] = conversaciones[from].slice(-20);
    }

    // Llamar a Claude
    const respuesta = await ai.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: conversaciones[from]
    });

    const reply = respuesta.content[0].text;
    conversaciones[from].push({ role: 'assistant', content: reply });

    // Enviar respuesta por WhatsApp
    await enviarMensaje(from, reply);
    console.log(`✅ Respuesta enviada a ${from}`);

  } catch (err) {
    console.error('❌ Error:', err.message);
  }
});

// ── FUNCIÓN PARA ENVIAR MENSAJES ──────────────────────────────────────────
async function enviarMensaje(para, texto) {
  const url = `https://graph.facebook.com/v18.0/${WA_PHONE_ID}/messages`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WA_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: para,
      type: 'text',
      text: { body: texto }
    })
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(JSON.stringify(error));
  }
}

// ── INICIAR SERVIDOR ──────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor activo en puerto ${PORT}`);
  console.log(`📋 Webhook URL: https://TU-APP.railway.app/webhook`);
});
