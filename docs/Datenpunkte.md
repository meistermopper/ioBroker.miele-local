# Datenpunkt-Referenz — ioBroker.miele-local

Objektbaum pro Gerät: `miele-local.0.<Seriennummer>.…`. Deutsche Namen erscheinen, wenn die
Checkbox „Datenpunkt-Namen auf Deutsch" aktiv ist (Standard). Enum-Felder gibt es doppelt:
`*Text` (Klartext) und der reine Rohwert.

## info (statisch, aus `/Ident`)

| Datenpunkt | Deutscher Name | Typ | Bedeutung |
|---|---|---|---|
| `info.techType` | Gerätetyp (Technik) | string | Modellkürzel, z. B. WCR860, G5840, H2469BP |
| `info.fabNumber` | Seriennummer | string | Fabrikationsnummer |
| `info.matNumber` | Materialnummer | string | Miele-Materialnummer |
| `info.deviceType` | Gerätetyp | number | numerischer Gerätetyp (1=Waschm., 7=Spülm., 12=Backofen …) |
| `info.xkmType` | Kommunikationsmodul-Typ | string | WLAN-Modul, z. B. EK037/EK057 |
| `info.xkmVersion` | Kommunikationsmodul-Firmware | string | Firmware des Moduls |
| `info.protocolVersion` | Protokollversion | number | DOP2/Protokollversion |

## state (live, aus `/State`)

| Datenpunkt | Deutscher Name | Typ | Einheit | Bedeutung |
|---|---|---|---|---|
| `state.statusText` / `state.status` | Status | string/number | | off/on/in_use/pause/program_ended/failure/service … |
| `state.programTypeText` / `state.programType` | Programmart | string/number | | Programmart (Enum) |
| `state.programText` / `state.programId` | Programmbezeichnung | string/number | | laufendes Programm (Klartext je Gerätetyp) |
| `state.programPhaseText` / `state.programPhase` | Programmphase | string/number | | Phase (z. B. Vorwäsche, Hauptwäsche, Spülen) |
| `state.remainingMinutes` | Restzeit | number | min | verbleibende Zeit |
| `state.progress` | Programmfortschritt | number | % | seit 0.5.0: verstrichen / (verstrichen + Rest), nur bei Status 5/6, sonst 0 |
| `state.elapsedMinutes` | Verstrichene Zeit | number | min | seit Programmstart |
| `state.startInMinutes` | Startvorwahl | number | min | verbleibende Startverzögerung |
| `state.temperature` / `…Zone2` / `…Zone3` | Temperatur | number | °C | Ist-Temperatur je Zone (null = n/v) |
| `state.targetTemperature` / `…Zone2` / `…Zone3` | Zieltemperatur | number | °C | Soll-Temperatur je Zone |
| `state.signalDoor` | Tür offen | boolean | | Türsignal |
| `state.signalInfo` | Info-Signal | boolean | | Info-Signal aktiv |
| `state.signalFailure` | Störungssignal | boolean | | Störung/Fehler aktiv |
| `state.mobileStart` | MobileStart verfügbar | boolean | | Fernsteuerung am Gerät freigegeben |
| `state.remoteEnableRaw` | Fernsteuer-Freigabe (Rohwert) | string | | RemoteEnable-Array (Rohwert) |
| `state.light` | Licht | boolean | | Beleuchtung an |
| `state.spinningSpeed` | Schleuderdrehzahl | number | rpm | nur Waschmaschine |
| `state.dryingStepText` / `state.dryingStep` | Trockenstufe | string/number | | nur Trockner |
| `state.processAction` | Prozess-Aktion | number | | interner Zustand |
| `state.deviceAction` | Geräte-Aktion | number | | interner Zustand |
| `state.standbyState` | Standby-Zustand | number | | Standby-Code |
| `state.syncState` | Sync-Zustand | number | | Synchronisationscode |
| `state.internalState` | Interner Zustand | number | | interner Code |

## eco (EcoFeedback, aus DOP2 2/6195 — nur wo verfügbar, bisher Waschmaschine)

| Datenpunkt | Deutscher Name | Typ | Einheit | Bedeutung |
|---|---|---|---|---|
| `eco.energy` | Energieverbrauch | number | kWh | aktueller Verbrauch (Feld #25 ÷ 1000) |
| `eco.energyWh` | Energieverbrauch (Rohwert Wh) | number | Wh | Rohwert Feld #25 |
| `eco.water` | Wasserverbrauch | number | l | aktueller Verbrauch (Feld #40 ÷ 10) |

## control (nur bei aktivierter Steuerung — beschreibbar)

Erfordert „MobileStart/Fernsteuerung" am Gerät. Auslösen durch Setzen auf `true` (danach
setzt der Adapter automatisch zurück).

| Datenpunkt | Deutscher Name | Opcode | Bedeutung |
|---|---|---|---|
| `control.start` | Programm starten | 0x01 | Programm/Vorwahl starten |
| `control.stop` | Programm stoppen | 0x37 | Programm abbrechen |
| `control.pause` | Programm pausieren | 0x03 | pausieren |
| `control.powerOn` | Einschalten | 2/1586 = 4, Rückfall 0x10 | Gerät einschalten (seit 0.4.3 wie die App, siehe DOP2-Protokoll.md) |
| `control.powerOff` | Ausschalten | 2/1586 = 1, Rückfall 0x13 | Gerät ausschalten |
| `control.lightOn` | Licht an | 0x0d | Beleuchtung ein |
| `control.lightOff` | Licht aus | 0x0e | Beleuchtung aus |
| `control.canPowerOn` … `canStop` | Einschalten/Ausschalten/Start/Pause/Stopp möglich | – | seit 0.5.0, nur lesen: Befehl im jetzigen Zustand sinnvoll und vom Gerät unterstützt (lib/geraetemanager.js `angebot`); die Gerätekarten blenden ihre Knöpfe damit live ein und aus |

## info (Instanz-weit)

| Datenpunkt | Bedeutung |
|---|---|
| `info.connection` | true, wenn mindestens ein Gerät erreichbar |
| `info.discoveredDevices` | JSON der (per mDNS) gefundenen Geräte |
