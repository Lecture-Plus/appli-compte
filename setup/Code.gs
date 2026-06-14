/**
 * ================================================================
 *  Budget Foyer – Sync Google Drive (version multi-backups)
 *
 *  ▶ INSTRUCTIONS D'INSTALLATION :
 *  1. https://script.google.com → Nouveau projet "Budget Foyer Sync"
 *  2. Coller ce code, enregistrer
 *  3. Déployer → Application Web
 *     - Exécuter en tant que : Moi
 *     - Accès autorisé à : Tout le monde
 *  4. Copier l'URL et la coller dans l'app → Réglages → Sync Drive
 *
 *  ▶ COMPORTEMENT :
 *  - doPost  : crée backup_YYYY-MM-DD_HH-MM-SS.json, garde max 5 fichiers
 *  - doGet   : ?action=list  → liste des backups [{filename, savedAt, size}]
 *              ?file=NOM     → retourne ce backup précis
 *              (aucun param) → retourne le plus récent
 * ================================================================
 */

const FOLDER_NAME = 'Backup Compta+';
const MAX_BACKUPS = 25;

// ── Utilitaires Drive ──

function getFolder_() {
  const folders = DriveApp.getFoldersByName(FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(FOLDER_NAME);
}

function listBackupFiles_(folder) {
  const files   = folder.getFiles();
  const backups = [];
  while (files.hasNext()) {
    const f = files.next();
    const n = f.getName();
    if (n.startsWith('backup_') && n.endsWith('.json')) {
      backups.push({ file: f, filename: n, date: f.getLastUpdated() });
    }
  }
  // Trier du plus récent au plus ancien
  backups.sort((a, b) => b.date - a.date);
  return backups;
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── GET ──

function doGet(e) {
  try {
    const action   = e.parameter ? e.parameter.action   : null;
    const filename = e.parameter ? e.parameter.file     : null;
    const folder   = getFolder_();
    const backups  = listBackupFiles_(folder);

    // ?action=list → retourne la liste
    if (action === 'list') {
      return jsonOut_({
        backups: backups.map(b => ({
          filename: b.filename,
          savedAt:  b.date.toISOString(),
          size:     b.file.getSize(),
        }))
      });
    }

    // ?file=NOM → retourne ce fichier précis
    if (filename) {
      const match = backups.find(b => b.filename === filename);
      if (!match) return jsonOut_({ found: false, error: 'Fichier non trouvé.' });
      let parsed;
      try { parsed = JSON.parse(match.file.getBlob().getDataAsString('UTF-8')); }
      catch(err) { return jsonOut_({ found: false, error: 'Fichier corrompu.' }); }
      return jsonOut_(parsed);
    }

    // Aucun param → retourne le plus récent
    if (!backups.length) return jsonOut_({ found: false, message: 'Aucune sauvegarde.' });
    let parsed;
    try { parsed = JSON.parse(backups[0].file.getBlob().getDataAsString('UTF-8')); }
    catch(err) { return jsonOut_({ found: false, error: 'Fichier corrompu.' }); }
    return jsonOut_(parsed);

  } catch(err) {
    return jsonOut_({ ok: false, error: err.toString() });
  }
}

// ── POST ──

function doPost(e) {
  try {
    const body = e.postData ? e.postData.contents : '';
    if (!body) return jsonOut_({ ok: false, error: 'Corps vide.' });

    let parsed;
    try { parsed = JSON.parse(body); }
    catch(err) { return jsonOut_({ ok: false, error: 'JSON invalide.' }); }

    if (!parsed.appName) {
      return jsonOut_({ ok: false, error: 'Format non reconnu.' });
    }

    // Nom du fichier (envoyé par le client, ou généré ici)
    const filename = (e.parameter && e.parameter.filename)
      ? e.parameter.filename
      : 'backup_' + Utilities.formatDate(new Date(), 'UTC', "yyyy-MM-dd_HH-mm-ss") + '.json';

    const folder = getFolder_();

    // Créer le nouveau backup
    folder.createFile(filename, body, MimeType.PLAIN_TEXT);

    // Supprimer les anciens backups si > MAX_BACKUPS
    const backups = listBackupFiles_(folder);
    if (backups.length > MAX_BACKUPS) {
      backups.slice(MAX_BACKUPS).forEach(b => b.file.setTrashed(true));
    }

    return jsonOut_({
      ok:       true,
      filename: filename,
      savedAt:  new Date().toISOString(),
      kept:     Math.min(backups.length, MAX_BACKUPS),
    });

  } catch(err) {
    return jsonOut_({ ok: false, error: err.toString() });
  }
}

 *
 *  1. Aller sur https://script.google.com
 *  2. Créer un nouveau projet : "Nouveau projet"
 *  3. Nommer le projet : "Budget Foyer Sync"
 *  4. Remplacer tout le contenu par CE fichier
 *  5. Cliquer sur "Déployer" → "Nouveau déploiement"
 *  6. Type : "Application Web"
 *  7. Exécuter en tant que : "Moi"
 *  8. Accès autorisé à : "Tout le monde"
 *  9. Cliquer "Déployer" → Autoriser les permissions
 * 10. Copier l'URL du Web App (commence par https://script.google.com/macros/s/...)
 * 11. Coller cette URL dans l'application → Réglages → Sync Google Drive
 *
 *  ▶ PARTAGE ENTRE APPAREILS :
 *  Toutes les personnes qui ont l'URL peuvent lire/écrire les données.
 *  Partagez simplement l'URL avec votre partenaire (via message, mail…).
 *  Chacun la colle dans ses Réglages → Sync Google Drive.
 *
 *  ▶ OÙ SONT STOCKÉES LES DONNÉES ?
 *  Dans votre Google Drive → dossier "Budget Foyer" → fichier "backup.json"
 * ================================================================
 */

const FOLDER_NAME = 'Budget Foyer';
const FILE_NAME   = 'backup.json';

// ── Utilitaires Drive ──

function getFolder_() {
  const folders = DriveApp.getFoldersByName(FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(FOLDER_NAME);
}

function getFile_() {
  const folder = getFolder_();
  const files  = folder.getFilesByName(FILE_NAME);
  return files.hasNext() ? files.next() : null;
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── GET → Récupérer la sauvegarde ──

function doGet(e) {
  try {
    const file = getFile_();

    if (!file) {
      return jsonOut_({ found: false, message: 'Aucune sauvegarde trouvée.' });
    }

    const content = file.getBlob().getDataAsString('UTF-8');

    // Validation rapide
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch(err) {
      return jsonOut_({ found: false, error: 'Fichier de sauvegarde corrompu.' });
    }

    // On retourne directement le contenu parsé
    return jsonOut_(parsed);

  } catch(err) {
    return jsonOut_({ ok: false, error: err.toString() });
  }
}

// ── POST → Sauvegarder les données ──

function doPost(e) {
  try {
    const body = e.postData ? e.postData.contents : '';

    if (!body) {
      return jsonOut_({ ok: false, error: 'Corps de la requête vide.' });
    }

    // Validation JSON
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch(err) {
      return jsonOut_({ ok: false, error: 'Données JSON invalides.' });
    }

    // Vérification minimale du format Budget Foyer
    if (!parsed.version || !parsed.appName) {
      return jsonOut_({ ok: false, error: 'Format de sauvegarde non reconnu. Assurez-vous d\'exporter depuis l\'application Budget Foyer.' });
    }

    const folder = getFolder_();
    const file   = getFile_();

    if (file) {
      // Mise à jour du fichier existant
      file.setContent(body);
    } else {
      // Création du fichier
      folder.createFile(FILE_NAME, body, MimeType.PLAIN_TEXT);
    }

    return jsonOut_({
      ok:      true,
      savedAt: new Date().toISOString(),
      size:    body.length,
    });

  } catch(err) {
    return jsonOut_({ ok: false, error: err.toString() });
  }
}
