/* DW2 regex folders: presentation metadata only, no regex mutation. */
const CONTAINERS=[['global','#saved_regex_scripts'],['preset','#saved_preset_scripts'],['scoped','#saved_scoped_scripts']];
const trim=x=>String(x??'').trim();
export function createRegexFolders({enabled,getState,save,context}){
 const collapsed=new Map();let timer=0,dialog=null;const mounted=new Set();let folderMenu=null;const snapshots=new WeakMap();const observers=new Map();let frame=0;
 function node(tag,cls='',txt=''){const x=document.createElement(tag);x.className=cls;x.textContent=txt;return x;}
 function btn(label,fn,cls=''){const x=node('button',cls,label);x.type='button';x.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();fn();});return x;}
 function scopeKey(scope){
   if(scope==='global')return 'global';
   const ctx=context?.()||{};
   if(scope==='preset'){
     const preset=String(ctx.getPresetManager?.('openai')?.getSelectedPresetName?.()||document.querySelector('#openai_api-presets select')?.selectedOptions?.[0]?.textContent||'').trim();
     return preset?'preset:'+preset.slice(0,150):'';
   }
   const charId=ctx.characterId ?? ctx.this_chid;
   return charId!==undefined && charId!==null && String(charId)!==''?'scoped:'+String(charId):'';
 }
 function record(scope){
   const state=getState();state.regexFolders??={};
   state.regexFolders[scope]??={groups:[],entries:{}};
   return state.regexFolders[scope];
 }
 function nativeRows(root){return [...root.children].filter(x=>x.classList?.contains('regex-script-label')&&x.id);}
 function clear(root){
   root.querySelectorAll(':scope > .dw2rl-regex-header, :scope > .dw2rl-regex-outline').forEach(x=>x.remove());
   for(const row of nativeRows(root))row.classList.remove('dw2rl-regex-collapsed','dw2rl-regex-group-row','dw2rl-regex-group-end');
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
  const r=record(key),validGroups=new Map(r.groups.map(g=>[g.id,g.name]));
  const signature=key+'|'+r.groups.map(g=>g.id+':'+g.name).join('~')+'|'+rows.map(row=>row.id+':'+(r.entries[row.id]||'')).join('~');
  const old=snapshots.get(root);
  // The normal 1.2s TT scan must not tear down headers or the frame.
  // Reuse them while original native rows and membership remain unchanged.
  if(old?.signature===signature && old.rows.length===rows.length && rows.every((row,i)=>row===old.rows[i])){
    const headers=[...root.querySelectorAll(':scope > .dw2rl-regex-header')];
    for(const h of headers){
      const groupId=h.dataset.groupId;
      const members=rows.filter(row=>r.entries[row.id]===groupId);
      const on=members.filter(row=>row.querySelector('input.disable_regex')?.checked===false).length;
      const count=h.querySelector('.dw2rl-regex-count');
      if(count)count.textContent='('+on+'/'+members.length+')';
    }
    requestOutline(root);return;
  }
  clear(root);
  let toolbar=root.previousElementSibling;
  if(!toolbar?.classList?.contains('dw2rl-regex-toolbar')){toolbar=node('div','dw2rl-regex-toolbar');root.before(toolbar);}
  toolbar.replaceChildren();
  const newGroup=btn('＋ 新建文件夹',()=>showDialog('新建正则文件夹','',name=>{
    if(r.groups.some(g=>g.name===name))return false;
    r.groups.push({id:'rg'+Date.now().toString(36)+Math.random().toString(36).slice(2),name});save();
  }),'menu_button');
  toolbar.append(newGroup,node('small','','仅整理界面 · 不改变正则执行与启用状态'));
  let last='';
  const runs=[];
  rows.forEach((row,index)=>{
    const gid=validGroups.has(r.entries[row.id])?r.entries[row.id]:'';
    if(gid!==last&&gid){
      const header=node('div','dw2rl-regex-header');
      runs.push({header,first:row,last:row,key:key+':'+gid});
      const collapseKey=key+':'+gid;
      const toggle=btn((collapsed.get(collapseKey)?'▸ ':'▾ ')+validGroups.get(gid),()=>{
        const next=!collapsed.get(collapseKey);
        collapsed.set(collapseKey,next);
        // Fast path: change ONLY this folder's rows, no full TT list rebuild.
        // All rows in noncontiguous runs of this group share the same state.
        const sameGroup=rows.filter(x=>r.entries[x.id]===gid);
        sameGroup.forEach(x=>x.classList.toggle('dw2rl-regex-collapsed',next));
        root.querySelectorAll(':scope > .dw2rl-regex-header').forEach(h=>{
          if(h.dataset.folderKey!==collapseKey)return;
          h.dataset.collapsed=String(next);
          const t=h.querySelector('.dw2rl-regex-folder-name');
          if(t)t.textContent=(next?'▸ ':'▾ ')+validGroups.get(gid);
        });
        updateOutlines(root);
      },'dw2rl-regex-folder-name');
      const members=rows.filter(x=>r.entries[x.id]===gid);
      const count=members.length;
      const active=members.filter(x=>x.querySelector('input.disable_regex')?.checked===false).length;
      header.dataset.collapsed=String(!!collapsed.get(collapseKey));
      header.dataset.folderKey=collapseKey;
      header.dataset.groupId=gid;
      header.append(toggle,node('small','dw2rl-regex-count','('+active+'/'+count+')'));
      header.append(btn('✎',()=>showDialog('重命名文件夹',validGroups.get(gid),name=>{
        if(r.groups.some(g=>g.id!==gid&&g.name===name))return false;
        r.groups.find(g=>g.id===gid).name=name;save();
      })));
      header.append(btn('×',()=>showDialog('删除「'+validGroups.get(gid)+'」文件夹？正则不会被删除。','',()=>{
        r.groups=r.groups.filter(g=>g.id!==gid);
        for(const [id,value] of Object.entries(r.entries))if(value===gid)delete r.entries[id];
        save();return true;
      },{confirmOnly:true,confirmText:'删除文件夹'})));
      root.insertBefore(header,row);
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
    picker.textContent=(validGroups.get(gid)||'未分组')+'  ▾';
    if(gid){row.classList.add('dw2rl-regex-group-row');const next=rows[index+1];if(!next||r.entries[next.id]!==gid)row.classList.add('dw2rl-regex-group-end');
      const run=runs[runs.length-1];if(run)run.last=row;
    }
    if(gid&&collapsed.get(key+':'+gid))row.classList.add('dw2rl-regex-collapsed');
    last=gid;
  });
  for(const run of runs){
    const outline=node('div','dw2rl-regex-outline');
    outline.dataset.folderKey=run.key;
    root.append(outline);
    outline._dw2rlHeader=run.header;
    outline._dw2rlLast=run.last;
  }
  snapshots.set(root,{signature,rows:[...rows]});
  ensureObserver(root);
  requestOutline(root);
 }
 function requestOutline(root){
   if(frame)cancelAnimationFrame(frame);
   frame=requestAnimationFrame(()=>{frame=0;if(root.isConnected)updateOutlines(root);});
 }
 function ensureObserver(root){
   if(observers.has(root))return;
   const resize=new ResizeObserver(()=>requestOutline(root));
   resize.observe(root);
   observers.set(root,resize);
 }
  function updateOutlines(root){
   const base=root.getBoundingClientRect();
   for(const outline of root.querySelectorAll(':scope > .dw2rl-regex-outline')){
     const header=outline._dw2rlHeader,last=outline._dw2rlLast;
     if(!header?.isConnected || !last?.isConnected){outline.remove();continue;}
     const collapsedNow=header.dataset.collapsed==='true';
     const firstRect=header.getBoundingClientRect();
     const lastRect=collapsedNow?firstRect:last.getBoundingClientRect();
     const top=firstRect.top-base.top+root.scrollTop;
     const left=firstRect.left-base.left+root.scrollLeft;
     outline.style.top=top+'px';
     outline.style.left=left+'px';
     outline.style.width=firstRect.width+'px';
     outline.style.height=Math.max(0,lastRect.bottom-firstRect.top)+'px';
   }
 }
 function sync(){
  if(!enabled())return disable();
  for(const [scope,selector] of CONTAINERS){
   const root=document.querySelector(selector);if(root){mounted.add(root);draw(scope,root);}
  }
 }
 function schedule(){clearTimeout(timer);timer=setTimeout(()=>{timer=0;sync();},90);}
 function disable(){clearTimeout(timer);timer=0;if(frame)cancelAnimationFrame(frame);frame=0;for(const resize of observers.values())resize.disconnect();observers.clear();dialog?.remove();dialog=null;folderMenu?.remove();folderMenu=null;for(const root of mounted){
   clear(root);snapshots.delete(root);root.previousElementSibling?.classList?.contains('dw2rl-regex-toolbar')&&root.previousElementSibling.remove();
   for(const row of nativeRows(root))row.querySelector(':scope > .dw2rl-regex-picker')?.remove();
  }mounted.clear();}
 return {sync:schedule,disable};
}
