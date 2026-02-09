# BestellSystem

Ein kleines Web-Bestellsystem mit Live-Updates für Kasse, Küche und Kunden.

## Funktionen

- Startseite `/` mit Eingabefeld für die 3-stellige Bestell-ID.
- Geschützte Bestellaufnahme unter `/bestellen` (Passwort über `BESTELL_PASSWORD`).
- Küchenansicht unter `/bestellungen` mit Live-Status.
- Kundenstatus unter `/<bestellid>` (QR-Code wird nach dem Anlegen erzeugt).
- Live-Updates via WebSocket (Socket.IO).

## Lokaler Start

```bash
npm install
npm start
```

Die Anwendung läuft dann unter `http://localhost:3000`.

## Docker Compose

```bash
docker compose up --build
```

Standardwerte:
- `BESTELL_PASSWORD`: Passwort für `/bestellen`
- `SESSION_SECRET`: Secret für die Session-Cookies
- `PORT`: Port (Standard 3000)

Passen Sie die Werte in `docker-compose.yml` oder per Environment-Overrides an.
