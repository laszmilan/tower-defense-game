const {test}=require('node:test');
const vm=require('node:vm'), fs=require('node:fs'), assert=require('node:assert/strict');
const {GameSimulation}=require('./game-model.js');
class Element {
  constructor(attrs={}) {this.attrs=attrs;this.children=[];this.handlers={};this.textContent='';this.hidden=true;this.value='';this.dataset={};this.classList={contains:c=>(this.attrs.class||'').split(' ').includes(c),toggle:(c,on)=>{const s=new Set((this.attrs.class||'').split(' '));on?s.add(c):s.delete(c);this.attrs.class=[...s].join(' ');}};}
  getAttribute(k){return this.attrs[k]??null;} setAttribute(k,v){this.attrs[k]=String(v);} append(...elements){for(const e of elements){this.children.push(e);e.parent=this;}} remove(){this.parent.children=this.parent.children.filter(e=>e!==this);} querySelector(){return this.label;} addEventListener(k,f){this.handlers[k]=f;} contains(e){return this.children.includes(e);} reportValidity(){return true;}
}
function setup() {
  const html=fs.readFileSync('index.html','utf8');
  const cities=[...html.matchAll(/<g class="(town|capital)" transform="(translate\([^)]+\))">.*?<text([^>]*)>([^<]+)<\/text>/g)].map(m=>{const e=new Element({class:m[1],transform:m[2]});e.label=new Element(Object.fromEntries([...m[3].matchAll(/([\w-]+)="([^"]+)"/g)].map(a=>[a[1],a[2]])));e.label.textContent=m[4];return e;});
  const ids=Object.fromEntries(['resources','morale','income','pause-status','debug-panel','raids','raid-form','uav-count','debug-result','debug-performance','build-radar','radar-status','build-sam','sam-status','sam-ammo','map','country','radars','sam-sites','radar-preview','preview-range','interceptors','effects'].map(k=>['#'+k,new Element()]));
  ids['#map'].createSVGPoint=()=>({x:0,y:0,matrixTransform(){return this;}});
  ids['#map'].getScreenCTM=()=>({inverse(){return this;}});
  ids['#country'].isPointInFill=point=>point.x>=100 && point.x<=850 && point.y>=40 && point.y<=670;
  const river=new Element();
  river.getTotalLength=()=>600;
  river.getPointAtLength=distance=>({x:470,y:distance+40});
  const buttons=[1,3,5].map(speed=>{const e=new Element();e.dataset.speed=speed;return e;});
  let now=0,frame,keydown;
  class DeterministicGame extends GameSimulation {constructor(cities){super(cities,()=>0.5);}}
  vm.runInNewContext(fs.readFileSync('game.js','utf8'),{GameSimulation:DeterministicGame,document:{createElementNS:()=>new Element(),querySelector:s=>ids[s],querySelectorAll:s=>s==='.town, .capital'?cities:s==='.river path'?[river]:buttons,addEventListener:(_,fn)=>keydown=fn,activeElement:null},performance:{now:()=>now},requestAnimationFrame:fn=>frame=fn});
  return {ids,cities,buttons,key:(key,code)=>keydown({key,code,target:{tagName:'BODY'},preventDefault(){}}),tick:(ms, frameOffset=0)=>{now+=ms;frame(now+frameOffset);},spawn:count=>{ids['#uav-count'].value=String(count);ids['#raid-form'].handlers.submit({preventDefault(){}});}};
}
test('warning arrow precedes UAVs; warning respects pause and speed',()=>{
  const {ids,key,tick,spawn}=setup();
  ids['#build-radar'].handlers.click();
  ids['#map'].handlers.click({clientX:550,clientY:540});
  key('d','KeyD');assert.equal(ids['#debug-panel'].hidden,false);
  spawn(3);
  assert.match(ids['#debug-result'].textContent,/Arrival in 30s/);
  const group=ids['#raids'].children[0],tracks=group.children[1];
  assert.equal(group.children[2].textContent,'30s');
  assert.equal(tracks.attrs.d,'');assert.ok(group.children[0].classList.contains('raid-warning'));
  key(' ','Space');tick(60000);assert.equal(tracks.attrs.d,'');
  assert.equal(group.children[2].textContent,'30s');
  key('3','Digit3');key(' ','Space');tick(5999);assert.equal(tracks.attrs.d,'');
  assert.equal(group.children[2].textContent,'1s');
  tick(1);assert.equal(tracks.attrs.d,'');assert.ok(!group.children[0].classList.contains('raid-warning'));
  assert.equal(group.children[0].attrs.visibility,'hidden');
  assert.equal(group.children[2].textContent,'');
  tick(1000);assert.notEqual(tracks.attrs.d,'');
  tick(20000);assert.equal(ids['#raids'].children.length,0);
});
test('spawn spam bounds SVG nodes and reports limits',()=>{
  const {ids,key,tick,spawn}=setup();
  key('d','KeyD');key(' ','Space');
  for(let i=0;i<1000;i++)spawn(12);
  assert.equal(ids['#raids'].children.length,16);
  assert.equal(ids['#raids'].children.reduce((n,g)=>n+g.children.length,0),48);
  assert.match(ids['#debug-result'].textContent,/limit/);
  tick(1000);assert.match(ids['#debug-performance'].textContent,/192\/192 UAVs/);
  key(' ','Space');tick(120000);assert.equal(ids['#raids'].children.length,0);
});

test('a frame timestamp older than a spawn event does not stop UAV arrival',()=>{
  const {ids,tick,spawn}=setup();
  tick(1000);
  spawn(1);
  // An animation frame timestamp may precede performance.now() in an input event.
  assert.doesNotThrow(()=>tick(0,-1));
  tick(30000);
  const tracks=ids['#raids'].children[0].children[1];
  assert.equal(tracks.attrs.d,'');
  tick(4000);
  assert.equal(tracks.attrs.d,'');
  ids['#build-radar'].handlers.click();
  ids['#map'].handlers.click({clientX:550,clientY:540});
  assert.notEqual(tracks.attrs.d,'');
  const before=tracks.attrs.d;
  tick(1000);
  assert.notEqual(tracks.attrs.d,before);
  tick(60000);
  assert.equal(ids['#raids'].children.length,0);
});
test('radar can be bought and placed immediately with starting resources',()=>{
  const {ids}=setup();
  const button=ids['#build-radar'],map=ids['#map'];
  assert.equal(ids['#resources'].textContent,'200');
  assert.equal(button.disabled,false);
  button.handlers.click();
  assert.equal(button.textContent,'Cancel placement');
  map.handlers.pointermove({clientX:50,clientY:50});
  assert.equal(ids['#radar-preview'].attrs.visibility,'visible');
  assert.equal(ids['#radar-preview'].classList.contains('invalid'),true);
  map.handlers.click({clientX:50,clientY:50});
  map.handlers.click({clientX:101,clientY:300});
  assert.equal(ids['#radars'].children.length,0);
  map.handlers.click({clientX:177,clientY:280});
  map.handlers.click({clientX:470,clientY:500});
  assert.equal(ids['#radars'].children.length,0);
  map.handlers.pointermove({clientX:500,clientY:400});
  assert.equal(ids['#radar-preview'].classList.contains('invalid'),false);
  map.handlers.click({clientX:500,clientY:400});
  assert.equal(ids['#radars'].children.length,1);
  assert.equal(ids['#radars'].children[0].children[0].attrs.r,'120');
  assert.equal(ids['#radars'].children[0].children[1].attrs.class,'radar-scan');
  assert.equal(ids['#radars'].children[0].children[1].children[0].attrs.type,'rotate');
  assert.equal(ids['#resources'].textContent,'100');
  assert.equal(button.disabled,false);
});
test('a UAV impact shows a brief explosion on the map',()=>{
  const {ids,tick,spawn}=setup();
  spawn(1);
  tick(60000);
  assert.equal(ids['#effects'].children.length,1);
  assert.equal(ids['#effects'].children[0].children[0].attrs.class,'impact-ring');
  tick(500);
  assert.equal(ids['#effects'].children.length,0);
});
test('a placed SAM site shows its range and intercepts a UAV',()=>{
  const {ids,tick,spawn}=setup();
  ids['#build-sam'].handlers.click();
  assert.equal(ids['#radar-preview'].classList.contains('sam-preview'),true);
  assert.equal(ids['#preview-range'].attrs.r,'160');
  ids['#map'].handlers.click({clientX:550,clientY:540});
  assert.equal(ids['#resources'].textContent,'50');
  assert.equal(ids['#sam-sites'].children.length,1);
  assert.match(ids['#sam-ammo'].textContent,/3\/3/);
  spawn(1);
  tick(32000);
  assert.equal(ids['#interceptors'].children.length,1);
  tick(8000);
  assert.equal(ids['#interceptors'].children.length,0);
  assert.match(ids['#sam-ammo'].textContent,/2\/3/);
  assert.equal(ids['#morale'].textContent,'10 / 10');
  assert.equal(ids['#effects'].children[0].children[0].attrs.class,'impact-ring intercept-ring');
});
