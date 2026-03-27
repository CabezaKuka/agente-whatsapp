const express = require('express');
const bodyParser = require('body-parser');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── CATÁLOGO ──────────────────────────────────────────────────────────────
// Editá esto con tus máquinas reales
const CATALOGO = `
Equipo: CLASIFICADORA DE GRANOS | Precio: $5.500 | Descripción: 3 zarandas intercambiables, motores 3.5HP, variador de velocidad electrónico, producción promedio 2500 kg/hora, alimentación monofásica 220V. Incluye ciclón para recepción de basura.
Equipo: ZARANDAS MANUALES | Precio: $25 | Descripción: Para laboratorio y muestras. Variedad de perforaciones redondas y oblongas. Dimensiones 30x25 cm.
Equipo: MH-5 MEDIDOR DE HUMEDAD | Precio: $230 | Descripción: Para granos: soya, maíz, sorgo, girasol y otros. Precisión +-0.6%. Batería recargable. Pantalla OLED. No mide castaña, cacao ni café.
Equipo: CUARTEADOR 12CM | Precio: $400 | Descripción: 12 canales de 19mm. Acero inoxidable. Tres bandejas de recepción.
Equipo: TRILLADORA ENSAYOS | Precio: $2.400 | Descripción: Para maíz, sorgo, soya, trigo. Motor estacionario de 6.5HP o eléctrico.
`;
// ─────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Sos un vendedor experto de equipos agrícolas que atiende por WhatsApp.
Respondés como una persona real, de forma natural y conversacional, nunca como un robot.
Usás un tono cercano y amigable, como si hablaras con un cliente de confianza.
Escribís en español rioplatense (sos, tenés, podés).
Nunca listás características con viñetas ni formatos estructurados — explicás todo en texto natural.
Si te preguntan por un equipo, describís sus ventajas de forma natural como lo haría un vendedor.
Si el cliente muestra interés, ofrecés más detalles o preguntás qué cantidad necesita.
Si quiere comprar o hacer un pedido, decile que escriba al WhatsApp 76317951 para hablar con una persona.
Si el cliente quiere hablar con una persona real por cualquier motivo, decile que escriba al WhatsApp 76317951.
SOLO usás info del catálogo. Si algo no está, lo decís honestamente sin inventar.

CATÁLOGO DE EQUIPOS:
${CATALOGO}`;

// Historial por número de teléfono
const conversaciones = {};

// ── RECEPCIÓN DE MENSAJES DE TWILIO ───────────────────────────────────────
app.post('/whatsapp', async (req, res) => {
  const from = req.body.From;
  const text = req.body.Body;

  console.log(`📩 Mensaje de ${from}: ${text}`);

  if (!conversaciones[from]) conversaciones[from] = [];
  conversaciones[from].push({ role: 'user', content: text });
  if (conversaciones[from].length > 20) {
    conversaciones[from] = conversaciones[from].slice(-20);
  }

  try {
    const respuesta = await ai.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: conversaciones[from]
    });

    const reply = respuesta.content[0].text;
    conversaciones[from].push({ role: 'assistant', content: reply });

    console.log(`✅ Respuesta: ${reply}`);

    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>
    <Body>${reply.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</Body>
  </Message>
</Response>`);

  } catch (err) {
    console.error('❌ Error:', err.message);
    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>
    <Body>Lo siento, hubo un error. Por favor intentá de nuevo.</Body>
  </Message>
</Response>`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor activo en puerto ${PORT}`);
});
