/* DW2 regex folders: presentation metadata only, no regex mutation. */
// The TT character's avatar identifies the same card across chat saves.
// A list index can change when cards are imported, removed, or re-ordered.
export function stableScopedRegexFolderKey(ctx){
 const id=ctx?.characterId ?? ctx?.this_chid;
 const avatar=String(ctx?.characters?.[id]?.avatar ?? ctx?.characters?.[id]?.data?.avatar ?? '').trim();
 if(!avatar)return id!==undefined&&id!==null&&String(id)!==''?'scoped:'+String(id):'';
 let h1=0x811c9dc5,h2=0x9e3779b9;
 for(let i=0;i<avatar.length;i++){
   const c=avatar.charCodeAt(i);
   h1=Math.imul(h1^c,0x01000193);
   h2=Math.imul(h2^c,0x85ebca6b);
 }
 return 'scoped:char_'+(h1>>>0).toString(16).padStart(8,'0')+(h2>>>0).toString(16).padStart(8,'0');
}
// Only import a legacy numeric scope with unambiguous matching regex IDs.
// The old record stays untouched and serves as a rollback backup.
export function findLegacyScopedRegexFolder(folders,visibleIds){
 const ids=new Set(visibleIds||[]);
 if(!folders||!ids.size)return null;
 const candidates=Object.entries(folders)
  .filter(([key,r])=>/^scoped:\d+$/.test(key)&&Array.isArray(r?.groups))
  .map(([key,r])=>({key,record:r,score:Object.keys(r.entries||{}).filter(id=>ids.has(id)).length}))
  .filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
 return candidates.length===1||candidates[0]?.score>candidates[1]?.score?candidates[0]||null:null;
}

const CONTAINERS=[['global','#saved_regex_scripts'],['preset','#saved_preset_scripts'],['scoped','#saved_scoped_scripts']];
const trim=x=>String(x??'').trim();
export function createRegexFolders({enabled,getState,save,context}){
 const collapsed=new Map();const isCollapsed=key=>collapsed.get(key)??true;let timer=0,dialog=null;const mounted=new Set();let folderMenu=null;const snapshots=new WeakMap();const observers=new Map();const outlineFrames=new Map();const dragBindings=new Map(),nativeSortMemory=new Map();let listening=false;let refreshToken=0;
 function node(tag,cls='',txt=''){const x=document.createElement(tag);x.className=cls;x.textContent=txt;return x;}
 function btn(label,fn,cls=''){const x=node('button',cls,label);x.type='button';x.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();fn();});return x;}
 function scopeKey(scope){
   if(scope==='global')return 'global';
   const ctx=context?.()||{};
   if(scope==='preset'){
     const preset=String(ctx.getPresetManager?.('openai')?.getSelectedPresetName?.()||document.querySelector('#openai_api-presets select')?.selectedOptions?.[0]?.textContent||'').trim();
     return preset?'preset:'+preset.slice(0,150):'';
   }
   return stableScopedRegexFolderKey(ctx);
 }
 function record(scope){
   const state=getState();state.regexFolders??={};
   if(!state.regexFolders[scope] && scope.startsWith('scoped:char_')){
     const root=document.querySelector('#saved_scoped_scripts');
     const rows=root?nativeRows(root):[];
     const ctx=context?.()||{},id=ctx.characterId ?? ctx.this_chid;
     const cardScripts=ctx.characters?.[id]?.data?.extensions?.regex_scripts||[];
     const visibleIds=rows.map(row=>row.id);
     for(const script of Array.isArray(cardScripts)?cardScripts:[]){
       if(script?.id)visibleIds.push(String(script.id));
     }
     const legacy=findLegacyScopedRegexFolder(state.regexFolders,visibleIds);
     if(legacy){
       state.regexFolders[scope]={
         groups:legacy.record.groups.map(group=>({...group})),
         entries:{...(legacy.record.entries||{})},
       };
       save();
     }
   }
   state.regexFolders[scope]??={groups:[],entries:{}};
   return state.regexFolders[scope];
 }

 function freezeNativeSort(root){
  const $=globalThis.jQuery||globalThis.$;
  if(typeof $!=='function'||typeof $.fn?.sortable!=='function')return;
  try{
   const list=$(root);
   if(!list.data('ui-sortable')&&!list.data('sortable'))return;
   if(!nativeSortMemory.has(root))nativeSortMemory.set(root,list.sortable('option','disabled')===true);
   if(nativeSortMemory.get(root)===false)list.sortable('disable');
  }catch(e){console.debug('[DW2 Regex] sortable disable',e);}
 }
 function restoreNativeSort(root){
  const old=nativeSortMemory.get(root);
  nativeSortMemory.delete(root);
  if(old!==false)return;
  const $=globalThis.jQuery||globalThis.$;
  try{
   const list=$?.(root);
   if(list?.data('ui-sortable')||list?.data('sortable'))list.sortable('enable');
  }catch(e){console.debug('[DW2 Regex] sortable restore',e);}
 }
 function unbindGroupDrag(root){
  const release=dragBindings.get(root);
  if(release){release();dragBindings.delete(root);}
  restoreNativeSort(root);
 }
 function bindGroupDrag(scope,root){
  freezeNativeSort(root);
  if(dragBindings.has(root))return;
  let gesture=null;
  const locate=event=>{
   const element=document.elementFromPoint?.(event.clientX,event.clientY);
   if(!element||!root.contains(element))return null;
   const item=element.closest?.('.dw2rl-regex-header,.regex-script-label');
   if(!item||!root.contains(item))return '__ungrouped';
   return item.classList.contains('dw2rl-regex-header')
    ?item.dataset.groupId||'__ungrouped'
    :item.dataset.dw2rlFolderId||'__ungrouped';
  };
  const clear=()=>{
   if(!gesture)return;
   gesture.row.style.removeProperty('opacity');
   gesture.highlight?.style.removeProperty('box-shadow');
   gesture=null;
   document.removeEventListener('pointermove',move,true);
   document.removeEventListener('pointerup',up,true);
   document.removeEventListener('pointercancel',cancel,true);
  };
  const move=event=>{
   if(!gesture||event.pointerId!==gesture.pointerId)return;
   if(!gesture.moving && Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)<9)return;
   gesture.moving=true;
   if(event.cancelable)event.preventDefault();
   gesture.row.style.opacity='0.6';
   gesture.highlight?.style.removeProperty('box-shadow');
   const groupId=locate(event);
   gesture.highlight=[...root.querySelectorAll(':scope > .dw2rl-regex-header')]
     .find(el=>el.dataset.groupId===groupId)||null;
   if(gesture.highlight)gesture.highlight.style.boxShadow='inset 0 0 0 1px currentColor';
  };
  const up=event=>{
   if(!gesture||event.pointerId!==gesture.pointerId)return;
   const {row,moving}=gesture,target=moving?locate(event):null;
   clear();
   if(target===null)return;
   const key=scopeKey(scope);
   if(!key)return;
   const state=record(key),id=target==='__ungrouped'?''
     :state.groups.some(g=>g.id===target)?target:'';
   if((state.entries[row.id]||'')===id)return;
   if(id)state.entries[row.id]=id;
   else delete state.entries[row.id];
   save();schedule();
  };
  const cancel=()=>clear();
  const down=event=>{
   if(event.button!==undefined&&event.button!==0)return;
   const handle=event.target?.closest?.('.drag-handle');
   const row=handle?.closest?.('.regex-script-label');
   if(!row||row.parentElement!==root)return;
   clear();
   gesture={row,pointerId:event.pointerId,x:event.clientX,y:event.clientY,moving:false,highlight:null};
   if(event.cancelable)event.preventDefault();
   event.stopPropagation();
   document.addEventListener('pointermove',move,true);
   document.addEventListener('pointerup',up,true);
   document.addEventListener('pointercancel',cancel,true);
  };
  root.addEventListener('pointerdown',down,true);
  dragBindings.set(root,()=>{clear();root.removeEventListener('pointerdown',down,true);});
 }

 function nativeRows(root){return [...root.children].filter(x=>x.classList?.contains('regex-script-label')&&x.id);}

 function refreshCounts(root,rows,state){
  const ids=new Set((state.groups||[]).map(g=>g.id)),stat=new Map();
  for(const row of rows){
   const gid=ids.has(state.entries[row.id])?state.entries[row.id]:'__ungrouped';
   const bucket=stat.get(gid)||{on:0,total:0};bucket.total++;
   if(row.querySelector('input.disable_regex')?.checked===false)bucket.on++;
   stat.set(gid,bucket);
  }
  for(const header of root.querySelectorAll(':scope > .dw2rl-regex-header')){
   const count=header.querySelector('.dw2rl-regex-count'),x=stat.get(header.dataset.groupId)||{on:0,total:0};
   const label='('+x.on+'/'+x.total+')';
   if(count&&count.textContent!==label)count.textContent=label;
  }
 }
 function clear(root){
  unbindGroupDrag(root);
  root.querySelectorAll(':scope > .dw2rl-regex-header, :scope > .dw2rl-regex-outline').forEach(x=>x.remove());
  root.classList.remove('dw2rl-regex-logical');
  root.style.removeProperty('display');root.style.removeProperty('flex-direction');
  for(const row of nativeRows(root)){
   row.style.removeProperty('order');
   delete row.dataset.dw2rlFolderId;
   row.classList.remove('dw2rl-regex-collapsed','dw2rl-regex-group-row','dw2rl-regex-group-end');
  }
 }

 function showDialog(title,initial,onSave,{confirmOnly=false,confirmText='保存'}={}){
   dialog?.remove();const modal=node('div','dw2rl-regex-dialog-backdrop');
   const form=node('form','dw2rl-regex-dialog');
   const input=node('input','text_pole');input.type='text';input.maxLength=50;input.value=initial;input.placeholder='文件夹名称';
   const actions=node('div','dw2rl-regex-dialog-actions');
   actions.append(btn('取消',()=>{modal.remove();dialog=null;},'menu_button dw2rl-regex-dialog-cancel'));
   const ok=node('button','menu_button dw2rl-regex-dialog-submit',confirmText);ok.type='submit';actions.append(ok);
   form.append(node('div','',title));if(!confirmOnly)form.append(input);form.append(actions);modal.append(form);
   document.querySelector('#regex_container')?.append(modal);dialog=modal;
   for(const eventName of ['pointerdown','touchstart','mousedown','click'])modal.addEventListener(eventName,e=>e.stopPropagation());
   form.addEventListener('submit',e=>{e.preventDefault();e.stopPropagation();const name=trim(input.value);if(!confirmOnly&&!name)return;if(onSave(name)!==false){modal.remove();dialog=null;schedule();}});
   modal.addEventListener('click',e=>{if(e.target===modal){modal.remove();dialog=null;}});
   if(!confirmOnly)setTimeout(()=>input.focus(),30);
 }
 function draw(scope,root){
  const key=scopeKey(scope);
  if(!key){clear(root);snapshots.delete(root);return;}
  const rows=nativeRows(root);if(!rows.length){clear(root);snapshots.delete(root);root.previousElementSibling?.classList?.contains('dw2rl-regex-toolbar')&&root.previousElementSibling.remove();return;}
  bindSort(scope,root);
  const r=record(key),validGroups=new Map(r.groups.map(g=>[g.id,g.name]));
  const signature=key+'|'+r.groups.map(g=>g.id+':'+g.name).join('~')+'|'+rows.map(row=>row.id+':'+(r.entries[row.id]||'')).join('~');
  const old=snapshots.get(root);
  // Skip rebuilding only if TT still has our exact headers and native rows.
  if(old?.signature===signature && old.rows.length===rows.length &&
     rows.every((row,i)=>row===old.rows[i]) &&
     old.runs.every(run=>run.header.parentElement===root &&
       run.outline.parentElement===root && run.header.nextElementSibling===run.first)){
    refreshCounts(root,rows,r);
    return; // Do not force a geometry flush on each unchanged TT sync.
  }
  // Preserve existing headers/outlines whenever the native run is the same.
  // A preset switch must discard decorators from the old scope.
  if(old && old.key!==key)clear(root);
  const previous=old?.key===key?old.runs:[];
  const usedHeaders=new Set(),usedOutlines=new Set();
  for(const row of rows)row.classList.remove('dw2rl-regex-collapsed','dw2rl-regex-group-row','dw2rl-regex-group-end');
  let toolbar=root.previousElementSibling;
  if(!toolbar?.classList?.contains('dw2rl-regex-toolbar')){toolbar=node('div','dw2rl-regex-toolbar');root.before(toolbar);}
  if(toolbar.dataset.dw2rlScopeKey!==key){
  toolbar.replaceChildren();
  toolbar.dataset.dw2rlScopeKey=key;
  const newGroup=btn('＋ 新建文件夹',()=>showDialog('新建正则文件夹','',name=>{
    if(r.groups.some(g=>g.name===name))return false;
    r.groups.push({id:'rg'+Date.now().toString(36)+Math.random().toString(36).slice(2),name});save();
  }),'menu_button');
  toolbar.append(newGroup,node('small','','仅整理界面 · 不改变正则执行与启用状态'));
  }
  let last='';
  const runs=[],seenGroups=new Set();
  rows.forEach((row,index)=>{
    const gid=validGroups.has(r.entries[row.id])?r.entries[row.id]:'';
    if(gid!==last&&gid){
      const continuation=seenGroups.has(gid);
      const saved=previous.find(run=>run.first===row && run.gid===gid &&
        !!run.continuation===continuation &&
        run.header.parentElement===root && run.outline?.parentElement===root);
      const header=saved?.header||node('div','dw2rl-regex-header');
      const collapseKey=key+':'+gid;
      if(!saved){
        const toggle=btn('',()=>{
          const state=record(key);
          const next=!isCollapsed(collapseKey);
          collapsed.set(collapseKey,next);
          // TT may have replaced/reordered rows since this header was made.
          for(const item of nativeRows(root)){
            if(state.entries[item.id]===gid)item.classList.toggle('dw2rl-regex-collapsed',next);
          }
          root.querySelectorAll(':scope > .dw2rl-regex-header').forEach(h=>{
            if(h.dataset.folderKey!==collapseKey)return;
            h.dataset.collapsed=String(next);
            const t=h.querySelector('.dw2rl-regex-folder-name');
            if(t)t.textContent=(next?'▸ ':'▾ ')+(h.dataset.continuation==='true'?'↳ ':'')+(state.groups.find(g=>g.id===gid)?.name||'')+(h.dataset.continuation==='true'?' · 续':'');
          });
          updateOutlines(root);
        },'dw2rl-regex-folder-name');
        header.append(toggle);
        if(!continuation){
        header.append(node('small','dw2rl-regex-count',''));
        header.append(btn('✎',()=>{
          const state=record(key);
          const current=state.groups.find(g=>g.id===gid)?.name;
          if(current===undefined)return;
          showDialog('重命名文件夹',current,name=>{
            const latest=record(key);
            if(latest.groups.some(g=>g.id!==gid&&g.name===name))return false;
            const group=latest.groups.find(g=>g.id===gid);
            if(!group)return false;
            group.name=name;save();
          });
        }));
        header.append(btn('×',()=>{
          const current=record(key).groups.find(g=>g.id===gid)?.name;
          if(current===undefined)return;
          showDialog('删除「'+current+'」文件夹？正则不会被删除。','',()=>{
            const latest=record(key);
            latest.groups=latest.groups.filter(g=>g.id!==gid);
            for(const [id,value] of Object.entries(latest.entries))
              if(value===gid)delete latest.entries[id];
            save();return true;
          },{confirmOnly:true,confirmText:'删除文件夹'});
        }));
        }
      }
      header.dataset.collapsed=String(isCollapsed(collapseKey));
      header.dataset.folderKey=collapseKey;
      header.dataset.groupId=gid;
      header.dataset.continuation=String(continuation);
      const title=header.querySelector('.dw2rl-regex-folder-name');
      if(title)title.textContent=(isCollapsed(collapseKey)?'▸ ':'▾ ')+(continuation?'↳ ':'')+validGroups.get(gid)+(continuation?' · 续':'');
      const members=rows.filter(x=>r.entries[x.id]===gid);
      const active=members.filter(x=>x.querySelector('input.disable_regex')?.checked===false).length;
      const counter=header.querySelector('.dw2rl-regex-count');
      if(counter)counter.textContent='('+active+'/'+members.length+')';
      if(header.nextElementSibling!==row)root.insertBefore(header,row);
      runs.push({header,first:row,last:row,key:collapseKey,gid,continuation,saved});
      usedHeaders.add(header);
    }
    // Move-to-folder menu belongs to the row and uses a native <select>,
    // keeping TT's original script row, edit, enable and drag handlers.
    // Crucial on iOS: NEVER remove and recreate an open native select.
    // TT and the extension refresh settings on timers; replacing the focused
    // select in draw() dismisses the OS dropdown immediately.
    // Custom theme-native dropdown. No iOS native select popup.
    // Maintain one stable button per regex to avoid focus loss on refresh.
    let picker=row.querySelector(':scope > .dw2rl-regex-picker');
    if(!picker){
      picker=btn('未分组 ▾',()=>{
        folderMenu?.remove();folderMenu=null;
        const scopeIdentity=picker.dataset.scopeKey;
        const current=record(scopeIdentity);
        const menu=node('div','dw2rl-regex-picker-menu');
        menu.setAttribute('role','menu');
        const choices=[{id:'',name:'未分组'},...current.groups];
        for(const choice of choices){
          const selected=(current.entries[row.id]||'')===choice.id;
          const item=btn((selected?'✓  ':'   ')+choice.name,()=>{
            if(choice.id)current.entries[row.id]=choice.id;
            else delete current.entries[row.id];
            folderMenu?.remove();folderMenu=null;
            save();schedule();
          },'dw2rl-regex-picker-item');
          item.setAttribute('role','menuitemradio');
          item.setAttribute('aria-checked',String(selected));
          menu.append(item);
        }
        // Mount to regex settings so TT doesn't mistake it for outside tap.
        const settings=document.querySelector('#regex_container');
        if(!settings)return;
        settings.append(menu);folderMenu=menu;
        const rect=picker.getBoundingClientRect();
        const bounds=settings.getBoundingClientRect();
        const width=Math.min(Math.max(180,rect.width),Math.max(180,window.innerWidth-24));
        const left=Math.min(Math.max(8,rect.left),Math.max(8,window.innerWidth-width-8));
        const availableBelow=window.innerHeight-rect.bottom;
        const openAbove=availableBelow<180&&rect.top>availableBelow;
        menu.style.position='fixed';menu.style.width=width+'px';
        menu.style.left=left+'px';
        menu.style.top=(openAbove?'auto':Math.min(rect.bottom+5,window.innerHeight-80)+'px');
        if(openAbove)menu.style.bottom=(window.innerHeight-rect.top+5)+'px';
        const stop=e=>e.stopPropagation();
        for(const type of ['pointerdown','touchstart','mousedown','click'])menu.addEventListener(type,stop);
        const dismiss=e=>{
          if(!menu.isConnected){document.removeEventListener('pointerdown',dismiss,true);return;}
          if(menu.contains(e.target)||picker.contains(e.target))return;
          menu.remove();if(folderMenu===menu)folderMenu=null;
          document.removeEventListener('pointerdown',dismiss,true);
        };
        // Delay binding to avoid closing from the initial opening pointer.
        setTimeout(()=>document.addEventListener('pointerdown',dismiss,true),0);
      },'dw2rl-regex-picker menu_button');
      picker.setAttribute('aria-label','选择正则文件夹');
      picker.setAttribute('aria-haspopup','menu');
      row.append(picker);
    }
    picker.dataset.scopeKey=key;
    const nextCaption=(validGroups.get(gid)||'未分组')+'  ▾';
    if(picker.textContent!==nextCaption)picker.textContent=nextCaption;
    if(gid){row.classList.add('dw2rl-regex-group-row');const next=rows[index+1];if(!next||r.entries[next.id]!==gid)row.classList.add('dw2rl-regex-group-end');
      const run=runs[runs.length-1];if(run)run.last=row;
    }
    if(gid&&isCollapsed(key+':'+gid))row.classList.add('dw2rl-regex-collapsed');
    if(gid)seenGroups.add(gid);
    last=gid;
  });
  for(const run of runs){
   const outline=run.saved?.outline||node('div','dw2rl-regex-outline');
   outline.dataset.folderKey=run.key;
   if(outline.parentElement!==root)root.append(outline);
   outline._dw2rlHeader=run.header;
   outline._dw2rlLast=run.last;
   run.outline=outline;
   usedOutlines.add(outline);
  }
  // Only remove obsolete folder decorations. Preserve all native rows and
  // the existing iOS picker buttons, so group changes don't blank the list.
  for(const h of root.querySelectorAll(':scope > .dw2rl-regex-header')){
    if(!usedHeaders.has(h))h.remove();
  }
  for(const outline of root.querySelectorAll(':scope > .dw2rl-regex-outline')){
    if(!usedOutlines.has(outline))outline.remove();
  }
  snapshots.set(root,{signature,rows:[...rows],runs,key});
  ensureObserver(root);
  updateOutlines(root); // same DOM turn, never a frame later
 }
 function ensureObserver(root){
  if(observers.has(root))return;
  const resize=new ResizeObserver(()=>{
    if(!root.isConnected||outlineFrames.has(root))return;
    outlineFrames.set(root,requestAnimationFrame(()=>{
      outlineFrames.delete(root);
      if(root.isConnected)updateOutlines(root);
    }));
  });
  resize.observe(root);observers.set(root,resize);
 }
 function updateOutlines(root){
  const base=root.getBoundingClientRect();
  const outlines=root.querySelectorAll(':scope > .dw2rl-regex-outline');
  if(base.width<=0||base.height<=0){
   for(const outline of outlines)outline.style.visibility='hidden';
   return;
  }
  for(const outline of outlines){
   const header=outline._dw2rlHeader,last=outline._dw2rlLast;
   if(!header?.isConnected||!last?.isConnected){outline.remove();continue;}
   const first=header.getBoundingClientRect();
   const lastRect=header.dataset.collapsed==='true'?first:last.getBoundingClientRect();
   if(first.width<=0){outline.style.visibility='hidden';continue;}
   const coords={
    top:(first.top-base.top+root.scrollTop)+'px',
    left:(first.left-base.left+root.scrollLeft)+'px',
    width:first.width+'px',
    height:Math.max(0,lastRect.bottom-first.top)+'px'
   };
   for(const [k,v] of Object.entries(coords))if(outline.style[k]!==v)outline.style[k]=v;
   outline.style.visibility='visible';
  }
 }
 function onRegexChange(event){
  if(!enabled()||!event.target?.matches?.('input.disable_regex'))return;
  const root=event.target.closest('.regex-script-container');
  if(!root||!mounted.has(root))return;
  queueMicrotask(()=>{
   if(!enabled()||!root.isConnected)return;
   const old=snapshots.get(root);if(!old)return;
   const rows=nativeRows(root);
   if(rows.length!==old.rows.length||rows.some((row,i)=>row!==old.rows[i])){sync();return;}
   refreshCounts(root,rows,record(old.key));
  });
 }
 function sync(){
  if(!enabled())return disable();
  if(!listening){document.addEventListener('change',onRegexChange);listening=true;}
  const live=new Set();
  for(const [scope,selector] of CONTAINERS){
   const root=document.querySelector(selector);
   if(root){live.add(root);mounted.add(root);draw(scope,root);}
  }
  for(const root of mounted){
   if(live.has(root))continue;
   observers.get(root)?.disconnect();observers.delete(root);
   clear(root);
   if(outlineFrames.has(root))cancelAnimationFrame(outlineFrames.get(root));
   outlineFrames.delete(root);snapshots.delete(root);mounted.delete(root);
  }
 }
 function schedule(){
  const token=++refreshToken;
  queueMicrotask(()=>{if(token===refreshToken)sync();});
 }
 function disable(){
  refreshToken++;
  if(listening){document.removeEventListener('change',onRegexChange);listening=false;}
  for(const resize of observers.values())resize.disconnect();
  observers.clear();
  for(const frame of outlineFrames.values())cancelAnimationFrame(frame);
  outlineFrames.clear();
  dialog?.remove();dialog=null;folderMenu?.remove();folderMenu=null;
  for(const root of mounted){
   if(transfers.has(root)){
     (globalThis.jQuery||globalThis.$)?.(root).off('.dw2rlRegexTransfer');
     transfers.delete(root);sortStarts.delete(root);
   }
   clear(root);snapshots.delete(root);
   root.previousElementSibling?.classList?.contains('dw2rl-regex-toolbar')&&root.previousElementSibling.remove();
   for(const row of nativeRows(root))row.querySelector(':scope > .dw2rl-regex-picker')?.remove();
  }
  mounted.clear();
 }
 function getGroupSnapshot(scope){
   if(!enabled())return null;
   const key=scopeKey(scope);
   if(!key)return null;
   let current=getState().regexFolders?.[key];
   if(!current && scope==='scoped'){
     const ctx=context?.()||{},id=ctx.characterId ?? ctx.this_chid;
     const scripts=ctx.characters?.[id]?.data?.extensions?.regex_scripts;
     if(Array.isArray(scripts)&&scripts.length)current=record(key);
   }
   return {key,groups:Array.isArray(current?.groups)
     ? current.groups.map(g=>({id:g.id,name:g.name})):[],
     entries:{...(current?.entries||{})}};
 }
 return {sync,prepare:schedule,disable,getGroupSnapshot};
}
