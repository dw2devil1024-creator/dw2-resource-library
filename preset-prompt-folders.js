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
    if(currentPreset!==name){currentPreset=name;active='all';legacyLoaded='';}
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
    const b=el('button',cls,label);b.type='button';b.addEventListener('click',run);return b;
  }
  function showRows(rows,record){
    const allowed=new Set(rows.map(row=>safe(row.dataset.pmIdentifier)));
    for(const row of rows){
      const id=safe(row.dataset.pmIdentifier);
      const group=record.entries?.[id]||'';
      const visible=active==='all' || (active==='loose'&&!group) || active===group;
      row.classList.toggle('dw2rl-prompt-row-filtered',!visible);
    }
    const list=doc().getElementById('completion_prompt_manager_list');
    if(list)list.classList.toggle('dw2rl-prompt-list-filtering',active!=='all');
    return allowed;
  }
  function saveRecord(){save();render();}
  function makeGroup(){
    const name=safe(prompt('新建分组名称')).slice(0,50);
    if(!name)return;
    const rec=currentRecord();if(!rec)return;
    if(rec.groups.some(g=>g.name===name)){alert('这个分组名称已存在');return;}
    rec.groups.push({id:'dw2g'+Date.now().toString(36)+Math.random().toString(36).slice(2,7),name});
    saveRecord();
  }
  function editGroup(){
    if(active==='all'||active==='loose')return;
    const rec=currentRecord(),group=rec?.groups.find(g=>g.id===active);if(!group)return;
    const name=prompt('修改分组名称。留空则取消修改',group.name);
    if(name===null||!safe(name))return;
    const next=safe(name).slice(0,50);
    if(rec.groups.some(g=>g.id!==group.id&&g.name===next)){alert('已存在同名分组');return;}
    group.name=next;saveRecord();
  }
  function deleteGroup(){
    if(active==='all'||active==='loose')return;
    const rec=currentRecord(),group=rec?.groups.find(g=>g.id===active);if(!group)return;
    if(!confirm('删除「'+group.name+'」分组？分组内的提示词只会变成未分组，不会被删除。'))return;
    rec.groups=rec.groups.filter(g=>g.id!==group.id);
    for(const [id,value] of Object.entries(rec.entries))if(value===group.id)delete rec.entries[id];
    active='all';saveRecord();
  }
  function organize(rows,record){
    const overlay=el('div',PREFIX+'-organizer');
    const close=btn('关闭',()=>overlay.remove());
    const heading=el('div',PREFIX+'-organizer-head','整理提示词归属');
    heading.append(close);
    overlay.append(heading,el('p',PREFIX+'-note','这里只修改文件夹归属，不改变提示词执行顺序。原生拖拽请切回「全部」。'));
    const list=el('div',PREFIX+'-organizer-list');
    for(const row of rows){
      const id=safe(row.dataset.pmIdentifier);
      const label=safe(row.querySelector('.completion_prompt_manager_prompt_name')?.getAttribute('data-pm-name'))||safe(row.textContent).slice(0,80);
      const line=el('label',PREFIX+'-organizer-item');
      line.append(el('span','',label));
      const select=doc().createElement('select');select.setAttribute('aria-label','将 '+label+' 移入分组');
      const loose=doc().createElement('option');loose.value='';loose.textContent='未分组';select.append(loose);
      for(const g of record.groups){const opt=doc().createElement('option');opt.value=g.id;opt.textContent=g.name;select.append(opt);}
      select.value=record.entries[id]||'';
      select.addEventListener('change',()=>{
        if(select.value)record.entries[id]=select.value;
        else delete record.entries[id];
        save();setTimeout(render,0);
      });
      line.append(select);list.append(line);
    }
    overlay.append(list);toolbar.append(overlay);
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
    title.append(el('small','',currentLegacy?' · 已检测旧分组记录':' · 不改变执行顺序'));
    toolbar.append(title);
    const actions=el('div',PREFIX+'-actions');
    actions.append(btn('＋ 新建分组',makeGroup),btn('整理归属',()=>organize(rows,rec)));
    if(active!=='all'&&active!=='loose')actions.append(btn('改名',editGroup),btn('删除分组',deleteGroup));
    toolbar.append(actions);
    const tabs=el('div',PREFIX+'-tabs');
    const makeTab=(key,name,count)=>{
      const b=btn((active===key?'▾ ':'▸ ')+name+' · '+count,()=>{active=active===key?'all':key;render();},PREFIX+'-tab');
      b.setAttribute('aria-pressed',String(active===key));tabs.append(b);
    };
    makeTab('all','全部',rows.length);
    for(const g of rec.groups)makeTab(g.id,g.name,rows.filter(r=>rec.entries[safe(r.dataset.pmIdentifier)]===g.id).length);
    makeTab('loose','未分组',rows.filter(r=>!rec.entries[safe(r.dataset.pmIdentifier)]||!rec.groups.some(g=>g.id===rec.entries[safe(r.dataset.pmIdentifier)])).length);
    toolbar.append(tabs);
    showRows(rows,rec);
    const count=active==='all'?rows.length:rows.filter(r=>!r.classList.contains('dw2rl-prompt-row-filtered')).length;
    toolbar.append(el('div',PREFIX+'-hint',active==='all'?'当前显示原生完整列表，可正常拖拽排序':'仅显示当前分组 · '+count+' 项。需要拖拽请切回「全部」。'));
  }
  function schedule(){
    if(timer)clearTimeout(timer);
    timer=setTimeout(()=>{timer=0;render();},240);
  }
  function disable(){
    if(timer)clearTimeout(timer);timer=0;
    for(const row of records())row.classList.remove('dw2rl-prompt-row-filtered');
    doc().getElementById('completion_prompt_manager_list')?.classList.remove('dw2rl-prompt-list-filtering');
    toolbar?.remove();toolbar=null;host=null;active='all';currentPreset='';
  }
  return {sync:schedule,disable};
}
