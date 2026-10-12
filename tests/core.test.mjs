import assert from 'node:assert/strict';
import {createEmptyState,normalizeState,sourceFromSelect,guessGroup,groupOptions,optionsForSelect,ensureResource,planSmartGroups,applySmartGroups,suggestedSeries} from '../resource-core.js';
const makeSelect=(id,preset=null)=>({tagName:'SELECT',id,getAttribute(name){return name==='data-preset-manager-for'?preset:null;}});
assert.deepEqual(sourceFromSelect(makeSelect('themes')),{id:'theme',category:'theme',label:'美化主题'});
assert.equal(sourceFromSelect(makeSelect('world_info')).id,'world:global');
assert.equal(sourceFromSelect(makeSelect('x','openai')).label,'对话补全预设');
assert.equal(sourceFromSelect(makeSelect('x','context')).label,'上下文模板');
assert.equal(guessGroup('【织界】 v659'),'织界');
assert.equal(guessGroup('[小冰块] V1'),'小冰块');
assert.equal(guessGroup('小冰块 V1'),'');
assert.equal(guessGroup('【】 test'),'');
const state=createEmptyState();const resource=ensureResource(state,'preset:openai');
resource.groups.push({id:'custom',name:'常用'});resource.assignments['c']='custom';
const opts=[{value:'a',label:'【小冰块】1'},{value:'b',label:'【小冰块】2'},{value:'c',label:'【小冰块】3'},{value:'d',label:'织界V659'}];
let groups=groupOptions(opts,resource,true);
assert.equal(groups.find(g=>g.name==='小冰块').items.length,2);
assert.equal(groups.find(g=>g.name==='常用').items.length,1);
assert.equal(groups.find(g=>g.name==='未分组').items.length,1);
assert.equal(groupOptions(opts,resource,false).find(g=>g.name==='未分组').items.length,3);
const dirty=normalizeState({enabled:true,resources:{'preset:openai':{groups:[{id:'safe',name:'保留'},{id:'safe2',name:'保留'}],assignments:{a:'safe',b:'missing'}}}});
assert.deepEqual(dirty.resources['preset:openai'].groups,[{id:'safe',name:'保留'}]);
assert.equal(dirty.resources['preset:openai'].assignments.a,'safe');
assert.equal(dirty.resources['preset:openai'].assignments.b,undefined);
assert.equal(optionsForSelect({options:[{disabled:false,value:'v',textContent:' X  y ',selected:true},{disabled:true,value:'none',textContent:'None'}]}).length,1);
console.log('DW2 Resource Library: 14 core checks passed');
const special={groups:[{id:'g1',name:'小冰块'}],assignments:{a:'g1'}};
const merged=groupOptions([{value:'a',label:'【小冰块】A'},{value:'b',label:'【小冰块】B'}],special,true);
assert.equal(merged.length,1);
assert.equal(merged[0].items.length,2);
console.log('DW2 Resource Library: matching manual and auto folders merge correctly');

const smart={groups:[{id:'manual',name:'织界'}],assignments:{protected:'manual'}};
const smartOptions=[
 {value:'protected',label:'织界V1'}, {value:'v2',label:'织界V2'},
 {value:'v3',label:'织界V3'}, {value:'ice1',label:'【小冰块】小说'},
 {value:'ice2',label:'【小冰块】沉浸'}, {value:'single',label:'独立无标签资源'}
];
const planned=planSmartGroups(smartOptions,smart);
assert.equal(planned.total,4);
assert.deepEqual(planned.groups.map(g=>g.name),['织界','小冰块']);
assert.equal(applySmartGroups(smart,planned),4);
assert.equal(smart.assignments.protected,'manual');
assert.equal(smart.assignments.v2,'manual');
assert.equal(smart.assignments.ice1,smart.assignments.ice2);
assert.equal(smart.groups.length,2);
assert.equal(planSmartGroups(smartOptions,smart).total,0);
console.log('DW2 Resource Library: smart preview, non-destructive merge, repeat idempotency passed');
