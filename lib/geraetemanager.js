'use strict';

/*
 * Geraetekarten fuer den ioBroker Device-Manager (Issue #22, Anregung von mcm1957).
 *
 * WAS DIE KARTEN SIND. Je Kuechen- und Waschgeraet eine Karte mit dem laufenden Betrieb:
 * Geraetename und Modell im Kopf, die Seriennummer einmal im Text, Erreichbarkeit, Status,
 * Programm, Phase, Restzeit, Programmende und ein Fortschrittsbalken. Stoerung, offene Tuer und
 * Hinweise des Geraets erscheinen als farbige Zeile, solange sie anstehen. Dazu - nur wenn die
 * Steuerung in der Instanz freigeschaltet ist - die Alltagsknoepfe, und zwar nur die, die im
 * jetzigen Zustand sinnvoll sind (angebot).
 *
 * WAS SIE NICHT SIND. Keine Konfiguration: kein Suchen, kein Koppeln, kein Hinzufuegen oder
 * Entfernen, keine Diagnose- oder Erkundungswerkzeuge, keine Instanz-Aktionen. Das bleibt auf
 * der Einstellungsseite und im Diagnose-Reiter (Vorgabe des Nutzers: "Karten nur fuer dauerhafte
 * Funktion, nicht fuer Config-Aufgaben").
 *
 * WARUM DIE KNOEPFE IN DER STATUSZEILE STEHEN. Der Admin (8.3, dm-gui-components 10.0) laedt die
 * Knoepfe einer Karte nur beim Oeffnen der Seite; eine Rueckmeldung des Adapters ("Karte neu
 * zeichnen") wertet er nicht aus. Live folgen nur Statusanzeigen (indicators) ihrem Datenpunkt -
 * und eine Statusanzeige kann einen Knopf ausloesen (actionId) und verschwindet, solange ihr Wert
 * false ist. Deshalb rechnet der Adapter je Befehl einen Datenpunkt control.can<Befehl> aus, und
 * jeder Knopf ist eine Statusanzeige, die daran haengt. Endet ein Programm, verschwinden Pause und
 * Stopp, ohne dass jemand die Seite neu laden muss. Die Bestaetigungsabfrage der Aktion bleibt.
 *
 * WARUM DIE ZEILEN SICH SELBST AUSBLENDEN. Die Werte auf der Karte sind JSON-Config-Zeilen
 * (customInfo), keine info-Controls: die zeigt der Admin nur im Bedien-Dialog. Leere Werte
 * (kein Programm, keine Restzeit) blendet jede Zeile ueber dependsOnStates + hidden selbst aus.
 *
 * WARUM STATUS, PROGRAMM UND PHASE AM ROHWERT HAENGEN. Die Textdatenpunkte (statusText …)
 * schreibt der Adapter nur auf Deutsch oder Englisch - fuer Skripte, die damit vergleichen,
 * bleibt das so. Die Karte zeigt stattdessen den Rohwert und gibt ihm eine Wertetabelle in der
 * Systemsprache mit (JSON-Config "options", siehe lib/werte.js). So steht bei einem
 * franzoesischen ioBroker "En utilisation" statt "In Betrieb", ohne dass sich ein Datenpunkt
 * aendert. Unbekannte Rohwerte erscheinen als Zahl.
 *
 * WIE DIE KNOEPFE SCHALTEN. Nicht selbst, sondern ueber die vorhandenen Datenpunkte
 * control.<befehl>: Der Knopf schreibt true mit ack=false - genau wie ein Skript oder VIS - und
 * wartet, bis lib/befehle.js den Befehl abgeschlossen hat. Damit gelten dieselben Pruefungen
 * (Steuerung freigegeben, Geraet verbunden, MobileStart) und dieselbe Rueckmeldung im Feld c.
 */

const { DeviceManagement } = require('@iobroker/dm-utils');
const objdef = require('./objects');
const namen = require('./names');
const werte = require('./werte');

/** Knopf- und Meldungstexte. {befehl}, {grund} und {sekunden} werden eingesetzt. */
const TEXTE = {
    serial: {
        en: 'Serial number',
        de: 'Seriennummer',
        ru: 'Серийный номер',
        pt: 'Número de série',
        nl: 'Serienummer',
        fr: 'Numéro de série',
        it: 'Numero di serie',
        es: 'Número de serie',
        pl: 'Numer seryjny',
        uk: 'Серійний номер',
        'zh-cn': '序列号',
    },
    powerOn: {
        en: 'On',
        de: 'Ein',
        ru: 'Вкл.',
        pt: 'Ligar',
        nl: 'Aan',
        fr: 'Marche',
        it: 'Accendi',
        es: 'Encender',
        pl: 'Włącz',
        uk: 'Увімк.',
        'zh-cn': '开机',
    },
    powerOff: {
        en: 'Off',
        de: 'Aus',
        ru: 'Выкл.',
        pt: 'Desligar',
        nl: 'Uit',
        fr: 'Arrêt',
        it: 'Spegni',
        es: 'Apagar',
        pl: 'Wyłącz',
        uk: 'Вимк.',
        'zh-cn': '关机',
    },
    start: {
        en: 'Start',
        de: 'Start',
        ru: 'Старт',
        pt: 'Iniciar',
        nl: 'Start',
        fr: 'Démarrer',
        it: 'Avvia',
        es: 'Iniciar',
        pl: 'Start',
        uk: 'Старт',
        'zh-cn': '启动',
    },
    pause: {
        en: 'Pause',
        de: 'Pause',
        ru: 'Пауза',
        pt: 'Pausa',
        nl: 'Pauze',
        fr: 'Pause',
        it: 'Pausa',
        es: 'Pausa',
        pl: 'Pauza',
        uk: 'Пауза',
        'zh-cn': '暂停',
    },
    stop: {
        en: 'Stop',
        de: 'Stopp',
        ru: 'Стоп',
        pt: 'Parar',
        nl: 'Stop',
        fr: 'Arrêter',
        it: 'Ferma',
        es: 'Detener',
        pl: 'Stop',
        uk: 'Стоп',
        'zh-cn': '停止',
    },
    lightOn: {
        en: 'Light on',
        de: 'Licht an',
        ru: 'Свет вкл.',
        pt: 'Luz ligada',
        nl: 'Licht aan',
        fr: 'Lumière allumée',
        it: 'Luce accesa',
        es: 'Luz encendida',
        pl: 'Światło wł.',
        uk: 'Світло увімк.',
        'zh-cn': '开灯',
    },
    lightOff: {
        en: 'Light off',
        de: 'Licht aus',
        ru: 'Свет выкл.',
        pt: 'Luz desligada',
        nl: 'Licht uit',
        fr: 'Lumière éteinte',
        it: 'Luce spenta',
        es: 'Luz apagada',
        pl: 'Światło wył.',
        uk: 'Світло вимк.',
        'zh-cn': '关灯',
    },
    tipPowerOn: {
        en: 'Switch the appliance on',
        de: 'Gerät einschalten',
        ru: 'Включить прибор',
        pt: 'Ligar o aparelho',
        nl: 'Apparaat inschakelen',
        fr: 'Allumer l’appareil',
        it: 'Accendere l’apparecchio',
        es: 'Encender el aparato',
        pl: 'Włącz urządzenie',
        uk: 'Увімкнути прилад',
        'zh-cn': '打开设备',
    },
    tipPowerOff: {
        en: 'Switch the appliance off (standby)',
        de: 'Gerät ausschalten (Bereitschaft)',
        ru: 'Выключить прибор (режим ожидания)',
        pt: 'Desligar o aparelho (standby)',
        nl: 'Apparaat uitschakelen (stand-by)',
        fr: 'Éteindre l’appareil (veille)',
        it: 'Spegnere l’apparecchio (standby)',
        es: 'Apagar el aparato (modo de espera)',
        pl: 'Wyłącz urządzenie (czuwanie)',
        uk: 'Вимкнути прилад (режим очікування)',
        'zh-cn': '关闭设备（待机）',
    },
    tipStart: {
        en: 'Start or resume the programme selected on the appliance',
        de: 'Am Gerät gewähltes Programm starten oder fortsetzen',
        ru: 'Запустить или продолжить программу, выбранную на приборе',
        pt: 'Iniciar ou retomar o programa selecionado no aparelho',
        nl: 'Op het apparaat gekozen programma starten of hervatten',
        fr: 'Démarrer ou reprendre le programme choisi sur l’appareil',
        it: 'Avviare o riprendere il programma scelto sull’apparecchio',
        es: 'Iniciar o reanudar el programa elegido en el aparato',
        pl: 'Uruchom lub wznów program wybrany na urządzeniu',
        uk: 'Запустити або продовжити програму, вибрану на приладі',
        'zh-cn': '启动或继续在设备上选择的程序',
    },
    tipPause: {
        en: 'Pause the running programme',
        de: 'Laufendes Programm anhalten',
        ru: 'Приостановить текущую программу',
        pt: 'Pausar o programa em curso',
        nl: 'Lopend programma pauzeren',
        fr: 'Mettre en pause le programme en cours',
        it: 'Mettere in pausa il programma in corso',
        es: 'Pausar el programa en curso',
        pl: 'Wstrzymaj trwający program',
        uk: 'Призупинити поточну програму',
        'zh-cn': '暂停正在运行的程序',
    },
    tipStop: {
        en: 'Abort the programme',
        de: 'Programm abbrechen',
        ru: 'Прервать программу',
        pt: 'Cancelar o programa',
        nl: 'Programma afbreken',
        fr: 'Interrompre le programme',
        it: 'Interrompere il programma',
        es: 'Cancelar el programa',
        pl: 'Przerwij program',
        uk: 'Перервати програму',
        'zh-cn': '中止程序',
    },
    tipLightOnOven: {
        en: 'Oven cavity light is off – click to switch it on',
        de: 'Garraumbeleuchtung ist aus – klicken zum Einschalten',
        ru: 'Подсветка рабочей камеры выключена – нажмите, чтобы включить',
        pt: 'A iluminação do interior está desligada – clique para ligar',
        nl: 'Binnenverlichting van de ovenruimte is uit – klik om in te schakelen',
        fr: 'L’éclairage de l’enceinte est éteint – cliquez pour l’allumer',
        it: 'La luce del vano cottura è spenta – fare clic per accenderla',
        es: 'La luz del interior del horno está apagada – haga clic para encenderla',
        pl: 'Oświetlenie komory jest wyłączone – kliknij, aby włączyć',
        uk: 'Підсвічування робочої камери вимкнене – натисніть, щоб увімкнути',
        'zh-cn': '炉腔照明已关闭 – 点击打开',
    },
    tipLightOffOven: {
        en: 'Oven cavity light is on – click to switch it off',
        de: 'Garraumbeleuchtung ist an – klicken zum Ausschalten',
        ru: 'Подсветка рабочей камеры включена – нажмите, чтобы выключить',
        pt: 'A iluminação do interior está ligada – clique para desligar',
        nl: 'Binnenverlichting van de ovenruimte is aan – klik om uit te schakelen',
        fr: 'L’éclairage de l’enceinte est allumé – cliquez pour l’éteindre',
        it: 'La luce del vano cottura è accesa – fare clic per spegnerla',
        es: 'La luz del interior del horno está encendida – haga clic para apagarla',
        pl: 'Oświetlenie komory jest włączone – kliknij, aby wyłączyć',
        uk: 'Підсвічування робочої камери увімкнене – натисніть, щоб вимкнути',
        'zh-cn': '炉腔照明已打开 – 点击关闭',
    },
    tipLightOnHood: {
        en: 'Cooktop light of the hood is off – click to switch it on',
        de: 'Kochfeldbeleuchtung der Haube ist aus – klicken zum Einschalten',
        ru: 'Подсветка вытяжки выключена – нажмите, чтобы включить',
        pt: 'A iluminação do exaustor está desligada – clique para ligar',
        nl: 'Verlichting van de afzuigkap is uit – klik om in te schakelen',
        fr: 'L’éclairage de la hotte est éteint – cliquez pour l’allumer',
        it: 'La luce della cappa è spenta – fare clic per accenderla',
        es: 'La luz de la campana está apagada – haga clic para encenderla',
        pl: 'Oświetlenie okapu jest wyłączone – kliknij, aby włączyć',
        uk: 'Підсвічування витяжки вимкнене – натисніть, щоб увімкнути',
        'zh-cn': '油烟机照明已关闭 – 点击打开',
    },
    tipLightOffHood: {
        en: 'Cooktop light of the hood is on – click to switch it off',
        de: 'Kochfeldbeleuchtung der Haube ist an – klicken zum Ausschalten',
        ru: 'Подсветка вытяжки включена – нажмите, чтобы выключить',
        pt: 'A iluminação do exaustor está ligada – clique para desligar',
        nl: 'Verlichting van de afzuigkap is aan – klik om uit te schakelen',
        fr: 'L’éclairage de la hotte est allumé – cliquez pour l’éteindre',
        it: 'La luce della cappa è accesa – fare clic per spegnerla',
        es: 'La luz de la campana está encendida – haga clic para apagarla',
        pl: 'Oświetlenie okapu jest włączone – kliknij, aby wyłączyć',
        uk: 'Підсвічування витяжки увімкнене – натисніть, щоб вимкнути',
        'zh-cn': '油烟机照明已打开 – 点击关闭',
    },
    confirm: {
        en: 'Send “{befehl}” to the appliance now?',
        de: '„{befehl}“ jetzt an das Gerät senden?',
        ru: 'Отправить «{befehl}» на прибор сейчас?',
        pt: 'Enviar «{befehl}» ao aparelho agora?',
        nl: '“{befehl}” nu naar het apparaat sturen?',
        fr: 'Envoyer « {befehl} » à l’appareil maintenant ?',
        it: 'Inviare «{befehl}» all’apparecchio adesso?',
        es: '¿Enviar «{befehl}» al aparato ahora?',
        pl: 'Wysłać teraz „{befehl}” do urządzenia?',
        uk: 'Надіслати «{befehl}» на прилад зараз?',
        'zh-cn': '现在向设备发送“{befehl}”？',
    },
    failed: {
        en: 'The command was not executed: {grund}',
        de: 'Der Befehl wurde nicht ausgeführt: {grund}',
        ru: 'Команда не выполнена: {grund}',
        pt: 'O comando não foi executado: {grund}',
        nl: 'De opdracht is niet uitgevoerd: {grund}',
        fr: 'La commande n’a pas été exécutée : {grund}',
        it: 'Il comando non è stato eseguito: {grund}',
        es: 'El comando no se ha ejecutado: {grund}',
        pl: 'Polecenie nie zostało wykonane: {grund}',
        uk: 'Команду не виконано: {grund}',
        'zh-cn': '命令未执行：{grund}',
    },
    timeout: {
        en: 'No confirmation within {sekunden} seconds. The result will appear in the control state.',
        de: 'Keine Bestätigung innerhalb von {sekunden} Sekunden. Das Ergebnis erscheint im Steuer-Datenpunkt.',
        ru: 'Нет подтверждения в течение {sekunden} секунд. Результат появится в точке данных управления.',
        pt: 'Sem confirmação em {sekunden} segundos. O resultado aparecerá no estado de controlo.',
        nl: 'Geen bevestiging binnen {sekunden} seconden. Het resultaat verschijnt in het stuurdatapunt.',
        fr: 'Pas de confirmation en {sekunden} secondes. Le résultat apparaîtra dans l’état de commande.',
        it: 'Nessuna conferma entro {sekunden} secondi. Il risultato apparirà nello stato di controllo.',
        es: 'Sin confirmación en {sekunden} segundos. El resultado aparecerá en el estado de control.',
        pl: 'Brak potwierdzenia w ciągu {sekunden} sekund. Wynik pojawi się w stanie sterującym.',
        uk: 'Немає підтвердження протягом {sekunden} секунд. Результат з’явиться в точці даних керування.',
        'zh-cn': '{sekunden} 秒内未收到确认。结果将显示在控制数据点中。',
    },
    fault: {
        en: 'Fault – please check the appliance',
        de: 'Störung – bitte am Gerät nachsehen',
        ru: 'Неисправность – проверьте прибор',
        pt: 'Avaria – verifique o aparelho',
        nl: 'Storing – controleer het apparaat',
        fr: 'Panne – veuillez vérifier l’appareil',
        it: 'Guasto – controllare l’apparecchio',
        es: 'Avería – revise el aparato',
        pl: 'Usterka – sprawdź urządzenie',
        uk: 'Несправність – перевірте прилад',
        'zh-cn': '故障 – 请检查设备',
    },
    door: {
        en: 'Door open',
        de: 'Tür offen',
        ru: 'Дверца открыта',
        pt: 'Porta aberta',
        nl: 'Deur open',
        fr: 'Porte ouverte',
        it: 'Sportello aperto',
        es: 'Puerta abierta',
        pl: 'Drzwi otwarte',
        uk: 'Дверцята відчинені',
        'zh-cn': '门已打开',
    },
    notice: {
        en: 'Notice on the appliance display – please check the appliance',
        de: 'Hinweis im Gerätedisplay – bitte am Gerät nachsehen',
        ru: 'Сообщение на дисплее прибора – проверьте прибор',
        pt: 'Aviso no visor do aparelho – verifique o aparelho',
        nl: 'Melding op het display – controleer het apparaat',
        fr: 'Message sur l’écran de l’appareil – veuillez vérifier l’appareil',
        it: 'Avviso sul display dell’apparecchio – controllare l’apparecchio',
        es: 'Aviso en la pantalla del aparato – revise el aparato',
        pl: 'Komunikat na wyświetlaczu – sprawdź urządzenie',
        uk: 'Повідомлення на дисплеї приладу – перевірте прилад',
        'zh-cn': '设备显示屏上有提示 – 请检查设备',
    },
    program: {
        en: 'Programme',
        de: 'Programm',
        ru: 'Программа',
        pt: 'Programa',
        nl: 'Programma',
        fr: 'Programme',
        it: 'Programma',
        es: 'Programa',
        pl: 'Program',
        uk: 'Програма',
        'zh-cn': '程序',
    },
    phase: {
        en: 'Phase',
        de: 'Phase',
        ru: 'Фаза',
        pt: 'Fase',
        nl: 'Fase',
        fr: 'Phase',
        it: 'Fase',
        es: 'Fase',
        pl: 'Faza',
        uk: 'Фаза',
        'zh-cn': '阶段',
    },
    noMobileStart: {
        en: 'Remote start locked – enable MobileStart on the appliance',
        de: 'Fernstart gesperrt – MobileStart am Gerät aktivieren',
        ru: 'Дистанционный запуск заблокирован – включите MobileStart на приборе',
        pt: 'Arranque remoto bloqueado – ative o MobileStart no aparelho',
        nl: 'Starten op afstand geblokkeerd – MobileStart op het apparaat activeren',
        fr: 'Démarrage à distance bloqué – activez MobileStart sur l’appareil',
        it: 'Avvio a distanza bloccato – attivare MobileStart sull’apparecchio',
        es: 'Inicio remoto bloqueado – active MobileStart en el aparato',
        pl: 'Zdalny start zablokowany – włącz MobileStart na urządzeniu',
        uk: 'Дистанційний запуск заблоковано – увімкніть MobileStart на приладі',
        'zh-cn': '远程启动已锁定 – 请在设备上启用 MobileStart',
    },
    remaining: {
        en: 'Remaining',
        de: 'Restzeit',
        ru: 'Осталось',
        pt: 'Tempo restante',
        nl: 'Resterend',
        fr: 'Temps restant',
        it: 'Tempo rimanente',
        es: 'Tiempo restante',
        pl: 'Pozostało',
        uk: 'Залишилось',
        'zh-cn': '剩余时间',
    },
    endsAt: {
        en: 'Ends at',
        de: 'Ende um',
        ru: 'Окончание в',
        pt: 'Termina às',
        nl: 'Klaar om',
        fr: 'Fin à',
        it: 'Termina alle',
        es: 'Termina a las',
        pl: 'Koniec o',
        uk: 'Завершення о',
        'zh-cn': '结束时间',
    },
    startsAt: {
        en: 'Starts at',
        de: 'Start um',
        ru: 'Запуск в',
        pt: 'Começa às',
        nl: 'Start om',
        fr: 'Démarre à',
        it: 'Inizia alle',
        es: 'Empieza a las',
        pl: 'Start o',
        uk: 'Запуск о',
        'zh-cn': '开始时间',
    },
};

/**
 * Text mit eingesetzten Platzhaltern in allen Sprachen.
 *
 * @param {string} schluessel Eintrag in TEXTE
 * @param {Record<string, string|number|Record<string, string>>} [werte] Platzhalter; ein
 *   Sprachobjekt wird je Sprache eingesetzt, alles andere unveraendert
 * @returns {Record<string, string>} Text je Sprache
 */
function text(schluessel, werte = {}) {
    const vorlage = TEXTE[schluessel];
    const aus = {};
    for (const [sp, t] of Object.entries(vorlage)) {
        aus[sp] = t.replace(/\{(\w+)\}/g, (ganz, name) => {
            const w = werte[name];
            if (w === undefined || w === null) {
                return ganz;
            }
            return typeof w === 'object' ? w[sp] || w.en : String(w);
        });
    }
    return aus;
}

/**
 * Textdatenpunkt -> [Rohwert-Datenpunkt, Art in lib/werte.js]. Die Karte zeigt den Rohwert mit
 * Wertetabelle in der Systemsprache; Beschriftung bleibt der Name des Textdatenpunkts.
 */
const ROHWERT = {
    'state.statusText': ['state.status', 'status'],
    'state.programText': ['state.programId', 'program'],
    'state.programPhaseText': ['state.programPhase', 'phase'],
    'state.programTypeText': ['state.programType', 'programType'],
    'state.dryingStepText': ['state.dryingStep', 'dryingStep'],
};

/**
 * Anzeige eines Textdatenpunkts ueber seinen Rohwert, wenn moeglich.
 *
 * @param {string} sub Textdatenpunkt, z. B. "state.statusText"
 * @param {(sub: string) => boolean} hat ob das Objekt existiert
 * @param {string} sprache Systemsprache
 * @param {number|null} deviceType Miele-Geraeteart
 * @returns {{sub: string, options: object[], leer: number[]}|null} Rohwert mit Tabelle, oder null
 */
function rohAnzeige(sub, hat, sprache, deviceType) {
    const r = ROHWERT[sub];
    if (!r || !hat(r[0])) {
        return null;
    }
    const t = werte.werteTabelle(r[1], sprache, deviceType);
    return t ? { sub: r[0], options: t.options, leer: t.leer } : null;
}

/** Weitere Betriebswerte, die beim Aufklappen erscheinen - nur, wenn das Geraet sie hat. */
const DETAILS = [
    'state.programTypeText',
    'state.elapsedHHMM',
    'state.startHHMM',
    'state.temperature',
    'state.targetTemperature',
    'state.temperatureZone2',
    'state.targetTemperatureZone2',
    'state.temperatureZone3',
    'state.targetTemperatureZone3',
    'state.spinningSpeed',
    'state.dryingStepText',
    'state.light',
    'state.mobileStart',
    'eco.energy',
    'eco.water',
    'info.operatingHours',
    'info.techType',
];

/** Alltagsbefehle in Anzeigereihenfolge. Licht nur bei Geraeten mit Licht. */
const BEFEHLE = ['powerOn', 'powerOff', 'start', 'pause', 'stop', 'lightOn', 'lightOff'];

/** Befehle, die je nach Zustand angeboten werden (alle ausser Licht). */
const ZUSTANDSBEFEHLE = ['powerOn', 'powerOff', 'start', 'pause', 'stop'];

/**
 * Welche Befehle in welchem Status sinnvoll sind (Miele-Statuscodes, lib/enums.js StateStatus).
 *
 * Aus → Ein. Bereit/programmiert → Start, Aus (wartet die Startvorwahl, auch Stopp). Laeuft →
 * Pause, Stopp. Pausiert → Start (fortsetzen), Stopp. Ende, Stoerung, Leerlauf → Aus.
 * Unterbrochen → Stopp, Aus. Spuelstopp → Start, Stopp. Alles andere (Service, Kuehlbetrieb,
 * gesperrt, Selbstreinigung, nicht verbunden): kein Knopf.
 */
const ANGEBOT_JE_STATUS = {
    1: ['powerOn'],
    2: ['start', 'powerOff'],
    3: ['start', 'powerOff'],
    4: ['start', 'stop', 'powerOff'],
    5: ['pause', 'stop'],
    6: ['start', 'stop'],
    7: ['powerOff'],
    8: ['powerOff'],
    9: ['stop', 'powerOff'],
    10: ['powerOff'],
    11: ['start', 'stop'],
};

/**
 * Geraetearten mit Programmen, die sich starten und abbrechen lassen: Waschmaschine, Trockner,
 * Spuelmaschine, Waschtrockner und die Garraeume (Backofen, mit Mikrowelle, Dampfgarer,
 * Dampfbackofen, Mikrowelle, Kombigeraete 31/45).
 */
const PROGRAMM_ARTEN = new Set([1, 2, 7, 12, 13, 15, 16, 24, 27, 31, 45]);

/** Pausieren koennen nur Waschmaschine, Trockner und Waschtrockner (Miele-API processAction 3). */
const PAUSE_ARTEN = new Set([1, 2, 24]);

/**
 * Geraete, die von hier aus nicht ein- oder ausgeschaltet werden: Kuehl- und Gefriergeraete
 * (ein Fernausschalten taute sie ab) und das Kochfeld (Sicherheit).
 */
const OHNE_SCHALTEN = new Set([18, 19, 20, 21, 25]);

/**
 * Geraetearten mit schaltbarer Beleuchtung (Garraum bzw. Kochfeld): Backofen, Backofen mit
 * Mikrowelle, Dampfgarer, Dampfbackofen, Dunstabzug, Mikrowelle. Wasch- und Spuelmaschinen haben
 * zwar einen Datenpunkt state.light, aber kein Licht - dort waeren die Knoepfe sinnlos.
 */
const LICHT_ARTEN = new Set([12, 13, 15, 16, 23, 27, 31, 45]);

/**
 * Ob eine Geraeteart einen Befehl ueberhaupt kennt - unabhaengig vom Zustand.
 *
 * @param {string} befehl powerOn, start …
 * @param {number|null} deviceType Miele-Geraeteart
 * @returns {boolean} true, wenn der Knopf auf die Karte gehoert
 */
function artKann(befehl, deviceType) {
    switch (befehl) {
        case 'powerOn':
        case 'powerOff':
            return deviceType != null && !OHNE_SCHALTEN.has(deviceType);
        case 'start':
        case 'stop':
            return PROGRAMM_ARTEN.has(deviceType);
        case 'pause':
            return PAUSE_ARTEN.has(deviceType);
        case 'lightOn':
        case 'lightOff':
            return LICHT_ARTEN.has(deviceType);
        default:
            return false;
    }
}

/**
 * Welche Befehle jetzt sinnvoll sind. Rein: liest nichts, schreibt nichts.
 *
 * Start verlangt zusaetzlich die MobileStart-Freigabe am Geraet - ohne sie lehnt das Geraet den
 * Fernstart ab, der Knopf waere eine Falle. Ein nicht erreichbares Geraet bekommt keinen Knopf.
 *
 * @param {object} z Zustand
 * @param {number|null} z.deviceType Miele-Geraeteart
 * @param {number|null} z.status Statuscode
 * @param {boolean} z.mobileStart MobileStart freigegeben
 * @param {boolean} z.verbunden Geraet erreichbar
 * @returns {string[]} Befehle in Anzeigereihenfolge
 */
function angebot({ deviceType, status, mobileStart, verbunden }) {
    if (!verbunden) {
        return [];
    }
    const je = ANGEBOT_JE_STATUS[status] || [];
    return ZUSTANDSBEFEHLE.filter(b => je.includes(b))
        .filter(b => artKann(b, deviceType))
        .filter(b => b !== 'start' || !!mobileStart);
}

/** Datenpunkt control.can<Befehl> zu einem Befehl. */
const KANN_ID = Object.fromEntries(objdef.ANGEBOT_STATES.map(a => [a.befehl, a.sub]));

/** SVG-Pfade (Material Design Icons, Apache 2.0) fuer Kartenkopf und Knoepfe. */
const PFADE = {
    waschen:
        'M14.83,11.17C16.39,12.73 16.39,15.27 14.83,16.83C13.27,18.39 10.73,18.39 9.17,16.83L14.83,11.17M6,2H18A2,2 0 0,1 20,4V20A2,2 0 0,1 18,22H6A2,2 0 0,1 4,20V4A2,2 0 0,1 6,2M7,4A1,1 0 0,0 6,5A1,1 0 0,0 7,6A1,1 0 0,0 8,5A1,1 0 0,0 7,4M10,4A1,1 0 0,0 9,5A1,1 0 0,0 10,6A1,1 0 0,0 11,5A1,1 0 0,0 10,4M12,8A6,6 0 0,0 6,14A6,6 0 0,0 12,20A6,6 0 0,0 18,14A6,6 0 0,0 12,8Z',
    spuelen:
        'M18,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V4A2,2 0 0,0 18,2M10,4A1,1 0 0,1 11,5A1,1 0 0,1 10,6A1,1 0 0,1 9,5A1,1 0 0,1 10,4M7,4A1,1 0 0,1 8,5A1,1 0 0,1 7,6A1,1 0 0,1 6,5A1,1 0 0,1 7,4M18,20H6V8H18V20M14.67,15.33C14.69,16.03 14.41,16.71 13.91,17.21C12.86,18.26 11.15,18.27 10.09,17.21C9.59,16.71 9.31,16.03 9.33,15.33C9.4,14.62 9.63,13.94 10,13.33C10.37,12.5 10.81,11.73 11.33,11L12,10C13.79,12.59 14.67,14.36 14.67,15.33',
    backen: 'M4,5A2,2 0 0,0 2,7V17A2,2 0 0,0 4,19H20A2,2 0 0,0 22,17V7A2,2 0 0,0 20,5H4M4,7H16V17H4V7M19,7A1,1 0 0,1 20,8A1,1 0 0,1 19,9A1,1 0 0,1 18,8A1,1 0 0,1 19,7M6,9V11H14V9H6M19,11A1,1 0 0,1 20,12A1,1 0 0,1 19,13A1,1 0 0,1 18,12A1,1 0 0,1 19,11Z',
    kochen: 'M6,14H8L11,17H9L6,14M4,4H5V3A1,1 0 0,1 6,2H10A1,1 0 0,1 11,3V4H13V3A1,1 0 0,1 14,2H18A1,1 0 0,1 19,3V4H20A2,2 0 0,1 22,6V19A2,2 0 0,1 20,21V22H17V21H7V22H4V21A2,2 0 0,1 2,19V6A2,2 0 0,1 4,4M18,7A1,1 0 0,1 19,8A1,1 0 0,1 18,9A1,1 0 0,1 17,8A1,1 0 0,1 18,7M14,7A1,1 0 0,1 15,8A1,1 0 0,1 14,9A1,1 0 0,1 13,8A1,1 0 0,1 14,7M20,6H4V10H20V6M4,19H20V12H4V19M6,7A1,1 0 0,1 7,8A1,1 0 0,1 6,9A1,1 0 0,1 5,8A1,1 0 0,1 6,7M13,14H15L18,17H16L13,14Z',
    kaffee: 'M18 6V4H20V2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H20V20H15.97C17.2 19.09 18 17.64 18 16V11H8V16C8 17.64 8.81 19.09 10.03 20H6V4H8V6C8 6.55 8.45 7 9 7H17C17.55 7 18 6.55 18 6M13 8C13.55 8 14 8.45 14 9S13.55 10 13 10 12 9.55 12 9 12.45 8 13 8Z',
    kuehlen:
        'M7,2H17A2,2 0 0,1 19,4V9H5V4A2,2 0 0,1 7,2M19,19A2,2 0 0,1 17,21V22H15V21H9V22H7V21A2,2 0 0,1 5,19V10H19V19M8,5V7H10V5H8M8,12V15H10V12H8Z',
    power: 'M16.56,5.44L15.11,6.89C16.84,7.94 18,9.83 18,12A6,6 0 0,1 12,18A6,6 0 0,1 6,12C6,9.83 7.16,7.94 8.88,6.88L7.44,5.44C5.36,6.88 4,9.28 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12C20,9.28 18.64,6.88 16.56,5.44M13,3H11V13H13',
    play: 'M8,5.14V19.14L19,12.14L8,5.14Z',
    pause: 'M14,19H18V5H14M6,19H10V5H6V19Z',
    stop: 'M18,18H6V6H18V18Z',
    lichtAn:
        'M12,6A6,6 0 0,1 18,12C18,14.22 16.79,16.16 15,17.2V19A1,1 0 0,1 14,20H10A1,1 0 0,1 9,19V17.2C7.21,16.16 6,14.22 6,12A6,6 0 0,1 12,6M14,21V22A1,1 0 0,1 13,23H11A1,1 0 0,1 10,22V21H14M20,11H23V13H20V11M1,11H4V13H1V11M13,1V4H11V1H13M4.92,3.5L7.05,5.64L5.63,7.05L3.5,4.93L4.92,3.5M16.95,5.63L19.07,3.5L20.5,4.93L18.37,7.05L16.95,5.63Z',
    lichtAus:
        'M12,2C9.76,2 7.78,3.05 6.5,4.68L16.31,14.5C17.94,13.21 19,11.24 19,9A7,7 0 0,0 12,2M3.28,4L2,5.27L5.04,8.3C5,8.53 5,8.76 5,9C5,11.38 6.19,13.47 8,14.74V17A1,1 0 0,0 9,18H14.73L18.73,22L20,20.72L3.28,4M9,20V21A1,1 0 0,0 10,22H14A1,1 0 0,0 15,21V20H9Z',
};

/**
 * Ein Pfad als Daten-URL (der Device-Manager nimmt base64 oder URL).
 *
 * @param {string} pfad SVG-Pfad aus PFADE
 * @param {string} farbe Fuellfarbe
 * @returns {string} data:image/svg+xml;base64,…
 */
function symbol(pfad, farbe) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${farbe}" d="${pfad}"/></svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/** Kartenkopf-Symbol je Miele-Geraeteart (unbekannte Arten: kein Symbol). */
const SYMBOL_JE_ART = {
    1: 'waschen',
    2: 'waschen',
    24: 'waschen',
    7: 'spuelen',
    12: 'backen',
    13: 'backen',
    15: 'backen',
    16: 'backen',
    27: 'backen',
    67: 'backen',
    68: 'backen',
    17: 'kaffee',
    18: 'kuehlen',
    19: 'kuehlen',
    20: 'kuehlen',
    21: 'kuehlen',
    23: 'kochen',
    25: 'kochen',
};

/**
 * Knopfsymbole. Farben, die auf dem hellen (#d5d5d5) und dem dunklen (#0b0b0b) Kartengrund
 * lesbar bleiben; die Beschriftung darunter folgt der Schriftfarbe des Themas.
 */
const KNOPFSYMBOL = {
    powerOn: symbol(PFADE.power, '#2e7d32'),
    powerOff: symbol(PFADE.power, '#c62828'),
    start: symbol(PFADE.play, '#2e7d32'),
    pause: symbol(PFADE.pause, '#ef6c00'),
    stop: symbol(PFADE.stop, '#c62828'),
    lightOn: symbol(PFADE.lichtAn, '#f9a825'),
    lightOff: symbol(PFADE.lichtAus, '#8a8a8a'),
};

/**
 * Tooltip je Knopf; Licht je nach Geraet (Garraum oder Dunstabzug).
 *
 * @param {string} befehl powerOn, lightOn …
 * @param {number|null} deviceType Miele-Geraeteart
 * @returns {Record<string, string>} Text je Sprache
 */
function tooltip(befehl, deviceType) {
    switch (befehl) {
        case 'lightOn':
            return TEXTE[deviceType === 23 ? 'tipLightOnHood' : 'tipLightOnOven'];
        case 'lightOff':
            return TEXTE[deviceType === 23 ? 'tipLightOffHood' : 'tipLightOffOven'];
        default:
            return TEXTE[`tip${befehl[0].toUpperCase()}${befehl.slice(1)}`];
    }
}

/** Aktion des Licht-Umschalters; der Handler waehlt nach state.light lightOn oder lightOff. */
const LICHT_UMSCHALTEN = 'lightToggle';

/**
 * Fortschrittsbalken als HTML-Muster (JSON-Config staticText, format html). _states.v ist
 * state.progress; Balken und Prozentzahl stehen in einer Zeile.
 */
const BALKEN_HTML =
    '<div style="display:flex;align-items:center;gap:10px;width:100%;padding-top:4px">' +
    '<div style="flex:1;height:10px;border-radius:5px;background:rgba(33,150,243,0.25);overflow:hidden">' +
    '<div style="width:${Math.max(0, Math.min(100, Number(_states.v?.val) || 0))}%;height:100%;' +
    'border-radius:5px;background:#2196f3"></div></div>' +
    '<span style="min-width:3em;text-align:right;font-size:16px">${Number(_states.v?.val) || 0}\u00a0%</span></div>';

/** Farben der Warnzeilen - auf hellem und dunklem Kartengrund lesbar. */
const FARBE_STOERUNG = '#e53935';
const FARBE_HINWEIS = '#ef6c00';

/** Wie lange ein Knopf auf den Abschluss des Befehls wartet (Einschalten weckt und prueft nach). */
const WARTEZEIT_MS = 90000;
const TAKT_MS = 500;

/**
 * Kartentitel: Geraetename samt Modell, aber ohne die angehaengte Seriennummer - die steht
 * schon im Text darunter. Der Objektname lautet "Waschmaschine - WCR860 (000111111111)".
 *
 * @param {ioBroker.Object|undefined} obj Geraeteobjekt
 * @param {string} id Geraete-ID (Seriennummer)
 * @returns {ioBroker.StringOrTranslated} Titel
 */
function titel(obj, id) {
    const name = obj && obj.common && obj.common.name;
    const ohne = t => String(t).replace(` (${id})`, '').replace(`(${id})`, '').trim() || id;
    if (!name) {
        return id;
    }
    if (typeof name === 'object') {
        return Object.fromEntries(Object.entries(name).map(([sp, t]) => [sp, ohne(t)]));
    }
    return ohne(name);
}

/**
 * Eine Zeile der Karte: ein Datenpunkt, der sich ausblendet, solange die Bedingung nicht gilt.
 *
 * @param {string} oid vollstaendige Datenpunkt-ID
 * @param {object} weiteres zusaetzliche Schema-Angaben (label, size …)
 * @param {string} [sichtbar] JS-Ausdruck ueber v (der Datenpunkt), wann die Zeile zu sehen ist
 * @returns {object} JSON-Config-Element
 */
function zeile(oid, weiteres, sichtbar) {
    const z = { type: 'state', oid, foreign: true, readOnly: true, control: 'text', xs: 12, ...weiteres };
    if (sichtbar) {
        z.dependsOnStates = { v: oid };
        z.hidden = `!(${sichtbar})`;
    }
    return z;
}

/**
 * Die Karte eines Geraets zusammenstellen. Rein: liest nichts, schreibt nichts.
 *
 * @param {object} p Angaben
 * @param {string} p.ns Namensraum der Instanz, z. B. "miele-local.0"
 * @param {string} p.id Geraete-ID (Seriennummer)
 * @param {ioBroker.Object} p.obj Geraeteobjekt
 * @param {Map<string, ioBroker.Object>} p.objekte vorhandene Objekte des Geraets, Schluessel ohne Namensraum
 * @param {number|null} p.deviceType Miele-Geraeteart aus info.deviceType
 * @param {boolean} p.steuerung ob die Steuerung in der Instanz freigegeben ist
 * @param {(id: string, befehl: string, ctx: object) => Promise<object>} [p.handler] Ausfuehrung eines Befehls
 * @param {string} [p.sprache] Systemsprache fuer Status, Programm und Phase (Vorgabe: en)
 * @returns {object} DeviceInfo fuer den Device-Manager
 */
function karte({ ns, id, obj, objekte, deviceType, steuerung, handler, sprache }) {
    const hat = sub => objekte.has(`${id}.${sub}`);
    const voll = sub => `${ns}.${id}.${sub}`;
    const name = sub => {
        const o = objekte.get(`${id}.${sub}`);
        return (o && o.common && o.common.name) || sub.split('.').pop();
    };

    // Modell steckt im Titel, Seriennummer im Text, der Hersteller ist bei diesem Adapter immer
    // derselbe - so steht nichts doppelt auf der Karte.
    const info = {
        id,
        identifier: id,
        name: titel(obj, id),
        hasDetails: DETAILS.some(hat),
    };

    if (hat('info.connected')) {
        info.status = {
            connection: {
                stateId: voll('info.connected'),
                mapping: { true: 'connected', false: 'disconnected' },
            },
        };
    }

    const kategorie = objdef.deviceCategory(deviceType);
    if (kategorie) {
        const k = namen.KATEGORIEN[kategorie];
        info.group = { key: `type${deviceType}`, name: k ? { ...k, de: kategorie } : kategorie };
    }

    const art = SYMBOL_JE_ART[deviceType];
    if (art) {
        info.icon = symbol(PFADE[art], '#ffffff');
    }

    // Laufender Betrieb direkt auf der Karte, jede Zeile blendet sich aus, solange sie leer ist.
    const zeilen = {};
    const warnung = (sub, schluessel, farbe) => {
        if (hat(sub)) {
            zeilen[`_${sub.replace(/\./g, '_')}`] = zeile(
                voll(sub),
                { label: '', trueText: text(schluessel), trueTextStyle: { color: farbe, fontWeight: 'bold' } },
                '_states.v?.val === true',
            );
        }
    };
    warnung('state.signalFailure', 'fault', FARBE_STOERUNG);
    warnung('state.signalDoor', 'door', FARBE_HINWEIS);
    warnung('state.signalInfo', 'notice', FARBE_HINWEIS);

    if (steuerung && artKann('start', deviceType) && hat('state.mobileStart') && hat('state.status')) {
        // Bereit, aber ohne MobileStart: sagen, warum kein Start-Knopf da ist.
        zeilen._noMobileStart = {
            type: 'staticText',
            text: text('noMobileStart'),
            xs: 12,
            style: { color: FARBE_HINWEIS, fontSize: 14 },
            dependsOnStates: { s: voll('state.status'), m: voll('state.mobileStart') },
            hidden: '!([2, 3, 4].includes(_states.s?.val) && _states.m?.val === false)',
        };
    }

    const leer = "_states.v?.val !== undefined && _states.v?.val !== null && _states.v?.val !== ''";
    const zeilenDef = [
        ['state.statusText', {}, null],
        ['state.programText', { label: TEXTE.program }, leer],
        ['state.programPhaseText', { label: TEXTE.phase }, leer],
        ['state.startTimeText', { label: TEXTE.startsAt }, leer],
        ['state.remainingHHMM', { label: TEXTE.remaining, size: 'large' }, `${leer} && _states.v.val !== '0:00'`],
        ['state.estimatedEndTimeText', { label: TEXTE.endsAt, size: 'large' }, leer],
    ];
    for (const [sub, weiteres, sichtbar] of zeilenDef) {
        if (!hat(sub)) {
            continue;
        }
        const o = objekte.get(`${id}.${sub}`);
        const roh = rohAnzeige(sub, hat, werte.sprache(sprache), deviceType);
        let z;
        if (roh) {
            // Rohwert mit Wertetabelle; ausgeblendet, solange er "nichts" bedeutet
            const nichts = roh.leer.length ? ` && !${JSON.stringify(roh.leer)}.includes(_states.v?.val)` : '';
            z = zeile(
                voll(roh.sub),
                { label: name(sub), ...weiteres, options: roh.options, noTranslation: true },
                sichtbar ? `_states.v?.val !== undefined && _states.v?.val !== null${nichts}` : null,
            );
        } else {
            z = zeile(voll(sub), { label: name(sub), ...weiteres }, sichtbar);
        }
        if (o.common && o.common.unit) {
            z.unit = o.common.unit;
        }
        zeilen[`_${sub.replace(/\./g, '_')}`] = z;
    }
    if (hat('state.progress')) {
        // Eigener Balken als HTML: der eingebaute Balken des Admins setzt die Prozentzahl
        // abgesetzt darunter. So steht sie in derselben Zeile direkt am Balken.
        zeilen._state_progress = {
            type: 'staticText',
            format: 'html',
            noTranslation: true,
            xs: 12,
            text: BALKEN_HTML,
            dependsOnStates: { v: voll('state.progress') },
            hidden: '!(_states.v?.val > 0)',
        };
    }
    if (Object.keys(zeilen).length) {
        info.customInfo = { id, schema: { type: 'panel', items: zeilen } };
    }

    if (steuerung) {
        const aktionen = [];
        const anzeigen = [];
        ZUSTANDSBEFEHLE.filter(b => hat(`control.${b}`))
            .filter(b => artKann(b, deviceType))
            .forEach((b, i) => {
                const a = {
                    id: b,
                    icon: KNOPFSYMBOL[b],
                    description: tooltip(b, deviceType),
                    timeout: WARTEZEIT_MS + 10000,
                    // greift in den Betrieb ein und wird bestaetigt
                    confirmation: text('confirm', { befehl: objdef.nameFor('control', b, b, true) }),
                };
                if (handler) {
                    a.handler = (geraet, ctx) => handler(geraet, b, ctx);
                }
                aktionen.push(a);
                // Als Statusanzeige mit Beschriftung, sichtbar nur solange control.can<Befehl>
                // true ist. Fehlt der Datenpunkt (Objekte noch aus einer aelteren Version),
                // bleibt der Knopf als gewoehnlicher Fussknopf stehen.
                const kann = KANN_ID[b];
                if (!hat(`control.${kann}`)) {
                    return;
                }
                anzeigen.push({
                    id: `cmd_${b}`,
                    icon: KNOPFSYMBOL[b],
                    text: TEXTE[b],
                    tooltip: tooltip(b, deviceType),
                    actionId: b,
                    order: 10 + i,
                    value: { stateId: voll(`control.${kann}`) },
                });
            });
        // Licht: EIN Umschalter. Symbol, Beschriftung und Tooltip folgen state.light live; der
        // Klick schaltet ins Gegenteil (ohne Rueckfrage - Licht ist harmlos).
        if (artKann('lightOn', deviceType) && hat('state.light') && hat('control.lightOn') && hat('control.lightOff')) {
            const a = {
                id: LICHT_UMSCHALTEN,
                icon: KNOPFSYMBOL.lightOff,
                description: tooltip('lightOn', deviceType),
                timeout: WARTEZEIT_MS + 10000,
            };
            if (handler) {
                a.handler = (geraet, ctx) => handler(geraet, LICHT_UMSCHALTEN, ctx);
            }
            aktionen.push(a);
            const aus = { icon: KNOPFSYMBOL.lightOff, text: TEXTE.lightOff, tooltip: tooltip('lightOn', deviceType) };
            anzeigen.push({
                id: 'cmd_light',
                value: { stateId: voll('state.light') },
                // false muss sichtbar bleiben: dann zeigt der Knopf "Licht aus"
                hideIfEmpty: false,
                levels: [
                    {
                        value: true,
                        icon: KNOPFSYMBOL.lightOn,
                        text: TEXTE.lightOn,
                        tooltip: tooltip('lightOff', deviceType),
                    },
                    { value: false, ...aus },
                    aus,
                ],
                ...aus,
                actionId: LICHT_UMSCHALTEN,
                order: 30,
            });
        }
        if (aktionen.length) {
            info.actions = aktionen;
        }
        if (anzeigen.length) {
            info.indicators = anzeigen;
        }
    }
    return info;
}

/**
 * Das Aufklappfeld eines Geraets: weitere Betriebswerte, live aus den Datenpunkten.
 *
 * @param {string} id Geraete-ID
 * @param {Map<string, ioBroker.Object>} objekte vorhandene Objekte, Schluessel ohne Namensraum
 * @param {string} [sprache] Systemsprache fuer Programmart und Trockenstufe (Vorgabe: en)
 * @param {number|null} [deviceType] Miele-Geraeteart
 * @returns {{id: string, schema: object}} DeviceDetails
 */
function details(id, objekte, sprache, deviceType = null) {
    const items = {};
    const hat = sub => objekte.has(`${id}.${sub}`);
    for (const sub of DETAILS) {
        const o = objekte.get(`${id}.${sub}`);
        if (!o) {
            continue;
        }
        const c = o.common || {};
        const roh = rohAnzeige(sub, hat, werte.sprache(sprache), deviceType);
        const item = {
            type: 'state',
            oid: `${id}.${roh ? roh.sub : sub}`,
            label: c.name || sub,
            control: 'text',
            sm: 12,
        };
        if (roh) {
            item.options = roh.options;
            item.noTranslation = true;
        }
        if (c.unit) {
            item.unit = c.unit;
        }
        items[`_${sub.replace(/\./g, '_')}`] = item;
    }
    return { id, schema: { type: 'panel', items } };
}

/**
 * Fortschritt eines Programms in ganzen Prozent, oder 0.
 *
 * Nur waehrend es laeuft oder pausiert (Status 5/6) und nur, wenn das Geraet beide Zeiten nennt -
 * ohne verstrichene Zeit liesse sich die Gesamtdauer nicht schaetzen. Nie 0 und nie 100 waehrend
 * des Laufs: 0 blendet den Balken aus, 100 hiesse "fertig".
 *
 * @param {number|null} status Statuscode
 * @param {number} verstrichen verstrichene Minuten
 * @param {number} rest Restminuten
 * @returns {number} 0..99
 */
function fortschritt(status, verstrichen, rest) {
    if (status !== 5 && status !== 6) {
        return 0;
    }
    const v = Number(verstrichen) || 0;
    const r = Number(rest) || 0;
    if (v <= 0 || r <= 0) {
        return 0;
    }
    return Math.min(99, Math.max(1, Math.round((v / (v + r)) * 100)));
}

/** Device-Manager der Instanz. Nur Anzeige und Alltagsbefehle, keine Instanz-Aktionen. */
class MieleGeraeteManager extends DeviceManagement {
    /** @returns {object} Instanzangaben: API v3, keine Instanz-Aktionen */
    getInstanceInfo() {
        return { apiVersion: 'v3', identifierLabel: TEXTE.serial };
    }

    /**
     * Alle Objekte unterhalb der Geraete holen, gruppiert nach Geraet.
     *
     * @returns {Promise<{geraete: ioBroker.Object[], objekte: Map<string, ioBroker.Object>}>} Geraete und Objekte
     */
    async lesen() {
        const ns = this.adapter.namespace;
        const bereich = { startkey: `${ns}.`, endkey: `${ns}.香` };
        const ger = await this.adapter.getObjectViewAsync('system', 'device', bereich);
        const st = await this.adapter.getObjectViewAsync('system', 'state', bereich);
        const geraete = ((ger && ger.rows) || []).map(r => r.value).filter(Boolean);
        const objekte = new Map();
        for (const r of (st && st.rows) || []) {
            if (r.value) {
                objekte.set(r.id.slice(ns.length + 1), r.value);
            }
        }
        return { geraete, objekte };
    }

    /**
     * Je Geraet eine Karte an den Device-Manager geben.
     *
     * @param {{addDevice: (d: object) => void, setTotalDevices: (n: number) => void}} context Ladekontext
     */
    async loadDevices(context) {
        const ns = this.adapter.namespace;
        const { geraete, objekte } = await this.lesen();
        const sprache = await this.sprache();
        context.setTotalDevices(geraete.length);
        const steuerung = !!this.adapter.config.allowControl;
        for (const obj of geraete) {
            const id = obj._id.slice(ns.length + 1);
            // ohne Geraeteart keine Gruppe und keine Programm-/Phasentabelle
            const deviceType = await this.geraeteArt(id);
            context.addDevice(
                karte({
                    ns,
                    id,
                    obj,
                    objekte,
                    deviceType,
                    steuerung,
                    sprache,
                    handler: (geraet, befehl, ctx) => this.befehl(geraet, befehl, ctx),
                }),
            );
        }
    }

    /**
     * Das Aufklappfeld eines Geraets.
     *
     * @param {string} id Geraete-ID
     */
    async getDeviceDetails(id) {
        const { objekte } = await this.lesen();
        return details(id, objekte, await this.sprache(), await this.geraeteArt(id));
    }

    /**
     * Systemsprache des ioBroker (system.config), bei jedem Laden neu gelesen - eine Umstellung
     * wirkt so ohne Neustart der Instanz.
     *
     * @returns {Promise<string>} eine der elf Sprachen, sonst "en"
     */
    async sprache() {
        try {
            const sys = await this.adapter.getForeignObjectAsync('system.config');
            return werte.sprache(sys && sys.common && sys.common.language);
        } catch {
            return 'en';
        }
    }

    /**
     * Miele-Geraeteart aus info.deviceType.
     *
     * @param {string} id Geraete-ID
     * @returns {Promise<number|null>} Geraeteart oder null
     */
    async geraeteArt(id) {
        try {
            const s = await this.adapter.getStateAsync(`${id}.info.deviceType`);
            return s && s.val != null ? Number(s.val) : null;
        } catch {
            return null;
        }
    }

    /**
     * Einen Alltagsbefehl ueber den vorhandenen Datenpunkt control.<befehl> ausfuehren.
     *
     * @param {string} geraet Geraete-ID
     * @param {string} befehl Name des Befehls (powerOn, start …)
     * @param {{showMessage: (t: object) => Promise<void>}} ctx Dialog-Kontext des Device-Managers
     * @param {{wartezeit?: number, takt?: number}} [zeiten] fuer Tests verkuerzbar
     * @returns {Promise<{refresh: 'none'}>} nichts neu laden - Knoepfe und Zeilen folgen den Datenpunkten
     */
    async befehl(geraet, befehl, ctx, zeiten) {
        if (befehl === LICHT_UMSCHALTEN) {
            const licht = await this.adapter.getStateAsync(`${geraet}.state.light`);
            befehl = licht && licht.val === true ? 'lightOff' : 'lightOn';
        }
        const erg = await befehlAusfuehren(this.adapter, `${geraet}.control.${befehl}`, zeiten);
        if (erg.zeitueberschreitung) {
            await ctx.showMessage(text('timeout', { sekunden: Math.round(WARTEZEIT_MS / 1000) }));
        } else if (erg.fehler) {
            await ctx.showMessage(text('failed', { grund: erg.fehler }));
        }
        return { refresh: 'none' };
    }
}

/**
 * Befehl schreiben und auf den Abschluss durch lib/befehle.js warten.
 *
 * @param adapter Adapterinstanz (setStateAsync, getStateAsync, setTimeout)
 * @param {string} id Steuer-Datenpunkt ohne Namensraum
 * @param {{wartezeit?: number, takt?: number}} [o] Zeiten, fuer Tests verkuerzbar
 * @returns {Promise<{ok?: boolean, fehler?: string, zeitueberschreitung?: boolean}>} Ergebnis
 */
async function befehlAusfuehren(adapter, id, o = {}) {
    const wartezeit = o.wartezeit != null ? o.wartezeit : WARTEZEIT_MS;
    const takt = o.takt != null ? o.takt : TAKT_MS;
    const ab = Date.now();
    await adapter.setStateAsync(id, { val: true, ack: false });
    for (let warte = 0; warte < wartezeit; warte += takt) {
        await new Promise(r => adapter.setTimeout(r, takt));
        const st = await adapter.getStateAsync(id);
        if (st && st.ack && st.ts >= ab) {
            if (st.q) {
                return { fehler: String(st.c || '').replace(/^not executed: /, '') || `q=${st.q}` };
            }
            return { ok: true };
        }
    }
    return { zeitueberschreitung: true };
}

module.exports = {
    MieleGeraeteManager,
    karte,
    details,
    angebot,
    artKann,
    fortschritt,
    titel,
    befehlAusfuehren,
    text,
    TEXTE,
    DETAILS,
    ROHWERT,
    BEFEHLE,
    KNOPFSYMBOL,
    KANN_ID,
    LICHT_UMSCHALTEN,
    BALKEN_HTML,
};
