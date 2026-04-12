/**
 * IndexedDB ラッパー
 * シンプルな Promise API で各ストアに CRUD 操作を提供する。
 */
const DB_NAME = 'sedori-app';
const DB_VERSION = 2;

const DB = (() => {
  let _db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (_db) return resolve(_db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('products')) {
          const s = db.createObjectStore('products', { keyPath: 'id' });
          s.createIndex('status', 'status', { unique: false });
          s.createIndex('purchaseDate', 'purchaseDate', { unique: false });
          s.createIndex('saleDate', 'saleDate', { unique: false });
        }
        if (!db.objectStoreNames.contains('expenses')) {
          const s = db.createObjectStore('expenses', { keyPath: 'id' });
          s.createIndex('date', 'date', { unique: false });
          s.createIndex('category', 'category', { unique: false });
        }
        if (!db.objectStoreNames.contains('images')) {
          const s = db.createObjectStore('images', { keyPath: 'id' });
          s.createIndex('productId', 'productId', { unique: false });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('packaging')) {
          const s = db.createObjectStore('packaging', { keyPath: 'id' });
          s.createIndex('name', 'name', { unique: false });
        }
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(storeNames, mode = 'readonly') {
    return open().then(db => db.transaction(storeNames, mode));
  }

  function reqPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function put(store, value) {
    const t = await tx(store, 'readwrite');
    return reqPromise(t.objectStore(store).put(value));
  }
  async function get(store, key) {
    const t = await tx(store);
    return reqPromise(t.objectStore(store).get(key));
  }
  async function del(store, key) {
    const t = await tx(store, 'readwrite');
    return reqPromise(t.objectStore(store).delete(key));
  }
  async function getAll(store) {
    const t = await tx(store);
    return reqPromise(t.objectStore(store).getAll());
  }
  async function getByIndex(store, indexName, value) {
    const t = await tx(store);
    const idx = t.objectStore(store).index(indexName);
    return reqPromise(idx.getAll(value));
  }
  async function clear(store) {
    const t = await tx(store, 'readwrite');
    return reqPromise(t.objectStore(store).clear());
  }

  // ----- 高レベル API -----
  const Products = {
    list: () => getAll('products'),
    get: (id) => get('products', id),
    save: (p) => { p.updatedAt = Date.now(); if (!p.createdAt) p.createdAt = Date.now(); return put('products', p); },
    remove: (id) => del('products', id)
  };
  const Expenses = {
    list: () => getAll('expenses'),
    get: (id) => get('expenses', id),
    save: (e) => { if (!e.createdAt) e.createdAt = Date.now(); return put('expenses', e); },
    remove: (id) => del('expenses', id)
  };
  const Images = {
    save: (img) => put('images', img),
    get: (id) => get('images', id),
    byProduct: (pid) => getByIndex('images', 'productId', pid),
    remove: (id) => del('images', id)
  };
  const Settings = {
    get: async (key, fallback = null) => {
      const v = await get('settings', key);
      return v ? v.value : fallback;
    },
    set: (key, value) => put('settings', { key, value })
  };
  const Packaging = {
    list: () => getAll('packaging'),
    get: (id) => get('packaging', id),
    save: (p) => {
      p.updatedAt = Date.now();
      if (!p.createdAt) p.createdAt = Date.now();
      return put('packaging', p);
    },
    remove: (id) => del('packaging', id),
    adjust: async (id, delta) => {
      const cur = await get('packaging', id);
      if (!cur) return null;
      cur.count = Math.max(0, (cur.count || 0) + delta);
      cur.updatedAt = Date.now();
      await put('packaging', cur);
      return cur;
    }
  };

  async function exportAll() {
    const [products, expenses, images, packaging, feePresets] = await Promise.all([
      Products.list(), Expenses.list(), getAll('images'), Packaging.list(),
      Settings.get('feePresets', DEFAULT_FEE_PRESETS)
    ]);
    // 画像は Blob を base64 に
    const imagesSerialized = await Promise.all(images.map(async i => ({
      ...i,
      blob: await blobToBase64(i.blob)
    })));
    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      products, expenses, packaging,
      images: imagesSerialized,
      settings: { feePresets }
    };
  }

  async function importAll(data) {
    if (!data || (data.version !== 1 && data.version !== 2)) {
      throw new Error('不正なバックアップデータです。');
    }
    await Promise.all(['products','expenses','images','packaging'].map(s => clear(s)));
    for (const p of (data.products || [])) await Products.save(p);
    for (const e of (data.expenses || [])) await Expenses.save(e);
    for (const i of (data.images || [])) {
      const blob = await base64ToBlob(i.blob, i.mimeType);
      await Images.save({ ...i, blob });
    }
    for (const pk of (data.packaging || [])) await Packaging.save(pk);
    if (data.settings?.feePresets) await Settings.set('feePresets', data.settings.feePresets);
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }
  async function base64ToBlob(dataUrl, mime) {
    const res = await fetch(dataUrl);
    return await res.blob();
  }

  return { open, Products, Expenses, Images, Settings, Packaging, exportAll, importAll };
})();
