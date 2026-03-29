const express = require('express');
const bodyParser = require('body-parser');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(bodyParser.json());

const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const WA_TOKEN     = process.env.WA_TOKEN;
const WA_PHONE_ID  = process.env.WA_PHONE_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'miagente2024';

// ── FOLLETOS (imágenes PNG) ───────────────────────────────────────────────
const FOLLETOS = {
  clasificadora: 'https://raw.githubusercontent.com/CabezaKuka/agente-whatsapp/main/CG3-CG3E.png',
  mh5_1:        'https://raw.githubusercontent.com/CabezaKuka/agente-whatsapp/main/MH5-1.png',
  mh5_2:        'https://raw.githubusercontent.com/CabezaKuka/agente-whatsapp/main/MH5-2.png',
  zaranda:      'https://raw.githubusercontent.com/CabezaKuka/agente-whatsapp/main/zarandas-manuales.png',
};

// ── CATÁLOGO ──────────────────────────────────────────────────────────────
const CATALOGO = `
Equipo: CLASIFICADORA DE GRANOS CG-3 | Precio: 3.900 dolares | Descripción: 3 zarandas intercambiables, motor 1.5HP, producción promedio 2500 kg/hora, alimentación monofásica 220V. Solo clasifica, no tiene aire para limpieza. Puede procesar soya, frejol, maíz, sorgo, quinua, chía, pasto, habas, maní, orégano.
Equipo: CLASIFICADORA DE GRANOS CG-3E | Precio: $5.500 dolares | Descripción: 3 zarandas intercambiables, motores 3.5HP (1.5HP cajón vibrador + 2HP aspirador), variador de velocidad electrónico, producción promedio 2500 kg/hora, alimentación monofásica 220V. Incluye ciclón para recepción de basura. Puede procesar soya, frejol, maíz, sorgo, quinua, chía, pasto, habas, maní.
Equipo: ZARANDAS MANUALES | Precio: 230 Bolivianos | Descripción: Para laboratorio y muestras. Variedad de perforaciones redondas y oblongas. Dimensiones 30x25 cm. Son apilables.
Equipo: MH-5 MEDIDOR DE HUMEDAD | Precio: 2.200 Bolivianos | Descripción: Para granos: soya, maíz, sorgo, girasol y otros. Precisión +-0.6%. Batería recargable, pantalla OLED, tapa de presión con aviso sonoro. Incluye estuche. No mide castaña, cacao ni café.
Equipo: CUARTEADOR 12CM | Precio: 3.500 Bolivianos | Descripción: 12 canales de 19mm, fabricado en acero inoxidable, tres bandejas de recepción. No apto para áridos.
Equipo: TRILLADORA ENSAYOS | Precio: 2.400 dolares | Descripción: Para maíz, sorgo, soya, trigo. Motor estacionario 6.5HP o eléctrico. Cóncavo regulable, tapa regulable, ventilador incorporado, montada sobre ruedas. Ideal para pequeñas parcelas o líneas de muestras.
Equipo: MOLINO 20 MARTILLOS | Precio: 4.750 Bolvianos | Descripción: 20 martillos y 2 cuchillas, pica pasto, caña y muele granos. Rendimiento: 80-100 kg harina, 400 kg con cedazo 3mm, 700 kg con 5mm, 800 kg con 12mm. Con ciega: 1000-2000 kg/hora. Motor requerido eléctrico 5HP o gasolina 9HP. No incluye motor. Incluye base de motor.
Equipo: MOLINO 20 MARTILLOS CON CICLÓN | Precio: 6.150 Bolivianos | Descripción: 20 martillos y 2 cuchillas, pica pasto, caña y muele granos. Rendimiento: 80-100 kg harina, 400 kg con cedazo 3mm, 700 kg con 5mm, 800 kg con 12mm. Con ciega: 1000-2000 kg/hora. Motor requerido eléctrico trifásico 7.5HP o gasolina 11HP. No incluye motor. Incluye base de motor, extractor y ciclón.
Equipo: MOLINO 24 MARTILLOS | Precio: 6.550 Bolivianos | Descripción: 24 martillos y 2 cuchillas, pica pasto, caña y muele granos. Rendimiento: 150 kg harina, 600 kg con cedazo 3mm, 800 kg con 5mm, 1000 kg con 12mm. Con ciega: 2500 kg/hora. Motor requerido eléctrico trifásico 12.5HP o gasolina 13HP. No incluye motor. Incluye base de motor.
Equipo: MOLINO 24 MARTILLOS CON CICLÓN | Precio: 7.900 Bolivianos | Descripción: 24 martillos y 2 cuchillas, pica pasto, caña y muele granos. Rendimiento: 150 kg harina, 600 kg con cedazo 3mm, 800 kg con 5mm, 1200 kg con 12mm. Con ciega: 2500 kg/hora. Motor requerido eléctrico trifásico 12.5HP o gasolina 13HP. No incluye motor. Incluye base de motor, extractor y ciclón.
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

FOLLETOS DISPONIBLES — cuando el cliente pida más info, folleto, ficha técnica o catálogo de un equipo, respondé con una frase corta y la palabra clave correspondiente:
- Clasificadora CG-3 o CG-3E: [FOLLETO_CLASIFICADORA]
- Medidor de humedad MH-5: [FOLLETO_MH5]
- Zarandas manuales: [FOLLETO_ZARANDA]
Ejemplo: "Te mando la ficha técnica 👇 [FOLLETO_CLASIFICADORA]"

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
    if (!msg) return;

    const from = msg.from;

    // Audio
    if (msg.type === 'audio') {
      await enviarMensaje(from, 'En este momento no puedo escuchar audios. Escribime tu consulta y te respondo enseguida 😊');
      return;
    }

    // Otros tipos que no son texto
    if (msg.type !== 'text') {
      await enviarMensaje(from, 'Solo puedo responder mensajes de texto por ahora. Escribime tu consulta 😊');
      return;
    }

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

    // Ubicación
    if (reply.includes('[ENVIAR_UBICACION]')) {
      const texto = reply.replace('[ENVIAR_UBICACION]', '').trim();
      if (texto) await enviarMensaje(from, texto);
      await enviarUbicacion(from);

    // Folleto clasificadora
    } else if (reply.includes('[FOLLETO_CLASIFICADORA]')) {
      const texto = reply.replace('[FOLLETO_CLASIFICADORA]', '').trim();
      if (texto) await enviarMensaje(from, texto);
      await enviarImagen(from, FOLLETOS.clasificadora);

    // Folleto MH5 (2 imágenes)
    } else if (reply.includes('[FOLLETO_MH5]')) {
      const texto = reply.replace('[FOLLETO_MH5]', '').trim();
      if (texto) await enviarMensaje(from, texto);
      await enviarImagen(from, FOLLETOS.mh5_1);
      await enviarImagen(from, FOLLETOS.mh5_2);

    // Folleto zaranda
    } else if (reply.includes('[FOLLETO_ZARANDA]')) {
      const texto = reply.replace('[FOLLETO_ZARANDA]', '').trim();
      if (texto) await enviarMensaje(from, texto);
      await enviarImagen(from, FOLLETOS.zaranda);

    // Respuesta normal
    } else {
      await enviarMensaje(from, reply);
    }

    console.log(`✅ Respuesta enviada a ${from}`);

  } catch (err) {
    console.error('❌ Error:', err.message);
  }
});

// ── ENVIAR TEXTO ──────────────────────────────────────────────────────────
async function enviarMensaje(para, texto) {
  const res = await fetch(`https://graph.facebook.com/v18.0/${WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: para, type: 'text', text: { body: texto }
    })
  });
  if (!res.ok) throw new Error(JSON.stringify(await res.json()));
}

// ── ENVIAR UBICACIÓN ──────────────────────────────────────────────────────
async function enviarUbicacion(para) {
  const res = await fetch(`https://graph.facebook.com/v18.0/${WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: para, type: 'location',
      location: {
        latitude: -17.748285,
        longitude: -63.133169,
        name: 'Servicio Industrial Cruceño - SIC',
        address: 'sexto anillo, parque industrial, Santa Cruz de la Sierra, Bolivia'
      }
    })
  });
  if (!res.ok) throw new Error(JSON.stringify(await res.json()));
}

// ── ENVIAR IMAGEN ─────────────────────────────────────────────────────────
async function enviarImagen(para, url) {
  const res = await fetch(`https://graph.facebook.com/v18.0/${WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: para, type: 'image',
      image: { link: url }
    })
  });
  if (!res.ok) throw new Error(JSON.stringify(await res.json()));
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor activo en puerto ${PORT}`));
