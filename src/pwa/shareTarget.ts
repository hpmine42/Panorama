const DATABASE_NAME = 'panorama-viewer';
const DATABASE_VERSION = 1;
const STORE_NAME = 'incoming-shares';

interface IncomingShareRecord {
  id: string;
  blob: Blob;
  name: string;
  type: string;
  lastModified: number;
  receivedAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB konnte nicht geöffnet werden.'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB-Anfrage fehlgeschlagen.'));
  });
}

/** Reads and removes the newest file written by the share-target service worker. */
export async function consumeIncomingShare(): Promise<File | null> {
  if (!('indexedDB' in window)) return null;

  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const records = await requestResult<IncomingShareRecord[]>(store.getAll());
    if (!records.length) return null;
    records.sort((left, right) => right.receivedAt - left.receivedAt);
    const newest = records[0];
    store.delete(newest.id);
    // Remove stale shares too; a share that was not consumed should never
    // accumulate indefinitely in local storage.
    for (const record of records.slice(1)) store.delete(record.id);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Share konnte nicht entfernt werden.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Share konnte nicht entfernt werden.'));
    });
    return new File([newest.blob], newest.name || 'shared-image', {
      type: newest.type || newest.blob.type || 'image/*',
      lastModified: newest.lastModified || Date.now(),
    });
  } finally {
    database.close();
  }
}

export function isShareLaunch(): boolean {
  return new URLSearchParams(window.location.search).get('shared') === '1';
}

export function clearShareLaunchUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('shared');
  url.searchParams.delete('share-target');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}
