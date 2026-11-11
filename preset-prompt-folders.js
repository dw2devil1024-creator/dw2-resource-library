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
export function createPromptFolders({enabled,getState,save,context,getActivePromptIds,promptManagerApi}){
  let host=null,toolbar=null,timer=0,currentPreset='',active='all',lastSignature='';
  let microtaskPending=false,sorting=false;
  const folderCollapsed=new Map();
  let lastRenderedRows=[],lastRenderedList=null,lastToolbarSignature='';
  let selecting=false,first='',pending=null,dialog=null,dragBound=null,renderObserver=null,observedList=null,building=false,trashBound=null;
  const doc=()=>document;
  // Android WebView: TT's PromptManager clears and rebuilds its entire
  // list after every native enable/disable toggle. While empty the scrolling
  // drawer loses its height, then TT restores a numeric scroll position.
  // Keep the old height until DW2 has restored folder headers, and anchor
  // the tapped row/header rather than trusting that temporary scroll value.
  const androidScrollGuard=typeof navigator!=='undefined'&&/Android/i.test(navigator.userAgent||'');
  // Unlike scroll correction, direct native prompt toggles work equally well
  // on iPhone/iPad and Android, while leaving desktop TT's native path alone.
  const mobileToggleEnabled=typeof navigator!=='undefined'&&(
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent||'')||
    (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)
  );
  let viewportGuard=null,viewportTimer=0,viewportFrame=0,viewportExtraTimer=0,guardedList=null;
  function scrollContainer(){
    return doc().getElementById('completion_prompt_manager')?.closest('.scrollableInner')
      ||doc().getElementById('completion_prompt_manager_list')?.closest('.scrollableInner')
      ||doc().scrollingElement||null;
  }
  function anchorForGuard(info){
    if(!info?.list?.isConnected)return null;
    if(info.type==='prompt')return records()
      .find(row=>safe(row.dataset.pmIdentifier)===info.id)||null;
    return [...info.list.querySelectorAll(':scope > li.dw2rl-prompt-inline-section')]
      .find(header=>header.dataset.groupId===info.id)||null;
  }
  function correctViewport(){
    const info=viewportGuard;
    if(!info||!info.scroller?.isConnected)return;
    const node=anchorForGuard(info);
    if(!node?.isConnected)return;
    const top=node.getBoundingClientRect().top-info.scroller.getBoundingClientRect().top;
    const delta=top-info.relativeTop;
    if(Number.isFinite(delta)&&Math.abs(delta)>1){
      info.scroller.scrollTop+=delta;
    }
  }
  function releaseViewportGuard(){
    const info=viewportGuard;
    if(viewportTimer)clearTimeout(viewportTimer);
    if(viewportFrame)cancelAnimationFrame(viewportFrame);
    if(viewportExtraTimer)clearTimeout(viewportExtraTimer);
    viewportTimer=0;viewportFrame=0;viewportExtraTimer=0;viewportGuard=null;
    if(!info)return;
    if(info.cancelOnInteraction){
      for(const kind of ['pointerdown','touchstart','wheel']){
        info.scroller?.removeEventListener?.(kind,info.cancelOnInteraction,true);
      }
    }
    // Restore EXACT inline scroll policies, including author-set priorities.
    if(info.scrollStyleHeld&&info.scroller?.style){
      const style=info.scroller.style;
      if(info.oldScrollBehavior)style.setProperty('scroll-behavior',info.oldScrollBehavior,info.oldScrollPriority);
      else style.removeProperty('scroll-behavior');
      if(info.oldOverflowAnchor)style.setProperty('overflow-anchor',info.oldOverflowAnchor,info.oldOverflowPriority);
      else style.removeProperty('overflow-anchor');
    }
    if(info.heightHeld&&info.list?.style){
      if(info.oldMinHeight)info.list.style.setProperty('min-height',info.oldMinHeight,info.oldMinPriority);
      else info.list.style.removeProperty('min-height');
    }
  }
  function settleViewportGuard(){
    if(!viewportGuard)return;
    const info=viewportGuard;
    correctViewport();
    if(viewportFrame)cancelAnimationFrame(viewportFrame);
    if(viewportExtraTimer)clearTimeout(viewportExtraTimer);
    viewportFrame=0;viewportExtraTimer=0;
    if(info.type==='header'){
      // Folding already behaves correctly: preserve its existing one-frame fix.
      viewportFrame=requestAnimationFrame(()=>{
        viewportFrame=0;
        if(viewportGuard!==info)return;
        correctViewport();
        releaseViewportGuard();
      });
      return;
    }
    // TT can call #setScrollPosition() AFTER the DOM mutation that triggered
    // our first correction. Android WebView may also settle its scroll anchor
    // for several frames. Do not release this toggle guard after one frame.
    let remaining=12;
    const stabilize=()=>{
      viewportFrame=0;
      if(viewportGuard!==info)return;
      if(!anchorForGuard(info))return; // A newer TT rerender may be pending.
      correctViewport();
      if(--remaining>0){
        viewportFrame=requestAnimationFrame(stabilize);
      }else{
        // One final delayed pass catches TT's late scroll restoration.
        viewportExtraTimer=setTimeout(()=>{
          viewportExtraTimer=0;
          if(viewportGuard!==info)return;
          correctViewport();
          releaseViewportGuard();
        },90);
      }
    };
    viewportFrame=requestAnimationFrame(stabilize);
  }
  function captureViewport(target,{keepHeight=false}={}){
    if(!androidScrollGuard)return;
    const list=doc().getElementById('completion_prompt_manager_list');
    const scroller=scrollContainer();
    const row=target?.closest?.('li.completion_prompt_manager_prompt');
    const header=row?null:target?.closest?.('li.dw2rl-prompt-inline-section');
    const node=row||header;
    if(!list||!scroller||!node||!list.contains(node))return;
    releaseViewportGuard();
    const id=row?safe(row.dataset.pmIdentifier):safe(header.dataset.groupId);
    if(!id)return;
    const oldMinHeight=list.style.getPropertyValue('min-height');
    const oldMinPriority=list.style.getPropertyPriority('min-height');
    const height=Math.ceil(list.getBoundingClientRect().height);
    viewportGuard={
      list,scroller,type:row?'prompt':'header',id,
      originalNode:node,relativeTop:node.getBoundingClientRect().top-
        scroller.getBoundingClientRect().top,
      heightHeld:keepHeight&&height>0,oldMinHeight,oldMinPriority,
      scrollStyleHeld:keepHeight&&!!scroller.style,
      oldScrollBehavior:scroller.style?.getPropertyValue('scroll-behavior')||'',
      oldScrollPriority:scroller.style?.getPropertyPriority('scroll-behavior')||'',
      oldOverflowAnchor:scroller.style?.getPropertyValue('overflow-anchor')||'',
      oldOverflowPriority:scroller.style?.getPropertyPriority('overflow-anchor')||'',
      cancelOnInteraction:null
    };
    if(viewportGuard.heightHeld)list.style.setProperty('min-height',height+'px','important');
    if(viewportGuard.scrollStyleHeld){
      // Avoid smooth scrolling and the browser's competing automatic anchor
      // only while one native toggle is being rerendered.
      scroller.style.setProperty('scroll-behavior','auto','important');
      scroller.style.setProperty('overflow-anchor','none','important');
      viewportGuard.cancelOnInteraction=()=>releaseViewportGuard();
      for(const kind of ['pointerdown','touchstart','wheel']){
        scroller.addEventListener?.(kind,viewportGuard.cancelOnInteraction,
          {capture:true,passive:true});
      }
    }
    // If TT suppresses a render, don't leave a minimum height behind.
    viewportTimer=setTimeout(()=>{correctViewport();releaseViewportGuard();},1800);
  }
  // A native TT toggle schedules renderDebounced(), which destroys and
  // recreates the entire prompt list. On Android this causes an upward jump
  // even if scroll position is corrected after the fact. Update the existing
  // TT prompt-order entry and its already-mounted row IN PLACE instead.
  // This is only enabled when the exact native PromptManager API is ready;
  // otherwise the original click handler and scroll guard remain available.
  function togglePromptInPlace(event,toggle){
    if(!mobileToggleEnabled||!enabled()||!toggle?.isConnected)return false;
    const pm=promptManagerApi;
    if(!pm||typeof pm.getPromptOrderEntry!=='function'||
       typeof pm.saveServiceSettings!=='function')return false;
    const row=toggle.closest('li.completion_prompt_manager_prompt');
    const id=safe(row?.dataset?.pmIdentifier);
    const character=pm.activeCharacter;
    if(!id||!row||!character)return false;
    let entry;
    try{
      const prompt=pm.getPromptById?.(id);
      if(!prompt||pm.isPromptToggleAllowed?.(prompt)===false)return false;
      entry=pm.getPromptOrderEntry(character,id);
    }catch(error){
      console.warn('[DW2 Resource Library] Cannot read native prompt toggle state',error);
      return false;
    }
    if(!entry||typeof entry.enabled!=='boolean')return false;
    // Prevent TT's click listener on the icon from scheduling a full
    // render. The native save method is still used to persist this change.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const next=!entry.enabled;
    entry.enabled=next;
    try{
      const counts=pm.tokenHandler?.getCounts?.();
      if(counts)counts[id]=null;
    }catch(error){
      console.debug('[DW2 Resource Library] Token cache update skipped',error);
    }
    for(const current of records()){
      if(safe(current.dataset.pmIdentifier)!==id)continue;
      current.classList.toggle('completion_prompt_manager_prompt_disabled',!next);
      const icon=current.querySelector('.prompt-manager-toggle-action');
      icon?.classList.toggle('fa-toggle-on',next);
      icon?.classList.toggle('fa-toggle-off',!next);
      const cell=current.querySelector('.prompt_manager_prompt_tokens');
      if(cell){
        cell.dataset.pmTokens='-';
        cell.textContent='-';
      }
    }
    const rec=currentRecord();
    if(rec)updateGroupCounts(records(),pending||rec);
    try{
      Promise.resolve(pm.saveServiceSettings()).catch(error=>
        console.warn('[DW2 Resource Library] Native prompt setting save failed',error));
    }catch(error){
      console.warn('[DW2 Resource Library] Native prompt setting save failed',error);
    }
    return true;
  }
  function captureNativeToggle(event){
    const target=event.target?.closest?.('.prompt-manager-toggle-action');
    if(!target||!guardedList?.contains(target))return;
    if(togglePromptInPlace(event,target))return;
    // Compatibility fallback: Android retains its existing scroll guard;
    // iOS lets TT's stock handler run normally if native APIs differ.
    if(androidScrollGuard)captureViewport(target,{keepHeight:true});
  }
  function bindNativeToggleGuard(list){
    if(!mobileToggleEnabled||guardedList===list)return;
    if(guardedList)guardedList.removeEventListener('click',captureNativeToggle,true);
    guardedList=list;
    list.addEventListener('click',captureNativeToggle,true);
  }
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
    if(!state.promptFolders[name])state.promptFolders[name]={groups:[],entries:{},collapsed:{}};
    const rec=state.promptFolders[name];
    if(!rec.collapsed||typeof rec.collapsed!=='object'||Array.isArray(rec.collapsed))rec.collapsed={};
    if(currentPreset!==name){
      // A fast preset switch must not leave the previous preset's Android
      // temporary list height or scroll anchor active.
      releaseViewportGuard();
      currentPreset=name;active='all';folderCollapsed.clear();selecting=false;first='';pending=null;
      lastSignature='';lastRenderedRows=[];lastRenderedList=null;lastToolbarSignature='';
      for(const group of rec.groups||[]){
        if(rec.collapsed[group.id]===true)folderCollapsed.set(group.id,true);
      }
    }
    return rec;
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
      // Only TT native rows being replaced or reordered require a full
      // group rebuild. Internal header mutations cannot trigger this path.
      const nativeChanged=changes.some(change=>{
        if(change.type!=='childList'||change.target!==list)return false;
        return [...change.addedNodes,...change.removedNodes].some(node=>
          node.nodeType===1&&node.matches?.('li.completion_prompt_manager_prompt'));
      });
      if(nativeChanged){
        // Recreate our folder presentation in the same mutation checkpoint as
        // TT's new rows, before Android WebView paints an ungrouped list.
        if(androidScrollGuard&&records().length)render();
        else schedule();
        return;
      }
      // TT can also flip a toggle icon's class in place. Refresh counters
      // without destroying the list or its folder headers.
      if(changes.some(change=>change.type==='attributes'&&
         change.target?.matches?.('.prompt-manager-toggle-action'))){
        const rec=currentRecord();
        if(rec)updateGroupCounts(records(),pending||rec);
      }
    });
    renderObserver.observe(list,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  }
  function groupAtDrop(moved,entries,validGroups){
    // Decide from the immediately preceding *meaningful* sibling, never
    // from a distant folder header across unrelated ungrouped prompts.
    let preceding=moved.previousElementSibling;
    while(preceding && !preceding.classList.contains('dw2rl-prompt-inline-section') &&
          !preceding.classList.contains('dw2rl-prompt-continuation') &&
          !preceding.classList.contains('completion_prompt_manager_prompt'))
      preceding=preceding.previousElementSibling;
    if(!preceding)return '';
    let groupId='';
    if(preceding.classList.contains('completion_prompt_manager_prompt'))
      groupId=entries[safe(preceding.dataset.pmIdentifier)]||'';
    else groupId=preceding.dataset.groupId||'';
    return validGroups.has(groupId)?groupId:'';
  }
  function bindSort(list){
    if(dragBound===list)return;
    if(dragBound)globalThis.jQuery?.(dragBound).off('.dw2rlPromptTransfer');
    dragBound=list;
    const jq=globalThis.jQuery||globalThis.$;
    if(!jq)return;
    jq(list).on('sortstart.dw2rlPromptTransfer',()=>{sorting=true;});
    jq(list).on('sortstop.dw2rlPromptTransfer',(event,ui)=>{
      sorting=false;
      schedule();
      const moved=ui?.item?.[0];const id=safe(moved?.dataset?.pmIdentifier);
      if(!id || !list.contains(moved))return;
      const state=currentRecord();
      if(!state)return;
      const validGroups=new Set((state.groups||[]).map(g=>g.id));
      const newGroup=groupAtDrop(moved,state.entries||{},validGroups);
      if(!state || (state.entries[id]||'')===newGroup)return;
      if(newGroup)state.entries[id]=newGroup;else delete state.entries[id];
      state.embeddedImportHandled=true;
      save();
      schedule();
    });
  }

  // TT renders a native 'detach' icon only for deletable (non-system)
  // prompts. Reuse that exact icon slot as a trash action; retain its
  // original node and native click listener so disabling DW2 restores TT.
  function decoratePromptTrashRows(rows){
    if(!enabled())return;
    const pm=promptManagerApi;
    if(!pm||typeof pm.getPromptById!=='function'||
       typeof pm.getPromptOrderForCharacter!=='function'||
       typeof pm.isPromptDeletionAllowed!=='function'||
       typeof pm.saveServiceSettings!=='function')return;
    for(const row of rows){
      const icon=row.querySelector('.prompt-manager-detach-action');
      if(!icon||icon.classList.contains('dw2rl-prompt-trash-action'))continue;
      const prompt=pm.getPromptById(safe(row.dataset.pmIdentifier));
      if(!prompt||pm.isPromptDeletionAllowed(prompt)!==true)continue;
      icon.dataset.dw2rlPromptOriginalTitle=icon.getAttribute('title')??'';
      icon.classList.remove('fa-chain-broken');
      icon.classList.add('fa-trash','dw2rl-prompt-trash-action');
      icon.setAttribute('title','删除或移除提示词');
      icon.setAttribute('aria-label','删除或移除提示词');
      icon.setAttribute('role','button');
      icon.setAttribute('tabindex','0');
    }
  }
  function restorePromptTrashRows(rows){
    for(const row of rows){
      const icon=row.querySelector('.dw2rl-prompt-trash-action');
      if(!icon)continue;
      icon.classList.remove('dw2rl-prompt-trash-action','fa-trash');
      icon.classList.add('fa-chain-broken');
      icon.setAttribute('title',icon.dataset.dw2rlPromptOriginalTitle??'Remove');
      delete icon.dataset.dw2rlPromptOriginalTitle;
      icon.removeAttribute('aria-label');
      icon.removeAttribute('role');
      icon.removeAttribute('tabindex');
    }
  }
  function promptTrashEligible(pm,id){
    if(!pm?.activeCharacter||!Array.isArray(pm.serviceSettings?.prompts)||
       typeof pm.getPromptById!=='function'||
       typeof pm.isPromptDeletionAllowed!=='function'||
       typeof pm.getPromptOrderForCharacter!=='function'||
       typeof pm.saveServiceSettings!=='function')return false;
    const prompt=pm.getPromptById(id);
    if(!prompt||pm.isPromptDeletionAllowed(prompt)!==true)return false;
    const order=pm.getPromptOrderForCharacter(pm.activeCharacter);
    return Array.isArray(order)&&order.some(item=>item?.identifier===id);
  }
  function removePromptReferences(order,id){
    if(!Array.isArray(order))return false;
    let changed=false;
    for(let i=order.length-1;i>=0;i--){
      if(order[i]?.identifier===id){order.splice(i,1);changed=true;}
    }
    return changed;
  }
  function performPromptTrash(id,mode,presetAtOpen,characterAtOpen){
    const pm=promptManagerApi;
    if(!enabled()||!pm||presetName()!==presetAtOpen||
       String(pm.activeCharacter?.id)!==characterAtOpen||
       !promptTrashEligible(pm,id))return false;
    const active=pm.getPromptOrderForCharacter(pm.activeCharacter);
    if(mode==='delete'){
      // Complete deletion removes the definition and all references within
      // this preset's native serviceSettings. Do not mutate any other preset.
      const index=pm.serviceSettings.prompts.findIndex(item=>item?.identifier===id);
      if(index<0||!Array.isArray(pm.serviceSettings?.prompt_order))return false;
      pm.serviceSettings.prompts.splice(index,1);
      for(const order of pm.serviceSettings.prompt_order)
        removePromptReferences(order?.order,id);
      removePromptReferences(active,id);
    }else if(mode==='detach'){
      // Only remove the current prompt-order membership; its definition is
      // retained and can be re-added via TT's native prompt editor.
      removePromptReferences(active,id);
    }else return false;
    const rec=currentRecord();
    if(rec){
      delete rec.entries[id];
      rec.embeddedImportHandled=true;
    }
    if(pending?.entries)delete pending.entries[id];
    if(first===id)first='';
    if(mode==='delete'){
      try{
        const counts=pm.tokenHandler?.getCounts?.();
        if(counts)delete counts[id];
      }catch(error){console.debug('[DW2 Prompt Trash] Token cache cleanup skipped',error);}
    }
    for(const row of records())
      if(safe(row.dataset.pmIdentifier)===id)row.remove();
    save(); // DW2 group membership and console snapshot refresh.
    render(); // Rebuild folder captions only; native TT rows stay mounted.
    try{
      Promise.resolve(pm.saveServiceSettings()).catch(error=>{
        console.warn('[DW2 Prompt Trash] Native preset save failed',error);
        globalThis.toastr?.error?.('预设保存失败，请检查设置和备份');
      });
    }catch(error){
      console.warn('[DW2 Prompt Trash] Native preset save failed',error);
      globalThis.toastr?.error?.('预设保存失败，请检查设置和备份');
    }
    return true;
  }
  function openPromptTrashDialog(row){
    const id=safe(row?.dataset.pmIdentifier);
    const pm=promptManagerApi;
    if(!id||!promptTrashEligible(pm,id))return;
    const presetAtOpen=presetName(),characterAtOpen=String(pm.activeCharacter.id);
    if(!presetAtOpen)return;
    const name=safe(pm.getPromptById(id)?.name)||id;
    const anchor=doc().getElementById('completion_prompt_manager');
    if(!anchor?.isConnected)return;
    dialog?.remove();
    const backdrop=el('div','dw2rl-prompt-dialog-backdrop');
    const box=el('div','dw2rl-prompt-dialog');
    box.append(
      el('div','dw2rl-prompt-dialog-title','处理提示词条目'),
      el('div','dw2rl-prompt-delete-name',name),
      el('div','dw2rl-prompt-delete-description',
        '「仅移除」保留提示词本体，可以重新添加；「彻底删除」会从当前预设删除提示词本体及其引用，需要备份才能恢复。')
    );
    const actions=el('div','dw2rl-prompt-dialog-actions dw2rl-prompt-delete-actions');
    const close=()=>{backdrop.remove();if(dialog===backdrop)dialog=null;};
    actions.append(
      btn('取消',close),
      btn('仅移除',()=>{
        if(performPromptTrash(id,'detach',presetAtOpen,characterAtOpen))close();
        else{close();globalThis.toastr?.warning?.('预设已变化或条目不可移除');}
      }),
      btn('彻底删除',()=>{
        if(performPromptTrash(id,'delete',presetAtOpen,characterAtOpen))close();
        else{close();globalThis.toastr?.warning?.('预设已变化或条目不可删除');}
      },'dw2rl-prompt-dialog-submit dw2rl-danger')
    );
    box.append(actions);backdrop.append(box);
    anchor.append(backdrop);dialog=backdrop;
    for(const kind of ['pointerdown','pointerup','touchstart','touchend','mousedown','mouseup','click'])
      backdrop.addEventListener(kind,event=>event.stopPropagation());
    backdrop.addEventListener('click',event=>{
      if(event.target===backdrop){event.preventDefault();close();}
    });
  }
  function capturePromptTrash(event){
    const icon=event.target?.closest?.('.dw2rl-prompt-trash-action');
    if(!icon||!trashBound?.contains(icon)||!enabled())return;
    const row=icon.closest('li.completion_prompt_manager_prompt');
    if(!row)return;
    // Stop TT's original detach listener before it can run.
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    openPromptTrashDialog(row);
  }
  function capturePromptTrashKey(event){
    if(event.key!=='Enter'&&event.key!==' ')return;
    if(!event.target?.matches?.('.dw2rl-prompt-trash-action'))return;
    capturePromptTrash(event);
  }
  function bindPromptTrash(list){
    if(trashBound===list)return;
    if(trashBound){
      trashBound.removeEventListener('click',capturePromptTrash,true);
      trashBound.removeEventListener('keydown',capturePromptTrashKey,true);
    }
    trashBound=list;
    list.addEventListener('click',capturePromptTrash,true);
    list.addEventListener('keydown',capturePromptTrashKey,true);
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
          toggleGroup(groupId,toggle);
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
  function expandedGroup(key){return selecting||folderCollapsed.get(key)!==true;}
  // Fold/unfold only toggles CSS classes. Never remove and recreate 200+
  // PromptManager rows just to open a single group.
  function toggleGroup(groupId,button){
    captureViewport(button);
    const rec=currentRecord();
    if(!rec)return;
    const next=folderCollapsed.get(groupId)!==true;
    if(next){folderCollapsed.set(groupId,true);rec.collapsed[groupId]=true;}
    else{folderCollapsed.delete(groupId);delete rec.collapsed[groupId];}
    const list=doc().getElementById('completion_prompt_manager_list');
    if(!list)return;
    const rows=records();
    for(const row of rows){
      if(rec.entries[safe(row.dataset.pmIdentifier)]!==groupId)continue;
      row.classList.toggle('dw2rl-prompt-row-filtered',next&&!selecting);
    }
    for(const label of list.querySelectorAll(':scope > li.dw2rl-prompt-continuation')){
      if(label.dataset.groupId===groupId)
        label.classList.toggle('dw2rl-prompt-continuation-hidden',next&&!selecting);
    }
    const name=rec.groups.find(group=>group.id===groupId)?.name||'';
    for(const header of list.querySelectorAll(':scope > li.dw2rl-prompt-inline-section')){
      if(header.dataset.groupId!==groupId)continue;
      const button=header.querySelector('.dw2rl-inline-folder-toggle');
      if(button){
        button.textContent=(next?'▸ ':'▾ ')+name;
        button.setAttribute('aria-expanded',String(!next));
      }
    }
    lastSignature=folderSignature(rows,pending||rec);
    save();
    settleViewportGuard();
  }
  function updateGroupCounts(rows,rec){
    const list=doc().getElementById('completion_prompt_manager_list');
    if(!list)return;
    const counters=new Map();
    for(const row of rows){
      const gid=rec.entries[safe(row.dataset.pmIdentifier)];
      if(!gid)continue;
      if(!counters.has(gid))counters.set(gid,{total:0,on:0});
      const count=counters.get(gid);
      count.total++;
      if(row.querySelector('.prompt-manager-toggle-action.fa-toggle-on'))count.on++;
    }
    for(const header of list.querySelectorAll(':scope > li.dw2rl-prompt-inline-section')){
      const count=counters.get(header.dataset.groupId);
      const field=header.querySelector('.dw2rl-group-count');
      if(field&&count){
        const label='('+count.on+'/'+count.total+')';
        if(field.textContent!==label)field.textContent=label;
      }
    }
  }
  function folderSignature(rows,rec){
    return JSON.stringify({
      preset:currentPreset,selecting,first,
      groups:(rec.groups||[]).map(g=>[g.id,g.name,folderCollapsed.get(g.id)===true]),
      rows:rows.map(row=>[safe(row.dataset.pmIdentifier),rec.entries[safe(row.dataset.pmIdentifier)]||''])
    });
  }
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
  function makeGroup(){selecting=!selecting;first='';render();}
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
    const valid=new Set(rec.groups.map(group=>group.id));
    for(const id of Object.keys(rec.collapsed||{}))if(!valid.has(id))delete rec.collapsed[id];
    rec.embeddedImportHandled=true; // never revive user-deleted folders
    pending=null;save();render();
  }
  function render(){
    if(building||sorting)return;
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
      lastToolbarSignature='';
    }
    host=list;
    bindSort(list);
    observeNativeRows(list);
    bindNativeToggleGuard(list);
    bindPromptTrash(list);
    const toolbarSignature=JSON.stringify([currentPreset,selecting,first,rows.length]);
    const toolbarChanged=lastToolbarSignature!==toolbarSignature;
    if(toolbarChanged){
      toolbar.replaceChildren();
      const title=el('div',PREFIX+'-head','提示词分组');
      title.append(el('small','',' · 按原生顺序整理'));
      toolbar.append(title);
      const actions=el('div',PREFIX+'-actions');
      actions.append(btn(selecting?'× 取消选取':'＋ 新建分组',makeGroup,'menu_button'));
      toolbar.append(actions);
    }
    // When TT only changed toggle state, preserve the exact existing
    // headers, DOM nodes, scroll position and iOS touch state.
    const effective=pending||rec;
    const signature=folderSignature(rows,effective);
    const sameStructure=lastRenderedList===list&&
      lastRenderedRows.length===rows.length&&
      rows.every((row,i)=>row===lastRenderedRows[i]);
    if(!sameStructure||signature!==lastSignature){
      showRows(rows,rec);
      lastRenderedList=list;lastRenderedRows=rows.slice();lastSignature=signature;
    }else{
      updateGroupCounts(rows,effective);
    }
    decoratePromptTrashRows(rows);
    if(viewportGuard?.type==='prompt'&&viewportGuard.list===list){
      const newAnchor=anchorForGuard(viewportGuard);
      if(newAnchor&&newAnchor!==viewportGuard.originalNode)settleViewportGuard();
    }
    const total=rows.length;
    const message=selecting
      ?(first?'已选起点，请选择最后一条；中间条目自动纳入。':'请选择分组的第一条和最后一条。')
      :'共 '+total+' 条 · 文件夹直接在下方展开或收起';
    if(toolbarChanged){
      toolbar.append(el('div',PREFIX+'-hint',message));
      lastToolbarSignature=toolbarSignature;
    }
    }finally{building=false;}
  }
  function schedule(){
    // Batch native TT changes in one microtask, before browser paint.
    // Avoid the old 35ms pause which could briefly reveal ungrouped rows.
    if(microtaskPending)return;
    microtaskPending=true;
    queueMicrotask(()=>{
      microtaskPending=false;
      if(enabled()&&!sorting)render();
    });
  }
  function prepare(){
    // React after native TT row replacement. Never hide the entire prompt list:
    // an interrupted native render must leave the original UI usable.
    schedule();
  }
  function disable(){
    if(timer)clearTimeout(timer);timer=0;
    microtaskPending=false;sorting=false;
    releaseViewportGuard();
    if(guardedList)guardedList.removeEventListener('click',captureNativeToggle,true);
    guardedList=null;
    if(trashBound){
      trashBound.removeEventListener('click',capturePromptTrash,true);
      trashBound.removeEventListener('keydown',capturePromptTrashKey,true);
      trashBound=null;
    }
    restorePromptTrashRows(records());
    clearInline(records());
    if(dragBound){(globalThis.jQuery||globalThis.$)?.(dragBound).off('.dw2rlPromptTransfer');dragBound=null;}
    renderObserver?.disconnect();renderObserver=null;observedList=null;
    dialog?.remove();dialog=null;
    doc().getElementById('completion_prompt_manager_list')?.classList.remove('dw2rl-prompt-list-filtering');
    toolbar?.remove();toolbar=null;host=null;active='all';currentPreset='';folderCollapsed.clear();selecting=false;first='';pending=null;
    lastSignature='';lastRenderedRows=[];lastRenderedList=null;lastToolbarSignature='';
  }
  return {sync:schedule,prepare,disable,getSelectedPresetName:presetName,ensureSelectedPresetGroups};
}
