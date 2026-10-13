/**
 * DW2 Resource Library: only hide presentation of native TT parameter regions.
 * Covers #range_block_openai plus #openai_settings settings through Logit Bias.
 * Never hides the prompt manager or detaches native input/list nodes.
 */
const BLOCK_ID='range_block_openai';
const BUTTON_ID='dw2rl-parameter-fold';
const FOLD_CLASS='dw2rl-parameter-collapsed';
const EXTRA_CLASS='dw2rl-fold-secondary-parameters';
export function createPresetParameterFold(){
  let enabled=false,collapsed=false,button=null,root=null;
  const extra=new Set();
  function clearExtra(){
    for(const node of extra)node.classList.remove(EXTRA_CLASS);
    extra.clear();
  }
  function restore(){
    if(root){root.classList.remove(FOLD_CLASS);root.removeAttribute('data-dw2rl-folded');}
    clearExtra();
    button?.remove();button=null;root=null;
  }
  function secondaryNodes(){
    const settings=document.getElementById('openai_settings');
    const prompt=settings?.querySelector('#completion_prompt_manager');
    if(!prompt)return [];
    // Only siblings of the prompt manager's containing range-block,
    // not the prompt manager itself or any of its descendants.
    let promptContainer=prompt;
    while(promptContainer.parentElement && promptContainer.parentElement!==settings){
      const parent=promptContainer.parentElement;
      if(parent.parentElement===settings)break;
      promptContainer=parent;
    }
    const parent=promptContainer.parentElement;
    if(!parent || !settings.contains(parent))return [];
    // Once we've reached the immediate child wrapper under #openai_settings,
    // walk its direct children, ending strictly before the prompt container.
    const actualPromptWrapper=prompt.closest('.range-block');
    if(!actualPromptWrapper || actualPromptWrapper.parentElement!==parent)return [];
    return [...parent.children].filter(el=>el!==actualPromptWrapper && !el.contains(actualPromptWrapper));
  }
  function sync(){
    const block=document.getElementById(BLOCK_ID);
    if(!enabled||!block){restore();return;}
    if(root && root!==block)restore();
    root=block;
    if(!button||!button.isConnected||button.nextElementSibling!==block){
      button?.remove();
      button=document.createElement('button');
      button.type='button';button.id=BUTTON_ID;
      button.className='dw2rl-parameter-fold-button';
      button.setAttribute('aria-controls',BLOCK_ID);
      button.addEventListener('click',()=>{collapsed=!collapsed;sync();});
      block.parentNode.insertBefore(button,block);
    }
    button.setAttribute('aria-expanded',String(!collapsed));
    button.textContent=(collapsed?'▸':'▾')+' 高级参数设置';
    root.classList.toggle(FOLD_CLASS,collapsed);
    root.dataset.dw2rlFolded=String(collapsed);
    clearExtra();
    if(collapsed){
      for(const node of secondaryNodes()){
        node.classList.add(EXTRA_CLASS);extra.add(node);
      }
    }
  }
  return {
    configure(active){enabled=!!active;if(!enabled)restore();else sync();},
    sync,
    disable(){enabled=false;restore();}
  };
}
