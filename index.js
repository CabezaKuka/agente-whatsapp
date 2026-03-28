const express = require('express');
const bodyParser = require('body-parser');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(bodyParser.json());

const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const WA_TOKEN     = process.env.WA_TOKEN;
const WA_PHONE_ID  = process.env.WA_PHONE_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'miagente2024';

// ── CATÁLOGO ──────────────────────────────────────────────────────────────
const CATALOGO = `
Equipo: CLASIFICADORA DE GRANOS CG-3 | Precio: $3.900 | Descripción: 3 zarandas intercambiables, motor 1.5HP, producción promedio 2500 kg/hora, alimentación monofásica 220V. Solo clasifica, no tiene aire para limpieza. Puede procesar soya, frejol, maíz, sorgo, quinua, chía, pasto, habas, maní, orégano.
Equipo: CLASIFICADORA DE GRANOS CG-3E | Precio: $5.500 | Descripción: 3 zarandas intercambiables, motores 3.5HP (1.5HP cajón vibrador + 2HP aspirador), variador de velocidad electrónico, producción promedio 2500 kg/hora, alimentación monofásica 220V. Incluye ciclón para recepción de basura. Puede procesar soya, frejol, maíz, sorgo, quinua, chía, pasto, habas, maní.
Equipo: ZARANDAS MANUALES | Precio: 230 Bs | Descripción: Para laboratorio y muestras. Variedad de perforaciones redondas y oblongas. Dimensiones 30x25 cm. Son apilables.
Equipo: MH-5 MEDIDOR DE HUMEDAD | Precio: 2.200 Bs | Descripción: Para granos: soya, maíz, sorgo, girasol y otros. Precisión +-0.6%. Batería recargable, pantalla OLED, tapa de presión con aviso sonoro. Incluye estuche. No mide castaña, cacao ni café.
Equipo: CUARTEADOR 12CM | Precio: 3.500 Bs | Descripción: 12 canales de 19mm, fabricado en acero inoxidable, tres bandejas de recepción. No apto para áridos.
Equipo: TRILLADORA ENSAYOS | Precio: $2.400 | Descripción: Para maíz, sorgo, soya, trigo. Motor estacionario 6.5HP o eléctrico. Cóncavo regulable, tapa regulable, ventilador incorporado, montada sobre ruedas. Ideal para pequeñas parcelas o líneas de muestras.
`;
// ─────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Sos un asesor de ventas de equipos agrícolas que atiende por WhatsApp.
Respondés de forma natural, cordial y profesional, como una persona real.
Usás un tono respetuoso pero cercano, sin ser ni frío ni exageradamente informal.
Escribís en español (podés usar "usted" o "vos" según como arranque el cliente).
Nunca usás viñetas ni listas — explicás todo en texto corrido, de forma clara y directa.
Cuando te preguntan por un equipo, explicás lo más relevante sin abrumar con detalles.
Si el cliente muestra interés, ofrecés más información o preguntás qué necesita exactamente.
Si quiere hacer un pedido o hablar con una persona, decile que escriba al WhatsApp 76317951.
SOLO usás info del catálogo. Si algo no está, lo decís honestamente.

CATÁLOGO DE EQUIPOS:
${CATALOGO}`;

// Historial por número de teléfono
const conversaciones = {};

// ── VERIFICACIÓN DEL WEBHOOK ──────────────────────────────────────────────
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verificado');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Token incorrecto');
    res.sendStatus(403);
  }
});

// ── RECEPCIÓN DE MENSAJES DE META ─────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg || msg.type !== 'text') return;

    const from = msg.from;
    const text = msg.text.body;
    console.log(`📩 Mensaje de ${from}: ${text}`);

    if (!conversaciones[from]) conversaciones[from] = [];
    conversaciones[from].push({ role: 'user', content: text });
    if (conversaciones[from].length > 20) {
      conversaciones[from] = conversaciones[from].slice(-20);
    }

    const respuesta = await ai.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: conversaciones[from]
    });

    const reply = respuesta.content[0].text;
    conversaciones[from].push({ role: 'assistant', content: reply });

    await enviarMensaje(from, reply);
    console.log(`✅ Respuesta enviada a ${from}`);

  } catch (err) {
    console.error('❌ Error:', err.message);
  }
});

// ── ENVIAR MENSAJE ────────────────────────────────────────────────────────
async function enviarMensaje(para, texto) {
  const res = await fetch(`https://graph.facebook.com/v18.0/${WA_PHONE_ID}/messages`, {
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor activo en puerto ${PORT}`));
