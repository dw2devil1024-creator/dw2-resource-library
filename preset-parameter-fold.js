/**
 * DW2 Resource Library: presentation-only toggle for TT chat-completion
 * parameter block (#range_block_openai). Never moves or edits any controls.
 */
const BLOCK_ID='range_block_openai';
const BUTTON_ID='dw2rl-parameter-fold';
export function createPresetParameterFold(){
  let enabled=false,collapsed=false,button=null,root=null;
  function restore(){
    if(root){root.classList.remove('dw2rl-parameter-collapsed');root.removeAttribute('data-dw2rl-folded');}
    button?.remove();button=null;root=null;
  }
  function sync(){
    const block=document.getElementById(BLOCK_ID);
    if(!enabled||!block){restore();return;}
    if(root && root!==block)restore();
    root=block;
    if(!button || !button.isConnected || button.nextElementSibling!==block){
      button?.remove();
      button=document.createElement('button');
      button.type='button';button.id=BUTTON_ID;
      button.className='dw2rl-parameter-fold-button';
      button.setAttribute('aria-controls',BLOCK_ID);
      button.addEventListener('click',()=>{
        collapsed=!collapsed;
        sync();
      });
      block.parentNode.insertBefore(button,block);
    }
    button.setAttribute('aria-expanded',String(!collapsed));
    button.textContent=(collapsed?'▸':'▾')+' 高级参数设置';
    root.classList.toggle('dw2rl-parameter-collapsed',collapsed);
    root.dataset.dw2rlFolded=String(collapsed);
  }
  return {
    configure(active){enabled=!!active;if(!enabled)restore();else sync();},
    sync,
    disable(){enabled=false;restore();}
  };
}
