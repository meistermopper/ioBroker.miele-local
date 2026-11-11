# Older changes
## 0.3.46
- (SmarthomeElektroniker) Only the running appliance is polled at the short interval ("Poll interval (active)"); idle appliances keep the idle interval. Until now all appliances were polled at the short interval as soon as one was running - fewer requests to the Miele modules, which serve only one connection at a time

## 0.3.45
- (SmarthomeElektroniker) The last German state ID is gone: `eco.quelle` is now `eco.source`, its value is always English. Existing installations are migrated on start
- (SmarthomeElektroniker) `statusText`, `programText`, `programPhaseText`, `programTypeText` and `dryingStepText` follow the "German names" option - with the option off they are English (until now they were always German)
- (SmarthomeElektroniker) Remaining German log and error messages translated; CSV export files are named `collection-<date>.csv` and `finding-<date>.csv`
- (SmarthomeElektroniker) All JSDoc comments complete (no lint warnings left); `@iobroker/testing` 6.3.0
- (SmarthomeElektroniker) `eco.felderJson` is now `eco.fieldsJson` (migrated on start)
- (SmarthomeElektroniker) Settings use English keys: `sammlerAktiv`/`sammlerCloud`/`sammlerCloudInstanz` became `collectorActive`/`collectorCloud`/`collectorCloudInstance`, `leafDatenpunkte` became `leafStates`, the energy meter table `zaehler` became `energyMeters`. Existing settings are carried over once on start (review 2026-10-03)
- (SmarthomeElektroniker) Background loops (eco, operating hours, seconds, discovery, push renewal, leaf trend) schedule their next run only after the previous one finished - no overlapping runs when an appliance answers slowly

## 0.3.44
- (SmarthomeElektroniker) History objects are only rewritten when they actually changed - this prevents an empty (null) point in the history adapter after every adapter restart

## 0.3.43

- (SmarthomeElektroniker) All log messages are English now; diagnostic texts in states (`finding`, `check`, `progress`, `scanState`, `trendSize`), error messages and the CSV export too (review 2026-09-27)
- (SmarthomeElektroniker) Admin UI: all texts use English i18n keys; the diagnostics tab is translated into all 11 languages
- (SmarthomeElektroniker) README: diagnostics section uses the current English state IDs
- (SmarthomeElektroniker) `@iobroker/testing` 6.2.2; `common.news` limited to 7 entries

## 0.3.42

- (SmarthomeElektroniker) All program phases have German names now, a new test keeps it that way; status codes 144 (default) and 145 (locked) added. Translations and test idea by @meistermopper (#14)
- (SmarthomeElektroniker) Tumble dryer phases no longer point at the washing machine phase table (no visible change, the numbers never overlapped)

## 0.3.41

- (SmarthomeElektroniker) Device types corrected: 16 is the microwave (was: steam oven combi), 67 the dialog oven (was: dish warmer, now 25), the washer-dryer (24) uses the washing machine programs, the oven with microwave (13) its own phases
- (SmarthomeElektroniker) New device types: semi-professional/professional washers, dryers and dishwashers, robot vacuum (23), steam oven combi (31), steam oven with microwave (45, 418 programs), steam oven MK2 (73); dishwasher program 5 added
- (SmarthomeElektroniker) Programs without a German name are shown readably ("Artichokes small") instead of as raw identifier
- (SmarthomeElektroniker) Credits for the tables taken over from Home Assistant, ha-miele-at-lan and ioBroker.miele-unbound

## 0.3.40

- (SmarthomeElektroniker) README: hints for a failing login (ad blocker), moving to another system and why mDNS may find nothing; clearer log message when no appliance is found (#12, thanks @meistermopper)

## 0.3.39

- (SmarthomeElektroniker) Unknown program or phase IDs are now shown as "Programm 201" / "Phase 1234" instead of keeping the text of the previous program (#13)
- (SmarthomeElektroniker) Dishwasher program IDs of the G7771 added (201, 206, 208, 211, 212, 213) (#13)

## 0.3.38
- **Object IDs are now consistently English.** The diagnostics channel was named `sammlung`
  and carried German datapoint names throughout (`befund`, `fortschritt`, `datenJson`,
  `leafVerlaufFein` …), plus four German ones in the otherwise English `history` channel
  (`laufendSeit`, `zaehlerStart`, `gemessenLetzter`, `gemessenTotal`) - 57 of 446 objects in
  total. In the repository request the reviewer therefore took them for hand-made script
  datapoints. `sammlung` became `collection`, `befund` became `finding`, `laufendSeit`
  became `runningSince`.
- **On first start the adapter migrates.** Every existing value moves to its new ID, and only
  then is the old datapoint removed. Collected data is not lost - in a running installation
  that is the field-search records, the leaf scan over 882 probed addresses and the trend
  recording. A freshly set up instance finds nothing to migrate and writes nothing.
- **Recorded history stays**, but under the old ID: history is attached to the object and does
  not move with it. Only the four numbers in the `history` channel are affected.
- **Anyone using the old IDs in their own scripts must follow suit.** Checked before renaming:
  none of them appeared in 56 ioBroker scripts or in the operator's Android app.
- The IDs now live in one place, `lib/ids.js`, instead of scattered through the source.

## 0.3.37
- **Plain text on the raw values.** `status`, `programType`, `programPhase` and `programId` now
  carry their value list in `common.states`, built from the same tables the `…Text` states come
  from, so the two cannot drift apart. The object browser and VIS show the text, the value stays a
  number. The `…Text` states remain unchanged. Programme lists above 64 entries are left out - an
  oven has 168 of them, and they do not belong inside every object.
- **Descriptions where they were missing.** Not one of the 446 objects carried a `common.desc`.
  Everything writable now does, plus the whole diagnostic branch, the three timestamps in
  milliseconds, and the five raw values whose meaning is documented nowhere. At
  `sammlung.leafVerlaufFein` the format and an example are part of the description - without them
  nobody could guess what to type in.
- **Admin rearranged.** "Appliances & polling" carried 25 fields from six unrelated topics and is
  now split into **Appliances** and **Polling & values**; the three eco field indices moved to
  Diagnostics, next to the collection that determines them. 18 blocks of running text disappeared:
  their content now sits as one or two sentences under the field it belongs to, where the admin
  shows it. Seven of 69 fields had a help text before, 28 have one now.
- **The diagnostic branch is only created when it is used.** Its fourteen states per appliance
  used to appear for everyone. They now require data collection or the leaf scan to be switched
  on; the scan and the close recording bring the channel with them so they cannot fail silently.
- **CSV: start, end and difference per leaf field.** Until now a record only held the final state
  of the other leaves. For a lifetime counter like `hoursOfOperation` that says nothing about a
  single programme - only the difference does, and those leaves are the only route for appliances
  that do not answer 2/6195 at all. The adapter now reads the state at the start of a programme as
  well. The export also gained the serial number as its own column, the adapter version, the
  divisor and unit in the field headings, a unit on the temperature, and a note on records that
  predate timestamps instead of silently empty cells.
- **Second file with the analysis.** `befund-<date>.csv` holds one row per field: match against the
  reference, best divisor, average and largest deviation. That is the question the collection
  exists for, and it no longer has to be rebuilt by hand in a spreadsheet.
- **Fix: role `value.volume` had returned.** A newly added table reintroduced a role the ioBroker
  catalogue does not know; the repository check reports it as E1008. It is `value` again.
- **Object IDs of the diagnostic branch in one table.** They are not renamed yet, but they now live
  in `lib/ids.js` instead of scattered through 180 kB of source, so a later rename is an edit to a
  table rather than a search.
- **Device internals as datapoints.** The adapter now carries the field tables of every DOP2 leaf
  documented by the public reverse-engineering projects `MieleRESTServer` (akappner) and
  `ha-miele-at-lan` (tiehfood) - 52 structures, including those for ovens, coffee machines,
  failures and the communication module, not just washing machines. A datapoint is created only
  when the appliance actually delivers the field; nothing is created blindly. The values are
  written from polls that already run, so no additional requests are made. New branch per device:
  `detail.<channel>.<field>`. Off switch in the Diagnostics tab.
- **Fix: Generic value wrappers were read at the wrong position.** Miele wraps every measurement
  in a small structure, and there are two shapes: `[mask, value, interpretation]` and
  `[mask, min, max, current, step]`. The adapter always read the second entry - correct for the
  first shape, the *minimum* for the second, which is 0 on every observed field. Seven fields of
  the eco leaf were affected, among them `heatingTargetTemperature`: during a 40 °C programme the
  appliance reported `[9, 0, 0, 40, 0, 0]` and the adapter 0. Field numbers inside structures are
  now preserved and used.
- **Water: the appliance's own EcoFeedback comes first.** Where DOP2 2/1585 exists, its value for
  the last programme is used; only where it does not does the adapter fall back to counting flow
  meter impulses (field 21 / 200, verified against the house water meter over 24 programmes). The
  new datapoint `eco.source` (called `eco.quelle` before 0.3.45) says which of the two a value came from.
- **The collector records every leaf.** At the end of a programme the adapter reads each answering
  leaf once, gently (five seconds between requests, in the background), and appends the final state
  to the record. This is what makes the collection useful for appliances that do not answer 2/6195
  at all - a dishwasher that stays silent there answers nineteen other addresses. The CSV export
  lists them as columns named `2/119.1 hoursOfOperation`.
- **Leaf scan covers unit 14.** An oven that answered all 882 scanned addresses with 404 was being
  asked in the wrong units: `ha-miele-at-lan` documents the cooking programme lists at 14/1570 and
  14/1571.

## 0.3.36
- **Fix: the final water reading of short programs is no longer missed.** With the regular ten-minute interval the last reading of a 35-minute
  program fell up to nine minutes before the end, and the appliance resets its counters
  immediately afterwards - the intermediate value was then stored as the final one. Eco
  readings now switch to a one-minute interval for the last ten minutes of a program.
- A reading that still did not catch the end is **kept but marked**: it counts as a gap
  rather than as a deviation, so a correct field assignment no longer looks faulty.
- **Admin translations completed.** Twelve texts of the settings page had no translation
  entry and showed German to every other language; six stale keys were removed and the
  language files moved to the short format (`admin/i18n/<lang>.json`). A test now keeps
  the translations and `jsonConfig.json` in step.
- Configurable intervals are capped at runtime - Node fires a timer above 2^31-1 ms
  immediately instead of late.
- `npm run test:unit` now picks up every test file; three of them had never run.
- Leaf scan: a pass aborted because the appliance is busy is now logged as info instead of a
  warning - it is expected during programmes and resumes automatically from the saved progress.
- **Object structure check:** the data points added since 0.3.5 (data collection, metering
  socket, operating hours) now carry names in all eleven languages, and the two input fields
  for values from the Miele app use the writable role `level` instead of read-only `value.*`
  roles. Existing objects are updated on start; a new test fails whenever a data point name
  lacks one of the eleven languages.
- Repository checker: `common.news` limited to published versions and translated into all eleven
  languages, size attributes for the new settings, `node:http` instead of `http`, contact e-mail
  address in `package.json`, `io-package.json` and README.
- **Fix: water field divisor.** The setting was a unit select with 1, 10 or 100, while the default
  for field 21 is 200 (5 ml per step) - the correct value could not be selected, and a missing
  value fell back to 100 in one place and 10 in another. It is now a free number ("water field
  divisor", decimals allowed, default 200); invalid values fall back to 200.
- **Fix: the measured energy of the metering socket was dropped** before it reached the
  field check - every collected cycle lacked it. The field check now compares energy
  fields against the measurement instead of the cloud value rounded to 0.1 kWh.

## 0.3.18
- Leaf scan now separates a genuine refusal from a fault - a 503 or dropped socket no longer marks an address as checked that was never really asked.

## 0.3.17
- Leaf scan with short timeout and incremental saving - a full pass takes minutes instead of hours.

## 0.3.16
- Leaf scan: systematically probes the appliance for DOP2 leaves and records their fields - two passes (idle and running) reveal which fields move with the programme.

## 0.3.15
- Ongoing check: compares delivered values against cloud or app readings after each cycle and reports when the field mapping drifts.

## 0.3.14
- Water consumption verified: field 21 at 5 ml per count matches within 0.5% (8 cycles against the cloud) - field 26 was configured before and carries no measurement at all.

## 0.3.13
- Field analysis detects empty fields and rigidly coupled values - a field that is a fixed multiple of another carries no measurement of its own.

## 0.3.12
- Field analysis: evaluates collected cycles and reports which field carries energy and water - a field that stays constant is rejected.

## 0.3.11
- Renaming of the energy fields now actually takes effect - it was reset by object creation as soon as a programme was running.

## 0.3.10
- Total operating hours from DOP2 leaf 2/119.

## 0.3.9
- Water field corrected (#26); hold rule no longer keeps stale values during a run.

## 0.3.8
- Water value of a finished programme is kept instead of falling back to zero.

## 0.3.7
- Water consumption read from the correct field; eco field indices are now configurable.

## 0.3.6
- Optional raw eco field recording for diagnosing model-specific field indices.

## 0.3.5
- **Fix: appliance status no longer flips to "off" during a running program.** A failed status
  request was reported as a state change instead of being retried; every twenty-fifth poll
  produced a spurious "off". Requests now get a second attempt, and an implausible jump from
  "running" to "off" is discarded when the remaining time says the program is still going.
  The retry count is exposed as `info.pollRetries`.
- **Fix: remaining time was read from the wrong field.** `remainingSeconds` carries only the
  seconds component - at "2:01" it reads 0. The plausibility check now uses
  `remainingMinutes`.
- **Fix: frozen EcoFeedback values are no longer booked as consumption.** When an appliance
  keeps reporting the previous cycle's figures, the unchanged value is skipped instead of
  being added to the new cycle.
- Requests are serialised per appliance, and a cycle now survives an adapter restart.
- **EcoFeedback is only requested while an appliance is actually running.** The DOP2 leaf
  only answers while the appliance is awake - a switched-off machine returns HTTP 500. The
  washing machine's last reading came in mid-programme; afterwards every poll ran into the
  void, one per minute for days, each one occupying the XKM module that answers only one
  request at a time. Polling now happens while a programme runs, during a ten-minute
  follow-up afterwards (the final reading is not settled the moment the status flips), and
  once at startup so that appliances without the leaf can still be identified. The follow-up
  ends early once two consecutive readings are identical.
- **All object names are complete in eleven languages.** The repository check reported 147
  W1001 warnings for `common.name`; channels, EcoFeedback data points, appliance names and the
  instance objects were still English- or German-only. Appliance categories are translated
  while model and serial number stay untouched - they are proper names.

## 0.3.4
- **New: cycle history.** Every completed program is recorded with duration, program name,
  energy and water. The appliances do not keep finished cycles themselves, so the history
  starts when the feature is enabled - it cannot be filled retroactively. Recent cycles are
  kept as JSON in `<serial>.history.cyclesJson`, alongside running totals for cycle count,
  runtime, energy and water. Optionally each cycle is also written to the history adapter,
  timestamped at the end of the cycle, so charts can cover any period.
  Configurable on the new **History** tab: ring buffer size (default 50), retention in days
  (default 730) and the history instance.
- The step-by-step login instructions were stored in English in nine of the eleven language
  files. All eight texts are now translated into es, fr, it, nl, pl, pt, ru, uk and zh-cn.
- `common.news` no longer lists versions that were never published to npm.
- Dependabot: raised the PR limit, spread the schedule over a cron slot, added automerge.

## 0.3.3
- Fix E3005: states declared as `number` no longer receive `null` when the appliance does not
  report a value - the datapoint keeps its default instead. `estimatedEndTime` is cleared with
  0 rather than null.
- Fix E1011: `state.light` is read-only and now carries role `sensor.light`; switching happens
  through `control.lightOn`/`lightOff`.

## 0.3.2
- EcoFeedback conversion moved into `dop2.ecoValues()` and covered by unit tests against the
  cloud-verified reference values (1991 Wh = 1.991 kWh, 953 = 95.3 l).

## 0.3.1
- Fix: `applyIdent` threw on the new `connected` field, which has no ident path. Because that
  entry comes first, **all** device data stayed empty - model, serial number, firmware.
- Eco polling now logs why it skips a device instead of failing silently.

## 0.3.0
- Adopt ioBroker development guidelines and conformity rules.
- Translate internal log messages to pure English.
- Add explicit default metadata values (`def`) to all state definitions.
- Sanitize dynamic object IDs against forbidden characters.
- Add local verification test script (`npm run test:local`).
- Add German documentation (`README_de.md`).
- Fix dev-server packaging issue by removing redundant prepare script.
- Clarify step-by-step login instructions and i18n translations.
- Add CHANGELOG_OLD.md for historical pre-rename versions.
- Add per-device connectivity state (`info.connected`).
- Add periodic background discovery for waking/standby appliances.
- Add admin UI configuration for second-precise remaining time polling.
- Refine EcoFeedback state roles and measurement units.
- mDNS auto-discovery is no longer marked experimental - confirmed working.

Most of the above was contributed by [meistermopper](https://github.com/meistermopper).

## 0.2.1
- Released via GitHub Actions with npm provenance (trusted publishing). No functional
  changes.

## 0.2.0
- Renamed from `miele-lokal` to `miele-local`: English adapter name and title.
  First release under the new package name.

## 0.1.1 (2026-08-17)
* (Immanuel) Released via GitHub Actions with npm provenance (trusted publishing). Published under former package name `iobroker.miele-lokal`.

## 0.1.0 (2026-08-17)
* (Immanuel) Initial release: login/GroupKey retrieval, mDNS discovery, state polling with enum decoding, optional SuperVision push, optional control. Published under former package name `iobroker.miele-lokal`.
