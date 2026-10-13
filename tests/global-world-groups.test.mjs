import assert from 'node:assert/strict';
import {planGlobalWorldGroups} from '../global-world-groups.js';

// Native option identity/activation is intentionally untouched: only labels
// in Select2's rendered list are assigned presentation group headers.
const groups=[
  {key:'manual:gu',name:'顾星灼',items:[{label:'顾星灼日常'},{label:'顾星灼剧情'}]},
  {key:'manual:barry',name:'贝瑞旻',items:[{label:'贝瑞旻生活'}]},
];
const all=['顾星灼日常','顾星灼剧情','贝瑞旻生活','无关联世界书'];
const before=JSON.stringify(all);
let plan=planGlobalWorldGroups(groups,all);
assert.deepEqual(plan.map(x=>x.name),['顾星灼','贝瑞旻','未分类']);
assert.deepEqual(plan[0].labels,['顾星灼日常','顾星灼剧情']);
assert.deepEqual(plan[2].labels,['无关联世界书']);
assert.equal(JSON.stringify(all),before);
plan=planGlobalWorldGroups(groups,['贝瑞旻生活']);
assert.deepEqual(plan.map(x=>x.name),['贝瑞旻']);
plan=planGlobalWorldGroups(groups,['无关联世界书']);
assert.deepEqual(plan.map(x=>x.name),['未分类']);
plan=planGlobalWorldGroups(groups,[]);
assert.deepEqual(plan,[]);
const emptyGroups=planGlobalWorldGroups([],['一个','另一个']);
assert.equal(emptyGroups[0].name,'未分类');
assert.equal(emptyGroups[0].labels.length,2);
console.log('DW2 Resource Library: Select2 group planning and filtered/search results passed');
