const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync('js/reader.js', 'utf8')

function element() {
  return {hidden: true, disabled: false, textContent: '', attrs: {},
    classList: {toggle() {}},
    setAttribute(name, value) {this.attrs[name] = value},
    focus() {this.focused = true},
  }
}
function fixture() {
  const shadow = {activeElement: null}
  const presets = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3].map(rate => ({...element(), dataset: {rate: String(rate)}}))
  const speed = element(), menu = {...element(), innerHTML: '', listeners: {},
    addEventListener(type, listener) {this.listeners[type] = listener}, querySelectorAll: () => presets,
    querySelector: selector => selector === '[aria-pressed="true"]'
      ? presets.find(b => b.attrs['aria-pressed'] === 'true') : presets[0],
  }
  const calls = [], errors = [], documentListeners = {}, windowListeners = {}, rootListeners = {}
  const host = {}
  const document = {activeElement: host, addEventListener(type, listener) {documentListeners[type] = listener}}
  const context = vm.createContext({
    document, host, window: {addEventListener(type, listener) {windowListeners[type] = listener}},
    root: {getRootNode: () => shadow, addEventListener(type, listener) {rootListeners[type] = listener}}, speedFocusRevision: 0,
    els: {buttons: {speed}, speedMenu: menu, menu: element()},
    current: {state: 'PLAYING', isSource: true, rate: 1.5, canChangeRate: true},
    mode: 'expanded', changingRate: false,
    SPEED_PRESETS: JSON.parse(source.match(/const SPEED_PRESETS = (\[[^\n]+\])/)[1]),
    isActive: () => context.current.isSource && ['PLAYING', 'PAUSED', 'LOADING'].includes(context.current.state),
    brapi: {i18n: {getUILanguage: () => 'en'}}, message: key => key,
    bgPageInvoke: async (...args) => calls.push(args),
    showError: err => errors.push(err), update: async () => {},
  })
  const focus = target => {
    const previous = shadow.activeElement
    shadow.activeElement = target
    if (target) rootListeners.focusin?.({target})
    // Retargeting suppresses document focus events between shadow siblings.
    if (!previous || !target) documentListeners.focusin?.({target: host})
  }
  for (const target of [speed, ...presets]) {
    target.focus = () => {target.focused = true; focus(target)}
  }
  menu.contains = target => presets.includes(target)
  context.els.root = context.root
  vm.runInContext(source.slice(source.indexOf('  async function onAction('), source.indexOf('  function seek(')), context)
  vm.runInContext(source.slice(source.indexOf('    root = els.root'), source.indexOf('    els.favicon.addEventListener')), context)
  vm.runInContext(source.slice(source.indexOf('    window.addEventListener("keydown"'), source.indexOf('    document.addEventListener("visibilitychange"')), context)
  return {context, presets, speed, menu, calls, errors, shadow, focus, documentListeners, windowListeners}
}

test('speed presets have a compact grid and a wider floating rate button', () => {
  const css = fs.readFileSync('js/reader-css.js', 'utf8')
  assert.match(css, /\.ra-bar button\.ra-speed-button\s*\{[^}]*width:\s*52px/)
  assert.match(source, /<span class="ra-sep"><\/span>\s*<button type="button" class="ra-speed-button"/)
  assert.match(css, /\.ra-speed-options\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/)
  assert.match(css, /@media \(max-width: 400px\)/)
})

test('reader floating bar builds an accessible speed button with default presets', async () => {
  const f = fixture()
  f.context.escapeHtml = text => text
  f.context.buildSpeedMenu()
  assert.deepEqual(Array.from(f.menu.innerHTML.matchAll(/data-rate="([^"]+)"/g), m => Number(m[1])), [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3])
  assert.match(source, /data-action="speed"[^>]*aria-controls="ra-speed-menu"[^>]*aria-expanded="false"/)
  await f.menu.listeners.click({target: {closest: () => ({dataset: {rate: '1.25'}})}})
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [['setRate', [1.25]]])
})

test('speed presets also open from the minimized floating bar and do not overlap display settings', async () => {
  const f = fixture()
  f.context.mode = 'minimized'
  vm.runInContext(source.slice(source.indexOf('  async function onAction('), source.indexOf('  function updateSpeedControls(')), f.context)
  await f.context.onAction('speed')
  assert.equal(f.menu.hidden, false)
  assert.equal(f.speed.attrs['aria-expanded'], 'true')
  await f.context.onAction('display')
  assert.equal(f.menu.hidden, true)
  assert.equal(f.context.els.menu.hidden, false)
  assert.equal(f.speed.attrs['aria-expanded'], 'false')
})

test('reader presets change live playback without resuming paused speech', async () => {
  const f = fixture()
  f.context.current.state = 'PAUSED'
  f.context.setSpeedMenuOpen(true)
  assert.equal(f.menu.hidden, false)
  assert.equal(f.speed.attrs['aria-expanded'], 'true')
  assert.equal(f.presets.find(b => b.dataset.rate === '1.5').focused, true)
  await f.context.setPlaybackRate(2)
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [['setRate', [2]]])
  assert.equal(f.context.current.state, 'PAUSED')
  assert.equal(f.speed.textContent, '2×')
  assert.equal(f.speed.attrs['aria-expanded'], 'false')
  assert.equal(f.menu.hidden, true)
  assert.equal(f.speed.focused, true)
})

for (const outcome of ['success', 'failure']) {
  test(`delayed speed ${outcome} does not steal focus from Display settings`, async () => {
    const f = fixture()
    f.context.setSpeedMenuOpen(true)
    let settle
    f.context.bgPageInvoke = () => new Promise((resolve, reject) => {
      settle = () => outcome === 'success' ? resolve(true) : reject(new Error('failed'))
    })
    const pending = f.context.setPlaybackRate(2)
    await f.context.onAction('display')
    const theme = element()
    f.shadow.activeElement = theme
    settle()
    await pending
    assert.equal(f.shadow.activeElement, theme)
    assert.equal(f.speed.focused, undefined)
    assert.equal(f.context.els.menu.hidden, false)
    assert.equal(f.errors.length, outcome === 'failure' ? 1 : 0)
  })
}

test('a later focus interaction revokes pending speed focus even after that control blurs', async () => {
  const f = fixture()
  f.context.setSpeedMenuOpen(true)
  let resolve
  f.context.bgPageInvoke = () => new Promise(yes => resolve = yes)
  const pending = f.context.setPlaybackRate(2)
  f.focus(element())
  // Disabled/removed controls can leave no active element in the closed root.
  f.shadow.activeElement = null
  resolve(true)
  await pending
  assert.equal(f.shadow.activeElement, null)
  assert.equal(f.speed.focused, undefined)
})

test('a delayed choice restores keyboard focus after disabling blurs its preset', async () => {
  const f = fixture()
  f.context.setSpeedMenuOpen(true)
  let resolve
  f.context.bgPageInvoke = () => new Promise(yes => resolve = yes)
  const pending = f.context.setPlaybackRate(2)
  f.shadow.activeElement = null
  resolve(true)
  await pending
  assert.equal(f.shadow.activeElement, f.speed)
})

test('Escape dismisses presets and restores focus without closing the reader', () => {
  const f = fixture()
  f.context.setSpeedMenuOpen(true)
  let prevented = false, stopped = false
  f.windowListeners.keydown({key: 'Escape', preventDefault() {prevented = true}, stopPropagation() {stopped = true}})
  assert.equal(f.menu.hidden, true)
  assert.equal(f.shadow.activeElement, f.speed)
  assert.equal(f.context.mode, 'expanded')
  assert.equal(prevented && stopped, true)
})

for (const transition of ['minimize and reopen', 'close and reopen', 'source loss', 'capability loss', 'outside dismissal']) {
  test(`pending speed choice cannot restore focus after ${transition}`, async () => {
    const f = fixture()
    f.context.setSpeedMenuOpen(true)
    let resolve
    f.context.bgPageInvoke = () => new Promise(yes => resolve = yes)
    const pending = f.context.setPlaybackRate(2)
    f.shadow.activeElement = null
    if (transition.endsWith('reopen')) {
      f.context.root.classList = {toggle() {}}
      f.context.host.style = {setProperty() {}}
      f.context.host.hidePopover = f.context.host.remove = () => {}
      f.context.document.documentElement = {style: {getPropertyValue() {return ''}, setProperty() {}, removeProperty() {}}}
      f.context.savedOverflow = null
      f.context.stopPolling = () => {}
      f.context.updateButtons = () => f.context.updateSpeedControls()
      vm.runInContext(source.slice(source.indexOf('  function setMode('), source.indexOf('  function isActive(')), f.context)
      f.context.setMode(transition.startsWith('close') ? 'closed' : 'minimized')
      f.context.setMode('expanded')
    }
    else if (transition === 'outside dismissal') {
      f.documentListeners.pointerdown({composedPath: () => []})
    }
    else {
      const field = transition === 'source loss' ? 'isSource' : 'canChangeRate'
      f.context.current[field] = false
      f.context.updateSpeedControls()
      f.context.current[field] = true
      f.context.updateSpeedControls()
    }
    resolve(true)
    await pending
    assert.equal(f.shadow.activeElement, null)
    assert.equal(f.speed.focused, undefined)
  })
}

test('reader ignores invalid, inactive and overlapping speed requests and recovers from errors', async () => {
  const f = fixture()
  for (const value of [0, NaN, 1.3, 11, '2']) await f.context.setPlaybackRate(value)
  assert.equal(f.calls.length, 0)
  f.context.current.isSource = false
  await f.context.setPlaybackRate(2)
  assert.equal(f.calls.length, 0)
  f.context.current.isSource = true
  let reject
  f.context.bgPageInvoke = () => new Promise((_, no) => reject = no)
  const pending = f.context.setPlaybackRate(2)
  assert.equal(f.speed.disabled, true)
  await f.context.setPlaybackRate(3)
  reject(new Error('failed'))
  await pending
  assert.equal(f.errors[0].message, 'failed')
  assert.equal(f.speed.disabled, false)
  assert.equal(f.speed.textContent, '1.5×')
})

test('reader keeps the old rate when the backend rejects a stale unsupported request', async () => {
  const f = fixture()
  f.context.bgPageInvoke = async () => false
  await f.context.setPlaybackRate(2)
  assert.equal(f.context.current.rate, 1.5)
  assert.equal(f.speed.textContent, '1.5×')
})

test('reader hides unsupported speed controls and closes stale presets in both modes', async () => {
  const f = fixture()
  for (const mode of ['expanded', 'minimized']) {
    f.context.mode = mode
    for (const state of ['PLAYING', 'PAUSED', 'LOADING']) {
      f.context.current.state = state
      f.context.current.canChangeRate = true
      f.context.updateSpeedControls()
      assert.equal(f.speed.hidden, false)
      f.context.setSpeedMenuOpen(true)
      assert.equal(f.menu.hidden, false)
      for (const capability of [false, undefined]) {
        f.context.current.canChangeRate = capability
        f.context.updateSpeedControls()
        assert.equal(f.speed.hidden, true)
        assert.equal(f.menu.hidden, true)
        assert.equal(f.speed.attrs['aria-expanded'], 'false')
        f.context.setSpeedMenuOpen(true)
        assert.equal(f.menu.hidden, true)
        await f.context.setPlaybackRate(2)
        assert.equal(f.calls.length, 0)
      }
    }
  }
})

test('reader floating speed button shows current rate and selects the matching preset', () => {
  const f = fixture()
  f.context.updateSpeedControls()
  assert.equal(f.speed.textContent, '1.5×')
  assert.equal(f.speed.disabled, false)
  assert.equal(f.speed.attrs['aria-label'], 'options_rate_label: 1.5×')
  assert.deepEqual(f.presets.filter(b => b.attrs['aria-pressed'] === 'true').map(b => b.dataset.rate), ['1.5'])
  f.context.current.rate = 1.3
  f.context.updateSpeedControls()
  assert.equal(f.speed.textContent, '1.3×')
  assert.equal(f.presets.some(b => b.attrs['aria-pressed'] === 'true'), false)
  f.context.current.isSource = false
  f.context.updateSpeedControls()
  assert.equal(f.speed.disabled, true)
})
