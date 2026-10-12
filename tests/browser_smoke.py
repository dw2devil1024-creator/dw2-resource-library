"""Optional GUI regression smoke test. Requires Playwright + a local Chromium.
Uses page.set_content: no TT server, no website, no network requests.
"""
import re
from pathlib import Path
from playwright.sync_api import sync_playwright
BASE=Path(__file__).resolve().parent.parent
html=(BASE/'tests/demo.html').read_text()
css=re.sub(r'@import url\([^;]+;', '',(BASE/'style.css').read_text())
html=html.replace('<link rel="stylesheet" href="../style.css">','<style>'+css+'</style>')
html=html.replace('<script type="module" src="../index.js"></script>','')
core=re.sub(r'\bexport (?=(?:const|function)\b)','',(BASE/'resource-core.js').read_text())
app=re.sub(r"import\s*\{[\s\S]*?\}\s*from\s*'\./resource-core\.js';",'',(BASE/'index.js').read_text(),count=1)
app=re.sub(r'\bexport (?=(?:const|function)\b)','',app)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-gpu'])
    page=browser.new_page(viewport={'width':390,'height':844},device_scale_factor=1)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html)
    # All DW2 group controls are mounted independently of TT's global
    # world-book multi-select. No Select2 mocking is needed.
    page.add_script_tag(content=core+'\n'+app)
    assert page.evaluate('typeof DW2ResourceLibrary')=='object'
    assert page.locator('select.dw2rl-native-hidden').count()==0
    page.locator('#enable').click();page.wait_for_timeout(250)
    assert page.locator('.dw2rl-native-trigger').count()==3
    assert page.locator('select.dw2rl-native-hidden').count()==3
    # Both new settings actions are present and the settings panel follows
    # Little Things even when that extension mounts later.
    assert page.locator('#dw2rl-settings .dw2rl-settings-actions button').all_text_contents()==[
      '打开资源整理','重新识别','检查并更新','刷新酒馆'
    ]
    # Settings typography and four side-by-side actions match other DW2 drawers.
    layout=page.locator('#dw2rl-settings').evaluate("""root=>{
      const actions=root.querySelector('.dw2rl-settings-actions');
      const buttons=[...actions.children];
      const title=root.querySelector('.dw2rl-settings-title>b');
      const byline=root.querySelector('.dw2rl-settings-title>small');
      const style=getComputedStyle(actions);
      const rects=buttons.map(b=>b.getBoundingClientRect());
      return {columns:style.gridTemplateColumns.split(' ').length,
        tops:rects.map(r=>Math.round(r.top)),
        widths:rects.map(r=>r.width),heading:getComputedStyle(title).fontFamily,
        byline:getComputedStyle(byline).fontFamily};
    }""")
    assert layout['columns']==4 and len(set(layout['tops']))==1,layout
    assert min(layout['widths'])>50,layout
    assert 'Noto Serif SC' in layout['heading'] and 'Playfair Display' in layout['byline'],layout
    page.evaluate("""() => {
      const host=document.getElementById('extensions_settings2');
      const shelf=document.createElement('div');shelf.id='jd-bookshelf-settings';
      const preset=document.createElement('div');preset.id='dw2-preset-console-settings';
      const little=document.createElement('div');little.id='dw2-lt-settings';
      host.append(shelf,preset,little);
    }""")
    page.wait_for_timeout(120)
    assert page.locator('#dw2rl-settings').evaluate(
      '(node)=>node.previousElementSibling?.id==="dw2-lt-settings"'
    )
    # TT may put early-loaded Resource Library in #extensions_settings2 while
    # later DW2 extensions mount in a separate #extensions_settings subtree.
    # The old parent-equality guard silently prevented the reorder.
    page.evaluate("""() => {
      const other=document.createElement('div');other.id='extensions_settings';
      document.body.append(other);
      for(const id of ['jd-bookshelf-settings','dw2-preset-console-settings','dw2-lt-settings'])
        other.append(document.getElementById(id));
    }""")
    page.wait_for_timeout(200)
    assert page.locator('#dw2rl-settings').evaluate(
      '(node)=>node.parentElement?.id==="extensions_settings" && node.previousElementSibling?.id==="dw2-lt-settings"'
    )
    # Confirm moving the entire drawer retains existing button handlers.
    page.locator('#dw2rl-settings .dw2rl-settings-header').click()
    assert page.locator('#dw2rl-settings .dw2rl-settings-content').is_visible()
    page.locator('#dw2rl-settings .dw2rl-settings-header').click()
    # TT often closes its native settings drawer on document-level outside clicks.
    # The body's portalled group dropdown must *not* bubble those clicks.
    page.evaluate("""() => {window.ttOutsideClicks=0;window.ttOutsidePointers=0;
      document.addEventListener('click', e => {
        if(e.target.closest('#dw2rl-popover'))window.ttOutsideClicks++;
      });
      document.addEventListener('pointerdown',e => {
        if(e.target.closest('#dw2rl-popover'))window.ttOutsidePointers++;
      });
    }""")
    # Presets: auto group, native selection, and stored current name.
    page.locator('.dw2rl-native-trigger').first.click()
    assert page.locator('#dw2rl-popover .dw2rl-group').count()==3
    page.locator('#dw2rl-popover .dw2rl-group-head').filter(has_text='小冰块').click()
    assert page.evaluate('window.ttOutsideClicks===0 && window.ttOutsidePointers===0')
    assert page.locator('#dw2rl-popover').is_visible()
    assert page.locator('#dw2rl-popover .dw2rl-option').count()>=2
    page.locator('#dw2rl-popover .dw2rl-option').filter(has_text='【小冰块】小说').click()
    assert page.locator('#mock-presets').input_value()=='ice2'
    assert page.evaluate('window.changed.at(-1)[1]')=='ice2'
    # The global multi-select is never decorated or hidden by Resource Library.
    assert page.locator('#world_info').evaluate('(n)=>!n.classList.contains("dw2rl-native-hidden")')
    assert page.locator('#dw2rl-global-groups').count()==0
    assert page.locator('.dw2rl-native-trigger').count()==3
    assert page.locator('#world_info').evaluate('(n)=>n.multiple && n.options.length==4')
    # World editor still has the read-only character association.
    page.locator('.dw2rl-native-trigger').nth(2).click()
    assert page.locator('#dw2rl-popover .dw2rl-world-bound-name').inner_text()=='京市'
    assert '不代表全局启用' not in page.locator('#dw2rl-popover .dw2rl-world-bound-note').inner_text()
    assert page.locator('#dw2rl-popover .dw2rl-bound-marker').count()==1
    assert page.locator('#world_editor_select').input_value()=='a'
    page.locator('#dw2rl-popover .dw2rl-icon-button').click()
    # Central manager: three categories, new folder, assignment and persistence.
    page.locator('#open').click()
    assert page.locator('.dw2rl-category-tab').all_text_contents()==['预设','世界书','美化']
    page.locator('#dw2rl-manager .dw2rl-primary-btn').first.click()
    page.locator('.dw2rl-name-input').fill('我的精选')
    page.locator('.dw2rl-confirm-dialog .dw2rl-primary-btn').click()
    names=page.locator('.dw2rl-manager-folder-name').all_text_contents()
    assert names==['我的精选','小冰块','经典','未分类'],names
    assert page.locator('.dw2rl-manager-folder[data-group="loose"] .dw2rl-manager-folder-count').inner_text()=='1'
    manual=page.locator('.dw2rl-manager-folder-toggle').filter(has_text='我的精选')
    assert manual.get_attribute('aria-expanded')=='false'
    manual.click()
    assert manual.get_attribute('aria-expanded')=='true'
    manual.click()
    assert manual.get_attribute('aria-expanded')=='false'
    # Unclassified is visible by default, and every resource can be moved from it.
    assert page.locator('.dw2rl-manager-folder[data-group="loose"] .dw2rl-assign').count()==1
    manager_panel=page.locator('#dw2rl-manager .dw2rl-manager-panel')
    glass=manager_panel.evaluate("""el=>{
      const style=getComputedStyle(el);
      return {background:style.backgroundImage,backdrop:style.backdropFilter||style.webkitBackdropFilter};
    }""")
    tint=re.findall(r'rgba\((\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\)',glass['background'])
    assert len(tint)>=3 and .96<=max(float(alpha) for _,_,_,alpha in tint)<=.98,glass
    assert all(int(red)>=int(blue) for red,green,blue,alpha in tint),glass
    assert 'blur(20px)' in glass['backdrop'],glass
    # Preset Console-inspired frame: an inset tab rail rather than a pill.
    frame=manager_panel.evaluate("""el=>{
      const panel=getComputedStyle(el);
      const tabs=getComputedStyle(el.querySelector('.dw2rl-category-tabs'));
      const folder=getComputedStyle(el.querySelector('.dw2rl-manager-folder'));
      return {radius:panel.borderTopLeftRadius,
              tabsBottom:tabs.borderBottomWidth,tabsMargin:tabs.marginLeft,
              folderRadius:folder.borderTopLeftRadius};
    }""")
    assert frame['radius']=='7px' and frame['tabsBottom']=='1px',frame
    assert frame['tabsMargin']=='0px' and frame['folderRadius']=='6px',frame
    page.locator('.dw2rl-assign').first.select_option(label='我的精选')
    saved=page.evaluate('window.stCtx.extensionSettings.dw2ResourceLibrary')
    assert saved['resources']['preset:openai']['groups'][0]['name']=='我的精选'
    assert saved['resources']['preset:openai']['assignments']['w659']
    # Preview and confirm intelligent grouping without touching existing manual slots.
    page.locator('#dw2rl-manager .dw2rl-manager-actions button').filter(has_text='智能整理').click()
    assert '确认' in page.locator('.dw2rl-confirm-dialog').inner_text()
    assert '小冰块' in page.locator('.dw2rl-dialog-message').inner_text()
    assert page.evaluate("window.stCtx.extensionSettings.dw2ResourceLibrary.resources['preset:openai'].groups.length") == 1
    page.locator('.dw2rl-confirm-dialog .dw2rl-soft-btn').click()
    assert page.evaluate("window.stCtx.extensionSettings.dw2ResourceLibrary.resources['preset:openai'].groups.length") == 1
    page.locator('#dw2rl-manager .dw2rl-manager-actions button').filter(has_text='智能整理').click()
    page.locator('.dw2rl-confirm-dialog .dw2rl-primary-btn').click()
    groups_after=page.locator('.dw2rl-manager-folder-name').all_text_contents()
    assert '我的精选' in groups_after and '小冰块' in groups_after and '经典' in groups_after
    assert groups_after[-1]=='未分类'
    assert page.locator('.dw2rl-manager-folder[data-group="loose"] .dw2rl-manager-folder-count').inner_text()=='0'
    # Click a newly saved folder, inspect its files, and close it again.
    ice=page.locator('.dw2rl-manager-folder-toggle').filter(has_text='小冰块')
    ice.click()
    assert page.locator('.dw2rl-manager-folder').filter(has_text='小冰块').locator('.dw2rl-manager-item').count()==3
    ice.click()
    assert page.locator('.dw2rl-manager-folder').filter(has_text='小冰块').locator('.dw2rl-manager-item').count()==0
    assert page.evaluate("window.stCtx.extensionSettings.dw2ResourceLibrary.resources['preset:openai'].assignments.w659")
    # World-book mode offers one-book folders only after explicit confirmation.
    page.locator('#dw2rl-manager .dw2rl-category-tab').filter(has_text='世界书').click()
    page.locator('#dw2rl-manager .dw2rl-source-picker').select_option('world:editor')
    assert page.locator('#dw2rl-manager .dw2rl-world-bound-name').inner_text()=='京市'
    assert page.locator('#dw2rl-manager .dw2rl-manager-folder-name').all_text_contents()==['未分类']
    page.locator('#dw2rl-manager .dw2rl-manager-actions button').filter(has_text='智能整理').click()
    assert '单项文件夹' in page.locator('.dw2rl-dialog-message').inner_text()
    assert page.locator('.dw2rl-dialog-choice input').is_checked()
    assert page.evaluate("window.stCtx.extensionSettings.dw2ResourceLibrary.resources['world:editor'].groups.length")==0
    page.locator('.dw2rl-confirm-dialog .dw2rl-primary-btn').click()
    assert page.locator('#dw2rl-manager .dw2rl-manager-folder-name').all_text_contents()==['大周世界','京市','未分类']
    assert page.evaluate("window.stCtx.extensionSettings.dw2ResourceLibrary.resources['world:editor'].groups.length")==2
    assert page.evaluate("window.stCtx.characters[0].data.extensions.world")=='京市'
    assert page.locator('#world_info').evaluate('(node)=>node.options[0].selected')
    # Editor folders survive; they never alter TT's global world selector.
    assert page.locator('#dw2rl-global-groups').count()==0
    assert page.locator('#world_info').evaluate('(n)=>!n.classList.contains("dw2rl-native-hidden")')
    assert page.evaluate("window.stCtx.extensionSettings.dw2ResourceLibrary.resources['world:editor'].groups.length")==2
    # World-book assignments must remain attached to filenames, not TT's
    # mutable select indices. Simulate deleting/renumbering two world files.
    saved_world=page.evaluate(
      "window.stCtx.extensionSettings.dw2ResourceLibrary.resources['world:editor'].assignments"
    )
    assert saved_world and all(name.startswith('worldbook:') for name in saved_world),saved_world
    page.evaluate("""() => {
      const select=document.querySelector('#world_editor_select');
      select.replaceChildren(new Option('京市','0'),new Option('大周世界','1'));
      select.dispatchEvent(new Event('change',{bubbles:true}));
    }""")
    page.wait_for_timeout(180)
    page.locator('#dw2rl-manager .dw2rl-category-tab').filter(has_text='预设').click()
    page.locator('#dw2rl-manager .dw2rl-category-tab').filter(has_text='世界书').click()
    assert page.locator('#dw2rl-manager .dw2rl-manager-folder-name').all_text_contents()==[
      '大周世界','京市','未分类'
    ]
    for folder_name in ('京市','大周世界'):
      folder=page.locator('#dw2rl-manager .dw2rl-manager-folder').filter(has_text=folder_name)
      folder.locator('.dw2rl-manager-folder-toggle').click()
      assert folder.locator('.dw2rl-manager-item').count()==1
    # Remove one book: remaining folder keeps its member despite index 1 -> 0.
    page.evaluate("""() => {
      const select=document.querySelector('#world_editor_select');
      select.replaceChildren(new Option('大周世界','0'));
      select.dispatchEvent(new Event('change',{bubbles:true}));
    }""")
    page.wait_for_timeout(180)
    page.locator('#dw2rl-manager .dw2rl-category-tab').filter(has_text='预设').click()
    page.locator('#dw2rl-manager .dw2rl-category-tab').filter(has_text='世界书').click()
    remaining=page.locator('#dw2rl-manager .dw2rl-manager-folder').filter(has_text='大周世界')
    remaining.locator('.dw2rl-manager-folder-toggle').click()
    assert remaining.locator('.dw2rl-manager-item').count()==1
    assert remaining.locator('.dw2rl-manager-item .dw2rl-item-label').inner_text()=='大周世界'
    assert page.evaluate("window.stCtx.extensionSettings.dw2ResourceLibrary.resources['world:editor'].assignments['worldbook:大周世界']")
    # Themes/presets offer safe, confirm-only singleton grouping choices.
    page.locator('#dw2rl-manager .dw2rl-category-tab').filter(has_text='美化').click()
    page.locator('#dw2rl-manager .dw2rl-manager-actions button').filter(has_text='智能整理').click()
    assert page.locator('.dw2rl-dialog-choice input').is_checked()
    assert '单项文件夹' in page.locator('.dw2rl-dialog-message').inner_text()
    page.locator('.dw2rl-dialog-choice input').uncheck()
    assert '单项文件夹 0 个' in page.locator('.dw2rl-dialog-message').inner_text()
    page.locator('.dw2rl-dialog-choice input').check()
    assert '单项文件夹 1 个' in page.locator('.dw2rl-dialog-message').inner_text()
    page.locator('.dw2rl-confirm-dialog .dw2rl-primary-btn').click()
    assert '纯透伦敦（杂志）' in page.locator('#dw2rl-manager .dw2rl-manager-folder-name').all_text_contents()
    page.screenshot(path='/mnt/data/DW2-Resource-Library-preview.png')
    page.locator('#dw2rl-manager .dw2rl-manager-close').click()
    page.locator('#disable').click()
    assert page.locator('select.dw2rl-native-hidden').count()==0
    assert page.locator('.dw2rl-native-trigger').count()==0
    # Enabling with foreign grouping root is blocked, leaving native selects intact.
    page.evaluate("document.body.insertAdjacentHTML('beforeend','<div id=\"srg-root\"></div>')")
    page.locator('#enable').click()
    assert page.locator('.dw2rl-native-trigger').count()==0
    assert page.evaluate('window.stCtx.extensionSettings.dw2ResourceLibrary.enabled') is False
    page.locator('#srg-root').evaluate('(node)=>node.remove()')
    page.locator('#enable').click()
    assert page.locator('.dw2rl-native-trigger').count()==3
    page.locator('.dw2rl-native-trigger').nth(1).click()
    assert page.locator('#dw2rl-popover .dw2rl-group').count()==3
    page.screenshot(path='/mnt/data/DW2-Resource-Library-dropdown.png')
    assert not errors, errors
    # Mobile touch regression: simulates TT's unpinned drawer being dismissed by a
    # bubbled html touchstart/mousedown, and tests tapping a folder under it.
    touch_context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=2)
    mobile=touch_context.new_page()
    touch_errors=[]
    mobile.on('pageerror',lambda e:touch_errors.append(str(e)))
    mobile.set_content(html);mobile.add_script_tag(content=core+'\n'+app)
    mobile.evaluate('''() => {
      window.outsideTouch=0;window.outsideMouse=0;window.outsidePointer=0;
      const track=name=>event=>{
        if(event.target.closest?.('#dw2rl-popover'))window[name]++;
      };
      document.documentElement.addEventListener('touchstart',track('outsideTouch'));
      document.documentElement.addEventListener('mousedown',track('outsideMouse'));
      document.documentElement.addEventListener('pointermove',track('outsidePointer'));
    }''')
    mobile.locator('#enable').tap()
    mobile.locator('.dw2rl-native-trigger').first.tap()
    assert mobile.locator('#dw2rl-popover').is_visible()
    # Initially selected unclassified; tapping other folders should open them.
    mobile.locator('#dw2rl-popover .dw2rl-group-head').filter(has_text='小冰块').tap()
    assert mobile.locator('#dw2rl-popover .dw2rl-group-head').filter(has_text='小冰块').get_attribute('aria-expanded')=='true'
    assert mobile.locator('#dw2rl-popover .dw2rl-option').count()==3
    mobile.locator('#dw2rl-popover .dw2rl-group-head').filter(has_text='小冰块').tap()
    assert mobile.locator('#dw2rl-popover .dw2rl-option').count()==0
    mobile.locator('#dw2rl-popover .dw2rl-group-head').filter(has_text='小冰块').tap()
    mobile.locator('#dw2rl-popover .dw2rl-option').filter(has_text='【小冰块】小说').tap()
    assert mobile.locator('#mock-presets').input_value()=='ice2'
    assert mobile.evaluate('window.outsideTouch===0 && window.outsideMouse===0 && window.outsidePointer===0')
    # Mobile: global world books remain TT-native regardless of Select2.
    assert mobile.locator('.dw2rl-native-trigger').count()==3
    assert mobile.locator('#world_info').evaluate('(node)=>!node.classList.contains("dw2rl-native-hidden")')
    assert mobile.locator('#dw2rl-global-groups').count()==0
    mobile.locator('#disable').tap()
    assert mobile.locator('#world_info').evaluate('(node)=>!node.classList.contains("dw2rl-native-hidden")')
    assert mobile.locator('.dw2rl-native-trigger').count()==0
    assert not touch_errors,touch_errors
    touch_context.close()
    print('PASS | Chromium 390×844: TT native global-world selector retained, DW2 folders, iOS touch and restoration')
    # Reload regression: a deleted editor folder must NOT be revived from
    # the retired global-world category saved by older TT plugin versions.
    regression=browser.new_page(viewport={'width':390,'height':844})
    regression.set_content(html)
    regression.add_script_tag(content=core+'\n'+app)
    regression.locator('#enable').click()
    regression.wait_for_timeout(220)
    regression.evaluate("""() => {
      const saved=window.stCtx.extensionSettings.dw2ResourceLibrary;
      saved.resources['world:global']={
        groups:[{id:'ghost',name:'大周世界'}],
        assignments:{'worldbook:大周世界':'ghost'},
      };
      saved.legacyWorldMergeDone=false; // existing pre-patch user data
      window.DW2ResourceLibrary.open('world:editor');
    }""")
    regression.locator('#dw2rl-manager .dw2rl-manager-actions button').filter(has_text='新建分类').click()
    regression.locator('.dw2rl-confirm-dialog .dw2rl-name-input').fill('大周世界')
    regression.locator('.dw2rl-confirm-dialog .dw2rl-primary-btn').click()
    regression.locator('.dw2rl-manager-folder[data-group="loose"] .dw2rl-manager-item').filter(
      has_text='大周世界').locator('.dw2rl-assign').select_option(label='大周世界')
    group=regression.locator('.dw2rl-manager-folder[data-group^="manual:"]').filter(has_text='大周世界')
    group.locator('.dw2rl-text-btn').filter(has_text='删除分类').click()
    regression.locator('.dw2rl-confirm-dialog .dw2rl-primary-btn').click()
    assert '大周世界' not in regression.locator('.dw2rl-manager-folder-name').all_text_contents()
    assert regression.evaluate(
      "window.stCtx.extensionSettings.dw2ResourceLibrary.resources['world:editor'].suppressedAutoGroups.includes('大周世界')")
    regression.evaluate("""async () => {onDisable();await onEnable();}""")
    regression.wait_for_function("() => !!window.DW2ResourceLibrary")
    regression.evaluate("window.DW2ResourceLibrary.open('world:editor')")
    assert '大周世界' not in regression.locator('.dw2rl-manager-folder-name').all_text_contents()
    assert regression.evaluate(
      "window.stCtx.extensionSettings.dw2ResourceLibrary.resources['world:global'].groups[0].name==='大周世界'")
    assert regression.evaluate(
      "window.stCtx.extensionSettings.dw2ResourceLibrary.legacyWorldMergeDone===true")
    regression.locator('#dw2rl-manager .dw2rl-manager-close').click()
    regression.close()

    # A deleted manual folder cannot turn into an automatic 【name】 group.
    inferred=browser.new_page(viewport={'width':390,'height':844})
    inferred.set_content(html)
    inferred.add_script_tag(content=core+'\n'+app)
    inferred.locator('#enable').click()
    inferred.wait_for_timeout(220)
    inferred.evaluate("window.DW2ResourceLibrary.open()")
    inferred.locator('#dw2rl-manager .dw2rl-manager-actions button').filter(has_text='新建分类').click()
    inferred.locator('.dw2rl-confirm-dialog .dw2rl-name-input').fill('小冰块')
    inferred.locator('.dw2rl-confirm-dialog .dw2rl-primary-btn').click()
    inferred.locator('.dw2rl-manager-folder[data-group^="manual:"]').filter(
      has_text='小冰块').locator('.dw2rl-text-btn').filter(has_text='删除分类').click()
    inferred.locator('.dw2rl-confirm-dialog .dw2rl-primary-btn').click()
    assert '小冰块' not in inferred.locator('.dw2rl-manager-folder-name').all_text_contents()
    inferred.evaluate("""async () => {onDisable();await onEnable();}""")
    inferred.wait_for_function("() => !!window.DW2ResourceLibrary")
    inferred.evaluate("window.DW2ResourceLibrary.open()")
    assert '小冰块' not in inferred.locator('.dw2rl-manager-folder-name').all_text_contents()
    inferred.locator('#dw2rl-manager .dw2rl-manager-actions button').filter(has_text='智能整理').click()
    assert '小冰块' not in inferred.locator('.dw2rl-dialog-message').inner_text()
    inferred.locator('.dw2rl-dialog-actions .dw2rl-soft-btn').click()
    inferred.close()
    print('PASS | Restart regression: deleted world and inferred preset folders stay deleted')
    browser.close()
