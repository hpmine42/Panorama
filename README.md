# Panorama Viewer

**Panorama Viewer** ist eine mobile-first Progressive Web App zum lokalen Betrachten von Panorama-Fotos. Das Bild wird nicht als langes, horizontales Dokument gescrollt: Ein eigener WebGL-Renderer projiziert equirectangulare Panoramen mit einer perspektivischen Kamera. Wischen, Pinch-to-Zoom und Trägheit fühlen sich dadurch wie eine kleine Foto-App an.

Die Anwendung verarbeitet Bilder standardmäßig vollständig im Browser. Es gibt keinen Upload und keinen eigenen Server.

## Features

- WebGL-GPU-Rendering für equirectangulare Panoramen, ohne Three.js
- Automatische Erkennung sehr breiter Bilder ab einem Seitenverhältnis von ungefähr 1,75:1
- Öffnen über Dateiauswahl, Galerie bzw. Android-Teilen-Menü
- JPG, JPEG, PNG, WEBP sowie HEIC/HEIF, soweit der jeweilige Browser dekodieren kann
- 1-Finger-Navigation mit direkter Bewegungsrichtung:
  - nach links wischen bewegt den sichtbaren Bildinhalt nach links
  - nach rechts wischen bewegt ihn nach rechts
  - vertikale Gesten bewegen die Ansicht leicht nach oben oder unten
- Pointer Events mit `touch-action: none`, `requestAnimationFrame` und natürlicher Trägheit
- Pinch-to-Zoom mit Ankerkorrektur unter dem Finger
- Doppeltippen, Plus/Minus-Schaltflächen und Mausrad-Zoom auf Desktop
- Zoom-out unter die Bildschirmgröße bei normalen Fotos mit dynamischem Foto-Hintergrund
- Derselbe stark vergrößerte, weichgezeichnete und abgedunkelte Bildinhalt als Hintergrund
- Zurücksetzen, Vollbild und Bildwechsel ohne unnötige Panels
- Responsive für Hochformat, Querformat, Resize und Orientation Change
- Speicherbewusste GPU-Texturen: sehr große Quellen werden vor dem Upload auf bis zu 4096 Pixel Kantenlänge reduziert
- Vollständige PWA mit Manifest, Offline-App-Shell, Icons und Service Worker
- Web Share Target für Bilddateien aus Apps wie Google Fotos
- Keine automatische Speicherung auf einem Server

## Demo

> Demo-Link folgt nach der Veröffentlichung, zum Beispiel: `https://<username>.github.io/Panorama/`

## Installation

Voraussetzungen:

- Node.js 20 oder neuer empfohlen
- npm 10 oder neuer empfohlen

Repository lokal klonen und Abhängigkeiten installieren:

```bash
git clone https://github.com/<username>/Panorama.git
cd Panorama
npm install
```

## Entwicklung

Development Server starten:

```bash
npm run dev
```

Vite zeigt anschließend die lokale URL an, üblicherweise `http://localhost:5173/`. Für Tests auf einem anderen Gerät im selben Netzwerk kann Vite über die konfigurierte Adresse erreichbar gemacht werden; das Gerät muss den Entwicklungsrechner erreichen können. PWA-Funktionen sind im Development-Modus absichtlich nicht registriert, damit kein alter Service-Worker den Entwicklungsstand cached.

Typprüfung und Production-Build:

```bash
npm run typecheck
npm run build
```

Den fertigen Build lokal prüfen:

```bash
npm run preview
```

Der Build liegt in `dist/`. Der Ordner wird nicht in Git eingecheckt.

## Deployment

### GitHub Pages über GitHub Actions

Das Repository enthält unter `docs/github-actions/deploy-pages.yml` eine fertige Workflow-Vorlage. Lege sie vor dem ersten Push als `.github/workflows/deploy-pages.yml` ab (oder richte Pages über einen anderen Build-Host ein). Nach dem Push auf `main` baut die Action die App und veröffentlicht `dist/` mit GitHub Pages.

1. Repository auf GitHub anlegen oder aktualisieren.
2. Optional die Vorlage nach `.github/workflows/deploy-pages.yml` kopieren; alternativ kann die Action direkt in GitHub angelegt werden.
3. Unter **Settings → Pages → Build and deployment** als Quelle **GitHub Actions** auswählen.
4. Auf `main` pushen.
5. Die Action unter **Actions** abwarten.
6. Die angezeigte Pages-URL öffnen, zum Beispiel `https://<username>.github.io/Panorama/`.

Die Vite-Konfiguration verwendet absichtlich `base: './'`. Dadurch funktionieren JavaScript-, CSS-, Manifest-, Icon- und Service-Worker-Pfade sowohl am Domain-Root als auch unter dem GitHub-Pages-Unterpfad `/Panorama/`. Die App verwendet Hash-Zustand statt serverseitiger Client-Routen; dadurch gibt es für die Viewer-Ansicht kein klassisches SPA-404-Problem.

GitHub Pages liefert HTTPS aus. Das ist für Service Worker, PWA-Installation und Web Share Target notwendig. Für eine eigene statische Domain gilt dasselbe: HTTPS aktivieren und `sw.js` aus demselben Verzeichnis wie die App ausliefern.

### Manuelles statisches Hosting

```bash
npm install
npm run build
```

Den kompletten Inhalt von `dist/` auf einen HTTPS-fähigen statischen Host kopieren. Wichtig ist, dass `sw.js` am App-Root innerhalb seines gewünschten Scopes erreichbar bleibt. Bei einem Unterpfad muss der gesamte Unterpfad statisch ausgeliefert werden.

## PWA installieren

Auf Android mit Chrome oder einem Chromium-basierten Browser:

1. Die HTTPS-URL öffnen.
2. Warten, bis die Seite einmal vollständig geladen wurde.
3. Das Browser-Menü öffnen.
4. **App installieren** oder **Zum Startbildschirm hinzufügen** auswählen.
5. Die Installation bestätigen.

Die App verwendet `display: standalone`, Theme-/Hintergrundfarben, responsive Safe-Area-Abstände und einen Service Worker für die Offline-App-Shell. Der Browser kann je nach Version und Hersteller eigene Installationsdialoge verwenden. Eine installierte PWA kann nicht auf jedem Gerät automatisch in einen echten Android-Immersive-Fullscreen wechseln; der Vollbild-Button nutzt die verfügbare Fullscreen API zusätzlich.

## Android Share Target

Das Manifest enthält ein echtes Web Share Target:

```json
"share_target": {
  "action": "./?share-target=1",
  "method": "POST",
  "enctype": "multipart/form-data"
}
```

Damit ein Eintrag im Android-Teilen-Menü erscheint, müssen alle folgenden Voraussetzungen erfüllt sein:

1. Die App muss über **HTTPS** geöffnet werden. `http://localhost` ist nur für lokale Entwicklung gedacht.
2. Die PWA muss über das Browser-Menü installiert worden sein. Ein normaler Tab reicht nicht zuverlässig als Share Target.
3. Der Browser muss Web App Manifest, Service Worker und Web Share Target unterstützen. Das ist vor allem bei aktuellem Chrome auf Android der Fall.
4. Der Service Worker muss mindestens einmal registriert und aktiv geworden sein. Nach der ersten Installation die App einmal öffnen.
5. Die Quell-App muss Bilddateien tatsächlich als Dateien teilen können.

Beispiel mit Google Fotos:

1. Panorama in **Google Fotos** öffnen.
2. **Teilen** antippen.
3. In der Android-Zeile **Panorama Viewer** auswählen; gegebenenfalls die Liste mit **Mehr** erweitern.
4. Android startet die installierte PWA. Der Service Worker nimmt die Multipart-POST-Anfrage an, legt die Datei nur lokal in IndexedDB ab und leitet zur App zurück.
5. Der Viewer dekodiert und öffnet das Bild automatisch.

Das Teilen erfolgt hier nicht über einen eigenen Cloud-Endpunkt. Die Datei wird nur für den Übergang vom Service Worker zur geöffneten App lokal zwischengespeichert und nach dem Einlesen wieder aus IndexedDB entfernt.

**GitHub-Pages-Hinweis:** GitHub Pages hat keinen serverseitigen POST-Endpunkt. Genau dafür übernimmt `public/sw.js` die POST-Anfrage. Der Service Worker muss vom selben Origin und innerhalb des App-Scope ausgeliefert werden. Falls ein Browser Service-Worker-POST-Redirects oder Share Targets in einer bestimmten Version nicht unterstützt, kann der Eintrag fehlen; die normale Dateiauswahl funktioniert weiterhin.

## Browser Support

Empfohlen:

- Chrome/Chromium auf Android 12 oder neuer, besonders auf einem Google Pixel 9a
- aktueller Chrome, Edge oder Firefox auf Desktop mit WebGL und Pointer Events

Wichtige Einschränkungen:

- WebGL ist die primäre Rendering-Basis. Browser oder WebViews ohne WebGL können den Viewer nicht darstellen.
- HEIC/HEIF ist kein garantiertes Webformat. Die Datei wird nur geöffnet, wenn der Browser einen passenden Decoder bereitstellt. Auf Geräten ohne Decoder bitte in JPG/PNG/WEBP exportieren.
- Web Share Target ist vor allem für installierte Chromium-PWAs auf Android verfügbar. iOS Safari bietet diesen Android-Share-Target-Weg nicht in gleicher Form.
- Google Fotos und Android können ein Bildformat oder eine sehr große Datei vor dem Teilen bereits konvertieren oder die Datei nicht an eine Web-App weitergeben.
- Equirectangulare 360°-Panoramen funktionieren am besten im üblichen 2:1-Format. Breite Nicht-Panoramen werden heuristisch als Panorama erkannt; die Ansicht kann über **Zurücksetzen** neu initialisiert werden.
- Sehr große Bilder werden für die GPU auf bis zu 4096 Pixel pro Kante reduziert. Das schützt den Arbeitsspeicher und die GPU, kann aber gegenüber dem Original eine geringere Detailauflösung bedeuten.
- Vollbild ist eine Browser- und Installationsfunktion. Browser-UI, Systemleisten und Hersteller-Sicherheitsregeln können nicht von einer Web-App entfernt werden.
- Ein Service Worker benötigt HTTPS (Ausnahme: `localhost` für Entwicklung). Private-Browsing-Modi können Installation, Cache und IndexedDB einschränken.

## Datenschutz

Panorama Viewer ist local-first:

- Das ausgewählte Bild wird mit einer lokalen Object URL gelesen.
- Die Dekodierung, Skalierung und WebGL-Textur bleiben im Browser.
- Es gibt keinen Analytics-Code, keinen Upload und keinen automatischen Server-Speicher.
- Beim Bildwechsel werden die alte Object URL, die Browser-Referenz und die GPU-Textur freigegeben.
- Beim Android-Share-Target wird die Datei kurzzeitig lokal in IndexedDB übergeben und anschließend entfernt.

## Projektstruktur

```text
src/
  components/       UI, Picker und Viewer-Steuerung
  gestures/         Pointer-Event-Gesten und Geschwindigkeitsmessung
  rendering/        WebGL-Panorama- und Blur-Hintergrund
  pwa/              IndexedDB-Brücke für Android Share Target
  utils/            Bilddekodierung, Erkennung und Speicherfreigabe
public/
  icons/            veröffentlichungsfertige PNG-PWA-Icons
  manifest.webmanifest
  sw.js
```

## Lizenz

Dieses Projekt steht unter der [MIT-Lizenz](./LICENSE).
