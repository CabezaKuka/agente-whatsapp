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
Modelo: Clasificadora X200 | Precio: $5.000 | Descripción: Clasificadora de granos | Stock: disponible
Modelo: Zaranda Z500 | Precio: $8.500 | Descripción: Zaranda vibratoria industrial | Stock: disponible
Modelo: Elevador E100 | Precio: $3.200 | Descripción: Elevador de cangilones | Stock: consultar
`;
// ─────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres el Asistente de Ventas en WhatsApp.
Tu tono es amigable y profesional. Respondés de forma concisa.
SOLO usás la información del catálogo para responder.
Si algo no está en el catálogo, decilo honestamente.
Si el cliente quiere hacer un pedido, pedile su nombre y empresa.

CATÁLOGO DE MÁQUINAS:
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
