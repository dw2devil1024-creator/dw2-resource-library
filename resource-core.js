/* DW2 · Resource Library | standalone original grouping logic.
 * Copyright (c) 2026 S.A. · DW2
 * Never reads or writes the content of a preset, world book or theme.
 */
export const VERSION = '0.1.1-beta.1';
export const STORE_KEY = 'dw2ResourceLibrary';
export const CATEGORIES = Object.freeze([
  { id: 'preset', label: '预设' },
  { id: 'world', label: '世界书' },
  { id: 'theme', label: '美化' },
]);

const PRESET_LABELS = Object.freeze({
  openai: '对话补全预设', chatcompletion: '对话补全预设', chatcompletionpreset: '对话补全预设',
  textgenerationwebui: '文本补全预设', textcompletion: '文本补全预设', kobold: 'KoboldAI 预设',
  koboldhorde: 'Kobold 预设', novel: 'NovelAI 预设', novelai: 'NovelAI 预设',
  context: '上下文模板', instruct: '指令格式模板', sysprompt: '系统提示模板',
  systemprompt: '系统提示模板', reasoning: '推理格式模板',
});

export function normalizedPresetKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}
export function sourceFromSelect(select) {
  if (!select || select.tagName !== 'SELECT') return null;
  if (select.id === 'themes') return { id:'theme', category:'theme', label:'美化主题' };
  if (select.id === 'world_info') return { id:'world:global', category:'world', label:'世界书（全局启用）' };
  if (select.id === 'world_editor_select') return { id:'world:editor', category:'world', label:'世界书（编辑）' };
  const raw = select.getAttribute?.('data-preset-manager-for');
  if (raw === null || raw === undefined || !String(raw).trim()) return null;
  const identifier = normalizedPresetKey(raw);
  return { id:'preset:'+identifier, category:'preset', label:PRESET_LABELS[identifier] || '预设 · '+String(raw).trim() };
}
export function createEmptyState() { return { schemaVersion:1,enabled:false,autoGroup:true,resources:{} }; }
export function normalizeState(input) {
  const state=createEmptyState();
  if (!input || typeof input!=='object') return state;
  state.enabled=input.enabled===true;
  state.autoGroup=input.autoGroup!==false;
  if (input.resources && typeof input.resources==='object' && !Array.isArray(input.resources)) {
    for (const [id, raw] of Object.entries(input.resources).slice(0,100)) {
      if (!raw || typeof raw!=='object' || !/^([a-z]+(?::[a-z0-9]+)?)$/.test(id)) continue;
      const groups=[];const names=new Set();
      for (const entry of (Array.isArray(raw.groups)?raw.groups:[]).slice(0,200)) {
        if(!entry || typeof entry.id!=='string' || typeof entry.name!=='string')continue;
        const name=entry.name.trim().slice(0,36), groupId=entry.id.slice(0,56);
        if(!name || !groupId || names.has(name) || groups.some(g=>g.id===groupId))continue;
        names.add(name);groups.push({id:groupId,name});
      }
      const assignments={};
      if(raw.assignments && typeof raw.assignments==='object' && !Array.isArray(raw.assignments)){
        for(const [value, groupId] of Object.entries(raw.assignments).slice(0,3000)){
          if(typeof groupId==='string' && groups.some(g=>g.id===groupId))assignments[value.slice(0,512)]=groupId;
        }
      }
      state.resources[id]={groups,assignments};
    }
  }
  return state;
}
export function ensureResource(state, sourceId){
  if(!state.resources[sourceId])state.resources[sourceId]={groups:[],assignments:{}};
  return state.resources[sourceId];
}
/** Auto grouping is intentionally conservative: only explicit leading [labels]. */
export function guessGroup(label){
  const text=String(label||'').trim();
  const match=text.match(/^[【\[]([^\]】]{1,22})[】\]]\s*/u);
  return match ? match[1].trim():'';
}
export function groupOptions(options,resource,autoGroup=true){
  const manual=new Map(resource?.groups?.map(g=>[g.id,{key:'manual:'+g.id,name:g.name,items:[],kind:'manual'}])||[]);
  const remaining=[];
  for(const option of options){
    const target=manual.get(resource?.assignments?.[option.value]);
    if(target)target.items.push(option);else remaining.push(option);
  }
  const autoCounts=new Map();
  if(autoGroup)for(const option of remaining){const inferred=guessGroup(option.label);if(inferred)autoCounts.set(inferred,(autoCounts.get(inferred)||0)+1)}
  const auto=new Map(),unassigned=[];
  const manualByName=new Map([...manual.values()].map(group=>[group.name,group]));
  for(const option of remaining){
    const name=autoGroup?guessGroup(option.label):'';
    if(name && manualByName.has(name)){
      // One visible folder per name. Explicit placement keeps first priority.
      manualByName.get(name).items.push(option);
    }else if(name && autoCounts.get(name)>=2){
      if(!auto.has(name))auto.set(name,{key:'auto:'+name,name,items:[],kind:'auto'});
      auto.get(name).items.push(option);
    }else unassigned.push(option);
  }
  const groups=[...manual.values(),...auto.values()].filter(g=>g.items.length>0);
  if(unassigned.length)groups.push({key:'loose',name:'未分组',items:unassigned,kind:'loose'});
  return groups;
}
export function optionsForSelect(select){
  if(!select)return[];
  return [...select.options].filter(option=>!option.disabled && !!String(option.textContent||'').trim()).map(option=>({
    value:String(option.value),label:String(option.textContent||'').replace(/\s+/g,' ').trim(),selected:!!option.selected
  }));
}
export function safeFilename(value){return String(value||'').replace(/[^\w\-\u4e00-\u9fa5]/g,'_').slice(0,80)}

/**
 * Conservative, independent smart grouping planner. Only exact bracket prefixes,
 * an explicit series separator, or a trailing version marker are considered.
 * Never changes actual TT/ST resources and never overwrites a manual assignment.
 */
export function suggestedSeries(label){
  const raw=String(label||'').trim();
  const bracket=guessGroup(raw);
  if(bracket)return bracket;
  // Only trim leading decorative emoji, not Chinese or Latin letters.
  const text=raw.replace(/^(?:[\p{Extended_Pictographic}\uFE0F\u200D]\s*)+/gu,'').trim();
  const pipe=text.match(/^(.{2,24}?)\s*[｜|]\s*[^｜|]+$/u);
  if(pipe)return pipe[1].trim();
  const version=text.match(/^(.{2,24}?)\s*(?:[【\[（(](?:重制|重置|新版|旧版|正式版?|内测版?|测试版?|v?\d+(?:[._-]\d+)*)[】\]）)]|[vV]\s*\d+(?:[._-]\d+)*)(?:\s*)$/iu);
  if(version)return version[1].trim();
  return '';
}
export function planSmartGroups(options,resource){
  const assigned=resource?.assignments||{};
  const byName=new Map();
  for(const option of options){
    // Exact option values provide a stable identity within one native selector.
    if(Object.hasOwn(assigned,option.value))continue;
    const name=suggestedSeries(option.label);
    if(!name)continue;
    if(!byName.has(name))byName.set(name,[]);
    byName.get(name).push(option.value);
  }
  // Match a plain base name only when another resource gives explicit evidence
  // of the same named series, e.g. 🌸方亦楷 + 方亦楷【重制】.
  for(const option of options){
    if(Object.hasOwn(assigned,option.value) || suggestedSeries(option.label))continue;
    const base=String(option.label||'').trim()
      .replace(/^(?:[\p{Extended_Pictographic}\uFE0F\u200D]\s*)+/gu,'').trim();
    if(byName.has(base) && !byName.get(base).includes(option.value))byName.get(base).push(option.value);
  }
  const manualNames=new Set((resource?.groups||[]).map(g=>g.name));
  const groups=[...byName].filter(([name,values])=>values.length>=2 || (manualNames.has(name)&&values.length>=1))
    .map(([name,values])=>({name,values}));
  return {groups,total:groups.reduce((count,g)=>count+g.values.length,0)};
}
export function applySmartGroups(resource,plan){
  let added=0;
  const manual=new Map(resource.groups.map(g=>[g.name,g.id]));
  for(const group of plan.groups){
    let id=manual.get(group.name);
    if(!id){
      id='sg'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
      resource.groups.push({id,name:group.name});manual.set(group.name,id);
    }
    for(const value of group.values){
      if(Object.hasOwn(resource.assignments,value))continue;
      resource.assignments[value]=id;added++;
    }
  }
  return added;
}
