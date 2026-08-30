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
docker compose up --build -d
```

Die Anwendung läuft dann unter `http://localhost:3001`.

Standardwerte:
- `BESTELL_PASSWORD`: Passwort für `/bestellen`
- `SESSION_SECRET`: Secret für die Session-Cookies
- `PORT`: Port (Standard 3000, wird auf 3001 gemappt)

Passen Sie die Werte in `docker-compose.yml` oder per Environment-Overrides an.

### Production-Compose (vorgefertigtes Image)

Für den Einsatz mit einem vorgefertigten Image aus der Registry kann
stattdessen diese Konfiguration verwendet werden:

```yaml
services:
  bestellsystem:
    image: ghcr.io/panda260/bestellsystem:main
    ports:
      - "3000:3000"
    environment:
      BESTELL_PASSWORD: "changeme"
      SESSION_SECRET: "replace-me"
    volumes:
      - ./data:/app/data
```
