#!/usr/bin/env node
// ============================================================
// build.js – Injecte un hash court dans CACHE_NAME de sw.js
// Usage : node build.js
// ============================================================

import { createHash }                       from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { readdirSync, statSync }             from 'fs';
import { join, relative }                    from 'path';

// Résoudre le répertoire du script de façon robuste sur Windows (espaces dans le nom)
import { fileURLToPath } from 'url';
import { dirname }       from 'path';
const BASE = dirname(fileURLToPath(import.meta.url));

const APP_SHELL_LOCAL = [
  'index.html',
  'manifest.json',
  'css/app.css',
  'js/db.js',
  'js/events.js',
  'js/drive.js',
  'js/sync.js',
  'js/calculs.js',
  'js/utils.js',
  'js/app.js',
  'js/insights.js',
  'js/ui/dashboard.js',
  'js/ui/argent.js',
  'js/ui/saisie.js',
  'js/ui/charges.js',
  'js/ui/savings.js',
  'js/ui/budgets.js',
  'js/ui/stats.js',
  'js/ui/settings.js',
];

const hash = createHash('sha256');

for (const rel of APP_SHELL_LOCAL) {
  const fullPath = join(BASE, rel);
  if (!existsSync(fullPath)) {
    console.warn(`[build] Fichier absent (ignoré) : ${rel}`);
    continue;
  }
  hash.update(readFileSync(fullPath));
}

const shortHash  = hash.digest('hex').slice(0, 8);
const cacheName  = `compta-plus-${shortHash}`;

const swPath    = join(BASE, 'sw.js');
const swContent = readFileSync(swPath, 'utf-8');
const updated   = swContent.replace(/compta-plus-[a-zA-Z0-9]+/, cacheName);

if (updated === swContent) {
  console.warn('[build] Aucun CACHE_NAME trouvé dans sw.js — vérifier la regex.');
} else {
  writeFileSync(swPath, updated, 'utf-8');
  console.log(`[build] ✓ CACHE_NAME mis à jour → ${cacheName}`);
}
