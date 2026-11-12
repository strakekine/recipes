// Test für worker.js: Gemini und D1 nachgebaut (D1 über node:sqlite).
// Aufruf: node test/worker.mjs   (Rückgabewert 1 bei Fehler)
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const quelle = readFileSync(new URL("../worker.js", import.meta.url), "utf8");
const tmp = join(mkdtempSync(join(tmpdir(), "rw-")), "w.mjs");
writeFileSync(tmp, quelle);
const W = await import(tmp);
const worker = W.default;

let fehlerZahl = 0;
const ok = (b, t) => { console.log((b ? "✓ " : "✗ ") + t); if(!b) fehlerZahl++; };

let LETZTE_DB;
const db0 = () => ENV_DB;
function d1(){
  const db = new DatabaseSync(":memory:"); LETZTE_DB = db;
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => { db.prepare(sql).run(...args); return { success: true }; },
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
  });
  return { prepare: sql => stmt(sql) };
}

// Nachgebautes Gemini
const WEB = {};   // nachgebaute Webseiten für den Link-Import
let G = { state: "PROCESSING", antwort: null, aufrufe: [] };
globalThis.fetch = async (url, opt = {}) => {
  url = String(url); G.aufrufe.push({ url, opt });
  const h = opt.headers || {};
  if(!url.includes("generativelanguage.googleapis.com")) return WEB[url] ? WEB[url](opt) : new Response("fremd", { status: 500 });
  if(h["x-goog-api-key"] !== undefined && h["x-goog-api-key"] !== "KEY") return new Response("{}", { status: 403 });
  if(url.endsWith("/upload/v1beta/files")) return new Response("{}", { headers: { "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/xyz" } });
  if(url.endsWith("/upload/xyz")){
    const body = await new Response(opt.body).text();
    return Response.json({ file: { name: "files/abc123", uri: "https://generativelanguage.googleapis.com/v1beta/files/abc123", mimeType: "video/mp4", state: "PROCESSING", groesse: body.length } });
  }
  if(url.endsWith("/v1beta/files/abc123")) return Response.json({ state: G.state });
  if(url.includes(":streamGenerateContent")){
    G.modelle = [...(G.modelle || []), url.match(/models\/([^:]+)/)[1]];
    if(G.ueberlastet && G.modelle.length === 1) return Response.json({ error: { message: "high demand" } }, { status: 503 });
    const j = JSON.stringify(G.antwort), mitte = Math.floor(j.length / 2);
    const sse = [{ candidates: [{ content: { parts: [{ text: "Ich denke nach …", thought: true }] } }] },
      { candidates: [{ content: { parts: [{ text: j.slice(0, mitte) }] } }] },
      { candidates: [{ content: { parts: [{ text: j.slice(mitte) }] }, finishReason: "STOP" }] }]
      .map(o => "data: " + JSON.stringify(o) + "\r\n\r\n").join("");
    return new Response(sse, { headers: { "content-type": "text/event-stream" } });
  }
  if(/\/v1beta\/models\/[^:]+$/.test(url)) return Response.json({ name: "models/x" });
  return new Response("?", { status: 404 });
};

const env = { GEMINI_KEY: "KEY", FAMILIEN_CODE: "pizza42", DB: d1() };
const ENV_DB = LETZTE_DB;
const req = (pfad, o = {}) => new Request("https://rezepte.example.workers.dev" + pfad,
  { ...o, headers: { "x-code": "pizza42", ...(o.headers || {}) } });
const call = async (pfad, o, e = env) => { const r = await worker.fetch(req(pfad, o), e); return { r, d: await r.clone().json().catch(() => null) }; };

// Zugang
ok((await worker.fetch(new Request("https://w/api/rezepte"), env)).status === 401, "ohne Code: 401");
ok((await worker.fetch(new Request("https://w/api/rezepte", { headers: { "x-code": "pizza4" } }), env)).status === 401, "falscher Code (Präfix): 401");
ok((await call("/api/rezepte", {}, { ...env, FAMILIEN_CODE: undefined })).r.status === 503, "ohne Secret FAMILIEN_CODE: 503");
ok((await call("/api/datei", { method: "POST", body: "x", headers: { "content-type": "image/png" } }, { ...env, GEMINI_KEY: undefined })).r.status === 503, "ohne GEMINI_KEY: 503");
ok((await worker.fetch(new Request("https://w/"), env)).headers.get("content-type").startsWith("text/html"), "Testseite ohne Code erreichbar");
const pf = await worker.fetch(new Request("https://w/api/rezepte", { method: "OPTIONS", headers: { origin: "https://strakekine.github.io" } }), env);
ok(pf.status === 204 && pf.headers.get("access-control-allow-origin") === "https://strakekine.github.io", "Preflight für die App-Adresse");
const fremd = await worker.fetch(new Request("https://w/api/rezepte", { headers: { origin: "https://boese.example", "x-code": "pizza42" } }), env);
ok(!fremd.headers.get("access-control-allow-origin"), "fremde Herkunft bekommt keine CORS-Freigabe");
const p = await call("/api/pruefen");
ok(p.d?.gemini === true && p.d?.db === true && p.d?.modell === "gemini-flash-latest", "Prüfen: Gemini, DB, Standardmodell");
ok((await call("/api/pruefen", {}, { ...env, GEMINI_KEY: "FALSCH" })).d?.gemini === false, "Prüfen meldet falschen Schlüssel");

// Hochladen
ok((await call("/api/datei", { method: "POST", body: "abc", headers: { "content-type": "text/html", "content-length": "3" } })).r.status === 415, "HTML-Datei abgelehnt");
const groß = await worker.fetch(req("/api/datei", { method: "POST", body: "x", headers: { "content-type": "video/mp4", "content-length": String(200 * 1024 * 1024) } }), env).catch(() => null);
ok(!groß || groß.status === 413 || groß.status === 400, "zu große Datei abgelehnt (oder vom Request selbst verhindert)");
G.aufrufe = [];
const up = await call("/api/datei?name=reel.mp4", { method: "POST", body: "VIDEODATEN", headers: { "content-type": "video/mp4", "content-length": "10" } });
ok(up.d?.datei?.name === "files/abc123", "Hochladen liefert Gemini-Datei");
const start = G.aufrufe.find(a => a.url.endsWith("/upload/v1beta/files"));
ok(start?.opt.headers["X-Goog-Upload-Header-Content-Length"] === "10" && start.opt.headers["X-Goog-Upload-Header-Content-Type"] === "video/mp4", "Start nennt Länge und Typ");
const fertig = G.aufrufe.find(a => a.url.endsWith("/upload/xyz"));
ok(fertig?.opt.headers["X-Goog-Upload-Command"] === "upload, finalize" && !("x-goog-api-key" in fertig.opt.headers), "Upload ohne Schlüssel, finalize");

// Direkt-Upload: Worker gibt nur die Upload-Adresse heraus
const ds = await call("/api/datei-start?name=reel.mov&groesse=300000000&typ=video%2Fquicktime", { method: "POST" });
ok(ds.d?.url === "https://generativelanguage.googleapis.com/upload/xyz", "Direkt-Upload: Adresse auch für 300 MB");
ok(!JSON.stringify(ds.d).includes("KEY"), "Upload-Adresse enthält den Schlüssel nicht");
ok((await call("/api/datei-start?groesse=10&typ=text%2Fhtml", { method: "POST" })).r.status === 415, "Direkt-Upload: HTML abgelehnt");
ok((await call("/api/datei-start?groesse=2000000000&typ=video%2Fmp4", { method: "POST" })).r.status === 413, "Direkt-Upload: über 1 GB abgelehnt");
ok((await call("/api/datei-start?groesse=0&typ=video%2Fmp4", { method: "POST" })).r.status === 400, "Direkt-Upload: leer abgelehnt");

// Rezept: erst warten, dann fertig
const datei = up.d.datei;
const auftrag = { method: "POST", headers: { "content-type": "application/json" } };
G.state = "PROCESSING";
ok((await call("/api/rezept", { ...auftrag, body: JSON.stringify({ dateien: [datei] }) })).r.status === 202, "Video in Verarbeitung: 202 warten");
G.state = "ACTIVE";
G.antwort = { titel: "Cremige Gnocchi", portionen: 4, zeit_min: 25,
  zutaten: [
    { name: "Gnocchi", menge: 500, einheit: "g", gang: "Kühlregal" },
    { name: "Basilikum", menge: null, einheit: "", gang: "Obst & Gemüse", hinweis: "eine Handvoll, grob" },
    { name: "Olivenöl", menge: null, einheit: "EL", gang: "Gewürze, Öl & Saucen" },
    { name: "Knoblauch", menge: 2, menge_bis: 3, einheit: "zehe", gang: "Erfunden" },
    { name: "", menge: 1 },
    { name: "Sahne", menge: 200, einheit: "Tassen", gruppe: "Für die Sauce", gang: "Kühlregal" },
  ],
  schritte: ["Knoblauch 2 Minuten anbraten.", "", "10 Minuten köcheln."], notiz: "" };
G.aufrufe = [];
const rz = await call("/api/rezept", { ...auftrag, body: JSON.stringify({ dateien: [datei, { name: "../x", uri: "https://boese/" }], text: "Schau https://www.facebook.com/share/r/abc und https://youtu.be/dQw4w9WgXcQ" }) });
const r = rz.d?.rezept;
ok(rz.r.status === 200 && r?.titel === "Cremige Gnocchi", "Rezept kommt an");
const gen = G.aufrufe.find(a => a.url.includes(":streamGenerateContent"));
const teile = JSON.parse(gen.opt.body).contents[0].parts;
ok(teile.filter(x => x.file_data).length === 2 && teile.some(x => x.file_data?.file_uri?.includes("youtu.be")), "fremde Datei verworfen, YouTube-Link als Video mitgegeben");
ok(teile.at(-1).text.includes("Niemals Mengen erfinden"), "Auftrag geht mit");
ok(r.zutaten.length === 5, "Zutat ohne Namen verworfen");
ok(r.zutaten[2].hinweis === "Menge nicht genannt", "Einheit ohne Menge bekommt Hinweis");
ok(r.zutaten[3].einheit === "Zehe" && r.zutaten[3].menge_bis === 3 && r.zutaten[3].gang === "Sonstiges", "Einheit vereinheitlicht, Spanne, unbekannter Gang → Sonstiges");
ok(r.zutaten[4].einheit === "" && r.zutaten[4].gruppe === "Für die Sauce", "unbekannte Einheit verworfen, Gruppe bleibt");
ok(r.schritte.length === 2, "leere Schritte weg");
ok(r.quelle === "https://www.facebook.com/share/r/abc", "erster Link wird Quelle");

// Überlastet → zweiter Versuch mit dem leichteren Modell, im Protokoll vermerkt
G.ueberlastet = true; G.modelle = [];
const ue = await call("/api/rezept", { ...auftrag, body: JSON.stringify({ text: "Rezepttext" }) });
ok(ue.d?.rezept?.titel === "Cremige Gnocchi" && ue.d.modell === "gemini-flash-lite-latest" && G.modelle.join() === "gemini-flash-latest,gemini-flash-lite-latest", "503 → Ersatzmodell liefert");
ok((await call("/api/protokoll")).d.eintraege.some(e => e.was.startsWith("↻") && e.was.includes("high demand")), "Wiederholung steht im Protokoll");
G.ueberlastet = false;
const genBody = JSON.parse(G.aufrufe.filter(a => a.url.includes(":streamGenerateContent")).at(-1).opt.body);
ok(!("mediaResolution" in genBody.generationConfig) && genBody.generationConfig.thinkingConfig.thinkingBudget === 0, "Text/Bild: volle Auflösung, Denken aus");

// Modell lehnt thinkingBudget 0 ab → derselbe Versuch ohne Einstellung
const vorher = globalThis.fetch; let ohne = 0;
globalThis.fetch = async (u, o) => {
  if(String(u).includes(":streamGenerateContent") && JSON.parse(o.body).generationConfig.thinkingConfig)
    return Response.json({ error: { message: "Budget 0 is invalid. This model only works in thinking mode." } }, { status: 400 });
  if(String(u).includes(":streamGenerateContent")) ohne++;
  return vorher(u, o);
};
const td = await call("/api/rezept", { ...auftrag, body: JSON.stringify({ text: "Rezepttext" }) });
ok(td.d?.rezept && ohne === 1 && td.d.modell === "gemini-flash-latest", "400 wegen Denken → ohne Einstellung, gleiches Modell");
globalThis.fetch = vorher;

// Video: zuerst das schnelle Modell; .mov heißt bei Gemini video/mov; Ergebnis bleibt abholbar
G.modelle = []; G.aufrufe = [];
const mov = { name: "files/abc123", uri: "https://generativelanguage.googleapis.com/v1beta/files/abc123", mime: "video/quicktime" };
const vr = await call("/api/rezept", { ...auftrag, body: JSON.stringify({ dateien: [mov], auftrag: "a-test-123" }) });
ok(vr.d?.modell === "gemini-flash-lite-latest" && G.modelle[0] === "gemini-flash-lite-latest", "Video: leichtes Modell zuerst");
const vBody = JSON.parse(G.aufrufe.find(a => a.url.includes(":streamGenerateContent")).opt.body);
ok(vBody.contents[0].parts[0].file_data.mime_type === "video/mov" && vBody.generationConfig.mediaResolution === "MEDIA_RESOLUTION_LOW", "video/quicktime → video/mov, Video in niedriger Auflösung");
ok(W.geminiMime("video/mp4") === "video/mp4", "mp4 bleibt");
const ab = await call("/api/ergebnis/a-test-123");
ok(ab.r.status === 200 && ab.d?.rezept?.titel === "Cremige Gnocchi", "Ergebnis per Auftrag abholbar");
ok((await call("/api/ergebnis/a-gibts-nicht")).r.status === 202, "unbekannter Auftrag: 202 warten");
ok((await worker.fetch(new Request("https://w/api/ergebnis/a-test-123"), env)).status === 401, "Abholen nur mit Code");
G.aufrufe = [];
await call("/api/datei-start?name=x.mov&groesse=10&typ=video%2Fquicktime", { method: "POST" });
ok(G.aufrufe[0].opt.headers["X-Goog-Upload-Header-Content-Type"] === "video/mov", "Upload meldet video/mov");

// Irgendein 400 mit Denk-Einstellung → einmal ohne
const vor2 = globalThis.fetch; let zweiter = 0;
globalThis.fetch = async (u, o) => {
  if(String(u).includes(":streamGenerateContent") && JSON.parse(o.body).generationConfig.thinkingConfig)
    return Response.json({ error: { message: "Request contains an invalid argument." } }, { status: 400 });
  if(String(u).includes(":streamGenerateContent")) zweiter++;
  return vor2(u, o);
};
ok((await call("/api/rezept", { ...auftrag, body: JSON.stringify({ text: "Rezepttext" }) })).d?.rezept && zweiter === 1, "allgemeiner 400 → ohne Denk-Einstellung");
globalThis.fetch = vor2;

// KI-Fehler kommt im Strom als {fehler}, nicht als Absturz
const echtFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => String(u).includes(":streamGenerateContent") ? Response.json({ error: { message: "Kontingent" } }, { status: 429 }) : echtFetch(u, o);
const kf = await call("/api/rezept", { ...auftrag, body: JSON.stringify({ text: "Rezepttext" }) });
ok(kf.d?.fehler?.includes("Kontingent") && !kf.d.rezept, "Gemini-Fehler kommt als Fehlertext an");
globalThis.fetch = echtFetch;

// Protokoll: Start und Ende jedes KI-Laufs
const pr = await call("/api/protokoll");
ok(pr.d?.eintraege?.some(e => e.was.startsWith("KI gestartet")) && pr.d.eintraege.some(e => e.was.startsWith("✓ nach")) && pr.d.eintraege.some(e => e.was.includes("Kontingent")), "Protokoll hat Start, Erfolg und Fehler");

// Tagesgrenze
const env2 = { ...env, DB: d1() };
let letzte;
for(let i = 0; i < 31; i++) letzte = await call("/api/rezept", { ...auftrag, body: JSON.stringify({ text: "Rezepttext" }) }, env2);
ok(letzte.r.status === 429, "31. Import am Tag: 429");

// Speichern, Liste, Löschen
ok((await call("/api/rezepte/abc123xyz", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ titel: "" , zutaten: [], schritte: [] }) })).r.status === 400, "ohne Titel nicht speichern");
const sp = await call("/api/rezepte/abc123xyz", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...r, boese: "<script>" }) });
ok(sp.d?.rezept?.id === "abc123xyz" && !("boese" in sp.d.rezept), "speichern, fremde Felder weg");
const erstellt = sp.d.rezept.erstellt;
await new Promise(res => setTimeout(res, 5));
const sp2 = await call("/api/rezepte/abc123xyz", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...r, titel: "Neu" }) });
ok(sp2.d.rezept.erstellt === erstellt && sp2.d.rezept.geaendert > erstellt, "Ändern behält 'erstellt'");
const li = await call("/api/rezepte");
ok(li.d.rezepte.length === 1 && li.d.rezepte[0].titel === "Neu", "Liste");
ok((await call("/api/rezepte/../../x", { method: "DELETE" })).r.status !== 200, "ungültige id beim Löschen abgewiesen");
await call("/api/rezepte/abc123xyz", { method: "DELETE" });
ok((await call("/api/rezepte")).d.rezepte.length === 0, "gelöscht");

// Originale (Foto/PDF zum Rezept)
await call("/api/rezepte/orig12345", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...r, titel: "Mit Foto" }) });
const gross = new Uint8Array(900 * 1024).map((_, i) => (i * 7) % 251);
const og1 = await call("/api/original/orig12345?typ=image%2Fjpeg&name=scan.jpg", { method: "PUT", body: gross });
const o1 = og1.d?.rezept?.originale?.[0];
ok(og1.r.status === 200 && /^[a-z0-9]{24}$/.test(o1?.id) && o1.groesse === gross.length, "Original gespeichert, zufällige id");
const bildAntwort = await worker.fetch(new Request("https://w/bild/" + o1.id), env);
const zurueck = new Uint8Array(await bildAntwort.arrayBuffer());
ok(bildAntwort.status === 200 && bildAntwort.headers.get("content-type") === "image/jpeg" && zurueck.length === gross.length && zurueck.every((b, i) => b === gross[i]), "900 KB in drei Stücken, kommt unverändert zurück (ohne Code)");
ok(db0().prepare("SELECT COUNT(*) n FROM originale WHERE id = ?").get(o1.id).n === 3, "in 400-KB-Stücke geteilt");
ok((await call("/api/original/orig12345?typ=video%2Fmp4", { method: "PUT", body: new Uint8Array(10) })).r.status === 415, "Video wird nicht als Original gespeichert");
ok((await call("/api/original/orig12345?typ=application%2Fpdf", { method: "PUT", body: new Uint8Array(2 * 1024 * 1024 + 1) })).r.status === 413, "über 2 MB abgelehnt");
ok((await call("/api/original/gibtsnicht?typ=image%2Fjpeg", { method: "PUT", body: new Uint8Array(10) })).r.status === 404, "unbekanntes Rezept: 404");
for(let i = 0; i < 4; i++) await call("/api/original/orig12345?typ=application%2Fpdf", { method: "PUT", body: new Uint8Array(10) });
ok((await call("/api/original/orig12345?typ=image%2Fjpeg", { method: "PUT", body: new Uint8Array(10) })).r.status === 409, "höchstens 5 je Rezept");
const nachEdit = await call("/api/rezepte/orig12345", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...(await call("/api/rezepte")).d.rezepte.find(x => x.id === "orig12345"), titel: "Umbenannt" }) });
ok(nachEdit.d.rezept.originale.length === 5, "Bearbeiten behält die Originale");
ok(W.saeubern({ titel: "x", zutaten: [], schritte: [], originale: [{ id: "kurz", typ: "image/jpeg" }, { id: "a".repeat(24), typ: "text/html" }] }).originale.length === 0, "fremde Original-Einträge werden verworfen");
await call("/api/rezepte/orig12345", { method: "DELETE" });
ok((await worker.fetch(new Request("https://w/bild/" + o1.id), env)).status === 404 && db0().prepare("SELECT COUNT(*) n FROM originale WHERE rezept = 'orig12345'").get().n === 0, "Rezept löschen löscht die Originale");
ok((await worker.fetch(new Request("https://w/bild/" + "z".repeat(24)), env)).status === 404, "unbekanntes Bild: 404");

// Bring!
const br = await call("/api/bring", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ titel: "Gnocchi <b>", zeilen: ["500 g Gnocchi", "2 Zehen Knoblauch", "Basilikum </script>"] }) });
ok(br.d?.link?.startsWith("https://api.getbring.com/rest/bringrecipes/deeplink?url=https%3A%2F%2Frezepte.example.workers.dev%2Fbring%2F"), "Bring!-Deeplink mit unserer Seite");
const seite = await (await worker.fetch(new Request(br.d.seite), env)).text();
const ld = JSON.parse(seite.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
ok(ld["@type"] === "Recipe" && ld.recipeIngredient.length === 3 && ld.recipeIngredient[2] === "Basilikum </script>", "Seite hat schema.org/Recipe mit allen Zeilen");
ok(!seite.includes("<b>") && seite.split("</script>").length === 2, "Seite escaped Titel und Zeilen");
ok((await worker.fetch(new Request("https://w/bring/aaaaaaaaaaaaaaaa"), env)).status === 404, "unbekannte Bring!-Liste: 404");
ok((await call("/api/bring", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ zeilen: [] }) })).r.status === 400, "leere Liste abgewiesen");

// Wofür die Rezeptmenge steht
ok(W.saeubern({ titel: "x", portionen: 26, portion_einheit: "Kräcker", zutaten: [], schritte: [] }).portion_einheit === "Kräcker", "portion_einheit bleibt erhalten");
ok(W.saeubern({ titel: "x", portionen: 4, zutaten: [], schritte: [] }).portion_einheit === "Personen", "ohne Angabe: Personen");
ok(W.saeubern({ titel: "x", portionen: 300, zutaten: [], schritte: [] }).portionen === 300, "bis 500 Stück möglich");
ok(W.saeubern({ titel: "x", bild_sekunde: 12.5, zutaten: [], schritte: [] }).bild_sekunde === 12.5 && !("bild_sekunde" in W.saeubern({ titel: "x", bild_sekunde: null, zutaten: [], schritte: [] })), "bild_sekunde bleibt, fehlt ohne Wert");

// Einheiten in allen Schreibweisen (Befund 08.11.: „60 Parmesan“ statt „60 g“)
const eh = W.saeubern({ titel: "x", schritte: [], zutaten: [
  { name: "geriebener Parmesan", menge: 60, einheit: "Gramm" }, { name: "Butter", menge: 6, einheit: "Esslöffel" },
  { name: "Mehl", menge: 150, einheit: "gr." }, { name: "Cayennepfeffer", menge: 1, einheit: "Prisen" },
  { name: "g geriebener Comté", menge: 250, einheit: "" }, { name: "Rum", menge: 2, einheit: "cl" },
  { name: "Schnittlauch", menge: 2, menge_bis: 3, einheit: "EL" }, { name: "Eier", menge: 2, einheit: "" }] }).zutaten;
ok(eh.map(z => z.einheit).join() === "g,EL,g,Prise,g,ml,EL," && eh[4].name === "geriebener Comté" && eh[5].menge === 20, "Einheiten: Gramm/Esslöffel/gr./Prisen/im Namen/cl → Kürzel");


// Rezept aus einem Link (Befund 08.11.: yummix-Link kam ohne Mengen, weil die Seite nie gelesen wurde)
const ldSeite = `<html><head><meta property="og:image" content="https://yummix.example/og.jpg">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"x"},
{"@type":["Recipe"],"name":"G&acirc;teau royal","recipeYield":["8","8 parts"],"totalTime":"PT1H15M","image":{"@type":"ImageObject","url":"https://yummix.example/gateau.jpg"},
"recipeIngredient":["200 g de farine","3 &#339;ufs","100 g de sucre"],
"recipeInstructions":[{"@type":"HowToSection","name":"Pâte","itemListElement":[{"@type":"HowToStep","text":"Mélanger <b>farine</b> et sucre."}]},{"@type":"HowToStep","text":"Cuire 30 min à 180°C."}]}]}</script></head><body>…</body></html>`;
WEB["https://yummix.example/gateau-royal/"] = () => new Response(ldSeite, { headers: { "content-type": "text/html; charset=utf-8" } });
const ld0 = W.rezeptAusLd(ldSeite);
ok(ld0?.name === "G&acirc;teau royal" && W.ldBild(ld0) === "https://yummix.example/gateau.jpg", "schema.org/Recipe in @graph gefunden, Bild aus ImageObject");
const ldt = W.ldAlsText(ld0);
ok(ldt.includes("Titel: Gâteau royal") && ldt.includes("- 3 œufs") && ldt.includes("Abschnitt Pâte:\n1. Mélanger farine et sucre.") && ldt.includes("2. Cuire 30 min") && ldt.includes("75 Minuten") && ldt.includes("Ergibt: 8 / 8 parts"), "Rezeptdaten als Text: Zutaten, Abschnitte, Zeit, Entities");
ok(W.linksAus("Schau mal: https://a.example/x). und https://a.example/x").join() === "https://a.example/x", "Links ohne Satzzeichen, doppelt nur einmal");
ok(W.SOZIAL.test("https://www.instagram.com/reel/abc") && W.SOZIAL.test("https://fb.watch/xy") && W.SOZIAL.test("https://vm.tiktok.com/z") && !W.SOZIAL.test("https://www.chefkoch.de/x") && !W.SOZIAL.test("https://notfacebook.com.example/"), "soziale Netzwerke erkannt");
G.antwort = { titel: "Gâteau royal", portionen: 8, zutaten: [{ name: "Mehl", menge: 200, einheit: "g" }], schritte: ["Mischen."], kategorien: ["backen", "gibtsnicht", "dessert", "snack"] };
G.aufrufe = []; G.modelle = [];
const lk = await call("/api/rezept", { ...auftrag, body: JSON.stringify({ text: "https://yummix.example/gateau-royal/" }) });
const lkText = JSON.parse(G.aufrufe.find(a => a.url.includes(":streamGenerateContent")).opt.body).contents[0].parts.at(-1).text;
ok(lk.d?.rezept?.titel === "Gâteau royal" && lkText.includes("Rezeptdaten der verlinkten Webseite") && lkText.includes("- 200 g de farine"), "Link: Seite gelesen, Rezeptdaten gehen an Gemini");
ok(lkText.includes("Sichtbarer Text derselben Webseite") && lkText.indexOf("Rezeptdaten der verlinkten Webseite") < lkText.indexOf("Sichtbarer Text"), "Link mit Rezeptdaten: sichtbarer Seitentext geht mit (Gruppen, vollständige Schritte; Befund 12.11. Osso Buco)");
ok(W.AUFTRAG.includes("VOLLSTÄNDIG übersetzen, nicht zusammenfassen") && W.AUFTRAG.includes("JEDE Zutat dieses Abschnitts") && W.AUFTRAG.includes("Zest of 1 lemon"), "Auftrag: Schritte vollständig, Gruppen für jede Zutat, Zitronenschale");
ok(lkText.includes("backen = Backen") && lk.d.rezept.kategorien.join() === "backen,dessert", "Kategorien zur Auswahl, unbekannte verworfen, höchstens 2");
ok(lk.d.rezept.bild_url === "https://yummix.example/gateau.jpg" && lk.d.rezept.quelle === "https://yummix.example/gateau-royal/", "Bild der Seite und Link als Quelle");
WEB["https://blog.example/rezept"] = () => new Response("<html><body><nav>Menü</nav><h1>Omas Kuchen</h1><p>" + "Zutaten: 250 g Butter, 4 Eier. ".repeat(10) + "</p><script>var x=1</script></body></html>", { headers: { "content-type": "text/html" } });
G.aufrufe = [];
await call("/api/rezept", { ...auftrag, body: JSON.stringify({ text: "https://blog.example/rezept" }) });
const blText = JSON.parse(G.aufrufe.find(a => a.url.includes(":streamGenerateContent")).opt.body).contents[0].parts.at(-1).text;
ok(blText.includes("Text der verlinkten Webseite") && blText.includes("250 g Butter") && !blText.includes("var x") && !blText.includes("Menü"), "ohne Rezeptdaten: Seitentext ohne Skripte und Menü");
WEB["https://zu.example/r"] = () => new Response("nein", { status: 403 });
G.aufrufe = [];
const zu = await call("/api/rezept", { ...auftrag, body: JSON.stringify({ text: "https://zu.example/r" }) });
ok(zu.r.status === 422 && zu.d.fehler.includes("403") && zu.d.fehler.includes("Screenshot") && !G.aufrufe.some(a => a.url.includes(":stream")), "Seite gesperrt, nur Link: klarer Fehler statt nachgebautem Rezept");
G.aufrufe = [];
const zu2 = await call("/api/rezept", { ...auftrag, body: JSON.stringify({ text: "https://zu.example/r\nZutaten: 200 g Mehl, 3 Eier, 100 g Zucker, alles verrühren und backen." }) });
ok(zu2.d?.rezept && JSON.parse(G.aufrufe.find(a => a.url.includes(":stream")).opt.body).contents[0].parts.at(-1).text.includes("ließ sich nicht lesen"), "Seite gesperrt, aber Text dabei: Rezept aus dem Text, mit Hinweis");
const fb = await call("/api/rezept", { ...auftrag, body: JSON.stringify({ text: "https://www.instagram.com/reel/abc123/" }) });
ok(fb.r.status === 422 && fb.d.fehler.includes("Bildschirmaufnahme"), "nur Instagram-Link: Hinweis auf Bildschirmaufnahme");
WEB["https://leer.example/"] = () => new Response("<html><body>Bitte anmelden</body></html>", { headers: { "content-type": "text/html" } });
ok((await call("/api/rezept", { ...auftrag, body: JSON.stringify({ text: "https://leer.example/" }) })).d?.fehler?.includes("kaum Text"), "fast leere Seite: Fehler");
WEB["https://pdf.example/a.pdf"] = () => new Response("%PDF", { headers: { "content-type": "application/pdf" } });
ok((await call("/api/rezept", { ...auftrag, body: JSON.stringify({ text: "https://pdf.example/a.pdf" }) })).d?.fehler?.includes("keine Webseite"), "PDF-Link: keine Webseite");
ok(W.AUFTRAG.includes("NICHT aus eigenem Wissen nachbauen"), "Auftrag verbietet Nachbauen aus dem Namen");
ok(W.AUFTRAG.includes("SPRACHE: Alles auf Deutsch") && !lkText.includes("(genau übernehmen)") && lkText.trim().endsWith("komplett auf Deutsch geschrieben."), "Deutsch: eigene Regel, Rezeptdaten zum Übersetzen, Erinnerung am Ende (Befund 12.11.: englisches Rezept blieb englisch)");
ok(W.AUFTRAG.includes('"Für den Teig:"') && W.AUFTRAG.includes("Doppelpunkt am Ende"), "Auftrag: Abschnitte als Zeile mit Doppelpunkt (App zeigt sie als Überschrift)");

// Kategorien
const k0 = await call("/api/kategorien");
ok(k0.d?.kategorien?.length === 8 && k0.d.kategorien[0].id === "vorspeise", "Standardkategorien");
const katBild = await call("/api/kategorie-bild?typ=image%2Fjpeg&name=k.jpg", { method: "PUT", body: new Uint8Array(500) });
ok(/^[a-z0-9]{24}$/.test(katBild.d?.id), "Kachelbild gespeichert");
ok((await call("/api/kategorie-bild?typ=application%2Fpdf", { method: "PUT", body: new Uint8Array(5) })).r.status === 415, "Kachelbild nur als Bild");
await call("/api/rezepte/katrez1", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ titel: "Tiramisu", zutaten: [], schritte: [], kategorien: ["dessert", "snack", "Böse!"] }) });
await call("/api/rezepte/katrez2", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ titel: "Brezel", zutaten: [], schritte: [], kategorien: ["snack"] }) });
ok((await call("/api/rezepte")).d.rezepte.find(x => x.id === "katrez1").kategorien.join() === "dessert,snack", "Rezept trägt Kategorien, ungültige id verworfen");
const liste1 = [...k0.d.kategorien.filter(k => k.id !== "snack" && k.id !== "dessert"), { id: "dessert", name: "Nachtisch", emoji: "🍮", bild: katBild.d.id }, { name: "Grillen", emoji: "🔥" }, { name: "" }];
const k1 = await call("/api/kategorien", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ kategorien: liste1, umziehen: { snack: "vorspeise" } }) });
const grill = k1.d?.kategorien?.find(k => k.name === "Grillen");
ok(k1.d.kategorien.length === 8 && /^k-[a-z0-9]{8}$/.test(grill?.id) && k1.d.kategorien.find(k => k.id === "dessert").name === "Nachtisch", "umbenannt, neue Kategorie bekommt id, leere verworfen");
const nach = (await call("/api/rezepte")).d.rezepte;
ok(nach.find(x => x.id === "katrez1").kategorien.join() === "dessert,vorspeise" && nach.find(x => x.id === "katrez2").kategorien.join() === "vorspeise", "gelöschte Kategorie: Rezepte ziehen in die gewählte um");
ok((await call("/api/kategorien")).d.kategorien.find(k => k.id === "dessert").bild === katBild.d.id, "Kategorien bleiben gespeichert, mit Bild");
await call("/api/kategorien", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ kategorien: k1.d.kategorien.filter(k => k.id !== "dessert") }) });
ok((await call("/api/rezepte")).d.rezepte.find(x => x.id === "katrez1").kategorien.join() === "vorspeise", "ohne Umzug: Kategorie fällt nur weg, Rezept bleibt");
ok(db0().prepare("SELECT COUNT(*) n FROM originale WHERE id = ?").get(katBild.d.id).n === 0, "Bild der gelöschten Kategorie ist weg");

// Vorschaubild
const vb = await call("/api/original/katrez2?typ=image%2Fpng&name=mein.png&vorschau=1", { method: "PUT", body: new Uint8Array(100) });
const vbId = vb.d?.rezept?.vorschau;
ok(/^[a-z0-9]{24}$/.test(vbId) && vb.d.rezept.originale[0].id === vbId, "Bild aus der Mediathek wird Vorschaubild");
const stale = await call("/api/rezepte/katrez2", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ titel: "Brezel", zutaten: [], schritte: [], originale: [], vorschau: vbId }) });
ok(stale.d.rezept.originale.length === 1 && stale.d.rezept.vorschau === vbId, "Speichern behält die Originale vom Server, auch wenn das Handy eine alte Liste schickt");
ok((await call("/api/rezepte/katrez2", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ titel: "Brezel", zutaten: [], schritte: [], vorschau: "-" }) })).d.rezept.vorschau === "-", "„kein Bild“ wird gespeichert");
ok(!("vorschau" in (await call("/api/rezepte/katrez2", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ titel: "Brezel", zutaten: [], schritte: [], vorschau: "a".repeat(24) }) })).d.rezept), "Vorschau auf fremdes Bild verworfen");
await call("/api/rezepte/katrez2", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ titel: "Brezel", zutaten: [], schritte: [], vorschau: vbId }) });
const del = await call("/api/original/katrez2/" + vbId, { method: "DELETE" });
ok(del.d?.rezept?.originale?.length === 0 && !("vorschau" in del.d.rezept) && db0().prepare("SELECT COUNT(*) n FROM originale WHERE id = ?").get(vbId).n === 0, "Original löschen: Daten, Eintrag und Vorschau weg");
ok((await call("/api/original/katrez1/" + vbId, { method: "DELETE" })).r.status === 404, "fremdes Original löschen: 404");
WEB["https://yummix.example/gateau.jpg"] = () => new Response(new Uint8Array(300), { headers: { "content-type": "image/jpeg" } });
WEB["https://yummix.example/seite.html"] = () => new Response("<html>", { headers: { "content-type": "text/html" } });
const vu = await call("/api/original-url/katrez2?url=" + encodeURIComponent("https://yummix.example/gateau.jpg") + "&vorschau=1", { method: "PUT" });
ok(vu.d?.rezept?.originale?.[0]?.name === "gateau.jpg" && vu.d.rezept.vorschau === vu.d.rezept.originale[0].id, "Bild der Webseite geholt und als Vorschau gesetzt");
ok((await call("/api/original-url/katrez2?url=" + encodeURIComponent("https://yummix.example/seite.html"), { method: "PUT" })).r.status === 415, "Adresse ohne Bild: 415");
ok((await call("/api/original-url/katrez2?url=ftp%3A%2F%2Fx", { method: "PUT" })).r.status === 400, "keine http-Adresse: 400");


// Sterne, gekocht, Kochliste
const bwr = (b) => call("/api/bewerten/katrez1", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
const vorBw = (await call("/api/rezepte")).d.rezepte.find(x => x.id === "katrez1").geaendert;
let bw = await bwr({ merken: true });
ok(typeof bw.d?.rezept?.merken === "number", "auf die Kochliste");
bw = await bwr({ gekocht: true, sterne: 4 });
ok(bw.d.rezept.sterne === 4 && bw.d.rezept.gekocht.length === 1 && !("merken" in bw.d.rezept), "gekocht + 4 Sterne, von der Kochliste genommen");
ok((await call("/api/rezepte")).d.rezepte.find(x => x.id === "katrez1").geaendert === vorBw, "Bewerten ändert „geaendert“ nicht (Liste springt nicht)");
await bwr({ gekocht: true });
ok((await bwr({ gekocht: false })).d.rezept.gekocht.length === 1, "letzten Eintrag zurücknehmen");
ok((await bwr({ sterne: 7 })).r.status === 400 && (await bwr({ sterne: 2.5 })).r.status === 400, "nur ganze Sterne 0–5");
const nachBw = await call("/api/rezepte/katrez1", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ titel: "Tiramisu", zutaten: [], schritte: [], sterne: 1, gekocht: [], merken: 5 }) });
ok(nachBw.d.rezept.sterne === 4 && nachBw.d.rezept.gekocht.length === 1 && !("merken" in nachBw.d.rezept), "Speichern des Rezepts lässt Sterne/gekocht/Kochliste vom Server stehen");
ok(!("sterne" in (await bwr({ sterne: 0 })).d.rezept), "Sterne 0 = Bewertung weg");
ok((await call("/api/bewerten/gibtsnicht", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).r.status === 404, "unbekanntes Rezept: 404");


// Wiederherstellen aus dem Rezeptbuch
const altR = { id: "wieder123", titel: "Omas Apfelkuchen", portionen: 1, portion_einheit: "Kuchen", zutaten: [{ name: "Äpfel", menge: 4, einheit: "" }], schritte: ["Teig:", "Kneten."],
  kategorien: ["backen"], sterne: 5, gekocht: [1700000000000, 1710000000000], merken: 1720000000000, erstellt: 1690000000000, geaendert: 1695000000000, vorschau: "x".repeat(24),
  originale: [{ id: "y".repeat(24), typ: "image/jpeg", name: "a.jpg", groesse: 3 }] };
const wh = await call("/api/wiederherstellen", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rezept: altR }) });
ok(wh.d?.rezept?.sterne === 5 && wh.d.rezept.gekocht.length === 2 && wh.d.rezept.merken === 1720000000000 && wh.d.rezept.erstellt === 1690000000000 && wh.d.rezept.geaendert === 1695000000000, "Wiederherstellen: Sterne, gekocht, Kochliste, Zeitpunkte bleiben");
ok(wh.d.rezept.originale.length === 0 && !("vorschau" in wh.d.rezept) && wh.d.rezept.schritte.join("|") === "Teig:|Kneten.", "alte Bild-ids verworfen (Bilder kommen einzeln neu)");
ok((await call("/api/wiederherstellen", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rezept: { ...altR, titel: "Überschreiben?" } }) })).r.status === 409, "vorhandenes Rezept wird nicht überschrieben");
const whb = await call("/api/original/wieder123?typ=image%2Fpng&name=a.png&vorschau=1&wieder=1", { method: "PUT", body: new Uint8Array(50) });
ok(whb.d.rezept.vorschau === whb.d.rezept.originale[0].id && whb.d.rezept.geaendert === 1695000000000, "Bild nachgeschickt als Vorschau, Reihenfolge (geaendert) bleibt");
const bildCors = await worker.fetch(new Request("https://w/bild/" + whb.d.rezept.vorschau), env);
ok(bildCors.status === 200 && bildCors.headers.get("access-control-allow-origin") === "*", "Bilder mit CORS-Freigabe (für das Rezeptbuch)");

// Gegenprobe: saeubern ohne Prüfung würde Mengen ohne Zahl durchlassen
ok(W.saeubern({ titel: "x", zutaten: [{ name: "a", menge: "viel" }], schritte: [] }).zutaten[0].menge === null, "Text als Menge wird null");

console.log(fehlerZahl ? `\n${fehlerZahl} Fehler` : "\nAlles grün");
process.exit(fehlerZahl ? 1 : 0);
