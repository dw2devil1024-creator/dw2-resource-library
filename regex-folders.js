/* DW2 regex folders: metadata-only grouping; same-group drag delegates execution ordering to TT. */
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
const DEFAULT_FOLDER='__dw2_default__';
const LOOSE_FOLDER='__dw2_loose__';
const folderFor=(state,scriptId,valid)=> {
 const stored=state.entries[scriptId];
 return stored===LOOSE_FOLDER?LOOSE_FOLDER
   :valid.has(stored)?stored:DEFAULT_FOLDER;
};
export function createRegexFolders({enabled,getState,save,context,nativeRegex}){
 const collapsed=new Map();const isCollapsed=key=>collapsed.get(key)??true;let timer=0,dialog=null;const mounted=new Set();let folderMenu=null;const snapshots=new WeakMap();const observers=new Map();const outlineFrames=new Map();const dragBindings=new Map(),nativeSortMemory=new Map(),nativeSaveQueues=new Map();let listening=false;let refreshToken=0;
 let pendingEdit=null,editGuard=null;
 const mobileNativeToggle=typeof navigator!=='undefined'&&(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent||'')||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1));
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
   const row=element.closest?.('.regex-script-label');
   if(row?.parentElement===root){
    const rect=row.getBoundingClientRect();
    return {gid:row.dataset.dw2rlFolderId||LOOSE_FOLDER,row,before:event.clientY<rect.top+rect.height/2};
   }
   const header=element.closest?.('.dw2rl-regex-header');
   if(header?.parentElement===root)return {gid:header.dataset.groupId||DEFAULT_FOLDER,row:null};
   return {gid:LOOSE_FOLDER,row:null};
  };
  const clear=()=>{
   if(!gesture)return;
   gesture.row.style.removeProperty('opacity');
   gesture.highlight?.classList.remove('dw2rl-regex-drop-target');
   gesture=null;
   document.removeEventListener('pointermove',move,true);
   document.removeEventListener('pointerup',up,true);
   document.removeEventListener('pointercancel',cancel,true);
  };
  const move=event=>{
   if(!gesture||event.pointerId!==gesture.pointerId)return;
   if(!gesture.moving&&Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)<9)return;
   gesture.moving=true;
   if(event.cancelable)event.preventDefault();
   gesture.row.style.opacity='0.6';
   gesture.highlight?.classList.remove('dw2rl-regex-drop-target');
   const hit=locate(event);
   gesture.highlight=hit?.row||[...root.querySelectorAll(':scope > .dw2rl-regex-header')]
    .find(el=>el.dataset.groupId===hit?.gid)||null;
   if(gesture.highlight&&gesture.highlight!==gesture.row)
    gesture.highlight.classList.add('dw2rl-regex-drop-target');
  };
  const commitNativeSort=(row,target,before)=>{
   const $=globalThis.jQuery||globalThis.$;
   if(typeof $!=='function')return false;
   let originalStop;
   try{originalStop=$(root).sortable('option','stop');}catch{return false;}
   if(typeof originalStop!=='function')return false;
   if(before)root.insertBefore(row,target);
   else root.insertBefore(row,target.nextSibling);
   // Use TT's own sortable stop callback. It persists the actual regex order
   // and rebuilds native rows so editor/toggle handlers capture fresh indices.
   try{
    Promise.resolve(originalStop.call(root)).catch(error=>
     console.warn('[DW2 Regex] Native reorder failed',error)).finally(()=>schedule());
   }catch(error){console.warn('[DW2 Regex] Native reorder failed',error);schedule();}
   schedule();
   return true;
  };
  const up=event=>{
   if(!gesture||event.pointerId!==gesture.pointerId)return;
   const {row,moving}=gesture,hit=moving?locate(event):null;
   clear();
   if(!hit)return;
   const key=scopeKey(scope);
   if(!key)return;
   const state=record(key),valid=new Set(state.groups.map(g=>g.id));
   const target=hit.gid===DEFAULT_FOLDER?DEFAULT_FOLDER
    :hit.gid===LOOSE_FOLDER?LOOSE_FOLDER
    :valid.has(hit.gid)?hit.gid:LOOSE_FOLDER;
   const source=folderFor(state,row.id,valid);
   if(source===target){
    if(hit.row&&hit.row!==row)commitNativeSort(row,hit.row,hit.before);
    return;
   }
   if(target===DEFAULT_FOLDER)delete state.entries[row.id];
   else state.entries[row.id]=target;
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
   const gid=folderFor(state,row.id,ids);
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
  root.querySelectorAll(':scope > .dw2rl-regex-header, :scope > .dw2rl-regex-outline, :scope > .dw2rl-regex-free-drop').forEach(x=>x.remove());
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

 function createFolderHeader(root,key,gid){
  const header=node('div','dw2rl-regex-header'),folderKey=key+':'+gid;
  header.dataset.groupId=gid;header.dataset.folderKey=folderKey;
  const label=btn('',()=>{
   const collapsedNow=!isCollapsed(folderKey);
   collapsed.set(folderKey,collapsedNow);
   for(const row of nativeRows(root)){
    if(row.dataset.dw2rlFolderId===gid)row.classList.toggle('dw2rl-regex-collapsed',collapsedNow);
   }
   header.dataset.collapsed=String(collapsedNow);
   label.textContent=(collapsedNow?'▸ ':'▾ ')+
    (gid===DEFAULT_FOLDER?'默认分组':record(key).groups.find(g=>g.id===gid)?.name||'');
   updateOutlines(root);
  },'dw2rl-regex-folder-name');
  header.append(label,node('small','dw2rl-regex-count',''));
  if(gid!==DEFAULT_FOLDER){
   header.append(btn('✎',()=>{
    const current=record(key).groups.find(g=>g.id===gid)?.name;
    if(current===undefined)return;
    showDialog('重命名文件夹',current,name=>{
     const r=record(key);
     if(r.groups.some(g=>g.id!==gid&&g.name===name))return false;
     const g=r.groups.find(x=>x.id===gid);if(!g)return false;
     g.name=name;save();
    });
   }));
   header.append(btn('×',()=>{
    const current=record(key).groups.find(g=>g.id===gid)?.name;
    if(current===undefined)return;
    showDialog('删除「'+current+'」文件夹？正则不会被删除。','',()=>{
     const r=record(key);
     r.groups=r.groups.filter(g=>g.id!==gid);
     for(const [id,g] of Object.entries(r.entries))if(g===gid)delete r.entries[id];
     save();return true;
    },{confirmOnly:true,confirmText:'删除文件夹'});
   }));
  }
  return header;
 }
 function draw(scope,root){
  const key=scopeKey(scope);
  if(!key){clear(root);snapshots.delete(root);return;}
  const r=record(key),rows=nativeRows(root),logical=true;
  if(!rows.length&&!logical){
   clear(root);snapshots.delete(root);
   root.previousElementSibling?.classList?.contains('dw2rl-regex-toolbar')
    &&root.previousElementSibling.remove();
   return;
  }
  const previous=snapshots.get(root);
  if(previous&&previous.key!==key)clear(root);
  const valid=new Map(r.groups.map(g=>[g.id,g.name]));
  const validGroups=valid; // Stable existing iOS folder picker compatibility.
  const signature=JSON.stringify([key,r.groups.map(g=>[g.id,g.name]),
   rows.map(row=>[row.id,folderFor(r,row.id,valid)])]);
  const same=previous?.key===key&&previous?.signature===signature&&
   previous.logical===logical&&previous.rows.length===rows.length&&
   rows.every((row,i)=>row===previous.rows[i])&&
   previous.runs.every(run=>run.header.parentElement===root&&run.outline.parentElement===root);
  if(same){
   refreshCounts(root,rows,r);
   if(logical)freezeNativeSort(root);
   return;
  }
  let toolbar=root.previousElementSibling;
  if(!toolbar?.classList?.contains('dw2rl-regex-toolbar')){
   toolbar=node('div','dw2rl-regex-toolbar');root.before(toolbar);
  }
  if(toolbar.dataset.dw2rlScopeKey!==key){
   toolbar.dataset.dw2rlScopeKey=key;toolbar.replaceChildren();
   toolbar.append(btn('＋ 新建文件夹',()=>showDialog('新建正则文件夹','',name=>{
    const latestKey=scopeKey(scope);if(!latestKey)return false;
    const current=record(latestKey);
    if(current.groups.some(g=>g.name===name))return false;
    current.groups.push({id:'rg'+Date.now().toString(36)+Math.random().toString(36).slice(2),name});
    save();
   }),'menu_button'),node('small','','仅整理界面 · 不改变正则执行与启用状态'));
  }
  if(logical){
   root.classList.add('dw2rl-regex-logical');
   root.style.setProperty('display','flex','important');
   root.style.setProperty('flex-direction','column','important');
   bindGroupDrag(scope,root);
  }else{
   clear(root);
  }
  const oldHeaders=new Map(),oldOutlines=new Map();
  for(const h of root.querySelectorAll(':scope > .dw2rl-regex-header')){
   if(h.dataset.folderKey?.startsWith(key+':')&&!oldHeaders.has(h.dataset.groupId))
    oldHeaders.set(h.dataset.groupId,h);
  }
  for(const outline of root.querySelectorAll(':scope > .dw2rl-regex-outline')){
   if(outline.dataset.folderKey?.startsWith(key+':')&&!oldOutlines.has(outline.dataset.groupId))
    oldOutlines.set(outline.dataset.groupId,outline);
  }
  const folders=[{id:DEFAULT_FOLDER,name:'默认分组'},...r.groups];
  const members=new Map(folders.map(g=>[g.id,[]]));
  const looseRows=[];
  for(const row of rows){
   const gid=folderFor(r,row.id,valid);
   if(gid===LOOSE_FOLDER)looseRows.push(row);
   else members.get(gid)?.push(row);
  }
  let ordinal=0;
  const keepHeaders=new Set(),keepOutlines=new Set(),runs=[];
  for(const group of folders){
   const gid=group.id,folderKey=key+':'+gid;
   const header=oldHeaders.get(gid)||createFolderHeader(root,key,gid);
   header.dataset.groupId=gid;
   header.dataset.folderKey=folderKey;
   header.dataset.collapsed=String(isCollapsed(folderKey));
   const label=header.querySelector('.dw2rl-regex-folder-name');
   if(label)label.textContent=(isCollapsed(folderKey)?'▸ ':'▾ ')+group.name;
   if(header.parentElement!==root)root.append(header);
   header.style.order=String(ordinal++);
   keepHeaders.add(header);
   const groupRows=members.get(gid)||[];
   for(let i=0;i<groupRows.length;i++){
    const row=groupRows[i];
    row.style.order=String(ordinal++);
    row.dataset.dw2rlFolderId=gid;
    row.classList.toggle('dw2rl-regex-collapsed',isCollapsed(folderKey));
    row.classList.add('dw2rl-regex-group-row');
    row.classList.toggle('dw2rl-regex-group-end',i===groupRows.length-1);
   }
   const outline=oldOutlines.get(gid)||node('div','dw2rl-regex-outline');
   outline.dataset.folderKey=folderKey;
   outline.dataset.groupId=gid;
   if(outline.parentElement!==root)root.append(outline);
   outline._dw2rlHeader=header;
   outline._dw2rlLast=groupRows[groupRows.length-1]||header;
   keepOutlines.add(outline);
   runs.push({header,outline,first:groupRows[0]||header,last:groupRows.at(-1)||header,gid});
  }
  for(const h of root.querySelectorAll(':scope > .dw2rl-regex-header'))
   if(!keepHeaders.has(h))h.remove();
  for(const outline of root.querySelectorAll(':scope > .dw2rl-regex-outline'))
   if(!keepOutlines.has(outline))outline.remove();
  // A small unframed drop line, not a fourth folder.
  let freeDrop=root.querySelector(':scope > .dw2rl-regex-free-drop');
  if(!freeDrop){freeDrop=node('div','dw2rl-regex-free-drop',
    '↓ 拖到这里可独立散放 · 不加入任何文件夹');root.append(freeDrop);}
  freeDrop.style.order=String(ordinal++);
  for(const row of looseRows){
   row.style.order=String(ordinal++);
   row.dataset.dw2rlFolderId=LOOSE_FOLDER;
   row.classList.remove('dw2rl-regex-collapsed','dw2rl-regex-group-row','dw2rl-regex-group-end');
  }
  for(const row of rows){
   const gid=folderFor(r,row.id,valid);
   if(!logical){
    row.style.removeProperty('order');
    delete row.dataset.dw2rlFolderId;
    row.classList.remove('dw2rl-regex-collapsed','dw2rl-regex-group-row','dw2rl-regex-group-end');
   }
    let picker=row.querySelector(':scope > .dw2rl-regex-picker');
    if(!picker){
      picker=btn('未分组 ▾',()=>{
        folderMenu?.remove();folderMenu=null;
        const scopeIdentity=picker.dataset.scopeKey;
        const current=record(scopeIdentity);
        const menu=node('div','dw2rl-regex-picker-menu');
        menu.setAttribute('role','menu');
        const choices=[{id:DEFAULT_FOLDER,name:'默认分组'},...current.groups,
          {id:LOOSE_FOLDER,name:'独立散放（不进分组）'}];
        for(const choice of choices){
          const selected=folderFor(current,row.id,
            new Set(current.groups.map(g=>g.id)))===choice.id;
          const item=btn((selected?'✓  ':'   ')+choice.name,()=>{
            if(choice.id===DEFAULT_FOLDER)delete current.entries[row.id];
            else current.entries[row.id]=choice.id;
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
    const nextCaption=(gid===DEFAULT_FOLDER?'默认分组'
      :gid===LOOSE_FOLDER?'独立散放':validGroups.get(gid)||'默认分组')+'  ▾';
    if(picker.textContent!==nextCaption)picker.textContent=nextCaption;

  }
  snapshots.set(root,{signature,key,logical,rows:[...rows],runs});
  refreshCounts(root,rows,r);
  if(logical){ensureObserver(root);updateOutlines(root);}
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
 // TT's stock regex toggle reloads the whole list. On mobile, persist the
 // existing native script directly and leave the mounted row untouched.
 function applyRegexToggle(event,input,disabled){
  if(!mobileNativeToggle||!enabled()||!nativeRegex||!input?.isConnected)return false;
  const row=input.closest('.regex-script-label'),root=row?.parentElement;
  if(!row||!mounted.has(root))return false;
  const scope=CONTAINERS.find(([name,selector])=>document.querySelector(selector)===root)?.[0];
  const type=scope&&nativeRegex.SCRIPT_TYPES?.[scope.toUpperCase()];
  if(type===undefined||typeof nativeRegex.getScriptsByType!=='function'||
     typeof nativeRegex.saveScriptsByType!=='function')return false;
  let scripts,script;
  try{
   scripts=nativeRegex.getScriptsByType(type);
   script=scripts?.find(item=>String(item?.id)===row.id);
  }catch{return false;}
  if(!script)return false;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  if(Boolean(script.disabled)===disabled&&input.checked===disabled)return true;
  script.disabled=disabled;
  input.checked=disabled;
  const key=scopeKey(scope);
  if(key)refreshCounts(root,nativeRows(root),record(key));
  const previous=nativeSaveQueues.get(root)||Promise.resolve();
  const next=previous.catch(()=>{}).then(async()=>{
   await nativeRegex.saveScriptsByType(scripts,type);
   context?.()?.saveSettingsDebounced?.();
   nativeRegex.requestChatRefresh?.();
  }).catch(error=>console.warn('[DW2 Regex] In-place toggle save failed',error));
  nativeSaveQueues.set(root,next);
  return true;
 }
 function captureRegexToggleClick(event){
  if(!mobileNativeToggle||!enabled())return;
  const target=event.target?.closest?.('.regex-toggle-on,.regex-toggle-off');
  if(!target)return;
  const row=target.closest('.regex-script-label');
  const input=row?.querySelector('input.disable_regex');
  if(!input)return;
  applyRegexToggle(event,input,target.classList.contains('regex-toggle-on'));
 }
 function captureRegexToggleInput(event){
  if(!mobileNativeToggle||!enabled()||!event.target?.matches?.('input.disable_regex'))return;
  applyRegexToggle(event,event.target,Boolean(event.target.checked));
 }

 // TT saves edited scripts by emptying and recreating every regex list.
 // Protect scroll position and list heights during that native reload.
 function editingScrollers(target){
  const out=[],seen=new Set();
  const add=el=>{if(el&&!seen.has(el)){seen.add(el);out.push(el);}};
  for(let el=target?.parentElement;el;el=el.parentElement){
   const style=window.getComputedStyle?.(el);
   if(el.classList?.contains('scrollableInner')||
      (/(auto|scroll|overlay)/.test(style?.overflowY||'')&&el.scrollHeight>el.clientHeight+2))add(el);
  }
  add(document.scrollingElement);
  return out;
 }
 function correctRegexEditScroll(guard){
  if(!guard)return;
  const anchor=guard.anchorId?document.getElementById(guard.anchorId):null;
  for(const entry of guard.scrolls){
   const node=entry.node;
   if(!node?.isConnected)continue;
   if(anchor?.isConnected&&node.contains(anchor)&&entry.relative!==null){
    const viewportTop=node===document.scrollingElement?0:node.getBoundingClientRect().top;
    const delta=anchor.getBoundingClientRect().top-viewportTop-entry.relative;
    if(Number.isFinite(delta)&&Math.abs(delta)>1.5)node.scrollTop+=delta;
   }else if(Math.abs(node.scrollTop-entry.top)>1)node.scrollTop=entry.top;
  }
 }
 function endRegexEditGuard(){
  const guard=editGuard;
  editGuard=null;
  if(!guard)return;
  if(guard.frame)cancelAnimationFrame(guard.frame);
  for(const held of guard.heights){
   if(!held.root.isConnected)continue;
   if(held.value)held.root.style.setProperty('min-height',held.value,held.priority);
   else held.root.style.removeProperty('min-height');
  }
  for(const entry of guard.scrolls){
   const node=entry.node;
   if(!node?.isConnected)continue;
   if(entry.scrollBehavior)node.style.setProperty('scroll-behavior',entry.scrollBehavior,entry.scrollBehaviorPriority);
   else node.style.removeProperty('scroll-behavior');
   if(entry.overflowAnchor)node.style.setProperty('overflow-anchor',entry.overflowAnchor,entry.overflowAnchorPriority);
   else node.style.removeProperty('overflow-anchor');
  }
  correctRegexEditScroll(guard);
  requestAnimationFrame(()=>correctRegexEditScroll(guard));
 }
 function beginRegexEditGuard(){
  endRegexEditGuard();
  const settings=document.querySelector('#regex_container');
  if(!settings)return;
  const roots=CONTAINERS.map(([scope,selector])=>({scope,root:document.querySelector(selector)}))
   .filter(item=>item.root?.isConnected);
  if(!roots.length)return;
  const anchorId=pendingEdit?.rowId||'';
  const currentAnchor=anchorId?document.getElementById(anchorId):null;
  const scrolls=editingScrollers(currentAnchor||settings).map(node=>{
   const style=node.style;
   const viewportTop=node===document.scrollingElement?0:node.getBoundingClientRect().top;
   return {node,top:node.scrollTop,
    relative:currentAnchor?.isConnected&&node.contains(currentAnchor)?
     currentAnchor.getBoundingClientRect().top-viewportTop:null,
    scrollBehavior:style.getPropertyValue('scroll-behavior'),
    scrollBehaviorPriority:style.getPropertyPriority('scroll-behavior'),
    overflowAnchor:style.getPropertyValue('overflow-anchor'),
    overflowAnchorPriority:style.getPropertyPriority('overflow-anchor')};
  });
  const heights=roots.map(({scope,root})=>{
   const value=root.style.getPropertyValue('min-height');
   const priority=root.style.getPropertyPriority('min-height');
   const measured=Math.ceil(root.getBoundingClientRect().height);
   if(measured>0)root.style.setProperty('min-height',measured+'px','important');
   return {scope,root,value,priority,count:nativeRows(root).length};
  });
  for(const entry of scrolls){
   entry.node.style.setProperty('scroll-behavior','auto','important');
   entry.node.style.setProperty('overflow-anchor','none','important');
  }
  const guard={anchorId,originalAnchor:currentAnchor,scrolls,heights,
   targetScope:pendingEdit?.scope||'',started:performance.now(),frame:0};
  editGuard=guard;
  const tick=()=>{
   if(editGuard!==guard)return;
   correctRegexEditScroll(guard);
   const elapsed=performance.now()-guard.started;
   const current=guard.anchorId?document.getElementById(guard.anchorId):null;
   const replaced=guard.anchorId?
    Boolean(current?.isConnected&&current!==guard.originalAnchor):
    guard.heights.some(held=>held.scope===guard.targetScope&&
     nativeRows(held.root).length>held.count);
   const countsReady=guard.heights.every(held=>
    !held.root.isConnected||nativeRows(held.root).length>=held.count);
   if((replaced&&countsReady&&elapsed>260)||elapsed>2600){
    endRegexEditGuard();return;
   }
   guard.frame=requestAnimationFrame(tick);
  };
  guard.frame=requestAnimationFrame(tick);
 }
 function captureRegexEditorOpen(event){
  const edit=event.target?.closest?.('.edit_existing_regex');
  if(edit){
   const row=edit.closest('.regex-script-label');
   const root=row?.parentElement;
   const scope=CONTAINERS.find(([,sel])=>document.querySelector(sel)===root)?.[0]||'';
   pendingEdit=row?.id?{rowId:row.id,scope}:null;
   return;
  }
  const trigger=event.target?.closest?.('#open_regex_editor,#open_preset_editor,#open_scoped_editor');
  if(trigger){
   const scope=trigger.id==='open_regex_editor'?'global':
    trigger.id==='open_preset_editor'?'preset':'scoped';
   pendingEdit={rowId:'',scope};
  }
 }
 function captureRegexEditorSave(event){
  if(!event.target?.closest?.('.popup-button-ok'))return;
  if(!document.querySelector('.regex_editor'))return;
  beginRegexEditGuard();pendingEdit=null;
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
  if(!listening){document.addEventListener('change',onRegexChange);document.addEventListener('click',captureRegexEditorOpen,true);document.addEventListener('click',captureRegexEditorSave,true);if(mobileNativeToggle){document.addEventListener('click',captureRegexToggleClick,true);document.addEventListener('input',captureRegexToggleInput,true);}listening=true;}
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
  if(listening){document.removeEventListener('change',onRegexChange);document.removeEventListener('click',captureRegexEditorOpen,true);document.removeEventListener('click',captureRegexEditorSave,true);if(mobileNativeToggle){document.removeEventListener('click',captureRegexToggleClick,true);document.removeEventListener('input',captureRegexToggleInput,true);}listening=false;}
   endRegexEditGuard();pendingEdit=null;
  for(const resize of observers.values())resize.disconnect();
  observers.clear();
  for(const frame of outlineFrames.values())cancelAnimationFrame(frame);
  outlineFrames.clear();
  dialog?.remove();dialog=null;folderMenu?.remove();folderMenu=null;
  for(const root of mounted){
   unbindGroupDrag(root);
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
   return {key,
     groups:[{id:DEFAULT_FOLDER,name:'默认分组'},
       ...(Array.isArray(current?.groups)?current.groups.map(g=>({id:g.id,name:g.name})):[])],
     entries:{...(current?.entries||{})},
     defaultGroupId:DEFAULT_FOLDER,looseGroupId:LOOSE_FOLDER};
 }
 return {sync,prepare:schedule,disable,getGroupSnapshot};
}
