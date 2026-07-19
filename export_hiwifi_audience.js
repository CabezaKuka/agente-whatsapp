// Exporta a CSV los números de WhatsApp que preguntaron por HiWIFI (el
// monitor ambiental), para subir como Público Personalizado en Meta Ads.
//
// Uso:
//   node export_hiwifi_audience.js
// Genera: hiwifi_audience.csv (columna "phone", formato +591XXXXXXXX)
//
// No modifica nada — solo lee la base y escribe un archivo nuevo.

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join('/app/data', 'inbox.db');
const db = new DatabaseSync(DB_PATH);

// Palabras clave que identifican interés en HiWIFI (el monitor ambiental),
// evitando confundir con Datalogger o Zarandas. Ajustá esta lista si ves
// falsos positivos o negativos en el CSV de revisión.
const KEYWORDS = [
  'hiwifi',
  'hi wifi',
  'monitoreo ambiental',
  'monitor ambiental',
  'hiwifi.app'
];

const condiciones = KEYWORDS.map(() => `LOWER(m.text) LIKE ?`).join(' OR ');
const params = KEYWORDS.map(k => `%${k}%`);

const rows = db.prepare(`
  SELECT DISTINCT c.wa_id, c.name,
    (SELECT m2.text FROM messages m2
     WHERE m2.wa_id = c.wa_id AND m2.direction = 'in'
     ORDER BY m2.created_at ASC LIMIT 1) AS primer_mensaje
  FROM contacts c
  JOIN messages m ON m.wa_id = c.wa_id
  WHERE ${condiciones}
  ORDER BY c.name
`).all(...params);

// CSV para Facebook: columna "phone" con "+" adelante
const csvFacebook = ['phone', ...rows.map(r => `+${r.wa_id}`)].join('\n');
fs.writeFileSync('hiwifi_audience.csv', csvFacebook);

// CSV de revisión para vos: nombre + primer mensaje, para chequear falsos
// positivos antes de subir el otro archivo a Facebook
const escape = s => `"${String(s || '').replace(/"/g, '""')}"`;
const csvRevision = [
  'telefono,nombre,primer_mensaje',
  ...rows.map(r => `+${r.wa_id},${escape(r.name)},${escape(r.primer_mensaje)}`)
].join('\n');
fs.writeFileSync('hiwifi_audience_revision.csv', csvRevision);

console.log(`Encontrados ${rows.length} contactos.`);
console.log('Archivos generados: hiwifi_audience.csv (para Facebook), hiwifi_audience_revision.csv (para revisar antes)');
