/**
 * DW2 · Resource Library: native Select2 global world-book dropdown grouping.
 * This module only moves Select2's transient result <li> nodes into visual
 * groups. It never modifies #world_info options, values, or selected state.
 */
let installed=false;
let listObserver=null, activeList=null, scheduled=false;
let getOptions=null, getEnabled=null, getGroups=null;
const expandedGroups=new Set();
const norm=text=>String(text||'').replace(/\s+/gu,' ').trim().normalize('NFC');
const safeGetList=()=>document.getElementById('select2-world_info-results');

function stopObserving(){
  listObserver?.disconnect();
  listObserver=null;
}

function unwrap(list){
  if(!list)return;
  for(const li of [...list.querySelectorAll(':scope > li.dw2rl-global-world-folder')]){
    const nested=li.querySelector(':scope > ul');
    if(nested){li.replaceWith(...[...nested.children]);}
    else li.remove();
  }
  list.removeAttribute('data-dw2rl-global-world');
}
function restore(){
  stopObserving();
  unwrap(activeList);
  activeList=null;
}
function groupName(item){return norm(item?.label);}
function rerender(){
  scheduled=false;
  if(!installed||!getEnabled?.()){restore();return;}
  const select=document.getElementById('world_info');
  const jq=globalThis.jQuery||globalThis.$;
  if(!(select instanceof HTMLSelectElement)||!select.multiple||typeof jq!=='function'){restore();return;}
  const instance=jq(select).data('select2');
  if(!instance?.isOpen?.()){restore();return;}
  const list=safeGetList();
  if(!list){restore();return;}
  stopObserving();
  if(activeList && activeList!==list)unwrap(activeList);
  activeList=list;
  unwrap(list);

  const search=document.querySelector('.select2-container--open .select2-search__field');
  const searching=!!String(search?.value||'').trim();
  const options=getOptions?.(select)||[];
  const resultNodes=[...list.querySelectorAll(':scope > li.select2-results__option--selectable')];
  const byName=new Map();
  for(const li of resultNodes){
    const name=norm(li.textContent);
    if(!byName.has(name))byName.set(name,[]);
    byName.get(name).push(li);
  }
  const unambiguous=options.length>0
    && options.length===resultNodes.length
    && options.every(o=>(byName.get(groupName(o))||[]).length===1);
  if(!searching && unambiguous){
    const groups=getGroups?.(options)||[];
    if(groups.length){
      const knownNames=new Set();
      for(const group of groups){
        const items=(group.items||[]).filter(item=>!knownNames.has(groupName(item)));
        if(!items.length)continue;
        const folder=document.createElement('li');
        folder.className='select2-results__option select2-results__option--group dw2rl-global-world-folder';
        folder.setAttribute('role','group');
        folder.setAttribute('aria-label',String(group.name));
        const strong=document.createElement('strong');
        strong.className='select2-results__group dw2rl-global-world-title';
        const toggle=document.createElement('button');
        toggle.type='button';
        toggle.className='dw2rl-global-world-toggle';
        const key=String(group.key);
        const opened=expandedGroups.has(key);
        toggle.setAttribute('aria-expanded',String(opened));
        const chevron=document.createElement('span');
        chevron.className='dw2rl-global-world-chevron';
        chevron.textContent='⌄';
        const caption=document.createElement('span');caption.textContent=String(group.name);
        const count=document.createElement('small');count.textContent=String(items.length);
        toggle.append(chevron,caption,count);
        toggle.addEventListener('mousedown',event=>{event.preventDefault();event.stopPropagation();});
        const nested=document.createElement('ul');
        nested.className='select2-results__options select2-results__options--nested dw2rl-global-world-items';
        nested.setAttribute('role','none');
        nested.hidden=!opened;
        toggle.addEventListener('click',event=>{
          event.preventDefault();event.stopPropagation();
          const next=nested.hidden;
          nested.hidden=!next;
          toggle.setAttribute('aria-expanded',String(next));
          if(next)expandedGroups.add(key);else expandedGroups.delete(key);
        });
        strong.append(toggle);
        folder.append(strong,nested);
        for(const item of items){
          const name=groupName(item);
          const li=byName.get(name)?.[0];
          if(!li)continue;
          knownNames.add(name);
          nested.append(li);
        }
        list.append(folder);
      }
      // Guard against plugin-result shape changes: no option may disappear.
      if(knownNames.size===options.length)list.dataset.dw2rlGlobalWorld='1';
      else unwrap(list);
    }
  }
  // Select2 may rewrite result nodes after a search or selection.
  listObserver=new MutationObserver(changes=>{
    if(changes.some(m=>m.addedNodes.length||m.removedNodes.length))schedule();
  });
  listObserver.observe(list,{childList:true,subtree:true});
}
function schedule(){
  if(scheduled)return;
  scheduled=true;
  setTimeout(rerender,0);
}
function onOpen(event){
  if(event?.target?.id==='world_info')schedule();
}
function onSearch(event){
  if(event?.target?.matches?.('.select2-container--open .select2-search__field'))schedule();
}
export function installGlobalWorldGroups(args){
  getEnabled=args?.enabled;
  getOptions=args?.options;
  getGroups=args?.groups;
  if(installed)return;
  installed=true;
  const jq=globalThis.jQuery||globalThis.$;
  if(typeof jq==='function'){
    jq(document).on('select2:open.dw2rlglobal', '#world_info',onOpen);
    jq(document).on('select2:select.dw2rlglobal select2:unselect.dw2rlglobal','#world_info',onOpen);
  }
  document.addEventListener('input',onSearch,true);
}
export function refreshGlobalWorldGroups(){
  if(!getEnabled?.()){
    restore();
    const select=document.getElementById('world_info');
    const jq=globalThis.jQuery||globalThis.$;
    if(select && typeof jq==='function'){
      const instance=jq(select).data('select2');
      if(instance?.isOpen?.())jq(select).select2('close');
    }
  }else schedule();
}
export function uninstallGlobalWorldGroups(){
  installed=false;
  const jq=globalThis.jQuery||globalThis.$;
  if(typeof jq==='function')jq(document).off('.dw2rlglobal');
  document.removeEventListener('input',onSearch,true);
  restore();
  expandedGroups.clear();
  getEnabled=getOptions=getGroups=null;
}
