// ============================================================
// js/db.js – Couche d'accès à la base de données IndexedDB
// ============================================================

import { emit, on } from './events.js';

const DB_NAME    = 'budgetFoyer';
const DB_VERSION = 8;  // v8 : _achatsCache + device_settings store + yearMonth index achats

let _db = null;

// ── Dirty flag : on émet 'db:write' via EventBus (remplace l'ancien callback) ──
/** Alias de compatibilité : enregistre un listener sur 'db:write' */
export function onWrite(fn) { on('db:write', fn); }
export { on as onDbEvent };

// ── Cache mémoire (évite les lectures IDB répétées) ──
let _settingsCache = null; // invalidé par setSetting / importAllData / resetAllData
let _usersCache    = null; // invalidé par saveUser / softDeleteUser / restoreUser / importAllData / resetAllData
let _chargesCache  = null; // invalidé par saveCharge / deleteCharge / importAllData / resetAllData
let _achatsCache   = null; // invalidé par saveAchat / deleteAchat / importAllData / resetAllData

/** Invalider les deux caches (ex: après import/reset) */
export function invalidateCache() { _settingsCache = null; _usersCache = null; _chargesCache = null; _achatsCache = null; }

/** Ouvre (ou réutilise) la connexion IndexedDB */
async function openDB() {
  if (_db) return _db;

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onerror   = () => reject(new Error('Impossible d\'ouvrir la base de données locale.'));
    req.onblocked  = () => {
      // Une autre connexion bloque la mise à niveau — fermer le cache local
      console.warn('[DB] Connexion IDB bloquée — rechargez la page.');
      if (_db) { try { _db.close(); } catch (_) {} _db = null; }
    };
    req.onsuccess  = () => {
      _db = req.result;
      // Fermer proprement si un autre onglet/SW demande une mise à niveau
      _db.onversionchange = () => { try { _db.close(); } catch (_) {} _db = null; };
      resolve(_db);
    };

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

      // ── v5 : Épargne salariale ──
      if (!db.objectStoreNames.contains('salary_savings')) {
        const s = db.createObjectStore('salary_savings', { keyPath: 'id', autoIncrement: true });
        s.createIndex('yearMonth', ['year', 'month'], { unique: false });
      }
      if (!db.objectStoreNames.contains('salary_abondements')) {
        db.createObjectStore('salary_abondements', { keyPath: 'id', autoIncrement: true });
      }

      // ── v6-v7 : Objectifs d'épargne multiples ──
      if (!db.objectStoreNames.contains('savings_goals')) {
        db.createObjectStore('savings_goals', { keyPath: 'id', autoIncrement: true });
      }

      // ── v8 : Paramètres de l'appareil (currentDeviceUserId) ──
      if (!db.objectStoreNames.contains('device_settings')) {
        db.createObjectStore('device_settings', { keyPath: 'key' });
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
    req.onsuccess = () => { emit('db:write', { store }); resolve(req.result); };
    req.onerror   = () => reject(req.error);
  });
}

async function _delete(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => { emit('db:write', { store }); resolve(); };
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
  if (_usersCache) return _usersCache;
  const all = await _getAll('users');
  _usersCache = all.filter(u => u.active !== false);
  return _usersCache;
}

export async function getUser(id) {
  return _get('users', Number(id));
}

export async function saveUser(user) {
  _usersCache = null;
  return _put('users', user);
}

/** Soft delete : conserve les données historiques */
export async function softDeleteUser(id) {
  _usersCache = null;
  const u = await getUser(id);
  if (!u) return;
  await _put('users', { ...u, active: false, deletedAt: new Date().toISOString() });
}

/** Restaurer un utilisateur archivé */
export async function restoreUser(id) {
  _usersCache = null;
  const u = await getUser(id);
  if (!u) return;
  await _put('users', { ...u, active: true, deletedAt: null });
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
  salarialePlanned:       {},       // { "userId": monthlyAmount } versements planifiés
  salarialeAbonRatio:     22.58 / 50, // taux abondement (ex: 0.4516)
  salarialeAbonMax:       1000,     // plafond annuel abondement
  salarialeAbonDates:     [{ month: 5, day: 28 }, { month: 11, day: 28 }], // dates d'abondement configurables
};

export async function getSetting(key) {
  const item = await _get('settings', key);
  return item ? item.value : (SETTING_DEFAULTS[key] ?? null);
}

export async function setSetting(key, value) {
  _settingsCache = null;
  await _put('settings', { key, value });
}

export async function getAllSettings() {
  if (_settingsCache) return _settingsCache;
  const items = await _getAll('settings');
  const map   = Object.fromEntries(items.map(i => [i.key, i.value]));
  _settingsCache = { ...SETTING_DEFAULTS, ...map };
  return _settingsCache;
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
   Format : { id, label, category, amount, qui, months, active, perso, dayOfMonth, notes,
              lines: [{ amount, qui, dayOfMonth, priceHistory?: [{ amount, validFrom:'YYYY-MM' }] }] }
   qui : userId string | 'shared'
   priceHistory (par ligne) : entrées triées par validFrom croissant.
     Le montant applicable = dernière entrée avec validFrom <= 'YYYY-MM'.
     Si aucune entrée, `line.amount` est utilisé (montant initial / de base).
══════════════════════════════════════════════════ */

/**
 * Retourne le montant applicable d'une charge pour un couple (year, month) donné,
 * en tenant compte de l'historique des prix (priceHistory).
 * Si aucun historique, retourne charge.amount.
 */
export function resolveChargeAmount(charge, year, month) {
  const history = charge.priceHistory;
  if (!history?.length) return Number(charge.amount) || 0;
  const key = `${year}-${String(month).padStart(2, '0')}`;
  // Trouver la dernière entrée dont validFrom <= key
  let best = null;
  for (const entry of history) {
    if (entry.validFrom <= key) best = entry;
  }
  return best ? (Number(best.amount) || 0) : (Number(charge.amount) || 0);
}

/**
 * Même logique pour une ligne de charge (lines[i]).
 * priceHistory peut aussi exister au niveau de la ligne.
 */
export function resolveLineAmount(line, charge, year, month) {
  // Utiliser uniquement l'historique de la ligne elle-même (pas celui de la charge parente)
  // pour éviter d'appliquer le montant total de la charge à chaque ligne individuelle
  const history = line.priceHistory;
  if (!history?.length) return Number(line.amount) || 0;
  const key = `${year}-${String(month).padStart(2, '0')}`;
  let best = null;
  for (const entry of history) {
    if (entry.validFrom <= key) best = entry;
  }
  return best ? (Number(best.amount) || 0) : (Number(line.amount) || 0);
}

export async function getAllCharges() {
  if (!_chargesCache) _chargesCache = await _getAll('charges');
  return _chargesCache;
}

export async function getCharge(id) {
  return _get('charges', id);
}

export async function saveCharge(charge) {
  _chargesCache = null;
  return _put('charges', charge);
}

export async function deleteCharge(id) {
  _chargesCache = null;
  await _delete('charges', id);
}

export async function getChargesForMonth(month, year = null) {
  const all = await _getAll('charges');
  const result = [];
  for (const c of all) {
    if (!c.active) continue;
    // Nouveau modèle : charge liée à un année+mois précis
    if (c.year != null && c.month != null) {
      if (!year || c.year !== year || c.month !== month) continue;
    } else {
      // Modèle legacy : filtrage par liste de mois
      const applicable = c.months === 'all' || (Array.isArray(c.months) && c.months.includes(month));
      if (!applicable) continue;
    }
    // Expand lines (multi-prélèvement par charge)
    if (c.lines?.length) {
      for (const line of c.lines) {
        const amt = year ? resolveLineAmount(line, c, year, month) : (Number(line.amount) || 0);
        result.push({ ...c, amount: amt, qui: line.qui ?? 'shared', dayOfMonth: line.dayOfMonth ?? null });
      }
    } else {
      const amt = year ? resolveChargeAmount(c, year, month) : (Number(c.amount) || 0);
      result.push({ ...c, amount: amt, qui: c.qui ?? 'shared' });
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
  if (!_achatsCache) _achatsCache = await _getAll('achats');
  return _achatsCache;
}

export async function getAchatsForYear(year) {
  const all = await getAllAchats();
  return all.filter(a => a.year === year);
}

export async function saveAchat(achat) {
  _achatsCache = null;
  return _put('achats', achat);
}

export async function deleteAchat(id) {
  _achatsCache = null;
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
         savings_operations, savings_confirmed,
         budget_ops, salary_savings, salary_abondements, savings_goals] = await Promise.all([
    _getAll('users'),
    _getAll('settings'),
    _getAll('monthlyData'),
    _getAll('charges'),
    _getAll('achats'),
    _getAll('repartition'),
    _getAll('archives'),
    _getAll('savings_operations'),
    _getAll('savings_confirmed'),
    _getAll('budget_ops'),
    _getAll('salary_savings'),
    _getAll('salary_abondements'),
    _getAll('savings_goals'),
  ]);

  return {
    version:    4,   // v4 du format JSON (+ savings_goals)
    dbVersion:  DB_VERSION,
    appName:    'ComptaPlus',
    exportedAt: new Date().toISOString(),
    users, settings, monthlyData, charges, achats,
    repartition, archives, savings_operations, savings_confirmed,
    budget_ops, salary_savings, salary_abondements, savings_goals,
  };
}

// ── Validation avancée d'un fichier de sauvegarde ─────────────────────────────
const _ARRAY_STORES = ['users','monthlyData','charges','achats','repartition',
  'archives','savings_operations','savings_confirmed','budget_ops',
  'salary_savings','salary_abondements','savings_goals'];

/**
 * Valide un objet de sauvegarde avant import.
 * @param {unknown} data
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateImportData(data) {
  const errors = [];
  if (!data || typeof data !== 'object') { return { ok: false, errors: ['Données nulles ou non-objet.'] }; }
  if (data.appName !== 'ComptaPlus')     errors.push(`appName inattendu : "${data.appName}" (attendu: "ComptaPlus")`);
  if (data.version !== undefined && typeof data.version !== 'number') errors.push('version doit être un nombre.');
  for (const store of _ARRAY_STORES) {
    if (data[store] !== undefined && !Array.isArray(data[store]))
      errors.push(`"${store}" doit être un tableau.`);
  }
  // Vérification des users : id + name requis
  if (Array.isArray(data.users)) {
    data.users.forEach((u, i) => {
      if (!u.id)   errors.push(`users[${i}] : champ "id" manquant.`);
      if (!u.name) errors.push(`users[${i}] : champ "name" manquant.`);
    });
  }
  // Vérification des monthlyData : year + month requis
  if (Array.isArray(data.monthlyData)) {
    data.monthlyData.forEach((m, i) => {
      if (typeof m.year  !== 'number') errors.push(`monthlyData[${i}] : "year" doit être un nombre.`);
      if (typeof m.month !== 'number') errors.push(`monthlyData[${i}] : "month" doit être un nombre.`);
    });
  }
  // Vérification des charges : label + amount requis (accepte aussi "name" pour compat exports anciens)
  if (Array.isArray(data.charges)) {
    data.charges.forEach((c, i) => {
      if (!c.label && !c.name) errors.push(`charges[${i}] : "label" manquant.`);
      if (c.amount === undefined) errors.push(`charges[${i}] : "amount" manquant.`);
    });
  }
  return { ok: errors.length === 0, errors };
}

export async function importAllData(data, { silent = false } = {}) {
  const { ok, errors } = validateImportData(data);
  if (!ok) throw new Error('Import invalide : ' + errors.join(' | '));

  // Normaliser "name" → "label" pour les charges (compat exports anciens)
  if (Array.isArray(data.charges)) {
    data.charges = data.charges.map(c => c.label ? c : { ...c, label: c.name || '' });
  }

  // Backup automatique des données actuelles avant destruction
  let _rollbackData = null;
  try { _rollbackData = await exportAllData(); } catch (_) {}

  const stores = ['users', 'settings', 'monthlyData', 'charges', 'achats',
                  'repartition', 'archives', 'savings_operations', 'savings_confirmed',
                  'budget_ops', 'salary_savings', 'salary_abondements', 'savings_goals'];
  const db = await openDB();

  // Transaction atomique multi-stores pour rollback IDB natif en cas d'échec
  await new Promise((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(new Error('Import annulé'));
    for (const storeName of stores) {
      const store = tx.objectStore(storeName);
      store.clear();
      for (const item of (data[storeName] || [])) store.put(item);
    }
  });

  _settingsCache = null; _usersCache = null; _chargesCache = null; _achatsCache = null;
  if (!silent) emit('db:write', { store: 'all' });
  await setSetting('lastBackup', new Date().toISOString());
}

export async function resetAllData() {
  const stores = ['users', 'settings', 'monthlyData', 'charges', 'achats',
                  'repartition', 'archives', 'savings_operations', 'savings_confirmed',
                  'budget_ops', 'salary_savings', 'salary_abondements', 'savings_goals'];
  for (const s of stores) await _clear(s);
  _settingsCache = null; _usersCache = null; _chargesCache = null; _achatsCache = null;
  emit('db:write', { store: 'all' }); // invalider _calcCache dans calculs.js
  if (_db) { try { _db.close(); } catch (_) {} }
  _db = null;
}

/* ══════════════════════════════════════════════════
   PARAMÈTRES APPAREIL (device_settings)
   Stocke les préférences liées à l'appareil physique.
══════════════════════════════════════════════════ */

export async function getDeviceSetting(key) {
  const item = await _get('device_settings', key);
  return item ? item.value : null;
}

export async function setDeviceSetting(key, value) {
  await _put('device_settings', { key, value });
}

/* ══════════════════════════════════════════════════
   OPÉRATIONS ÉPARGNE
══════════════════════════════════════════════════ */

export async function getAllSavingsOperations()           { return _getAll('savings_operations'); }
export async function getSavingsOperationsForMonth(y, m) { return _getAllByIndex('savings_operations', 'yearMonth', [y, m]); }
export async function saveSavingsOperation(op)           { return _put('savings_operations', op); }
export async function deleteSavingsOperation(id)         { return _delete('savings_operations', id); }

/* ── Objectifs d'épargne multiples ── */

export async function getAllSavingsGoals()    { return _getAll('savings_goals'); }
export async function saveSavingsGoal(goal)  { return _put('savings_goals', goal); }
export async function deleteSavingsGoal(id)  { return _delete('savings_goals', id); }

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

export async function getAllSavingsConfirmed()           { return _getAll('savings_confirmed'); }

export async function computeCurrentSavingsBalance() {
  const latest = await getLatestSavingsConfirmed();
  const allOps = await getAllSavingsOperations();
  const base   = latest ? (Number(latest.amount) || 0) : 0;

  const opsSince = latest
    ? allOps.filter(op => {
        // Comparer par timestamp ISO si disponible, sinon par année/mois/jour
        if (op.createdAt && latest.confirmedAt) {
          return op.createdAt > latest.confirmedAt;
        }
        if (op.year  > latest.year)  return true;
        if (op.year  < latest.year)  return false;
        if (op.month > latest.month) return true;
        if (op.month < latest.month) return false;
        return (op.day || 1) > (latest.confirmedDay || 1);
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
export async function saveBudgetOp(op) { const r = await _put('budget_ops', op); emit('budgetop:saved'); return r; }
export async function deleteBudgetOp(id) { return _delete('budget_ops', id); }

/* ── Épargne salariale ── */
export async function getAllSalarySavings()           { return _getAll('salary_savings'); }
export async function saveSalarySaving(op)           { return _put('salary_savings', op); }
export async function deleteSalarySaving(id)         { return _delete('salary_savings', id); }
export async function getAllSalaryAbondements()      { return _getAll('salary_abondements'); }
export async function saveSalaryAbondement(ab)      { return _put('salary_abondements', ab); }
export async function deleteSalaryAbondement(id)    { return _delete('salary_abondements', id); }
