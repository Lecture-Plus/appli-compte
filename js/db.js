// ============================================================
// js/db.js – Couche d'accès à la base de données IndexedDB
// ============================================================

const DB_NAME    = 'budgetFoyer';
const DB_VERSION = 4;  // v4 : budget_ops store

let _db = null;

/** Ouvre (ou réutilise) la connexion IndexedDB */
async function openDB() {
  if (_db) return _db;

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onerror = () => reject(new Error('Impossible d\'ouvrir la base de données locale.'));
    req.onsuccess = () => { _db = req.result; resolve(_db); };

    req.onupgradeneeded = (e) => {
      const db         = e.target.result;
      const oldVersion = e.oldVersion;

      // ── Rupture propre v2→v3 : on supprime tout et on repart à zéro ──
      if (oldVersion > 0 && oldVersion < 3) {
        for (const name of [...db.objectStoreNames]) {
          db.deleteObjectStore(name);
        }
      }

      // ── Utilisateurs du foyer ──
      if (!db.objectStoreNames.contains('users')) {
        const s = db.createObjectStore('users', { keyPath: 'id', autoIncrement: true });
        s.createIndex('active', 'active', { unique: false });
      }

      // ── Réglages généraux ──
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      // ── Données mensuelles : { year, month, users: {"1": {...}, "2": {...}}, notes, isComplete } ──
      if (!db.objectStoreNames.contains('monthlyData')) {
        const s = db.createObjectStore('monthlyData', { keyPath: ['year', 'month'] });
        s.createIndex('year', 'year', { unique: false });
      }

      // ── Charges récurrentes ──
      if (!db.objectStoreNames.contains('charges')) {
        const s = db.createObjectStore('charges', { keyPath: 'id', autoIncrement: true });
        s.createIndex('category', 'category', { unique: false });
      }

      // ── Achats exceptionnels ──
      if (!db.objectStoreNames.contains('achats')) {
        const s = db.createObjectStore('achats', { keyPath: 'id', autoIncrement: true });
        s.createIndex('yearMonth', ['year', 'month'], { unique: false });
      }

      // ── Mode de répartition par mois : { year, month, mode, pcts: {"1": 60, "2": 40} } ──
      if (!db.objectStoreNames.contains('repartition')) {
        db.createObjectStore('repartition', { keyPath: ['year', 'month'] });
      }

      // ── Archives ──
      if (!db.objectStoreNames.contains('archives')) {
        db.createObjectStore('archives', { keyPath: 'year' });
      }

      // ── Opérations épargne ──
      if (!db.objectStoreNames.contains('savings_operations')) {
        const s = db.createObjectStore('savings_operations', { keyPath: 'id', autoIncrement: true });
        s.createIndex('yearMonth', ['year', 'month'], { unique: false });
        s.createIndex('year',      'year',            { unique: false });
      }

      // ── Confirmations mensuelles épargne ──
      if (!db.objectStoreNames.contains('savings_confirmed')) {
        db.createObjectStore('savings_confirmed', { keyPath: ['year', 'month'] });
      }

      // ── Opérations de suivi budget (courses, extras) ──
      if (!db.objectStoreNames.contains('budget_ops')) {
        const s = db.createObjectStore('budget_ops', { keyPath: 'id', autoIncrement: true });
        s.createIndex('yearMonth',  ['year', 'month'],            { unique: false });
        s.createIndex('category',   'category',                   { unique: false });
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

/* ══════════════════════════════════════════════════
   UTILISATEURS
══════════════════════════════════════════════════ */

export const USER_COLORS = ['#6C63FF','#00C896','#FFB020','#FF4757','#3DBAFF','#FF6B9D'];

/** Retourne tous les utilisateurs (actifs + supprimés, pour historique) */
export async function getAllUsers() {
  return _getAll('users');
}

/** Retourne les utilisateurs actifs uniquement */
export async function getActiveUsers() {
  const all = await _getAll('users');
  return all.filter(u => u.active !== false);
}

export async function getUser(id) {
  return _get('users', Number(id));
}

export async function saveUser(user) {
  return _put('users', user);
}

/** Soft delete : conserve les données historiques */
export async function softDeleteUser(id) {
  const u = await getUser(id);
  if (!u) return;
  await _put('users', { ...u, active: false, deletedAt: new Date().toISOString() });
}

/* ══════════════════════════════════════════════════
   SETTINGS
══════════════════════════════════════════════════ */

const SETTING_DEFAULTS = {
  epargneThreshold:       100,
  savingsGoal:            0,
  savingsGoalLabel:       'Mon objectif',
  savingsGoalYear:        new Date().getFullYear(),
  savingsGoalsByUser:     {},       // { "userId": goalAmount }
  weeklyCoursesEstimate:  85,
  defaultRepartMode:      'equitable',
  budgetCibles:           { courses: 0, extras: 0, imprevus: 0 },
  currency:               '€',
  theme:                  'auto',
  lastBackup:             null,
  driveLastSync:          null,
  notifEnabled:           false,
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

/* ══════════════════════════════════════════════════
   DONNÉES MENSUELLES
══════════════════════════════════════════════════ */

const EMPTY_USER_DATA = () => ({ revenus: 0, primes: 0, courses: 0, extras: 0, imprevus: 0 });

export async function getMonthlyData(year, month) {
  const data = await _get('monthlyData', [year, month]);
  return data ?? { year, month, users: {}, notes: '', isComplete: false };
}

export async function saveMonthlyData(data) {
  await _put('monthlyData', data);
}

export async function getMonthsByYear(year) {
  if (year) return _getAllByIndex('monthlyData', 'year', year);
  return _getAll('monthlyData');
}

export async function getAllMonthlyData() {
  return _getAll('monthlyData');
}

export async function getAvailableYears() {
  const all   = await _getAll('monthlyData');
  const years = [...new Set(all.map(d => d.year))].sort();
  return years;
}

/** Retourne les données d'un user dans un monthlyData (crée si absent) */
export function getUserMonthData(monthData, userId) {
  const uid = String(userId);
  if (!monthData.users)        monthData.users = {};
  if (!monthData.users[uid])   monthData.users[uid] = EMPTY_USER_DATA();
  return monthData.users[uid];
}

/* ══════════════════════════════════════════════════
   CHARGES RÉCURRENTES
   Format : { id, label, category, amount, qui, months, active, perso, dayOfMonth, notes }
   qui : userId string | 'shared'
══════════════════════════════════════════════════ */

export async function getAllCharges() {
  return _getAll('charges');
}

export async function getCharge(id) {
  return _get('charges', id);
}

export async function saveCharge(charge) {
  return _put('charges', charge);
}

export async function deleteCharge(id) {
  await _delete('charges', id);
}

export async function getChargesForMonth(month) {
  const all = await _getAll('charges');
  const result = [];
  for (const c of all) {
    if (!c.active) continue;
    const applicable = c.months === 'all' || (Array.isArray(c.months) && c.months.includes(month));
    if (!applicable) continue;
    // Expand lines (multi-prélèvement par charge)
    if (c.lines?.length) {
      for (const line of c.lines) {
        result.push({ ...c, amount: Number(line.amount) || 0, qui: line.qui ?? 'shared', dayOfMonth: line.dayOfMonth ?? null });
      }
    } else {
      result.push(c);
    }
  }
  return result;
}

/* ══════════════════════════════════════════════════
   ACHATS EXCEPTIONNELS
   Format : { id, year, month, label, amount, qui, category, craquage_source, day, createdAt }
   qui : userId string | 'shared'
══════════════════════════════════════════════════ */

export async function getAchatsForMonth(year, month) {
  return _getAllByIndex('achats', 'yearMonth', [year, month]);
}

export async function getAllAchats() {
  return _getAll('achats');
}

export async function saveAchat(achat) {
  return _put('achats', achat);
}

export async function deleteAchat(id) {
  await _delete('achats', id);
}

/* ══════════════════════════════════════════════════
   RÉPARTITION
   Format : { year, month, mode, pcts: {"1": 60, "2": 40} }
══════════════════════════════════════════════════ */

export async function getRepartition(year, month) {
  const data = await _get('repartition', [year, month]);
  if (data) return data;
  const mode = await getSetting('defaultRepartMode');
  return { year, month, mode: mode || 'separe', pcts: {} };
}

export async function saveRepartition(data) {
  await _put('repartition', data);
}

export async function getAllRepartitions() {
  return _getAll('repartition');
}

/* ══════════════════════════════════════════════════
   ARCHIVES
══════════════════════════════════════════════════ */

export async function getArchive(year)       { return _get('archives', year); }
export async function getAllArchives()        { return _getAll('archives'); }
export async function saveArchive(archive)   { await _put('archives', archive); }

/* ══════════════════════════════════════════════════
   EXPORT / IMPORT COMPLET
══════════════════════════════════════════════════ */

export async function exportAllData() {
  const [users, settings, monthlyData, charges, achats, repartition, archives,
         savings_operations, savings_confirmed] = await Promise.all([
    _getAll('users'),
    _getAll('settings'),
    _getAll('monthlyData'),
    _getAll('charges'),
    _getAll('achats'),
    _getAll('repartition'),
    _getAll('archives'),
    _getAll('savings_operations'),
    _getAll('savings_confirmed'),
  ]);

  return {
    version:    2,   // v2 du format JSON (multi-users)
    appName:    'Budget Foyer',
    exportedAt: new Date().toISOString(),
    users, settings, monthlyData, charges, achats,
    repartition, archives, savings_operations, savings_confirmed,
  };
}

export async function importAllData(data) {
  if (!data || !data.appName) {
    throw new Error('Format de sauvegarde invalide.');
  }

  const stores = ['users', 'settings', 'monthlyData', 'charges', 'achats',
                  'repartition', 'archives', 'savings_operations', 'savings_confirmed'];
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

  await setSetting('lastBackup', new Date().toISOString());
}

export async function resetAllData() {
  const stores = ['users', 'settings', 'monthlyData', 'charges', 'achats',
                  'repartition', 'archives', 'savings_operations', 'savings_confirmed'];
  for (const s of stores) await _clear(s);
  _db = null;
}

/* ══════════════════════════════════════════════════
   OPÉRATIONS ÉPARGNE
══════════════════════════════════════════════════ */

export async function getAllSavingsOperations()           { return _getAll('savings_operations'); }
export async function getSavingsOperationsForMonth(y, m) { return _getAllByIndex('savings_operations', 'yearMonth', [y, m]); }
export async function saveSavingsOperation(op)           { return _put('savings_operations', op); }
export async function deleteSavingsOperation(id)         { return _delete('savings_operations', id); }

/* ── Confirmations mensuelles ── */

export async function getSavingsConfirmed(year, month)   { return _get('savings_confirmed', [year, month]); }
export async function saveSavingsConfirmed(data)         { return _put('savings_confirmed', data); }

export async function getLatestSavingsConfirmed() {
  const all = await _getAll('savings_confirmed');
  if (!all.length) return null;
  return all.sort((a, b) => {
    if (a.year  !== b.year)  return b.year  - a.year;
    return b.month - a.month;
  })[0];
}

export async function computeCurrentSavingsBalance() {
  const latest = await getLatestSavingsConfirmed();
  const allOps = await getAllSavingsOperations();
  const base   = latest ? (Number(latest.amount) || 0) : 0;

  const opsSince = latest
    ? allOps.filter(op => {
        if (op.year  > latest.year)  return true;
        if (op.year  < latest.year)  return false;
        if (op.month > latest.month) return true;
        if (op.month < latest.month) return false;
        return (op.day || 1) >= (latest.confirmedDay || 1);
      })
    : allOps;

  const delta = opsSince.reduce((s, op) => s + (Number(op.amount) || 0), 0);
  return { balance: base + delta, base, delta, latest, opsSince };
}

/* ── Opérations suivi budget ── */

export async function getBudgetOpsForMonth(year, month) {
  return _getAllByIndex('budget_ops', 'yearMonth', [year, month]);
}
export async function getAllBudgetOps() { return _getAll('budget_ops'); }
export async function saveBudgetOp(op) { return _put('budget_ops', op); }
export async function deleteBudgetOp(id) { return _delete('budget_ops', id); }
