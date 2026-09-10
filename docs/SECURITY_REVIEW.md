# Security-Review: öffentlicher Betrieb

Stand: 10.09.2026 · geprüfter Quellstand: `6c4a40f` · Branch: `security/public-security-review`

**Ergebnis: Der geprüfte Stand ist für einen ungeschützten Internetbetrieb nicht geeignet.**
Ohne Anmeldung sind Datenzugriffe, Bestellmanipulationen und Serverabstürze möglich.
Mehrere Ansichten übernehmen gespeicherte Bestelldaten ungefiltert als HTML.
Dieser Review-Commit enthält Dokumentation und ein ausführbares Nachweisskript;
die unten aufgeführten Sicherheitslücken sind **offen**, nicht behoben.

## Warum dieser Review nötig ist

Bei öffentlicher Erreichbarkeit können beliebige Personen die HTTP-API und
WebSocket-Schnittstelle direkt ansprechen. Eine versteckte oder passwortgeschützte
Webseite schützt ihre API nicht automatisch. Ein öffentliches Repository macht
außerdem Routen und eingecheckte Zugangsdaten einsehbar. Sicherheit muss deshalb
durch serverseitige Berechtigungsprüfungen und sichere Datenverarbeitung entstehen.

Zu schützen sind Kundennamen, Bestellinhalte, Preise und Statistiken sowie der
zuverlässige Küchenbetrieb. Angreifer benötigen für die wichtigsten Befunde weder
ein Konto noch Zugriff auf den Server oder auf das lokale Netzwerk.

## Umfang und Grenzen

Geprüft wurden `server.js`, `database.js`, alle JavaScript-Dateien unter `public/`,
Paketmanifest und Lockfile, Dockerfile, Compose, Ignore-Dateien, README und der
Workflow zur Image-Veröffentlichung. Schwerpunkt: Anmeldung, Autorisierung,
WebSockets, Eingabevalidierung, HTML-Ausgabe, Datenzugriff, Abhängigkeiten und Deployment.

Die dynamischen Nachweise liefen in **Docker**, mit kopiertem aktuellem Quellcode,
einer neuen temporären SQLite-Datenbank und ausschließlich künstlichen Bestellungen.
Der Anwendungstest hatte kein externes Netzwerk, keine veröffentlichten Ports,
keine Produktions-Volumes und begrenzte CPU-/RAM-Ressourcen. Zwei Absturztests
starteten jeweils einen eigenen Anwendungsprozess. Die Uhrzeit des Testprozesses
wurde auf 12:45 gesetzt, um das Mengenlimit reproduzierbar zu prüfen.

Nicht geprüft: tatsächliche öffentliche Domain, Reverse Proxy, TLS-Zertifikate,
Firewall, eingesetzte Secrets, Inhalt produktiver Datenbanken, bereits veröffentlichte
Images, vollständige Git-Historie und Betriebssystempakete im Image. Der Review
belegt keine bereits erfolgte Kompromittierung. Die XSS-Nachweise prüfen die
HTML-Ausgabe; eine Ausführung in einem echten Browser wurde nicht getestet.

## Befunde nach Priorität

Die Schweregrade sind eine Bewertung für diese Anwendung, keine berechneten CVSS-Werte.
Bei SR-06 hängt die tatsächliche Ausnutzbarkeit von den eingesetzten Zugangsdaten ab.

| ID | Schwere | Befund | Nachweis |
| --- | --- | --- | --- |
| SR-01 | Kritisch | Bestellungen ohne Anmeldung erstellen und verändern | Docker/HTTP |
| SR-02 | Hoch | Interne WebSocket-Räume ohne Autorisierung | Docker/WebSocket |
| SR-03 | Kritisch | Gespeicherte HTML-/JavaScript-Injektion | Datenfluss und Ausgabeprüfung |
| SR-04 | Kritisch | Serverabstürze, unbegrenzte Mengen, manipulierbare Preise | Docker/HTTP/WebSocket und Code |
| SR-05 | Hoch | Erratbare Bestellnummer gibt private Bestelldaten frei | Docker/HTTP und Code |
| SR-06 | Kritisch bei Nutzung der Vorgaben | Öffentliche Zugangsdaten und unsichere Fallbacks | Konfiguration und Docker/Login |
| SR-07 | Hoch | Fehlende Login-Drosselung und unzureichender Sitzungsschutz | Docker/Login und Code |
| SR-08 | Hoch | Bekannte Paketlücken und Node 20 außerhalb des Supports | npm audit in Docker, Herstellerquellen |
| SR-09 | Hoch | Daten und Secrets können in Docker-Images gelangen | Dockerfile/Ignore-Dateien |
| SR-10 | Mittel | Zu weit offene Deployment- und Veröffentlichungsdefaults | Compose/Workflow/Server |

### SR-01: API umgeht den Passwortschutz

**Fundstellen:** `server.js:820–947`, `950–1011`; geschützte Oberfläche bei `417–430`.

`POST /api/orders` prüft keine Sitzung. Dasselbe gilt für
`POST /api/orders/:id/items/:index/toggle`,
`POST /api/orders/:id/items/:index/toggle-oven` und
`POST /api/orders/:id/toggle-oven`.
Im Docker-Test lieferte das Anlegen ohne Cookie HTTP 201, alle drei Änderungen HTTP 200.

**Warum gefährlich:** Fremde können die Küche mit Bestellungen belasten und
Bestellungen als fertig oder im Ofen markieren. Die ID ist über SR-02/SR-05 erhältlich.

**Korrektur:** Gemeinsame Autorisierungs-Middleware vor allen internen Schreibzugriffen,
mit ausdrücklich definierten Rechten für Kasse und Küche. Auch `/bestellungen`
schützen. Falls öffentliche Selbstbestellung gewünscht ist, dafür einen eigenen,
validierten und gedrosselten Ablauf vorsehen; Küchenaktionen bleiben intern.

**Abnahme:** Ohne Sitzung liefern sämtliche internen Mutationen 401/403 und ändern
weder Datenbank noch Speicher. Berechtigte Kasse/Küche können weiter arbeiten.

### SR-02: WebSocket-Rollen sind vom Client frei wählbar

**Fundstellen:** `server.js:12`, `105–137`, `1149–1174`.

Der `join`-Handler akzeptiert `staff`, `kitchen`, `tv` und beliebige `orderId` ohne
Sitzungs- oder Tokenprüfung. Die Express-Sitzung wird nicht in Socket.IO eingebunden.
Der Test erhielt nach anonymem `staff`-Join Kundennamen, Artikel und Preise.
TV bekommt dieselbe vollständige Serialisierung, obwohl die Anzeige weniger benötigt.

**Warum gefährlich:** Alle aktiven Bestellungen lassen sich live mitlesen.
Ein Schutz nur der HTTP-Seiten würde diese zweite Zugriffsmöglichkeit offenlassen.
Wiederholte Joins lösen außerdem einen Broadcast an sämtliche internen Empfänger aus.

**Korrektur:** Sitzung beim Verbindungsaufbau prüfen und erlaubte Räume serverseitig
ableiten. Ablauf/Widerruf der Sitzung auch bei bestehenden Verbindungen berücksichtigen.
Kunden erhalten nur den mit ihrem Token verknüpften Auftrag. TV entweder mit
eingeschränkter Anmeldung betreiben oder ausdrücklich auf minimale, öffentliche
Daten reduzieren. Joins begrenzen und die Initialantwort nur an den neuen Socket senden.
Die [Socket.IO-Dokumentation](https://socket.io/docs/v4/middlewares/) beschreibt
Middleware für Authentifizierung; die konkrete Raumfreigabe bleibt Anwendungslogik.

**Abnahme:** Anonyme Clients können keine internen Räume betreten; abgelaufene
Sitzungen verlieren Zugriff. Ein Kunden-Token ermöglicht keinen Zugriff auf andere Aufträge.

### SR-03: Gespeichertes XSS über Bestellungen

**Fundstellen:** Eingabe/Speicherung `server.js:877–927`, `database.js:186–211`;
Ausgabe `public/bestellungen.js:22–47`, `public/status.js:52–69`,
`public/verlauf.js:15–30`, `public/stats-lifetime.js:17–33`.
Zusätzlich interpoliert `public/admin.js:21–70` Produkt-/Kategorienamen in HTML,
Attribute und Inline-Eventhandler; dieser zusätzliche Eingabepfad erfordert Anmeldung.

Anonyme Bestellungen dürfen frei gewählte Kunden- und Artikelnamen enthalten.
Mehrere Ansichten setzen diese anschließend per `innerHTML` ein. Im Docker-Test
blieb ein synthetischer `<img>`-Marker mit Eventhandler in der Ausgabe von Küche,
Kundenstatus und Lifetime-Statistik unverändert erhalten. Die Lifetime-Tabelle
speichert Artikelnamen zusätzlich dauerhaft; ein normales Zurücksetzen der
Bestellstatistik entfernt diesen Eintrag nicht.

**Warum gefährlich:** Beim Öffnen betroffener Ansichten kann eingeschleuster Code
im Ursprung der Anwendung laufen. Bei angemeldeten Beschäftigten kann er deren
berechtigte API-Zugriffe ausführen. `HttpOnly` verhindert das direkte Lesen des
Cookies, nicht solche Anfragen. Der Lifetime-Pfad erreicht eine angemeldete Ansicht
bereits durch das anonyme Anlegen einer Bestellung; Abholung ist dafür nicht nötig.

**Korrektur:** Text mit `textContent` rendern; DOM-Elemente und Eventlistener erzeugen,
statt Daten in Inline-JavaScript einzusetzen. Bestehende Daten ebenfalls sicher
rendern. Bereits gespeicherte schädliche Einträge nach Sicherung gezielt bereinigen,
einschließlich Lifetime-Statistik. Eine restriktive Content Security Policy ergänzt
die Ausgabekorrektur. Kontextgerechte Ausgabe ist entscheidend, siehe
[OWASP XSS Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html).

**Abnahme:** Testzeichen einschließlich Anführungszeichen und HTML-Tags erscheinen
in allen Ansichten als Text; Browsertests bestätigen, dass kein Eventhandler läuft.
Die bereits escapenden Ansichten `home.js`, `tv.js`, `names.js`, `bestellen.js` und
`stats.js` sind kein Beleg für die Sicherheit der übrigen Ansichten.

### SR-04: Fehlende Validierung gefährdet Verfügbarkeit und Bestellintegrität

**Fundstellen:** `server.js:820–907`, `950–1006`, `1149–1174`.

- Der Limitcheck iteriert `items`, bevor dessen Typ geprüft wird. `items: null`
  um 12:45 beendete den Docker-Testprozess mit Exit 1. Der Express-4-Handler
  fängt diese Promise-Ablehnung nicht ab.
- Ein WebSocket-`join` ohne Payload wirft beim Destrukturieren einen ungefangenen
  Fehler. Auch dieser Testprozess endete mit Exit 1, unabhängig vom Zeitfenster.
- `Number(item.qty)` steuert eine synchrone Schleife ohne Obergrenze.
  Beispielsweise würde der String `"Infinity"` zu einer nicht endenden
  Mengenexpansion führen. Diese ressourcenerschöpfende Variante wurde **nicht ausgeführt**.
  Das standardmäßige HTTP-Body-Limit begrenzt nicht die daraus erzeugte Artikelmenge.
- Der Server übernimmt Artikelnamen und Preise vom Client. Ein unbekannter Artikel
  mit Preis −7 wurde angenommen. Produktlimits rechnen nur `currentQty + 1`,
  ohne angeforderte Menge oder weitere Positionen einzubeziehen. Menge 2 wurde
  trotz Produktlimit 1 im Zeitfenster angenommen. Parallele Anfragen sind ebenfalls
  nicht durch eine atomare Limitprüfung abgesichert.

**Warum gefährlich:** Schon kleine Requests können den gesamten Küchenserver
beenden oder blockieren. Fremde können Preise, Auswertungen und Kapazitätslimits verfälschen.

**Korrektur:** Zuerst Schema/Typen prüfen, auch verschachtelte Objekte und Socket-Payloads.
Nur endliche, positive Ganzzahlmengen mit Artikel- und Gesamthöchstzahl zulassen.
Produkte per ID laden, Aktivität prüfen und Preise ausschließlich aus der Datenbank
beziehen. Mengen aggregiert und transaktional prüfen. Async-Fehler an eine zentrale
Fehlerbehandlung weitergeben; Socket-Handler dürfen fehlerhafte Eingaben nicht werfen.

**Abnahme:** Ungültige Payloads werden begrenzt mit 400 bzw. Socket-Fehler beantwortet,
der Prozess bleibt erreichbar. Preismanipulationen und überschrittene Limits werden
auch bei mehreren Positionen und parallelen Anfragen verhindert.

### SR-05: Bestellnummer ist kein ausreichendes Zugriffsgeheimnis

**Fundstellen:** `server.js:85–118`, `793–817`, `1115–1131`, `1166–1172`.

Die Nummern starten im Bereich 100–999. HTTP und Socket.IO geben allein anhand der
Nummer den vollständigen Auftrag heraus. Eine Kundenname-Abfrage ohne Anmeldung
wurde im Docker-Test bestätigt. Bis zum Neustart bleiben auch bereits abgeholte
Aufträge in der Speicher-Map abrufbar.

**Warum gefährlich:** Nur 900 mögliche Anfangsnummern lassen sich leicht systematisch
durchprobieren. QR-Code und Kundenseite sind Komfortfunktionen, keine Berechtigungsprüfung.

**Korrektur:** Die kurze Ausgabenummer getrennt von einem kryptografisch zufälligen
Zugriffstoken mit mindestens 128 Bit Entropie führen. HTTP und WebSocket müssen
dasselbe Token prüfen. Kundenantworten auf erforderliche Daten beschränken, Token
befristen, Abfragen drosseln und private Antworten mit `Cache-Control: no-store` versehen.
Die [OWASP-IDOR-Empfehlung](https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html)
erläutert die fehlende Objektberechtigung; komplexere IDs allein ersetzen sie nicht.

**Abnahme:** Die kurze Nummer allein erschließt keine privaten Details. Falsche oder
abgelaufene Tokens funktionieren weder über HTTP noch über Socket.IO.

### SR-06: Eingecheckte Zugangsdaten und feste Fallbacks

**Fundstellen:** `docker-compose.yml:7–9`, `server.js:15–16`, Beispiele in `README.md`.

Compose enthält ein festes Passwort und ein festes Session-Secret. Ohne Umgebungswerte
verwendet der Server bekannte Fallbacks; Anmeldung mit dem Passwort-Fallback wurde
bestätigt. Die konkreten Compose-Werte werden hier nicht erneut ausgeschrieben.

**Warum gefährlich:** Bei unveränderter Übernahme ist die komplette Verwaltung
öffentlich zugänglich. Bereits veröffentlichte Werte müssen als bekannt gelten.
Ein bekanntes Session-Secret erlaubt für sich allein **nicht** das Erfinden eines
angemeldeten serverseitigen Session-Datensatzes; es schwächt trotzdem dessen Signaturschutz.

**Korrektur:** Beide Werte außerhalb des Repositorys bereitstellen, bekannte Werte
rotieren und bestehende Sitzungen invalidieren. Bei fehlenden oder unsicheren Werten
den Start verweigern. `.env`-Dateien sowohl aus Git als auch aus Docker-Builds ausschließen;
die bisherigen Ignore-Dateien enthalten hierfür keine Regeln. Keine realen Secrets
in Beispielkonfigurationen. Ein gemeinsames Passwort gibt allen Beschäftigten
dieselben Rechte; für getrennte Rechte und Widerruf individuelle Konten vorsehen.

**Abnahme:** Kein erfolgreicher Start mit leeren/Fallback-Secrets, keine bekannten
Zugangsdaten im aktiven Deployment, alte Cookies nach Rotation ungültig.

### SR-07: Login, Cookies und Sitzungslebenszyklus

**Fundstellen:** `server.js:24–31`, `177–201`, `417–430`, `515–535`.

25 aufeinanderfolgende falsche Loginversuche wurden ohne Drosselung beantwortet.
Beide Einstiegspunkte (`/enter`, `/bestellen/login`) vergleichen unmittelbar das
Passwort. Beim erfolgreichen Login bleibt die zuvor ausgestellte Session-ID gleich.
Es fehlen Logout, explizite Sitzungsdauer und `Secure`-/`SameSite`-Cookie-Konfiguration.
`HttpOnly` ist durch den Bibliotheksdefault bereits aktiv.

Der voreingestellte MemoryStore besitzt keine hier konfigurierte TTL; anonyme
Aufrufe von `/bestellen` oder `/namen` legen durch `redirectAfterLogin` bereits
Sitzungen an. Wiederholte Anfragen ohne Wiederverwendung des Cookies können den
Speicher wachsen lassen. Express beschreibt den MemoryStore ausdrücklich als
ungeeignet für Produktion, siehe [express-session](https://expressjs.com/en/resources/middleware/session/).

Es gibt keine explizite CSRF-/Origin-Prüfung. Der Test bestätigt nur, dass der Login
einen fremden Origin akzeptiert. Das ist **kein vollständiger Browser-CSRF-Nachweis**:
Cookie-Defaults des Browsers, SameSite-Regeln und Content-Type/CORS sind zu beachten.
Die anonymen Mutationen aus SR-01 benötigen ohnehin keine fremde Sitzung.

**Korrektur:** Beide Loginwege gemeinsam drosseln, Session beim Login regenerieren,
Logout/Widerruf und begrenzte Lebensdauer implementieren, produktionsgeeigneten
Store mit TTL nutzen. Für HTTPS `Secure`, explizites `SameSite` und einen zur
Proxy-Topologie passenden `trust proxy`-Wert setzen. Zustandsänderungen einschließlich
Login durch CSRF-/Origin-Schutz absichern; `trust proxy` nicht pauschal beliebigen
Absendern gewähren.

**Abnahme:** Wiederholte Fehlversuche ergeben 429, erfolgreiche Anmeldung wechselt
die Session-ID, Logout/Ablauf sperren HTTP und Socket.IO. Fremde Browserursprünge
können keine Zustandsänderungen auslösen. Tests der echten HTTPS-Proxy-Kette sind nötig.

### SR-08: Verwundbare Abhängigkeiten und veraltete Laufzeit

**Fundstellen:** `package-lock.json`, `Dockerfile:1–6`, `.github/workflows/docker-publish.yml:29–32`.

`npm audit --omit=dev --package-lock-only --json` lief am Reviewdatum in Docker
(`node:24.19.0-alpine`, npm 11.17.0) gegen die npm-Registry. Exit 1 wegen
**9 betroffener Pakete: 1 kritisch, 3 hoch, 5 mittel**. Das sind Paketbewertungen
einschließlich transitiver Abhängigkeiten, nicht neun nachgewiesene Angriffswege.

| Paket im Lockfile | Version | npm-Schwere |
| --- | --- | --- |
| body-parser | 1.20.5 | Mittel |
| engine.io | 6.6.7 | Mittel |
| express | 4.22.2 | Mittel |
| qs | 6.15.1 | Mittel |
| socket.io-adapter | 2.5.6 | Mittel |
| socket.io-parser | 4.2.6 | Hoch |
| tar | 7.5.15 | Kritisch |
| undici | 6.25.0 | Hoch |
| ws | 8.18.3 | Hoch |

Für die exponierte WebSocket-Schnittstelle sind insbesondere
[Socket.IO-Parser-Speichererschöpfung](https://github.com/advisories/GHSA-2m8v-j782-fhvr)
und [ws-Speichererschöpfung](https://github.com/websockets/ws/security/advisories/GHSA-96hv-2xvq-fx4p)
relevant. Laut ws-Hersteller ist dessen genannter Befund ab 8.21.0 behoben.
Das Audit meldet für alle neun Pakete verfügbare Updates; konkrete Zielversionen
müssen beim Umsetzen erneut geprüft und mit der Anwendung getestet werden.

`tar` und `undici` gelangen unter anderem über `sqlite3`/`node-gyp` in den Baum.
Der Anwendungscode bietet keinen Archiv-Upload und verwendet diese Pakete nicht
direkt. Die kritische tar-Bewertung ist deshalb kein belegter anonymer Angriff
auf eine Anwendungsroute. Ebenso benötigt ein gemeldeter `body-parser`-Befund eine
ungültige Limit-Konfiguration, die hier nicht gesetzt ist. Die Audit-Schwere darf
nicht ungeprüft mit praktischer Erreichbarkeit gleichgesetzt werden.

Dockerfile und CI nennen Node 20. Diese Reihe ist am Reviewdatum EOL, siehe
[Node.js-Releases](https://nodejs.org/en/about/previous-releases).
Der isolierte Anwendungstest nutzte das vorhandene Image mit Node 20.20.2, um den
bisherigen Stand zu prüfen; dies ist keine Empfehlung für den weiteren Betrieb.

**Korrektur:** Unterstützte LTS-Laufzeit und passende Paketupdates verwenden,
Lockfile aktualisieren, reproduzierbar mit `npm ci --omit=dev` bauen, danach
Anwendungstests und Audit wiederholen. Zusätzlich das fertige Container-Image scannen.

**Abnahme:** Unterstützte Laufzeit; keine unbewerteten hohen/kritischen Befunde;
Login, Bestellung, SQLite-Persistenz und WebSocket-Updates funktionieren mit den Updates.

### SR-09: Docker-Build kann Datenbank und Secrets einpacken

**Fundstellen:** `Dockerfile:8`, `.dockerignore:1–4`, `docker-compose.yml:3–4`.

`COPY . .` kopiert den Buildkontext. `.dockerignore` schließt weder `data/`,
SQLite-Dateien, Backups noch `.env` aus. Ein lokales `data/`-Verzeichnis ist vorhanden;
sein Inhalt wurde nicht geöffnet. `.gitignore` wirkt nicht auf Docker-Buildkontexte.

**Warum gefährlich:** Bei einem lokalen Build können Kundenbestellungen und
Zugangsdaten in Image-Layern landen und mit einem Image weitergegeben werden.
Ein später über `/app/data` gemountetes Volume entfernt die darunterliegende
Image-Schicht nicht. Eine bereits erfolgte Veröffentlichung solcher Daten wurde
nicht nachgewiesen; ein sauberer CI-Checkout enthält ignorierte lokale Daten nicht.

**Korrektur:** Sensible Dateien in `.dockerignore` ausschließen und die benötigten
Anwendungsdateien möglichst gezielt kopieren. Mit synthetischen Datenbank-/Secret-Markern
prüfen, dass sie weder im Buildkontext noch im fertigen Image liegen. Vorhandene
veröffentlichte Images separat untersuchen und bei bestätigtem Leak Secrets rotieren.

**Abnahme:** Image-/Layer-Prüfung findet keine Marker, Datenbanken oder echten Secrets.

### SR-10: Deployment- und CI-Härtung fehlen

**Fundstellen:** `docker-compose.yml:5–13`, `Dockerfile`,
`.github/workflows/docker-publish.yml:3–20,34–60`, `server.js:810,939`.

Compose veröffentlicht den HTTP-Port ohne Beschränkung der Hostadresse und bindet
den gesamten Quellbaum schreibbar ein. Das Dockerfile setzt keinen unprivilegierten
Benutzer und kein `NODE_ENV=production`. Im Server fehlen explizite Sicherheitsheader,
privates Cache-Verhalten und ein zentraler Fehlerhandler; einige Antworten enthalten
interne `err.message`-Texte. QR-URLs übernehmen Schema und Host aus der Anfrage.
Ein tatsächlich vorhandener TLS-Proxy oder externe Filter wurden nicht geprüft.

Der Workflow versucht auch bei Pull Requests und allen Branches mit
`packages: write` Images zu veröffentlichen (`push: true`). Ob das gelingt,
hängt von Ereignis, Tokenrechten und Registry ab; bei Fork-PRs sind Schreibrechte
typischerweise eingeschränkt. Der Code belegt keine automatische Secret-Freigabe
an fremde Forks. Sicherheits- und Funktionstests fehlen vor dem Publish-Schritt.

**Warum gefährlich:** Der direkte HTTP-Port kann vorgeschaltete Schutzmaßnahmen
umgehen. Große Schreibrechte erhöhen den Schaden eines kompromittierten Prozesses.
Ungeprüfte Branch-Images erschweren die Trennung von Review und Freigabe.
Hostabhängige QR-URLs können bei akzeptierten manipulierten Host-Headern auf eine
falsche Domain zeigen; das tatsächliche Proxy-Verhalten ist offen.

**Korrektur:** TLS erzwingen und den Backend-Port auf Loopback oder ein internes
Proxy-Netz begrenzen. Als unprivilegierter Benutzer mit nur benötigtem Datenvolume
und Ressourcenlimits starten. Kanonische öffentliche Basis-URL konfigurieren,
Fehlerausgaben begrenzen, Sicherheitsheader mit den bestehenden Skripten abstimmen.
Die [Express-Sicherheitsempfehlungen](https://expressjs.com/en/advanced/best-practice-security/)
beschreiben TLS, Eingabeprüfung, Header und Login-Schutz. CI in lesende PR-Tests
und Veröffentlichung aus freigegebenen Branches trennen; Actions nach Möglichkeit
auf geprüfte Commit-SHAs festlegen.

**Abnahme:** Direkter Backend-Port ist von außen nicht erreichbar, HTTPS und Login
funktionieren hinter dem Proxy, Prozess läuft ohne Root und ohne Quellbaum-Schreibrechte.
PR-Prüfungen veröffentlichen keine Images; freigegebene Builds durchlaufen Tests.

## Docker-Testprotokoll und Wiederholung

Das Skript [security-review-probe.cjs](security-review-probe.cjs) ist ein
**Nachweis des verwundbaren Ausgangszustands**, kein grüner Sicherheitstest.
Exit 0 bedeutet hier: Die beschriebenen Schwachstellen wurden reproduziert.
Nach ihrer Behebung müssen die Erwartungen zu ablehnenden Zugriffen und
ausbleibenden Abstürzen in reguläre Regressionstests umgewandelt werden.

Verwendetes Anwendungsimage: `bestellsystem-bestellsystem:latest`, vorhandenes
lokales Image. Der aktuelle Quellcode wurde per TAR über stdin eingespielt;
der alte Anwendungscode aus dem Image wurde nicht gestartet.
Das Skript verglich die installierten Versionen von Express 4.22.2,
express-session 1.19.0, Socket.IO 4.8.3 und sqlite3 6.0.1 mit dem aktuellen Lockfile.
Andere transitive Versionen des vorhandenen Images wurden nicht vollständig
abgeglichen; das separate npm audit bezieht sich auf das Repository-Lockfile.

Aus dem Repository wiederholen; benötigt das genannte lokale Image:

```bash
tar -cf - server.js database.js public package.json package-lock.json docs/security-review-probe.cjs |
  docker run --rm -i --network none --read-only \
    --tmpfs /tmp:rw,nosuid,nodev,size=128m --memory 256m --cpus 1 --pids-limit 64 \
    --cap-drop ALL --security-opt no-new-privileges \
    -e NODE_PATH=/app/node_modules --entrypoint sh bestellsystem-bestellsystem:latest \
    -c 'mkdir /tmp/review && tar -xf - -C /tmp/review && node /tmp/review/docs/security-review-probe.cjs'
```

Es wird ausdrücklich kein `docker compose up` gegen die vorhandenen Daten benötigt.
Der Port 31337 existiert nur innerhalb des Testcontainers. Der Test verändert
ausschließlich seine temporären Daten und entfernt sie anschließend.

| Prüfung | Beobachtung |
| --- | --- |
| Anonyme Bestellung mit beliebigem Namen/negativem Preis | 201, Total −7 |
| Anonymer Zugriff über Bestellnummer | Kundennamen und Artikel erhalten |
| Drei Küchenmutationen ohne Cookie | Jeweils 200 |
| Anonymer WebSocket-Join als `staff` | Vollständigen Auftrag erhalten |
| Geschützte HTTP-Routen: Statistik, Namen, Admin-Menü, Verlauf | Jeweils 401, positive Gegenprobe |
| Login mit Fallback, bestehendem Cookie und fremdem Origin | 302, dieselbe Session-ID danach authentifiziert |
| 25 falsche Logins | Jeweils 401, keine Drosselung |
| Menge 2 bei Produktlimit 1 um 12:45 | 201, zwei Artikel gespeichert |
| Küche, Status, Lifetime mit HTML-Marker | Eventhandler-Markup ungefiltert in `innerHTML` |
| `items: null` um 12:45 | Separater Serverprozess beendet, Exit 1 |
| Socket-`join` ohne Payload | Separater Serverprozess beendet, Exit 1 |

Ergebnis des Nachweisskripts: **Exit 0, sämtliche Erwartungen bestätigt**.
Unbegrenzte Mengen, Broadcast-Flooding, Browser-XSS und parallele Limitumgehung
wurden nicht dynamisch belastend getestet; die betreffenden Aussagen basieren auf Codeprüfung.

Separater Abhängigkeitscheck, mit Netz nur für die npm-Registry:

```bash
tar -cf - package.json package-lock.json |
  docker run --rm -i --read-only \
    --tmpfs /tmp:rw,nosuid,nodev,size=64m --memory 256m --cpus 1 --pids-limit 32 \
    --cap-drop ALL --security-opt no-new-privileges \
    --entrypoint sh node:24.19.0-alpine \
    -c 'mkdir /tmp/audit && tar -xf - -C /tmp/audit && cd /tmp/audit && npm audit --omit=dev --package-lock-only --json --cache /tmp/npm-cache'
```

Ergebnis: **Exit 1 wegen bekannter Paketlücken**, kein Fehler der Testinfrastruktur.
Audit-Ergebnisse können sich mit neuen Advisories ändern.

## Was bereits sinnvoll abgesichert ist

- Verwaltungs-, Namens-, Statistik-, Verlaufs- und Abhol-APIs besitzen überwiegend
  eine serverseitige Sitzungsprüfung; die oben genannten HTTP-Gegenproben bestätigen vier davon.
- SQL-Werte werden an den geprüften Stellen über Parameter gebunden. Es wurde
  keine konkrete SQL-Injection nachgewiesen.
- Mehrere neuere Oberflächen escapen Text bereits, und die numerische Statusroute
  validiert die Bestellnummer vor der HTML-Ausgabe.
- Statische Dateien werden nur aus `public/` ausgeliefert; daraus ergibt sich kein
  direkter HTTP-Download der SQLite-Datei. SR-09 betrifft den separaten Image-Build.

## Reihenfolge der Behebung

1. Bei laufendem öffentlichen Betrieb den Zugang bis zur Behebung begrenzen und
   tatsächlich verwendete bekannte Secrets rotieren. Das wurde in diesem Review nicht ausgeführt.
2. SR-01 bis SR-04 gemeinsam schließen: Autorisierung für HTTP und WebSocket,
   sichere Ausgabe, strikte Eingabevalidierung und abgefangene Fehler.
3. Kunden-Token, Sitzungslebenszyklus und Login-/Anfragedrosselung implementieren.
4. Laufzeit/Pakete aktualisieren, Docker-Kontext und Veröffentlichungsablauf härten.
5. Ablehnende Regressionstests, echte Browsertests und einen HTTPS-Proxy-Testlauf
   mit künstlichen Daten durchführen. Erst danach die öffentliche Freigabe neu bewerten.

Eine bloße Änderung des Passworts behebt die anonymen API- und WebSocket-Zugriffe nicht.
