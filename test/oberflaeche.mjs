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

const KI = { titel: "Cremige Gnocchi", portionen: 2, zeit_min: 20, zutaten: [
  { name: "Gnocchi", menge: 500, einheit: "g", gang: "Kühlregal" },
  { name: "Sahne", menge: 200, einheit: "ml", gang: "Kühlregal", gruppe: "Sauce" },
  { name: "Salz", menge: 1, einheit: "Prise", gang: "Gewürze, Öl & Saucen", gruppe: "Sauce" },
  { name: "Basilikum", menge: null, einheit: "", gang: "Obst & Gemüse", hinweis: "Menge nicht genannt" }],
  schritte: ["Gnocchi braten.", "Sahne dazu, 5 Minuten köcheln."], notiz: "" };
const echt = globalThis.fetch;
globalThis.fetch = async (u, o) => {
  u = String(u);
  if(u.includes(":streamGenerateContent")) return new Response("data: " + JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(KI) }] } }] }) + "\n\n");
  if(u.includes("googleapis")) return Response.json({ name: "m" });
  return echt(u, o);
};

let fehler = 0;
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
await p.click("#neuBtn"); await p.fill("#text", "Rezept aus dem Reel https://www.facebook.com/share/r/abc");
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
await p.click("#eSpeichern"); await p.waitForSelector("#vRezept:not([hidden]) h2");
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
await p.waitForSelector("#liste .li");
ok((await p.textContent("#liste")).includes("Cremige Gnocchi"), "nach Neuladen: Rezept da");
ok((await p.textContent("#ekZahl")) === "3", "nach Neuladen: Einkaufsliste da");
if(BILD){ await p.click("#liste .li"); await p.click("#bearb"); await p.screenshot({ path: BILD + "/bearbeiten.png", fullPage: true }); await p.click("[data-zurueck] >> nth=1"); await p.click("#tR"); }
// Suche tippen ohne Fokusverlust
await p.click("#suche"); await p.type("#suche", "sahne", { delay: 30 });
ok(await p.evaluate(() => document.activeElement.id) === "suche" && (await p.textContent("#liste")).includes("Gnocchi"), "Suche nach Zutat, Fokus bleibt");
await p.fill("#suche", "lachs"); ok((await p.textContent("#liste")).includes("Nichts gefunden"), "Suche ohne Treffer");
await p.fill("#suche", "");

// Löschen
await p.click("#liste .li"); await p.click("#loesch"); await p.waitForSelector("#vListe:not([hidden])");
ok((await p.textContent("#liste")).includes("Noch keine Rezepte"), "gelöscht");

ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 390, "kein seitliches Scrollen bei 390 px");
ok(!fehlerSeite.length, "keine Skriptfehler" + (fehlerSeite.length ? ": " + fehlerSeite.join(" | ") : ""));
await br.close();
console.log(fehler ? `\n${fehler} Fehler` : "\nAlles grün");
process.exit(fehler ? 1 : 0);
