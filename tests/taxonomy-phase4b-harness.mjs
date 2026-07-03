// Headless harness: stub globals, load constants.js + taxonomy.js, assert the new accessors.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/,'$1'), '..');
const ctx = { window:{}, document:{ addEventListener(){} }, console };
ctx.window.App = {}; ctx.App = ctx.window.App;
vm.createContext(ctx);
for (const f of ['js/constants.js','js/EventBus.js','js/taxonomy.js']) {
  vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'), ctx, { filename:f });
}
const App = ctx.window.App;
App.EventBus = App.EventBus || { emit(){}, on(){} };

// Hydrate with a seeded 'todo' status (has a cls) and a CUSTOM 'signed' status (no cls, hex).
App.taxonomy.hydrate({
  types:   [{ company_id:'roofing', key:'bid', label:'Bid', color:'#111111', sort_order:0, active:true }],
  statuses:[
    { company_id:'roofing', type_key:'bid', key:'todo',   label:'Working on it', color:'#3E7BF2', sort_order:0, is_default:true,  is_done:false, active:true },
    { company_id:'roofing', type_key:'bid', key:'signed', label:'Signed',        color:'#AA00FF', sort_order:1, is_default:false, is_done:true,  active:true },
  ],
  labels:  [{ company_id:'roofing', key:'roof', label:'Roof', color:'#E08A0B', sort_order:0, active:true }],
});

let pass = 0, fail = 0;
const eq = (name, got, want) => { if (JSON.stringify(got)===JSON.stringify(want)) { pass++; } else { fail++; console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); } };

eq('color status seeded', App.taxonomy.color('status','roofing','todo','bid'), '#3E7BF2');
eq('color status custom', App.taxonomy.color('status','roofing','signed','bid'), '#AA00FF');
eq('color label',         App.taxonomy.color('label','roofing','roof'), '#E08A0B');
eq('color missing',       App.taxonomy.color('status','roofing','nope','bid'), null);
// Seeded status key 'todo' keeps its constant cls, no inline style.
eq('chipStyle seeded uses cls', App.taxonomy.chipStyle('status','roofing','todo','bid'),
   { cls: App.STATUSES.todo.cls, style: '' });
// Custom key 'signed' has no cls in constants -> inline hex.
eq('chipStyle custom uses hex', App.taxonomy.chipStyle('status','roofing','signed','bid'),
   { cls: '', style: 'background:#AA00FF1a;color:#AA00FF;' });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
