const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const popup = fs.readFileSync('js/popup.js', 'utf8')
const openInTabSource = popup.slice(popup.indexOf('async function openInTab('), popup.indexOf('async function init()'))

function fixture({tab, tabWindow, updateError} = {}) {
  const calls = []
  const context = vm.createContext({
    console: {error() {}},
    getActiveTab: async () => ({id: 42}),
    getTab: async id => id === 10 ? tab : null,
    getWindow: async () => tabWindow,
    updateTab: async (id, details) => {
      calls.push(['updateTab', id, details])
      if (updateError) throw updateError
      return {windowId: 7}
    },
    updateWindow: async (id, details) => calls.push(['updateWindow', id, details]),
    createTab: async url => calls.push(['createTab', url]),
    brapi: {runtime: {getURL: path => `extension://${path}`}},
    window: {close: () => calls.push(['close'])},
  })
  vm.runInContext(openInTabSource, context)
  return {open: () => context.openInTab(10), calls}
}

test('opens the highlight page in an existing regular tab', async () => {
  const f = fixture({tab: {windowId: 7}, tabWindow: {type: 'normal'}})
  await f.open()
  assert.deepEqual(f.calls, [
    ['updateTab', 10, {url: 'extension://popup.html?tab=42', active: true}],
    ['updateWindow', 7, {focused: true}],
    ['close'],
  ])
})

test('creates a regular tab instead of reusing a popup window tab', async () => {
  const f = fixture({tab: {windowId: 7}, tabWindow: {type: 'popup'}})
  await f.open()
  assert.deepEqual(f.calls, [
    ['createTab', 'extension://popup.html?tab=42'],
    ['close'],
  ])
})

test('creates a tab when the remembered regular tab can no longer be updated', async () => {
  const f = fixture({
    tab: {windowId: 7},
    tabWindow: {type: 'normal'},
    updateError: new Error('tab closed'),
  })
  await f.open()
  assert.deepEqual(f.calls, [
    ['updateTab', 10, {url: 'extension://popup.html?tab=42', active: true}],
    ['createTab', 'extension://popup.html?tab=42'],
    ['close'],
  ])
})
