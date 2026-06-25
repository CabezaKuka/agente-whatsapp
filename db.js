const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_DIR = '/app/data';
const DB_PATH = path.join(DB_DIR, 'inbox.db');

fs.mkdirSync(DB_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      wa_id TEXT PRIMARY KEY,
      name TEXT,
      last_message_at TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      text TEXT,
      meta_message_id TEXT,
      status TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS catalogo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      precio TEXT NOT NULL,
      stock TEXT NOT NULL DEFAULT 'SI',
      descripcion TEXT NOT NULL,
      orden INTEGER DEFAULT 0
    );
  `);

  // Poblar catálogo solo si está vacío
  const count = db.prepare('SELECT COUNT(*) as n FROM catalogo').get();
  if (count.n === 0) {
    const insert = db.prepare(`
      INSERT INTO catalogo (nombre, precio, stock, descripcion, orden)
      VALUES (?, ?, ?, ?, ?)
    `);
    const items = [
      ['CLASIFICADORA DE GRANOS CG-3', '3.900 dolares', 'NO', '3 zarandas intercambiables, motor 1.5HP, producción promedio 2500 kg/hora, alimentación monofásica 220V. Solo clasifica, no tiene aire para limpieza. Puede procesar soya, frejol, maíz, sorgo, quinua, chía, pasto, habas, maní, orégano.', 1],
      ['CLASIFICADORA DE GRANOS CG-3E', '5.500 dolares', 'NO', '3 zarandas intercambiables, motores 3.5HP (1.5HP cajón vibrador + 2HP aspirador), variador de velocidad electrónico, producción promedio 2500 kg/hora, alimentación monofásica 220V. Incluye ciclón para recepción de basura. Puede procesar soya, frejol, maíz, sorgo, quinua, chía, pasto, habas, maní.', 2],
      ['ZARANDAS MANUALES', '230 Bolivianos', 'SI', 'Para laboratorio y muestras. Variedad de perforaciones redondas y oblongas. Dimensiones 30x25 cm. Son apilables.', 3],
      ['MH-5 MEDIDOR DE HUMEDAD', '2.200 Bolivianos', 'NO', 'Para granos: soya, maíz, sorgo, girasol y otros. Precisión +-0.6%. Batería recargable, pantalla OLED, tapa de presión con aviso sonoro. Incluye estuche. No mide castaña, cacao ni café.', 4],
      ['CUARTEADOR 12CM', '3.500 Bolivianos', 'SI', '12 canales de 19mm, fabricado en acero inoxidable, tres bandejas de recepción. No apto para áridos.', 5],
      ['TRILLADORA ENSAYOS', '2.400 dolares', 'SI', 'Para maíz, sorgo, soya, trigo. Motor estacionario 6.5HP o eléctrico. Cóncavo regulable, tapa regulable, ventilador incorporado, montada sobre ruedas. Ideal para pequeñas parcelas o líneas de muestras.', 6],
      ['MOLINO 20 MARTILLOS', '4.750 Bolivianos', 'SI', '20 martillos y 2 cuchillas, pica pasto, caña y muele granos. Rendimiento: 80-100 kg harina, 400 kg con cedazo 3mm, 700 kg con 5mm, 800 kg con 12mm. Con ciega: 1000-2000 kg/hora. Motor requerido eléctrico 5HP en alta o gasolina 9HP. No incluye motor. Incluye base de motor.', 7],
      ['MOLINO 20 MARTILLOS CON CICLÓN', '6.150 Bolivianos', 'SI', '20 martillos y 2 cuchillas, pica pasto, caña y muele granos. Rendimiento: 80-100 kg harina, 400 kg con cedazo 3mm, 700 kg con 5mm, 800 kg con 12mm. Con ciega: 1000-2000 kg/hora. Motor requerido eléctrico trifásico 7.5HP en alta o gasolina 11HP. No incluye motor. Incluye base de motor, extractor y ciclón.', 8],
      ['MOLINO 24 MARTILLOS', '6.550 Bolivianos', 'SI', '24 martillos y 2 cuchillas, pica pasto, caña y muele granos. Rendimiento: 150 kg harina, 600 kg con cedazo 3mm, 800 kg con 5mm, 1000 kg con 12mm. Con ciega: 2500 kg/hora. Motor requerido eléctrico trifásico 12.5HP en alta o gasolina 13HP. No incluye motor. Incluye base de motor.', 9],
      ['MOLINO 24 MARTILLOS CON CICLÓN', '7.900 Bolivianos', 'SI', '24 martillos y 2 cuchillas, pica pasto, caña y muele granos. Rendimiento: 150 kg harina, 600 kg con cedazo 3mm, 800 kg con 5mm, 1200 kg con 12mm. Con ciega: 2500 kg/hora. Motor requerido eléctrico trifásico 12.5HP en alta o gasolina 13HP. No incluye motor. Incluye base de motor, extractor y ciclón.', 10],
      ['PICADORA DE PASTO Y CAÑA', '3.500 Bolivianos', 'SI', 'Pica pasto y caña, dos tamaños de corte regulable. Rendimiento 2000 kilos hora. Motor requerido 3.5 hp, monofásico o trifásico en alta o 6.5 HP a gasolina. Motor no incluido.', 11],
    ];
    for (const item of items) insert.run(...item);
    console.log('✅ Catálogo inicial cargado en base de datos');
  }
}

function upsertContact(waId, name = null) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO contacts (wa_id, name, last_message_at)
    VALUES (?, ?, ?)
    ON CONFLICT(wa_id) DO UPDATE SET
      name = COALESCE(excluded.name, contacts.name),
      last_message_at = excluded.last_message_at
  `).run(waId, name, now);
}

function saveIncoming({ waId, name = null, text = '', metaMessageId = null }) {
  const now = new Date().toISOString();
  upsertContact(waId, name);
  db.prepare(`
    INSERT INTO messages (wa_id, direction, text, meta_message_id, status, created_at)
    VALUES (?, 'in', ?, ?, NULL, ?)
  `).run(waId, text, metaMessageId, now);
}

function saveOutgoing({ waId, text = '', metaMessageId = null, status = 'sent' }) {
  const now = new Date().toISOString();
  upsertContact(waId, null);
  db.prepare(`
    INSERT INTO messages (wa_id, direction, text, meta_message_id, status, created_at)
    VALUES (?, 'out', ?, ?, ?, ?)
  `).run(waId, text, metaMessageId, status, now);
}

function updateStatus(metaMessageId, status) {
  db.prepare(`
    UPDATE messages SET status = ? WHERE meta_message_id = ?
  `).run(status, metaMessageId);
}

function getChats() {
  return db.prepare(`
    SELECT wa_id, name, last_message_at FROM contacts ORDER BY last_message_at DESC
  `).all();
}

function getMessages(waId) {
  return db.prepare(`
    SELECT direction, text, status, created_at FROM messages WHERE wa_id = ? ORDER BY created_at ASC
  `).all(waId);
}

// Todos los mensajes desde una fecha (ISO), con el nombre de contacto, para exportar
function getMessagesDesde(sinceIso) {
  return db.prepare(`
    SELECT m.wa_id, c.name, m.direction, m.text, m.status, m.created_at
    FROM messages m
    LEFT JOIN contacts c ON c.wa_id = m.wa_id
    WHERE m.created_at >= ?
    ORDER BY m.wa_id ASC, m.created_at ASC
  `).all(sinceIso);
}

// ── CATÁLOGO ──────────────────────────────────────────────────────────────
function getCatalogo() {
  return db.prepare(`SELECT * FROM catalogo ORDER BY orden ASC`).all();
}

function getCatalogoTexto() {
  const items = getCatalogo();
  return items.map(i =>
    `Equipo: ${i.nombre} | Precio: ${i.precio} | STOCK: ${i.stock} | Descripción: ${i.descripcion}`
  ).join('\n');
}

function updateProducto({ id, nombre, precio, stock, descripcion }) {
  db.prepare(`
    UPDATE catalogo SET nombre=?, precio=?, stock=?, descripcion=? WHERE id=?
  `).run(nombre, precio, stock, descripcion, id);
}

function insertProducto({ nombre, precio, stock, descripcion }) {
  const maxOrden = db.prepare('SELECT MAX(orden) as m FROM catalogo').get();
  const orden = (maxOrden.m || 0) + 1;
  db.prepare(`
    INSERT INTO catalogo (nombre, precio, stock, descripcion, orden) VALUES (?,?,?,?,?)
  `).run(nombre, precio, stock, descripcion, orden);
}

function deleteProducto(id) {
  db.prepare(`DELETE FROM catalogo WHERE id=?`).run(id);
}

module.exports = {
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
};
