# ioBroker.miele-local — Entwicklungsdokumentation

Stand: 2026-08-16. Adapter läuft produktiv in der ioBroker-Instanz auf der NAS
(`buanet-iobroker`, Host `buanet-iobroker-1`), alle drei Küchengeräte werden live gelesen.

## 1. Ziel

Moderne Miele@Home-Geräte **lokal ohne Internet** an ioBroker anbinden — direkt über das
lokale Miele-Protokoll (`MieleH256` / DOP2) im LAN, ohne Cloud-Betrieb, ohne Miele-3rd-Party-API.
Die einmalige Anmeldung dient nur der Ermittlung des lokalen Haushaltsschlüssels.

## 2. Protokoll (reverse-engineered, verifiziert)

- **Transport:** HTTP auf Port 80 der Geräte. Content-Type `application/vnd.miele.v1+json`.
- **Signierung (MieleH256):** GroupKey = 64 Byte. AES-Key = erste 32 Byte, HMAC-Key = alle 64 Byte.
  Signatur = HMAC-SHA256 über `METHOD\nHOST/resource\nContent-Type\nAccept\nDate\n` + Body.
  Header: `Authorization: MieleH256 <GroupID>:<SIG_HEX_UPPER>`.
- **Antwort:** AES-256-CBC-verschlüsselt; Key = erste 32 Byte GroupKey, **IV = erste 16 Byte der
  Signatur aus dem `X-Signature`-Antwortheader**.
- **Schreiben (PUT/POST):** Body auf 16 Byte gepaddet (JSON: Leerzeichen vor `}`, min. 64 Byte),
  AES-CBC verschlüsselt, IV = erste 16 Byte der Request-Signatur.
- **GroupID** steht im Klartext im mDNS-TXT (`group=…`), haushaltsweit gleich.

## 3. Login / GroupKey-Ermittlung

Cloud-OAuth (PKCE) gegen `prod.map.miele-iot.com` (client_id DE `UJgKOxacIul2BcPJAzrQE6p0`,
scope `openid mcs bpdata zuora`, redirect `miele://oauth2-code/`) → mit dem Token
`GET https://rest-eu.domestic.miele-iot.com/V2/GroupKeyId/` → liefert `{groupId, groupKey, devices}`.
Erhält die Miele-App-Kopplung. GroupKey wird verschlüsselt in der Instanz-Config gespeichert
(`encryptedNative`), niemals im Code.

**Redirect-Code abgreifen** (Browser blockt `miele://`): entweder über den „Öffnen mit"-Dialog
(die App, z. B. kate, bekommt die volle URL) oder über DevTools → Netzwerk (`…/de/redirect?…code=…`).
Beide Formen akzeptiert der Adapter.

## 4. Architektur (Module)

| Datei | Zweck |
|---|---|
| `lib/crypto.js` | MieleH256 signieren, AES-CBC ent-/verschlüsseln, Padding, Peer-Antwort-Signatur |
| `lib/api.js` | signierte GET/PUT/POST, DOP2-Read |
| `lib/discovery.js` | mDNS `_mieleathome._tcp` (Auto-Discovery, **experimentell**) |
| `lib/cloud.js` | OAuth/PKCE + `/V2/GroupKeyId/` |
| `lib/enums.js` | Status/Programm/Phasen-Tabellen (aus Referenz generiert), Klartext-Dekodierung |
| `lib/objects.js` | Objektmodell (State/Ident/Control), deutsche Namen (DE_NAMES) |
| `lib/enroll.js` | SuperVision-Enrollment (Push, **experimentell**) |
| `lib/dop2.js` | DOP2-Binärparser (für EcoFeedback) |
| `lib/push.js` | SuperVision-Push-Listener (**experimentell**) |
| `main.js` | Lifecycle, Polling, Steuerung, Eco, Enrollment, Admin-Messages, Telemetrie |
| `admin/jsonConfig.json` | Instanz-UI (5 Tabs) |

## 5. Funktionen

- **Auto-Discovery** per mDNS (experimentell; im Docker-Bridge-Netz nicht nutzbar → manuelle IPs).
- **Polling** `/State` + `/Ident`, Enum-Dekodierung (Status/Programm/Phase Klartext), Zeiten in
  Minuten, Temperaturen ÷100, Sentinel −32768 → null. Intervall 5 s aktiv / 15 s Ruhe.
- **Deutsche Datenpunktnamen** als `common.name {en,de}` (Checkbox „Datenpunkt-Namen auf Deutsch").
- **Steuerung** (opt-in): Start/Stop/Pause/Licht via DOP2 UserRequest (2/1583), Ein-Aus seit 0.4.3 über
  2/1586 mit Wecken und Rückfall 2/1583 (`lib/einschalten.js`). Nach dem
  Schreiben kurze Poll-Pause (~2,5 s), dann gezielter Refresh.
- **EcoFeedback** (Energie/Wasser) per DOP2-Leaf 2/6195 — nur wo verfügbar; separates Intervall.
- **Push** (experimentell): Enrollment (`PUT /SuperVision` + `POST /Subscriptions`) + Listener.

## 6. Geräte-Befunde (dieser Haushalt)

| Gerät | IP | Modul | `/State` | DOP2-Leaf-Reads | EcoFeedback | SuperVision-Push |
|---|---|---|---|---|---|---|
| Waschmaschine WCR860 | .127 | EK037 | ✅ | ✅ (200) | ✅ 2/6195 (Energie #25 Wh, Wasser #40 0,1 l) | ❌ kein /SuperVision (404) |
| Spülmaschine G5840 | .125 | EK037 | ✅ | ❌ alle 500 (auch aus) | ❌ | ❌ 404 |
| Backofen H2469BP | .141 | EK057 | ✅ | Leaf 2/6195 → 404 | ❌ (keiner) | ❌ 404 |

**EcoFeedback-Plausibilität** (gegen mielecloudservice geprüft): eco.energy 1,991 kWh vs Cloud 1,9;
eco.water 95,3 l vs Cloud 96. Referenz-Indizes 16/17 waren für dieses Modell falsch → empirisch
korrigiert auf #25 (Energie, Wh) und #40 (Wasser, 0,1 l).

**Push:** Enrollment funktioniert (Subscriptions → 201), aber diese XKM-Module (EK037/EK057) haben
keinen `/SuperVision`-Endpunkt → es kommen keine Push-Events. Push daher default AUS, „experimentell".

## 7. Netzwerk / Ports

- Ausgehend TCP 80 → Geräte (Pflicht); TCP 443 → miele-iot.com nur bei Anmeldung.
- UDP 5353 (mDNS) nur für Auto-Discovery — bei manuellen IPs **nicht** nötig.
- Eingehend TCP `pushPort` (18082) nur bei Push; sinnvoll nur mit Host-Netz (Callback hinter
  Bridge-NAT unerreichbar). macvlan auf der NAS nicht möglich (Open vSwitch `ovs_bond0`).

## 8. Deployment (NAS)

Adapter liegt im Container unter `/opt/iobroker/custom-adapters/iobroker.miele-local` + Symlink in
`node_modules` (wie roborock-local). Transfer per Portainer-Docker-Exec (Helfer `scratchpad/pt.py`:
`curl --http1.1` + Retry, base64-chunked), danach `iobroker upload miele-local` + Restart.
`multicast-dns` ist die einzige externe Laufzeit-Abhängigkeit.

## 9. Tests

- Krypto-Unit-Tests grün (`npm run test:crypto`).
- End-to-End gegen die echten Geräte: 147 Objekte, `connection=true`, korrekte Dekodierung.
- Steuerung: lightOn am Ofen → HTTP 404 (MobileStart aus) sauber behandelt.
- EcoFeedback live gegen Cloud verifiziert.
- Push E2E: Subscriptions 201, 0 Events (Hardware ohne SuperVision).

## 10. Offene Punkte

- **Spülmaschine EcoFeedback** im **laufenden** Betrieb erneut testen (im Aus-Zustand alle Leaf-Reads 500).
- Optional: `@iobroker/testing`/adapter-checker, GitHub-Repo, Veröffentlichung.
