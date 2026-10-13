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
  let selecting=false,first='',pending=null,dialog=null;
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
    const b=el('button',cls,label);b.type='button';b.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();run(event);});return b;
  }
  // Inline fold headings live INSIDE an existing prompt row, so the
  // sortable list keeps exactly the same <li> nodes and identifiers.
  // No prompt is reordered. Multiple non-contiguous runs of the same folder
  // receive matching headings instead of changing native prompt order.
  function clearInline(rows){
    const list=doc().getElementById('completion_prompt_manager_list');
    list?.querySelectorAll(':scope > li.dw2rl-prompt-inline-section').forEach(node=>node.remove());
    for(const row of rows){
      row.classList.remove('dw2rl-prompt-row-filtered','dw2rl-prompt-folded-first','dw2rl-inline-folder-host','dw2rl-prompt-range-start');
      row.querySelector(':scope > .dw2rl-prompt-range-choice')?.remove();
      row.querySelector(':scope > .dw2rl-inline-folder')?.remove();
    }
    list?.classList.remove('dw2rl-prompt-list-filtering');
  }
  function showRows(rows,record){
    clearInline(rows);
    const effective=pending||record;
    const names=new Map(effective.groups.map(g=>[g.id,g.name]));
    const list=doc().getElementById('completion_prompt_manager_list');
    let previous=null;
    for(const row of rows){
      const id=safe(row.dataset.pmIdentifier);
      const groupId=names.has(effective.entries[id])?effective.entries[id]:'';
      if(groupId&&groupId!==previous){
        const header=el('li','dw2rl-prompt-inline-section');
        const bar=el('div','dw2rl-inline-folder');
        const toggle=btn((expandedGroup(groupId)?'▾ ':'▸ ')+names.get(groupId),()=>{
          folderCollapsed.set(groupId,!folderCollapsed.get(groupId));render();
        },'dw2rl-inline-folder-toggle');
        toggle.setAttribute('aria-expanded',String(expandedGroup(groupId)));
        bar.append(toggle,btn('✎',()=>changeGroup(groupId),'dw2rl-folder-edit'),
                       btn('×',()=>removeGroup(groupId),'dw2rl-folder-remove'));
        header.append(bar);
        list.insertBefore(header,row);
      }
      if(selecting){
        row.append(btn(first===id?'● 起点':'○ 选取',()=>tapRange(id),'dw2rl-prompt-range-choice'));
        if(first===id)row.classList.add('dw2rl-prompt-range-start');
      }
      if(groupId&&!selecting&&!expandedGroup(groupId))row.classList.add('dw2rl-prompt-row-filtered');
      previous=groupId;
    }
  }
  function expandedGroup(key){return folderCollapsed.get(key)!==true;}
  function saveRecord(){save();render();}

  function openDialog({title,initial='',onSubmit,confirmLabel='保存',danger=false}){
    dialog?.remove();
    const backdrop=el('div','dw2rl-prompt-dialog-backdrop');
    const box=el('form','dw2rl-prompt-dialog');
    const heading=el('div','dw2rl-prompt-dialog-title',title);
    const input=doc().createElement('input');
    input.className='text_pole dw2rl-prompt-dialog-input';input.type='text';input.maxLength=50;input.value=initial;
    input.placeholder='请输入分组名称';
    const actions=el('div','dw2rl-prompt-dialog-actions');
    const cancel=btn('取消',()=>{backdrop.remove();dialog=null;});
    const ok=el('button','dw2rl-prompt-dialog-submit',confirmLabel);ok.type='submit';
    if(danger)ok.classList.add('dw2rl-danger');
    actions.append(cancel,ok);box.append(heading);if(!danger)box.append(input);box.append(actions);
    backdrop.append(box);
    // Keep the modal inside TT's settings drawer. Appending to body causes
    // mobile panel outside-click handlers to treat EVERY modal action as a
    // navigation-away gesture and close the entire settings panel.
    const anchor=doc().getElementById('completion_prompt_manager');
    if(!anchor?.isConnected)return;
    anchor.append(backdrop);dialog=backdrop;
    for(const type of ['pointerdown','pointerup','touchstart','touchend','mousedown','mouseup','click']){
      backdrop.addEventListener(type,event=>event.stopPropagation());
    }
    box.addEventListener('submit',ev=>{
      ev.preventDefault();ev.stopPropagation();const value=safe(input.value).slice(0,50);
      if(!danger&&!value){input.focus();return;}
      if(onSubmit(value)!==false){backdrop.remove();dialog=null;}
    });
    backdrop.addEventListener('click',ev=>{if(ev.target===backdrop){ev.preventDefault();backdrop.remove();dialog=null;}});
    if(!danger)setTimeout(()=>input.focus(),60);
  }
  function getDraft(){
    if(pending)return pending;
    const rec=currentRecord();if(!rec)return null;
    pending={groups:(rec.groups||[]).map(g=>({...g})),entries:{...rec.entries}};
    return pending;
  }
  function changeGroup(id){
    const rec=pending||currentRecord(),group=rec?.groups.find(g=>g.id===id);if(!group)return;
    openDialog({title:'修改文件夹名称',initial:group.name,onSubmit:name=>{
      if(rec.groups.some(g=>g.id!==id&&g.name===name))return false;
      getDraft().groups.find(g=>g.id===id).name=name;commit();
    }});
  }
  function removeGroup(id){
    const rec=pending||currentRecord(),group=rec?.groups.find(g=>g.id===id);if(!group)return;
    openDialog({title:'删除「'+group.name+'」？提示词不会被删除。',danger:true,confirmLabel:'删除文件夹',onSubmit:()=>{
      const draft=getDraft();draft.groups=draft.groups.filter(g=>g.id!==id);
      for(const [key,gid] of Object.entries(draft.entries))if(gid===id)delete draft.entries[key];
      folderCollapsed.delete(id);commit();
    }});
  }
  function makeGroup(){selecting=!selecting;first='';folderCollapsed.clear();render();}
  function tapRange(id){
    const ids=records().map(r=>safe(r.dataset.pmIdentifier));
    if(!first){first=id;render();return;}
    const a=ids.indexOf(first),b=ids.indexOf(id);if(a<0||b<0)return;
    const picked=ids.slice(Math.min(a,b),Math.max(a,b)+1);
    const rec=pending||currentRecord();if(!rec)return;
    openDialog({title:'为这 '+picked.length+' 条提示词命名分组',onSubmit:name=>{
      if(rec.groups.some(g=>g.name===name))return false;
      const draft=getDraft(),gid='dw2g'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
      draft.groups.push({id:gid,name});for(const key of picked)draft.entries[key]=gid;
      first='';selecting=false;commit();
    }});
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
    title.append(el('small','',currentLegacy?' · 旧分组已恢复':' · 按顺序整理'));
    toolbar.append(title);
    const actions=el('div',PREFIX+'-actions');
    actions.append(btn(selecting?'× 取消选取':'＋ 新建分组',makeGroup,'menu_button'));
    toolbar.append(actions);
    // The real folders are now inline with the native rows.
    // Keep management actions separate from their presentation.
    showRows(rows,rec);
    const total=rows.length;
    const message=selecting
      ?(first?'已选起点，请选择最后一条；中间条目自动纳入。':'请选择分组的第一条和最后一条。')
      :'共 '+total+' 条 · 文件夹直接在下方展开或收起';
    toolbar.append(el('div',PREFIX+'-hint',message));

  }
  function schedule(){
    if(timer)clearTimeout(timer);
    // TT rebuilds native prompt rows while saving edits. Defer repaint
    // until its own rerender settles; don't flash ungrouped rows midway.
    timer=setTimeout(()=>{timer=0;render();},420);
  }
  function disable(){
    if(timer)clearTimeout(timer);timer=0;
    clearInline(records());
    dialog?.remove();dialog=null;
    doc().getElementById('completion_prompt_manager_list')?.classList.remove('dw2rl-prompt-list-filtering');
    toolbar?.remove();toolbar=null;host=null;active='all';currentPreset='';folderCollapsed.clear();selecting=false;first='';pending=null;
  }
  return {sync:schedule,disable};
}
