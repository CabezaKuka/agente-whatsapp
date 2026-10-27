// ── LICENCIAS optiMAX ─────────────────────────────────────────────────────
// Port a Node de licencia.py + generar_clave.py. Genera EXACTAMENTE las mismas
// claves que el generador de escritorio (Ed25519 es determinístico: misma
// llave + mismos datos = misma firma).
//
// La llave privada NO está en el código: se lee de la variable de entorno
// OPTIMAX_PRIVATE_KEY (contenido de llave_privada.pem). Se acepta el PEM tal
// cual (con saltos de línea), con "\n" literales, o codificado en base64.
const crypto = require('node:crypto');

// Debe coincidir con LLAVE_PUBLICA de licencia.py (la que trae el instalador).
const LLAVE_PUBLICA = 'D8O5N7Lo6aQAbRXAK8xQGNiIi4j+gPn9eIewxHD39Mg=';
const PREFIJO = 'NCNC1-';
const VERSION_CLAVE = 1;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function normalizarCodigo(codigo) {
  let t = [...String(codigo).toUpperCase()].filter(c => /[\p{L}\p{N}]/u.test(c)).join('');
  t = t.replace(/0/g, 'O').replace(/1/g, 'I').replace(/8/g, 'B'); // base32 no usa 0, 1 ni 8
  if (t.length !== 12 || [...t].some(c => !B32.includes(c))) {
    throw new Error('Código de PC inválido: deben ser 12 letras o números, ej. 7K3Q-WXPM-2HDA.');
  }
  return `${t.slice(0, 4)}-${t.slice(4, 8)}-${t.slice(8, 12)}`;
}

// Igual que el generador de escritorio: busca XXXX-XXXX-XXXX dentro de un texto
// (sirve pegar el mensaje entero del cliente). Devuelve { raw, codigo } o null.
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
  let pem = (process.env.OPTIMAX_PRIVATE_KEY || '').trim();
  if (!pem) throw new Error('Falta la variable OPTIMAX_PRIVATE_KEY en Railway.');
  if (!pem.includes('BEGIN')) pem = Buffer.from(pem, 'base64').toString('utf8'); // venía en base64
  pem = pem.replace(/\\n/g, '\n');
  const priv = crypto.createPrivateKey(pem);
  if (priv.asymmetricKeyType !== 'ed25519') throw new Error('OPTIMAX_PRIVATE_KEY no es una llave Ed25519.');
  return priv;
}

// Verificación igual a licencia.verificar(): firma, versión y código de PC.
function verificarClave(clave, codigo, llavePublica = LLAVE_PUBLICA) {
  const t = String(clave).replace(/\s+/g, '');
  if (!t.toUpperCase().startsWith(PREFIJO)) throw new Error('La clave no tiene el formato de optiMAX.');
  const raw = Buffer.from(t.slice(PREFIJO.length), 'base64url');
  if (raw.length < 1 + 12 + 2 + 1 + 64) throw new Error('La clave está incompleta.');
  const datos = raw.subarray(0, raw.length - 64);
  const firma = raw.subarray(raw.length - 64);
  if (!crypto.verify(null, datos, llavePublicaDesdeRaw(llavePublica), firma)) throw new Error('La clave no es válida.');
  if (datos[0] !== VERSION_CLAVE) throw new Error('La clave es de otra versión del programa.');
  const codClave = normalizarCodigo(datos.subarray(1, 13).toString('ascii'));
  if (codClave !== normalizarCodigo(codigo)) throw new Error(`La clave es para otra PC (código ${codClave}).`);
  return { nombre: datos.subarray(15).toString('utf8'), codigo: codClave };
}

// opts.dias y opts.llavePublica existen solo para las pruebas.
function generarClave(nombre, codigo, opts = {}) {
  const llavePublica = opts.llavePublica || LLAVE_PUBLICA;
  const priv = cargarPrivada();
  const pubDeLaPrivada = Buffer.from(crypto.createPublicKey(priv).export({ format: 'jwk' }).x, 'base64url').toString('base64');
  if (pubDeLaPrivada !== llavePublica) {
    throw new Error('La llave privada de Railway no corresponde a la llave pública del programa: las claves no funcionarían.');
  }
  const datos = armarDatos(nombre, codigo, opts.dias ?? diasHoyBolivia());
  const firma = crypto.sign(null, datos, priv);
  const clave = PREFIJO + Buffer.concat([datos, firma]).toString('base64url');
  verificarClave(clave, codigo, llavePublica); // control: la clave se valida bien
  return clave;
}

function mensajeCliente(nombre, codigo, clave) {
  return `Gracias por tu compra de optiMAX PRO, ${normalizarNombre(nombre)}.\n\n` +
    'Para activarla: abrí optiMAX → «Activar optiMAX PRO», pegá esta clave completa y tocá «Activar»:\n\n' +
    `${clave}\n\n(Clave válida solo para la PC con código ${normalizarCodigo(codigo)}.)`;
}

module.exports = {
  normalizarCodigo,
  extraerCodigo,
  normalizarNombre,
  generarClave,
  verificarClave,
  mensajeCliente,
};
