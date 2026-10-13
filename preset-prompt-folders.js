/**
 * DW2 · Resource Library: TT-native prompt grouping presentation.
 * Never changes native prompt order, prompt objects or draggable row nodes.
 * Restore only the currently selected preset's embedded grouping metadata once.
 * Never rely on an installed BaiBai plugin or use another preset's folders.
 */
const PREFIX='dw2rl-prompt-folders';
const safe=(v)=>String(v??'').trim();
// The embedded group schema comes from preset.extensions, not an installed plugin.
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
export function createPromptFolders({enabled,getState,save,context,getActivePromptIds}){
  let host=null,toolbar=null,timer=0,currentPreset='',active='all',lastSignature='';
  const folderCollapsed=new Map();
  let selecting=false,first='',pending=null,dialog=null,dragBound=null,renderObserver=null,observedList=null,building=false;
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
    if(currentPreset!==name){currentPreset=name;active='all';folderCollapsed.clear();selecting=false;first='';pending=null;}
    if(!state.promptFolders[name])state.promptFolders[name]={groups:[],entries:{}};
    return state.promptFolders[name];
  }
  // Import by exact *selected preset name* and only if DW2 has no folders yet.
  // The same embedded field can be stored in a preset after BaiBai is gone.
  // DW2's own edits always take precedence, including an intentional deletion.
  function restoreSelectedPresetGroups(rec,validIds){
    if(!enabled()||!rec||rec.embeddedImportHandled===true||
       (rec.groups?.length||Object.keys(rec.entries||{}).length)||!validIds.size)return false;
    const name=presetName();
    if(!name || name!==currentPreset)return false;
    try{
      const manager=context()?.getPresetManager?.('openai');
      if(!manager || safe(manager.getSelectedPresetName?.())!==name)return false;
      // Read the named preset object itself, not live serviceSettings:
      // while TT switches A -> B, those settings can briefly still belong
      // to A even though the preset dropdown already says B.
      const preset=manager.getCompletionPresetByName?.(name);
      const raw=preset?.extensions?.baibaiToolkit?.presetPromptGroups;
      if(!raw)return false;
      const embeddedIds=new Set((Array.isArray(preset?.prompts)?preset.prompts:[])
        .map(p=>safe(p?.identifier)).filter(Boolean));
      // The preset's own IDs prevent a half-completed switch from importing
      // previous-preset assignments or only a partial set of its entries.
      const ids=embeddedIds.size?embeddedIds:validIds;
      const parsed=normalizeLegacyGroups(raw,ids);
      if(!parsed?.groups?.length||!Object.keys(parsed.entries).length)return false;
      // Never leak identifiers that aren't present in this preset.
      rec.groups=parsed.groups;rec.entries=parsed.entries;
      rec.embeddedImportHandled=true;
      // Defer listeners; snapshot reads can happen while the floating panel renders.
      queueMicrotask(()=>save());
      return true;
    }catch(error){
      console.warn('[DW2 Resource Library] Unable to read embedded preset groups',error);
      return false;
    }
  }
  function ensureSelectedPresetGroups(){
    const rec=currentRecord();
    if(!rec||!enabled())return false;
    const ids=new Set((getActivePromptIds?.()||[]).map(safe).filter(Boolean));
    return restoreSelectedPresetGroups(rec,ids);
  }
  function el(tag,cls='',label=''){
    const n=doc().createElement(tag);n.className=cls;n.textContent=label;return n;
  }
  function btn(label,run,cls=''){
    const b=el('button',cls,label);b.type='button';b.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();run(event);});return b;
  }
  // Keep native TT rows at their original positions and insert only display labels.
  // One group gets one editable header, and any later runs get a passive cue.
  function planPromptRuns(ids,entries,groups){
    const valid=new Set(groups.map(g=>g.id)),seen=new Set();
    let continued=false;
    return ids.map((id,index)=>{
      const gid=valid.has(entries[id])?entries[id]:'';
      const prev=ids[index-1],next=ids[index+1];
      const before=prev&&valid.has(entries[prev])?entries[prev]:'';
      const after=next&&valid.has(entries[next])?entries[next]:'';
      const start=!!gid&&gid!==before;
      if(start){continued=seen.has(gid);seen.add(gid);}
      if(!gid)continued=false;
      return {gid,first:start&&!continued,continuation:start&&continued,continued:!!gid&&continued,last:!!gid&&gid!==after};
    });
  }
  function clearInline(rows){
    const list=doc().getElementById('completion_prompt_manager_list');
    list?.querySelectorAll(':scope > li.dw2rl-prompt-inline-section, :scope > li.dw2rl-prompt-continuation').forEach(node=>node.remove());
    for(const row of rows){
      row.classList.remove('dw2rl-prompt-row-filtered','dw2rl-prompt-folded-first','dw2rl-inline-folder-host','dw2rl-prompt-range-start','dw2rl-group-body-row','dw2rl-group-body-last','dw2rl-prompt-continued-row');
      row.querySelector(':scope > .dw2rl-prompt-range-choice')?.remove();
      row.querySelector(':scope > .dw2rl-inline-folder')?.remove();
    }
    list?.classList.remove('dw2rl-prompt-list-filtering');
  }
  function countGroup(id,rows,entries){
    const members=rows.filter(r=>entries[safe(r.dataset.pmIdentifier)]===id);
    return {total:members.length,on:members.filter(r=>r.querySelector('.prompt-manager-toggle-action.fa-toggle-on')).length};
  }
  function observeNativeRows(list){
    if(observedList===list)return;
    renderObserver?.disconnect();
    observedList=list;
    renderObserver=new MutationObserver(changes=>{
      if(building || !enabled())return;
      // Only native TT prompt row replacement matters. Ignore DW2's own
      // folder headers and picker controls to avoid observer feedback loops.
      const nativeChanged=changes.some(change=>{
        if(change.type!=='childList'||change.target!==list)return false;
        return [...change.addedNodes,...change.removedNodes].some(node=>
          node.nodeType===1&&node.matches?.('li.completion_prompt_manager_prompt'));
      });
      if(nativeChanged)render();
    });
    renderObserver.observe(list,{childList:true});
  }
  function bindSort(list){
    if(dragBound===list)return;
    if(dragBound)globalThis.jQuery?.(dragBound).off('.dw2rlPromptTransfer');
    dragBound=list;
    const jq=globalThis.jQuery||globalThis.$;
    if(!jq)return;
    jq(list).on('sortstop.dw2rlPromptTransfer',(event,ui)=>{
      const moved=ui?.item?.[0];const id=safe(moved?.dataset?.pmIdentifier);
      if(!id || !list.contains(moved))return;
      let preceding=moved.previousElementSibling;
      while(preceding && !preceding.classList.contains('dw2rl-prompt-inline-section') && !preceding.classList.contains('dw2rl-prompt-continuation'))
        preceding=preceding.previousElementSibling;
      const target=preceding?.dataset?.groupId||'';
      const state=currentRecord(),valid=state?.groups?.some(g=>g.id===target);
      const newGroup=valid?target:'';
      if(!state || (state.entries[id]||'')===newGroup)return;
      if(newGroup)state.entries[id]=newGroup;else delete state.entries[id];
      state.embeddedImportHandled=true;
      save();
      schedule();
    });
  }
  function showRows(rows,record){
    clearInline(rows);
    const effective=pending||record;
    const names=new Map(effective.groups.map(g=>[g.id,g.name]));
    const list=doc().getElementById('completion_prompt_manager_list');
    const plans=planPromptRuns(rows.map(row=>safe(row.dataset.pmIdentifier)),effective.entries,effective.groups);
    for(let index=0;index<rows.length;index++){
      const row=rows[index],id=safe(row.dataset.pmIdentifier);
      const plan=plans[index],groupId=plan.gid;
      if(plan.first){
        const header=el('li','dw2rl-prompt-inline-section');
        header.dataset.groupId=groupId;
        const bar=el('div','dw2rl-inline-folder');
        const toggle=btn((expandedGroup(groupId)?'▾ ':'▸ ')+names.get(groupId),()=>{
          folderCollapsed.set(groupId,!folderCollapsed.get(groupId));render();
        },'dw2rl-inline-folder-toggle');
        toggle.setAttribute('aria-expanded',String(expandedGroup(groupId)));
        const counts=countGroup(groupId,rows,effective.entries);
        const count=el('span','dw2rl-group-count','('+counts.on+'/'+counts.total+')');
        bar.append(toggle,count,btn('✎',()=>changeGroup(groupId),'dw2rl-folder-edit'),
                       btn('×',()=>removeGroup(groupId),'dw2rl-folder-remove'));
        header.append(bar);
        list.insertBefore(header,row);
      }else if(plan.continuation){
        // A lightweight pointer, not a duplicate folder or a delete action.
        // groupId doubles as an accurate anchor for native sortstop assignment.
        const note=el('li','dw2rl-prompt-continuation','↳ '+names.get(groupId)+' · 续');
        note.dataset.groupId=groupId;
        if(!expandedGroup(groupId))note.classList.add('dw2rl-prompt-continuation-hidden');
        list.insertBefore(note,row);
      }
      if(selecting){
        row.append(btn(first===id?'● 起点':'○ 选取',()=>tapRange(id),'dw2rl-prompt-range-choice'));
        if(first===id)row.classList.add('dw2rl-prompt-range-start');
      }
      if(groupId){
        if(plan.continued)row.classList.add('dw2rl-prompt-continued-row');
        else {
          row.classList.add('dw2rl-group-body-row');
          if(plan.last)row.classList.add('dw2rl-group-body-last');
        }
      }
      if(groupId&&!selecting&&!expandedGroup(groupId))row.classList.add('dw2rl-prompt-row-filtered');
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
    rec.embeddedImportHandled=true; // never revive user-deleted folders
    pending=null;save();render();
  }
  function render(){
    if(building)return;
    if(!enabled())return disable();
    const list=doc().getElementById('completion_prompt_manager_list');
    if(!list)return;
    const rows=records(),rec=currentRecord();
    if(!rec||!rows.length)return;
    building=true;
    try{
    // Restore embedded groups of THIS preset only, without altering TT prompts.
    const validIds=new Set(rows.map(row=>safe(row.dataset.pmIdentifier)));
    restoreSelectedPresetGroups(rec,validIds);
    if(!rec.groups)rec.groups=[];
    if(!rec.entries)rec.entries={};
    if(!toolbar || toolbar.parentElement!==list.parentElement || toolbar.nextElementSibling!==list){
      toolbar?.remove();
      toolbar=el('div',PREFIX);list.parentElement.insertBefore(toolbar,list);
    }
    host=list;
    bindSort(list);
    observeNativeRows(list);
    toolbar.replaceChildren();
    const title=el('div',PREFIX+'-head','提示词分组');
    title.append(el('small','',' · 按原生顺序整理'));
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
    }finally{building=false;}
  }
  function schedule(){
    if(timer)clearTimeout(timer);
    // TT rebuilds native prompt rows while saving edits. Defer repaint
    // until its own rerender settles; don't flash ungrouped rows midway.
    timer=setTimeout(()=>{timer=0;render();},35);
  }
  function prepare(){
    // React after native TT row replacement. Never hide the entire prompt list:
    // an interrupted native render must leave the original UI usable.
    schedule();
  }
  function disable(){
    if(timer)clearTimeout(timer);timer=0;
    clearInline(records());
    if(dragBound){(globalThis.jQuery||globalThis.$)?.(dragBound).off('.dw2rlPromptTransfer');dragBound=null;}
    renderObserver?.disconnect();renderObserver=null;observedList=null;
    dialog?.remove();dialog=null;
    doc().getElementById('completion_prompt_manager_list')?.classList.remove('dw2rl-prompt-list-filtering');
    toolbar?.remove();toolbar=null;host=null;active='all';currentPreset='';folderCollapsed.clear();selecting=false;first='';pending=null;
  }
  return {sync:schedule,prepare,disable,getSelectedPresetName:presetName,ensureSelectedPresetGroups};
}
