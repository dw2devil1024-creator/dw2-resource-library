/**
 * DW2 · Resource Library v0.1.6-beta.2 | S.A. · DW2
 * Optional non-destructive selector enhancement for TT/ST.
 * Independent implementation. No third-party resource organizer source code reused.
 */
import {
  VERSION, STORE_KEY, CATEGORIES, createEmptyState, normalizeState,
  ensureResource, sourceFromSelect, groupOptions, managerGroups, optionsForSelect, planSmartGroups, applySmartGroups, characterLinkedWorld
} from './resource-core.js';

const SELECTORS='select[data-preset-manager-for], select#themes, select#world_editor_select';
const MENU_ID='dw2rl-menu-entry';
const SETTINGS_ID='dw2rl-settings';
const POP_ID='dw2rl-popover';
const MANAGER_ID='dw2rl-manager';
const sourceMap=new Map();
const adapters=new Map();
let alive=false, startPromise=null, watcher=null, scanTimer=0, delayedTimer=0;
let state=createEmptyState(), ctx=null, fallbackStore=false;
let popover=null, manager=null, settingsRoot=null, managedSourceId='';
let category='preset', query='', managerQuery='', openedGroup='', settingsReady=false;
const managerExpanded=new Set();
let managerInitializedSource='';
const listeners=[];

const el=(tag,cls='',text)=>{
  const item=document.createElement(tag);
  if(cls)item.className='dw2rl-'+cls;
  if(text!==undefined)item.textContent=String(text);
  return item;
};
const button=(label,cls='',action)=>{
  const b=el('button',cls,label);b.type='button';if(action)b.addEventListener('click',action);return b;
};
const icon=(name)=>{
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','17');svg.setAttribute('height','17');
  svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.5');
  svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');
  const paths={down:'m6 9 6 6 6-6',folder:'M3 7h7l2 2h9v10H3z M3 7V5a2 2 0 0 1 2-2h5l2 4',close:'M6 6l12 12M18 6 6 18',settings:'M4 7h16M4 12h16M4 17h16',search:'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16m6-2 4 4'};
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',paths[name]||paths.folder);svg.append(path);return svg;
};
const nativeContext=()=>{try{return globalThis.SillyTavern?.getContext?.()||null}catch{return null}};
const notify=(message,kind='info')=>{
  const fn=globalThis.toastr?.[kind];if(typeof fn==='function')fn(message,'DW2 · 资源分类');
  else if(kind==='warning'||kind==='error')console.warn('[DW2 资源分类]',message);
};
function loadData(){
  ctx=nativeContext();
  if(ctx?.extensionSettings && typeof ctx.extensionSettings==='object'){
    state=normalizeState(ctx.extensionSettings[STORE_KEY]);fallbackStore=false;
  }else{
    fallbackStore=true;
    try{state=normalizeState(JSON.parse(localStorage.getItem(STORE_KEY)||'null'))}catch{state=createEmptyState()}
  }
}
// Both TT world-book selectors list the same files. Merge older independent
// global folder labels into editor folders, while keeping the old record.
function mergeWorldBookFolders(){
  const source=state.resources['world:global'];
  if(!source || (!source.groups?.length && !Object.keys(source.assignments||{}).length))return;
  const target=ensureResource(state,'world:editor');
  const mapping=new Map();let changed=false;
  for(const folder of source.groups||[]){
    let dest=target.groups.find(g=>g.name===folder.name);
    if(!dest){
      let id=folder.id;
      if(target.groups.some(g=>g.id===id))id='wg'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
      dest={id,name:folder.name};target.groups.push(dest);changed=true;
    }
    mapping.set(folder.id,dest.id);
  }
  for(const [value,groupId] of Object.entries(source.assignments||{})){
    const mapped=mapping.get(groupId);
    if(mapped && !Object.hasOwn(target.assignments,value)){target.assignments[value]=mapped;changed=true}
  }
  if(changed)saveData();
}
const folderSourceId=adapter=>adapter?.source?.category==='world'?'world:editor':adapter.source.id;
const folderRecord=adapter=>ensureResource(state,folderSourceId(adapter));
function saveData(){
  if(!fallbackStore){
    const current=nativeContext();
    if(current?.extensionSettings){current.extensionSettings[STORE_KEY]=state;current.saveSettingsDebounced?.();return}
  }
  try{localStorage.setItem(STORE_KEY,JSON.stringify(state))}catch(error){notify('分类保存失败：'+error.message,'warning')}
}
function compatible(){
  // Respect an already-installed selector controller. Never fight it.
  return !document.querySelector('#srg-root,#srg-settings,.srg-select-shell');
}
function optionLabel(adapter){
  const select=adapter.select;
  if(select.multiple){const n=[...select.options].filter(o=>o.selected).length;return n ? `已启用 ${n} 项`:'选择世界书';}
  const current=select.selectedOptions?.[0]||select.options?.[select.selectedIndex];
  return current?.textContent?.trim()||'选择'+(adapter.source.category==='theme'?'美化':adapter.source.category==='world'?'世界书':'预设');
}
function refreshTrigger(adapter){
  if(!adapter.trigger)return;
  adapter.title.textContent=optionLabel(adapter);
  adapter.trigger.title='按分组选择：'+adapter.title.textContent;
  adapter.trigger.setAttribute('aria-label',adapter.trigger.title);
}
function cleanupAdapter(adapter){
  adapter.observer?.disconnect();
  adapter.select.removeEventListener('change',adapter.update);
  adapter.select.classList.remove('dw2rl-native-hidden');
  adapter.companions.forEach(x=>x.classList.remove('dw2rl-native-hidden'));
  adapter.trigger?.remove();
  if(popover?.dataset.source===adapter.source.id)closePopover();
}
function findCompanion(select){
  const found=[];
  let next=select.nextElementSibling;
  for(let i=0;next&&i<3;i++,next=next.nextElementSibling){
    if(next.matches('.select2-container,.chosen-container')){found.push(next);break}
    if(next.tagName==='SELECT')break;
  }
  return found;
}

function connect(select,source){
  const known=adapters.get(select);
  if(known){refreshTrigger(known);return}
  const selected=sourceMap.get(source.id);
  if(selected && selected!==select){const previous=adapters.get(selected);if(previous){cleanupAdapter(previous);adapters.delete(selected)}}
  const trigger=button('','native-trigger',()=>openPopover(select));
  const title=el('span','native-value','');
  const arrow=icon('down');arrow.classList.add('dw2rl-chevron');
  trigger.append(title,arrow);
  const adapter={select,source,trigger,title,companions:[],observer:null,update:null};
  adapter.update=()=>{refreshTrigger(adapter);if(popover?.dataset.source===source.id)drawPopover(adapter)};
  select.addEventListener('change',adapter.update);
  // Place the replacement at the native widget's exact original slot.
  const companions=findCompanion(select);
  const anchor=companions.at(-1)||select;
  anchor.insertAdjacentElement('afterend',trigger);
  companions.forEach(x=>{if(!x.classList.contains('dw2rl-native-hidden')){x.classList.add('dw2rl-native-hidden');adapter.companions.push(x)}});
  select.classList.add('dw2rl-native-hidden');
  const style=getComputedStyle(select);
  if(style.fontFamily)trigger.style.fontFamily=style.fontFamily;
  if(style.fontSize)trigger.style.fontSize=style.fontSize;
  adapter.observer=new MutationObserver(()=>{
    refreshTrigger(adapter);
    if(popover?.dataset.source===source.id)drawPopover(adapter);
  });
  adapter.observer.observe(select,{childList:true,subtree:true,attributes:true,attributeFilter:['selected','value','disabled']});
  adapters.set(select,adapter);sourceMap.set(source.id,select);refreshTrigger(adapter);
}
function deactivateSelectors(){
  closePopover();
  for(const adapter of adapters.values())cleanupAdapter(adapter);
  adapters.clear();sourceMap.clear();
}
function scan(){
  if(!alive || !state.enabled)return;
  if(!compatible()){
    deactivateSelectors();
    notify('检测到嘎嘎资源分组仍在接管选择框，请先停用它并刷新 TT。','warning');
    state.enabled=false;saveData();syncSetting();return;
  }
  const live=new Set();
  for(const select of document.querySelectorAll(SELECTORS)){
    const source=sourceFromSelect(select);
    if(!source || !select.isConnected)continue;
    live.add(select);connect(select,source);
  }
  for(const [select,adapter] of adapters){
    if(!live.has(select)){
      cleanupAdapter(adapter);adapters.delete(select);
      if(sourceMap.get(adapter.source.id)===select)sourceMap.delete(adapter.source.id);
    }
  }
}
function scheduleScan(){
  if(!alive||!state.enabled||scanTimer)return;
  scanTimer=setTimeout(()=>{scanTimer=0;scan()},160);
}
function setEnabled(yes){
  if(yes&&!compatible()){
    // Do not leave an earlier session's replacement select active on conflict.
    if(state.enabled){state.enabled=false;saveData();deactivateSelectors()}
    notify('请先停用嘎嘎资源分组并刷新酒馆，再启用 DW2 资源分类。','warning');
    syncSetting();return false;
  }
  state.enabled=!!yes;saveData();
  if(state.enabled)scan();else deactivateSelectors();
  syncSetting();return true;
}
function sourceOptions(adapter){return optionsForSelect(adapter?.select)}
function linkedWorldFor(adapter){
  if(adapter?.source.category!=='world')return '';
  return characterLinkedWorld(nativeContext());
}
function linkedWorldNotice(adapter){
  const name=linkedWorldFor(adapter);
  if(!name)return null;
  const notice=el('div','world-bound');
  notice.append(el('span','world-bound-label','角色卡关联世界书'),el('strong','world-bound-name',name),
    el('small','world-bound-note','来自当前角色卡'));
  return notice;
}

function selectedGroup(options,resource){
  const current=options.find(x=>x.selected);
  if(!current)return '';
  const group=groupOptions(options,resource,state.autoGroup).find(g=>g.items.some(x=>x.value===current.value));
  return group?.key||'';
}
function positionPopover(anchor){
  if(!popover || !anchor)return;
  // A detached/hidden native drawer must not leave a free-floating orphan.
  if(!anchor.isConnected){closePopover();return}
  for(let parent=anchor;parent && parent!==document.body;parent=parent.parentElement){
    const style=getComputedStyle(parent);
    if(style.display==='none'||style.visibility==='hidden'){closePopover();return}
  }
  const box=anchor.getBoundingClientRect();
  const vw=document.documentElement.clientWidth||innerWidth;
  const vh=window.visualViewport?.height||innerHeight;
  if(box.width<4||box.height<4||box.bottom<=0||box.top>=vh||box.right<=0||box.left>=vw){closePopover();return}
  const width=Math.min(Math.max(box.width,255),Math.min(vw-20,390));
  const left=Math.max(10,Math.min(vw-width-10,box.left));
  const below=vh-box.bottom,above=box.top;
  const maxHeight=Math.max(175,Math.min(430,(below>=220?below:above)-18));
  popover.style.width=width+'px';popover.style.left=left+'px';
  popover.style.maxHeight=maxHeight+'px';
  if(below>=220 || below>=above){popover.style.top=Math.max(9,box.bottom+6)+'px';popover.style.bottom='auto';}
  else{popover.style.top='auto';popover.style.bottom=Math.max(9,vh-box.top+6)+'px';}
}
function openPopover(select){
  const adapter=adapters.get(select);if(!adapter||!alive)return;
  if(popover?.dataset.source===adapter.source.id){closePopover();return}
  closePopover();
  query='';openedGroup='';
  popover=el('div','popover');popover.id=POP_ID;popover.dataset.source=adapter.source.id;
  popover.setAttribute('role','dialog');popover.setAttribute('aria-label','按分类选择'+adapter.source.label);
  // The popover is portalled to body to avoid clipped TT drawers. Prevent
  // its clicks/touches from reaching native outside-of-drawer closers.
  // Do not preventDefault: retain iOS scrolling, text input and native taps.
  for(const type of ['touchstart','touchmove','touchend','touchcancel',
    'pointerdown','pointermove','pointerup','pointercancel',
    'mousedown','mousemove','mouseup','wheel','click']){
    popover.addEventListener(type,event=>event.stopPropagation(),{passive:true});
  }
  document.body.append(popover);
  drawPopover(adapter);positionPopover(adapter.trigger);
}
function closePopover(){popover?.remove();popover=null;query='';}
function performSelect(adapter,value){
  const option=[...adapter.select.options].find(x=>x.value===value);
  if(!option||option.disabled)return;
  if(adapter.select.multiple){option.selected=!option.selected;}
  else{adapter.select.value=value;option.selected=true;}
  // Native ST/TT owns all changes to presets, themes and world-book activation.
  adapter.select.dispatchEvent(new Event('change',{bubbles:true}));
  refreshTrigger(adapter);
  if(!adapter.select.multiple)closePopover();
}
function drawPopover(adapter){
  if(!popover||!adapter.trigger.isConnected)return;
  const content=popover;
  const savedScroll=content.querySelector('.dw2rl-groups')?.scrollTop||0;
  content.replaceChildren();
  const head=el('div','pop-head');
  const headline=el('div','pop-heading');headline.append(el('small','','S.A. · DW2'),el('strong','',adapter.source.label));
  const manage=button('整理','link-button',()=>{closePopover();openManager(adapter.source.id)});
  const close=button('','icon-button',closePopover);close.append(icon('close'));close.setAttribute('aria-label','关闭');
  head.append(headline,manage,close);content.append(head);
  const boundNotice=linkedWorldNotice(adapter);if(boundNotice)content.append(boundNotice);
  const search=el('input','search');search.type='search';search.placeholder='搜索名称或分类…';search.autocomplete='off';search.value=query;
  const focusHad=content.contains(document.activeElement) && document.activeElement?.matches('input[type="search"]');
  search.addEventListener('input',()=>{query=search.value;const pos=search.selectionStart;drawPopover(adapter);const next=popover?.querySelector('.dw2rl-search');if(next){next.focus();try{next.setSelectionRange(pos,pos)}catch{}}});
  content.append(search);
  const options=sourceOptions(adapter),resource=folderRecord(adapter);
  const linkedWorld=linkedWorldFor(adapter);
  const groups=groupOptions(options,resource,state.autoGroup);
  const list=el('div','groups');
  const needle=query.trim().toLocaleLowerCase();
  const currentGroup=selectedGroup(options,resource);
  let shown=0;
  for(const group of groups){
    const items=needle?group.items.filter(x=>x.label.toLocaleLowerCase().includes(needle)||group.name.toLocaleLowerCase().includes(needle)):group.items;
    if(!items.length)continue;
    shown+=items.length;
    const card=el('div','group');
    const header=button('','group-head');header.dataset.group=group.key;
    const expanded=!!needle || (openedGroup?openedGroup===group.key:group.key===currentGroup);
    const glyph=icon('down');glyph.classList.add('dw2rl-group-chevron');
    header.append(glyph,el('span','group-name',group.name),el('small','group-count',String(items.length)));
    header.setAttribute('aria-expanded',String(expanded));
    header.addEventListener('click',event=>{
      event.preventDefault();event.stopPropagation();
      openedGroup=expanded?'__none__':group.key;
      drawPopover(adapter);
    });
    card.append(header);
    if(expanded){
      const entries=el('div','group-items');
      for(const item of items){
        const picked=button('','option'+(item.selected?' is-picked':''),()=>performSelect(adapter,item.value));
        picked.title=item.label;
        picked.append(el('span','option-label',item.label));
        if(linkedWorld && item.label===linkedWorld)picked.append(el('small','bound-marker','角色卡关联'));
        if(item.selected)picked.append(el('span','selected-mark','✓'));
        entries.append(picked);
      }
      card.append(entries);
    }
    list.append(card);
  }
  if(!shown)list.append(el('p','empty',options.length?'没有找到匹配资源':'暂时没有可选资源'));
  content.append(list);
  list.scrollTop=savedScroll;
  if(focusHad)search.focus({preventScroll:true});
  positionPopover(adapter.trigger);
}
function sourcesFor(categoryId){
  return [...sourceMap.values()].map(s=>adapters.get(s)).filter(a=>a?.source.category===categoryId).sort((a,b)=>a.source.label.localeCompare(b.source.label,'zh-CN'));
}
function availableSource(){
  const current=sourceMap.get(managedSourceId);
  if(current && adapters.has(current) && adapters.get(current).source.category===category)return adapters.get(current);
  const first=sourcesFor(category)[0];managedSourceId=first?.source.id||'';return first;
}
function closeManager(){manager?.remove();manager=null;managerQuery='';managerInitializedSource='';managerExpanded.clear();}
function overlayPrompt(title,initial,onSave,opts={}){
  if(!manager)return;
  const backdrop=el('div','dialog-backdrop');
  const popup=el('div','confirm-dialog');popup.setAttribute('role','dialog');popup.setAttribute('aria-label',title);
  popup.append(el('strong','',title));
  const input=el('input','name-input');input.value=initial||'';input.maxLength=36;input.placeholder='输入文件夹名称';
  const note=el('p','error-text','');
  if(!opts.confirmOnly){popup.append(input,note)}else popup.append(el('p','dialog-message',opts.message||''));
  let choice=null;
  if(opts.confirmOnly&&opts.optionLabel){
    const label=el('label','dialog-choice');choice=el('input');choice.type='checkbox';
    choice.checked=opts.optionDefault===true;
    label.append(choice,el('span','',opts.optionLabel));popup.append(label);
    choice.addEventListener('change',()=>{
      const next=opts.onToggle?.(choice.checked);
      const msg=popup.querySelector('.dw2rl-dialog-message');
      if(msg&&typeof next==='string')msg.textContent=next;
    });
  }
  const actions=el('div','dialog-actions');
  actions.append(button('取消','soft-btn',()=>backdrop.remove()));
  const ok=button(opts.confirmOnly?'确认':'保存',opts.danger?'danger-btn':'primary-btn',()=>{
    const name=input.value.trim();
    if(!opts.confirmOnly && (!name || name.length>36)){note.textContent='请输入 1 至 36 字的名称';return}
    const result=onSave(opts.confirmOnly?'':name,choice?.checked);
    if(result===false){note.textContent='名称重复或无法保存';return}
    backdrop.remove();renderManager();
  });
  actions.append(ok);popup.append(actions);backdrop.append(popup);manager.append(backdrop);
  if(!opts.confirmOnly){input.focus();input.select();input.addEventListener('keydown',e=>{if(e.key==='Enter')ok.click()})}
}
function makeGroup(adapter){
  overlayPrompt('新建分类','',name=>{
    const record=folderRecord(adapter);
    if(record.groups.some(g=>g.name===name))return false;
    record.groups.push({id:'g'+Date.now().toString(36)+Math.random().toString(36).slice(2,8),name});
    saveData();return true;
  });
}
function renameGroup(adapter,group){
  overlayPrompt('重命名分类',group.name,name=>{
    const record=folderRecord(adapter);
    if(record.groups.some(g=>g.id!==group.id&&g.name===name))return false;
    const target=record.groups.find(g=>g.id===group.id);if(!target)return false;
    target.name=name;saveData();return true;
  });
}
function removeGroup(adapter,group){
  overlayPrompt('删除这个分类？','',()=>{
    const record=folderRecord(adapter);
    record.groups=record.groups.filter(g=>g.id!==group.id);
    for(const [value,id] of Object.entries(record.assignments))if(id===group.id)delete record.assignments[value];
    saveData();return true;
  },{confirmOnly:true,danger:true,message:'只删除文件夹分类，里面的预设、世界书或美化不会被删除。'});
}
function assign(adapter,item,groupId){
  const record=folderRecord(adapter);
  if(groupId && record.groups.some(g=>g.id===groupId))record.assignments[item.value]=groupId;
  else delete record.assignments[item.value];
  saveData();
  if(popover?.dataset.source===adapter.source.id)drawPopover(adapter);
}
function smartOrganize(adapter){
  const record=folderRecord(adapter);
  const options=sourceOptions(adapter);
  const propose=withSingles=>planSmartGroups(options,record,{allowSingletons:withSingles});
  const explain=withSingles=>{
    const plan=propose(withSingles);
    const sample=plan.groups.slice(0,7).map(g=>g.name+'（'+g.values.length+'）').join('、');
    return '预计整理 '+plan.total+' 项，共 '+plan.groups.length+' 个分类（单项文件夹 '+plan.singletons+' 个）。'
      +(sample?'例如：'+sample+(plan.groups.length>7?'等。':'。'):'')
      +'还有 '+plan.remaining+' 项不处理。已手动分类的保持不变，不修改预设、世界书或美化文件。';
  };
  overlayPrompt('智能整理预览','',(_,withSingles)=>{
    const latest=folderRecord(adapter);
    const plan=planSmartGroups(sourceOptions(adapter),latest,{allowSingletons:withSingles});
    if(!plan.groups.length){notify('目前没有可以新增的分类','info');return true}
    applySmartGroups(latest,plan);
    saveData();
    if(popover?.dataset.source===adapter.source.id)drawPopover(adapter);
    notify('已整理 '+plan.total+' 项分类记录；原始资源未修改。','success');
    return true;
  },{confirmOnly:true,optionLabel:'剩余单项也各建一个文件夹',optionDefault:true,
    message:explain(true),onToggle:checked=>explain(checked)});
}
function exportGroups(){
  const data={schemaVersion:state.schemaVersion,autoGroup:state.autoGroup,resources:state.resources,version:VERSION,exportedAt:new Date().toISOString()};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  try{
    const link=document.createElement('a');link.href=url;link.download='DW2-资源分类-备份.json';
    document.body.append(link);link.click();link.remove();notify('分类设置已导出','success');
  }finally{setTimeout(()=>URL.revokeObjectURL(url),1500)}
}
function openManager(sourceId=''){
  closePopover();
  if(manager){manager.remove();manager=null}
  const source=sourceMap.get(sourceId);
  if(source){category=adapters.get(source)?.source.category||'preset';managedSourceId=sourceId}
  manager=el('div','manager-backdrop');manager.id=MANAGER_ID;
  manager.addEventListener('click',e=>{if(e.target===manager)closeManager()});
  document.body.append(manager);managerQuery='';renderManager();
}
function renderManager(){
  if(!manager)return;
  manager.replaceChildren();
  const modal=el('div','manager-panel');
  modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','DW2 资源分类管理');
  const top=el('div','manager-head');
  const title=el('div','manager-title');title.append(el('small','','S.A. · DW2'),el('h2','','资源分类'));
  const close=button('','manager-close',closeManager);close.append(icon('close'));close.setAttribute('aria-label','关闭资源分类');
  top.append(title,close);modal.append(top);
  const tabs=el('div','category-tabs');
  for(const cat of CATEGORIES){
    const tab=button(cat.label,'category-tab'+(category===cat.id?' is-active':''),()=>{category=cat.id;managedSourceId='';managerQuery='';managerInitializedSource='';renderManager()});
    tab.setAttribute('aria-pressed',String(category===cat.id));tabs.append(tab);
  }
  modal.append(tabs);
  const content=el('div','manager-content');const adapter=availableSource();
  if(!adapter){
    const hint=state.enabled
      ? '还没识别到这一类资源。先打开 TT 的对应预设、世界书或美化设置页，再返回这里即可。'
      : '原位资源分类尚未启用。开启后，在 TT 的预设、世界书或美化页面就能看到分组选择框。';
    content.append(el('p','manager-hint',hint));
    if(!state.enabled)content.append(button('启用资源分类','primary-btn',()=>{if(setEnabled(true))renderManager()}));
    modal.append(content);manager.append(modal);return;
  }
  const sourceHeading=el('div','source-heading');
  sourceHeading.append(el('span','',adapter.source.label));
  const candidates=sourcesFor(category);
  if(candidates.length>1){
    const picker=el('select','source-picker');picker.setAttribute('aria-label','选择资源来源');
    for(const source of candidates){const opt=document.createElement('option');opt.value=source.source.id;opt.textContent=source.source.label;opt.selected=source.source.id===managedSourceId;picker.append(opt)}
    picker.addEventListener('change',()=>{managedSourceId=picker.value;managerQuery='';managerInitializedSource='';renderManager()});sourceHeading.append(picker);
  }
  content.append(sourceHeading);
  const binding=linkedWorldNotice(adapter);if(binding)content.append(binding);
  const controls=el('div','manager-actions');
  controls.append(button('＋ 新建分类','primary-btn',()=>makeGroup(adapter)),button('智能整理','soft-btn',()=>smartOrganize(adapter)),button('导出备份','soft-btn',exportGroups));
  content.append(controls);
  const record=folderRecord(adapter);
  const options=sourceOptions(adapter);
  const search=el('input','manager-search');search.type='search';
  search.placeholder='搜索资源或文件夹…';search.value=managerQuery;search.autocomplete='off';
  const groups=el('div','manager-groups');
  if(managerInitializedSource!==adapter.source.id){
    managerInitializedSource=adapter.source.id;
    managerExpanded.clear();managerExpanded.add('loose');
  }
  search.addEventListener('input',()=>{managerQuery=search.value;drawManagerGroups(groups,adapter,record,options)});
  content.append(search,groups);
  drawManagerGroups(groups,adapter,record,options);
  content.append(el('p','manager-note','分类信息独立保存，不修改或删除原始预设、世界书和美化文件。'));
  modal.append(content);manager.append(modal);
}
function drawManagerGroups(list,adapter,record,options){
  const buckets=managerGroups(options,record,state.autoGroup);
  const needle=managerQuery.trim().toLocaleLowerCase();
  const previousScroll=list.parentElement?.scrollTop||0;
  list.replaceChildren();
  const unfiled=buckets.find(group=>group.key==='loose');
  const total=buckets.reduce((n,group)=>n+group.items.length,0);
  const heading=el('div','manager-summary',
    '共 '+total+' 项 · 未分类 '+(unfiled?.items.length||0)+' 项 · 点文件夹展开查看');
  list.append(heading);
  let visible=0;
  for(const group of buckets){
    const matchedName=group.name.toLocaleLowerCase().includes(needle);
    const matchedItems=needle && !matchedName
      ? group.items.filter(item=>item.label.toLocaleLowerCase().includes(needle))
      : group.items;
    if(needle&&!matchedName&&!matchedItems.length)continue;
    visible++;
    const card=el('section','manager-folder');
    card.dataset.group=group.key;
    const head=button('','manager-folder-toggle');head.dataset.group=group.key;
    const expanded=!!needle||managerExpanded.has(group.key);
    const arrow=icon('down');arrow.classList.add('dw2rl-manager-chevron');
    head.append(arrow,el('span','manager-folder-name',group.name),
      el('small','manager-folder-count',String(group.items.length)));
    head.setAttribute('aria-expanded',String(expanded));
    head.addEventListener('click',event=>{
      event.preventDefault();event.stopPropagation();
      if(managerExpanded.has(group.key))managerExpanded.delete(group.key);
      else managerExpanded.add(group.key);
      drawManagerGroups(list,adapter,record,options);
    });
    const actions=el('div','manager-folder-actions');
    if(group.kind==='manual'){
      const origin=record.groups.find(x=>'manual:'+x.id===group.key);
      if(origin){
        actions.append(button('改名','text-btn',()=>renameGroup(adapter,origin)),
          button('删除分类','text-btn',()=>removeGroup(adapter,origin)));
      }
    }else if(group.kind==='auto')actions.append(el('small','manager-auto','自动识别'));
    else actions.append(el('small','manager-auto','待整理'));
    const row=el('div','manager-folder-row');row.append(head,actions);card.append(row);
    if(expanded){
      const container=el('div','manager-folder-items');
      if(!matchedItems.length){container.append(el('p','empty','这个文件夹目前没有资源'));}
      else for(const item of matchedItems){
        const row=el('div','manager-item');
        const name=el('span','item-label',item.label);
        const placement=el('select','assign');
        placement.setAttribute('aria-label','为 '+item.label+' 选择分类');
        for(const candidate of [{id:'',name:'自动／未分类'},...record.groups]){
          const option=document.createElement('option');option.value=candidate.id;
          option.textContent=candidate.name;
          option.selected=(record.assignments[item.value]||'')===candidate.id;
          placement.append(option);
        }
        placement.addEventListener('change',()=>{
          assign(adapter,item,placement.value);
          drawManagerGroups(list,adapter,record,options);
        });
        row.append(name,placement);container.append(row);
      }
      card.append(container);
    }
    list.append(card);
  }
  if(!visible)list.append(el('p','empty','没有匹配的资源或分类'));
  if(list.parentElement)list.parentElement.scrollTop=previousScroll;
}
function mountMenu(){
  const parent=document.getElementById('extensionsMenu');
  if(!parent)return;
  let entry=document.getElementById(MENU_ID);
  if(entry?.parentElement===parent)return;
  entry?.remove();entry=el('div','magic-entry');entry.id=MENU_ID;
  entry.classList.add('extension_container','interactable');entry.role='button';entry.tabIndex=0;
  const symbol=document.createElement('i');symbol.className='fa-solid fa-folder-tree';symbol.setAttribute('aria-hidden','true');
  entry.append(symbol,el('span','','资源分类'));
  const open=e=>{e?.preventDefault();e?.stopPropagation();openManager()};
  entry.addEventListener('click',open);entry.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){open(e)}});
  parent.append(entry);
}
function syncSetting(){
  const control=document.getElementById('dw2rl-enabled');if(control)control.checked=state.enabled;
  const auto=document.getElementById('dw2rl-autogroup');if(auto)auto.checked=state.autoGroup;
}
function sortSettings(){
  const section=document.getElementById(SETTINGS_ID);
  if(!section?.isConnected)return;
  // Other DW2 extensions can mount in a different TT settings container.
  // The prior "anchor.parentElement === host" guard left this drawer at the top.
  // Follow the *actual* final sibling instead. Do not move or recreate other
  // extensions' controls, and never reorder when already adjacent.
  const anchors=['dw2-lt-settings','dw2-preset-console-settings','jd-bookshelf-settings'];
  const anchor=anchors.map(id=>document.getElementById(id))
    .find(node=>node?.isConnected && node.parentElement && !section.contains(node));
  if(anchor && anchor.nextElementSibling!==section)anchor.after(section);
}
async function checkAndUpdate(button){
  if(button.disabled)return;
  button.disabled=true;button.textContent='检查中…';
  try{
    // Follow the same TT built-in extension update API used by our other DW2 extensions.
    const [scriptMod,extensionMod]=await Promise.all([
      import('/script.js'),import('/scripts/extensions.js'),
    ]);
    const types=extensionMod.extensionTypes||{};
    const id=Object.keys(types).find(key=>
      key==='third-party/dw2-resource-library'||
      key==='dw2-resource-library'||
      key.endsWith('/dw2-resource-library'));
    if(!id)throw new Error('未识别到资源库安装目录，可在管理扩展中更新');
    if(typeof scriptMod.getRequestHeaders!=='function')
      throw new Error('当前 TT 没有提供更新验证信息');
    const response=await fetch('/api/extensions/update',{
      method:'POST',
      headers:scriptMod.getRequestHeaders(),
      body:JSON.stringify({
        extensionName:id.replace(/^third-party\//,''),
        global:types[id]==='global',
      }),
    });
    if(!response.ok){
      const reason=(await response.text()).slice(0,200);
      throw new Error(reason||'HTTP '+response.status);
    }
    const result=await response.json();
    notify(result.isUpToDate?'已经是最新版本':'资源库更新完成，请点击「刷新酒馆」使新版生效','success');
  }catch(error){
    notify('检查更新失败：'+(error?.message||error)+'。可以在管理扩展里更新。','warning');
  }finally{
    button.disabled=false;button.textContent='检查并更新';
  }
}
function refreshTavern(){
  if(window.confirm('重新加载 TT 酒馆？请先保存尚未保存的预设、世界书或美化修改。'))
    window.location.reload();
}
function mountSettings(){
  let section=document.getElementById(SETTINGS_ID);
  if(section){settingsRoot=section;syncSetting();sortSettings();return}
  const host=document.querySelector('#extensions_settings2,#extensions_settings,.extensions_settings');if(!host)return;
  section=el('div','settings inline-drawer');section.id=SETTINGS_ID;section.classList.add('inline-drawer');
  const header=el('div','settings-header inline-drawer-toggle inline-drawer-header');
  header.classList.add('inline-drawer-toggle','inline-drawer-header');
  const title=el('div','settings-title');title.append(el('b','','✧ DW2 · Resource Library'),el('small','','S.A. · DW2'));
  const arrow=document.createElement('i');arrow.className='inline-drawer-icon fa-solid fa-circle-chevron-down down';
  header.append(title,arrow);
  const body=el('div','settings-content inline-drawer-content');body.classList.add('inline-drawer-content');body.style.display='none';
  body.append(el('p','version','预设 · 世界书（角色卡） · 美化  |  '+VERSION));
  const toggle=el('label','toggle-row');const check=el('input');check.type='checkbox';check.id='dw2rl-enabled';check.checked=state.enabled;
  check.addEventListener('change',()=>setEnabled(check.checked));toggle.append(check,el('span','','启用原位分组选择'));body.append(toggle);
  const autoRow=el('label','toggle-row');const autoCheck=el('input');autoCheck.type='checkbox';autoCheck.id='dw2rl-autogroup';autoCheck.checked=state.autoGroup;
  autoCheck.addEventListener('change',()=>{state.autoGroup=autoCheck.checked;saveData();if(popover){const adapter=sourceMap.get(popover.dataset.source);if(adapter)drawPopover(adapters.get(adapter))}});
  autoRow.append(autoCheck,el('span','','自动识别【名称】分组'));body.append(autoRow);
  const actions=el('div','settings-actions');
  const updateButton=button('检查并更新','soft-btn');updateButton.addEventListener('click',()=>void checkAndUpdate(updateButton));
  actions.append(
    button('打开资源整理','soft-btn',()=>openManager()),
    button('重新识别','soft-btn',()=>{scan();mountMenu();notify('已经重新识别当前页面的选择框','success')}),
    updateButton,
    button('刷新酒馆','soft-btn',refreshTavern),
  );
  body.append(actions,el('p','settings-tip','全局世界书使用 TT 原生选择框；角色卡世界书、预设和美化可独立分组。关闭开关后恢复原生选择框。'));
  header.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();const visible=body.style.display==='none';body.style.display=visible?'block':'none';header.setAttribute('aria-expanded',String(visible));arrow.classList.toggle('down',!visible)});
  section.append(header,body);host.append(section);settingsRoot=section;settingsReady=true;sortSettings();
}
function documentClick(e){
  if(popover && !popover.contains(e.target) && !e.target.closest('.dw2rl-native-trigger'))closePopover();
  if(e.target.closest('#extensions_settings,#extensions_settings2,#ai-config-button,#user-settings-button,#WI-SP-button,#extensionsMenuButton,#themes'))scheduleScan();
}
function documentKeydown(e){if(e.key==='Escape'){if(manager)closeManager();else closePopover()}}
function onViewportChange(){
  if(!popover)return;
  const select=sourceMap.get(popover.dataset.source);
  const adapter=adapters.get(select);
  if(!adapter){closePopover();return}
  positionPopover(adapter.trigger);
}
function onDOMChange(records){
  let shouldMount=false,shouldScan=false;
  for(const record of records){
    for(const node of record.addedNodes){
      if(node.nodeType!==1)continue;
      // Ignore ordinary chat messages; watch only relevant TT settings/selectors.
      if(node.matches?.(SELECTORS) || node.querySelector?.(SELECTORS))shouldScan=true;
      if(node.matches?.('#srg-root,#srg-settings,.srg-select-shell') || node.querySelector?.('#srg-root,#srg-settings,.srg-select-shell'))shouldScan=true;
      if(node.matches?.('#extensionsMenu,#extensions_settings2,#extensions_settings,#dw2-lt-settings,#dw2-preset-console-settings,#jd-bookshelf-settings')
        ||node.querySelector?.('#extensionsMenu,#extensions_settings2,#extensions_settings,#dw2-lt-settings,#dw2-preset-console-settings,#jd-bookshelf-settings'))
        shouldMount=true;
    }
    if(shouldMount&&shouldScan)break;
  }
  if(shouldScan)scheduleScan();
  if(shouldMount)queueMicrotask(()=>{if(alive){mountMenu();mountSettings()}});
}
function start(){
  if(alive)return;
  alive=true;loadData();mergeWorldBookFolders();
  mountSettings();mountMenu();
  document.addEventListener('click',documentClick,true);listeners.push(()=>document.removeEventListener('click',documentClick,true));
  document.addEventListener('keydown',documentKeydown,true);listeners.push(()=>document.removeEventListener('keydown',documentKeydown,true));
  window.addEventListener('resize',onViewportChange,{passive:true});listeners.push(()=>window.removeEventListener('resize',onViewportChange));
  // Subtree scrolls in TT settings should keep the popup beside its selector.
  document.addEventListener('scroll',onViewportChange,{passive:true,capture:true});listeners.push(()=>document.removeEventListener('scroll',onViewportChange,true));
  window.visualViewport?.addEventListener('resize',onViewportChange,{passive:true});
  listeners.push(()=>window.visualViewport?.removeEventListener('resize',onViewportChange));
  watcher=new MutationObserver(onDOMChange);watcher.observe(document.body,{childList:true,subtree:true});
  if(state.enabled)scan();
  // Some TT pages construct select widgets after initial DOM load.
  delayedTimer=setTimeout(()=>{delayedTimer=0;if(alive){mountSettings();mountMenu();if(state.enabled)scan()}},1200);
  globalThis.DW2ResourceLibrary={open:openManager,enable:()=>setEnabled(true),disable:()=>setEnabled(false),version:VERSION};
}
export function onEnable(){
  if(startPromise)return startPromise;
  startPromise=Promise.resolve().then(()=>{
    if(document.readyState==='loading'){
      document.addEventListener('DOMContentLoaded',start,{once:true});
      listeners.push(()=>document.removeEventListener('DOMContentLoaded',start));
    }else start();
  });
  return startPromise;
}
export function onDisable(){
  if(!alive && !startPromise)return;
  alive=false;
  if(scanTimer)clearTimeout(scanTimer);scanTimer=0;
  if(delayedTimer)clearTimeout(delayedTimer);delayedTimer=0;
  watcher?.disconnect();watcher=null;
  for(const off of listeners.splice(0))off();
  deactivateSelectors();closeManager();
  document.getElementById(MENU_ID)?.remove();
  document.getElementById(SETTINGS_ID)?.remove();settingsRoot=null;settingsReady=false;
  if(globalThis.DW2ResourceLibrary?.version===VERSION)delete globalThis.DW2ResourceLibrary;
  startPromise=null;
}
if(globalThis.SillyTavern?.getContext)onEnable();
else if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',onEnable,{once:true});
else onEnable();
