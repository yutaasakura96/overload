import type { Page } from '@playwright/test';

/** Everything in the app's own IndexedDB store (device-store.ts), as key → value. */
export function deviceStore(page: Page) {
  return page.evaluate(
    () =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const open = indexedDB.open('overload');
        open.addEventListener('error', () => reject(open.error));
        open.addEventListener('success', () => {
          const store = open.result.transaction('device', 'readonly').objectStore('device');
          const keys = store.getAllKeys();
          const values = store.getAll();
          values.addEventListener('error', () => reject(values.error));
          values.addEventListener('success', () => {
            resolve(
              Object.fromEntries(
                keys.result.map((key, i) => [
                  typeof key === 'string' ? key : JSON.stringify(key),
                  values.result[i],
                ]),
              ),
            );
            open.result.close();
          });
        });
      }),
  );
}

export const deviceKeys = async (page: Page) => Object.keys(await deviceStore(page));

/** The IndexedDB key of one account's saved query cache (query.ts). */
export const cacheKey = (userId: string) => `query-cache:user:${userId}`;

/** One account's saved query cache as its stored string, or '' when there is none. */
export async function savedCache(page: Page, userId: string) {
  const value = (await deviceStore(page))[cacheKey(userId)];
  return typeof value === 'string' ? value : '';
}

/** Writes one value into the app's IndexedDB store. */
export function putDeviceValue(page: Page, key: string, value: unknown) {
  return page.evaluate(
    ({ key: name, value: stored }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('overload');
        open.addEventListener('error', () => reject(open.error));
        open.addEventListener('success', () => {
          const request = open.result
            .transaction('device', 'readwrite')
            .objectStore('device')
            .put(stored, name);
          request.addEventListener('error', () => reject(request.error));
          request.addEventListener('success', () => {
            open.result.close();
            resolve();
          });
        });
      }),
    { key, value },
  );
}
