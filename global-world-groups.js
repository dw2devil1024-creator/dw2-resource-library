/**
 * DW2 · Resource Library: additive grouping inside TT's existing Select2
 * global-world dropdown. Never changes native <select>/<option> markup,
 * values, selection, global activation or world-book files.
 */
export function planGlobalWorldGroups(groups, visibleLabels) {
  const pool=new Map();
  for (const label of visibleLabels) {
    if (!pool.has(label)) pool.set(label,0);
    pool.set(label,pool.get(label)+1);
  }
  const consumed=new Map(), sections=[];
  for (const group of groups) {
    const labels=[];
    for (const option of group.items||[]) {
      const label=String(option.label??'');
      const used=consumed.get(label)||0;
      if(used<(pool.get(label)||0)) {
        labels.push(label);
        consumed.set(label,used+1);
      }
    }
    if (labels.length) sections.push({key:group.key,name:group.name,labels});
  }
  const loose=[];
  for (const label of visibleLabels) {
    const remaining=(pool.get(label)||0)-(consumed.get(label)||0);
    if (remaining>0) {
      loose.push(label);
      consumed.set(label,(consumed.get(label)||0)+1);
    }
  }
  if (loose.length) sections.push({key:'other',name:'未分类',labels:loose});
  return sections;
}

export function createGlobalWorldGrouping({getGroups, onWarning=()=>{}}) {
  let select=null, jq=null, root=null, resultsObserver=null, closeTimer=0;
  let applying=false, active=false, originalRows=[];
  const expanded=new Map();
  const namespace='.dw2rlGlobal';
  const HEADER_CLASS='dw2rl-global-heading';
  const ROW_CLASS='dw2rl-global-row-collapsed';

  function findResults() {
    const instance=jq?.data('select2');
    const node=instance?.results?.$results?.[0];
    return node instanceof HTMLElement && node.classList.contains('select2-results__options') ? node : null;
  }
  function cleanupResults() {
    resultsObserver?.disconnect();resultsObserver=null;
    if (!root) return;
    const rows=[...root.children].filter(n=>n.classList?.contains('select2-results__option') && !n.classList.contains(HEADER_CLASS));
    for(const row of rows) {
      row.classList.remove(ROW_CLASS);
      row.style.removeProperty('display');
      row.removeAttribute('aria-hidden');
      if(row.dataset.dw2rlSelectable==='yes') row.classList.add('select2-results__option--selectable');
      delete row.dataset.dw2rlSelectable;
    }
    for(const node of [...root.querySelectorAll(':scope > .'+HEADER_CLASS)]) node.remove();
    if (originalRows.length && originalRows.every(node=>node.parentNode===root)) {
      // Restore Select2's original presentation order before relinquishing control.
      const remaining=[...root.children].filter(node=>!originalRows.includes(node));
      root.replaceChildren(...originalRows,...remaining);
    }
    originalRows=[];root=null;
  }
  function render() {
    if(!active||!root||!root.isConnected||applying)return;
    const rows=[...root.children].filter(node=>node.classList?.contains('select2-results__option') && !node.classList.contains(HEADER_CLASS));
    if(!rows.length)return;
    // Do not interpose when a different Select2 adapter already uses nested result groups.
    if(rows.some(row=>row.querySelector?.('.select2-results__options--nested')))return;
    applying=true;
    try {
      resultsObserver?.disconnect();
      const fresh=rows.some(node=>!originalRows.includes(node));
      if(fresh||!originalRows.length)originalRows=[...rows];
      const byName=new Map();
      for(const row of rows) {
        const name=row.textContent?.trim()||'';
        if(!byName.has(name))byName.set(name,[]);
        byName.get(name).push(row);
        row.classList.remove(ROW_CLASS);
        row.style.removeProperty('display');
        row.removeAttribute('aria-hidden');
        if(row.dataset.dw2rlSelectable==='yes')row.classList.add('select2-results__option--selectable');
        delete row.dataset.dw2rlSelectable;
      }
      const groups=getGroups()||[];
      const sections=planGlobalWorldGroups(groups,rows.map(row=>row.textContent?.trim()||''));
      const meaningful=sections.some(group=>group.key!=='loose'&&group.key!=='other');
      // Unclassified-only dropdown should remain as TT originally rendered it.
      if(!meaningful) {
        const others=[...root.children].filter(node=>!rows.includes(node)&&!node.classList?.contains(HEADER_CLASS));
        root.replaceChildren(...originalRows.filter(node=>node.parentNode===root),...others);
        return;
      }
      const searchInput=document.querySelector('.select2-container--open .select2-search__field');
      const searching=!!searchInput?.value?.trim();
      const output=[],used=new Set();
      for(const section of sections) {
        const sectionRows=[];
        for(const label of section.labels) {
          const row=byName.get(label)?.find(candidate=>!used.has(candidate));
          if(row){used.add(row);sectionRows.push(row);}
        }
        if(!sectionRows.length)continue;
        const header=document.createElement('li');
        header.className=HEADER_CLASS;
        header.setAttribute('role','presentation');
        const control=document.createElement('button');
        control.type='button';
        control.className='dw2rl-global-folder-toggle';
        const expandedNow=searching||(expanded.get(section.key)!==false);
        control.setAttribute('aria-expanded',String(expandedNow));
        control.textContent=(expandedNow?'▾ ':'▸ ')+section.name+' · '+sectionRows.length;
        control.addEventListener('mousedown',event=>{event.preventDefault();event.stopPropagation()});
        control.addEventListener('mouseup',event=>{event.preventDefault();event.stopPropagation()});
        control.addEventListener('click',event=>{
          event.preventDefault();event.stopPropagation();
          expanded.set(section.key,!(expanded.get(section.key)!==false));
          render();
        });
        header.append(control);output.push(header);
        for(const row of sectionRows){
          if(!expandedNow){
            row.classList.add(ROW_CLASS);
            row.style.setProperty('display','none','important');
            row.setAttribute('aria-hidden','true');
            if(row.classList.contains('select2-results__option--selectable')){
              row.dataset.dw2rlSelectable='yes';
              row.classList.remove('select2-results__option--selectable');
            }
          }
          output.push(row);
        }
      }
      for(const row of rows)if(!used.has(row))output.push(row);
      const others=[...root.children].filter(node=>!rows.includes(node)&&!node.classList?.contains(HEADER_CLASS));
      root.replaceChildren(...output,...others);
    }catch(e) {
      onWarning('全局世界书分类显示失败，已保留原生选择。'+String(e?.message||e));
      cleanupResults();
    }finally{
      applying=false;
      if(root && active)resultsObserver?.observe(root,{childList:true});
    }
  }
  function setupResults(){
    if(!active||!select)return;
    const next=findResults();
    if(!next)return;
    if(root!==next){
      cleanupResults();
      root=next;
      resultsObserver=new MutationObserver(()=>{if(!applying)queueMicrotask(render)});
      resultsObserver.observe(root,{childList:true});
    }
    queueMicrotask(render);
  }
  function onOpen() {
    if(closeTimer)clearTimeout(closeTimer);
    closeTimer=setTimeout(()=>{closeTimer=0;setupResults()},0);
  }
  function onClose(){
    if(closeTimer)clearTimeout(closeTimer);
    closeTimer=0;
    cleanupResults();
  }
  function disable() {
    active=false;
    if(closeTimer)clearTimeout(closeTimer);
    closeTimer=0;
    if(jq)jq.off(namespace);
    cleanupResults();
    select=null;jq=null;
  }
  function ensure() {
    const el=document.getElementById('world_info');
    const $=globalThis.jQuery||globalThis.$;
    if(!(el instanceof HTMLSelectElement)||!el.multiple||typeof $!=='function'||typeof $.fn?.select2!=='function')return false;
    const candidate=$(el);
    // Never destroy or initialize Select2. TT owns its lifetime.
    if(!candidate.data('select2'))return false;
    if(select===el&&active)return true;
    disable();select=el;jq=candidate;active=true;
    jq.on('select2:open'+namespace,onOpen);
    jq.on('select2:close'+namespace,onClose);
    return true;
  }
  return {ensure,disable};
}
