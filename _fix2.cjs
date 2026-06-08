const fs = require("fs");
let c = fs.readFileSync("js/ui/charges.js", "utf8");

// 1. Collapse ops list in _buildBudCatSection
const needleOps = "${perUserSection}";
const opsSectionOld = c.indexOf(needleOps);
if (opsSectionOld < 0) { console.log("perUserSection NOT FOUND"); process.exit(1); }
// Find end of the entire card return template
const opsEndMark = "\n  </div>`";
const opsSectionEnd = c.indexOf(opsEndMark, opsSectionOld) + opsEndMark.length;
console.log("ops start:", opsSectionOld, "end:", opsSectionEnd);

const opsNew = [
  '${perUserSection}',
  '    ${sorted.length === 0',
  '      ? `<div style="font-size:0.82rem;color:var(--text-3);text-align:center;padding:8px 0;">Aucune operation - cliquez sur <strong>+ Ajouter</strong></div>`',
  '      : `<button class="btn btn-outline btn-full btn-sm" data-bgt-ops-toggle="${id}" style="font-size:0.78rem;">Voir les operations (${sorted.length})</button>',
  '         <div id="bgt-ops-${id}" style="display:none;margin-top:8px;">',
  '           <div class="item-list">${sorted.map(op => {',
  '             const u = op.userId ? users.find(u => String(u.id)===String(op.userId)) : null;',
  '             const dateStr = op.day ? `${op.day} ${nomMois(op.month)}` : nomMois(op.month);',
  '             return `<div class="list-item" style="position:relative;">',
  '               <div class="list-item-icon" style="background:var(--danger-bg);">NGR</div>',
  '               <div class="list-item-body">',
  '                 <div class="list-item-title">${escHtml(op.label||"Operation")}</div>',
  '                 <div class="list-item-sub">${dateStr}${u?` - ${escHtml(u.name)}`:""}</div>',
  '               </div>',
  '               <div class="list-item-right"><div class="list-item-amount" style="color:var(--danger);">-${eur(op.amount)}</div></div>',
  '               <button class="btn-icon" data-bgt-del-op="${op.id}" style="position:absolute;top:4px;right:4px;width:26px;height:26px;color:var(--text-3);">X</button>',
  '             </div>`;',
  '           }).join("")}</div>',
  '         </div>`',
  '    }',
  '  </div>`'
].join("\n");

c = c.slice(0, opsSectionOld) + opsNew + c.slice(opsSectionEnd);
console.log("ops section replaced, new length:", c.length);
fs.writeFileSync("js/ui/charges.js", c, "utf8");
console.log("done step 1");
