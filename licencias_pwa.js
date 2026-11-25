// ── LICENCIAS optiMAX PARA EL CELULAR (PWA) ───────────────────────────────
// Misma mecánica que licencias.js (optiMAX PC) y licencias_tach.js, con SU PROPIO par de llaves y prefijo OPWA1-.
// Genera EXACTAMENTE las mismas claves que herramientas/licencia_pwa.py del repo optimax-pwa-pro (Ed25519 es
// determinístico: misma llave + mismos datos = misma firma).
//
// Además entrega la llave del código PRO cifrado (pro.bin de la PWA) a quien manda una clave válida para su
// dispositivo: POST /pwa/llave {clave, codigo} → {llave}. La PWA la pide una sola vez, al activar.
//
// Variables de Railway (las da el generador de claves, botones «Copiar …»):
//   OPTIMAX_PWA_PRIVATE_KEY  contenido de llave_privada_pwa.pem (PEM tal cual, con "\n" literales o en base64)
//   OPTIMAX_PWA_PAQUETE_KEY  contenido de clave_paquete_pwa.txt (32 bytes en base64)
// La llave pública se calcula de la privada (la misma que el generador escribe en licencia-config.js de la PWA).
const crypto = require('node:crypto');

const PREFIJO = 'OPWA1-';
const VERSION_CLAVE = 1;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

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

function mensajeCliente(nombre, codigo, clave) {
  return `Gracias por tu compra de optiMAX PRO para el celular, ${normalizarNombre(nombre)}.\n\n` +
    'Para activarla: abrí optiMAX en el celular → «Comprar PRO» → «Ya compré: activar», pegá esta clave ' +
    'completa y tocá «Activar». La primera vez necesitás internet; después anda sin conexión.\n\n' +
    `${clave}\n\n(Clave válida solo para el dispositivo con código ${normalizarCodigo(codigo)}.)`;
}

// ── POST /pwa/llave: la llave del código PRO para una clave válida ─────────
function llavePaquete() {
  const t = (process.env.OPTIMAX_PWA_PAQUETE_KEY || '').trim();
  if (!t) throw new Error('Falta la variable OPTIMAX_PWA_PAQUETE_KEY en Railway.');
  const b = Buffer.from(t, 'base64');
  if (b.length !== 32) throw new Error('OPTIMAX_PWA_PAQUETE_KEY no es una llave de 32 bytes en base64 (clave_paquete_pwa.txt).');
  return b.toString('base64');
}

// Tope simple por IP (en memoria): 30 pedidos cada 10 minutos.
const intentos = new Map();
function demasiados(ip, ahora = Date.now()) {
  const v = (intentos.get(ip) || []).filter(t => ahora - t < 10 * 60 * 1000);
  v.push(ahora);
  intentos.set(ip, v);
  if (intentos.size > 5000) intentos.clear();
  return v.length > 30;
}

// Handler para express (y para las pruebas: req = {method, body, ip}, res con status/json/set/end).
function rutaLlave(req, res) {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (demasiados(req.ip || '?')) return res.status(429).json({ error: 'Demasiados intentos. Probá de nuevo en unos minutos.' });
  const { clave, codigo } = req.body || {};
  let pub, llave;
  try {
    pub = llavePublica();
    llave = llavePaquete();
  } catch (err) {
    console.error('❌ /pwa/llave sin configurar:', err.message);
    return res.status(503).json({ error: 'El servidor de activación no está configurado. Avisá a ventas.' });
  }
  try {
    const lic = verificarClave(clave, codigo, pub);
    console.log(`🔓 PWA activada: ${lic.nombre} — ${lic.codigo}`);
    return res.json({ llave });
  } catch (err) {
    return res.status(403).json({ error: err.message });
  }
}

module.exports = {
  normalizarCodigo,
  extraerCodigo,
  normalizarNombre,
  generarClave,
  verificarClave,
  llavePublica,
  mensajeCliente,
  rutaLlave,
};
