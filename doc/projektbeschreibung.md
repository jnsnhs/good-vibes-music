## Projekttitel

Arbeitstitel dieses Projekts lautet *Good Vibes Music* ([Repository](https://github.com/jnsnhs/good-vibes-music)). 


## Ausgangssituation

Der Konsum digitaler Musik hat sich in den letzten 15 Jahren immer mehr in Richtung Streaming entwickelt. Verbreitete Anwendungen wie  Spotify oder Apple Music zielen primär darauf ab, Musik als Dienstleistung im Abo zu verkaufen.

Zwar können diese Produkte durchaus dazu genutzt werden, um auch lokale Musikdateien abzuspielen, doch sind sie für diesen use case nicht optimiert: Der Streaming-Service – das eigentliche Kernprodukt – ist omnipräsent, auch wenn er nicht genutzt wird. Er drängt sich stets als Bloatware auf und schmälert die Usability. 

Die Suche nach geeigneten Alternativen zum Abspielen einer lokalen Musiksammlung ist nicht einfach, denn der Fokus auf Streaming hat den lokalen Desktop-Audioplayer zu einer Nischen-Anwendung werden lassen.


## Zielsetzung

Basierend auf dem beschriebenen Ist-Zustand hat dieses Projekt die Entwicklung einer Musik-Library für lokale Dateien zum Ziel. Grob orientiert an iTunes 12 (erschienen 2014) liegt der Fokus auf einer visuell ansprechenden und vielseitigen Darstellung einer großen Anzahl lokaler Musikdateien. Diese Vielseitigkeit, mit der auch umfangreiche Sammlungen strukturiert präsentiert werden können, soll jedoch nicht durch ein Übermaß an Verwaltungsfunktionen und Einstellungsmöglichkeiten herbeigeführt werden. Ziel ist die Entwicklung einer schnörkellosen, plattformunabhängigen Anwendung.


## Geplanter Funktionsumfang

### Must Have

###### Noch umzusetzen

1. Zuverlässige und erwartungsgemäße Steuerung der grundlegenden Audio-Wiedergabe (Play/Pause, Skipping, Lautstärke).

2. Nachvollziehbares Zustandekommen der Wiedergabereihenfolge ("Play Next") unter Berücksichtigung verschiedener Filter und Sortierreihenfolgen. 

3. Zuverlässige und sichere Möglichkeit, Metadaten (ID3-Tags) der importierten Audio-Dateien zu editieren. Auch Sonderfälle wie geschützte Dateien müssen berücksichtigt werden.


###### Bereits umgesetzt

4. Import von Musikdateien der Formate `mp3` und `m4a` sowie deren zentraler Metadaten in eine Datenbank.

5. Umgang mit fehlenden, weil nach dem Import modifizierten oder gelöschten Dateien.

6. Möglichkeit zur Entfernung importierter Dateien aus der Datenbank.

7. Darstellung der Datenbank in zwei Varianten: (1) Ansicht aller vorhandenen Songs als Tabelle und (2) Ansicht der vorhandenen Alben als Raster aus Alben-Covern.

8. Filterfunktion, mit der innerhalb der beiden Darstellungsmöglichkeiten die Datenbank gezielt nach Metadaten gefiltert werden kann.


### Should Have

1. Nutzerfreundliche und polierte GUI, deren Akzent-Farbe sich vom Nutzer auswählen lässt.

2. Audio-Normalization (Ausgleich von Lautstärkeunterschieden zwischen Songs, insbesondere zwischen verschiedenen Alben)

3. Auslagerung der Cover-Artworks in Dateien, um Skalierbarkeit der Datenbank zu gewährleisten. (Derzeit wird Cover Art für jeden Song als blob in der Datenbank gespeichert und anschließend base64-codiert in den Arbeitsspeicher geladen).

4. Wartbarer und sauberer Quelltext, der mindestens im Python-Backend objektorientiert ist.


### Could Have

1. Farbliche Hinterlegung der Track-Listen in der Albendarstellung, orientiert an der Farbpalette der jeweilgen Cover Art.

2. Anbindung einer freien API zum automatischen Einlesen von Genre-Bezeichnugen.

3. Unterstützung weiterer Dateiformate wie `ogg` oder `flac`.

4.  Weitere Möglichkeiten zur Darstellung der Datenbank neben den bereits bestehenden Varianten "Songs" und "Albums".


## Technologien

Umgesetzt wird das Projekt mit einer Kombination aus Python, SQLite und Standard-Webtechnologien.

Welche Technologien werden eingesetzt?

- Python: Im Kern wird die Anwendung von Python gesteuert. Python greift auf die lokal gespeicherten Musikdateien zu, liest deren Metadaten aus und hält den Kontakt zur SQLite-Datenbank, in der die Pfade der Dateien zusammnen mit den Metadaten gespeichert werden. Zugleich ermöglicht Python über das externe Package `pywebview` die Umsetzung einer modernen Oberfläche.

- SQLite: Als schlanke und lokale Datenbank-Lösung mit perfekter Anbindung an Python ist SQLite für diese rein lokal betriebene Andwendung ideal geeignet.

- HTML, CSS, JavaScript: Um eine moderne, plattformunabhängige Oberfläche zu realisieren, eigent sich ein auf Web-Technologien basiertes Frontend hervorragend. HTML und CSS werden nicht nur den visuellen Ansprüche einer Music-Library gerecht, auch wird die Audiowiederhabe vollständig mit HTML5 umgesetzt. Die Nutzerinteraktion und die Kommunikation mit dem Backend hingegen werde mit JavaScirpt realisiert.

*Ganz bewusst wurden die ersten Schritte dieses Projektes im Pair Programming zusammen mit Google Gemini (Pro, Extended Thinking) umgesetzt, um auch diese Spielart der Softwareentwicklung einmal zu üben und sich damit vertraut zu machen. Nachdem der Quelltext inzwischen eine Größe angenommen hat, die vom LLM selbst als "too large for the best results" bezeichnet wird, und die exakte Spezifikation der vom LLM umzusetzenden Anforderungen erheblichen Aufwand mit sich bringt, wird der weitere Projektverlauf im manuellen Betrieb fortgesetzt.*

## Abgrenzung

Bewusst verzichtet werden soll (zunächst) auf die Umsetzung folgender Funktionen:

### Won't Have

- Möglichkeit zur Erstellung eigener Playlisten: Damit NutzerInnen nicht in einen Verwaltungsmodus verfallen und mehr Zeit mit dem Anlegen der perfekten Playlist als mit dem bewussten Hören von Musik verbringen, wird auf dieses Feature gezielt verzichtet.

- Klassisches Rating-System: Auch auf die Implementierung eines 5-Sterne-Rating-Systems wird von vornherein verzichtet, um NutzerInnen gar nicht erst in Versuchung zu führen, ihre 50.000 Songs alle zeitaufwendig zu bewerten.

- Verwaltung der Dateien durch die Anwendung selbst: NutzerInnen bleiben für die Ordnerstruktur ihrer Musiksammlung selbst verantwortlich. Neue Dateien müssen händisch importiert werden. Um eine bewusste Designentscheidung handelt es sich herbei jeodhc nicht; daher ist nicht auszuschließen, dass eine solche Funktionalität (wie sie auch iTunes stets bereithielt) zu einem späteren Zeitpunkt implementiert wird.


## Zeitplanung

Der Projektzeitraum von 10 Tagen soll vorwiegend zur Umsetzung der Must-Have-Funktionen genutzt weden. Falls einkalkulierte Pufferzeit nicht benötigt wird, werden zusätzlich Should-Have-Funktionen herangezogen:

Tag 1: Ausarbeitung des Projektantrags, Abstimmung und Freigabe des Projekts.

Tag 2: Must-Have-Ziel 1 (Gewährleistung der grundlegenden Audio-Funktionen).

Tag 3-5: Must-Have-Ziel 2 (Sicherstellung einer nachvollziehbaren und reproduzierbaren Wiedergabereihenfolge, die nicht unerwartet durch aktive Filter oder Änderung der Sortierung gestört wird).

Tag 6-7: Must-Have-Ziel 3 (zuverlässige Möglichkeit zum Editieren von Metadaten inklusive Exception Handling)

Tag 8 u. 9: Ausarbeitung einer Dokumentation, alternativ einer Präsentation.

Tag 10: Projektabschluss entweder mit Abgabe der Dokumentation oder Vorstellung der Präsentation.
