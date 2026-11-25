// ── LICENCIAS optiMAX PARA EL CELULAR (PWA) ───────────────────────────────
// La licencia es del NÚMERO DE WHATSAPP del comprador (cuenta), no del equipo. Cada cuenta puede tener hasta
// TOPE_EQUIPOS equipos activos (celular, PC…); el siguiente reemplaza al más viejo.
//
//   1. Venta: el dueño manda «/pwa Nombre NÚMERO» → queda la cuenta.
//   2. Activar (PWA, con internet): POST /pwa/ingreso {codigo} → {token, whatsapp, texto}. La PWA abre WhatsApp con
//      ese texto («Activar optiMAX PRO en este equipo: ABCD-EFGH») dirigido al bot; el bot ve de qué número viene
//      (recibirIngreso). Si el número tiene cuenta, el equipo queda anotado.
//   3. La PWA consulta POST /pwa/ingreso/estado {token} → {estado: pendiente | ok | sin_licencia | vencido}; con ok
//      recibe la clave del equipo (OPWA1-…, firmada para su código) y la llave del código PRO cifrado (pro.bin).
//      Desde ahí anda sin internet: la clave se verifica en el equipo con la llave pública.
//   4. Al abrir con internet, la PWA pregunta POST /pwa/equipo {clave, codigo} → {activo, llave}. Si el equipo fue
//      reemplazado (activo: false), vuelve a la DEMO. Sin internet sigue andando (sin plazo máximo, decisión de Max).
//
// Las claves tienen el mismo formato que las de optiMAX PC y optiTACH, con SU PROPIO par de llaves y prefijo OPWA1-,
// y son EXACTAMENTE las mismas que genera herramientas/licencia_pwa.py del repo optimax-pwa-pro (Ed25519 es
// determinístico: misma llave + mismos datos = misma firma).
//
// Variables de Railway (las da el generador de claves, botones «Copiar …»):
//   OPTIMAX_PWA_PRIVATE_KEY  contenido de llave_privada_pwa.pem (PEM tal cual, con "\n" literales o en base64)
//   OPTIMAX_PWA_PAQUETE_KEY  contenido de clave_paquete_pwa.txt (32 bytes en base64)
// La llave pública se calcula de la privada (la misma que el generador escribe en licencia-config.js de la PWA).
const crypto = require('node:crypto');

const PREFIJO = 'OPWA1-';
const VERSION_CLAVE = 1;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOPE_EQUIPOS = 2;                       // equipos activos por compra (decisión de Max, 25-nov)
const VIDA_INGRESO_MS = 30 * 60 * 1000;       // un pedido de ingreso vale 30 minutos
const WHATSAPP_VENTAS = '59177626675';

function normalizarCodigo(codigo) {
  let t = [...String(codigo).toUpperCase()].filter(c => /[\p{L}\p{N}]/u.test(c)).join('');
  t = t.replace(/0/g, 'O').replace(/1/g, 'I').replace(/8/g, 'B'); // base32 no usa 0, 1 ni 8
  if (t.length !== 12 || [...t].some(c => !B32.includes(c))) {
    throw new Error('Código de dispositivo inválido: deben ser 12 letras o números, ej. 7K3Q-WXPM-2HDA.');
  }
  return `${t.slice(0, 4)}-${t.slice(4, 8)}-${t.slice(8, 12)}`;
}

// Busca XXXX-XXXX-XXXX dentro de un texto (sirve pegar el mensaje entero del cliente). { raw, codigo } o null.
function extraerCodigo(texto) {
  const m = String(texto).match(/[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}/);
  if (!m) return null;
  return { raw: m[0], codigo: normalizarCodigo(m[0]) };
}

function normalizarNombre(nombre) {
  return String(nombre).split(/\s+/).filter(Boolean).join(' ');
}

// Días desde 2020-01-01 según la fecha de Bolivia (GMT-4), como date.today() en la PC.
function diasHoyBolivia(ahora = new Date()) {
  const b = new Date(ahora.getTime() - 4 * 60 * 60 * 1000);
  const hoy = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((hoy - Date.UTC(2020, 0, 1)) / 86400000);
}

function armarDatos(nombre, codigo, dias) {
  codigo = normalizarCodigo(codigo);
  nombre = normalizarNombre(nombre);
  if (!nombre) throw new Error('Falta el nombre del cliente.');
  const nb = Buffer.from(nombre, 'utf8');
  if (nb.length > 80) throw new Error('El nombre es demasiado largo (máximo 80 bytes).');
  const d = Buffer.alloc(2);
  d.writeUInt16BE(dias);
  return Buffer.concat([Buffer.from([VERSION_CLAVE]), Buffer.from(codigo.replace(/-/g, ''), 'ascii'), d, nb]);
}

function llavePublicaDesdeRaw(b64) {
  return crypto.createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(b64, 'base64').toString('base64url') },
    format: 'jwk',
  });
}

function cargarPrivada() {
  let txt = (process.env.OPTIMAX_PWA_PRIVATE_KEY || '').trim();
  if (!txt) throw new Error('Falta la variable OPTIMAX_PWA_PRIVATE_KEY en Railway.');
  txt = txt.replace(/\\n/g, '\n');
  if (/BEGIN [A-Z ]*PUBLIC KEY/.test(txt)) {
    throw new Error('OPTIMAX_PWA_PRIVATE_KEY tiene la llave PÚBLICA. Hay que pegar la llave privada (llave_privada_pwa.pem).');
  }
  let priv;
  try {
    if (txt.includes('BEGIN')) {
      // PEM completo. Railway a veces convierte los saltos de línea en espacios: se rearma desde el cuerpo.
      const m = txt.match(/-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/);
      if (!m) throw new Error('pem');
      const cuerpo = m[2].replace(/\s+/g, '');
      priv = crypto.createPrivateKey(`-----BEGIN ${m[1]}-----\n${cuerpo.match(/.{1,64}/g).join('\n')}\n-----END ${m[1]}-----\n`);
    } else {
      // Sin BEGIN: base64 del PEM completo (lo que copia el generador), o solo el cuerpo (base64 del DER).
      const raw = Buffer.from(txt.replace(/\s+/g, ''), 'base64');
      const comoTexto = raw.toString('utf8');
      if (comoTexto.includes('BEGIN')) {
        const cuerpo = comoTexto.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
        priv = crypto.createPrivateKey(`-----BEGIN PRIVATE KEY-----\n${cuerpo.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`);
      } else {
        priv = crypto.createPrivateKey({ key: raw, format: 'der', type: 'pkcs8' });
      }
    }
  } catch (err) {
    throw new Error('OPTIMAX_PWA_PRIVATE_KEY no se pudo leer: debe ser la llave PRIVADA de la PWA, completa (el contenido de llave_privada_pwa.pem).');
  }
  if (priv.asymmetricKeyType !== 'ed25519') throw new Error('OPTIMAX_PWA_PRIVATE_KEY no es una llave Ed25519.');
  return priv;
}

// Llave pública (base64) de la privada de Railway: la misma que escribe el generador en licencia-config.js.
function llavePublica() {
  return Buffer.from(crypto.createPublicKey(cargarPrivada()).export({ format: 'jwk' }).x, 'base64url').toString('base64');
}

// Verificación igual a verificarClave de la PWA: firma, versión y código del dispositivo.
function verificarClave(clave, codigo, pub = llavePublica()) {
  const t = String(clave).replace(/\s+/g, '');
  if (!t.toUpperCase().startsWith(PREFIJO)) throw new Error('La clave no tiene el formato de optiMAX para el celular.');
  const raw = Buffer.from(t.slice(PREFIJO.length), 'base64url');
  if (raw.length < 1 + 12 + 2 + 1 + 64) throw new Error('La clave está incompleta.');
  const datos = raw.subarray(0, raw.length - 64);
  const firma = raw.subarray(raw.length - 64);
  if (!crypto.verify(null, datos, llavePublicaDesdeRaw(pub), firma)) throw new Error('La clave no es válida.');
  if (datos[0] !== VERSION_CLAVE) throw new Error('La clave es de otra versión del programa.');
  const codClave = normalizarCodigo(datos.subarray(1, 13).toString('ascii'));
  if (codClave !== normalizarCodigo(codigo)) throw new Error(`La clave es para otro dispositivo (código ${codClave}).`);
  return { nombre: datos.subarray(15).toString('utf8'), codigo: codClave };
}

// opts.dias existe solo para las pruebas.
function generarClave(nombre, codigo, opts = {}) {
  const priv = cargarPrivada();
  const datos = armarDatos(nombre, codigo, opts.dias ?? diasHoyBolivia());
  const firma = crypto.sign(null, datos, priv);
  const clave = PREFIJO + Buffer.concat([datos, firma]).toString('base64url');
  verificarClave(clave, codigo, llavePublica()); // control: la clave se valida bien
  return clave;
}

// ── números de WhatsApp ───────────────────────────────────────────────────
// «71234567», «+591 712 34567», «59171234567» → «59171234567» (como llega msg.from). 8 cifras que empiezan con 6 o 7
// = celular de Bolivia.
function normalizarNumero(texto) {
  let d = String(texto).replace(/\D/g, '');
  if (d.length === 8 && /^[67]/.test(d)) d = '591' + d;
  if (d.length < 10 || d.length > 15) throw new Error('Número de WhatsApp inválido: ej. 71234567 o 59171234567.');
  return d;
}

// Busca un número (8 cifras o más, con +, espacios o guiones) dentro de un texto. { raw, numero } o null.
function extraerNumero(texto) {
  const m = String(texto).match(/\+?\d[\d\s-]{6,}\d/);
  if (!m) return null;
  return { raw: m[0], numero: normalizarNumero(m[0]) };
}

const numeroVisible = (n) => (n.startsWith('591') && n.length === 11 ? `+591 ${n.slice(3)}` : `+${n}`);

function mensajeCliente(nombre, numero) {
  return `Gracias por tu compra de optiMAX PRO, ${normalizarNombre(nombre)}.\n\n` +
    'Para activarla: abrí optiMAX → «Comprar PRO» → «Ya compré: activar» → «Entrar con WhatsApp», y mandá el ' +
    `mensaje que se abre desde este número (${numeroVisible(numero)}). La primera vez hace falta internet; después ` +
    `anda sin conexión.\n\nSirve en ${TOPE_EQUIPOS} equipos (por ejemplo el celular y la PC). Si cambiás de celular o ` +
    'se borran los datos, hacé lo mismo y vuelve a quedar activada.';
}

// Texto que la PWA abre en WhatsApp y el bot reconoce. El token: 8 letras base32 en dos grupos (ABCD-EFGH).
const textoIngreso = (token) => `Activar optiMAX PRO en este equipo: ${token}`;
function esIngreso(texto) {
  const m = String(texto).match(/activar\s+optimax[\s\S]*?\b([A-Z2-7]{4}-[A-Z2-7]{4})\b/i);
  return m ? m[1].toUpperCase() : null;
}
function tokenNuevo() {
  const b = crypto.randomBytes(8);
  let t = '';
  for (let i = 0; i < 8; i++) t += B32[b[i] % 32];
  return `${t.slice(0, 4)}-${t.slice(4)}`;
}

// ── llave del código PRO cifrado ──────────────────────────────────────────
function llavePaquete() {
  const t = (process.env.OPTIMAX_PWA_PAQUETE_KEY || '').trim();
  if (!t) throw new Error('Falta la variable OPTIMAX_PWA_PAQUETE_KEY en Railway.');
  const b = Buffer.from(t, 'base64');
  if (b.length !== 32) throw new Error('OPTIMAX_PWA_PAQUETE_KEY no es una llave de 32 bytes en base64 (clave_paquete_pwa.txt).');
  return b.toString('base64');
}

// Tope simple por IP (en memoria), por ruta: pedidos cada 10 minutos. En datos móviles muchos usuarios comparten IP,
// por eso no es bajo; la consulta del estado se repite cada 2 s mientras el usuario manda el mensaje.
function crearTope(maximo) {
  const intentos = new Map();
  return (ip, ahora = Date.now()) => {
    const v = (intentos.get(ip) || []).filter(t => ahora - t < 10 * 60 * 1000);
    v.push(ahora);
    intentos.set(ip, v);
    if (intentos.size > 5000) intentos.clear();
    return v.length > maximo;
  };
}
const TOPES = { ingreso: 60, estado: 600, equipo: 120 };

// ── almacén en memoria (pruebas). El bot usa el de db.js, con las mismas funciones. ──
function almacenMemoria() {
  const cuentas = new Map(), equipos = [];
  let reloj = 0;                                          // orden de alta estable aunque dos altas caigan en el mismo ms
  return {
    guardarCuenta(numero, nombre) { cuentas.set(numero, { numero, nombre, fecha: new Date().toISOString() }); },
    cuenta: (numero) => cuentas.get(numero) || null,
    quitarCuenta(numero) {
      cuentas.delete(numero);
      for (let i = equipos.length - 1; i >= 0; i--) if (equipos[i].numero === numero) equipos.splice(i, 1);
    },
    buscarCuentas: (txt = '') => [...cuentas.values()].filter((c) => !txt || c.nombre.toLowerCase().includes(txt.toLowerCase()) || c.numero.includes(txt)).reverse(),
    equipos: (numero) => equipos.filter((e) => e.numero === numero).sort((a, b) => a.orden - b.orden),
    agregarEquipo(numero, codigo) {
      const e = equipos.find((x) => x.numero === numero && x.codigo === codigo);
      if (e) { e.alta = new Date().toISOString(); e.orden = ++reloj; } else equipos.push({ numero, codigo, alta: new Date().toISOString(), orden: ++reloj });
    },
    quitarEquipo(numero, codigo) {
      const i = equipos.findIndex((x) => x.numero === numero && x.codigo === codigo);
      if (i >= 0) equipos.splice(i, 1);
    },
    cuentaDeEquipo: (codigo) => equipos.find((e) => e.codigo === codigo)?.numero || null,
  };
}

const fechaCorta = (iso) => { try { const d = new Date(iso); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`; } catch { return ''; } };

/**
 * Servicio de licencias de la PWA. almacen: {guardarCuenta, cuenta, quitarCuenta, buscarCuentas, equipos,
 * agregarEquipo, quitarEquipo, cuentaDeEquipo} (db.js o almacenMemoria()). numeroBot: async () → número del bot
 * (a donde la PWA manda el mensaje de activación).
 */
function crearServicio(almacen, { numeroBot }) {
  const ingresos = new Map();                    // token → {codigo, creado, estado, numero}
  const limpiar = (ahora = Date.now()) => {
    for (const [t, v] of ingresos) if (ahora - v.creado > VIDA_INGRESO_MS) ingresos.delete(t);
  };
  const cors = (res) => res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  // envuelve un handler: CORS, preflight, tope por IP y errores
  const ruta = (maximo, f) => {
    const demasiados = crearTope(maximo);
    return async (req, res) => {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (demasiados(req.ip || '?')) return res.status(429).json({ error: 'Demasiados intentos. Probá de nuevo en unos minutos.' });
    try {
      return await f(req.body || {}, res);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    };
  };
  const configurado = () => {
    try { llavePublica(); llavePaquete(); return true; } catch (err) {
      console.error('❌ Licencias PWA sin configurar:', err.message);
      return false;
    }
  };
  const SIN_CONFIG = { error: 'El servidor de activación no está configurado. Avisá a ventas.' };

  /** El bot recibió el mensaje de activación desde «numero». Devuelve el texto de respuesta. */
  function recibirIngreso(numero, token) {
    limpiar();
    const ing = ingresos.get(token);
    if (!ing) return 'Ese código de activación ya venció. Volvé a optiMAX y tocá «Entrar con WhatsApp» de nuevo.';
    const cuenta = almacen.cuenta(numero);
    if (!cuenta) {
      ing.estado = 'sin_licencia';
      return 'Este número de WhatsApp no tiene optiMAX PRO. Si ya pagaste, avisanos y la habilitamos; para comprarla: ' +
        `https://wa.me/${WHATSAPP_VENTAS}`;
    }
    const otra = almacen.cuentaDeEquipo(ing.codigo);
    if (otra && otra !== numero) almacen.quitarEquipo(otra, ing.codigo);   // el equipo pasa a esta cuenta
    almacen.agregarEquipo(numero, ing.codigo);
    let lista = almacen.equipos(numero), reemplazado = null;
    while (lista.length > TOPE_EQUIPOS) {
      reemplazado = lista[0];
      almacen.quitarEquipo(numero, lista[0].codigo);
      lista = almacen.equipos(numero);
    }
    ing.estado = 'ok';
    ing.numero = numero;
    console.log(`🔓 PWA: equipo ${ing.codigo} activado para ${cuenta.nombre} (${numero}), ${lista.length} de ${TOPE_EQUIPOS}`);
    return `✓ Listo, ${cuenta.nombre}: optiMAX PRO quedó activada en ese equipo. Volvé a optiMAX.\n\n` +
      `Equipos activos: ${lista.length} de ${TOPE_EQUIPOS}.` +
      (reemplazado ? ` Reemplazó al equipo que habías activado el ${fechaCorta(reemplazado.alta)}.` : '');
  }

  // POST /pwa/ingreso {codigo} → {token, whatsapp, texto}
  const ingreso = ruta(TOPES.ingreso, async ({ codigo }, res) => {
    codigo = normalizarCodigo(codigo);
    if (!configurado()) return res.status(503).json(SIN_CONFIG);
    const whatsapp = await numeroBot().catch(() => null);
    if (!whatsapp) return res.status(503).json(SIN_CONFIG);
    limpiar();
    if (ingresos.size > 5000) ingresos.clear();
    let token;
    do token = tokenNuevo(); while (ingresos.has(token));
    ingresos.set(token, { codigo, creado: Date.now(), estado: 'pendiente', numero: null });
    return res.json({ token, whatsapp, texto: textoIngreso(token) });
  });

  // POST /pwa/ingreso/estado {token} → {estado} (+ clave, llave y nombre con ok)
  const estado = ruta(TOPES.estado, async ({ token }, res) => {
    limpiar();
    const ing = ingresos.get(String(token || '').toUpperCase());
    if (!ing) return res.json({ estado: 'vencido' });
    if (ing.estado !== 'ok') return res.json({ estado: ing.estado });
    const cuenta = almacen.cuenta(ing.numero);
    if (!cuenta) return res.json({ estado: 'sin_licencia' });
    if (!configurado()) return res.status(503).json(SIN_CONFIG);
    return res.json({ estado: 'ok', nombre: cuenta.nombre, clave: generarClave(cuenta.nombre, ing.codigo), llave: llavePaquete() });
  });

  // POST /pwa/equipo {clave, codigo} → {activo, llave?}: ¿este equipo sigue activo en alguna cuenta?
  const equipo = ruta(TOPES.equipo, async ({ clave, codigo }, res) => {
    if (!configurado()) return res.status(503).json(SIN_CONFIG);
    let lic;
    try { lic = verificarClave(clave, codigo); } catch (err) { return res.status(403).json({ error: err.message }); }
    const numero = almacen.cuentaDeEquipo(lic.codigo);
    if (!numero || !almacen.cuenta(numero)) return res.json({ activo: false });
    return res.json({ activo: true, llave: llavePaquete() });
  });

  return { recibirIngreso, ingreso, estado, equipo, _ingresos: ingresos };
}

module.exports = {
  TOPE_EQUIPOS,
  TOPES,
  normalizarCodigo,
  extraerCodigo,
  normalizarNombre,
  normalizarNumero,
  extraerNumero,
  numeroVisible,
  generarClave,
  verificarClave,
  llavePublica,
  mensajeCliente,
  esIngreso,
  textoIngreso,
  almacenMemoria,
  crearServicio,
};
