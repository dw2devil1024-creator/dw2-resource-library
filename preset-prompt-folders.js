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
    if(currentPreset!==name){currentPreset=name;active='all';legacyLoaded='';folderCollapsed.clear();}
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
      row.querySelector(':scope > .dw2rl-inline-folder')?.remove();
      row.classList.remove('dw2rl-inline-folder-host');
    }
    doc().getElementById('completion_prompt_manager_list')?.classList.remove('dw2rl-prompt-list-filtering');
  }
  function showRows(rows,record){
    clearInline(rows);
    const names=new Map(record.groups.map(g=>[g.id,g.name]));
    const valid=new Set(rows.map(row=>safe(row.dataset.pmIdentifier)));
    let previous=null,runIndex=0;
    for(const row of rows){
      const id=safe(row.dataset.pmIdentifier);
      const groupId=names.has(record.entries[id])?record.entries[id]:'';
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
      if(!expandedGroup(current)){
        if(current!==previous)row.classList.add('dw2rl-prompt-folded-first');
        else row.classList.add('dw2rl-prompt-row-filtered');
      }
      previous=current;
    }
    return valid;
  }
  function expandedGroup(key){return folderCollapsed.get(key)!==true;}
  function saveRecord(){save();render();}
  function makeGroup(){
    const name=safe(prompt('新建分组名称')).slice(0,50);
    if(!name)return;
    const rec=currentRecord();if(!rec)return;
    if(rec.groups.some(g=>g.name===name)){alert('这个分组名称已存在');return;}
    rec.groups.push({id:'dw2g'+Date.now().toString(36)+Math.random().toString(36).slice(2,7),name});
    saveRecord();
  }
  function editGroup(){
    if(active==='all'||active==='loose')return;
    const rec=currentRecord(),group=rec?.groups.find(g=>g.id===active);if(!group)return;
    const name=prompt('修改分组名称。留空则取消修改',group.name);
    if(name===null||!safe(name))return;
    const next=safe(name).slice(0,50);
    if(rec.groups.some(g=>g.id!==group.id&&g.name===next)){alert('已存在同名分组');return;}
    group.name=next;saveRecord();
  }
  function deleteGroup(){
    if(active==='all'||active==='loose')return;
    const rec=currentRecord(),group=rec?.groups.find(g=>g.id===active);if(!group)return;
    if(!confirm('删除「'+group.name+'」分组？分组内的提示词只会变成未分组，不会被删除。'))return;
    rec.groups=rec.groups.filter(g=>g.id!==group.id);
    for(const [id,value] of Object.entries(rec.entries))if(value===group.id)delete rec.entries[id];
    active='all';saveRecord();
  }
  function manageGroups(rec){
    const overlay=el('div',PREFIX+'-organizer');
    overlay.append(el('div',PREFIX+'-organizer-head','管理文件夹'));
    const close=btn('关闭',()=>overlay.remove());overlay.firstChild.append(close);
    for(const group of rec.groups){
      const line=el('div',PREFIX+'-organizer-item');
      line.append(el('span','',group.name));
      line.append(btn('改名',()=>{
        const value=prompt('修改文件夹名称',group.name);
        if(value===null||!safe(value))return;
        const name=safe(value).slice(0,50);
        if(rec.groups.some(g=>g.id!==group.id&&g.name===name))return alert('名称已存在');
        group.name=name;saveRecord();
      }));
      line.append(btn('删除',()=>{
        if(!confirm('删除「'+group.name+'」文件夹？提示词不会删除。'))return;
        rec.groups=rec.groups.filter(g=>g.id!==group.id);
        for(const [id,gid] of Object.entries(rec.entries))if(gid===group.id)delete rec.entries[id];
        saveRecord();
      }));
      overlay.append(line);
    }
    toolbar.append(overlay);
  }
  function organize(rows,record){
    const overlay=el('div',PREFIX+'-organizer');
    const close=btn('关闭',()=>overlay.remove());
    const heading=el('div',PREFIX+'-organizer-head','整理提示词归属');
    heading.append(close);
    overlay.append(heading,el('p',PREFIX+'-note','这里只修改文件夹归属，不改变提示词执行顺序。原生拖拽请切回「全部」。'));
    const list=el('div',PREFIX+'-organizer-list');
    for(const row of rows){
      const id=safe(row.dataset.pmIdentifier);
      const label=safe(row.querySelector('.completion_prompt_manager_prompt_name')?.getAttribute('data-pm-name'))||safe(row.textContent).slice(0,80);
      const line=el('label',PREFIX+'-organizer-item');
      line.append(el('span','',label));
      const select=doc().createElement('select');select.setAttribute('aria-label','将 '+label+' 移入分组');
      const loose=doc().createElement('option');loose.value='';loose.textContent='未分组';select.append(loose);
      for(const g of record.groups){const opt=doc().createElement('option');opt.value=g.id;opt.textContent=g.name;select.append(opt);}
      select.value=record.entries[id]||'';
      select.addEventListener('change',()=>{
        if(select.value)record.entries[id]=select.value;
        else delete record.entries[id];
        save();setTimeout(render,0);
      });
      line.append(select);list.append(line);
    }
    overlay.append(list);toolbar.append(overlay);
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
    actions.append(btn('＋ 新建分组',makeGroup),btn('整理归属',()=>organize(rows,rec)));
    actions.append(btn('管理文件夹',()=>manageGroups(rec)));
    toolbar.append(actions);
    // The real folders are now inline with the native rows.
    // Keep management actions separate from their presentation.
    showRows(rows,rec);
    const total=rows.length;
    toolbar.append(el('div',PREFIX+'-hint',total+' 条提示词 · 文件夹直接在下方列表中展开/收起；原有顺序不变'));

  }
  function schedule(){
    if(timer)clearTimeout(timer);
    timer=setTimeout(()=>{timer=0;render();},240);
  }
  function disable(){
    if(timer)clearTimeout(timer);timer=0;
    clearInline(records());
    doc().getElementById('completion_prompt_manager_list')?.classList.remove('dw2rl-prompt-list-filtering');
    toolbar?.remove();toolbar=null;host=null;active='all';currentPreset='';folderCollapsed.clear();
  }
  return {sync:schedule,disable};
}
