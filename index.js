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
  getMessagesDesde,
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

// ── MODELO DE CLAUDE (seleccionable desde /admin) ──────────────────────────
const MODELOS = {
  haiku:  'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
};
let modeloActivo = 'haiku'; // valor por defecto al iniciar el servidor

const NOTIFICAR_A = '59177626675';

// ── FLAGS POR NÚMERO (persistente en disco, NO depende de cambios en db.js) ─
// Para recordar cosas como "ya le mandé el link demo" o "ya avisé que es lead
// caliente" de forma que sobreviva a un redeploy, sin requerir tocar la base
// de datos ni mantener dos archivos sincronizados.
const fs = require('fs');
const FLAGS_DIR  = '/app/data';
const FLAGS_PATH = `${FLAGS_DIR}/flags.json`;
let flags = {};
try {
  fs.mkdirSync(FLAGS_DIR, { recursive: true });
  flags = JSON.parse(fs.readFileSync(FLAGS_PATH, 'utf8'));
} catch (err) {
  flags = {}; // primera vez, archivo no existe todavía — no es un error real
}

function tieneFlag(waId, flag) {
  return !!(flags[waId] && flags[waId][flag]);
}

function marcarFlag(waId, flag) {
  if (!flags[waId]) flags[waId] = {};
  flags[waId][flag] = true;
  try {
    fs.writeFileSync(FLAGS_PATH, JSON.stringify(flags));
  } catch (err) {
    console.error('❌ Error guardando flags.json (no crítico):', err.message);
  }
}

const FOLLETOS = {
  clasificadora: 'https://raw.githubusercontent.com/CabezaKuka/agente-whatsapp/main/CG3-CG3E.png',
  mh5_1:         'https://raw.githubusercontent.com/CabezaKuka/agente-whatsapp/main/MH5-1.png',
  mh5_2:         'https://raw.githubusercontent.com/CabezaKuka/agente-whatsapp/main/MH5-2.png',
  zaranda:       'https://raw.githubusercontent.com/CabezaKuka/agente-whatsapp/main/lista2.png',
  nivel:         'https://raw.githubusercontent.com/CabezaKuka/agente-whatsapp/main/folletoAXIS1.png',
  hiwifi:        'https://raw.githubusercontent.com/CabezaKuka/agente-whatsapp/main/fichaHiWIFI.png',
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
//Sos un vendedor de equipos agrícolas respondiendo por WhatsApp.
  return `Sos un vendedor respondiendo por WhatsApp. Vendés equipos agrícolas y el Nivel Digital para construcción y montaje.
Hoy es ${diaActual} ${fechaActual} (hora Bolivia, GMT-4).
Respondés como una persona real, nunca te identificás como bot ni asistente virtual.
Mensajes MUY cortos — máximo 2 líneas, sin excepción.
En el PRIMER mensaje de cada conversación sé todavía más breve: una frase con el precio y el problema que resuelve (no solo la función técnica), y cerrá con UNA sola pregunta simple y directa para entender qué necesita el cliente. Evitá preguntas con varias opciones para elegir — mejor una pregunta abierta corta que el cliente responda con sus propias palabras. No menciones specs, características adicionales ni casos de uso en ese primer mensaje — guardalos para la respuesta siguiente, una vez que el cliente ya contestó algo.
NUNCA usás guiones, viñetas ni listas. Todo en texto corrido.
Los clientes escriben con ortografía informal, abreviaciones y errores típicos del español boliviano. Interpretá siempre lo que quisieron decir, nunca respondas como si no entendieras.
Si un mensaje del cliente empieza con [Contexto interno: ...], esa parte NO la escribió el cliente: es una nota del sistema que indica desde qué anuncio llegó. Usala para saber de qué producto habla y respondé directo sobre ese producto sin volver a preguntar a cuál se refiere. NUNCA menciones la nota ni el anuncio al cliente.
Cuando preguntan por un equipo, das el precio directo y una característica clave sin preguntar antes.
Si el nombre del producto está mal escrito pero hay una coincidencia obvia en el catálogo, respondé directamente con ese producto, precio y característica clave — nunca preguntes si "te sirve" cuando la intención es clara.
Solo preguntás cuando hay dos o más productos que podrían encajar y necesitás saber cuál, o cuando algo genuinamente no quedó claro. En ese caso hacés UNA sola pregunta.
Al hacer esa pregunta, evitá el formato "encuesta" de listar 3-4 opciones para elegir (ej. "¿depósito, bodega, cámara frigorífica u otro?") — sonás más natural con una pregunta abierta corta (ej. "¿para qué ambiente lo necesitás?"). Variá la forma de preguntar de una conversación a otra, no repitas siempre la misma frase armada. Excepción: cuando el cliente necesita decirte un valor técnico exacto para identificar el producto correcto (por ejemplo calibre de zaranda o código CM), ahí sí podés nombrar los valores disponibles porque es información que el cliente debe conocer, no relleno conversacional.
Si el cliente pregunta poco, respondés con lo más relevante. Si profundiza, profundizás vos también.
Si el cliente saluda, saludás y preguntás en qué podés ayudar, sin presentarte.
VENDER DESPUÉS DE RESPONDER: cuando el cliente hace una pregunta técnica (material, medidas, rango, alimentación, etc.), primero respondé el dato concreto tal como está en el catálogo, y en la misma respuesta agregá un beneficio breve relacionado con ese dato, cerrando con una pregunta que haga avanzar la venta — no una que vuelva a calificar desde cero. Ejemplo: "¿sirve para cámara fría?" → "Sí, mide dentro del rango de tu cámara y te avisa al toque si la temperatura se sale de lo normal. ¿De qué tamaño es tu cámara?". Siempre dentro del límite de 2 líneas.
MODO CIERRE: apenas el cliente muestre intención de compra (dice que quiere comprar, pide cotización o presupuesto, pregunta por envío a su ciudad, menciona cantidades, pide el juego completo), dejá de describir el producto y pasá a concretar: preguntá a qué ciudad sería el envío y cuántas unidades necesita (una o dos preguntas por mensaje, no un interrogatorio). Cuando ya tengas ciudad o cantidad, indicá que el pedido se concreta escribiendo al 76317951 (Solo WhatsAPP).
Si el cliente pide directamente hablar con una persona, ahí sí derivá al 76317951 (Solo WhatsAPP) sin más preguntas.
DERIVAR MENOS: antes de decir que escriban al 76317951, revisá si la respuesta está en el catálogo o en la información del negocio — si está, respondela vos directamente. Derivá solo cuando la información genuinamente no exista acá, o cuando una regla específica de abajo lo indique (mallas fuera de catálogo, conversión de calibres a mm, recomendación de medida por grano, consulta de tiempos de fabricación).
LEAD CALIENTE — aviso interno (no se lo mencionás al cliente): agregá [LEAD_CALIENTE] al final de tu respuesta apenas el cliente use la palabra cotización, cotizar, presupuesto, o factura, o diga explícitamente que quiere comprar o hacer el pedido — ESE PRIMER MENSAJE YA CUENTA, no esperes a que confirme cantidad ni ningún otro dato para agregarlo. También agregalo si menciona una cantidad de unidades (2 o más). Va ADEMÁS de tu respuesta normal al cliente, nunca en su lugar, y el cliente nunca debe ver esa palabra. No la uses para preguntas técnicas generales ni curiosidad sin esas palabras o intención de compra explícita.
SOLO usás info del catálogo y la información del negocio. Si un producto no está en el catálogo, no inventés precio ni características — decí que vas a consultar y que escriban al 76317951 (Solo WhatsAPP).
NUNCA inventés palabras clave — solo usás exactamente las definidas en FOLLETOS-IMAGENES DISPONIBLES.
INFORMACIÓN DEL NEGOCIO:
- Hacemos envíos a todo el país.
- Fábrica propia en Santa Cruz de la Sierra — solo para clasificadoras, picadoras y zarandas.
- HORARIO: atendemos lunes a viernes de 7:00 a 11:00. Sábados, domingos y feriados no atendemos.
- Hoy es ${diaActual}. Hoy ${hoyAtiende ? 'SÍ atendemos' : 'NO atendemos'}.
- Mañana es ${diaManana}. Mañana ${mananaAtiende ? 'SÍ atendemos' : 'NO atendemos'}.
- NUNCA calcules días vos mismo — usá solo los datos de arriba para responder si atendemos hoy, mañana o cualquier día.
- Si el cliente pregunta por un día específico de la semana (ej: "el lunes atienden?"), respondé según si ese día es laborable (lunes a viernes) o no (sábado/domingo).
- Si el cliente pregunta por ubicación, dirección, dónde están, cómo llegar, dónde queda, o cualquier variante, respondé primero con un mensaje breve indicando cómo identificar el lugar y luego escribí [ENVIAR_UBICACION]. Ejemplo: "Te mando la ubicación, somos el galpón blanco 🏭 [ENVIAR_UBICACION]"
- Si no hay stock, decí cordialmente que estamos fabricando y que para consultar tiempos de entrega escriban al 76317951. No ofrezcas contactarlos vos, el cliente es quien debe escribir.
- No tenemos fotos de las picadoras en este momento.
- Las zarandas manuales se identifican con códigos CM seguido de un número (CM-08, CM-1, CM-2X, etc.). Cualquier consulta sobre un código CM es una zaranda manual — respondé con precio y características de zarandas directamente.
- Las medidas exactas de zarandas (redondas, oblongas) están en el CATÁLOGO DE EQUIPOS más abajo. Si preguntan por una medida puntual en mm o por un código CM, respondé directo según esa lista, diciendo si la tenés o no — nunca contestes "tenemos variedad" o "te paso la ficha" ante una pregunta de medida concreta, decí el código y el mm exacto.
- Si preguntan por mallas, tela metálica, perforaciones a medida, planchas con otro espesor, u otra zaranda que no esté en el catálogo: UNA sola frase corta diciendo que eso no está en catálogo y derivá al 76317951 (Solo WhatsApp), sin explicar el motivo técnico. Si el cliente insiste o reformula la misma pregunta, no la reexpliques de nuevo — repetí la misma frase corta.
- ZARANDAS PARA CAFÉ — calibres: si preguntan por calibre de café (12, 13, 14, 15, 16, 17, 18), respondé según los calibres que figuren en el catálogo, diciendo si lo tenés o no. NUNCA conviertas un calibre a milímetros ni des el equivalente en mm, aunque te lo pidan directamente — si insisten con la conversión, decí que para esa equivalencia exacta consulten al 76317951 (Solo WhatsApp).
- NUNCA recomiendes qué medida o código de zaranda conviene para un grano o uso específico (ej. "para sorgo usá la CM-2", "para partido de soya la CM-2.5"), salvo que esa recomendación esté escrita textualmente en el catálogo. Si preguntan qué medida les conviene para algo, no inventes una respuesta técnica — preguntá qué medida o calibre ya saben que necesitan, y si no lo saben, derivá al 76317951 (Solo WhatsApp) para asesoría específica.
- Si preguntan por humedad de granos o semillas contestas con el MH-5, si es para ambientes, depositos, almacenes, centros de datos contestas con HIWIFI.
- Si preguntan específicamente por el higrómetro wifi, el HiWIFI, o cómo ver los datos en vivo, comentá que pueden ver un equipo real funcionando en vivo. El link para verlo se agrega automáticamente la primera vez que se menciona el HiWIFI — no lo escribas vos.
- Si más adelante en la conversación el cliente pide ver el equipo funcionando en vivo otra vez (por ejemplo, le preguntaste si quiere verlo y te dice que sí, o te lo pide directamente), agregá [VER_DEMO] al final de tu respuesta — eso vuelve a mandar el link automáticamente. NUNCA uses [FOLLETO_hiwifi] para esto: esa palabra clave es solo para la ficha técnica en imagen, no es lo mismo que el link en vivo.
- HIWIFI — gancho de primer contacto: la primera vez que el cliente pregunta precio, pide más información, o pide la ficha del HiWIFI, usá siempre exactamente este tono y estructura: saludá con "Hola 👋", explicá que con HiWIFI monitoreás temperatura y humedad desde el celular, que reciben alertas por Telegram si algo se sale de rango y que generás reportes con análisis de IA automáticamente, luego en oración separada el precio (El equipo cuesta 650 Bs.), y cerrá con un salto de línea y UNA pregunta abierta sobre dónde lo usaría. Ejemplo exacto: "Hola 👋 Con HiWIFI monitoreás temperatura y humedad desde el celular, recibís alertas por Telegram si algo se sale de rango y generás reportes con análisis de IA automáticamente. El equipo cuesta 650 Bs.\n¿En qué ambiente lo pensás instalar?" — podés variar la pregunta final ("¿Para qué lo necesitás?", "¿Dónde lo pondrías?") pero nunca con lista de opciones. REGLA DURA: el texto que escribís antes de [FOLLETO_hiwifi] SIEMPRE tiene que incluir el precio (650 Bs) — está PROHIBIDO mandar [FOLLETO_hiwifi] con un texto que no mencione el precio. NO uses la frase "sin instalar nada". No menciones PDF, CSV, gráficos de 7/30 días ni "en tiempo real" en ese primer contacto — eso va recién si el cliente sigue la conversación.
- HIWIFI vs HIWIFI LOGGER — son dos productos distintos, NUNCA los confundas ni mezcles sus descripciones: el HiWIFI necesita la red WiFi del lugar para mandar los datos a internet y así verse desde cualquier parte del mundo. El HiWIFI Logger es lo contrario: NO necesita internet ni WiFi del lugar, genera su propia red WiFi y los datos se ven y descargan con el celular estando cerca del equipo. Está PROHIBIDO decir que el HiWIFI genera su propia red, y PROHIBIDO decir que el Logger manda datos por internet. Si el cliente dice que en su lugar no hay WiFi o no hay internet, ofrecele el Logger.
NIVEL DIGITAL — comportamiento especial:
Cuando pregunten por el nivel, dá precio y beneficio principal en una línea y cerrá con UNA pregunta para continuar la conversación (ej: "¿lo usarías en obra o en soldadura/montaje?"). NUNCA mandés la ficha técnica de entrada — solo si el cliente la pide expresamente o ya mostró interés concreto en comprar. Si objetan con "uso nivel de burbuja" o "lo hago a ojo", respondé con el costo de corregir un error (tiempo, material, mano de obra) sin mencionar features.
FOLLETOS-IMAGENES DISPONIBLES — solo estas 4 palabras clave existen, no inventés otras:
- Clasificadora CG-3 o CG-3E: [FOLLETO_CLASIFICADORA]
- Medidor de humedad MH-5: [FOLLETO_MH5]
- Zarandas manuales: [FOLLETO_ZARANDA]
- Nivel: [FOLLETO_NIVEL]
- HiWIFI: [FOLLETO_hiwifi]
Ejemplo: "Te mando la ficha/foto 👇 [FOLLETO_CLASIFICADORA]"
CATÁLOGO DE EQUIPOS:
${getCatalogoTexto()}`;
}
const conversaciones = {};

// ── REHIDRATACIÓN DE HISTORIAL ────────────────────────────────────────────
// `conversaciones` vive en RAM y se pierde en cada redeploy. Esta función
// reconstruye el historial de un número desde la base de datos (que ya guarda
// todo vía saveIncoming/saveOutgoing), tomando solo los últimos 7 días para
// no revivir conversaciones viejas. Se llama ANTES de guardar el mensaje
// entrante, así el mensaje actual nunca queda duplicado en el historial.
const REHIDRATAR_DIAS = 7;

function rehidratarConversacion(waId) {
  if (conversaciones[waId]) return; // ya hay historial en memoria, no tocar
  conversaciones[waId] = [];
  try {
    const filas = getMessages(waId) || [];
    const corte = Date.now() - REHIDRATAR_DIAS * 24 * 60 * 60 * 1000;
    const historial = [];
    for (const f of filas) {
      const t = new Date(f.created_at).getTime();
      if (!Number.isFinite(t) || t < corte) continue;
      const txt = (f.text || '').trim();
      if (!txt) continue;
      // Saltar placeholders internos tipo [Imagen: ...], [Audio recibido],
      // [Ubicación enviada] — no aportan al contexto y confunden al modelo.
      if (/^\[[^\]]*\]$/.test(txt)) continue;
      const role = f.direction === 'out' ? 'assistant' : 'user';
      const ultimo = historial[historial.length - 1];
      // La API exige roles alternados: si hay dos seguidos del mismo lado
      // (ej. respuesta manual desde /reply después de otra del bot), se unen.
      if (ultimo && ultimo.role === role) ultimo.content += '\n' + txt;
      else historial.push({ role, content: txt });
    }
    // El primer mensaje del historial debe ser del cliente (role user).
    while (historial.length && historial[0].role !== 'user') historial.shift();
    conversaciones[waId] = historial.slice(-20);
    if (conversaciones[waId].length) {
      console.log(`♻️ Historial rehidratado para ${waId}: ${conversaciones[waId].length} entradas (últimos ${REHIDRATAR_DIAS} días)`);
    }
  } catch (err) {
    console.error(`❌ Error rehidratando historial de ${waId} (se sigue sin historial, no es crítico):`, err.message);
    conversaciones[waId] = [];
  }
}

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

// Para atributos data-* que se leen vía JS (dataset), nunca dentro de onclick.
// A diferencia de escapeAttr, esto SÍ escapa saltos de línea (con &#10;) para
// que una descripción multilínea no rompa el atributo HTML.
function escapeDataAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\r\n|\r|\n/g, '&#10;');
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
    .export-form{display:flex;align-items:center;gap:6px}
    .export-form select{border:none;border-radius:6px;padding:6px 8px;font-size:12px;background:rgba(255,255,255,.9);color:#075e54;font-weight:600}
    .export-form button{border:none;background:rgba(255,255,255,.2);color:#fff;padding:7px 12px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer}
    .export-form button:hover{background:rgba(255,255,255,.3)}
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>📋 Bandeja WhatsApp</h1>
      <small>Agente SIC — hora GMT-4</small>
    </div>
    <div style="display:flex;align-items:center;gap:10px">
      <form class="export-form" method="get" action="/admin/exportar">
        <select name="dias">
          <option value="1">Último día</option>
          <option value="2">Últimos 2 días</option>
          <option value="3" selected>Últimos 3 días</option>
          <option value="7">Última semana</option>
        </select>
        <button type="submit">📥 Exportar</button>
      </form>
      <a href="/admin">⚙️ Catálogo</a>
    </div>
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

// ── EXPORTAR CONVERSACIONES (para análisis) ───────────────────────────────
app.get('/admin/exportar', (req, res) => {
  let dias = parseInt(req.query.dias, 10);
  if (!Number.isFinite(dias) || dias < 1) dias = 3;
  if (dias > 30) dias = 30;

  const sinceIso = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
  const filas = getMessagesDesde(sinceIso);

  // Agrupar por wa_id, conservando el orden cronológico ya dado por la consulta
  const porChat = {};
  for (const fila of filas) {
    if (!porChat[fila.wa_id]) porChat[fila.wa_id] = { nombre: fila.name, mensajes: [] };
    if (fila.name) porChat[fila.wa_id].nombre = fila.name; // por si el nombre se actualizó
    porChat[fila.wa_id].mensajes.push(fila);
  }
  const chatIds = Object.keys(porChat);

  const ahoraBolivia = toGMTMinus4(new Date().toISOString());
  const desdeBolivia  = toGMTMinus4(sinceIso);
  const totalMensajes = filas.length;

  let out = '';
  out += `EXPORTACIÓN DE CONVERSACIONES — AGENTE WHATSAPP SIC\n`;
  out += `Generado: ${ahoraBolivia.fecha} ${ahoraBolivia.hora} (hora Bolivia, GMT-4)\n`;
  out += `Rango exportado: últimos ${dias} día${dias === 1 ? '' : 's'} (desde ${desdeBolivia.fecha} ${desdeBolivia.hora})\n`;
  out += `Conversaciones: ${chatIds.length} | Mensajes totales: ${totalMensajes}\n`;
  out += `${'='.repeat(64)}\n\n`;

  if (!chatIds.length) {
    out += '(No hay mensajes guardados en este período)\n';
  }

  for (const waId of chatIds) {
    const chat = porChat[waId];
    const nombre = chat.nombre || '(sin nombre)';
    out += `${'='.repeat(64)}\n`;
    out += `CONVERSACIÓN: +${waId} — ${nombre}\n`;
    out += `${'='.repeat(64)}\n`;
    for (const m of chat.mensajes) {
      const { fecha, hora } = toGMTMinus4(m.created_at);
      const quien = m.direction === 'out' ? 'BOT/VENDEDOR' : 'CLIENTE';
      const estado = (m.direction === 'out' && m.status) ? ` [${m.status}]` : '';
      const texto = (m.text || '[sin texto]').replace(/\n/g, ' ');
      out += `[${fecha} ${hora}] ${quien}${estado}: ${texto}\n`;
    }
    out += `\n`;
  }

  const nombreArchivo = `conversaciones_${dias}dias_${ahoraBolivia.fecha}.txt`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
  res.send(out);
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
    // Rehidratar primero por si la RAM está vacía (ej. después de un redeploy),
    // y agregar la respuesta manual sin romper la alternancia de roles que
    // exige la API: si el último turno ya es del assistant, se fusionan.
    rehidratarConversacion(waId);
    const historialReply = conversaciones[waId];
    const ultimoReply = historialReply[historialReply.length - 1];
    if (ultimoReply && ultimoReply.role === 'assistant') {
      ultimoReply.content += '\n' + text;
    } else if (historialReply.length) {
      historialReply.push({ role: 'assistant', content: text });
    }
    // Si el historial quedó vacío (cliente sin mensajes en 7 días), no se
    // agrega nada: la API no acepta que la conversación empiece en assistant.
    // El mensaje ya quedó en la DB y se recuperará cuando el cliente escriba.
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

  // Selector de modelo de Claude
  html += `
    <div class="new-card">
      <h2>🤖 Modelo de Claude</h2>
      <form method="post" action="/admin/modelo">
        <div class="form-group">
          <label>Modelo que responde en WhatsApp</label>
          <select name="modelo">
            <option value="haiku"${modeloActivo === 'haiku' ? ' selected' : ''}>Haiku — rápido y económico</option>
            <option value="sonnet"${modeloActivo === 'sonnet' ? ' selected' : ''}>Sonnet — más preciso</option>
          </select>
        </div>
        <button type="submit" class="btn-save">Guardar modelo</button>
      </form>
    </div>`;

  // Formulario nuevo producto
  html += `
    <div class="new-card">
      <h2>➕ Agregar nuevo equipo</h2>
      <form method="post" action="/admin/nuevo">
        <div class="form-group">
          <label>Nombre del equipo</label>
          <input type="text" name="nombre" required placeholder="Ej: ZARANDA MANUAL CM-10">
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
          <button class="btn btn-edit" data-id="${item.id}" data-nombre="${escapeDataAttr(item.nombre)}" data-precio="${escapeDataAttr(item.precio)}" data-stock="${escapeDataAttr(item.stock)}" data-desc="${escapeDataAttr(item.descripcion)}">✏️ Editar</button>
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
    // Engancha cada botón "Editar" leyendo sus data-* en vez de pasar los
    // datos crudos dentro de un onclick (eso se rompía con descripciones
    // multilínea o con apóstrofes).
    document.querySelectorAll('.btn-edit').forEach(function (btn) {
      btn.addEventListener('click', function () {
        abrirEditor(
          this.dataset.id,
          this.dataset.nombre,
          this.dataset.precio,
          this.dataset.stock,
          this.dataset.desc
        );
      });
    });
  </script>
</body></html>`;

  res.send(html);
});

app.post('/admin/modelo', (req, res) => {
  const { modelo } = req.body;
  if (!MODELOS[modelo]) return res.redirect('/admin?msg=Error+modelo+invalido');
  modeloActivo = modelo;
  res.redirect(`/admin?msg=Modelo+actualizado+a+${modelo.toUpperCase()}`);
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

          // Cada mensaje se procesa en su propio try/catch: si algo falla por
          // cualquier motivo, el cliente recibe un aviso en vez de silencio total,
          // y el resto de los mensajes del lote no se ven afectados.
          try {
            if (msg.type === 'audio') {
              saveIncoming({ waId: from, name: contactName, text: '[Audio recibido]', metaMessageId: messageId });
              const replyText = 'En este momento no puedo escuchar audios. Escribime tu consulta y te respondo enseguida 😊';
              const result = await enviarMensaje(from, replyText);
              saveOutgoing({ waId: from, text: replyText, metaMessageId: extractMetaMessageId(result), status: 'sent' });
              //await enviarMensaje(NOTIFICAR_A, `🎤 Audio recibido de +${from}`);
              continue;
            }

            if (msg.type !== 'text') {
              saveIncoming({ waId: from, name: contactName, text: `[Mensaje ${msg.type || 'no soportado'} recibido]`, metaMessageId: messageId });
              const replyText = 'Solo puedo responder mensajes de texto por ahora. Escribime tu consulta 😊';
              const result = await enviarMensaje(from, replyText);
              saveOutgoing({ waId: from, text: replyText, metaMessageId: extractMetaMessageId(result), status: 'sent' });
              continue;
            }

            let text = msg.text?.body || '';
            console.log(`📩 Mensaje de ${from}: ${text}`);

            // ── CONTEXTO DE ANUNCIO (Click-to-WhatsApp) ──────────────────
            // Si el mensaje llega desde un anuncio de Facebook/Instagram, Meta
            // incluye msg.referral con el titular y texto del anuncio. Se
            // antepone como nota interna para que el bot sepa de qué producto
            // habla el cliente sin volver a preguntar. El prompt tiene una
            // regla que le indica al modelo que esa nota no la escribió el
            // cliente y que nunca debe mencionarla.
            try {
              const ref = msg.referral;
              if (ref && (ref.headline || ref.body || ref.source_url)) {
                const partes = [];
                if (ref.headline) partes.push(`"${ref.headline}"`);
                if (ref.body) partes.push(ref.body.slice(0, 200));
                const detalle = partes.length ? ` Anuncio: ${partes.join(' — ')}.` : '';
                text = `[Contexto interno: el cliente llegó haciendo clic en un anuncio de Facebook/Instagram.${detalle}] ${text}`;
                console.log(`📣 Referral de anuncio detectado para ${from}`);
              }
            } catch (err) {
              console.error(`❌ Error leyendo referral de ${from} (no crítico):`, err.message);
            }

            // ── REHIDRATAR HISTORIAL (si la RAM está vacía, ej. redeploy) ─
            // Debe ejecutarse ANTES de saveIncoming para que el mensaje
            // actual no aparezca duplicado en el historial reconstruido.
            rehidratarConversacion(from);

            saveIncoming({ waId: from, name: contactName, text, metaMessageId: messageId });

            // ── DEBOUNCE: acumular mensajes y esperar antes de procesar ──
            // NOTIFICAR_A (el dueño) responde al instante siempre.
            if (from === NOTIFICAR_A) {
              // Respuesta instantánea para el dueño — sin debounce
              // Se agrega directo a pendingMessages para que procesarMensajes tenga el lote
              if (!pendingMessages[from]) pendingMessages[from] = [];
              pendingMessages[from].push({ text, contactName, messageId });
              if (!conversaciones[from]) conversaciones[from] = [];
              truncateConversation(from);
              await procesarMensajes(from);
            } else {
              // Para todos los demás: acumular y reiniciar el timer
              if (!pendingMessages[from]) pendingMessages[from] = [];
              pendingMessages[from].push({ text, contactName, messageId });
              if (pendingTimers[from]) clearTimeout(pendingTimers[from]);
              pendingTimers[from] = setTimeout(() => {
                delete pendingTimers[from];
                procesarMensajes(from).catch(err =>
                  console.error(`❌ Error en debounce handler de ${from}:`, err.message)
                );
              }, DEBOUNCE_MS);
            }
          } catch (err) {
            console.error(`❌ Error procesando mensaje de ${from}:`, err.message);
            try {
              const fallback = 'Disculpá, tuve un problema técnico procesando tu mensaje. ¿Podés escribirlo de nuevo?';
              const r = await enviarMensaje(from, fallback);
              saveOutgoing({ waId: from, text: fallback, metaMessageId: extractMetaMessageId(r), status: 'sent' });
            } catch (err2) {
              console.error(`❌ Error mandando el aviso de fallback a ${from}:`, err2.message);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
});

// ── DEBOUNCE ─────────────────────────────────────────────────────────────
// Agrupa mensajes seguidos del mismo número antes de llamar a Claude.
// El número NOTIFICAR_A (el dueño) siempre responde al instante.
const DEBOUNCE_MS = 2 * 60 * 1000; // 2 minutos
const pendingTimers   = {}; // { waId: timeoutId }
const pendingMessages = {}; // { waId: [{ text, contactName, messageId }] }

async function procesarMensajes(from) {
  const lote = pendingMessages[from] || [];
  delete pendingMessages[from];
  if (!lote.length) return;

  // Unir todos los mensajes pendientes en un solo texto
  const contactName = lote[lote.length - 1].contactName;
  const textoCombinado = lote.map(m => m.text).join('\n');

  try {
    if (!conversaciones[from]) conversaciones[from] = [];
    conversaciones[from].push({ role: 'user', content: textoCombinado });
    truncateConversation(from);

    const systemPrompt = buildSystemPrompt();
    const respuesta = await ai.messages.create({
      model: MODELOS[modeloActivo],
      max_tokens: 500,
      system: systemPrompt,
      messages: conversaciones[from]
    });

    let reply = respuesta.content?.[0]?.text || 'Perdón, no pude responder bien. Escribime de nuevo por favor.';
    conversaciones[from].push({ role: 'assistant', content: reply });
    truncateConversation(from);

    // ── Lead caliente
    try {
      const pideMarcador = reply.includes('[LEAD_CALIENTE]');
      if (pideMarcador) reply = reply.replace('[LEAD_CALIENTE]', '').trim();
      const pareceCotizacion = /cotiza|presupuesto|\bfactura\b|quiero comprar|hacer (el )?pedido/i.test(textoCombinado);
      if ((pideMarcador || pareceCotizacion) && !tieneFlag(from, 'lead_avisado')) {
        marcarFlag(from, 'lead_avisado');
        const nombreContacto = contactName ? `${contactName} — ` : '';
        const avisoTexto = `🔥 Lead caliente: ${nombreContacto}+${from}\nÚltimo mensaje: "${textoCombinado}"`;
        try { await enviarMensaje(NOTIFICAR_A, avisoTexto); } catch (err) { console.error('❌ Error notificando lead caliente:', err.message); }
      }
    } catch (err) { console.error('❌ Error en aviso de lead caliente (no afecta la respuesta al cliente):', err.message); }

    // ── Link demo HiWIFI
    try {
      if (reply.includes('[VER_DEMO]')) {
        reply = reply.replace('[VER_DEMO]', '').trim();
        marcarFlag(from, 'demo_link_enviado');
        if (!reply.includes('hiwifi.app/p/HW1')) reply += `\n\n👉 [HiWIFI · Datos públicos](https://hiwifi.app/p/HW1)`;
      }
      const mencionaHiwifi = /hiwifi|higr[oó]metro/i.test(textoCombinado) || /hiwifi/i.test(reply);
      if (mencionaHiwifi && !tieneFlag(from, 'demo_link_enviado') && conversaciones[from].length > 2) {
        marcarFlag(from, 'demo_link_enviado');
        if (!reply.includes('hiwifi.app/p/HW1')) reply += `\n\n👉 Mirá un equipo real funcionando: [HiWIFI · Datos públicos](https://hiwifi.app/p/HW1)`;
      }
    } catch (err) { console.error('❌ Error agregando link demo (no afecta el resto de la respuesta):', err.message); }

    // ── Enviar respuesta
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
    } else if (reply.includes('[FOLLETO_NIVEL]')) {
      const texto = reply.replace('[FOLLETO_NIVEL]', '').trim();
      if (texto) { const r = await enviarMensaje(from, texto); saveOutgoing({ waId: from, text: texto, metaMessageId: extractMetaMessageId(r), status: 'sent' }); }
      const r2 = await enviarImagen(from, FOLLETOS.nivel);
      saveOutgoing({ waId: from, text: '[Imagen: folleto nivel]', metaMessageId: extractMetaMessageId(r2), status: 'sent' });
    } else if (reply.includes('[FOLLETO_hiwifi]')) {
      const texto = reply.replace('[FOLLETO_hiwifi]', '').trim();
      if (texto) { const r = await enviarMensaje(from, texto); saveOutgoing({ waId: from, text: texto, metaMessageId: extractMetaMessageId(r), status: 'sent' }); }
      const r2 = await enviarImagen(from, FOLLETOS.hiwifi);
      saveOutgoing({ waId: from, text: '[Imagen: folleto hiwifi]', metaMessageId: extractMetaMessageId(r2), status: 'sent' });
    } else {
      const r = await enviarMensaje(from, reply);
      saveOutgoing({ waId: from, text: reply, metaMessageId: extractMetaMessageId(r), status: 'sent' });
    }

    console.log(`✅ Respuesta enviada a ${from}`);
  } catch (err) {
    console.error(`❌ Error procesando mensaje de ${from}:`, err.message);
    try {
      const fallback = 'Disculpá, tuve un problema técnico procesando tu mensaje. ¿Podés escribirlo de nuevo?';
      const r = await enviarMensaje(from, fallback);
      saveOutgoing({ waId: from, text: fallback, metaMessageId: extractMetaMessageId(r), status: 'sent' });
    } catch (err2) {
      console.error(`❌ Error mandando el aviso de fallback a ${from}:`, err2.message);
    }
  }
}

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
