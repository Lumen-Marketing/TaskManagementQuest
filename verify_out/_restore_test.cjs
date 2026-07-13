const fs=require('fs'), path=require('path');
const ROOT=path.resolve(__dirname,'..');
global.window=global;
let storeData={};
global.localStorage={ getItem:(k)=>k in storeData?storeData[k]:null, setItem:(k,v)=>{storeData[k]=String(v)}, removeItem:(k)=>{delete storeData[k]} };
var stubEl={ classList:{toggle(){},add(){},remove(){},contains(){return false}} }; global.document={ querySelector:()=>null, getElementById:()=>stubEl, querySelectorAll:()=>[], body:stubEl };
let ROLE='worker';
global.App={ can:()=>true, effectiveRole:()=>ROLE, realRole:()=>ROLE, PEOPLE:{}, currentProfile:{id:'u1',member_id:'kristine'}, COMPANIES:{roofing:{label:'Roofing'}} };
eval(fs.readFileSync(path.join(ROOT,'js/EventBus.js'),'utf8'));
eval(fs.readFileSync(path.join(ROOT,'js/controllers/AppController.js'),'utf8'));
const c=new App.AppController({taskModel:{getFiltered:()=>[],find:()=>null,all:()=>[]},timeModel:{activeFor:()=>null},notifModel:{},currentUser:'kristine',dataStore:{}});
let pass=0,fail=0;
const eq=(l,g,w)=>{const ok=g===w;console.log((ok?'PASS':'FAIL')+'  '+l+(ok?'':`  (got ${g}, want ${w})`));ok?pass++:fail++;};

// canView: make person:/company: viewable so the ONLY thing stopping restore is our new guard
c.canView=()=>true;

// 1. a saved person: filter must NOT be restored (stays default 'all')
storeData[c._uiStateKey()]=JSON.stringify({v:1,view:'person:alkeith',layout:'table'});
c.uiState.view='all';
c.restoreUiState();
eq('person: filter not restored', c.uiState.view, 'all');

// 2. a saved company: filter must NOT be restored
storeData[c._uiStateKey()]=JSON.stringify({v:1,view:'company:roofing',layout:'table'});
c.uiState.view='all';
c.restoreUiState();
eq('company: filter not restored', c.uiState.view, 'all');

// 3. a stable view (mine) IS restored
storeData[c._uiStateKey()]=JSON.stringify({v:1,view:'mine',layout:'table'});
c.uiState.view='all';
c.restoreUiState();
eq('stable view (mine) restored', c.uiState.view, 'mine');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
