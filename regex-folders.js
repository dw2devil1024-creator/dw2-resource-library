/* DW2 regex folders: presentation metadata only, no regex mutation. */
const CONTAINERS=[['global','#saved_regex_scripts'],['preset','#saved_preset_scripts'],['scoped','#saved_scoped_scripts']];
const trim=x=>String(x??'').trim();
export function createRegexFolders({enabled,getState,save,context}){
 const collapsed=new Map();let timer=0,dialog=null;const mounted=new Set();
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
   root.querySelectorAll(':scope > .dw2rl-regex-header').forEach(x=>x.remove());
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
  if(!key){clear(root);return;}
  const rows=nativeRows(root);if(!rows.length){clear(root);root.previousElementSibling?.classList?.contains('dw2rl-regex-toolbar')&&root.previousElementSibling.remove();return;}
  const r=record(key),validGroups=new Map(r.groups.map(g=>[g.id,g.name]));
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
  rows.forEach((row,index)=>{
    const gid=validGroups.has(r.entries[row.id])?r.entries[row.id]:'';
    if(gid!==last&&gid){
      const header=node('div','dw2rl-regex-header');
      const collapseKey=key+':'+gid;
      const toggle=btn((collapsed.get(collapseKey)?'▸ ':'▾ ')+validGroups.get(gid),()=>{collapsed.set(collapseKey,!collapsed.get(collapseKey));schedule();},'dw2rl-regex-folder-name');
      const members=rows.filter(x=>r.entries[x.id]===gid);
      const count=members.length;
      const active=members.filter(x=>x.querySelector('input.disable_regex')?.checked===false).length;
      header.dataset.collapsed=String(!!collapsed.get(collapseKey));
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
    let selector=row.querySelector(':scope > .dw2rl-regex-assign');
    if(!selector){
      selector=node('select','dw2rl-regex-assign text_pole');
      selector.setAttribute('aria-label','移动正则到文件夹');
      selector.title='移动到文件夹';
      selector.addEventListener('pointerdown',e=>e.stopPropagation());
      selector.addEventListener('touchstart',e=>e.stopPropagation(),{passive:true});
      selector.addEventListener('mousedown',e=>e.stopPropagation());
      selector.addEventListener('click',e=>e.stopPropagation());
      selector.addEventListener('change',()=>{
        const scopeIdentity=selector.dataset.scopeKey;
        const current=record(scopeIdentity);
        if(selector.value)current.entries[row.id]=selector.value;
        else delete current.entries[row.id];
        save();schedule();
      });
      row.append(selector);
    }
    const signature=r.groups.map(g=>g.id+'='+g.name).join('|');
    // Preserve active options while the user is interacting with the menu.
    if(selector.dataset.optionsSignature!==signature){
      const selected=gid;
      selector.replaceChildren();
      const loose=node('option','','未分组');loose.value='';selector.append(loose);
      for(const g of r.groups){const opt=node('option','',g.name);opt.value=g.id;selector.append(opt);}
      selector.dataset.optionsSignature=signature;
      selector.value=selected;
    }
    selector.dataset.scopeKey=key;
    if(document.activeElement!==selector && selector.value!==gid)selector.value=gid;
    if(gid){row.classList.add('dw2rl-regex-group-row');const next=rows[index+1];if(!next||r.entries[next.id]!==gid)row.classList.add('dw2rl-regex-group-end');}
    if(gid&&collapsed.get(key+':'+gid))row.classList.add('dw2rl-regex-collapsed');
    last=gid;
  });
 }
 function sync(){
  if(!enabled())return disable();
  for(const [scope,selector] of CONTAINERS){
   const root=document.querySelector(selector);if(root){mounted.add(root);draw(scope,root);}
  }
 }
 function schedule(){clearTimeout(timer);timer=setTimeout(()=>{timer=0;sync();},90);}
 function disable(){clearTimeout(timer);timer=0;dialog?.remove();dialog=null;for(const root of mounted){
   clear(root);root.previousElementSibling?.classList?.contains('dw2rl-regex-toolbar')&&root.previousElementSibling.remove();
   for(const row of nativeRows(root))row.querySelector(':scope > .dw2rl-regex-assign')?.remove();
  }mounted.clear();}
 return {sync:schedule,disable};
}
