/* DW2 regex folders: presentation metadata only, no regex mutation. */
const CONTAINERS=[['global','#saved_regex_scripts'],['preset','#saved_preset_scripts'],['scoped','#saved_scoped_scripts']];
const trim=x=>String(x??'').trim();
export function createRegexFolders({enabled,getState,save}){
 const collapsed=new Map();let timer=0,dialog=null;const mounted=new Set();
 function node(tag,cls='',txt=''){const x=document.createElement(tag);x.className=cls;x.textContent=txt;return x;}
 function btn(label,fn,cls=''){const x=node('button',cls,label);x.type='button';x.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();fn();});return x;}
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
 function showDialog(title,initial,onSave){
   dialog?.remove();const modal=node('div','dw2rl-regex-dialog-backdrop');
   const form=node('form','dw2rl-regex-dialog');
   const input=node('input','text_pole');input.type='text';input.maxLength=50;input.value=initial;input.placeholder='文件夹名称';
   const actions=node('div','dw2rl-regex-dialog-actions');
   actions.append(btn('取消',()=>modal.remove()));
   const ok=node('button','menu_button','保存');ok.type='submit';actions.append(ok);
   form.append(node('div','',title),input,actions);modal.append(form);
   document.querySelector('#regex_container')?.append(modal);dialog=modal;
   for(const eventName of ['pointerdown','touchstart','mousedown','click'])modal.addEventListener(eventName,e=>e.stopPropagation());
   form.addEventListener('submit',e=>{e.preventDefault();e.stopPropagation();const name=trim(input.value);if(!name)return;if(onSave(name)!==false){modal.remove();dialog=null;schedule();}});
   modal.addEventListener('click',e=>{if(e.target===modal){modal.remove();dialog=null;}});
   setTimeout(()=>input.focus(),30);
 }
 function draw(scope,root){
  const rows=nativeRows(root);if(!rows.length){clear(root);root.previousElementSibling?.classList?.contains('dw2rl-regex-toolbar')&&root.previousElementSibling.remove();return;}
  const r=record(scope),validGroups=new Map(r.groups.map(g=>[g.id,g.name]));
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
      const key=scope+':'+gid;
      const toggle=btn((collapsed.get(key)?'▸ ':'▾ ')+validGroups.get(gid),()=>{collapsed.set(key,!collapsed.get(key));schedule();},'dw2rl-regex-folder-name');
      const count=rows.filter(x=>r.entries[x.id]===gid).length;
      header.append(toggle,node('small','',String(count)));
      header.append(btn('✎',()=>showDialog('重命名文件夹',validGroups.get(gid),name=>{
        if(r.groups.some(g=>g.id!==gid&&g.name===name))return false;
        r.groups.find(g=>g.id===gid).name=name;save();
      })));
      header.append(btn('×',()=>{if(!confirm('删除文件夹？正则本身不会删除。'))return;
        r.groups=r.groups.filter(g=>g.id!==gid);
        for(const [id,value] of Object.entries(r.entries))if(value===gid)delete r.entries[id];
        save();schedule();
      }));
      root.insertBefore(header,row);
    }
    // Move-to-folder menu belongs to the row and uses a native <select>,
    // keeping TT's original script row, edit, enable and drag handlers.
    row.querySelector(':scope > .dw2rl-regex-assign')?.remove();
    const selector=node('select','dw2rl-regex-assign text_pole');
    selector.setAttribute('aria-label','移动正则到文件夹');selector.title='移动到文件夹';
    const loose=node('option','','未分组');loose.value='';selector.append(loose);
    for(const g of r.groups){const opt=node('option','',g.name);opt.value=g.id;selector.append(opt);}
    selector.value=gid;
    selector.addEventListener('pointerdown',e=>e.stopPropagation());
    selector.addEventListener('touchstart',e=>e.stopPropagation(),{passive:true});
    selector.addEventListener('change',()=>{
       if(selector.value)r.entries[row.id]=selector.value;else delete r.entries[row.id];
       save();schedule();
    });
    row.append(selector);
    if(gid){row.classList.add('dw2rl-regex-group-row');const next=rows[index+1];if(!next||r.entries[next.id]!==gid)row.classList.add('dw2rl-regex-group-end');}
    if(gid&&collapsed.get(scope+':'+gid))row.classList.add('dw2rl-regex-collapsed');
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
