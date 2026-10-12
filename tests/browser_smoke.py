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
    page.add_script_tag(content=core+'\n'+app)
    assert page.evaluate('typeof DW2ResourceLibrary')=='object'
    assert page.locator('select.dw2rl-native-hidden').count()==0
    page.locator('#enable').click();page.wait_for_timeout(250)
    assert page.locator('.dw2rl-native-trigger').count()==4
    assert page.locator('select.dw2rl-native-hidden').count()==4
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
    # Multiple world-book toggle uses actual original select.
    page.locator('.dw2rl-native-trigger').nth(2).click()
    page.locator('#dw2rl-popover .dw2rl-group-head').filter(has_text='古风').click()
    page.locator('#dw2rl-popover .dw2rl-option').filter(has_text='【古风】大周世界').click()
    assert page.locator('#world_info').evaluate('(node)=>node.options[0].selected')
    page.locator('#dw2rl-popover .dw2rl-icon-button').click()
    # Central manager: three categories, new folder, assignment and persistence.
    page.locator('#open').click()
    assert page.locator('.dw2rl-category-tab').all_text_contents()==['预设','世界书','美化']
    page.locator('#dw2rl-manager .dw2rl-primary-btn').first.click()
    page.locator('.dw2rl-name-input').fill('我的精选')
    page.locator('.dw2rl-confirm-dialog .dw2rl-primary-btn').click()
    assert page.locator('.dw2rl-group-text').all_text_contents()==['我的精选']
    manager_panel=page.locator('#dw2rl-manager .dw2rl-manager-panel')
    assert manager_panel.evaluate('el => parseFloat(getComputedStyle(el).backgroundImage.match(/0[.]9[0-9]/)[0])') >= .90
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
    groups_after=page.locator('.dw2rl-group-text').all_text_contents()
    assert '我的精选' in groups_after and '小冰块' in groups_after and '经典' in groups_after
    assert page.evaluate("window.stCtx.extensionSettings.dw2ResourceLibrary.resources['preset:openai'].assignments.w659")
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
    assert page.locator('.dw2rl-native-trigger').count()==4
    page.locator('.dw2rl-native-trigger').nth(1).click()
    assert page.locator('#dw2rl-popover .dw2rl-group').count()==3
    page.screenshot(path='/mnt/data/DW2-Resource-Library-dropdown.png')
    assert not errors, errors
    print('PASS | Chromium 390×844: 4 source selectors, native preset and world-book changes, auto-group search, manager persistence, disable restore, conflict guard; no JS exceptions')
    browser.close()
