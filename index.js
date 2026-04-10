const express = require('express');
const bodyParser = require('body-parser');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const {
  initDb,
  saveIncoming,
  saveOutgoing,
  updateStatus,
  getChats,
  getMessages,
  getCatalogo,
  getCatalogoTexto,
  updateProducto,
  insertProducto,
  deleteProducto,
} = require('./db');

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

initDb();

// Inicialización de Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const WA_TOKEN     = process.env.WA_TOKEN;
const WA_PHONE_ID  = process.env.WA_PHONE_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'miagente2024';

const NOTIFICAR_A = '59177626675';

const FOLLETOS = {
  clasificadora: 'https://raw.githubusercontent.com/CabezaKuka/agente-whatsapp/main/CG3-CG3E.png',
  mh5_1:          'https://raw.githubusercontent.com/CabezaKuka/agente-whatsapp/main/MH5-1.png',
  mh5_2:          'https://raw.githubusercontent.com/CabezaKuka/agente-whatsapp/main/MH5-2.png',
  zaranda:       'https://raw.githubusercontent.com/CabezaKuka/agente-whatsapp/main/lista2.png',
  molinos:         'https://raw.githubusercontent.com/CabezaKuka/agente-whatsapp/main/molinos.png',
};

function buildSystemPrompt() {
  const ahora = new Date();
  const bolivia = new Date(ahora.getTime() - 4 * 60 * 60 * 1000);
  const dias = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  const idx = bolivia.getUTCDay();
  const diaActual = dias[idx];
  const diaManana = dias[(idx + 1) % 7];
  const fechaActual = bolivia.toISOString().slice(0, 10);

  const atiende = (d) => d >= 1 && d <= 5;
  const hoyAtiende = atiende(idx);
  const mananaAtiende = atiende((idx + 1) % 7);

  return `Sos un vendedor de equipos agrícolas respondiendo por WhatsApp.
Hoy es ${diaActual} ${fechaActual} (hora Bolivia, GMT-4).
Respondés como una persona real, nunca te identificás como bot ni asistente virtual.
Mensajes MUY cortos — máximo 2 líneas, sin excepción.
NUNCA usás guiones, viñetas ni listas. Todo en texto corrido.
Los clientes escriben con ortografía informal, abreviaciones y errores típicos del español boliviano. Interpretá siempre lo que quisieron decir, nunca respondas como si no entendieras.
Cuando preguntan por un equipo, das el precio directo y una característica clave sin preguntar antes.
Si el nombre del producto está mal escrito pero hay una coincidencia obvia en el catálogo, respondé directamente con ese producto, precio y característica clave — nunca preguntes si "te sirve" cuando la intención es clara.
Solo preguntás cuando hay dos o más productos que podrían encajar y necesitás saber cuál, o cuando algo genuinamente no quedó claro. En ese caso hacés UNA sola pregunta.
Si el cliente pregunta poco, respondés con lo más relevante. Si profundiza, profundizás vos también.
Si el cliente saluda, saludás y preguntás en qué podés ayudar, sin presentarte.
Si quiere hacer un pedido o hablar con alguien, le decís que contacte al 76317951 (Solo WhatsAPP).
SOLO usás info del catálogo y la información del negocio. Si un producto no está en el catálogo, no inventés precio ni características — decí que vas a consultar y que escriban al 76317951 (Solo WhatsAPP).
NUNCA inventés palabras clave — solo usás exactamente las definidas en FOLLETOS-IMAGENES DISPONIBLES.
INFORMACIÓN DEL NEGOCIO:
- Hacemos envíos a todo el país.
- Fábrica propia en Santa Cruz de la Sierra — solo para clasificadoras, picadoras y zarandas.
- Los molinos NO son fabricación propia. Son importados, marca TRAPP, industria brasilera. NUNCA digas que fabricamos molinos.
- HORARIO: atendemos lunes a viernes de 7:00 a 11:00. Sábados, domingos y feriados no atendemos.
- Hoy es ${diaActual}. Hoy ${hoyAtiende ? 'SÍ atendemos' : 'NO atendemos'}.
- Mañana es ${diaManana}. Mañana ${mananaAtiende ? 'SÍ atendemos' : 'NO atendemos'}.
- NUNCA calcules días vos mismo — usá solo los datos de arriba para responder si atendemos hoy, mañana o cualquier día.
- Si el cliente pregunta por un día específico de la semana (ej: "el lunes atienden?"), respondé según si ese día es laborable (lunes a viernes) o no (sábado/domingo).
- Si el cliente pregunta por ubicación, dirección, dónde están, cómo llegar, dónde queda, o cualquier variante, respondé primero con un mensaje breve indicando cómo identificar el lugar y luego escribí [ENVIAR_UBICACION]
- Si no hay stock, decí cordialmente que estamos fabricando y que para consultar tiempos de entrega escriban al 76317951.
- Los molinos no incluyen motor. No vendemos motores para molinos.
- No tenemos fotos de las picadoras en este momento.
- Las zarandas manuales se identifican con códigos CM (CM-07, CM-08, etc.).
FOLLETOS-IMAGENES DISPONIBLES:
- Clasificadora CG-3 o CG-3E: [FOLLETO_CLASIFICADORA]
- Medidor de humedad MH-5: [FOLLETO_MH5]
- Zarandas manuales: [FOLLETO_ZARANDA]
- Molinos: [FOLLETO_MOLINOS]
CATÁLOGO DE EQUIPOS:
${getCatalogoTexto()}`;
}

const conversaciones = {};

// ── HELPERS ───────────────────────────────────────────────────────────────
function truncateConversation(from) {
  if (!conversaciones[from]) return;
  if (conversaciones[from].length > 20)
    conversaciones[from] = conversaciones[from].slice(-20);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;').replace(/\n/g, '<br>');
}

function escapeAttr(value) {
  return String(value ?? '').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function extractMetaMessageId(result) {
  return result?.messages?.[0]?.id || null;
}

function toGMTMinus4(isoString) {
  if (!isoString) return { fecha: '', hora: '' };
  const d = new Date(isoString);
  const local = new Date(d.getTime() - 4 * 60 * 60 * 1000);
  const fecha = local.toISOString().slice(0, 10);
  const hora  = local.toISOString().slice(11, 16);
  return { fecha, hora };
}

function fechaLegible(yyyy_mm_dd) {
  const [y, m, d] = yyyy_mm_dd.split('-');
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  return `${parseInt(d)} de ${meses[parseInt(m)-1]} de ${y}`;
}

// ── RUTAS WEB (INBOX Y ADMIN) ──────────────────────────────────────────────
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.get('/', (req, res) => res.redirect('/inbox'));

app.get('/inbox', (req, res) => {
  const chats = getChats();
  const grupos = {};
  for (const chat of chats) {
    const { fecha } = toGMTMinus4(chat.last_message_at);
    if (!grupos[fecha]) grupos[fecha] = [];
    grupos[fecha].push(chat);
  }
  const diasOrdenados = Object.keys(grupos).sort((a, b) => b.localeCompare(a));

  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Bandeja WhatsApp</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;background:#f0f2f5;min-height:100vh}.header{background:#075e54;color:#fff;padding:14px 20px;display:flex;align-items:center;justify-content:space-between}.header h1{font-size:18px}.header a{color:#fff;text-decoration:none;background:rgba(255,255,255,.2);padding:7px 14px;border-radius:6px;font-size:13px}.container{max-width:700px;margin:20px auto;padding:0 12px}.day-group{margin-bottom:16px;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.12)}.day-header{background:#fff;padding:12px 16px;cursor:pointer;display:flex;justify-content:space-between;border-bottom:1px solid #eee}.day-body{background:#fff;display:none}.day-body.open{display:block}.chat-row{padding:12px 16px;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;gap:12px;text-decoration:none;color:inherit}.avatar{width:42px;height:42px;border-radius:50%;background:#25D366;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700}.chat-info{flex:1;min-width:0}.chat-name{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.chat-time{font-size:11px;color:#aaa}</style></head><body><div class="header"><div><h1>📋 Bandeja WhatsApp</h1><small>Agente SIC — Gemini 1.5</small></div><a href="/admin">⚙️ Catálogo</a></div><div class="container">`;
  if (!diasOrdenados.length) { html += `<div style="text-align:center;padding:40px;color:#aaa">Sin conversaciones.</div>`; } else {
    for (const dia of diasOrdenados) {
      const chatsDelDia = grupos[dia];
      const esHoy = dia === toGMTMinus4(new Date().toISOString()).fecha;
      const grupoId = `g_${dia.replace(/-/g, '')}`;
      html += `<div class="day-group"><div class="day-header" onclick="document.getElementById('${grupoId}').classList.toggle('open')"><span style="font-weight:bold">${fechaLegible(dia)}</span><span>${chatsDelDia.length}</span></div><div class="day-body ${esHoy?'open':''}" id="${grupoId}">`;
      for (const chat of chatsDelDia) {
        const nombre = chat.name || chat.wa_id;
        const { hora } = toGMTMinus4(chat.last_message_at);
        html += `<a class="chat-row" href="/chat/${encodeURIComponent(chat.wa_id)}"><div class="avatar">${nombre[0]}</div><div class="chat-info"><div class="chat-name">${escapeHtml(nombre)}</div><div style="font-size:12px;color:#888">+${chat.wa_id}</div></div><div class="chat-time">${hora}</div></a>`;
      }
      html += `</div></div>`;
    }
  }
  html += `</div></body></html>`;
  res.send(html);
});

app.get('/chat/:wa_id', (req, res) => {
  const waId = req.params.wa_id;
  const messages = getMessages(waId);
  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Chat</title><style>body{font-family:Arial,sans-serif;background:#e5ddd5;display:flex;flex-direction:column;height:100vh}.header{background:#075e54;color:#fff;padding:12px;display:flex;align-items:center;gap:10px}.messages{flex:1;overflow-y:auto;padding:15px;display:flex;flex-direction:column;gap:10px}.bubble{max-width:80%;padding:8px 12px;border-radius:10px;font-size:14px}.in{background:#fff;align-self:flex-start}.out{background:#dcf8c6;align-self:flex-end}.reply-box{background:#f0f0f0;padding:10px;display:flex;gap:10px}textarea{flex:1;border-radius:20px;padding:10px;border:1px solid #ccc;resize:none}</style></head><body><div class="header"><a href="/inbox" style="color:#fff;text-decoration:none">←</a> <span>+${waId}</span></div><div class="messages">`;
  for(const m of messages) {
    const dir = m.direction === 'out' ? 'out' : 'in';
    html += `<div class="bubble ${dir}">${escapeHtml(m.text)}</div>`;
  }
  html += `</div><form class="reply-box" method="post" action="/reply/${waId}"><textarea name="text" rows="1"></textarea><button type="submit">Enviar</button></form><script>const m=document.querySelector('.messages');m.scrollTop=m.scrollHeight;</script></body></html>`;
  res.send(html);
});

app.post('/reply/:wa_id', async (req, res) => {
  const waId = req.params.wa_id;
  const text = (req.body.text || '').trim();
  if (text) {
    const result = await enviarMensaje(waId, text);
    saveOutgoing({ waId, text, metaMessageId: extractMetaMessageId(result), status: 'sent' });
    if (!conversaciones[waId]) conversaciones[waId] = [];
    conversaciones[waId].push({ role: 'assistant', content: text });
    truncateConversation(waId);
  }
  res.redirect(`/chat/${waId}`);
});

// ── ADMIN CATÁLOGO (Rutas simplificadas) ──────────────────────────────────
app.get('/admin', (req, res) => {
  const items = getCatalogo();
  res.send(`<h1>Admin Catálogo</h1><a href="/inbox">Volver</a><ul>` + items.map(i => `<li>${i.nombre} - ${i.precio} <form method="post" action="/admin/eliminar" style="display:inline"><input type="hidden" name="id" value="${i.id}"><button>X</button></form></li>`).join('') + `</ul><hr><form method="post" action="/admin/nuevo"><input name="nombre" placeholder="Nombre" required><input name="precio" placeholder="Precio" required><textarea name="descripcion" required></textarea><button>Agregar</button></form>`);
});

app.post('/admin/nuevo', (req, res) => {
  insertProducto({ nombre: req.body.nombre, precio: req.body.precio, stock: 'SI', descripcion: req.body.descripcion });
  res.redirect('/admin');
});

app.post('/admin/eliminar', (req, res) => {
  deleteProducto(req.body.id);
  res.redirect('/admin');
});

// ── WEBHOOK PRINCIPAL (GEMINI) ─────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const entries = req.body.entry || [];
    for (const entry of entries) {
      for (const change of (entry.changes || [])) {
        const value = change.value || {};
        const messages = value.messages || [];
        const statuses = value.statuses || [];

        for (const st of statuses) { if (st?.id) updateStatus(st.id, st.status); }

        for (const msg of messages) {
          const from = msg.from;
          if (!from) continue;

          if (msg.type !== 'text') {
            const replyText = 'Por ahora solo puedo leer texto. Escribime tu consulta 😊';
            const result = await enviarMensaje(from, replyText);
            saveOutgoing({ waId: from, text: replyText, metaMessageId: extractMetaMessageId(result), status: 'sent' });
            continue;
          }

          const text = msg.text.body;
          saveIncoming({ waId: from, name: value.contacts?.[0]?.profile?.name, text, metaMessageId: msg.id });

          if (!conversaciones[from]) conversaciones[from] = [];
          
          // Configurar Gemini con el prompt dinámico
          const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            systemInstruction: buildSystemPrompt() 
          });

          // Iniciar Chat con historial formateado para Gemini
          const chat = model.startChat({
            history: conversaciones[from].map(m => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }],
            })),
          });

          const result = await chat.sendMessage(text);
          const response = await result.response;
          let reply = response.text();

          // Guardar historial
          conversaciones[from].push({ role: 'user', content: text });
          conversaciones[from].push({ role: 'assistant', content: reply });
          truncateConversation(from);

          // Lógica de disparadores (Ubicación y Folletos)
          if (reply.includes('[ENVIAR_UBICACION]')) {
            const texto = reply.replace('[ENVIAR_UBICACION]', '').trim();
            if (texto) { const r = await enviarMensaje(from, texto); saveOutgoing({ waId: from, text: texto, metaMessageId: extractMetaMessageId(r), status: 'sent' }); }
            const r2 = await enviarUbicacion(from);
            saveOutgoing({ waId: from, text: '[Ubicación]', metaMessageId: extractMetaMessageId(r2), status: 'sent' });

          } else if (reply.includes('[FOLLETO_CLASIFICADORA]')) {
            const r2 = await enviarImagen(from, FOLLETOS.clasificadora);
            saveOutgoing({ waId: from, text: reply, metaMessageId: extractMetaMessageId(r2), status: 'sent' });
          } else if (reply.includes('[FOLLETO_MH5]')) {
            await enviarImagen(from, FOLLETOS.mh5_1);
            await enviarImagen(from, FOLLETOS.mh5_2);
            saveOutgoing({ waId: from, text: reply, metaMessageId: null, status: 'sent' });
          } else if (reply.includes('[FOLLETO_ZARANDA]')) {
            await enviarImagen(from, FOLLETOS.zaranda);
            saveOutgoing({ waId: from, text: reply, metaMessageId: null, status: 'sent' });
          } else if (reply.includes('[FOLLETO_MOLINOS]')) {
            await enviarImagen(from, FOLLETOS.molinos);
            saveOutgoing({ waId: from, text: reply, metaMessageId: null, status: 'sent' });
          } else {
            const r = await enviarMensaje(from, reply);
            saveOutgoing({ waId: from, text: reply, metaMessageId: extractMetaMessageId(r), status: 'sent' });
          }
        }
      }
    }
  } catch (err) {
    console.error('❌ Error en el Webhook:', err);
  }
});

// ── FUNCIONES DE ENVÍO WHATSAPP ──────────────────────────────────────────
async function enviarMensaje(para, texto) {
  const res = await fetch(`https://graph.facebook.com/v18.0/${WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: para, type: 'text', text: { body: texto } })
  });
  return await res.json();
}

async function enviarImagen(para, url) {
  const res = await fetch(`https://graph.facebook.com/v18.0/${WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: para, type: 'image', image: { link: url } })
  });
  return await res.json();
}

async function enviarUbicacion(para) {
  const res = await fetch(`https://graph.facebook.com/v18.0/${WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: para, type: 'location',
      location: { latitude: -17.7516, longitude: -63.1614, name: 'Fábrica de Equipos Agrícolas', address: 'Santa Cruz de la Sierra' }
    })
  });
  return await res.json();
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor en puerto ${PORT}`));
