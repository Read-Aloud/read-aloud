# Inline playback speed

Automated coverage: `npm test` (including `tests/playback-rate.test.js`).

## Real-voice smoke test

Load the unpacked extension from this checkout in a disposable browser profile.
Select a specific voice whose synthesized audio is played by the extension (for
example Piper), rather than automatic voice selection, and use a multi-paragraph
article. Step 6 also requires a source with multiple sections, such as Google
Slides with automatic slide advancement enabled.

1. Start reading. The **Speed** number field should appear at the bottom of the
   player, below the reading pane, without a preset dropdown. It must remain
   visible when the reading-controls disclosure is collapsed.
2. Enter a rate such as `1.3`, then move focus out of the field. Playback should
   use that rate. The number-input arrows should also adjust the speed.
3. With Piper, confirm the current sentence does not restart and highlighting
   continues at the same position. Check transitions back to `1` as well.
4. Pause, change speed again, and wait. Playback must remain paused. Resume;
   it should use the new rate at the same position.
5. Stop and restart; reopen the popup; check the same voice's speed in Settings.
   The new value should persist. Select another voice and confirm its speed
   preference remains independent, then reselect the original voice.
6. Using a multi-section source, change speed as playback advances to the next
   section. Confirm the current section receives the update, not only the
   completed section.
7. Try the compact toolbar popup and pop-out player in light and dark mode.
   Confirm the localized label is visible, the input is keyboard-accessible,
   and the toolbar has no horizontal clipping.
8. Try invalid/empty input and out-of-range values. They must not reach the
   speech engine. The field accepts values from 0.1 to 10, but the effective
   range may be narrower depending on the voice, browser, or audio player.

## Reader-mode floating speed presets

1. Select reader mode and start reading. The floating bar should show the current
   speed as a button, such as **1×**.
2. Activate it with mouse, Enter, or Space. Verify all eight presets are present:
   0.5×, 0.75×, 1×, 1.25×, 1.5×, 1.75×, 2×, and 3×. The current preset should be
   highlighted and marked pressed for assistive technology; a custom speed
   should still appear on the button without falsely selecting a preset.
3. Choose a preset while playing and while paused. Confirm the same live-speed
   behavior and per-voice persistence as the popup. Paused speech must not resume.
4. Press Escape while presets are open. Only the presets should close, with focus
   returned to the speed button. Clicking outside should dismiss them too.
5. Open display settings and speed presets alternately; they must not overlap.
6. Minimize the reader and repeat the preset selection. Click the underlying page
   to dismiss the presets without expanding or closing the floating bar.
7. Check light/dark themes and a 320px-wide viewport. Both the bar and preset
   panel should fit without clipping.
8. Stop playback or start playback in another tab. The old reader's speed button
   must become hidden, with no stale preset panel remaining open.

## Voices without live-speed support

These checks concern changing speed during an active speech session, not whether
speed can be configured at all. Support depends on the selected playback engine,
not whether a voice is local or cloud-backed. Browser TTS voices are treated as
unsupported for live changes by this extension; this does not mean that every
underlying voice is inherently incapable of changing speed.

1. Select a voice provided by the browser/operating system (not Piper,
   Supertonic, or PocketTTS) and start reading. Confirm both the popup speed field
   and reader-mode speed button are hidden, not merely disabled.
2. Where available, repeat with a Chrome built-in Google network voice such as
   `Google US English`. Its live controls must also be hidden. Do not confuse it
   with `GoogleTranslate` or Google Cloud voices, which use different engines;
   those generally support live changes, except `GoogleTranslate Hebrew` and
   `GoogleTranslate Telugu`, which fall back to browser TTS.
3. Verify hiding in playing, paused, and loading states, in both full and minimized
   reader mode. If the active speech changes to an unsupported voice while presets
   are open, they must close. Changing the Settings selection alone need not
   replace the current speech immediately.
4. Switch back to a voice with live-speed support, such as Piper, and start a new
   session. The controls should return and show its current rate.
5. A stale rate request reaching an unsupported voice must not restart it,
   change its rate, or overwrite its saved speed preference.
6. Verify that Settings still lets users configure a browser voice's speed, and
   that a new playback session uses it, subject to the voice's limits. While the
   active voice's capability is unknown or pending, live controls stay hidden.

## Deterministic browser integration scope

Provider-independent integration can substitute a generated silent WAV for
synthesis while keeping the real Speech session, popup controls, extension
messaging, settings storage, and offscreen HTML audio element. Assert that a
speed change modifies `playbackRate` without replacing `src`, resetting
`currentTime`, or resuming paused playback. This verifies audio transport,
**not** live Piper model synthesis; perform the real-voice smoke test separately.
