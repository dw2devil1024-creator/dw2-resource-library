/* DW2 · Resource Library | standalone original grouping logic.
 * Copyright (c) 2026 S.A. · DW2
 * Never reads or writes the content of a preset, world book or theme.
 */
export const VERSION = '0.1.28-beta.1';
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
export function createEmptyState() { return { schemaVersion:3,enabled:false,autoGroup:true,resources:{},worldMigrationBackup:{},resourceMigrationBackup:{},legacyWorldMergeDone:false,globalWorldGroupsEnabled:false,parameterFoldEnabled:false,promptFoldersEnabled:false,promptFolders:{},regexFoldersEnabled:false,regexFolders:{} }; }
export function normalizeState(input) {
  const state=createEmptyState();
  if (!input || typeof input!=='object') return state;
  state.enabled=input.enabled===true;
  state.autoGroup=input.autoGroup!==false;
  state.globalWorldGroupsEnabled=input.globalWorldGroupsEnabled===true;
  state.parameterFoldEnabled=input.parameterFoldEnabled===true;
  state.promptFoldersEnabled=input.promptFoldersEnabled===true;
  state.regexFoldersEnabled=input.regexFoldersEnabled===true;
  state.legacyWorldMergeDone=input.legacyWorldMergeDone===true;
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
      const suppressedAutoGroups=[...new Set(
        (Array.isArray(raw.suppressedAutoGroups)?raw.suppressedAutoGroups:[])
          .filter(name=>typeof name==='string')
          .map(name=>name.trim().slice(0,36))
          .filter(Boolean)
      )].slice(0,200);
      state.resources[id]={groups,assignments,suppressedAutoGroups};
    }
  }
  const backups=input.worldMigrationBackup;
  if(backups && typeof backups==='object' && !Array.isArray(backups)){
    for(const id of ['world:editor','world:global']){
      const raw=backups[id];
      if(raw && typeof raw==='object' && !Array.isArray(raw)){
        state.worldMigrationBackup[id]=Object.fromEntries(
          Object.entries(raw).filter(([key,val])=>
            typeof val==='string' && key.length<=512 && val.length<=56).slice(0,3000));
      }
    }
  }
  if(input.regexFolders && typeof input.regexFolders==='object' && !Array.isArray(input.regexFolders)){
    for(const scope of Object.keys(input.regexFolders).filter(k=>k==='global'||/^preset:[^\n]{1,150}$/.test(k)||/^scoped:[a-zA-Z0-9_-]{1,100}$/.test(k)).slice(0,160)){
      const raw=input.regexFolders[scope];if(!raw || typeof raw!=='object')continue;
      const groups=[],seen=new Set();
      for(const g of (Array.isArray(raw.groups)?raw.groups:[]).slice(0,120)){
        const id=String(g?.id??'').slice(0,80),name=String(g?.name??'').trim().slice(0,50);
        if(!id||!name||seen.has(id))continue;
        seen.add(id);groups.push({id,name});
      }
      const entries={};const valid=new Set(groups.map(g=>g.id));
      for(const [id,gid] of Object.entries(raw.entries||{}).slice(0,2500)){
        if(id.length<=200 && typeof gid==='string' && valid.has(gid))entries[id]=gid;
      }
      state.regexFolders[scope]={groups,entries};
    }
  }
  const rawPromptFolders=input.promptFolders;
  if(rawPromptFolders && typeof rawPromptFolders==='object' && !Array.isArray(rawPromptFolders)){
    for(const [name,raw] of Object.entries(rawPromptFolders).slice(0,150)){
      if(!name.trim() || name.length>200 || !raw || typeof raw!=='object')continue;
      const groups=[],seen=new Set();
      for(const g of (Array.isArray(raw.groups)?raw.groups:[]).slice(0,200)){
        const id=String(g?.id??'').slice(0,80),title=String(g?.name??'').trim().slice(0,50);
        if(!id||!title||seen.has(id))continue;
        seen.add(id);groups.push({id,name:title});
      }
      const entries={};
      if(raw.entries && typeof raw.entries==='object' && !Array.isArray(raw.entries)){
        for(const [id,groupId] of Object.entries(raw.entries).slice(0,5000)){
          if(id.length<=300 && typeof groupId==='string' && seen.has(groupId))entries[id]=groupId;
        }
      }
      state.promptFolders[name]={groups,entries};
    }
  }
  const oldResourceBackups=input.resourceMigrationBackup;
  if(oldResourceBackups && typeof oldResourceBackups==='object' && !Array.isArray(oldResourceBackups)){
    for(const [id,raw] of Object.entries(oldResourceBackups).slice(0,100)){
      if(!/^(preset:[a-z0-9]+|theme)$/.test(id) || !raw || typeof raw!=='object' || Array.isArray(raw))continue;
      state.resourceMigrationBackup[id]=Object.fromEntries(
        Object.entries(raw).filter(([key,val])=>key.length<=512 && typeof val==='string' && val.length<=56).slice(0,3000));
    }
  }
  return state;
}
export function ensureResource(state, sourceId){
  if(!state.resources[sourceId])state.resources[sourceId]={groups:[],assignments:{},suppressedAutoGroups:[]};
  const record=state.resources[sourceId];
  if(!Array.isArray(record.suppressedAutoGroups))record.suppressedAutoGroups=[];
  return record;
}
/** The old global world-book settings are retired. Migrating them on every
 * launch resurrected folders the user had explicitly deleted. Never merge
 * when the editor resource already exists, even if all its folders are gone.
 * A legacy-only install can be copied ONCE without touching its old backup. */
export function migrateLegacyWorldFolders(state){
  if(state.legacyWorldMergeDone===true)return false;
  const global=state.resources?.['world:global'];
  const hasEditor=Object.hasOwn(state.resources||{},'world:editor');
  if(!hasEditor && global && Array.isArray(global.groups)){
    state.resources['world:editor']={
      groups:global.groups.map(group=>({...group})),
      assignments:{...(global.assignments||{})},
      suppressedAutoGroups:[...(global.suppressedAutoGroups||[])],
    };
  }
  state.legacyWorldMergeDone=true;
  return true;
}
/** User-suppressed auto folder names survive normalization and restarts.
 * Without tombstones, a deleted manual [name] folder is immediately
 * recreated by the automatic inferred grouping of the same books. */
export function suppressAutoGroup(record,name){
  const title=String(name||'').trim();
  if(!title)return;
  if(!Array.isArray(record.suppressedAutoGroups))record.suppressedAutoGroups=[];
  if(!record.suppressedAutoGroups.includes(title))record.suppressedAutoGroups.push(title);
}
export function unsuppressAutoGroup(record,name){
  const title=String(name||'').trim();
  if(Array.isArray(record.suppressedAutoGroups)){
    record.suppressedAutoGroups=record.suppressedAutoGroups.filter(value=>value!==title);
  }
}
/** Native TT uses a mutable index to select a world book. Grouping keys
 * must instead use its file name, without changing the native selection. */
export const WORLD_BOOK_KEY_PREFIX='worldbook:';
export function worldBookKey(name){return WORLD_BOOK_KEY_PREFIX+String(name??'').trim().normalize('NFC');}
export function assignmentKey(option){return String(option?.key ?? option?.value ?? '');}
// Keep TT's native selector values untouched. Resource folders use stable names.
export function presetResourceKey(name){return 'presetname:'+String(name??'').trim().normalize('NFC');}
export function themeResourceKey(name){return 'theme:'+String(name??'').trim().normalize('NFC');}
/** Preserve legacy mutable indices rather than assigning them to new presets
 * after deletion. Safely recover name-valued selects and exact-name singleton
 * folders only. Ambiguous old mappings remain exported as a backup. */
export function migrateNamedResourceAssignments(state,sourceId,options){
  if(!/^(preset:[a-z0-9]+|theme)$/.test(sourceId)||!Array.isArray(options)||!options.length)
    return {changed:false,recovered:0,uncertain:0};
  const record=state.resources?.[sourceId];
  if(!record?.assignments||!Array.isArray(record.groups))return {changed:false,recovered:0,uncertain:0};
  const prefix=sourceId==='theme'?'theme:':'presetname:';
  const legacy=Object.entries(record.assignments).filter(([key])=>!key.startsWith(prefix));
  if(!legacy.length)return {changed:false,recovered:0,uncertain:0};
  if(!state.resourceMigrationBackup)state.resourceMigrationBackup={};
  const archive=state.resourceMigrationBackup[sourceId]||{};
  const groups=new Map(record.groups.map(group=>[group.id,group]));
  const byLabel=new Map();
  for(const item of options){
    const name=String(item.label??'').normalize('NFC');
    if(!byLabel.has(name))byLabel.set(name,[]);
    byLabel.get(name).push(item);
  }
  const byGroup=new Map();
  for(const [value,id] of legacy){
    if(!byGroup.has(id))byGroup.set(id,[]);
    byGroup.get(id).push(value);
  }
  let changed=false,recovered=0,uncertain=0;
  for(const [oldValue,groupId] of legacy){
    if(!Object.hasOwn(archive,oldValue)){archive[oldValue]=groupId;changed=true;}
    const candidates=options.filter(item=>String(item.value)===oldValue);
    // A selected value that literally equals a unique resource name is stable.
    let match=candidates.length===1 && String(candidates[0].label)===oldValue ? candidates[0]:null;
    // Numeric old values may point elsewhere; only exact named singleton folders are safe.
    if(!match && byGroup.get(groupId)?.length===1 && groups.has(groupId)){
      const named=byLabel.get(groups.get(groupId).name.normalize('NFC'))||[];
      if(named.length===1)match=named[0];
    }
    if(match){
      const key=assignmentKey(match);
      if(key.startsWith(prefix) && !Object.hasOwn(record.assignments,key)){
        record.assignments[key]=groupId;changed=true;recovered++;
      }else if(!key.startsWith(prefix)||record.assignments[key]!==groupId){uncertain++;}
    }else uncertain++;
    delete record.assignments[oldValue];changed=true;
  }
  state.resourceMigrationBackup[sourceId]=archive;
  return {changed,recovered,uncertain};
}
/** Preserve legacy numeric assignments and recover unambiguous singleton
 * folders by name when deletion/reordering has shifted native indices.
 * Unknown mappings stay in worldMigrationBackup rather than being guessed. */
export function migrateWorldAssignments(state,options){
  if(!Array.isArray(options)||!options.length)return {changed:false,recovered:0,uncertain:0};
  const byNative=new Map(options.map(item=>[String(item.value),item]));
  const byName=new Map(options.map(item=>[String(item.label),item]));
  if(!state.worldMigrationBackup)state.worldMigrationBackup={};
  let changed=false,recovered=0,uncertain=0;
  for(const id of ['world:editor','world:global']){
    const record=state.resources?.[id];
    if(!record?.assignments || !Array.isArray(record.groups))continue;
    const old=Object.entries(record.assignments).filter(([key])=>!key.startsWith(WORLD_BOOK_KEY_PREFIX));
    if(!old.length)continue;
    if(!state.worldMigrationBackup[id]){
      state.worldMigrationBackup[id]=Object.fromEntries(old);changed=true;
    }
    const byGroup=new Map();
    for(const [oldValue,groupId] of old){
      if(!byGroup.has(groupId))byGroup.set(groupId,[]);
      byGroup.get(groupId).push(oldValue);
    }
    const anchors=new Map();
    // If an old index no longer exists, the file list definitely changed.
    // Do not infer the remaining index identities from a truncated list.
    let shifted=old.some(([nativeValue])=>!byNative.has(nativeValue));
    for(const group of record.groups){
      const legacy=byGroup.get(group.id)||[];
      if(legacy.length!==1)continue;
      const item=byName.get(group.name);
      if(!item)continue;
      const stable=assignmentKey(item);
      if(record.assignments[stable]&&record.assignments[stable]!==group.id)continue;
      anchors.set(legacy[0],{item,groupId:group.id});
      if(String(item.value)!==legacy[0])shifted=true;
    }
    for(const {item,groupId} of anchors.values()){
      const key=assignmentKey(item);
      if(!record.assignments[key]){record.assignments[key]=groupId;changed=true;recovered++;}
    }
    for(const [legacyValue,groupId] of old){
      if(anchors.has(legacyValue))continue;
      const item=byNative.get(legacyValue);
      if(!item||shifted){uncertain++;continue;}
      const key=assignmentKey(item);
      if(!record.assignments[key]){record.assignments[key]=groupId;changed=true;recovered++;}
    }
    for(const [key] of old){delete record.assignments[key];changed=true;}
  }
  return {changed,recovered,uncertain};
}

/** Read the current character card's linked lorebook; never infer a link from
 * a selected editor option or from global activation. Read-only. */
export function characterLinkedWorld(context){
  const id=context?.characterId;
  if(id===undefined||id===null||id==='')return '';
  const character=context?.characters?.[id];
  const raw=character?.data?.extensions?.world ?? character?.extensions?.world;
  return typeof raw==='string'?raw.trim():'';
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
    const target=manual.get(resource?.assignments?.[assignmentKey(option)]);
    if(target)target.items.push(option);else remaining.push(option);
  }
  const suppressed=new Set(resource?.suppressedAutoGroups||[]);
  const autoCounts=new Map();
  if(autoGroup)for(const option of remaining){
    const inferred=guessGroup(option.label);
    if(inferred&&!suppressed.has(inferred))autoCounts.set(inferred,(autoCounts.get(inferred)||0)+1);
  }
  const auto=new Map(),unassigned=[];
  const manualByName=new Map([...manual.values()].map(group=>[group.name,group]));
  for(const option of remaining){
    const name=autoGroup?guessGroup(option.label):'';
    if(name && manualByName.has(name)){
      // One visible folder per name. Explicit placement keeps first priority.
      manualByName.get(name).items.push(option);
    }else if(name && !suppressed.has(name) && autoCounts.get(name)>=2){
      if(!auto.has(name))auto.set(name,{key:'auto:'+name,name,items:[],kind:'auto'});
      auto.get(name).items.push(option);
    }else unassigned.push(option);
  }
  const groups=[...manual.values(),...auto.values()].filter(g=>g.items.length>0);
  if(unassigned.length)groups.push({key:'loose',name:'未分组',items:unassigned,kind:'loose'});
  return groups;
}
/** A stable manager tree: user folders, inferred folders, and an always-visible Unclassified bin. */
export function managerGroups(options,resource,autoGroup=true){
  const grouped=groupOptions(options,resource,autoGroup);
  const found=new Map(grouped.map(x=>[x.key,x]));
  const manual=(resource?.groups||[]).map(g=>found.get('manual:'+g.id)||{
    key:'manual:'+g.id,name:g.name,items:[],kind:'manual'
  });
  const auto=grouped.filter(g=>g.kind==='auto');
  const loose=found.get('loose')||{key:'loose',name:'未分类',items:[],kind:'loose'};
  // User-visible terminology remains consistent whether this bin is empty or full.
  return [...manual,...auto,{...loose,name:'未分类'}];
}
export function optionsForSelect(select){
  if(!select)return[];
  return [...select.options].filter(option=>{
    const label=String(option.textContent||'').trim();
    if(option.disabled||!label)return false;
    // TT editor placeholder is a control action, not a real world-book file.
    if(select.id==='world_editor_select' && /^[-—]{2,}\s*选择以编辑\s*[-—]{2,}$/u.test(label))return false;
    return true;
  }).map(option=>{
    const label=String(option.textContent||'').replace(/\s+/g,' ').trim();
    return {
      value:String(option.value),label,selected:!!option.selected,
      ...(select.id==='world_editor_select'||select.id==='world_info'
        ? {key:worldBookKey(label)}
        : select.id==='themes' ? {key:themeResourceKey(label)}
        : select.getAttribute?.('data-preset-manager-for') ? {key:presetResourceKey(label)} : {}),
    };
  });
}
export function safeFilename(value){return String(value||'').replace(/[^\w\-\u4e00-\u9fa5]/g,'_').slice(0,80)}

/**
 * Conservative, independent smart grouping planner. Only exact bracket prefixes,
 * an explicit series separator, or a trailing version marker are considered.
 * Never changes actual TT/ST resources and never overwrites a manual assignment.
 */
// Generic variant flags should never become folder names by themselves.
const VARIANT_FLAG=/^(?:重制|重置|新版|旧版|测试版?|内测版?|正式版?|修订|复刻|修改版?|改版)$/iu;
function cleanSeriesLabel(value){
  let text=String(value||'').trim()
    .replace(/^(?:[\p{Extended_Pictographic}\uFE0F\u200D]\s*)+/gu,'').trim();
  // A leading 【重制】 is a variant hint, not a series title.
  for(let i=0;i<2;i++){
    const flag=text.match(/^[【\[]([^】\]]{1,12})[】\]]\s*/u);
    if(!flag||!VARIANT_FLAG.test(flag[1].trim()))break;
    text=text.slice(flag[0].length).trim();
  }
  return text;
}
export function suggestedSeries(label){
  const text=cleanSeriesLabel(label);
  const bracket=guessGroup(text);
  if(bracket&&!VARIANT_FLAG.test(bracket))return bracket;
  const pipe=text.match(/^(.{2,24}?)\s*[｜|]\s*[^｜|]+$/u);
  if(pipe&&!VARIANT_FLAG.test(pipe[1].trim()))return pipe[1].trim();
  // Version: 织界V659、方亦楷2.0、【小冰块】 v3 (handled above).
  const version=text.match(/^(.{2,24}?)\s*[vV]\s*\d+(?:[._-]\d+)*\s*$/u)
    ||text.match(/^([\p{Script=Han}]{2,24})\s*\d+(?:[._-]\d+)+\s*$/u);
  if(version)return version[1].trim();
  const bracketedVariant=text.match(/^(.{2,24}?)\s*[【\[（(](重制|重置|新版|旧版|正式版|内测版|测试版|修订|复刻)[】\]）)]\s*$/u);
  if(bracketedVariant)return bracketedVariant[1].trim();
  // Theme family: iOS紫色 / iOS蓝色; only recognize this explicit named prefix.
  if(/^iOS(?=[\p{Script=Han}])/iu.test(text))return 'iOS';
  return '';
}
export function planSmartGroups(options,resource,{allowSingletons=false}={}){
  const assigned=resource?.assignments||{};
  const suppressed=new Set(resource?.suppressedAutoGroups||[]);
  const byName=new Map();
  const evidenceFor=new Set();
  for(const option of options){
    if(Object.hasOwn(assigned,assignmentKey(option)))continue;
    const name=suggestedSeries(option.label);
    if(!name||suppressed.has(name))continue;
    evidenceFor.add(name);
    if(!byName.has(name))byName.set(name,new Set());
    byName.get(name).add(assignmentKey(option));
  }
  // A bare name can join a series when another item gives explicit evidence.
  for(const option of options){
    if(Object.hasOwn(assigned,assignmentKey(option))||suggestedSeries(option.label))continue;
    const name=cleanSeriesLabel(option.label);
    if(evidenceFor.has(name))byName.get(name).add(assignmentKey(option));
  }
  const manualNames=new Set((resource?.groups||[]).map(g=>g.name));
  const groups=[...byName].filter(([name,values])=>values.size>=2 || (manualNames.has(name)&&values.size>=1))
    .map(([name,values])=>({name,values:[...values]}));
  const included=new Set(groups.flatMap(g=>g.values));
  // Only a world-book manager opts into one-book-per-folder. No singletons
  // for presets/themes; existing manual resource assignments always win.
  if(allowSingletons){
    const named=new Map(groups.map(g=>[g.name,g]));
    for(const item of options){
      if(Object.hasOwn(assigned,assignmentKey(item))||included.has(assignmentKey(item)))continue;
      const name=suggestedSeries(item.label)||String(item.label||'').trim();
      if(!name||suppressed.has(name))continue;
      let folder=named.get(name);
      if(!folder){folder={name,values:[]};groups.push(folder);named.set(name,folder)}
      folder.values.push(assignmentKey(item));
      included.add(assignmentKey(item));
    }
  }
  return {groups,total:included.size,remaining:options.filter(o=>!Object.hasOwn(assigned,assignmentKey(o))&&!included.has(assignmentKey(o))).length,
    singletons:groups.filter(g=>g.values.length===1).length};
}
export function applySmartGroups(resource,plan){
  let added=0;
  const manual=new Map(resource.groups.map(g=>[g.name,g.id]));
  for(const group of plan.groups){
    if(resource.suppressedAutoGroups?.includes(group.name))continue;
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
