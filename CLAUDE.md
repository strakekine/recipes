# recipes

**Recipes** — Familien-Rezept-App von Laurent (Luxemburg): Rezepte aus PDF, Screenshot, Foto oder Reel
(Bildschirmaufnahme mit Ton) per KI in ein Standardrezept verwandeln, Personen umrechnen, Einkaufsliste nach Bring!.
Umgezogen am 08.11.2026 aus `strakekine/panini-wm-2026` (dort nur noch ein Verweis), vom Nutzer gewählt: eigenes Repo,
Adresse **https://strakekine.github.io/recipes/** (GitHub Pages aus `main`, Wurzel).

Dateien: `index.html` (die App, Einzeldatei, kein Build), `worker.js` (Cloudflare Worker `recipes`, vom Nutzer
von Hand bei Cloudflare eingefügt — **nach jeder Änderung an `worker.js` sagen: „Worker neu einfügen nötig“**),
`test/` (drei Tests, siehe unten).

**Umgang mit dem Nutzer:** Deutsch, Du-Form, keine Fachsprache ohne Erklärung, Vorschläge mit Begründung, Widerspruch
erwünscht. Änderungen gehen nach Absprache direkt auf `main` (Pages baut von dort), Pull Requests sind ihm zu umständlich.
**Fassung:** `FASSUNG` in `index.html` (unten in der App) bei jeder Änderung hochzählen; am iPhone läuft nach einem Push
oft noch die alte Datei. Die Testseite des Workers hat ihre eigene Fassung.

**iPhone-Regeln** (aus den anderen Apps des Nutzers übernommen, dort am Gerät gelernt): kein `viewport-fit=cover`; ein
fokussiertes Feld nie per `.value` überschreiben und keinen Kasten mit fokussiertem Feld per innerHTML neu bauen (sonst
klappt die Tastatur bei jedem Zeichen zu); Zahlenfelder mit `inputmode`; Home-Icon als PNG (iOS nimmt kein SVG);
Safari und Home-Bildschirm haben getrennte Speicher (Code dort je einmal eingeben).
**App-Symbol** (vom Nutzer gewählt, 08.11.2026): Pop-Art-Pfanne mit Spiegelei auf Giftgrün/Lila mit rotem Play-Knopf;
Vorlage `bilder/icon.svg`, als 180-px-PNG eingebettet. iOS merkt sich das Symbol beim Anlegen — neues Symbol heißt
vom Home-Bildschirm löschen und neu hinzufügen.

## Stand und Regeln
Nutzer: Laurent (Familie). Name vom Nutzer: „Recipes“ (zuerst „Recipies“ geschrieben, auf seinen Wunsch korrigiert).
**Kern, vom Nutzer so festgelegt (08.11.2026):** PDF, Screenshot/Foto oder Reel einsetzen → Standardrezept;
Personenzahl einstellen → Mengen; Einkaufsliste → **Bring!** zum Teilen mit der Familie. Alles andere
(Küchenmodus, Woche, Bewertung, Kurzbefehl in der Teilen-Leiste) erst, wenn er es vermisst.
**Rezepte liegen auf dem Server** (vom Nutzer gewählt: Cloudflare D1), nicht nur im Handy — anders als
Pizza/Brot, weil eine Sammlung der Datenschatz selbst ist. Bewusst nicht: Nährwerte, Vorrat mit Ablaufdatum,
Sprachsteuerung, Video-Download bei Facebook/Instagram (Meta sperrt; das Handy liefert das Video selbst als
Bildschirmaufnahme). Erstes Rezept: ein Facebook-Reel, in dem nur gesprochen wird — darum der Video-Weg.

**KI: Gemini** (eine KI für PDF, Bild, Video mit Ton; Claude-Schnittstelle kann kein Video). Modell über
`MODELL`, Standard `gemini-flash-latest` (Alias, wandert mit). Auftrag `AUFTRAG` + `responseSchema`:
**Mengen nie erfinden** (`menge: null` + `hinweis`), Gesprochenes zählt, US-Maße umrechnen, Gang aus `GAENGE`,
Einheit aus `EINHEITEN`. `saeubern()` prüft jede KI-Antwort und jedes gespeicherte Rezept.
**Ablauf:** Je Datei holt der Browser beim Worker nur eine Upload-Adresse (`POST /api/datei-start`, Gemini
Files API resumable; die Adresse trägt eine Sitzungsnummer, nicht den Schlüssel) und lädt **selbst direkt zu
Google** hoch (Google erlaubt CORS, am 08.11. per Preflight geprüft; bis 1 GB). Anlass: **Fehler 524** beim
ersten echten Reel (Cloudflare bricht nach 100 s ohne Antwort ab). Rückfall bis 95 MB: durch den Worker
(`POST /api/datei`, `FixedLengthStream`). Dann `POST /api/rezept`; solange Gemini ein Video verarbeitet →
**202**, der Browser fragt alle 3 s neu. Die KI-Antwort selbst geht **als Strom** zurück: sofort Kopfzeilen,
alle 10 s ein Leerzeichen, am Ende das JSON (`{rezept}` oder `{fehler}`, dann mit Status 200) — sonst 524 bei
langer KI-Zeit. Erstes Byte sofort, dann alle 5 s; `no-transform`. **Protokoll** (`notiere`, Tabelle `protokoll`,
14 Tage, `GET /api/protokoll`, aufklappbar unten auf der Testseite): „KI gestartet“, „✓/✗ nach n s“, „Antwort ging
nicht mehr raus“ — Anlass: am 08.11. kam beim echten Reel „Antwort nicht lesbar (200)“, Ursache noch unbekannt; die
Seite zeigt seitdem Pfad, Länge und die ersten 150 Zeichen der Antwort. **Befund aus dem Protokoll (08.11., 50-MB-Reel):**
Schlüssel und Direkt-Upload gehen; Gemini antwortete einmal 503 „high demand“, einmal **524 nach 125 s** (Cloudflare kappt
Abrufe, die 100 s nichts liefern; das Modell dachte so lange). Seit Fassung e: `streamGenerateContent?alt=sse` mit
`thinkingConfig.includeThoughts` (Denk-Teile halten die Leitung aktiv, gezählt wird nur Text ohne `thought`),
`mediaResolution: MEDIA_RESOLUTION_LOW` (Rezept steckt im Ton und in Einblendungen) und bei 429/5xx/524 ein zweiter
Versuch mit `gemini-flash-lite-latest` (`ERSATZ_MODELL`, „↻“ im Protokoll). **Fassung e (Denk-Teile mitstreamen) scheiterte am
08.11.:** nach ~2 min „Load failed“ am Handy (25 Leerzeichen angekommen), im Protokoll nur „KI gestartet“, kein Ende — der
Worker wurde mit abgebrochen. Seit Fassung f: **Denken aus** (`thinkingBudget: 0`; lehnt ein Modell das mit 400 ab, derselbe
Versuch ohne Einstellung, „↻“), `includeThoughts` raus, Protokoll nennt Modell und „erste Antwort nach n s“. **Befund danach (Protokoll 08.11.):** der Lauf
von Fassung e kam doch noch an — flash-latest 524, dann `gemini-flash-lite-latest` in ~14 s, „Schnelles Croissant-Mozzarella-
Sandwich, 9 Zutaten“; nur das Handy hatte die Verbindung schon verloren. Fassung f scheiterte mit 400 „invalid argument“ beim
gekürzten Video (.mov = `video/quicktime`, Gemini kennt `video/mov`). Seit **Fassung g**: `geminiMime()` (quicktime → mov,
beim Upload und in `file_data`), **bei Videos das leichte Modell zuerst** (flash-latest als zweiter Versuch), jeder 400 mit
Denk-Einstellung → einmal ohne, und **Abholen nach Abriss**: Die Seite schickt eine `auftrag`-id mit, der Worker legt das
Ergebnis einen Tag in `ergebnisse` ab, `GET /api/ergebnis/<id>` (202 = noch nicht da). Reißt die Verbindung ab, fragt die Seite
dort alle 5 s nach (bis 6 min). Browser-Test mit gekappter Verbindung nach 2 s: Rezept kommt an. YouTube-Links im Text gehen als Video an
Gemini. Höchstens 30 Importe je Tag (`importe`). Zugang nur mit `x-code` = Secret `FAMILIEN_CODE`; CORS nur
für `https://strakekine.github.io`.
**Bring!:** `POST /api/bring` legt die Liste 24 h als öffentliche Seite `/bring/<id>` mit schema.org/Recipe ab
und gibt den Deeplink `api.getbring.com/rest/bringrecipes/deeplink?url=…&source=web` zurück (Bring!s Import
für Rezeptseiten, Doku von 2020/2022). **Noch nie echt ausprobiert** — Bring! ist in der Claude-Umgebung
gesperrt; erster Test vom iPhone über die Testseite. Klappt es nicht: Erinnerungen per Kurzbefehl.
**Testseite:** `GET /` des Workers (Code, Datei/Text → Rezept, Personen ±, Speichern, Bring!) — bleibt als Notzugang.
**App `index.html`** (08.11.2026, seit dem Umzug Fassung „08.11.2026 b“; `FASSUNG` bei jeder Änderung hochzählen), Einzeldatei auf
GitHub Pages, spricht `WORKER` (`recipes.rjtp6r9s9h.workers.dev`) mit `x-code` an (CORS nur für strakekine.github.io —
darum lädt der Browser-Test die Seite unter dieser Adresse). Zwei Reiter **Rezepte** (Liste mit Suche über Titel und
Zutaten, „+ Rezept“ = Datei/Text → KI → **Vorschau im Bearbeiten-Formular, erst dann speichern**, „Von Hand eintippen“)
und **Einkauf**. Rezept-Ansicht: Personen ±, Zutaten (ohne Menge gelb mit „?“), Schritte, Notiz, „▶ Original ansehen“,
„🛒 Auf die Einkaufsliste“, „Direkt in Bring!“, Bearbeiten, Löschen. **Bearbeiten als Text**: eine Zutat je Zeile
(`zeileLesen`: „200 g Mehl“, „2–3 Zehen Knoblauch“, „1 1/2 EL Öl“, „½ TL“, „Salz (nach Gefühl)“), eine Zeile mit Doppelpunkt am Ende ohne Menge = Gruppe („Für die Sauce:“; vom Nutzer gefragt, „## Name“ war zu technisch und wird weiter verstanden);
der Gang bleibt von der KI, neue Zutaten rät `gangRaten`. Mengen: `mengeText` (Personen-Faktor, Prise/Msp skalieren
nicht, ab 100 g/ml auf 5er, ab 1000 → kg/l, Stückiges auf ½). **Einkaufsliste nur im Handy** (`recipes_einkauf`;
geteilt wird über Bring!): `einkaufDazu` zählt gleiche Zutat + Einheitenfamilie (g/kg, ml/l) zusammen, ohne Menge →
„(+ etwas)“, merkt die Rezepte, nach Gängen sortiert; „Hab ich immer da“ (`recipes_vorrat`, Standard Salz, Pfeffer, Öl,
Olivenöl, Wasser, Zucker; ganze Wörter, „Öl“ trifft nicht „Olivenöl“) bleibt weg. Rezepte liegen auf dem Server, Kopie
für offline in `recipes_rezepte`; Code in `recipes_code`. iPhone-Regeln der Pizza-App; Suche liegt außerhalb der neu
gebauten Liste.
**Einrichtung (Nutzer):** Worker bei Cloudflare, Secrets `GEMINI_KEY` (aistudio.google.com) und
`FAMILIEN_CODE`, D1-Binding `DB` (Tabellen legt der Worker an). Stand 08.11.2026: **vom Nutzer eingerichtet**
(`recipes.rjtp6r9s9h.workers.dev`), Gemini-Schlüssel beginnt mit `AQ.` (neues Format, funktioniert mit
`x-goog-api-key`), Direkt-Upload eines 50-MB-Reels geklappt. **Erstes echtes Rezept am 08.11. um 21:50 mit Fassung g angekommen**
(gekürzte .mov-Aufnahme des Facebook-Reels): „Croissant Mozzarella-Sandwich“, 9 Zutaten, 5 Schritte, nur das Croissant mit
Menge — der Koch nennt keine Mengen, also alles gelb statt erfunden, wie gewollt. Bring!-Test steht noch aus.
**Testen** (jeder mit eigenem Rückgabewert): `node test/worker.mjs` (Gemini nachgebaut, D1 über `node:sqlite`:
Zugang, Upload, 202, Säubern, Tagesgrenze, Speichern, Bring!-Seite, Modellwahl, Abholen), `node test/logik.mjs` (Logik
der App, schneidet `Logik`…`Oberfläche` aus) und `node --no-warnings test/oberflaeche.mjs` (Browser, 390 px, gegen
den echten Worker-Code: Code, KI → Vorschau → Speichern, Korrektur, Personen, Einkauf, Bring!, Neuladen, Suche,
Löschen; `BILDER=<ordner>` speichert Bildschirmfotos). Gegenproben gemacht.

## Zutaten-Editor und Farben (08.11.2026, Fassung e, vom Nutzer gewünscht)

**Editor:** Beim Bearbeiten (und in der Vorschau nach dem KI-Import) je Zutat eine Zeile: **Menge** (Textfeld mit
`inputmode="decimal"`, versteht „2“, „0,5“, „2–3“, „½“, „1 1/2“ — `mengeLesen`/`mengeEingabe`), **Einheit als Klappmenü**
(`EINHEIT_MENU`: –, alle `EINHEITEN`, „nach Geschmack“), **Zutat**, ✕. Dazu „+ Zutat“, „+ Überschrift“ (pinke Zeile =
Gruppe) und „Als Text bearbeiten“ (Textfeld wie vorher, hin und zurück). Anlass: die Schreibregeln des Textfelds
(Zahl vorne, Einheitenliste) „kann ich nicht alles behalten“. **Zeilen werden einzeln angelegt/entfernt, nie alle neu
gebaut** (iPhone-Regel); jede Zeile trägt ihre Ausgangszutat (`_alt`), `zutatAusFeldern` übernimmt daraus Gang (solange
der Name gleich bleibt, sonst `gangRaten`) und Hinweis („Menge nicht genannt“ fällt weg, sobald eine Menge da ist).
Unverständliche Menge → Hinweis, kein Speichern. Einheit ohne Menge wird nicht gespeichert.
**„nach Geschmack“ = grau statt gelb** (`istNachGeschmack`: keine Menge und Hinweis enthält Geschmack/Belieben/Gefühl/
Gusto, auch von der KI). Im Editor blendet die Wahl das Mengenfeld aus. Gelb mit „?“ heißt nur noch: Menge fehlt.
**Farben wie das App-Symbol** (Pop-Art): Grund Dunkellila `#170a2e`, Karten `#25124a` mit harter schwarzer Kante und
Versatzschatten, Knöpfe Giftgrün `#c6ff3d` mit schwarzer Schrift/Kante, Akzente Pink `#ff4f6d` (Gruppen, Zähler),
Gelb `#ffd23f` = Menge fehlt, Grau `#9d8cc4` = nach Geschmack. Symbol klein im Kopf neben „Recipes“.

## Einheiten und Fotos (08.11.2026, App Fassung f, Worker Fassung h — **Worker neu einfügen nötig**)

Befund vom Nutzer: eingescanntes ZDF-Rezept (Foto, mit Handnotiz) — alles erkannt, auch die Handschrift, aber **alle
Einheiten leer** („60 Parmesan“) und fast **120 s**. Ursache Einheiten: `saeubern` ließ nur exakte Kürzel durch, Gemini
schrieb aus. Jetzt `einheitAus()`/`EINHEIT_ALIAS` (Gramm, gr., Esslöffel, Teelöffel, Prisen, Zehen, Scheiben, Packung,
tbsp/tsp …; cl → ml ×10), Einheit am Namensanfang wird herausgelöst („g geriebener Comté“), Auftrag und Schema
(`description`) verlangen die Kürzel. `mediaResolution: LOW` nur noch bei Videos — bei Fotos/PDF würde das Text schlechter
lesbar machen. Gegen die Dauer: die App verkleinert Fotos vor dem Hochladen auf höchstens 2000 px (`verkleinern`, JPEG
0,85; PDF/Video unverändert). Ob das die 120 s wirklich drückt, ist am echten Gemini noch nicht gemessen — das Protokoll
auf der Worker-Testseite zeigt Modell und Zeiten.

## Wofür die Menge steht (08.11.2026, App Fassung g, Worker Fassung i — **Worker neu einfügen nötig**)

Befund vom Nutzer: Croustillants „für 24 bis 28 Kräcker“ kamen als „26 Personen“ an. Jetzt hat jedes Rezept
`portion_einheit` (Standard „Personen“; sonst „Kräcker“, „Stück“, „Kuchen“ …): Auftrag und Schema fragen danach
(„nie Personen erfinden, wo das Rezept Stück nennt“; Spanne → Mitte), `saeubern` behält es, `portionen` bis 500.
App: `portionWort(r)` statt fest „Personen“ über den −/+-Knöpfen, in der Liste („für 26 Kräcker“), im Editor
„Rezept ergibt [Zahl] [Einheit]“ mit Vorschlägen als Knöpfen darunter (`#eChips`, Fassung h — die erste Fassung hatte eine `datalist`, die Safari nur versteckt über der Tastatur zeigt; vom Nutzer: „alleine hätte ich das nie gefunden“). Alte Rezepte ohne Feld zeigen „Personen“ — beim Bearbeiten
nachtragen. Kleinkram dabei: kein „·“ mehr hinter der Zeit, wenn es keinen Original-Link gibt.

## Originale zum Rezept (08.11.2026, App Fassung i, Worker Fassung j — **Worker neu einfügen nötig**)

Vom Nutzer: „schade, dass er bei JPEG oder PDF kein Original dazu speichert“. Jetzt: Fotos und PDFs aus einem KI-Import
(höchstens 5, die App verkleinert Fotos vorher, `NEU_ORIG`) werden **beim ersten Speichern** nachgeschickt
(`PUT /api/original/<rezept>?typ=&name=`, Körper = Datei). Der Worker legt sie in D1 ab (Tabelle `originale`, BLOB in
Stücken zu 400 KB wegen der 2-MB-Grenze je Zeile; je Datei höchstens 2 MB, sonst 413 und Hinweis in der App; nur
JPEG/PNG/WebP/HEIC/PDF, **Videos nie** — dort bleibt der Reel-Link das Original) und hängt `{id, typ, name, groesse}` an
`rezept.originale` (`saeubern` lässt nur 24-stellige ids und diese Typen durch, Bearbeiten behält sie). Abruf
`GET /bild/<id>` **ohne Code** (damit `<img>` und Links gehen; id zufällig, 24 Zeichen aus a–z0–9). Rezept löschen löscht
die Originale. App: „📄 Original ansehen“ (bei mehreren nummeriert) neben „▶ Original ansehen“, erstes Foto als
Vorschaubild in der Liste. R2 bewusst nicht: bräuchte eine Kreditkarte bei Cloudflare. Ob D1 BLOBs als ArrayBuffer oder
Zahlenliste zurückgibt, fängt `alsBytes` ab — am echten D1 noch nicht gesehen. Alte Rezepte haben kein Original
(nachträglich hinzufügen gibt es noch nicht).

## Standbild aus dem Video (08.11.2026, App Fassung j, Worker Fassung k — **Worker neu einfügen nötig**)

Vom Nutzer: bei Videos ein Standbild als Vorschaubild, Gemini soll aussuchen. Auftrag/Schema fragen `bild_sekunde`
(Sekunde mit dem fertigen Gericht, möglichst ohne eingeblendeten Text; sonst null), `saeubern` behält sie. Die App
(`standbild`) nimmt die noch geladene Videodatei, springt mit einem unsichtbaren `<video>` (stumm, `playsinline`, kurz
angespielt — iOS liefert sonst schwarze Bilder) an diese Sekunde, sonst 80 % bzw. 50 % der Länge, verwirft schwarze Bilder
(`istSchwarz`), macht ein JPEG (höchstens 1280 px) namens `standbild.jpg` und legt es vorne in `NEU_ORIG` — es wird wie
ein Foto-Original gespeichert. Rezept-Ansicht: „🖼️ Bild aus dem Video“, Liste: Vorschaubild. Grenzen: bei
Bildschirmaufnahmen ist die Oberfläche von Instagram/Facebook mit drauf; ob iOS das Standbild ohne Abspielen herausgibt,
ist **am iPhone noch nicht geprüft** (Chromium: geprüft mit selbst aufgenommenem Testvideo, schwarz → orange, Gegenprobe
ohne Schwarz-Erkennung schlägt an). Klappt es nicht, gibt es eben kein Bild.
**Nachtrag Fassung k (App):** Am iPhone kam mit Fassung j **kein** Standbild (vom Nutzer gemeldet, Grund unbekannt). Vermutung:
Safari lädt/spielt das Video nicht, weil es erst 20–40 s nach dem Tippen angelegt wurde. Jetzt `videoVorbereiten()` sofort im
Klick auf „Rezept machen“ (vor dem ersten `await`): `<video>` stumm, `playsinline`, unsichtbar in der Seite, `load()` +
`play()`; `standbild(vor, sekunde)` springt später nur hin und räumt das Element weg. Die Vorschau sagt jetzt, ob das Bild
mitgespeichert wird oder **warum nicht** („Video lädt nicht“, „Springen klappt nicht“, „nur schwarze Bilder, Anspielen
gesperrt“ …) — beim nächsten Fehlschlag am iPhone diesen Text erfragen.

## Memo vom Nutzer, für später (08.11.2026)

1. **Rezeptkategorien** (z. B. Vorspeise, Hauptgericht, Dessert, Backen; Filter in der Liste). Die KI könnte beim Import
   eine vorschlagen. **Vom Nutzer (09.11.): die Kategorien selbst sollen editierbar sein** (eigene anlegen, umbenennen,
   löschen) — also eine gemeinsame Kategorienliste auf dem Server, nicht fest im Code; beim Löschen einer Kategorie
   fragen, was mit ihren Rezepten passiert.
   **Gestaltung (vom Nutzer, 09.11.):** Startseite = **Kacheln je Kategorie** (Name + kleines Bild), Tippen öffnet die
   Rezeptliste dieser Kategorie. Vorschlag dazu (dem Nutzer so gesagt): Bild der Kachel automatisch = Vorschaubild des
   neuesten Rezepts der Kategorie, beim Bearbeiten der Kategorie durch ein eigenes Bild aus der Mediathek ersetzbar
   (gleicher Weg wie Punkt 6); ohne Bild ein Pop-Art-Symbol/Emoji. Dazu eine Kachel „Alle Rezepte“ und die Suche oben
   über allen Kacheln.
2. **Suche** — gibt es schon (Titel und Zutaten, Wörter mit Leerzeichen = alle müssen passen); was dem Nutzer fehlt,
   vor dem Bauen erfragen (Kategorien? Filter wie „schnell“, „vegetarisch“? Suche in Schritten/Notiz?).
3. **Rezept von Hand eingeben** — „+ Rezept → Von Hand eintippen“ gibt es schon (gleicher Editor wie die KI-Vorschau);
   vor dem Bauen erfragen, was fehlt oder unklar ist (vielleicht: Knopf ist zu versteckt).
4. **Rezept-/Küchenmodus** — großes Schritt-für-Schritt-Bild beim Kochen, Bildschirm bleibt an (Wake Lock), Timer aus
   dem Text („10 Minuten“), Zutaten zum Abhaken; Vorbild: Küchenmodus der Pizza- und Brot-App.
5. **Nur einen Link einsetzen, Gemini macht das Rezept daraus.** Stand und Einschätzung (dem Nutzer so gesagt):
   **YouTube-Links gehen schon** (der Worker gibt sie Gemini als Video, `YOUTUBE`). **Rezept-Webseiten** (Chefkoch,
   ZDF, Blogs) sind gut machbar: der Worker holt die Seite und liest zuerst das eingebettete schema.org/Recipe-JSON
   (fast alle Rezeptseiten haben es, genau, ohne KI-Raterei), sonst gibt er den Seitentext an Gemini; das Original wäre
   dann der Link. **Instagram/Facebook/TikTok-Links gehen nicht** — die Plattformen sperren Server ohne Anmeldung
   (am 08.11. geprüft: Facebook 403), dort bleiben Bildschirmaufnahme oder Beschreibungstext.
   **Befund vom Nutzer (08.11., spät):** Link https://yummix.fr/gateau-royal-thermomix/ ins Textfeld → „Rezept“ kam,
   aber **ohne Mengen, obwohl sie auf der Seite stehen**. Erklärung: Der Worker ruft Webseiten **gar nicht ab**, Gemini
   bekommt nur den Link als Text und hat das Rezept aus dem Namen/eigenem Wissen nachgebaut; die Mengen ließ es weg, weil
   der Auftrag Erfinden verbietet. Gefährlich, weil es wie gelesen aussieht. Beim Bauen von Punkt 5: Seite im Worker holen
   (schema.org/Recipe zuerst, sonst Seitentext an Gemini) oder Geminis `url_context`-Werkzeug; bis dahin sollte ein
   reiner Webseiten-Link ohne Inhalt in der Vorschau einen Warnhinweis bekommen. Mit diesem Link testen.
6. **Vorschaubild ändern** (vom Nutzer, 09.11.): beim Bearbeiten das Vorschaubild austauschen oder entfernen und ein Bild
   aus der Mediathek wählen (`<input type="file" accept="image/*">`, App verkleinert, als Original mit Merkmal „Vorschau“
   speichern). Dafür braucht der Worker: Original löschen (`DELETE /api/original/<rezept>/<id>`) und festlegen, welches
   Bild die Vorschau ist (z. B. `rezept.vorschau = <id>`; ohne Angabe wie heute das erste Foto). Geht damit auch für
   alte Rezepte ohne Original und als Ersatz, falls das Standbild aus dem Video am iPhone nicht klappt.
