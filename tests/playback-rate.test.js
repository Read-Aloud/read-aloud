const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = name => fs.readFileSync(`js/${name}.js`, 'utf8')

function popupFixture() {
  const input = {value: '', disabled: false}
  const control = {hidden: true}
  const decrease = {disabled: false}, increase = {disabled: false}
  const elements = {'playback-rate': input, 'decrease-playback-rate': decrease, 'increase-playback-rate': increase}
  for (const element of [input]) {
    const listeners = {}
    element.addEventListener = (type, listener) => listeners[type] = listener
    element.dispatch = type => listeners[type]?.()
  }
  const calls = [], errors = []
  const context = vm.createContext({
    document: {getElementById: id => elements[id] || control, activeElement: null},
    defaults: {rate: 1},
    bgPageInvoke: async (...args) => calls.push(args),
    handleError: err => errors.push(err),
  })
  const code = source('popup')
  vm.runInContext(code.slice(code.indexOf('function updatePlaybackRate('), code.indexOf('function updateHighlighting(')), context)
  for (const line of code.split('\n').filter(line => /getElementById\("playback-rate(?:-presets)?"\)\.addEventListener/.test(line))) {
    vm.runInContext(line, context)
  }
  input.focus = () => context.document.activeElement = input
  return {context, input, control, decrease, increase, calls, errors}
}

function speechFixture({native = false, google = false, kind, texts = ['First sentence. Second sentence.']} = {}) {
  const rxjs = require('../js/rxjs.umd.min.js')
  const spoken = []
  let onEvent
  const engine = native ? {
    speak(text, options, callback) {spoken.push({text, rate: options.rate}); onEvent = callback; callback({type: 'start'})},
    stop() {}, pause() {}, resume() {},
  } : {
    speak(text, options, state$) {return new rxjs.Observable(observer => {
      spoken.push({text, rate: options.rate})
      observer.next({type: 'start', sentenceStartIndicies: [0, 6]})
      observer.next({type: 'sentence', startIndex: 6})
    })},
  }
  if (kind && kind !== 'audio') engine.stop = () => {}
  const context = vm.createContext({
    rxjs, crypto: require('node:crypto'), console,
    parseWordReplacements: () => ({rules: []}),
    isGoogleNetworkVoice: () => google,
    isPiperVoice: () => kind ? kind === 'piper' : !native, isSupertonicVoice: () => kind === 'supertonic',
    isPocketTtsVoice: () => kind === 'pocket', isNghiTtsVoice: () => kind === 'nghi',
    isAzure: () => false, isOpenai: () => kind === 'audio', isUseMyPhone: () => kind === 'phone',
    isGoogleTranslate: () => false, isAmazonPolly: () => false,
    isGoogleWavenet: () => false, isIbmWatson: () => false,
    isPremiumVoice: () => false, isReadAloudCloud: () => false,
    isOfflineVoice: () => native && !google, isChromeOSNative: () => false,
    getVoiceLanguages: () => ['en'], immediate: fn => fn(),
    piperTtsEngine: kind ? (kind === 'piper' ? engine : {}) : (native ? {} : engine), browserTtsEngine: engine,
    supertonicTtsEngine: kind === 'supertonic' ? engine : {}, pocketTtsEngine: kind === 'pocket' ? engine : {},
    nghiTtsEngine: kind === 'nghi' ? engine : {}, phoneTtsEngine: engine, openaiTtsEngine: engine,
    TimeoutTtsEngine: function() {return engine},
  })
  vm.runInContext(source('speech'), context)
  const speech = new context.Speech(texts, {rate: 1, lang: 'en', voice: {voiceName: 'test'}})
  return {speech, spoken, finish: () => onEvent({type: 'end'})}
}

test('streamed speech changes speed without restarting or losing sentence position', async () => {
  const {speech, spoken} = speechFixture()
  speech.play()
  assert.equal(speech.getInfo().canChangeRate, true)
  const before = JSON.stringify(speech.getInfo().position)
  speech.setRate(1.8)
  assert.equal(speech.rate$.value, 1.8)
  assert.equal(speech.getInfo().rate, 1.8)
  assert.equal(JSON.stringify(speech.getInfo().position), before)
  assert.equal(spoken.length, 1)
  speech.pause()
  speech.setRate(0.7)
  assert.equal(await speech.getState(), 'PAUSED')
  assert.equal(spoken.length, 1)
  speech.stop()
})

test('live speed capability follows the resolved audio backend, not native/cloud labels', () => {
  for (const [kind, expected] of [['audio', true], ['piper', true], ['supertonic', true], ['pocket', true], ['phone', false], ['nghi', false]]) {
    const {speech} = speechFixture({kind})
    assert.equal(speech.getInfo().canChangeRate, expected, kind)
    speech.stop()
  }
})

test('native and Google network voices reject live rate changes without restarting speech', async () => {
  for (const google of [false, true]) {
    const {speech, spoken} = speechFixture({native: true, google})
    speech.play()
    assert.equal(speech.getInfo().canChangeRate, false)
    assert.equal(speech.setRate(1.6), false)
    assert.deepEqual(spoken.map(x => x.rate), [google ? 0.9 : 1])
    assert.equal(speech.getInfo().rate, 1)
    speech.pause()
    assert.equal(speech.setRate(2), false)
    assert.equal(await speech.getState(), 'PAUSED')
    assert.equal(spoken.length, 1)
    speech.stop()
  }
})

test('unsupported live rate requests leave Google chunking and unread text unchanged', () => {
  const text = Array.from({length: 60}, (_, i) => `word${i}`).join(' ') + '.'
  const {speech, spoken} = speechFixture({native: true, google: true, texts: [text]})
  speech.play()
  speech.seek(1)
  const before = JSON.stringify(speech.getInfo())
  const count = spoken.length
  assert.equal(speech.setRate(0.1), false)
  assert.equal(JSON.stringify(speech.getInfo()), before)
  assert.equal(spoken.length, count)
  speech.stop()
})

test('audio rate changes apply without seeking, playing, or resuming the audio element', () => {
  const rxjs = require('../js/rxjs.umd.min.js')
  const audio = {currentTime: 12, play() {throw new Error('must stay paused')}, pause() {}}
  const context = vm.createContext({rxjs, getSingletonAudio: () => audio, getSilenceTrack: () => ({start() {}, stop() {}})})
  const defaults = source('defaults')
  vm.runInContext(defaults.slice(defaults.indexOf('function playAudioHere('), defaults.indexOf('function canUseEmbeddedPlayer(')), context)
  const rate$ = new rxjs.BehaviorSubject(1)
  const playback = context.playAudioHere(rxjs.of('audio-url'), {rate: 1, rateAdjust: 1.1}, new rxjs.BehaviorSubject('paused'), rate$).subscribe()
  rate$.next(1.8)
  assert.equal(audio.playbackRate, 1.8 * 1.1)
  assert.equal(audio.defaultPlaybackRate, 1.8 * 1.1)
  assert.equal(audio.currentTime, 12)
  playback.unsubscribe()
  rate$.next(2)
  assert.equal(audio.playbackRate, 1.8 * 1.1)
})

test('audio routing uses the active speech rate for remote sentence audio and both playback backends', async () => {
  const rxjs = require('../js/rxjs.umd.min.js')
  for (const offscreen of [true, false]) {
    const rate$ = new rxjs.BehaviorSubject(1.9)
    let received
    const play = (...args) => {received = args; return rxjs.of('started')}
    const context = vm.createContext({rxjs, activeDoc: {getActiveSpeech: async () => ({rate$})},
      brapi: {offscreen}, playAudioHere: play, playAudioOffscreen: play,
      requestAudioPlaybackPermission: async () => {},
    })
    const code = source('player')
    vm.runInContext(code.slice(code.indexOf('function playAudio('), code.indexOf('var requestAudioPlaybackPermission')), context)
    await rxjs.firstValueFrom(context.playAudio(Promise.resolve('url'), {rate: 1}, rxjs.of('paused')))
    assert.equal(received[3], rate$)
  }
})

test('cloud audio binds its speech rate during construction, before the document publishes activeSpeech', async () => {
  const rxjs = require('../js/rxjs.umd.min.js')
  const rate$ = new rxjs.BehaviorSubject(1.4)
  let received
  const context = vm.createContext({rxjs, activeDoc: {getActiveSpeech: async () => null},
    brapi: {offscreen: true}, playAudioOffscreen: (...args) => {received = args; return rxjs.of('started')},
  })
  const code = source('player')
  vm.runInContext(code.slice(code.indexOf('function playAudio('), code.indexOf('var requestAudioPlaybackPermission')), context)
  await rxjs.firstValueFrom(context.playAudio(Promise.resolve('url'), {rate: 1, rate$}, rxjs.of('paused')))
  assert.equal(received[3], rate$)
  assert.equal('rate$' in received[1], false)
  const {speech} = speechFixture()
  assert.equal(speech.options.rate$, speech.rate$)
  speech.stop()
})

test('offscreen speed commands affect only their audio session and never resume it', () => {
  const rxjs = require('../js/rxjs.umd.min.js')
  let handlers, currentRate$, state$
  vm.runInNewContext(source('offscreen'), {rxjs, console,
    registerMessageListener: (_, h) => handlers = h,
    playAudioHere: (_, options, state, rate) => {currentRate$ = rate; state$ = state; return rxjs.NEVER},
    brapi: {runtime: {sendMessage: async () => {}}},
  })
  handlers.play('url', {rate: 1}, 'one')
  handlers.pause('one')
  handlers.setRate(1.8, 'one')
  assert.equal(currentRate$.value, 1.8)
  assert.equal(state$.value, 'paused')
  handlers.play('url', {rate: 1}, 'two')
  handlers.setRate(2, 'one')
  assert.equal(currentRate$.value, 1)
})

test('offscreen speed follows pending starts, paused audio, and disposes its listener', async () => {
  const rxjs = require('../js/rxjs.umd.min.js')
  const messages = []
  let release
  const context = vm.createContext({rxjs, console, setTimeout, clearTimeout,
    crypto: {randomUUID: () => 'rate-session'}, messageHandlers: {},
    bgPageInvoke: () => new Promise(resolve => release = resolve),
    brapi: {runtime: {sendMessage: async msg => {messages.push(JSON.parse(JSON.stringify(msg))); return true}}},
  })
  const player = source('player')
  vm.runInContext(player.slice(player.indexOf('var offscreenCommandQueue'), player.indexOf('async function shouldPlaySilence')), context)
  const state$ = new rxjs.BehaviorSubject('resumed'), rate$ = new rxjs.BehaviorSubject(1)
  const sub = context.playAudioOffscreen(Promise.resolve('url'), {}, state$, rate$).subscribe()
  await new Promise(setImmediate)
  rate$.next(1.7)
  release(true)
  await new Promise(setImmediate)
  assert.equal(messages.find(m => m.method === 'play').args[1].rate, 1.7)
  state$.next('paused')
  rate$.next(2)
  await new Promise(setImmediate)
  assert.deepEqual(messages.at(-1), {dest: 'offscreen', method: 'setRate', args: [2, 'rate-session']})
  assert.equal(messages.filter(m => m.method === 'play').length, 1)
  sub.unsubscribe()
  await new Promise(setImmediate)
  const count = messages.length
  rate$.next(3)
  await new Promise(setImmediate)
  assert.equal(messages.length, count)
})

test('Piper uses host audio even at normal speed so live changes never restart synthesis', async () => {
  const rxjs = require('../js/rxjs.umd.min.js')
  const requests = []
  const context = vm.createContext({rxjs, piperObservable: rxjs.of({sendRequest: async (...args) => requests.push(args)}), piperCallbacks: new rxjs.Subject()})
  const engines = source('tts-engines')
  vm.runInContext(engines.slice(engines.indexOf('function PiperTtsEngine('), engines.indexOf('function SupertonicTtsEngine(')), context)
  const engine = new context.PiperTtsEngine()
  engine.speak('Text.', {rate: 1, voice: {voiceName: 'Piper test'}}, () => {})
  await new Promise(setImmediate)
  assert.equal(requests[0][1].externalPlayback, true)
  engine.stop()
  await new Promise(setImmediate)
})

test('default popup keeps only the numeric speed field, leaving reader presets intact', () => {
  const html = fs.readFileSync('popup.html', 'utf8')
  assert.doesNotMatch(html, /playback-rate-presets|<select/)
  assert.doesNotMatch(source('popup'), /playback-rate-presets|onPlaybackRatePresetChange|updatePlaybackRatePreset/)
  assert.doesNotMatch(fs.readFileSync('css/popup.css', 'utf8'), /playback-rate-presets/)
  assert.match(html, /<input[^>]*id="playback-rate"[^>]*type="number"/)
  assert.match(source('reader'), /data-action="speed"/)
  assert.match(source('reader'), /const SPEED_PRESETS = /)
})

test('popup exposes a labeled speed field inside the collapsible reading-controls toolbar', () => {
  const html = fs.readFileSync('popup.html', 'utf8')
  const topButtons = html.slice(html.indexOf('<div id="buttons">'), html.indexOf('<div id="highlight">'))
  const toolbar = html.slice(html.indexOf('<div id="toolbar" hidden>'), html.indexOf('<div id="footer">'))
  assert.equal(topButtons.includes('id="playback-rate-control"'), false)
  assert.match(toolbar, /<span id="playback-rate-control"[\s\S]*<\/span>\s*<\/div>\s*<\/div>\s*$/)
  assert.match(html, /<label[^>]*for="playback-rate"/)
  assert.match(html, /<input[^>]*id="playback-rate"[^>]*type="number"[^>]*min="0.1"[^>]*max="10"/)
  assert.match(source('popup'), /getElementById\("playback-rate"\)\.addEventListener\("change", onPlaybackRateChange\)/)
  assert.match(source('popup'), /updatePlaybackRate\(state, speech\)/)
})

test('player applies and persists speed per selected voice without resuming playback', async () => {
  const writes = [], rates = []
  const speech = {setRate: rate => rates.push(rate)}
  const context = vm.createContext({
    activeDoc: {getActiveSpeech: async () => speech},
    getSettings: async () => ({voiceName: 'Piper test'}),
    updateSetting: async (...args) => writes.push(args),
  })
  const code = source('player')
  vm.runInContext(code.slice(code.indexOf('async function setRate('), code.indexOf('function getPlaybackState(')), context)
  await context.setRate(1.8)
  assert.deepEqual(rates, [1.8])
  assert.deepEqual(writes, [['ratePiper test', 1.8]])
  for (const rate of [0, 11, NaN, Infinity, '2']) await assert.rejects(context.setRate(rate), /Invalid playback rate/)
  assert.equal(writes.length, 1)
  assert.match(source('events'), /setRate: setRate/)
  assert.match(source('player'), /setRate: setRate/)
  const bridge = vm.createContext({sendToPlayer: async value => JSON.parse(JSON.stringify(value))})
  const events = source('events')
  vm.runInContext(events.slice(events.indexOf('function setRate('), events.indexOf('async function getPlaybackState(')), bridge)
  assert.deepEqual(await bridge.setRate(1.8), {method: 'setRate', args: [1.8]})
})

test('player changes the current speech when the same document advances during settings lookup', async () => {
  const writes = [], rates = []
  let releaseSettings
  let speech = {setRate: rate => rates.push(['old', rate])}
  const context = vm.createContext({
    activeDoc: {getActiveSpeech: async () => speech},
    getSettings: () => new Promise(resolve => releaseSettings = resolve),
    updateSetting: async (...args) => writes.push(args),
  })
  const code = source('player')
  vm.runInContext(code.slice(code.indexOf('async function setRate('), code.indexOf('function getPlaybackState(')), context)
  const pending = context.setRate(0.7)
  await new Promise(setImmediate)
  speech = {setRate: rate => rates.push(['current', rate])}
  releaseSettings({voiceName: 'Google test'})
  await pending
  assert.deepEqual(rates, [['current', 0.7]])
  assert.deepEqual(writes, [['rateGoogle test', 0.7]])
})

test('player does not persist a rejected live rate change for an unsupported voice', async () => {
  const writes = []
  const context = vm.createContext({
    activeDoc: {getActiveSpeech: async () => ({setRate: () => false})},
    getSettings: async () => ({voiceName: 'Native test'}),
    updateSetting: async (...args) => writes.push(args),
  })
  const code = source('player')
  vm.runInContext(code.slice(code.indexOf('async function setRate('), code.indexOf('function getPlaybackState(')), context)
  assert.equal(await context.setRate(2), false)
  assert.deepEqual(writes, [])
})

for (const failure of ['rejection', 'error']) {
  test(`popup numeric field reconciles ${failure} without moving focus`, async () => {
    const f = popupFixture()
    const state = {state: 'PLAYING', speechInfo: {rate: 1, canChangeRate: true}}
    f.context.updatePlaybackRate(state.state, state.speechInfo)
    f.context.bgPageInvoke = async method => {
      if (method === 'getPlaybackState') return state
      if (failure === 'error') throw new Error('unavailable')
      return false
    }
    f.input.focus()
    f.input.value = '3'
    await f.context.onPlaybackRateChange()
    assert.equal(Number(f.input.value), 1)
    assert.equal(f.context.document.activeElement, f.input)
    assert.equal(f.input.disabled, false)
    assert.equal(f.errors.length, failure === 'error' ? 1 : 0)
  })
}

test('numeric recovery cannot overwrite a subsequent edit even when restored to the same value', async () => {
  const f = popupFixture()
  f.context.updatePlaybackRate('PLAYING', {rate: 1, canChangeRate: true})
  let resolveRead
  f.context.bgPageInvoke = async method => method === 'setRate' ? false : new Promise(resolve => resolveRead = resolve)
  f.input.focus()
  f.input.value = '3'
  const pending = f.context.onPlaybackRateChange()
  await new Promise(setImmediate)
  f.input.value = '2'; f.input.dispatch('input')
  f.input.value = '3'; f.input.dispatch('input')
  resolveRead({state: 'PLAYING', speechInfo: {rate: 1, canChangeRate: true}})
  await pending
  assert.equal(f.input.value, '3')
  assert.equal(f.context.document.activeElement, f.input)
})

test('numeric recovery cannot restore an obsolete source or its capability', async () => {
  const f = popupFixture()
  f.context.updatePlaybackRate('PLAYING', {rate: 1, canChangeRate: true})
  let resolveRead
  f.context.bgPageInvoke = async method => method === 'setRate' ? false : new Promise(resolve => resolveRead = resolve)
  f.input.focus()
  f.input.value = '3'
  const pending = f.context.onPlaybackRateChange()
  await new Promise(setImmediate)
  f.context.updatePlaybackRate('PAUSED', {rate: 0.75, canChangeRate: false})
  resolveRead({state: 'PLAYING', speechInfo: {rate: 1, canChangeRate: true}})
  await pending
  assert.equal(Number(f.input.value), 0.75)
  assert.equal(f.control.hidden, true)
})

test('numeric speed requests remain serialized and recover after failure', async () => {
  const f = popupFixture()
  f.context.updatePlaybackRate('PLAYING', {rate: 1, canChangeRate: true})
  let reject, requests = 0
  f.context.bgPageInvoke = method => {
    if (method === 'getPlaybackState') return Promise.resolve({state: 'PLAYING', speechInfo: {rate: 1, canChangeRate: true}})
    requests++
    return new Promise((_, no) => reject = no)
  }
  f.input.value = '2'
  const pending = f.context.onPlaybackRateChange()
  assert.equal(f.input.disabled, true)
  await f.context.onPlaybackRateChange()
  assert.equal(requests, 1)
  reject(new Error('unavailable'))
  await pending
  assert.equal(f.input.disabled, false)
  assert.equal(Number(f.input.value), 1)
  assert.equal(f.errors[0].message, 'unavailable')
})

test('speed changes reach the player and invalid values are not sent', async () => {
  const f = popupFixture()
  f.context.updatePlaybackRate('PLAYING', {rate: 1, canChangeRate: true})
  f.input.value = '1.7'
  await f.context.onPlaybackRateChange()
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [['setRate', [1.7]]])
  assert.equal(f.input.disabled, false)
  for (const value of ['', 'NaN', '0', '10.1']) {
    f.input.value = value
    await f.context.onPlaybackRateChange()
  }
  assert.equal(f.calls.length, 1)
  f.context.bgPageInvoke = async () => {throw new Error('unavailable')}
  f.input.value = '2'
  await f.context.onPlaybackRateChange()
  assert.equal(f.errors[0].message, 'unavailable')
  assert.equal(f.input.disabled, false)
})

test('popup hides speed controls for unsupported or unknown capabilities and ignores hidden edits', async () => {
  const f = popupFixture()
  for (const state of ['PLAYING', 'PAUSED', 'LOADING']) {
    f.context.updatePlaybackRate(state, {rate: 1.5, canChangeRate: true})
    assert.equal(f.control.hidden, false)
    for (const capability of [false, undefined]) {
      f.context.updatePlaybackRate(state, {rate: 1.5, canChangeRate: capability})
      assert.equal(f.control.hidden, true)
      f.input.value = '2'
      await f.context.onPlaybackRateChange()
      assert.equal(f.calls.length, 0)
    }
  }
})

test('popup stepper snaps to the nearest preset in each direction and sends it', async () => {
  const f = popupFixture()
  f.context.updatePlaybackRate('PLAYING', {rate: 1.33, canChangeRate: true})
  await f.context.stepPlaybackRate(+1)
  assert.equal(f.input.value, 1.5)
  f.input.value = '1.33'
  await f.context.stepPlaybackRate(-1)
  assert.equal(f.input.value, 1.25)
  await f.context.stepPlaybackRate(-1)
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [['setRate', [1.5]], ['setRate', [1.25]], ['setRate', [1]]])
})

test('popup stepper disables buttons at the preset bounds and while a change is pending', async () => {
  const f = popupFixture()
  f.context.updatePlaybackRate('PLAYING', {rate: 0.5, canChangeRate: true})
  assert.equal(f.decrease.disabled, true)
  assert.equal(f.increase.disabled, false)
  await f.context.stepPlaybackRate(-1)
  assert.equal(f.calls.length, 0)
  f.context.updatePlaybackRate('PLAYING', {rate: 3, canChangeRate: true})
  assert.equal(f.decrease.disabled, false)
  assert.equal(f.increase.disabled, true)
  let resolve
  f.context.bgPageInvoke = () => new Promise(r => resolve = r)
  const pending = f.context.stepPlaybackRate(-1)
  assert.equal(f.decrease.disabled, true)
  assert.equal(f.increase.disabled, true)
  resolve(true)
  await pending
  assert.equal(f.input.value, 2.5)
  assert.equal(f.decrease.disabled, false)
  assert.equal(f.increase.disabled, false)
})

test('popup speed display rounds to two decimals', () => {
  const f = popupFixture()
  f.context.updatePlaybackRate('PLAYING', {rate: 1.3333, canChangeRate: true})
  assert.equal(f.input.value, 1.33)
})

test('inline speed reflects playback, stays visible when paused, and leaves edits alone', () => {
  const f = popupFixture()
  f.context.updatePlaybackRate('PLAYING', {rate: 1.5, canChangeRate: true})
  assert.equal(f.control.hidden, false)
  assert.equal(f.input.value, 1.5)
  f.context.document.activeElement = f.input
  f.input.value = '2.'
  f.context.updatePlaybackRate('PAUSED', {rate: 1.5, canChangeRate: true})
  assert.equal(f.control.hidden, false)
  assert.equal(f.input.value, '2.')
  f.context.document.activeElement = null
  f.context.updatePlaybackRate('PLAYING', {})
  assert.equal(f.input.value, 1)
  f.context.updatePlaybackRate('STOPPED', null)
  assert.equal(f.control.hidden, true)
})
