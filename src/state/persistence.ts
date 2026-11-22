/**
 * 浏览器本地持久化
 *
 * 全部数据留在本机：IndexedDB 存原始导入文本与最近一次渲染参数，
 * localStorage 存轻量的界面偏好（阈值、透明度、色带等）。
 * 不向任何服务器发送数据。
 */

const DB_NAME = "thermal-rack-analyzer";
const DB_VERSION = 1;
const STORE = "imports";

export interface StoredImport {
  id: string;
  name: string;
  text: string;
  importedAt: number;
  /** 机柜数量（用于列表展示，不必重新解析） */
  rackCount: number;
  format: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveImport(rec: StoredImport): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function listImports(): Promise<StoredImport[]> {
  const db = await openDb();
  const out = await new Promise<StoredImport[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as StoredImport[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return out.sort((a, b) => b.importedAt - a.importedAt);
}

export async function deleteImport(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/* ---- 界面偏好 ---- */

const PREF_KEY = "thermal-rack-prefs-v1";

export interface UiPrefs {
  threshold: number;
  opacity: number;
  palette: string;
  showIso: boolean;
  showHeatmap: boolean;
}

const DEFAULT_PREFS: UiPrefs = {
  threshold: 38,
  opacity: 0.38,
  palette: "thermal",
  showIso: true,
  showHeatmap: true,
};

export function loadPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<UiPrefs>;
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: UiPrefs): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    // 隐私模式下 localStorage 可能不可写，忽略
  }
}
