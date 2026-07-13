// Verify the watched-tasks filter used by _renderWatchedTasksInto:
//   !cleared && status!=='done' && watchers.includes(me), + company scope.
const me='abraham';
const tasks=[
  {id:'a', watchers:['abraham'], status:'todo',   company:'roofing'},               // mine, included
  {id:'b', watchers:['kristine'], status:'todo',  company:'roofing'},               // not watching -> out
  {id:'c', watchers:['abraham'], status:'done',   company:'roofing'},               // done -> out
  {id:'d', watchers:['abraham'], status:'todo',   company:'lumen'},                 // diff company
  {id:'e', watchers:['abraham'], status:'review', company:'roofing', clearedAt:1},  // cleared -> out
  {id:'f', watchers:['abraham','x'], status:'review', company:'roofing'},           // included (assigned elsewhere irrelevant)
];
function watched(cur){
  let w = tasks.filter(t => !t.clearedAt && t.status !== 'done' && (t.watchers||[]).includes(me));
  if (cur && cur !== '*') w = w.filter(t => t.company === cur);
  return w.map(t=>t.id);
}
let pass=0,fail=0;
const eq=(l,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);console.log((ok?'PASS':'FAIL')+'  '+l+(ok?'':`  got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));ok?pass++:fail++;};
eq('all companies: watched, not done, not cleared', watched('*'), ['a','d','f']);
eq('roofing scope: drops lumen task d', watched('roofing'), ['a','f']);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
