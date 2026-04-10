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

const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const WA_TOKEN     = process.env.WA_TOKEN;
const WA_PHONE_ID  = process.env.WA_PHONE_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'miagente2024';

const NOTIFICAR_A = '59177626675';

const FOLLETOS = {
  clasificadora: 'https://raw.githubusercontent.com/CabezaKuka/agente-whatsapp/main/CG3-CG3E.png',
  mh5_1:         'https://raw.githubusercontent.com/CabezaKuka/agente-whatsapp/main/MH5-1.png',
  mh5_2:         'https://raw.githubusercontent.com/CabezaKuka/agente-whatsapp/main/MH5-2.png',
  zaranda:       'https://raw.githubusercontent.com/CabezaKuka/agente-whatsapp/main/lista2.png',
  molinos:       'https://raw.githubusercontent.com/CabezaKuka/agente-whatsapp/main/molinos.png',
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
Si quiere hacer un pedido o hablar con alguien, le decís que contacte al 76317951.
SOLO usás info del catálogo y la información del negocio. Si un producto no está en el catálogo, no inventés precio ni características — decí que vas a consultar y que escriban al 76317951.
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
- Si el cliente pregunta por ubicación, dirección, dónde están, cómo llegar, dónde queda, o cualquier variante, respondé primero con un mensaje breve indicando cómo identificar el lugar y luego escribí [ENVIAR_UBICACION]. Ejemplo: "Te mando la ubicación, somos el galpón blanco 🏭 [ENVIAR_UBICACION]"
- Si no hay stock, decí cordialmente que estamos fabricando y que para consultar tiempos de entrega escriban al 76317951. No ofrezcas contactarlos vos, el cliente es quien debe escribir.
- Los molinos no incluyen motor.
- No tenemos fotos de las picadoras en este momento.
- Los molinos son importados, marca TRAPP, industria brasilera.
- Las zarandas manuales se identifican con códigos CM seguido de un número (CM-07, CM-08, CM-12, etc.). Cualquier consulta sobre un código CM es una zaranda manual — respondé con precio y características de zarandas directamente.
FOLLETOS-IMAGENES DISPONIBLES — solo estas 4 palabras clave existen, no inventés otras:
- Clasificadora CG-3 o CG-3E: [FOLLETO_CLASIFICADORA]
- Medidor de humedad MH-5: [FOLLETO_MH5]
- Zarandas manuales: [FOLLETO_ZARANDA]
- Molinos (importados, marca TRAPP, industria brasilera): [FOLLETO_MOLINOS]
Ejemplo: "Te mando la ficha 👇 [FOLLETO_CLASIFICADORA]"
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
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\n/g, '<br>');
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
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  return `${parseInt(d)} de ${meses[parseInt(m)-1]} de ${y}`;
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

// ── BANDEJA ───────────────────────────────────────────────────────────────
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

  let html = `<!DOCTYPE html>
<html><head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Bandeja WhatsApp</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;background:#f0f2f5;min-height:100vh}
    .header{background:#075e54;color:#fff;padding:14px 20px;display:flex;align-items:center;justify-content:space-between}
    .header h1{font-size:18px;font-weight:600}
    .header small{font-size:12px;opacity:.75;display:block}
    .header a{color:#fff;text-decoration:none;background:rgba(255,255,255,.2);padding:7px 14px;border-radius:6px;font-size:13px;font-weight:600}
    .header a:hover{background:rgba(255,255,255,.3)}
    .container{max-width:700px;margin:20px auto;padding:0 12px}
    .day-group{margin-bottom:16px;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.12)}
    .day-header{background:#fff;padding:12px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #eee;user-select:none}
    .day-header:hover{background:#f9f9f9}
    .day-title{font-weight:600;font-size:14px;color:#333}
    .day-count{font-size:12px;color:#888}
    .day-arrow{font-size:12px;color:#aaa;transition:transform .2s}
    .day-arrow.open{transform:rotate(180deg)}
    .day-body{background:#fff;display:none}
    .day-body.open{display:block}
    .chat-row{padding:12px 16px;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;gap:12px;text-decoration:none;color:inherit}
    .chat-row:hover{background:#f5f5f5}
    .avatar{width:42px;height:42px;border-radius:50%;background:#25D366;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:16px;flex-shrink:0}
    .chat-info{flex:1;min-width:0}
    .chat-name{font-weight:600;font-size:14px;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .chat-id{font-size:12px;color:#888}
    .chat-time{font-size:11px;color:#aaa;white-space:nowrap}
    .empty{text-align:center;padding:40px;color:#aaa;background:#fff;border-radius:10px}
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>📋 Bandeja WhatsApp</h1>
      <small>Agente SIC — hora GMT-4</small>
    </div>
    <a href="/admin">⚙️ Catálogo</a>
  </div>
  <div class="container">`;

  if (!diasOrdenados.length) {
    html += `<div class="empty">Todavía no hay conversaciones guardadas.</div>`;
  } else {
    for (const dia of diasOrdenados) {
      const chatsDelDia = grupos[dia];
      const esHoy = dia === toGMTMinus4(new Date().toISOString()).fecha;
      const titulodia = esHoy ? `Hoy — ${fechaLegible(dia)}` : fechaLegible(dia);
      const grupoId = `g_${dia.replace(/-/g, '')}`;
      html += `
    <div class="day-group">
      <div class="day-header" onclick="toggle('${grupoId}')">
        <span class="day-title">${titulodia}</span>
        <span style="display:flex;align-items:center;gap:8px">
          <span class="day-count">${chatsDelDia.length} conversación${chatsDelDia.length !== 1 ? 'es' : ''}</span>
          <span class="day-arrow${esHoy ? ' open' : ''}" id="arr_${grupoId}">▼</span>
        </span>
      </div>
      <div class="day-body${esHoy ? ' open' : ''}" id="${grupoId}">`;
      for (const chat of chatsDelDia) {
        const nombre = chat.name || chat.wa_id;
        const inicial = nombre.charAt(0).toUpperCase();
        const { hora } = toGMTMinus4(chat.last_message_at);
        html += `
        <a class="chat-row" href="/chat/${encodeURIComponent(chat.wa_id)}">
          <div class="avatar">${escapeHtml(inicial)}</div>
          <div class="chat-info">
            <div class="chat-name">${escapeHtml(nombre)}</div>
            <div class="chat-id">+${escapeHtml(chat.wa_id)}</div>
          </div>
          <div class="chat-time">${escapeHtml(hora)}</div>
        </a>`;
      }
      html += `</div></div>`;
    }
  }

  html += `
  </div>
  <script>
    function toggle(id) {
      const body = document.getElementById(id);
      const arr  = document.getElementById('arr_' + id);
      const open = body.classList.toggle('open');
      arr.classList.toggle('open', open);
    }
  </script>
</body></html>`;
  res.send(html);
});

// ── CHAT INDIVIDUAL ───────────────────────────────────────────────────────
app.get('/chat/:wa_id', (req, res) => {
  const waId = req.params.wa_id;
  const messages = getMessages(waId);
  const grupos = {};
  for (const msg of messages) {
    const { fecha } = toGMTMinus4(msg.created_at);
    if (!grupos[fecha]) grupos[fecha] = [];
    grupos[fecha].push(msg);
  }
  const dias = Object.keys(grupos).sort();

  let html = `<!DOCTYPE html>
<html><head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Chat ${escapeHtml(waId)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;background:#e5ddd5;min-height:100vh;display:flex;flex-direction:column}
    .header{background:#075e54;color:#fff;padding:12px 16px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:10}
    .back{color:#fff;text-decoration:none;font-size:20px;line-height:1}
    .avatar{width:38px;height:38px;border-radius:50%;background:#25D366;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;flex-shrink:0}
    .header-info .name{font-weight:600;font-size:15px}
    .header-info .num{font-size:12px;opacity:.8}
    .messages{flex:1;padding:12px 16px;display:flex;flex-direction:column;gap:4px;max-width:700px;margin:0 auto;width:100%}
    .day-sep{text-align:center;margin:12px 0}
    .day-sep span{background:#fff;border-radius:8px;padding:4px 12px;font-size:12px;color:#666;box-shadow:0 1px 2px rgba(0,0,0,.1)}
    .bubble-wrap{display:flex}
    .bubble-wrap.out{justify-content:flex-end}
    .bubble{max-width:72%;padding:8px 12px;border-radius:12px;font-size:14px;line-height:1.5;word-wrap:break-word}
    .bubble.in{background:#fff;border-radius:2px 12px 12px 12px}
    .bubble.out{background:#dcf8c6;border-radius:12px 2px 12px 12px}
    .bubble-time{font-size:11px;color:#999;margin-top:4px;text-align:right}
    .reply-box{background:#fff;padding:12px 16px;border-top:1px solid #ddd;max-width:700px;margin:0 auto;width:100%}
    .reply-box textarea{width:100%;padding:10px;border:1px solid #ccc;border-radius:8px;resize:none;font-size:14px;font-family:Arial,sans-serif}
    .reply-box button{margin-top:8px;padding:10px 20px;border:none;border-radius:8px;background:#25D366;color:#111;font-weight:bold;cursor:pointer;font-size:14px}
    .reply-box button:hover{background:#1ebe57}
  </style>
</head>
<body>
  <div class="header">
    <a class="back" href="/inbox">←</a>
    <div class="avatar">${escapeHtml((waId).charAt(0))}</div>
    <div class="header-info">
      <div class="name">+${escapeHtml(waId)}</div>
      <div class="num">WhatsApp</div>
    </div>
  </div>
  <div class="messages">`;

  if (!dias.length) {
    html += `<div style="text-align:center;color:#888;padding:40px">No hay mensajes guardados.</div>`;
  } else {
    for (const dia of dias) {
      html += `<div class="day-sep"><span>${fechaLegible(dia)}</span></div>`;
      for (const msg of grupos[dia]) {
        const dir = msg.direction === 'out' ? 'out' : 'in';
        const { hora } = toGMTMinus4(msg.created_at);
        const status = msg.status && dir === 'out' ? ` · ${escapeHtml(msg.status)}` : '';
        html += `
    <div class="bubble-wrap ${dir}">
      <div class="bubble ${dir}">
        <div>${escapeHtml(msg.text || '[sin texto]')}</div>
        <div class="bubble-time">${hora}${status}</div>
      </div>
    </div>`;
      }
    }
  }

  html += `
  </div>
  <div class="reply-box">
    <form method="post" action="/reply/${encodeURIComponent(waId)}">
      <textarea name="text" rows="3" placeholder="Escribí una respuesta manual..."></textarea>
      <button type="submit">Enviar</button>
    </form>
  </div>
  <script>window.scrollTo(0, document.body.scrollHeight);</script>
</body></html>`;
  res.send(html);
});

// ── REPLY MANUAL ──────────────────────────────────────────────────────────
app.post('/reply/:wa_id', async (req, res) => {
  const waId = req.params.wa_id;
  const text = (req.body.text || '').trim();
  if (!text) return res.redirect(`/chat/${encodeURIComponent(waId)}`);
  try {
    const result = await enviarMensaje(waId, text);
    const metaMessageId = extractMetaMessageId(result);
    saveOutgoing({ waId, text, metaMessageId, status: 'sent' });
    if (!conversaciones[waId]) conversaciones[waId] = [];
    conversaciones[waId].push({ role: 'assistant', content: text });
    truncateConversation(waId);
    return res.redirect(`/chat/${encodeURIComponent(waId)}`);
  } catch (err) {
    console.error('❌ Error enviando respuesta manual:', err.message);
    return res.status(500).send('Error enviando mensaje manual');
  }
});

// ── ADMIN CATÁLOGO ────────────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  const items = getCatalogo();
  const msg = req.query.msg || '';

  let html = `<!DOCTYPE html>
<html><head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Catálogo — Admin</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;background:#f0f2f5;min-height:100vh}
    .header{background:#075e54;color:#fff;padding:14px 20px;display:flex;align-items:center;justify-content:space-between}
    .header h1{font-size:18px;font-weight:600}
    .header a{color:#fff;text-decoration:none;background:rgba(255,255,255,.2);padding:7px 14px;border-radius:6px;font-size:13px}
    .header a:hover{background:rgba(255,255,255,.3)}
    .container{max-width:900px;margin:20px auto;padding:0 12px}
    .alert{background:#d4edda;color:#155724;border:1px solid #c3e6cb;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:14px}
    .card{background:#fff;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.12);margin-bottom:16px;overflow:hidden}
    .card-header{background:#f8f9fa;padding:12px 16px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center}
    .card-header h2{font-size:15px;color:#333}
    .stock-si{color:#28a745;font-weight:700;font-size:12px;background:#d4edda;padding:2px 8px;border-radius:10px}
    .stock-no{color:#dc3545;font-weight:700;font-size:12px;background:#f8d7da;padding:2px 8px;border-radius:10px}
    .card-body{padding:16px}
    .precio{font-size:18px;font-weight:700;color:#075e54;margin-bottom:8px}
    .desc{font-size:13px;color:#555;line-height:1.5;margin-bottom:14px}
    .btn-row{display:flex;gap:8px}
    .btn{padding:7px 16px;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-weight:600}
    .btn-edit{background:#075e54;color:#fff}
    .btn-edit:hover{background:#064d45}
    .btn-del{background:#dc3545;color:#fff}
    .btn-del:hover{background:#c82333}
    .new-card{background:#fff;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.12);padding:20px;margin-bottom:24px}
    .new-card h2{font-size:15px;color:#333;margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid #eee}
    .form-group{margin-bottom:14px}
    .form-group label{display:block;font-size:12px;font-weight:600;color:#555;margin-bottom:5px;text-transform:uppercase}
    .form-group input,.form-group textarea,.form-group select{width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px;font-family:Arial,sans-serif}
    .form-group textarea{resize:vertical;min-height:80px}
    .form-group input:focus,.form-group textarea:focus,.form-group select:focus{outline:none;border-color:#075e54}
    .btn-save{background:#075e54;color:#fff;padding:10px 24px;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;width:100%}
    .btn-save:hover{background:#064d45}
    .modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100;align-items:center;justify-content:center}
    .modal-overlay.open{display:flex}
    .modal{background:#fff;border-radius:12px;padding:24px;width:90%;max-width:560px;max-height:90vh;overflow-y:auto}
    .modal h2{font-size:16px;margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid #eee}
    .modal-btns{display:flex;gap:8px;margin-top:16px}
    .btn-cancel{background:#eee;color:#333;padding:9px 20px;border:none;border-radius:6px;font-size:14px;cursor:pointer;font-weight:600}
  </style>
</head>
<body>
  <div class="header">
    <h1>⚙️ Gestión de Catálogo</h1>
    <a href="/inbox">← Bandeja</a>
  </div>
  <div class="container">`;

  if (msg) html += `<div class="alert">✅ ${escapeHtml(msg)}</div>`;

  // Formulario nuevo producto
  html += `
    <div class="new-card">
      <h2>➕ Agregar nuevo equipo</h2>
      <form method="post" action="/admin/nuevo">
        <div class="form-group">
          <label>Nombre del equipo</label>
          <input type="text" name="nombre" required placeholder="Ej: MOLINO 30 MARTILLOS">
        </div>
        <div class="form-group">
          <label>Precio</label>
          <input type="text" name="precio" required placeholder="Ej: 5.000 Bolivianos">
        </div>
        <div class="form-group">
          <label>Stock</label>
          <select name="stock">
            <option value="SI">SI — Disponible</option>
            <option value="NO">NO — Fabricando</option>
          </select>
        </div>
        <div class="form-group">
          <label>Descripción</label>
          <textarea name="descripcion" required placeholder="Características, especificaciones, usos..."></textarea>
        </div>
        <button type="submit" class="btn-save">Guardar equipo</button>
      </form>
    </div>

    <div class="new-card">
      <h2>📦 Equipos actuales (${items.length})</h2>
    </div>`;

  // Lista de productos
  for (const item of items) {
    html += `
    <div class="card">
      <div class="card-header">
        <h2>${escapeHtml(item.nombre)}</h2>
        <span class="stock-${item.stock.toLowerCase()}">${escapeHtml(item.stock) === 'SI' ? '✓ En stock' : '✗ Fabricando'}</span>
      </div>
      <div class="card-body">
        <div class="precio">${escapeHtml(item.precio)}</div>
        <div class="desc">${escapeHtml(item.descripcion)}</div>
        <div class="btn-row">
          <button class="btn btn-edit" onclick="abrirEditor(${item.id}, '${escapeAttr(item.nombre)}', '${escapeAttr(item.precio)}', '${escapeAttr(item.stock)}', '${escapeAttr(item.descripcion)}')">✏️ Editar</button>
          <form method="post" action="/admin/eliminar" style="display:inline" onsubmit="return confirm('¿Eliminar ${escapeAttr(item.nombre)}?')">
            <input type="hidden" name="id" value="${item.id}">
            <button type="submit" class="btn btn-del">🗑 Eliminar</button>
          </form>
        </div>
      </div>
    </div>`;
  }

  // Modal de edición
  html += `
  </div>

  <div class="modal-overlay" id="modalOverlay">
    <div class="modal">
      <h2>✏️ Editar equipo</h2>
      <form method="post" action="/admin/editar">
        <input type="hidden" name="id" id="editId">
        <div class="form-group">
          <label>Nombre del equipo</label>
          <input type="text" name="nombre" id="editNombre" required>
        </div>
        <div class="form-group">
          <label>Precio</label>
          <input type="text" name="precio" id="editPrecio" required>
        </div>
        <div class="form-group">
          <label>Stock</label>
          <select name="stock" id="editStock">
            <option value="SI">SI — Disponible</option>
            <option value="NO">NO — Fabricando</option>
          </select>
        </div>
        <div class="form-group">
          <label>Descripción</label>
          <textarea name="descripcion" id="editDesc" required></textarea>
        </div>
        <div class="modal-btns">
          <button type="submit" class="btn-save" style="flex:1">Guardar cambios</button>
          <button type="button" class="btn-cancel" onclick="cerrarEditor()">Cancelar</button>
        </div>
      </form>
    </div>
  </div>

  <script>
    function abrirEditor(id, nombre, precio, stock, desc) {
      document.getElementById('editId').value = id;
      document.getElementById('editNombre').value = nombre;
      document.getElementById('editPrecio').value = precio;
      document.getElementById('editStock').value = stock;
      document.getElementById('editDesc').value = desc;
      document.getElementById('modalOverlay').classList.add('open');
    }
    function cerrarEditor() {
      document.getElementById('modalOverlay').classList.remove('open');
    }
    document.getElementById('modalOverlay').addEventListener('click', function(e) {
      if (e.target === this) cerrarEditor();
    });
  </script>
</body></html>`;

  res.send(html);
});

app.post('/admin/editar', (req, res) => {
  const { id, nombre, precio, stock, descripcion } = req.body;
  if (!id || !nombre || !precio || !descripcion) return res.redirect('/admin?msg=Error+faltan+datos');
  updateProducto({ id, nombre: nombre.trim(), precio: precio.trim(), stock: stock || 'SI', descripcion: descripcion.trim() });
  res.redirect('/admin?msg=Equipo+actualizado+correctamente');
});

app.post('/admin/nuevo', (req, res) => {
  const { nombre, precio, stock, descripcion } = req.body;
  if (!nombre || !precio || !descripcion) return res.redirect('/admin?msg=Error+faltan+datos');
  insertProducto({ nombre: nombre.trim(), precio: precio.trim(), stock: stock || 'SI', descripcion: descripcion.trim() });
  res.redirect('/admin?msg=Equipo+agregado+correctamente');
});

app.post('/admin/eliminar', (req, res) => {
  const { id } = req.body;
  if (!id) return res.redirect('/admin');
  deleteProducto(id);
  res.redirect('/admin?msg=Equipo+eliminado');
});

// ── WEBHOOK ───────────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const entries = req.body.entry || [];
    for (const entry of entries) {
      for (const change of (entry.changes || [])) {
        const value = change.value || {};
        const contacts = value.contacts || [];
        const messages = value.messages || [];
        const statuses = value.statuses || [];
        const contactName = contacts[0]?.profile?.name || null;

        for (const st of statuses) {
          if (st?.id && st?.status) updateStatus(st.id, st.status);
        }

        for (const msg of messages) {
          const from = msg.from;
          const messageId = msg.id;
          if (!from) continue;

          if (msg.type === 'audio') {
            saveIncoming({ waId: from, name: contactName, text: '[Audio recibido]', metaMessageId: messageId });
            const replyText = 'En este momento no puedo escuchar audios. Escribime tu consulta y te respondo enseguida 😊';
            const result = await enviarMensaje(from, replyText);
            saveOutgoing({ waId: from, text: replyText, metaMessageId: extractMetaMessageId(result), status: 'sent' });
            await enviarMensaje(NOTIFICAR_A, `🎤 Audio recibido de +${from}`);
            continue;
          }

          if (msg.type !== 'text') {
            saveIncoming({ waId: from, name: contactName, text: `[Mensaje ${msg.type || 'no soportado'} recibido]`, metaMessageId: messageId });
            const replyText = 'Solo puedo responder mensajes de texto por ahora. Escribime tu consulta 😊';
            const result = await enviarMensaje(from, replyText);
            saveOutgoing({ waId: from, text: replyText, metaMessageId: extractMetaMessageId(result), status: 'sent' });
            continue;
          }

          const text = msg.text?.body || '';
          console.log(`📩 Mensaje de ${from}: ${text}`);
          saveIncoming({ waId: from, name: contactName, text, metaMessageId: messageId });

          if (!conversaciones[from]) conversaciones[from] = [];
          conversaciones[from].push({ role: 'user', content: text });
          truncateConversation(from);

          // Construir prompt con catálogo actualizado desde DB
          const systemPrompt = buildSystemPrompt();

          const respuesta = await ai.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 500,
            system: systemPrompt,
            messages: conversaciones[from]
          });

          let reply = respuesta.content?.[0]?.text || 'Perdón, no pude responder bien. Escribime de nuevo por favor.';
          conversaciones[from].push({ role: 'assistant', content: reply });
          truncateConversation(from);

          if (reply.includes('[ENVIAR_UBICACION]')) {
            const texto = reply.replace('[ENVIAR_UBICACION]', '').trim();
            if (texto) { const r = await enviarMensaje(from, texto); saveOutgoing({ waId: from, text: texto, metaMessageId: extractMetaMessageId(r), status: 'sent' }); }
            const r2 = await enviarUbicacion(from);
            saveOutgoing({ waId: from, text: '[Ubicación enviada]', metaMessageId: extractMetaMessageId(r2), status: 'sent' });

          } else if (reply.includes('[FOLLETO_CLASIFICADORA]')) {
            const texto = reply.replace('[FOLLETO_CLASIFICADORA]', '').trim();
            if (texto) { const r = await enviarMensaje(from, texto); saveOutgoing({ waId: from, text: texto, metaMessageId: extractMetaMessageId(r), status: 'sent' }); }
            const r2 = await enviarImagen(from, FOLLETOS.clasificadora);
            saveOutgoing({ waId: from, text: '[Imagen: folleto clasificadora]', metaMessageId: extractMetaMessageId(r2), status: 'sent' });

          } else if (reply.includes('[FOLLETO_MH5]')) {
            const texto = reply.replace('[FOLLETO_MH5]', '').trim();
            if (texto) { const r = await enviarMensaje(from, texto); saveOutgoing({ waId: from, text: texto, metaMessageId: extractMetaMessageId(r), status: 'sent' }); }
            const r1 = await enviarImagen(from, FOLLETOS.mh5_1);
            saveOutgoing({ waId: from, text: '[Imagen: MH5 1]', metaMessageId: extractMetaMessageId(r1), status: 'sent' });
            const r2 = await enviarImagen(from, FOLLETOS.mh5_2);
            saveOutgoing({ waId: from, text: '[Imagen: MH5 2]', metaMessageId: extractMetaMessageId(r2), status: 'sent' });

          } else if (reply.includes('[FOLLETO_ZARANDA]')) {
            const texto = reply.replace('[FOLLETO_ZARANDA]', '').trim();
            if (texto) { const r = await enviarMensaje(from, texto); saveOutgoing({ waId: from, text: texto, metaMessageId: extractMetaMessageId(r), status: 'sent' }); }
            const r2 = await enviarImagen(from, FOLLETOS.zaranda);
            saveOutgoing({ waId: from, text: '[Imagen: folleto zaranda]', metaMessageId: extractMetaMessageId(r2), status: 'sent' });
         
          } else if (reply.includes('[FOLLETO_MOLINOS]')) {
            const texto = reply.replace('[FOLLETO_MOLINOS]', '').trim();
            if (texto) { const r = await enviarMensaje(from, texto); saveOutgoing({ waId: from, text: texto, metaMessageId: extractMetaMessageId(r), status: 'sent' }); }
            const r2 = await enviarImagen(from, FOLLETOS.molinos);
            saveOutgoing({ waId: from, text: '[Imagen: folleto molinos]', metaMessageId: extractMetaMessageId(r2), status: 'sent' });
            
          } else {
            const r = await enviarMensaje(from, reply);
            saveOutgoing({ waId: from, text: reply, metaMessageId: extractMetaMessageId(r), status: 'sent' });
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
    headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: para, type: 'text', text: { body: texto } })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function enviarUbicacion(para) {
  const res = await fetch(`https://graph.facebook.com/v18.0/${WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: para, type: 'location',
      location: { latitude: -17.748285, longitude: -63.133169, name: 'Servicio Industrial Cruceño - SIC', address: 'sexto anillo, parque industrial, Santa Cruz de la Sierra, Bolivia' }
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function enviarImagen(para, url) {
  const res = await fetch(`https://graph.facebook.com/v18.0/${WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: para, type: 'image', image: { link: url } })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor activo en puerto ${PORT}`));
