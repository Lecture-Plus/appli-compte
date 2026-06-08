// ============================================================
// js/db.js – Couche d'accès à la base de données IndexedDB
// ============================================================

const DB_NAME    = 'budgetFoyer';
const DB_VERSION = 1;

let _db = null;

/** Ouvre (ou réutilise) la connexion IndexedDB */
async function openDB() {
  if (_db) return _db;

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onerror = () => reject(new Error('Impossible d\'ouvrir la base de données locale.'));
    req.onsuccess = () => { _db = req.result; resolve(_db); };

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      // Réglages généraux (prénoms, seuils, objectifs…)
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      // Données mensuelles saisies par l'utilisateur
      if (!db.objectStoreNames.contains('monthlyData')) {
        const s = db.createObjectStore('monthlyData', { keyPath: ['year', 'month'] });
        s.createIndex('year', 'year', { unique: false });
      }

      // Charges récurrentes (loyer, EDF, abonnements…)
      if (!db.objectStoreNames.contains('charges')) {
        const s = db.createObjectStore('charges', { keyPath: 'id', autoIncrement: true });
        s.createIndex('category', 'category', { unique: false });
      }

      // Achats exceptionnels (un par occurrence)
      if (!db.objectStoreNames.contains('achats')) {
        const s = db.createObjectStore('achats', { keyPath: 'id', autoIncrement: true });
        s.createIndex('yearMonth', ['year', 'month'], { unique: false });
      }

      // Mode de répartition par mois/année (Séparé, Fixe%, Équitable)
      if (!db.objectStoreNames.contains('repartition')) {
        db.createObjectStore('repartition', { keyPath: ['year', 'month'] });
      }

      // Archives des années clôturées (snapshot figé)
      if (!db.objectStoreNames.contains('archives')) {
        db.createObjectStore('archives', { keyPath: 'year' });
      }
    };
  });
}

/* ── Helpers IDB génériques ── */

async function _get(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  });
}

async function _put(store, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function _delete(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

async function _getAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror   = () => reject(req.error);
  });
}

async function _getAllByIndex(store, index, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).index(index).getAll(key);
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror   = () => reject(req.error);
  });
}

async function _clear(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).clear();
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

/* ── Settings ── */

const SETTING_DEFAULTS = {
  p1Name:             'Personne 1',
  p2Name:             'Personne 2',
  epargneThreshold:   100,
  savingsGoal:        0,
  savingsGoalLabel:   'Mon objectif',
  savingsGoalYear:    new Date().getFullYear(),
  defaultRepartMode:  'separe',
  currency:           '€',
  theme:              'auto',
  lastBackup:         null,
  notifEnabled:       false,
};

export async function getSetting(key) {
  const item = await _get('settings', key);
  return item ? item.value : (SETTING_DEFAULTS[key] ?? null);
}

export async function setSetting(key, value) {
  await _put('settings', { key, value });
}

export async function getAllSettings() {
  const items = await _getAll('settings');
  const map   = Object.fromEntries(items.map(i => [i.key, i.value]));
  return { ...SETTING_DEFAULTS, ...map };
}

/* ── Données mensuelles ── */

/** Retourne les données d'un mois (crée un objet vide si inexistant) */
export async function getMonthlyData(year, month) {
  const data = await _get('monthlyData', [year, month]);
  return data ?? {
    year, month,
    p1:         { revenus: 0, primes: 0, courses: 0, extras: 0, imprevus: 0 },
    p2:         { revenus: 0, primes: 0, courses: 0, extras: 0, imprevus: 0 },
    notes:      '',
    isComplete: false,
  };
}

export async function saveMonthlyData(data) {
  await _put('monthlyData', data);
}

/** Retourne tous les mois d'une année (ou tous si year = null) */
export async function getMonthsByYear(year) {
  if (year) return _getAllByIndex('monthlyData', 'year', year);
  return _getAll('monthlyData');
}

export async function getAllMonthlyData() {
  return _getAll('monthlyData');
}

/** Retourne les années ayant des données saisies */
export async function getAvailableYears() {
  const all  = await _getAll('monthlyData');
  const years = [...new Set(all.map(d => d.year))].sort();
  return years;
}

/* ── Charges récurrentes ── */

export async function getAllCharges() {
  return _getAll('charges');
}

export async function getCharge(id) {
  return _get('charges', id);
}

/** Sauvegarde une charge (création si pas d'id, mise à jour sinon) */
export async function saveCharge(charge) {
  const id = await _put('charges', charge);
  return id;
}

export async function deleteCharge(id) {
  await _delete('charges', id);
}

/**
 * Retourne les charges actives pour un mois donné.
 * Une charge est active si : charge.active === true ET (months === 'all' OU month dans charge.months)
 */
export async function getChargesForMonth(month) {
  const all = await _getAll('charges');
  return all.filter(c => {
    if (!c.active) return false;
    if (c.months === 'all') return true;
    if (Array.isArray(c.months)) return c.months.includes(month);
    return true;
  });
}

/* ── Achats exceptionnels ── */

export async function getAchatsForMonth(year, month) {
  return _getAllByIndex('achats', 'yearMonth', [year, month]);
}

export async function getAllAchats() {
  return _getAll('achats');
}

export async function saveAchat(achat) {
  const id = await _put('achats', achat);
  return id;
}

export async function deleteAchat(id) {
  await _delete('achats', id);
}

/* ── Répartition par mois ── */

export async function getRepartition(year, month) {
  const data = await _get('repartition', [year, month]);
  if (data) return data;
  // Cherche la config par défaut en settings
  const mode = await getSetting('defaultRepartMode');
  return { year, month, mode: mode || 'separe', pct_p1: 50, pct_p2: 50 };
}

export async function saveRepartition(data) {
  await _put('repartition', data);
}

export async function getAllRepartitions() {
  return _getAll('repartition');
}

/* ── Archives ── */

export async function getArchive(year) {
  return _get('archives', year);
}

export async function getAllArchives() {
  return _getAll('archives');
}

export async function saveArchive(archive) {
  await _put('archives', archive);
}

/* ── Export / Import complet ── */

/** Exporte toutes les données en un objet JSON */
export async function exportAllData() {
  const [settings, monthlyData, charges, achats, repartition, archives] = await Promise.all([
    _getAll('settings'),
    _getAll('monthlyData'),
    _getAll('charges'),
    _getAll('achats'),
    _getAll('repartition'),
    _getAll('archives'),
  ]);

  return {
    version:    1,
    appName:    'Budget Foyer',
    exportedAt: new Date().toISOString(),
    settings,
    monthlyData,
    charges,
    achats,
    repartition,
    archives,
  };
}

/** Importe toutes les données depuis un objet JSON (remplace tout) */
export async function importAllData(data) {
  if (!data || data.version !== 1) {
    throw new Error('Format de sauvegarde invalide ou version incompatible.');
  }

  const stores = ['settings', 'monthlyData', 'charges', 'achats', 'repartition', 'archives'];
  const db     = await openDB();

  for (const storeName of stores) {
    await new Promise((resolve, reject) => {
      const tx    = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.clear();
      (data[storeName] || []).forEach(item => store.put(item));
      tx.oncomplete = resolve;
      tx.onerror    = () => reject(tx.error);
    });
  }

  // Met à jour la date de dernière sauvegarde
  await setSetting('lastBackup', new Date().toISOString());
}

/** Efface toutes les données (remise à zéro) */
export async function resetAllData() {
  const stores = ['settings', 'monthlyData', 'charges', 'achats', 'repartition', 'archives'];
  for (const s of stores) await _clear(s);
  _db = null;
}
