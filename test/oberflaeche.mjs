// Browser-Test für index.html gegen den echten Worker-Code (worker.js),
// Gemini nachgebaut, D1 über node:sqlite. Aufruf: node test/oberflaeche.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const tmp = join(mkdtempSync(join(tmpdir(), "ro-")), "w.mjs");
writeFileSync(tmp, readFileSync(new URL("../worker.js", import.meta.url), "utf8"));
const W = (await import(tmp)).default;

const db = new DatabaseSync(":memory:");
const stmt = (sql, a = []) => ({ bind: (...x) => stmt(sql, x), run: async () => { db.prepare(sql).run(...a); },
  first: async () => db.prepare(sql).get(...a) ?? null, all: async () => ({ results: db.prepare(sql).all(...a) }) });
const env = { GEMINI_KEY: "K", FAMILIEN_CODE: "familie", DB: { prepare: s => stmt(s) } };

const KI = { titel: "Cremige Gnocchi", portionen: 2, zeit_min: 20, bild_sekunde: 1.6, zutaten: [
  { name: "Gnocchi", menge: 500, einheit: "g", gang: "Kühlregal" },
  { name: "Sahne", menge: 200, einheit: "ml", gang: "Kühlregal", gruppe: "Sauce" },
  { name: "Salz", menge: 1, einheit: "Prise", gang: "Gewürze, Öl & Saucen", gruppe: "Sauce" },
  { name: "Basilikum", menge: null, einheit: "", gang: "Obst & Gemüse", hinweis: "Menge nicht genannt" }],
  schritte: ["Gnocchi braten.", "Sahne dazu, 5 Minuten köcheln."], notiz: "" };
const echt = globalThis.fetch;
globalThis.fetch = async (u, o) => {
  u = String(u);
  if(u.includes(":streamGenerateContent")) return new Response("data: " + JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(KI) }] } }] }) + "\n\n");
  if(u.endsWith("/upload/v1beta/files")) return new Response("{}", { headers: { "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/sitzung" } });
  if(u.includes("/v1beta/files/")) return Response.json({ state: "ACTIVE" });
  if(u.includes("googleapis")) return Response.json({ name: "m" });
  return echt(u, o);
};

let fehler = 0;
const zuAllen = async () => { await p.waitForSelector(".kachel.alle"); await p.click(".kachel.alle"); await p.waitForSelector("#liste .li"); };
const ok = (x, t) => { console.log((x ? "✓ " : "✗ ") + t); if(!x) fehler++; };

const br = await chromium.launch();
const p = await br.newPage({ viewport: { width: 390, height: 800 } });
const fehlerSeite = []; p.on("pageerror", e => fehlerSeite.push(e.message)); p.on("dialog", d => d.accept());
let bringLink = "";
await p.route("https://recipes.rjtp6r9s9h.workers.dev/**", async route => {
  const q = route.request();
  const r = await W.fetch(new Request(q.url(), { method: q.method(), headers: q.headers(), body: q.postDataBuffer() || undefined }), env);
  route.fulfill({ status: r.status, headers: Object.fromEntries(r.headers), body: Buffer.from(await r.arrayBuffer()) });
});
// Unter der echten Adresse ausliefern: der Worker gibt CORS nur für strakekine.github.io frei.
const APP = "https://strakekine.github.io/recipes/";
await p.route(APP, route => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: readFileSync(new URL("../index.html", import.meta.url)) }));
await p.route("https://api.getbring.com/**", route => { bringLink = route.request().url(); route.fulfill({ status: 200, body: "Bring!" }); });
await p.goto(APP);

// Code
ok(await p.isVisible("#codeK"), "ohne Code: Code-Feld sichtbar");
await p.fill("#code", "falsch"); await p.click("#codeOk");
await p.waitForSelector("#codeS .f"); ok((await p.textContent("#codeS")).includes("Falscher"), "falscher Code wird abgelehnt");
await p.fill("#code", "familie"); await p.click("#codeOk");
await p.waitForSelector("#codeK", { state: "hidden" }); ok(true, "richtiger Code: Feld verschwindet");
ok((await p.textContent("#liste")).includes("Noch keine Rezepte"), "leere Liste mit Hinweis");

// Neu per KI → Vorschau → Speichern
await p.click("#neuBtn"); await p.fill("#text", "https://www.facebook.com/share/r/abc");
await p.click("#los"); await p.waitForSelector("#stand .f");
ok((await p.textContent("#stand")).includes("Bildschirmaufnahme"), "nur Facebook-Link: Hinweis auf Bildschirmaufnahme statt erfundenem Rezept");
await p.fill("#text", "Gnocchi in der Pfanne braten, dann Sahne dazu und kurz köcheln. https://www.facebook.com/share/r/abc");
await p.click("#los"); await p.waitForSelector("#vEdit:not([hidden])");
ok(await p.inputValue("#eTitel") === "Cremige Gnocchi", "KI-Ergebnis landet in der Vorschau");
const zeilen = await p.$$eval("#zutEd .zr", ds => ds.map(d => d.classList.contains("gr") ? "## " + d.querySelector(".zn").value : [d.querySelector(".zm").value, d.querySelector("select").value, d.querySelector(".zn").value].join("|")));
ok(JSON.stringify(zeilen) === JSON.stringify(["500|g|Gnocchi", "## Sauce", "200|ml|Sahne", "1|Prise|Salz", "||Basilikum"]) && (await p.inputValue("#eQuelle")).includes("facebook"), "Editor: Menge, Einheit, Name je Zeile, Überschrift, Link übernommen");
// Korrektur mit Feldern: Basilikum bekommt 1 Bund, tippen Zeichen für Zeichen ohne Fokusverlust
const bas = p.locator("#zutEd .zr").nth(4);
await bas.locator(".zm").click(); await bas.locator(".zm").type("1", { delay: 30 });
await bas.locator("select").selectOption("Bund");
// neue Zutat „Pfeffer, nach Geschmack“
await p.click("#zPlus"); const neu = p.locator("#zutEd .zr").last();
await neu.locator(".zn").type("Pfeffer", { delay: 20 });
ok(await p.evaluate(() => document.activeElement.classList.contains("zn")), "Tippen in neuer Zeile: Fokus bleibt");
await neu.locator("select").selectOption("ng");
ok(await neu.locator(".zm").isDisabled() && !(await neu.locator(".zm").isVisible()), "„nach Geschmack“ sperrt und versteckt das Mengenfeld");
// hin und zurück über „Als Text“
await p.click("#zText"); ok((await p.inputValue("#eZut")).includes("1 Bund Basilikum\nPfeffer (nach Geschmack)"), "Als Text: Änderungen drin");
await p.click("#zText"); ok(await p.locator("#zutEd .zr").count() === 6, "zurück zu den Feldern");
// falsche Menge wird gemeldet, nicht gespeichert
await p.locator("#zutEd .zr").nth(0).locator(".zm").fill("viel");
await p.click("#eSpeichern"); ok((await p.textContent("#eStand")).includes("viel"), "falsche Menge: Hinweis statt Speichern");
await p.locator("#zutEd .zr").nth(0).locator(".zm").fill("500");
ok(await p.locator("#eChips button.on").textContent() === "Personen", "Vorschlag „Personen“ ist markiert");
await p.click("#eChips button:has-text('Kräcker')");
ok(await p.inputValue("#eEinheit") === "Kräcker" && await p.locator("#eChips button.on").textContent() === "Kräcker", "Antippen setzt „Kräcker“ und markiert es");
await p.click("#eSpeichern"); await p.waitForSelector("#vRezept:not([hidden]) h2");
ok((await p.textContent("#pWort")) === "Kräcker", "Rezeptmenge mit eigener Einheit (Kräcker statt Personen)");
ok((await p.textContent("#vRezept h2")) === "Cremige Gnocchi", "gespeichert, Rezept offen");
ok((await p.textContent("#vRezept")).includes("1 Bund"), "Korrektur übernommen");
ok(await p.locator("#vRezept li.ng").count() === 1 && await p.locator("#vRezept li.offen").count() === 0, "Pfeffer grau („nach Geschmack“), nichts mehr gelb");

// Personen
await p.click("#pp"); await p.click("#pp");
const z = (await p.$$eval("#vRezept ul.z", us => us.map(u => u.innerText).join("\n")));
ok(z.includes("1 kg") && z.includes("400 ml") && z.includes("1 Prise") && z.includes("2 Bund"), "4 Personen: 1 kg, 400 ml, Prise bleibt, 2 Bund");

const BILD = process.env.BILDER; // Ordner für Bildschirmfotos (optional)
if(BILD) await p.screenshot({ path: BILD + "/rezept.png", fullPage: true });
// Auf die Einkaufsliste (Salz ist Vorrat)
await p.click("#aufListe");
ok((await p.textContent("#ekZahl")) === "3", "3 Posten auf der Liste (Salz und Pfeffer weggelassen)");
await p.click("#tE");
const ek = await p.innerText("#ekListe");
ok(ek.indexOf("OBST") < ek.indexOf("KÜHLREGAL") && ek.includes("1 kg Gnocchi") && !ek.includes("Salz"), "nach Gängen, mit Mengen, ohne Vorrat");
await p.fill("#ekNeu", "Klopapier"); await p.press("#ekNeu", "Enter");
ok((await p.innerText("#ekListe")).includes("Klopapier"), "eigener Posten");
await p.click("#ekListe input >> nth=0");
ok((await p.textContent("#ekZahl")) === "3", "Abhaken zählt runter");
if(BILD) await p.screenshot({ path: BILD + "/einkauf.png", fullPage: true });
await p.click("#ekBring"); await p.waitForTimeout(500);
ok(bringLink.startsWith("https://api.getbring.com/rest/bringrecipes/deeplink?url="), "Bring!-Knopf öffnet Bring!s Import");
const seite = decodeURIComponent(bringLink.split("url=")[1].split("&")[0]);
const bringHtml = await (await W.fetch(new Request(seite), env)).text();
ok(bringHtml.includes("Klopapier") && bringHtml.includes("1 kg Gnocchi") && !bringHtml.includes("Basilikum"), "an Bring! gehen nur die offenen Posten");

// Neu laden: Liste aus dem Server, Einkauf aus dem Handy
await p.goto(APP);
await p.waitForSelector(".kachel.alle");
ok((await p.textContent(".kachel.alle")).includes("1 Rezept") && await p.locator(".kachel").count() === 11 && (await p.textContent(".kachel.merk")).includes("Möchte ich kochen") && (await p.textContent(".kachel.ohne")).includes("Ohne Kategorie"), "Startseite: Kacheln „Alle Rezepte“, „Möchte ich kochen“, 8 Kategorien, „Ohne Kategorie“");
await zuAllen();
ok((await p.textContent("#liste")).includes("Cremige Gnocchi") && (await p.textContent("#liste")).includes("für 2 Kräcker"), "nach Neuladen: Rezept da, „für 2 Kräcker“");
ok((await p.textContent("#ekZahl")) === "3", "nach Neuladen: Einkaufsliste da");
if(BILD){ await p.click("#liste .li"); await p.click("#bearb"); await p.screenshot({ path: BILD + "/bearbeiten.png", fullPage: true }); await p.click("#vEdit [data-zurueck] >> nth=0"); await p.click("#tR"); }
// Suche tippen ohne Fokusverlust
await p.click("#suche"); await p.type("#suche", "sahne", { delay: 30 });
ok(await p.evaluate(() => document.activeElement.id) === "suche" && (await p.textContent("#liste")).includes("Gnocchi"), "Suche nach Zutat, Fokus bleibt");
await p.fill("#suche", "lachs"); ok((await p.textContent("#liste")).includes("Nichts gefunden"), "Suche ohne Treffer");
await p.fill("#suche", "");




// Überschrift in der Zubereitung
await p.click("#liste .li:has-text('Gnocchi')"); await p.click("#bearb");
await p.fill("#eSchr", "Gnocchi braten.\nSahne dazu, 5 Minuten köcheln.");
await p.evaluate(() => { const t = document.getElementById("eSchr"); t.focus(); t.setSelectionRange(0, 0); t.blur(); });
await p.click("#sPlus"); await p.keyboard.type("Für die Gnocchi");
await p.evaluate(() => { const t = document.getElementById("eSchr"); const i = t.value.indexOf("Sahne"); t.focus(); t.setSelectionRange(i, i); t.blur(); });
await p.click("#sPlus"); await p.keyboard.type("Sauce");
ok(await p.inputValue("#eSchr") === "Für die Gnocchi:\nGnocchi braten.\nSauce:\nSahne dazu, 5 Minuten köcheln.", "Knopf „+ Überschrift“ setzt die Zeile an die Schreibmarke, Wort zum Überschreiben markiert");
await p.click("#eSpeichern"); await p.waitForSelector("#vRezept:not([hidden]) h2");
const zub = await p.evaluate(() => [...document.querySelectorAll("#vRezept .grp, #vRezept ol.st")].map(e => e.matches("ol") ? e.start + ". " + e.innerText : "# " + e.innerText));
ok(JSON.stringify(zub).includes('"# Für die Gnocchi","1. Gnocchi braten.","# Sauce","2. Sahne dazu, 5 Minuten köcheln."'), "Überschriften ohne Nummer, Schritte durchgezählt" + " → " + JSON.stringify(zub));
await p.click("#kochen"); await p.click("#kNach");
ok((await p.textContent("#kSchritt .nr")) === "Sauce · Schritt 2" && (await p.textContent("#kPos")) === "2 / 2", "Küchenmodus: Überschrift als Beschriftung, nicht als eigener Schritt");
await p.click("#kZu"); await p.click("#zur");

// Sterne und Kochliste
await p.click("#liste .li:has-text('Gnocchi')");
ok((await p.textContent("#vRezept .bew")).includes("Noch nie gekocht"), "neues Rezept: noch nie gekocht");
await p.click("#merken"); await p.waitForSelector("#merken.merkt");
await p.click("#zur"); await p.click("#katZur");
ok((await p.textContent(".kachel.merk")).includes("1 Rezept"), "Kachel „Möchte ich kochen“ zählt das Rezept");
await p.click(".kachel.merk");
ok((await p.textContent("#liste")).includes("Cremige Gnocchi") && (await p.textContent("#liste .li")).includes("🔖"), "Kochliste zeigt das Rezept mit 🔖");
await p.click("#liste .li"); await p.click("#sterne button[data-n='3']");
await p.waitForFunction(() => document.querySelectorAll("#sterne button.on").length === 3);
ok(true, "3 Sterne gesetzt");
await p.click("#sterne button[data-n='3']"); await p.waitForFunction(() => document.querySelectorAll("#sterne button.on").length === 0);
ok(true, "derselbe Stern nochmal: Bewertung weg");
// Küchenmodus bis zum Ende → Sterne → gekocht, von der Kochliste genommen
await p.click("#kochen"); await p.click("#kNach"); await p.click("#kNach");
ok((await p.textContent("#kSchritt")).includes("Wie war's"), "nach dem letzten Schritt: Wie war's?");
if(BILD) await p.screenshot({ path: BILD + "/fertig.png" });
await p.click("#kSterne button[data-n='5']"); await p.waitForSelector("#kueche", { state: "hidden" });
const gb = JSON.parse(await p.evaluate(() => JSON.stringify(REZEPTE.find(r => r.titel === "Cremige Gnocchi"))));
ok(gb.sterne === 5 && gb.gekocht.length === 1 && !gb.merken, "Küchenmodus: 5 Sterne, gekocht eingetragen, von der Kochliste");
ok((await p.textContent("#vRezept .bew")).includes("1× gekocht, zuletzt heute") && (await p.textContent("#gekocht")).includes("✔"), "Rezept zeigt „1× gekocht, zuletzt heute“");
await p.click("#gekocht"); await p.waitForFunction(() => document.querySelector("#vRezept .bew").textContent.includes("Noch nie"));
ok(true, "„Heute gekocht“ nochmal: Eintrag zurückgenommen");
if(BILD) await p.screenshot({ path: BILD + "/sterne.png" });
await p.click("#zur");
ok((await p.textContent("#liste")).includes("Die Kochliste ist leer"), "Kochliste danach leer");
await p.click("#katZur"); await p.click(".kachel.alle");

// Kategorie zuweisen → Kachel
await p.click("#liste .li:has-text('Gnocchi')"); await p.click("#bearb");
await p.click("#eKats button:has-text('Hauptgericht')");
ok(await p.locator("#eKats button.on").count() === 1, "Kategorie im Editor angetippt");
// Vorschaubild aus den Fotos
await p.setInputFiles("#eBildDatei", { name: "foto.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64") });
await p.waitForSelector("#eBild .bw.on img");
ok(await p.locator("#eBild .bw").count() === 3, "Bildwahl: neues Foto, „Kein Bild“, „Aus Fotos“");
await p.click("#eSpeichern"); await p.waitForSelector("#vRezept:not([hidden]) .pill");
ok((await p.textContent("#vRezept .pills")).includes("Hauptgericht"), "Rezept zeigt seine Kategorie");
const gn = JSON.parse(await p.evaluate(() => JSON.stringify(REZEPTE.find(r => r.titel === "Cremige Gnocchi"))));
ok(gn.originale.length === 1 && gn.vorschau === gn.originale[0].id && gn.kategorien.join() === "hauptgericht", "Foto aus der Mediathek gespeichert und als Vorschaubild gesetzt");
await p.click("#tR"); await p.click("#tR");
ok(await p.locator(".kachel.ohne").count() === 0 && (await p.textContent(".kachel:has-text('Hauptgericht')")).includes("1 Rezept"), "Kachel zählt das Rezept, „Ohne Kategorie“ verschwindet");
ok(await p.locator(".kachel:has-text('Hauptgericht') img").count() === 1, "Kachel zeigt das Bild des Rezepts");
if(BILD) await p.screenshot({ path: BILD + "/kacheln.png", fullPage: true });
await p.click(".kachel:has-text('Hauptgericht')");
ok((await p.textContent("#liste")).includes("Cremige Gnocchi") && (await p.textContent("#liste h2")).includes("Hauptgericht"), "Kachel öffnet die Rezepte der Kategorie");
await p.click(".kachel >> nth=0").catch(() => {});
await p.click("#katZur"); await p.click(".kachel:has-text('Dessert')");
ok((await p.textContent("#liste")).includes("Noch keine Rezepte in dieser Kategorie"), "leere Kategorie mit Hinweis");
await p.click("#katZur");
// „Kein Bild“ wählen, dann das Foto löschen
await p.click(".kachel.alle"); await p.click("#liste .li:has-text('Gnocchi')"); await p.click("#bearb");
await p.click("#eBild .bw:has-text('Kein')"); await p.click("#eSpeichern"); await p.waitForSelector("#vRezept:not([hidden]) h2");
await p.click("#zur");
ok(await p.locator("#liste .li:has-text('Gnocchi') .icon img").count() === 0, "„Kein Bild“: kein Vorschaubild in der Liste");
await p.click("#liste .li:has-text('Gnocchi')"); await p.click("#bearb");
await p.click("#eBild .bx"); await p.waitForFunction(() => !document.querySelector("#eBild .bx"));
ok(JSON.parse(await p.evaluate(() => JSON.stringify(REZEPTE.find(r => r.titel === "Cremige Gnocchi")))).originale.length === 0, "✕ löscht das Bild auf dem Server");
await p.click("#vEdit [data-zurueck] >> nth=0");
// Küchenmodus
await p.click("#kochen");
ok(await p.isVisible("#kueche") && (await p.textContent("#kSchritt")).includes("Gnocchi braten") && (await p.textContent("#kPos")) === "1 / 2", "Küchenmodus: Schritt 1 groß");
await p.click("#kNach");
ok((await p.textContent("#kSchritt mark")) === "5 Minuten" && (await p.textContent("#kTimerKnopf")).includes("5 min starten") && (await p.textContent("#kNach")).includes("Fertig"), "Schritt 2: Zeit markiert, Timer-Knopf");
await p.click("#kTimerKnopf button");
ok(/^[45]:\d\d$/.test(await p.textContent("#kTimer .tl b")), "Timer läuft");
await p.evaluate(() => { TIMER[0].ende = Date.now() - 100; });
await p.waitForSelector("#kTimer .tl.fertig");
ok((await p.textContent("#kTimer")).includes("fertig"), "Timer meldet „fertig“");
await p.click("#kTimer button"); ok(await p.locator("#kTimer .tl").count() === 0, "Timer weggetippt");
await p.click("#kZut"); await p.click("#kZutBox label >> nth=0");
ok(await p.locator("#kZutBox label.ok").count() === 1 && (await p.textContent("#kZutBox")).includes("500 g Gnocchi"), "Zutaten abhaken, mit Mengen");
if(BILD) await p.screenshot({ path: BILD + "/kueche.png" });
await p.click("#kZu"); ok(!(await p.isVisible("#kueche")), "Küchenmodus geschlossen");
await p.click("#zur"); await p.click("#katZur");
// Kategorien bearbeiten: umbenennen (Tippen ohne Fokusverlust), neu, leere löschen, volle mit Umzug löschen
await p.click("#katBearb");
const vs = p.locator("#katEd .kr:has(input[value='Vorspeise']) .kn");
await vs.click(); await vs.press("End"); await p.keyboard.type("n", { delay: 30 });
ok(await p.evaluate(() => document.activeElement.value) === "Vorspeisen", "umbenennen: Fokus bleibt");
await p.click("#katEd .kr:has(input[value='Dessert']) .x");
await p.click("#katEd .kr:has(input[value='Hauptgericht']) .x");
await p.selectOption("#katEd .kr.weg select", { label: "Snack" }); await p.click("#katEd .kr.weg button:has-text('Löschen')");
await p.click("#katPlus"); await p.keyboard.type("Grillen");
await p.locator("#katEd .kr").last().locator(".ke").fill("🔥");
if(BILD) await p.screenshot({ path: BILD + "/kategorien.png", fullPage: true });
ok(!(await p.isVisible("#katEd .kr:has(input[value='Hauptgericht']) .kn")), "gelöschte Zeile verschwindet");
await p.click("#katSpeichern"); await p.waitForSelector("#vListe:not([hidden]) .kacheln");
const kt = await p.textContent("#liste");
ok(kt.includes("Vorspeisen") && kt.includes("Grillen") && !kt.includes("Dessert") && !kt.includes("Hauptgericht"), "Kategorien gespeichert: umbenannt, neu, gelöscht");
ok((await p.textContent(".kachel:has-text('Snack')")).includes("1 Rezept"), "Rezept der gelöschten Kategorie ist zu „Snack“ umgezogen");
await p.click(".kachel.alle");

// Foto-Import: Original wird mitgespeichert, Vorschaubild in der Liste
await p.route("https://generativelanguage.googleapis.com/**", r => r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
  body: JSON.stringify({ file: { name: "files/foto1", uri: "https://generativelanguage.googleapis.com/v1beta/files/foto1", mimeType: "image/jpeg" } }) }));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
await p.click("#neuBtn"); await p.setInputFiles("#datei", { name: "scan.png", mimeType: "image/png", buffer: png });
await p.click("#los"); await p.waitForSelector("#vEdit:not([hidden])");
await p.fill("#eTitel", "Croustillants"); await p.click("#eSpeichern");
await p.waitForSelector("#vRezept:not([hidden]) h2");
const origLink = p.locator("#vRezept a:has-text('Original ansehen')").last();
ok((await origLink.textContent()).includes("📄") && /\/bild\/[a-z0-9]{24}$/.test(await origLink.getAttribute("href")), "Foto-Import: „📄 Original ansehen“ mit Bild-Adresse");
const bildRes = await W.fetch(new Request(await origLink.getAttribute("href")), env);
ok(bildRes.status === 200 && Buffer.from(await bildRes.arrayBuffer()).equals(png), "das gespeicherte Original ist das hochgeladene Foto");
await p.click("#zur");
ok(await p.locator("#liste .li .icon img").count() === 1, "Vorschaubild in der Liste");
// Video-Import: Standbild an der von Gemini genannten Sekunde (1,6 s). Testvideo: 1 s schwarz, dann orange „Gericht“.
const webm = await p.evaluate(async () => {
  const c = document.createElement("canvas"); c.width = 320; c.height = 240; const g = c.getContext("2d");
  const rec = new MediaRecorder(c.captureStream(25), { mimeType: "video/webm" }); const teile = [];
  rec.ondataavailable = e => teile.push(e.data); rec.start(100);
  const t0 = performance.now();
  await new Promise(fertig => { (function mal(){ const t = performance.now() - t0;
    g.fillStyle = t < 1000 ? "#000" : "#ff8a00"; g.fillRect(0, 0, 320, 240);
    if(t > 1000){ g.fillStyle = "#7b2cff"; g.beginPath(); g.arc(160, 120, 60, 0, 7); g.fill(); }
    if(t < 2500) requestAnimationFrame(mal); else fertig(); })(); });
  rec.stop(); await new Promise(r => rec.onstop = r);
  const b = new Blob(teile, { type: "video/webm" });
  return btoa(String.fromCharCode(...new Uint8Array(await b.arrayBuffer())));
});
await p.unroute("https://generativelanguage.googleapis.com/**");
await p.route("https://generativelanguage.googleapis.com/**", r => r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
  body: JSON.stringify({ file: { name: "files/video1", uri: "https://generativelanguage.googleapis.com/v1beta/files/video1", mimeType: "video/webm" } }) }));
await p.click("#neuBtn"); await p.setInputFiles("#datei", { name: "reel.webm", mimeType: "video/webm", buffer: Buffer.from(webm, "base64") });
await p.click("#los"); await p.waitForSelector("#vEdit:not([hidden])", { timeout: 40000 });
ok((await p.textContent("#eStand")).includes("wird mitgespeichert"), "Vorschau meldet: Bild aus dem Video wird mitgespeichert");
await p.fill("#eTitel", "Aus dem Video"); await p.click("#eSpeichern"); await p.waitForSelector("#vRezept:not([hidden]) h2");
const standLink = p.locator("#vRezept a:has-text('Bild aus dem Video')");
ok(await standLink.count() === 1 && await p.locator("#vRezept a:has-text('📄')").count() === 0, "Video-Import: „🖼️ Bild aus dem Video“, kein Video als Original");
const sb = await W.fetch(new Request(await standLink.getAttribute("href")), env);
const farbe = await p.evaluate(async b64 => { const img = new Image(); img.src = "data:image/jpeg;base64," + b64; await img.decode();
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0);
  const [r, gr, bl] = g.getImageData(10, 10, 1, 1).data; return { r, gr, bl, w: img.width }; }, Buffer.from(await sb.arrayBuffer()).toString("base64"));
ok(sb.headers.get("content-type") === "image/jpeg" && farbe.r > 200 && farbe.gr > 100 && farbe.bl < 80 && farbe.w === 320, "Standbild zeigt das „Gericht“ (orange), nicht den schwarzen Anfang");
await p.click("#zur");
ok(await p.locator("#liste .li:has-text('Aus dem Video') .icon img").count() === 1, "Standbild als Vorschaubild in der Liste");
ok(await p.evaluate(() => document.querySelectorAll("video").length) === 0, "unsichtbares Video wieder entfernt");
await p.click("#liste .li:has-text('Aus dem Video')"); await p.click("#loesch"); await p.waitForSelector("#vListe:not([hidden])");

// Text-Import danach: kein Original übrig vom vorigen Foto
await p.click("#neuBtn"); await p.fill("#text", "Nur Text"); await p.click("#los"); await p.waitForSelector("#vEdit:not([hidden])");
await p.fill("#eTitel", "Nur Text"); await p.click("#eSpeichern"); await p.waitForSelector("#vRezept:not([hidden]) h2");
ok(await p.locator("#vRezept a:has-text('📄')").count() === 0, "Text-Import ohne Original");
if(BILD) { await p.click("#zur"); await p.screenshot({ path: BILD + "/liste.png", fullPage: true }); }
await p.goto(APP); await zuAllen();
for(const t of ["Croustillants", "Nur Text"]){ await p.click(`#liste .li:has-text('${t}')`); await p.click("#loesch"); await p.waitForSelector("#vListe:not([hidden])"); }


// Sicherung: Rezeptbuch erstellen, ohne App lesbar, nach dem Löschen wiederherstellen
const gid = await p.evaluate(() => REZEPTE.find(r => r.titel === "Cremige Gnocchi").id);
const wreq = (pfad, o = {}) => W.fetch(new Request("https://recipes.rjtp6r9s9h.workers.dev" + pfad, { ...o, headers: { "x-code": "familie", ...(o.headers || {}) } }), env);
await wreq("/api/original/" + gid + "?typ=image%2Fpng&name=g.png&vorschau=1", { method: "PUT", body: png });
await wreq("/api/bewerten/" + gid, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sterne: 4, gekocht: true }) });
await p.goto(APP); await p.waitForSelector(".kachel.alle");
ok(await p.isVisible("#sicherBox"), "Sicherung unten auf der Startseite");
await p.click("#sichern"); await p.waitForSelector("#teilenZeile:not([hidden])");
const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#sicherTeilen")]);
const buchPfad = (BILD || tmpdir()) + "/rezeptbuch.html"; await dl.saveAs(buchPfad);
const buchHtml = readFileSync(buchPfad, "utf8");
ok(dl.suggestedFilename().startsWith("Rezeptbuch-") && buchHtml.includes("Cremige Gnocchi") && buchHtml.includes("★★★★☆") && (await p.textContent("#sicherStand")).includes("Gesichert"), "Rezeptbuch als Datei gesichert");
const leser = await br.newPage({ viewport: { width: 390, height: 800 } });
await leser.setContent(buchHtml);
ok((await leser.textContent("h1")).includes("Unsere Rezepte") && await leser.evaluate(() => [...document.querySelectorAll("img.gross")].every(i => i.naturalWidth > 0) && document.querySelectorAll("img.gross").length === 1), "Rezeptbuch ohne App lesbar, Bild eingebettet");
if(BILD) await leser.screenshot({ path: BILD + "/rezeptbuch.png", fullPage: true });
await leser.close();
await p.click(".kachel.alle"); await p.click("#liste .li"); await p.click("#loesch"); await p.waitForSelector("#vListe:not([hidden])");
ok(await p.isVisible("#sicherBox") && (await p.textContent("#liste")).includes("Noch keine Rezepte"), "alles weg: „Wiederherstellen“ sichtbar");
await p.setInputFiles("#wiederDatei", buchPfad);
await p.waitForFunction(() => document.getElementById("sicherStand").textContent.includes("zurückgeholt"));
const zurueck = JSON.parse(await p.evaluate(() => JSON.stringify(REZEPTE.find(r => r.titel === "Cremige Gnocchi"))));
ok(zurueck && zurueck.id === gid && zurueck.sterne === 4 && zurueck.gekocht.length === 1 && zurueck.originale.length === 1 && zurueck.vorschau === zurueck.originale[0].id && zurueck.kategorien.includes("snack"), "Wiederhergestellt: gleiche id, Sterne, gekocht, Bild als Vorschau, Kategorie");
await p.setInputFiles("#wiederDatei", buchPfad);
await p.waitForFunction(() => document.getElementById("sicherStand").textContent.includes("schon da"));
ok(true, "zweites Einlesen: nichts doppelt");

// Löschen
await p.click("#liste .li"); await p.click("#loesch"); await p.waitForSelector("#vListe:not([hidden])");
ok((await p.textContent("#liste")).includes("Noch keine Rezepte"), "gelöscht");

ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 390, "kein seitliches Scrollen bei 390 px");
ok(!fehlerSeite.length, "keine Skriptfehler" + (fehlerSeite.length ? ": " + fehlerSeite.join(" | ") : ""));
await br.close();
console.log(fehler ? `\n${fehler} Fehler` : "\nAlles grün");
process.exit(fehler ? 1 : 0);
