
(function() {
  const current$ = new rxjs.BehaviorSubject(null)

  current$.pipe(
    rxjs.switchMap(current => {
      if (current) {
        return playAudioHere(Promise.resolve(current.url), current.options, current.playbackState$, current.rate$).pipe(
          rxjs.catchError(err => rxjs.of({type: "error", error: errorToJson(err)})),
          rxjs.tap(event => {
            sendToPlayer({method: "offscreenPlaybackEvent", args: [event, current.id]})
              .catch(console.error)
          })
        )
      } else {
        return rxjs.EMPTY
      }
    })
  ).subscribe()



  function play(url, options, id) {
    if (current$.value && current$.value.id == id) {
      current$.value.playbackState$.next("resumed")
      return true
    }
    current$.next({
      id,
      url,
      options,
      rate$: new rxjs.BehaviorSubject(options.rate || 1),
      playbackState$: new rxjs.BehaviorSubject("resumed")
    })
    return true
  }

  function pause(id) {
    if (current$.value && current$.value.id == id) current$.value.playbackState$.next("paused")
    return true
  }

  function setRate(rate, id) {
    if (current$.value && current$.value.id == id) current$.value.rate$.next(rate)
    return true
  }

  function stop(id) {
    if (current$.value && current$.value.id == id) current$.next(null)
    return true
  }

  // Register only after state and the audio subscription are initialized.
  registerMessageListener("offscreen", {ping: () => true, play, pause, stop, setRate})

  async function sendToPlayer(message) {
    message.dest = "player"
    const result = await brapi.runtime.sendMessage(message)
    if (result && result.error) throw result.error
    else return result
  }
})();
