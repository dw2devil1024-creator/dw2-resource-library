import assert from 'node:assert/strict';
import {createEmptyState,normalizeState,sourceFromSelect,guessGroup,groupOptions,managerGroups,optionsForSelect,ensureResource,planSmartGroups,applySmartGroups,suggestedSeries,characterLinkedWorld} from '../resource-core.js';
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

const variations=planSmartGroups([
 {value:'one',label:'🌸方亦楷'},
 {value:'two',label:'方亦楷【重制】'},
 {value:'unrelated',label:'方亦楷的朋友'}
],{groups:[],assignments:{}});
assert.equal(variations.total,2);
assert.equal(variations.groups[0].name,'方亦楷');
console.log('DW2 Resource Library: versioned series and plain base names merge safely');

// Manager displays empty user folders AND an always-present Unclassified bin.
const emptyTree=managerGroups([{value:'a',label:'【织界】原版'}, {value:'b',label:'【织界】新版'}],{
  groups:[{id:'custom1',name:'已收藏'}],assignments:{}},true);
assert.deepEqual(emptyTree.map(g=>g.name),['已收藏','织界','未分类']);
assert.equal(emptyTree.at(-1).items.length,0);
assert.equal(emptyTree[0].items.length,0);
const withLoose=managerGroups([{value:'a',label:'独立美化'}, {value:'b',label:'另一套美化'}],{groups:[],assignments:{}},true);
assert.equal(withLoose.at(-1).items.length,2);

// Similar names are grouped only when there is an explicit family marker.
const themes=planSmartGroups([
  {value:'iosp',label:'iOS紫色'}, {value:'iosb',label:'iOS蓝色'},
  {value:'puppy',label:'Puppy'}, {value:'movie',label:'《City of Stars》'},
  {value:'star',label:'《in time》'}],{groups:[],assignments:{}});
assert.equal(themes.total,2);
assert.deepEqual(themes.groups.map(g=>g.name),['iOS']);
assert.equal(themes.remaining,3);
assert.equal(suggestedSeries('织界V659'),'织界');
assert.equal(suggestedSeries('方亦楷2.0'),'方亦楷');
assert.equal(suggestedSeries('【重制】方亦楷'),'');
const characterSeries=planSmartGroups([
 {value:'one',label:'🌸方亦楷'}, {value:'two',label:'方亦楷【重制】'},
 {value:'three',label:'【重制】方亦楷'}, {value:'four',label:'另一个无关人'}],{groups:[],assignments:{}});
assert.equal(characterSeries.total,3);
assert.equal(characterSeries.remaining,1);
const worldEditorSelect={id:'world_editor_select',options:[
  {disabled:false,textContent:'--- 选择以编辑 ---',value:'',selected:true},
  {disabled:false,textContent:'京市',value:'real',selected:false}]};
assert.equal(optionsForSelect(worldEditorSelect).length,1);
assert.equal(optionsForSelect(worldEditorSelect)[0].value,'real');
console.log('DW2 Resource Library: manager tree, iOS/theme grouping, version families, native editor placeholder passed');

// Single-lorebook folders must be opt-in, and cannot touch a manually assigned book.
const standaloneBooks=[
 {value:'bound',label:'🌸方亦楷和高中生活'},
 {value:'alone',label:'顾星灼生活'},
 {value:'s1',label:'【古风】大周'},
 {value:'s2',label:'【古风】皇宫'},
 {value:'manual',label:'原本已经整理的世界书'}
];
const worldRecord={groups:[{id:'keep',name:'收藏'}],assignments:{manual:'keep'}};
assert.equal(planSmartGroups(standaloneBooks,worldRecord).total,2);
const withSolo=planSmartGroups(standaloneBooks,worldRecord,{allowSingletons:true});
assert.equal(withSolo.total,4);
assert.equal(withSolo.groups.find(g=>g.name==='🌸方亦楷和高中生活').values.length,1);
assert.equal(withSolo.groups.find(g=>g.name==='顾星灼生活').values.length,1);
assert.equal(withSolo.groups.find(g=>g.name==='古风').values.length,2);
assert.equal(withSolo.singletons,2);
assert.equal(applySmartGroups(worldRecord,withSolo),4);
assert.equal(worldRecord.assignments.manual,'keep');
assert.equal(planSmartGroups(standaloneBooks,worldRecord,{allowSingletons:true}).total,0);
assert.equal(characterLinkedWorld({characterId:0,characters:[{data:{extensions:{world:'🌸方亦楷和高中生活'}}}]}),'🌸方亦楷和高中生活');
assert.equal(characterLinkedWorld({characterId:null,characters:[{data:{extensions:{world:'绑定'}}}]}),'');
assert.equal(characterLinkedWorld({characterId:1,characters:[{}]}),'');
console.log('DW2 Resource Library: single worldbook folders, manual safety, read-only character book association passed');
