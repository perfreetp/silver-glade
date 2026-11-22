// 体数据分块的浏览器持久化缓存(IndexedDB)

const DB_NAME = 'weather-volume-cache';
const STORE = 'chunks';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function db(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = openDB();
  return dbPromise;
}

export async function idbGetChunk(key: string): Promise<Uint8Array | null> {
  const d = await db();
  return new Promise((resolve) => {
    const tx = d.transaction(STORE, 'readonly');
    const rq = tx.objectStore(STORE).get(key);
    rq.onsuccess = () => resolve((rq.result as Uint8Array | undefined) ?? null);
    rq.onerror = () => resolve(null);
  });
}

export async function idbPutChunk(key: string, value: Uint8Array): Promise<void> {
  const d = await db();
  return new Promise((resolve) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function idbClear(): Promise<void> {
  const d = await db();
  return new Promise((resolve) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
