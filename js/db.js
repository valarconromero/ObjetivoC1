// Thin promise wrapper over IndexedDB. Audio and files live in `blobs` as
// ArrayBuffers (more portable across browsers than storing Blob objects).

const DB_NAME = 'objetivoc1';
const DB_VERSION = 1;
export const STORES = ['sessions', 'materials', 'blobs', 'checkpoints', 'meta'];

let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('date', 'date');
      db.createObjectStore('materials', { keyPath: 'id' }).createIndex('sessionId', 'sessionId');
      db.createObjectStore('blobs', { keyPath: 'id' });
      db.createObjectStore('checkpoints', { keyPath: 'week' });
      db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  return (await open()).transaction(name, mode).objectStore(name);
}

export async function getAll(name) {
  return done((await store(name)).getAll());
}

export async function get(name, key) {
  return done((await store(name)).get(key));
}

export async function put(name, value) {
  return done((await store(name, 'readwrite')).put(value));
}

export async function del(name, key) {
  return done((await store(name, 'readwrite')).delete(key));
}

export async function getMeta(key) {
  return (await get('meta', key))?.value;
}

export async function setMeta(key, value) {
  return put('meta', { key, value });
}

// Replaces every store's contents in one transaction (used by backup restore).
export async function replaceAll(data) {
  const db = await open();
  const tx = db.transaction(STORES, 'readwrite');
  for (const name of STORES) {
    const s = tx.objectStore(name);
    s.clear();
    for (const value of data[name] ?? []) s.put(value);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
