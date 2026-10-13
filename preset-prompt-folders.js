/**
 * DW2 · Resource Library: TT-native prompt grouping presentation.
 * Never changes native prompt order, prompt objects or draggable row nodes.
 * Legacy baibaiToolkit.presetPromptGroups is read-only.
 */
const PREFIX='dw2rl-prompt-folders';
const safe=(v)=>String(v??'').trim();
const LEGACY='baibaiToolkit.presetPromptGroups';
export function normalizeLegacyGroups(raw,validIds){
  if(!raw||!Array.isArray(raw.groups)||!raw.prompts||typeof raw.prompts!=='object')return null;
  const seen=new Set(),groups=[];
  for(const group of raw.groups.slice(0,200)){
    const id=safe(group?.id),name=safe(group?.name).slice(0,50);
    if(!id||!name||seen.has(id))continue;
    seen.add(id);groups.push({id,name});
  }
  const entries={};
  for(const [id,meta] of Object.entries(raw.prompts).slice(0,4000)){
    if(validIds.has(id)&&seen.has(safe(meta?.groupId)))entries[id]=safe(meta.groupId);
  }
  return groups.length?{groups,entries}:null;
}
export function createPromptFolders({enabled,getState,save,context}){
  let host=null,toolbar=null,timer=0,currentPreset='',active='all',lastSignature='';
  let legacyLoaded='',currentLegacy=false;
  const folderCollapsed=new Map();
  let selecting=false,first='',pending=null;
  const doc=()=>document;
  function presetName(){
    try{
      const ctx=context();
      const manager=ctx?.getPresetManager?.('openai');
      const name=safe(manager?.getSelectedPresetName?.());
      if(name)return name;
    }catch{}
    const sel=doc().querySelector('#openai_api-presets select[data-preset-manager-for],#openai_api-presets select');
    return safe(sel?.selectedOptions?.[0]?.textContent);
  }
  function records(){return [...(doc().querySelector('#completion_prompt_manager_list')?.querySelectorAll(':scope > li.completion_prompt_manager_prompt')||[])].filter(el=>safe(el.dataset.pmIdentifier));}
  function currentRecord(){
    const state=getState();
    if(!state.promptFolders||typeof state.promptFolders!=='object')state.promptFolders={};
    const name=presetName();
    if(!name)return null;
    if(currentPreset!==name){currentPreset=name;active='all';legacyLoaded='';folderCollapsed.clear();selecting=false;first='';pending=null;}
    if(!state.promptFolders[name])state.promptFolders[name]={groups:[],entries:{}};
    return state.promptFolders[name];
  }
  function oldGroups(validIds){
    try{
      const manager=context()?.getPresetManager?.('openai');
      const raw=manager?.readPresetExtensionField?.({path:LEGACY});
      return normalizeLegacyGroups(raw,validIds);
    }catch{return null;}
  }
  function initLegacy(record,rows){
    if(legacyLoaded===currentPreset)return;
    legacyLoaded=currentPreset;
    const old=oldGroups(new Set(rows.map(row=>safe(row.dataset.pmIdentifier))));
    currentLegacy=!!old;
    if(!old)return;
    if(record.groups?.length || Object.keys(record.entries||{}).length)return;
    // Import ONLY into our extension's category state. Never modify old data.
    record.groups=old.groups.map(group=>({...group}));
    record.entries={...old.entries};
    save();
  }
  function el(tag,cls='',label=''){
    const n=doc().createElement(tag);n.className=cls;n.textContent=label;return n;
  }
  function btn(label,run,cls=''){
    const b=el('button',cls,label);b.type='button';b.addEventListener('click',run);return b;
  }
  // Inline fold headings live INSIDE an existing prompt row, so the
  // sortable list keeps exactly the same <li> nodes and identifiers.
  // No prompt is reordered. Multiple non-contiguous runs of the same folder
  // receive matching headings instead of changing native prompt order.
  function clearInline(rows){
    for(const row of rows){
      row.classList.remove('dw2rl-prompt-row-filtered','dw2rl-prompt-folded-first');
      row.querySelector(':scope > .dw2rl-prompt-range-choice')?.remove();
      row.querySelector(':scope > .dw2rl-inline-folder')?.remove();
      row.classList.remove('dw2rl-inline-folder-host');
    }
    doc().getElementById('completion_prompt_manager_list')?.classList.remove('dw2rl-prompt-list-filtering');
  }
  function showRows(rows,record){
    clearInline(rows);
    const effective=pending||record;
    const names=new Map(effective.groups.map(g=>[g.id,g.name]));
    const valid=new Set(rows.map(row=>safe(row.dataset.pmIdentifier)));
    let previous=null,runIndex=0;
    for(const row of rows){
      const id=safe(row.dataset.pmIdentifier);
      const groupId=names.has(effective.entries[id])?effective.entries[id]:'';
      const current=groupId||'__loose__';
      if(current!==previous){
        const header=el('button','dw2rl-inline-folder');
        header.type='button';
        header.textContent=(expandedGroup(current)?'▾ ':'▸ ')+(names.get(groupId)||'未分组');
        header.setAttribute('aria-expanded',String(expandedGroup(current)));
        header.dataset.groupId=current;
        header.addEventListener('mousedown',e=>{e.stopPropagation();});
        header.addEventListener('touchstart',e=>{e.stopPropagation();},{passive:true});
        header.addEventListener('click',e=>{
          e.preventDefault();e.stopPropagation();
          folderCollapsed.set(current,!folderCollapsed.get(current));
          render();
        });
        row.prepend(header);
        row.classList.add('dw2rl-inline-folder-host');
        runIndex++;
      }
      if(selecting){
        const choice=btn(first===id?'● 起点':'○ 选取',()=>tapRange(id),'dw2rl-prompt-range-choice');
        row.append(choice);
      }
      if(!selecting&&!expandedGroup(current)){
        if(current!==previous)row.classList.add('dw2rl-prompt-folded-first');
        else row.classList.add('dw2rl-prompt-row-filtered');
      }
      previous=current;
    }
    return valid;
  }
  function expandedGroup(key){return folderCollapsed.get(key)!==true;}
  function saveRecord(){save();render();}

  function makeGroup(){ selecting=!selecting;first='';folderCollapsed.clear();render(); }
  function tapRange(id){
    const ids=records().map(r=>safe(r.dataset.pmIdentifier));
    if(!first){first=id;render();return;}
    const a=ids.indexOf(first),b=ids.indexOf(id);
    if(a<0||b<0)return;
    const picked=ids.slice(Math.min(a,b),Math.max(a,b)+1);
    const name=prompt('为这 '+picked.length+' 条提示词命名分组：');
    if(name===null||!safe(name)){first='';render();return;}
    const rec=currentRecord();if(!rec)return;
    const groups=rec.groups||[],title=safe(name).slice(0,50);
    if(groups.some(g=>g.name===title)){alert('已有同名分组，请改个名称');return;}
    const groupId='dw2g'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
    pending={groups:[...groups,{id:groupId,name:title}],entries:{...rec.entries}};
    for(const key of picked)pending.entries[key]=groupId;
    first='';selecting=false;render();
  }
  function commit(){
    const rec=currentRecord();if(!rec||!pending)return;
    rec.groups=pending.groups;rec.entries=pending.entries;
    pending=null;save();render();
  }
  function render(){
    if(!enabled())return disable();
    const list=doc().getElementById('completion_prompt_manager_list');
    if(!list)return;
    const rows=records(),rec=currentRecord();
    if(!rec||!rows.length)return;
    const valid=new Set(rows.map(r=>safe(r.dataset.pmIdentifier)));
    initLegacy(rec,rows);
    if(!rec.groups)rec.groups=[];
    if(!rec.entries)rec.entries={};
    if(!toolbar || toolbar.parentElement!==list.parentElement || toolbar.nextElementSibling!==list){
      toolbar?.remove();
      toolbar=el('div',PREFIX);list.parentElement.insertBefore(toolbar,list);
    }
    host=list;
    toolbar.replaceChildren();
    const title=el('div',PREFIX+'-head','提示词分组');
    title.append(el('small','',currentLegacy?' · 已检测旧分组记录':' · 不改变执行顺序'));
    toolbar.append(title);
    const actions=el('div',PREFIX+'-actions');
    actions.append(btn(selecting?'× 取消选取':'＋ 新建分组',makeGroup));
    if(pending)actions.append(btn('✓ 保存分组',commit,'dw2rl-save-prompt-folders'));
    toolbar.append(actions);
    // The real folders are now inline with the native rows.
    // Keep management actions separate from their presentation.
    showRows(rows,rec);
    const total=rows.length;
    toolbar.append(el('div',PREFIX+'-hint',selecting?(first?'已选起点，请点击终点，系统会自动包含中间条目':'请点击任意提示词的「选取」作为起点'):(pending?'已创建分组，点击「保存分组」确认':'文件夹直接在下方列表内展开/收起 · '+total+' 条')));

  }
  function schedule(){
    if(timer)clearTimeout(timer);
    timer=setTimeout(()=>{timer=0;render();},240);
  }
  function disable(){
    if(timer)clearTimeout(timer);timer=0;
    clearInline(records());
    doc().getElementById('completion_prompt_manager_list')?.classList.remove('dw2rl-prompt-list-filtering');
    toolbar?.remove();toolbar=null;host=null;active='all';currentPreset='';folderCollapsed.clear();selecting=false;first='';pending=null;
  }
  return {sync:schedule,disable};
}
