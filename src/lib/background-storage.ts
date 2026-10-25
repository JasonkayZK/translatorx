import { t as tr } from "./i18n";
import { validateBackgroundData } from "./background-image";

const DB_NAME = "translatorx.background.v1";
const STORE = "assets";
const KEY = "background";
const storageError = () => new Error(tr("errors.backgroundStore"));
let queue = Promise.resolve();

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(storageError());
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(storageError());
    request.onblocked = () => reject(storageError());
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

export async function readBackground(): Promise<string | null> {
  const db = await open();
  try {
    const data = await new Promise<string | null>((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(storageError());
    });
    if (data !== null) await validateBackgroundData(data);
    return data;
  } finally { db.close(); }
}

function mutate(data: string | null): Promise<void> {
  const work = async () => {
    if (data !== null) await validateBackgroundData(data);
    const db = await open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE, "readwrite");
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () => reject(storageError());
        try {
          const store = transaction.objectStore(STORE);
          if (data === null) store.delete(KEY);
          else store.put(data, KEY);
        } catch {
          transaction.abort();
          reject(storageError());
        }
      });
    } finally { db.close(); }
  };
  const run = async () => {
    if (typeof navigator !== "undefined" && navigator.locks) await navigator.locks.request("translatorx-background", work);
    else await work();
  };
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
}

export const writeBackground = (data: string): Promise<void> => mutate(data);
export const deleteBackground = (): Promise<void> => mutate(null);
