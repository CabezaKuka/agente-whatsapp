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

const SYSTEM_PROMPT = `Sos un vendedor de equipos agrícolas respondiendo por WhatsApp.
Respondés como una persona real, nunca te identificás como bot ni asistente virtual.
Mensajes cortos y directos, como en una conversación de WhatsApp — máximo 2 o 3 líneas por respuesta.
Si el cliente pregunta poco, respondés poco. Si profundiza, profundizás vos también.
Nunca usás viñetas, listas ni texto largo. Todo en lenguaje natural y conversacional.
Si el cliente saluda, saludás y preguntás en qué podés ayudar, sin presentarte.
Si quiere hacer un pedido o hablar con alguien, le decís que contacte al 76317951.
SOLO usás info del catálogo y la información del negocio. Si algo no está, lo decís con naturalidad.

INFORMACIÓN DEL NEGOCIO:
- Hacemos envíos a todo el país.
- Fábrica en Santa Cruz de la Sierra.
- Horario de atención: Lunes a viernes de 7:00 a 11:00.
- Si el cliente pregunta por ubicación, dirección, dónde están, cómo llegar, dónde queda, o cualquier variante, respondé primero con un mensaje breve indicando cómo identificar el lugar y luego escribí [ENVIAR_UBICACION]. Ejemplo: "Te mando la ubicación exacta, somos el galpón blanco con barda gris 🏭 [ENVIAR_UBICACION]"

CATÁLOGO DE EQUIPOS:
${CATALOGO}`;

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

// ── RECEPCIÓN DE MENSAJES ─────────────────────────────────────────────────
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

    let reply = respuesta.content[0].text;
    conversaciones[from].push({ role: 'assistant', content: reply });

    // Si el agente quiere enviar la ubicación
    if (reply.includes('[ENVIAR_UBICACION]')) {
      const textoSinTag = reply.replace('[ENVIAR_UBICACION]', '').trim();
      
      // Enviar texto primero (si hay algo además del tag)
      if (textoSinTag) {
        await enviarMensaje(from, textoSinTag);
      }
      
      // Enviar ubicación GPS
      await enviarUbicacion(from);
      console.log(`✅ Ubicación enviada a ${from}`);
    } else {
      await enviarMensaje(from, reply);
      console.log(`✅ Respuesta enviada a ${from}`);
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
  }
});

// ── ENVIAR MENSAJE DE TEXTO ───────────────────────────────────────────────
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

// ── ENVIAR UBICACIÓN GPS ──────────────────────────────────────────────────
async function enviarUbicacion(para) {
  const res = await fetch(`https://graph.facebook.com/v18.0/${WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WA_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: para,
      type: 'location',
      location: {
        latitude: -17.748285,
        longitude: -63.133169,
        name: 'SIC',
        address: 'sexto anillo, parque industrial, Santa Cruz de la Sierra, Bolivia'
      }
    })
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(JSON.stringify(error));
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor activo en puerto ${PORT}`));
