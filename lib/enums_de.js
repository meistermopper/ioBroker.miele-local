'use strict';

// Deutsche Übersetzungen der Miele-Enums (an mielecloudservice-Begriffe angelehnt:
// in_use→"In Betrieb", off→"Aus", main_wash→"Waschen"). Fallback = englischer Schlüssel.

const StateStatusDe = {
    0: 'Reserviert',
    1: 'Aus',
    2: 'Ein',
    3: 'Programmiert',
    4: 'Warten auf Start',
    5: 'In Betrieb',
    6: 'Pause',
    7: 'Programm beendet',
    8: 'Fehler',
    9: 'Programm unterbrochen',
    10: 'Bereit',
    11: 'Spülstopp',
    12: 'Service',
    13: 'SuperFrost',
    14: 'SuperKühlen',
    15: 'Aufheizen',
    144: 'Standard',
    145: 'Gesperrt',
    146: 'SuperKühlen/SuperFrost',
    147: 'Selbstreinigung',
    255: 'Nicht verbunden',
};

const StateProgramTypeDe = {
    0: 'Normalbetrieb',
    1: 'Eigenes Programm',
    2: 'Automatikprogramm',
    3: 'Automatikprogramm',
    4: 'Wartungsprogramm',
};

const StateDryingStepDe = {
    0: 'Extra trocken',
    1: 'Normal plus',
    2: 'Normal',
    3: 'Leicht trocken',
    4: 'Handtuchtrocken',
    5: 'Bügeltrocken',
    6: 'Schranktrocken',
    7: 'Schranktrocken plus',
};

const ProgramPhaseWashingMachineDe = {
    0: '',
    256: '',
    257: 'Vorwäsche',
    258: 'Einweichen',
    259: 'Vorwäsche',
    260: 'Waschen',
    261: 'Spülen',
    262: 'Spülstopp',
    263: 'Reinigung',
    264: 'Abkühlen',
    265: 'Abpumpen',
    266: 'Schleudern',
    267: 'Knitterschutz',
    268: 'Ende',
    269: 'Belüften',
    270: 'Stärkestopp',
    271: 'Auffrischen/Befeuchten',
    272: 'Dampfglätten',
    279: 'Hygiene',
    280: 'Trocknen',
    285: 'Desinfizieren',
    295: 'Dampfglätten',
    11004: 'Waschen',
    11005: 'Spülen',
    11010: 'Schleudern',
    11012: 'Ende',
    11029: 'Knitterschutz',
    11044: 'Automatikstart',
    11047: 'FlexLoad aktiv',
    65535: '',
};

const ProgramPhaseDishwasherDe = {
    0: '',
    1792: '',
    1793: 'Regenerieren',
    1794: 'Vorspülen',
    1795: 'Reinigen',
    1796: 'Spülen',
    1797: 'Zwischenspülen',
    1798: 'Klarspülen',
    1799: 'Trocknen',
    1800: 'Ende',
    1801: 'Vorspülen',
    65535: '',
};

const ProgramPhaseOvenDe = {
    0: '',
    3073: 'Aufheizen',
    3074: 'In Betrieb',
    3078: 'Beendet',
    3080: 'Anbraten',
    3081: 'Braten',
    3084: 'Energiesparen',
    3099: 'Vorheizen',
    65535: '',
};

// Programmnamen (Schlüssel = englischer Enum-Wert aus enums.js → Deutsch).
const ProgramNameDe = {
    // gemeinsame
    no_program: '',
    // Waschmaschine
    cottons: 'Baumwolle',
    minimum_iron: 'Pflegeleicht',
    easy_care: 'Pflegeleicht',
    delicates: 'Feinwäsche',
    woollens: 'Wolle',
    silks: 'Seide',
    starch: 'Stärken',
    rinse: 'Spülen',
    drain_spin: 'Abpumpen/Schleudern',
    curtains: 'Gardinen',
    shirts: 'Oberhemden',
    denim: 'Jeans',
    proofing: 'Imprägnieren',
    sportswear: 'Sportbekleidung',
    automatic_plus: 'Automatic Plus',
    outerwear: 'Outdoor',
    pillows: 'Kopfkissen',
    dark_garments: 'Dunkles/Jeans',
    dark_jeans: 'Dunkles/Jeans',
    separate_rinse_starch: 'Separates Spülen/Stärken',
    first_wash: 'Erstwäsche',
    cottons_hygiene: 'Baumwolle Hygiene',
    cottons_eco: 'Baumwolle Eco',
    trainers: 'Sportschuhe',
    trainers_refresh: 'Sportschuhe auffrischen',
    clean_machine: 'Maschine reinigen',
    down_duvets: 'Daunen',
    down_filled_items: 'Daunen',
    express_20: 'Express 20',
    quick_power_wash: 'QuickPowerWash',
    eco_40_60: 'Eco 40-60',
    bed_linen: 'Bettwäsche',
    outdoor_garments: 'Outdoor',
    pre_ironing: 'Vorbügeln',
    cottonrepair: 'CottonRepair',
    smartmatic: 'SmartMatic',
    stuffed_toys: 'Kuscheltiere',
    game_pieces: 'Spielsachen',
    powerfresh: 'PowerFresh',
    // Spülmaschine
    intensive: 'Intensiv',
    maintenance: 'Maschinenpflege',
    eco: 'Eco',
    automatic: 'Automatic',
    solar_save: 'Solarspar',
    gentle: 'Schonen',
    extra_quiet: 'Extra leise',
    hygiene: 'Hygiene',
    pasta_paela: 'Pasta/Paella',
    tall_items: 'Große Teile',
    glasses_warm: 'Gläser warm',
    glasses: 'Gläser',
    without_upper_basket: 'ohne Oberkorb',
    normal: 'Normal',
    comfort_wash: 'ComfortWash',
    comfort_wash_plus: 'ComfortWash Plus',
    power_wash: 'PowerWash',
    rinse_salt: 'Spülen/Salz',
    // Backofen – Betriebsarten
    conventional_heat: 'Ober-/Unterhitze',
    top_heat: 'Oberhitze',
    bottom_heat: 'Unterhitze',
    fan_plus: 'Umluft',
    eco_fan_heat: 'Eco Umluft',
    fan_grill: 'Umluftgrill',
    grill: 'Grill',
    full_grill: 'Großflächengrill',
    economy_grill: 'Spargrill',
    intensive_bake: 'Intensivbacken',
    auto_roast: 'Automatikbraten',
    low_temperature_cooking: 'Niedertemperaturgaren',
    moisture_plus_conventional_heat: 'Feuchtigkeit plus – Ober-/Unterhitze',
    moisture_plus_fan_plus: 'Feuchtigkeit plus – Umluft',
    moisture_plus_auto_roast: 'Feuchtigkeit plus – Automatikbraten',
    moisture_plus_intensive_bake: 'Feuchtigkeit plus – Intensivbacken',
    microwave: 'Mikrowelle',
    microwave_fan_plus: 'Mikrowelle – Umluft',
    microwave_grill: 'Mikrowelle – Grill',
    microwave_fan_grill: 'Mikrowelle – Umluftgrill',
    microwave_auto_roast: 'Mikrowelle – Automatikbraten',
    quick_microwave: 'Schnell-Mikrowelle',
    steam_cooking: 'Dampfgaren',
    steam_bake: 'Dampfbacken',
    defrost: 'Auftauen',
    defrost_meat: 'Fleisch auftauen',
    defrost_vegetables: 'Gemüse auftauen',
    keeping_warm: 'Warmhalten',
    heat_crockery: 'Geschirr wärmen',
    heating_bakes_gratins: 'Aufläufe/Gratins',
    heating_vegetables: 'Gemüse erwärmen',
    evaporate_water: 'Wasser verdampfen',
    descale: 'Entkalken',
    pyrolytic: 'Pyrolyse',
    drying: 'Trocknen',
    prove_dough: 'Teig gehen lassen',
    prove_15_min: 'Teig gehen (15 min)',
    prove_30_min: 'Teig gehen (30 min)',
    prove_45_min: 'Teig gehen (45 min)',
    popcorn: 'Popcorn',
    shabbat_program: 'Schabbat-Programm',
    yom_tov: 'Jom Tov',
    // Backofen – eigene Programme
    custom_program_1: 'Eigenes Programm 1',
    custom_program_2: 'Eigenes Programm 2',
    custom_program_3: 'Eigenes Programm 3',
    custom_program_4: 'Eigenes Programm 4',
    custom_program_5: 'Eigenes Programm 5',
    custom_program_6: 'Eigenes Programm 6',
    custom_program_7: 'Eigenes Programm 7',
    custom_program_8: 'Eigenes Programm 8',
    custom_program_9: 'Eigenes Programm 9',
    custom_program_10: 'Eigenes Programm 10',
    custom_program_11: 'Eigenes Programm 11',
    custom_program_12: 'Eigenes Programm 12',
    custom_program_13: 'Eigenes Programm 13',
    custom_program_14: 'Eigenes Programm 14',
    custom_program_15: 'Eigenes Programm 15',
    custom_program_16: 'Eigenes Programm 16',
    custom_program_17: 'Eigenes Programm 17',
    custom_program_18: 'Eigenes Programm 18',
    custom_program_19: 'Eigenes Programm 19',
    custom_program_20: 'Eigenes Programm 20',
    // Backofen – Brot & Brötchen
    white_bread_baking_tin: 'Weißbrot (Kastenform)',
    white_bread_on_tray: 'Weißbrot (Blech)',
    white_rolls: 'Weiße Brötchen',
    multigrain_rolls: 'Mehrkornbrötchen',
    rye_rolls: 'Roggenbrötchen',
    mixed_rye_bread: 'Roggenmischbrot',
    dark_mixed_grain_bread: 'Dunkles Mehrkornbrot',
    spelt_bread: 'Dinkelbrot',
    walnut_bread: 'Walnussbrot',
    seeded_loaf: 'Saatenbrot',
    flat_bread: 'Fladenbrot',
    baguettes: 'Baguette',
    plaited_loaf: 'Hefezopf',
    plaited_swiss_loaf: 'Schweizer Zopf',
    swiss_farmhouse_bread: 'Schweizer Bauernbrot',
    tiger_bread: 'Tigerbrot',
    ginger_loaf: 'Ingwerkuchen',
    stollen: 'Stollen',
    // Backofen – Kuchen & Gebäck
    apple_pie: 'Apfelkuchen',
    apple_sponge: 'Apfel-Biskuit',
    butter_cake: 'Butterkuchen',
    marble_cake: 'Marmorkuchen',
    madeira_cake: 'Sandkuchen',
    belgian_sponge_cake: 'Belgischer Biskuit',
    swiss_roll: 'Biskuitrolle',
    sponge_base: 'Biskuitboden',
    sachertorte: 'Sachertorte',
    fruit_streusel_cake: 'Obst-Streuselkuchen',
    fruit_flan_puff_pastry: 'Obstkuchen (Blätterteig)',
    fruit_flan_short_crust_pastry: 'Obstkuchen (Mürbeteig)',
    savoury_flan_puff_pastry: 'Herzhafter Kuchen (Blätterteig)',
    savoury_flan_short_crust_pastry: 'Herzhafter Kuchen (Mürbeteig)',
    chocolate_hazlenut_cake_one_large: 'Schoko-Nuss-Kuchen (groß)',
    chocolate_hazlenut_cake_several_small: 'Schoko-Nuss-Kuchen (klein)',
    viennese_apple_strudel: 'Wiener Apfelstrudel',
    lemon_meringue_pie: 'Zitronen-Baiser-Torte',
    quiche_lorraine: 'Quiche Lorraine',
    cheese_souffle: 'Käsesoufflé',
    choux_buns: 'Windbeutel',
    springform_tin_15cm: 'Springform 15 cm',
    springform_tin_20cm: 'Springform 20 cm',
    springform_tin_25cm: 'Springform 25 cm',
    // Backofen – Kekse & Kleingebäck
    vanilla_biscuits_1_tray: 'Vanillekipferl (1 Blech)',
    vanilla_biscuits_2_trays: 'Vanillekipferl (2 Bleche)',
    almond_macaroons_1_tray: 'Mandelmakronen (1 Blech)',
    almond_macaroons_2_trays: 'Mandelmakronen (2 Bleche)',
    biscuits_short_crust_pastry_1_tray: 'Mürbeteigplätzchen (1 Blech)',
    biscuits_short_crust_pastry_2_trays: 'Mürbeteigplätzchen (2 Bleche)',
    drop_cookies_1_tray: 'Spritzgebäck (1 Blech)',
    drop_cookies_2_trays: 'Spritzgebäck (2 Bleche)',
    linzer_augen_1_tray: 'Linzer Augen (1 Blech)',
    linzer_augen_2_trays: 'Linzer Augen (2 Bleche)',
    baiser_one_large: 'Baiser (groß)',
    baiser_several_small: 'Baiser (mehrere kleine)',
    blueberry_muffins: 'Blaubeer-Muffins',
    walnut_muffins: 'Walnuss-Muffins',
    // Backofen – Pizza & Flammkuchen
    pizza_yeast_dough_baking_tray: 'Pizza Hefeteig (Blech)',
    pizza_yeast_dough_round_baking_tine: 'Pizza Hefeteig (rund)',
    pizza_oil_cheese_dough_baking_tray: 'Pizza Öl-Käse-Teig (Blech)',
    pizza_oil_cheese_dough_round_baking_tine: 'Pizza Öl-Käse-Teig (rund)',
    tart_flambe: 'Flammkuchen',
    // Backofen – Fleisch (Rind/Kalb)
    roast_beef_roast: 'Roastbeef braten',
    roast_beef_low_temperature_cooking: 'Roastbeef (Niedertemperatur)',
    beef_fillet_roast: 'Rinderfilet braten',
    beef_fillet_low_temperature_cooking: 'Rinderfilet (Niedertemperatur)',
    braised_beef: 'Schmorbraten (Rind)',
    beef_wellington: 'Beef Wellington',
    beef_hash: 'Rinderhackgericht',
    meat_loaf: 'Hackbraten',
    braised_veal: 'Schmorbraten (Kalb)',
    veal_fillet_roast: 'Kalbsfilet braten',
    veal_fillet_low_temperature_cooking: 'Kalbsfilet (Niedertemperatur)',
    saddle_of_veal_roast: 'Kalbsrücken braten',
    saddle_of_veal_low_temperature_cooking: 'Kalbsrücken (Niedertemperatur)',
    veal_knuckle: 'Kalbshaxe',
    // Backofen – Fleisch (Schwein/Lamm/Wild)
    pork_fillet_roast: 'Schweinefilet braten',
    pork_fillet_low_temperature_cooking: 'Schweinefilet (Niedertemperatur)',
    pork_belly: 'Schweinebauch',
    pork_with_crackling: 'Krustenbraten',
    ham_roast: 'Schinkenbraten',
    pork_smoked_ribs_roast: 'Kasseler braten',
    pork_smoked_ribs_low_temperature_cooking: 'Kasseler (Niedertemperatur)',
    leg_of_lamb: 'Lammkeule',
    saddle_of_lamb_roast: 'Lammrücken braten',
    saddle_of_lamb_low_temperature_cooking: 'Lammrücken (Niedertemperatur)',
    rack_of_lamb_with_vegetables: 'Lammkarree mit Gemüse',
    saddle_of_roebuck: 'Rehrücken',
    saddle_of_venison: 'Hirschrücken',
    osso_buco: 'Osso Buco',
    rabbit: 'Kaninchen',
    // Backofen – Geflügel
    chicken_whole: 'Hähnchen (ganz)',
    chicken_thighs: 'Hähnchenschenkel',
    duck: 'Ente',
    goose_stuffed: 'Gans (gefüllt)',
    goose_unstuffed: 'Gans (ungefüllt)',
    turkey_whole: 'Pute (ganz)',
    turkey_drumsticks: 'Putenkeulen',
    // Backofen – Fisch
    salmon_fillet: 'Lachsfilet',
    salmon_trout: 'Lachsforelle',
    trout: 'Forelle',
    carp: 'Karpfen',
    pikeperch_fillet_with_vegetables: 'Zanderfilet mit Gemüse',
    // Backofen – Beilagen & Sonstiges
    potato_gratin: 'Kartoffelgratin',
    potato_cheese_gratin: 'Kartoffel-Käse-Gratin',
    yorkshire_pudding: 'Yorkshire Pudding',
    // Trockner
    basket_program: 'Korbprogramm',
    cool_air: 'Kaltluft',
    downs_duvets: 'Daunen',
    express: 'Express',
    gentle_denim: 'Schonend Jeans',
    gentle_smoothing: 'Schonend Glätten',
    large_pillows: 'Große Kopfkissen',
    pillows_sanitize: 'Kopfkissen Hygiene',
    quick_hygiene: 'Schnell Hygiene',
    quick_power_dry: 'QuickPowerDry',
    silks_handcare: 'Seide Handpflege',
    smoothing: 'Glätten',
    standard_pillows: 'Kopfkissen',
    steam_smoothing: 'Dampfglätten',
    warm_air: 'Warmluft',
    woollens_handcare: 'Wolle Handpflege',
    // Kaffeevollautomat
    appliance_rinse: 'Gerätespülung',
    automatic_maintenance: 'Automatische Pflege',
    barista_assistant: 'Barista-Assistent',
    black_tea: 'Schwarzer Tee',
    brewing_unit_degrease: 'Brüheinheit entfetten',
    cafe_au_lait: 'Café au Lait',
    caffe_latte: 'Caffè Latte',
    cappuccino: 'Cappuccino',
    cappuccino_italiano: 'Cappuccino Italiano',
    check_appliance: 'Gerät prüfen',
    coffee: 'Kaffee',
    coffee_pot: 'Kaffeekanne',
    descaling: 'Entkalken',
    espresso: 'Espresso',
    espresso_macchiato: 'Espresso Macchiato',
    flat_white: 'Flat White',
    fruit_tea: 'Früchtetee',
    green_tea: 'Grüner Tee',
    herbal_tea: 'Kräutertee',
    hot_milk: 'Heiße Milch',
    hot_water: 'Heißwasser',
    intermediate_rinsing: 'Zwischenspülung',
    japanese_tea: 'Japanischer Tee',
    latte_macchiato: 'Latte Macchiato',
    long_coffee: 'Langer Kaffee',
    milk_foam: 'Milchschaum',
    milk_pipework_clean: 'Milchleitung reinigen',
    milk_pipework_rinse: 'Milchleitung spülen',
    ristretto: 'Ristretto',
    very_hot_water: 'Sehr heißes Wasser',
    white_tea: 'Weißer Tee',
    // Wärmeschublade
    keep_warm: 'Warmhalten',
    slow_roasting: 'Niedertemperaturgaren',
    warm_cups_glasses: 'Tassen/Gläser wärmen',
    warm_dishes_plates: 'Geschirr/Teller wärmen',
};

/**
 * Deutsche Phasennamen, keyed nach ENGLISCHEM Enum-Wert (wie ProgramNameDe) - deckt so alle
 * Gerätetypen auf einmal ab. Wird als Fallback nach den numerischen BY_TYPE_DE-Tabellen genutzt
 * (siehe objects.js phaseTextDe), sodass bestehende Übersetzungen unveraendert bleiben.
 */
const PhaseNameDe = {
    not_running: '',
    program_running: 'In Betrieb',
    process_running: 'In Betrieb',
    drying: 'Trocknen',
    finished: 'Ende',
    process_finished: 'Beendet',
    cooling_down: 'Abkühlen',
    comfort_cooling: 'Komfortabkühlen',
    safety_cooling: 'Sicherheitsabkühlung',
    anti_crease: 'Knitterschutz',
    normal: 'Normal',
    normal_plus: 'Normal plus',
    extra_dry: 'Extratrocken',
    slightly_dry: 'Leicht trocken',
    hand_iron: 'Bügelfeucht',
    hand_iron_1: 'Handbügelfeucht 1',
    hand_iron_2: 'Handbügelfeucht 2',
    machine_iron: 'Maschinenbügelfeucht',
    moisten: 'Befeuchten',
    thermo_spin: 'Thermoschleudern',
    timed_drying: 'Zeitprogramm',
    warm_air: 'Warmluft',
    steam_smoothing: 'Dampfglätten',
    smoothing: 'Glätten',
    rinse_out_lint: 'Flusen ausspülen',
    rinses: 'Spülen',
    rinse: 'Spülen',
    automatic_start: 'Automatikstart',
    perfect_dry_active: 'PerfectDry aktiv',
    // Kaffeevollautomat
    heating_up: 'Aufheizen',
    espresso: 'Espresso',
    hot_milk: 'Heiße Milch',
    milk_foam: 'Milchschaum',
    dispensing: 'Ausgabe',
    pre_brewing: 'Vorbrühen',
    grinding: 'Mahlen',
    second_espresso: 'Zweiter Espresso',
    second_pre_brewing: 'Zweites Vorbrühen',
    second_grinding: 'Zweites Mahlen',
    // Dampfgarer / Dampfbackofen
    steam_reduction: 'Dampfreduktion',
    waiting_for_start: 'Warten auf Start',
    heating_up_phase: 'Aufheizphase',
    searing: 'Anbraten',
    roasting: 'Braten',
    energy_save: 'Energiesparen',
    pre_heating: 'Vorheizen',
    // Spülmaschine und Waschmaschine - von meistermopper (PR #14) übernommen. Die numerischen
    // Tabellen oben decken die lokalen Phasennummern ab; diese Namen greifen, wo eine Nummer
    // dort fehlt, und machen die Übersetzung vollständig (test/enums.js prüft das).
    pre_dishwash: 'Vorspülen',
    main_dishwash: 'Reinigen',
    interim_rinse: 'Zwischenspülen',
    final_rinse: 'Klarspülen',
    reactivating: 'Regenerieren',
    pre_wash: 'Vorwäsche',
    soak: 'Einweichen',
    main_wash: 'Waschen',
    rinse_hold: 'Spülstopp',
    cleaning: 'Reinigung',
    drain: 'Abpumpen',
    spin: 'Schleudern',
    venting: 'Belüften',
    starch_stop: 'Stärkestopp',
    freshen_up_and_moisten: 'Auffrischen/Befeuchten',
    hygiene: 'Hygiene',
    disinfecting: 'Desinfizieren',
    flex_load_active: 'FlexLoad aktiv',
    // Wärmeschublade
    door_open: 'Tür offen',
    keeping_warm: 'Warmhalten',
    // Backofen mit Mikrowelle, Dampfgarer mit Mikrowelle
    heating: 'Aufheizen',
    cooling_phase: 'Abkühlphase',
    // Saugroboter
    vacuum_cleaning: 'Saugt',
    returning: 'Rückfahrt zur Station',
    vacuum_cleaning_paused: 'Saugen pausiert',
    going_to_target_area: 'Fährt zum Zielbereich',
    docked: 'In der Station',
    remote_controlled: 'Ferngesteuert',
};

/**
 * Deutscher Phasenname aus englischem Enum-Wert; null wenn unbekannt (Fallback engl.).
 *
 * @param enText englischer Phasenname aus der Enum-Tabelle
 */
function phaseNameDe(enText) {
    if (enText == null) {
        return null;
    }
    return PhaseNameDe[enText] != null ? PhaseNameDe[enText] : null;
}

/**
 * Deutscher Programmname aus englischem Enum-Wert; null wenn unbekannt (Fallback engl.).
 *
 * @param enText englischer Programmname aus der Enum-Tabelle
 */
function programNameDe(enText) {
    if (enText == null) {
        return null;
    }
    return ProgramNameDe[enText] != null ? ProgramNameDe[enText] : null;
}

// deviceType → { statusDe, phaseDe, programDe? }
const BY_TYPE_DE = {
    1: { phase: ProgramPhaseWashingMachineDe }, // Waschmaschine
    24: { phase: ProgramPhaseWashingMachineDe }, // Waschtrockner
    7: { phase: ProgramPhaseDishwasherDe }, // Spülmaschine
    12: { phase: ProgramPhaseOvenDe }, // Backofen
    67: { phase: ProgramPhaseOvenDe }, // Dialoggarer (gleiche Phasentabelle wie der Backofen)
};

/**
 * Deutscher Klartext zum Statuswert.
 *
 * @param {number} v   Rohwert
 * @returns {string|null} Text oder null
 */
function statusDe(v) {
    return StateStatusDe[v] != null ? StateStatusDe[v] : null;
}
/**
 * Deutscher Klartext zur Programmart.
 *
 * @param {number} v   Rohwert
 * @returns {string|null} Text oder null
 */
function programTypeDe(v) {
    return StateProgramTypeDe[v] != null ? StateProgramTypeDe[v] : null;
}
/**
 * Deutscher Klartext zur Trockenstufe.
 *
 * @param {number} v   Rohwert
 * @returns {string|null} Text oder null
 */
function dryingStepDe(v) {
    return StateDryingStepDe[v] != null ? StateDryingStepDe[v] : null;
}
/**
 * Deutscher Klartext zur Programmphase - sie ist je Geraeteart verschieden.
 *
 * @param {number} deviceType   Geraeteart
 * @param {number} v   Rohwert der Phase
 * @returns {string|null} Text oder null
 */
function phaseDe(deviceType, v) {
    const m = BY_TYPE_DE[deviceType];
    if (m && m.phase && m.phase[v] != null) {
        return m.phase[v];
    }
    return null;
}

module.exports = {
    StateStatusDe,
    StateProgramTypeDe,
    StateDryingStepDe,
    ProgramNameDe,
    PhaseNameDe,
    statusDe,
    programTypeDe,
    dryingStepDe,
    phaseDe,
    programNameDe,
    phaseNameDe,
};
