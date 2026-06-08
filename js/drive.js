// ============================================================
// js/drive.js – Synchronisation Google Drive via Apps Script Web App
// Principe : un script Apps Script stocke le JSON de sauvegarde
// dans un fichier "budget-foyer-backup.json" de ton Google Drive.
// Tous les appareils ayant l'URL du Web App partagent les mêmes données.
// ============================================================

export const DRIVE_URL_KEY  = 'driveWebAppUrl';
export const DRIVE_SYNC_KEY = 'driveLastSync';

/** Vérifie que l'URL est une URL de déploiement Apps Script valide */
export function isValidDriveUrl(url) {
  return typeof url === 'string'
    && url.trim().startsWith('https://script.google.com/macros/s/');
}

/**
 * Envoie toutes les données vers Google Drive.
 * Utilise Content-Type: text/plain pour éviter le preflight CORS.
 * @param {string} webAppUrl - URL du Web App Apps Script déployé
 * @param {Object} data      - Objet JS à sauvegarder
 */
export async function pushToDrive(webAppUrl, data) {
  const url = (webAppUrl || '').trim();
  if (!isValidDriveUrl(url)) {
    throw new Error('URL invalide. Elle doit commencer par https://script.google.com/macros/s/');
  }

  const payload = JSON.stringify(data);

  let resp;
  try {
    resp = await fetch(url, {
      method:   'POST',
      headers:  { 'Content-Type': 'text/plain;charset=utf-8' },
      body:     payload,
      redirect: 'follow',
    });
  } catch (e) {
    throw new Error('Impossible de contacter le serveur. Vérifiez votre connexion internet.');
  }

  if (!resp.ok) {
    throw new Error(`Erreur serveur (${resp.status}). Vérifiez que le Web App est bien déployé.`);
  }

  let result;
  try { result = await resp.json(); }
  catch { result = { ok: true }; } // certains navigateurs ne lisent pas la réponse de redirect

  if (result && result.ok === false) {
    throw new Error(result.error || 'Le serveur Apps Script a retourné une erreur.');
  }

  return result;
}

/**
 * Récupère la dernière sauvegarde depuis Google Drive.
 * @param {string} webAppUrl - URL du Web App Apps Script
 * @returns {Object|null}    - Données JSON ou null si pas encore de sauvegarde
 */
export async function pullFromDrive(webAppUrl) {
  const url = (webAppUrl || '').trim();
  if (!isValidDriveUrl(url)) {
    throw new Error('URL invalide.');
  }

  let resp;
  try {
    resp = await fetch(url, { redirect: 'follow' });
  } catch (e) {
    throw new Error('Impossible de contacter le serveur. Vérifiez votre connexion internet.');
  }

  if (!resp.ok) {
    throw new Error(`Erreur serveur (${resp.status}).`);
  }

  let data;
  try { data = await resp.json(); }
  catch { throw new Error('Réponse invalide du serveur.'); }

  // Le serveur retourne { found: false } s'il n'y a pas encore de sauvegarde
  if (data && data.found === false) return null;

  return data;
}
