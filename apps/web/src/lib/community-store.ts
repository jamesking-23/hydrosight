"use client";
import type { QueueStore, QueuedReport } from "@/lib/community";

const DB = "hydrosight-community";
const STORE = "queue";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "clientId" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("could not open local storage"));
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = () => reject(tx.error ?? new Error("local storage failed"));
      }),
  );
}

/** Reports waiting on this phone. Survives reloads and being offline. */
export const indexedDbStore: QueueStore = {
  all: () => run<QueuedReport[]>("readonly", (s) => s.getAll() as IDBRequest<QueuedReport[]>),
  put: (item) => run("readwrite", (s) => s.put(item)).then(() => undefined),
  remove: (id) => run("readwrite", (s) => s.delete(id)).then(() => undefined),
};
