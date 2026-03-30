const express = require('express');
const bodyParser = require('body-parser');
const Anthropic = require('@anthropic-ai/sdk');
const {
  initDb,
  saveIncoming,
  saveOutgoing,
  updateStatus,
  getChats,
  getMessages,
} = require('./db');

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

initDb();

const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const WA_TOKEN     = process.env.WA_TOKEN;
const WA_PHONE_ID  = process.env.WA_PHONE_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'miagente2024';

// ── NÚMERO PARA NOTIFICACIONES ────────────────────────────────────────────
const NOTIFICAR_A = '59177626675'; // Tu WhatsApp personal

// ── FOLLETOS (imágenes PNG) ───────────────────────────────────────────────
const FOLLETOS = {
  clasificadora: 'https://raw.githubusercontent.com/CabezaKuka/agente-whatsapp/main/CG3-CG3E.png',
  mh5_1:         'https://raw.githubusercontent.com/CabezaKuka/agente-whatsapp/main/MH5-1.png',
  mh5_2:         'https://raw.githubusercontent.com/CabezaKuka/agente-whatsapp/main/MH5-2.png',
  zaranda:       'https://raw.githubusercontent.com/CabezaKuka/agente-whatsapp/main/zarandas-manuales.png',
};

// ── CATÁLOGO ──────────────────────────────────────────────────────────────
const CATALOGO = `
Equipo: CLASIFICADORA DE GRANOS CG-3 | Precio: 3.900 dolares | Descripción: 3 zarandas intercambiables, motor 1.5HP, producción promedio 2500 kg/hora, alimentación monofásica 220V. Solo clasifica, no tiene aire para limpieza. Puede procesar soya, frejol, maíz, sorgo, quinua, chía, pasto, habas, maní, orégano.
Equipo: CLASIFICADORA DE GRANOS CG-3E | Precio: $5.500 dolares | Descripción: 3 zarandas intercambiables, motores 3.5HP (1.5HP cajón vibrador + 2HP aspirador), variador de velocidad electrónico, producción promedio 2500 kg/hora, alimentación monofásica 220V. Incluye ciclón para recepción de basura. Puede procesar soya, frejol, maíz, sorgo, quinua, chía, pasto, habas, maní.
Equipo: ZARANDAS MANUALES | Precio: 230 Bolivianos | Descripción: Para laboratorio y muestras. Variedad de perforaciones redondas y oblongas. Dimensiones 30x25 cm. Son apilables.
Equipo: MH-5 MEDIDOR DE HUMEDAD | Precio: 2.200 Bolivianos | Descripción: Para granos: soya, maíz, sorgo, girasol y otros. Precisión +-0.6%. Batería recargable, pantalla OLED, tapa de presión con aviso sonoro. Incluye estuche. No mide castaña, cacao ni café.
Equipo: CUARTEADOR 12CM | Precio: 3.500 Bolivianos | Descripción: 12 canales de 19mm, fabricado en acero inoxidable, tres bandejas de recepción. No apto para áridos.
Equipo: TRILLADORA ENSAYOS | Precio: 2.400 dolares | Descripción: Para maíz, sorgo, soya, trigo. Motor estacionario 6.5HP o eléctrico. Cóncavo regulable, tapa regulable, ventilador incorporado, montada sobre ruedas. Ideal para pequeñas parcelas o líneas de muestras.
Equipo: MOLINO 20 MARTILLOS | Precio: 4.750 Bolivianos | Descripción: 20 martillos y 2 cuchillas, pica pasto, caña y muele granos. Rendimiento: 80-100 kg harina, 400 kg con cedazo 3mm, 700 kg con 5mm, 800 kg con 12mm. Con ciega: 1000-2000 kg/hora. Motor requerido eléctrico 5HP o gasolina 9HP. No incluye motor. Incluye base de motor.
Equipo: MOLINO 20 MARTILLOS CON CICLÓN | Precio: 6.150 Bolivianos | Descripción: 20 martillos y 2 cuchillas, pica pasto, caña y muele granos. Rendimiento: 80-100 kg harina, 400 kg con cedazo 3mm, 700 kg con 5mm, 800 kg con 12mm. Con ciega: 1000-2000 kg/hora. Motor requerido eléctrico trifásico 7.5HP o gasolina 11HP. No incluye motor. Incluye base de motor, extractor y ciclón.
Equipo: MOLINO 24 MARTILLOS | Precio: 6.550 Bolivianos | Descripción: 24 martillos y 2 cuchillas, pica pasto, caña y muele granos. Rendimiento: 150 kg harina, 600 kg con cedazo 3mm, 800 kg con 5mm, 1000 kg con 12mm. Con ciega: 2500 kg/hora. Motor requerido eléctrico trifásico 12.5HP o gasolina 13HP. No incluye motor. Incluye base de motor.
Equipo: MOLINO 24 MARTILLOS CON CICLÓN | Precio: 7.900 Bolivianos | Descripción: 24 martillos y 2 cuchillas, pica pasto, caña y muele granos. Rendimiento: 150 kg harina, 600 kg con cedazo 3mm, 800 kg con 5mm, 1200 kg con 12mm. Con ciega: 2500 kg/hora. Motor requerido eléctrico trifásico 12.5HP o gasolina 13HP. No incluye motor. Incluye base de motor, extractor y ciclón.
Equipo: PICADORA DE PASTO Y CAÑA | Precio: 3500 Bolivianos| Descripción: Pica pasto y caña, dos tamaños de corte regulable. Rendimiento 2000 kilos hora. Motor requerido 3.5 hp, monofásico o trifásico o 6.5 HP a gasolina. Motor no incluido.
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
- Los molinos no incluyen motor.

FOLLETOS DISPONIBLES — cuando el cliente pida más info, folleto, ficha técnica o catálogo de un equipo, respondé con una frase corta y la palabra clave correspondiente:
- Clasificadora CG-3 o CG-3E: [FOLLETO_CLASIFICADORA]
- Medidor de humedad MH-5: [FOLLETO_MH5]
- Zarandas manuales: [FOLLETO_ZARANDA]
Ejemplo: "Te mando la ficha técnica 👇 [FOLLETO_CLASIFICADORA]"

CATÁLOGO DE EQUIPOS:
${CATALOGO}`;

const conversaciones = {};

// ── HELPERS ───────────────────────────────────────────────────────────────
function truncateConversation(from) {
  if (!conversaciones[from]) return;
  if (conversaciones[from].length > 20) {
    conversaciones[from] = conversaciones[from].slice(-20);
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\n/g, '<br>');
}

function extractMetaMessageId(result) {
  return result?.messages?.[0]?.id || null;
}

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

// ── BANDEJA SIMPLE ────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.redirect('/inbox');
});

app.get('/inbox', (req, res) => {
  const chats = getChats();

  let html = `
    <html>
    <head>
      <meta charset="utf-8" />
      <title>Bandeja WhatsApp</title>
    </head>
    <body style="font-family: Arial, sans-serif; max-width: 960px; margin: 20px auto; padding: 0 12px;">
      <h1 style="margin-bottom: 8px;">Bandeja WhatsApp</h1>
      <p style="color:#666; margin-top:0;">Conversaciones guardadas en Railway + SQLite</p>
      <div style="border:1px solid #ddd; border-radius:10px; overflow:hidden;">
  `;

  if (!chats.length) {
    html += `<div style="padding:16px;">Todavía no hay conversaciones guardadas.</div>`;
  } else {
    for (const chat of chats) {
      const label = escapeHtml(chat.name || chat.wa_id);
      const when = escapeHtml(chat.last_message_at || '');
      html += `
        <div style="padding:14px 16px; border-bottom:1px solid #eee;">
          <a href="/chat/${encodeURIComponent(chat.wa_id)}" style="font-weight:bold; text-decoration:none; color:#111;">
            ${label}
          </a>
          <div style="font-size:12px; color:#777; margin-top:4px;">${escapeHtml(chat.wa_id)}</div>
          <div style="font-size:12px; color:#777; margin-top:4px;">${when}</div>
        </div>
      `;
    }
  }

  html += `
      </div>
    </body>
    </html>
  `;

  res.send(html);
});

app.get('/chat/:wa_id', (req, res) => {
  const waId = req.params.wa_id;
  const messages = getMessages(waId);

  let html = `
    <html>
    <head>
      <meta charset="utf-8" />
      <title>Chat ${escapeHtml(waId)}</title>
    </head>
    <body style="font-family: Arial, sans-serif; max-width: 960px; margin: 20px auto; padding: 0 12px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <div>
          <a href="/inbox" style="text-decoration:none;">← Volver</a>
          <h1 style="margin:8px 0 0 0;">Chat con ${escapeHtml(waId)}</h1>
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:10px; background:#fafafa; border:1px solid #ddd; border-radius:12px; padding:16px; min-height:300px;">
  `;

  if (!messages.length) {
    html += `<div style="color:#666;">No hay mensajes guardados para este número.</div>`;
  } else {
    for (const msg of messages) {
      const align = msg.direction === 'out' ? 'right' : 'left';
      const bg = msg.direction === 'out' ? '#dcf8c6' : '#f1f1f1';
      const status = msg.status ? ` (${escapeHtml(msg.status)})` : '';

      html += `
        <div style="text-align:${align};">
          <div style="display:inline-block; max-width:72%; padding:10px 12px; border-radius:12px; background:${bg}; text-align:left;">
            <div style="white-space:normal;">${escapeHtml(msg.text || '[sin texto]')}</div>
            <div style="font-size:11px; color:#666; margin-top:6px;">${escapeHtml(msg.created_at)}${status}</div>
          </div>
        </div>
      `;
    }
  }

  html += `
      </div>

      <form method="post" action="/reply/${encodeURIComponent(waId)}" style="margin-top:16px;">
        <textarea name="text" rows="4" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:8px;" placeholder="Escribe una respuesta manual..."></textarea>
        <button type="submit" style="margin-top:10px; padding:10px 14px; border:none; border-radius:8px; background:#25D366; color:#111; font-weight:bold; cursor:pointer;">
          Enviar
        </button>
      </form>
    </body>
    </html>
  `;

  res.send(html);
});

app.post('/reply/:wa_id', async (req, res) => {
  const waId = req.params.wa_id;
  const text = (req.body.text || '').trim();

  if (!text) {
    return res.redirect(`/chat/${encodeURIComponent(waId)}`);
  }

  try {
    const result = await enviarMensaje(waId, text);
    const metaMessageId = extractMetaMessageId(result);

    saveOutgoing({
      waId,
      text,
      metaMessageId,
      status: 'sent'
    });

    if (!conversaciones[waId]) conversaciones[waId] = [];
    conversaciones[waId].push({ role: 'assistant', content: text });
    truncateConversation(waId);

    return res.redirect(`/chat/${encodeURIComponent(waId)}`);
  } catch (err) {
    console.error('❌ Error enviando respuesta manual:', err.message);
    return res.status(500).send('Error enviando mensaje manual');
  }
});

// ── RECEPCIÓN DE MENSAJES ─────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const entries = req.body.entry || [];

    for (const entry of entries) {
      const changes = entry.changes || [];

      for (const change of changes) {
        const value = change.value || {};
        const contacts = value.contacts || [];
        const messages = value.messages || [];
        const statuses = value.statuses || [];
        const contactName = contacts[0]?.profile?.name || null;

        // Actualizar estados de mensajes salientes
        for (const st of statuses) {
          if (st?.id && st?.status) {
            updateStatus(st.id, st.status);
          }
        }

        // Procesar mensajes entrantes
        for (const msg of messages) {
          const from = msg.from;
          const messageId = msg.id;

          if (!from) continue;

          // Audio
          if (msg.type === 'audio') {
            saveIncoming({
              waId: from,
              name: contactName,
              text: '[Audio recibido]',
              metaMessageId: messageId
            });

            const replyText = 'En este momento no puedo escuchar audios. Escribime tu consulta y te respondo enseguida 😊';
            const result = await enviarMensaje(from, replyText);

            saveOutgoing({
              waId: from,
              text: replyText,
              metaMessageId: extractMetaMessageId(result),
              status: 'sent'
            });

            await enviarMensaje(NOTIFICAR_A, `🎤 Audio recibido de +${from}`);
            continue;
          }

          // Otros tipos que no son texto
          if (msg.type !== 'text') {
            saveIncoming({
              waId: from,
              name: contactName,
              text: `[Mensaje ${msg.type || 'no soportado'} recibido]`,
              metaMessageId: messageId
            });

            const replyText = 'Solo puedo responder mensajes de texto por ahora. Escribime tu consulta 😊';
            const result = await enviarMensaje(from, replyText);

            saveOutgoing({
              waId: from,
              text: replyText,
              metaMessageId: extractMetaMessageId(result),
              status: 'sent'
            });

            continue;
          }

          const text = msg.text?.body || '';
          console.log(`📩 Mensaje de ${from}: ${text}`);

          saveIncoming({
            waId: from,
            name: contactName,
            text,
            metaMessageId: messageId
          });

          // Notificar mensaje entrante
          await enviarMensaje(NOTIFICAR_A, `📩 Nuevo mensaje de +${from}:\n"${text}"`);

          if (!conversaciones[from]) conversaciones[from] = [];
          conversaciones[from].push({ role: 'user', content: text });
          truncateConversation(from);

          const respuesta = await ai.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 500,
            system: SYSTEM_PROMPT,
            messages: conversaciones[from]
          });

          let reply = respuesta.content?.[0]?.text || 'Perdón, no pude responder bien. Escribime de nuevo por favor.';
          conversaciones[from].push({ role: 'assistant', content: reply });
          truncateConversation(from);

          // Ubicación
          if (reply.includes('[ENVIAR_UBICACION]')) {
            const texto = reply.replace('[ENVIAR_UBICACION]', '').trim();

            if (texto) {
              const resultTexto = await enviarMensaje(from, texto);
              saveOutgoing({
                waId: from,
                text: texto,
                metaMessageId: extractMetaMessageId(resultTexto),
                status: 'sent'
              });
            }

            const resultUbicacion = await enviarUbicacion(from);
            saveOutgoing({
              waId: from,
              text: '[Ubicación enviada]',
              metaMessageId: extractMetaMessageId(resultUbicacion),
              status: 'sent'
            });

          // Folleto clasificadora
          } else if (reply.includes('[FOLLETO_CLASIFICADORA]')) {
            const texto = reply.replace('[FOLLETO_CLASIFICADORA]', '').trim();

            if (texto) {
              const resultTexto = await enviarMensaje(from, texto);
              saveOutgoing({
                waId: from,
                text: texto,
                metaMessageId: extractMetaMessageId(resultTexto),
                status: 'sent'
              });
            }

            const resultImg = await enviarImagen(from, FOLLETOS.clasificadora);
            saveOutgoing({
              waId: from,
              text: '[Imagen enviada: folleto clasificadora]',
              metaMessageId: extractMetaMessageId(resultImg),
              status: 'sent'
            });

          // Folleto MH5 (2 imágenes)
          } else if (reply.includes('[FOLLETO_MH5]')) {
            const texto = reply.replace('[FOLLETO_MH5]', '').trim();

            if (texto) {
              const resultTexto = await enviarMensaje(from, texto);
              saveOutgoing({
                waId: from,
                text: texto,
                metaMessageId: extractMetaMessageId(resultTexto),
                status: 'sent'
              });
            }

            const resultImg1 = await enviarImagen(from, FOLLETOS.mh5_1);
            saveOutgoing({
              waId: from,
              text: '[Imagen enviada: MH5 1]',
              metaMessageId: extractMetaMessageId(resultImg1),
              status: 'sent'
            });

            const resultImg2 = await enviarImagen(from, FOLLETOS.mh5_2);
            saveOutgoing({
              waId: from,
              text: '[Imagen enviada: MH5 2]',
              metaMessageId: extractMetaMessageId(resultImg2),
              status: 'sent'
            });

          // Folleto zaranda
          } else if (reply.includes('[FOLLETO_ZARANDA]')) {
            const texto = reply.replace('[FOLLETO_ZARANDA]', '').trim();

            if (texto) {
              const resultTexto = await enviarMensaje(from, texto);
              saveOutgoing({
                waId: from,
                text: texto,
                metaMessageId: extractMetaMessageId(resultTexto),
                status: 'sent'
              });
            }

            const resultImg = await enviarImagen(from, FOLLETOS.zaranda);
            saveOutgoing({
              waId: from,
              text: '[Imagen enviada: folleto zaranda]',
              metaMessageId: extractMetaMessageId(resultImg),
              status: 'sent'
            });

          // Respuesta normal
          } else {
            const resultTexto = await enviarMensaje(from, reply);
            saveOutgoing({
              waId: from,
              text: reply,
              metaMessageId: extractMetaMessageId(resultTexto),
              status: 'sent'
            });
          }

          console.log(`✅ Respuesta enviada a ${from}`);
        }
      }
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
  }
});

// ── ENVIAR TEXTO ──────────────────────────────────────────────────────────
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

  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

// ── ENVIAR UBICACIÓN ──────────────────────────────────────────────────────
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
        name: 'Servicio Industrial Cruceño - SIC',
        address: 'sexto anillo, parque industrial, Santa Cruz de la Sierra, Bolivia'
      }
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

// ── ENVIAR IMAGEN ─────────────────────────────────────────────────────────
async function enviarImagen(para, url) {
  const res = await fetch(`https://graph.facebook.com/v18.0/${WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WA_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: para,
      type: 'image',
      image: { link: url }
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor activo en puerto ${PORT}`));
