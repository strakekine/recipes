/* Recipes — Cloudflare Worker (Stufe 1: Import, Speichern, Bring!-Brücke, Testseite).
   Siehe CLAUDE.md. Bei Cloudflare als Modul-Worker einfügen.

   Bindings / Secrets (Settings → Variables and Secrets / Bindings):
     GEMINI_KEY     Secret, Schlüssel von aistudio.google.com
     FAMILIEN_CODE  Secret, selbst ausgedachtes Passwort für die App
     DB             D1-Datenbank (Tabellen legt der Worker selbst an)
     MODELL         optional, Text; Standard "gemini-flash-latest"

   Ablauf Import: Browser lädt jede Datei einzeln hoch (POST /api/datei → Gemini Files API),
   dann POST /api/rezept mit den Dateien und/oder Text. Videos braucht Gemini erst zum
   Verarbeiten: solange eine Datei noch PROCESSING ist, antwortet /api/rezept mit 202 und
   der Browser fragt nach 3 s wieder (so bleibt jeder Aufruf unter Cloudflares
   Abruf-Grenze, statt im Worker zu warten). */

const GEMINI = "https://generativelanguage.googleapis.com";
const APP_HERKUNFT = "https://strakekine.github.io";
const MAX_BYTES = 95 * 1024 * 1024;   // Cloudflare gratis: 100 MB je Anfrage
const IMPORTE_JE_TAG = 30;
const BRING_STUNDEN = 24;

export const GAENGE = ["Obst & Gemüse", "Brot & Backwaren", "Kühlregal", "Fleisch & Fisch",
  "Tiefkühl", "Nudeln, Reis & Trockenes", "Konserven & Gläser", "Gewürze, Öl & Saucen",
  "Backzutaten", "Getränke", "Sonstiges"];
export const EINHEITEN = ["g", "kg", "ml", "l", "EL", "TL", "Prise", "Msp", "Stück", "Dose",
  "Bund", "Zehe", "Becher", "Pck", "Scheibe", "Handvoll", ""];

export const AUFTRAG = `Du bekommst Material zu einem Kochrezept: ein Video (Ton UND Bild), Fotos, Screenshots, ein PDF oder Text. Mach daraus EIN Rezept auf Deutsch.

Regeln:
- Mengen NUR, wenn sie gesagt, eingeblendet oder geschrieben werden. Sonst menge = null und im hinweis, was gesagt wurde ("ein Schuss", "nach Gefühl") oder "Menge nicht genannt". Niemals Mengen erfinden oder schätzen.
- Keine Zutat erfinden. Was im Video benutzt, aber nicht genannt wird, darf rein, mit menge null und hinweis "im Video zu sehen".
- Gesprochenes zählt genauso wie Geschriebenes. Widersprechen sich Video und Beschreibung, nimm das Video und schreib den Widerspruch in die notiz.
- Amerikanische Maße (cup, oz, lb, tbsp, tsp, °F) in g, ml, EL, TL, °C umrechnen; das Original kommt in den hinweis.
- menge ist eine Zahl (0.5 statt "1/2"). Bei Spannen ("2 bis 3") menge = 2, menge_bis = 3.
- einheit ist genau eines dieser Kürzel, so geschrieben: ${EINHEITEN.filter(Boolean).join(", ")} — also "g" statt "Gramm", "EL" statt "Esslöffel". Leer nur, wenn es Stück ohne Wort ist ("2 Eier": menge 2, einheit leer). Die Einheit gehört NIE in den Namen ("60 g geriebener Parmesan": menge 60, einheit "g", name "geriebener Parmesan").
- name ist die Zutat ohne Menge, im Singular wo üblich ("Ei" bei einem, "Eier" bei mehreren ist auch in Ordnung).
- gang ist genau eine von: ${GAENGE.join(", ")}.
- gruppe nur, wenn das Rezept Zutaten aufteilt ("Für die Sauce"), sonst leer.
- portionen: die Menge, für die das Rezept gedacht ist, wie genannt ("für 4 Personen" → 4, "für 24 bis 28 Kräcker" → 26, "1 Kuchen" → 1). Wenn nicht genannt, schätzen und in die notiz schreiben "Portionen geschätzt".
- portion_einheit: wofür diese Zahl steht. "Personen", wenn es um Personen oder Portionen geht; sonst das Wort aus dem Rezept in der Mehrzahl ("Kräcker", "Stück", "Brötchen", "Kekse", "Gläser") oder Einzahl, wenn es nur eins ist ("Kuchen", "Brot", "Blech"). Nie Personen erfinden, wo das Rezept Stück nennt.
- zeit_min: Gesamtzeit in Minuten, wenn erkennbar, sonst null.
- bild_sekunde: nur bei einem Video — die Sekunde (vom Anfang des Videos gezählt), in der das fertige Gericht am schönsten und am größten zu sehen ist, möglichst ohne eingeblendeten Text. Das wird das Vorschaubild. Ohne Video oder ohne fertiges Gericht: null.
- schritte: kurz und klar, ein Arbeitsgang je Schritt, Zeiten und Temperaturen wörtlich übernehmen ("10 Minuten köcheln").
- Kommt der Inhalt einer Webseite mit (strukturierte Rezeptdaten oder Seitentext), übernimm Zutaten, Mengen und Schritte genau von dort.
- Steht nur ein Link oder ein Rezeptname da, ohne den Inhalt, dann das Rezept NICHT aus eigenem Wissen nachbauen: titel leer und in der notiz sagen, dass der Inhalt fehlt.
- kategorien: nur, wenn unten Kategorien zur Auswahl stehen — 1 oder 2 passende ids von dort, sonst leer.
- Ist gar kein Rezept zu erkennen, titel leer lassen und in der notiz sagen, warum.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    titel: { type: "STRING" },
    portionen: { type: "NUMBER", nullable: true },
    portion_einheit: { type: "STRING", description: "wofür die Zahl portionen steht: Personen, Kräcker, Stück, Kuchen …" },
    zeit_min: { type: "NUMBER", nullable: true },
    bild_sekunde: { type: "NUMBER", nullable: true, description: "nur bei Video: Sekunde mit dem schönsten Bild vom fertigen Gericht" },
    zutaten: { type: "ARRAY", items: { type: "OBJECT", properties: {
      gruppe: { type: "STRING" }, menge: { type: "NUMBER", nullable: true },
      menge_bis: { type: "NUMBER", nullable: true }, einheit: { type: "STRING", description: "Kürzel genau so geschrieben: " + EINHEITEN.filter(Boolean).join(", ") + " — oder leer" },
      name: { type: "STRING" }, gang: { type: "STRING" }, hinweis: { type: "STRING" } },
      required: ["name"] } },
    schritte: { type: "ARRAY", items: { type: "STRING" } },
    notiz: { type: "STRING" },
    kategorien: { type: "ARRAY", items: { type: "STRING" }, description: "ids aus der Kategorienliste im Auftrag" },
  },
  required: ["titel", "zutaten", "schritte"],
};

/* ---------- Hilfen ---------- */
const json = (o, status = 200, h = {}) => new Response(JSON.stringify(o), { status,
  headers: { "content-type": "application/json; charset=utf-8", ...h } });
const fehler = (text, status) => json({ fehler: text }, status);
const neueId = () => [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(36).padStart(2, "0")).join("").slice(0, 16);
const tagLux = (t = Date.now()) => new Date(t).toLocaleDateString("sv-SE", { timeZone: "Europe/Luxembourg" });
const str = (v, max) => typeof v === "string" ? v.trim().slice(0, max) : "";
const zahl = (v, lo, hi) => (typeof v === "number" && isFinite(v) && v >= lo && v <= hi) ? v : null;

function gleich(a, b){
  if(typeof a !== "string" || typeof b !== "string") return false;
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for(let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}

/* Am 08.11. kamen bei einem eingescannten Rezept alle Einheiten leer an („60 Parmesan“ statt „60 g“):
   Gemini schreibt Einheiten auch aus („Gramm“, „Esslöffel“). Darum hier alle üblichen Schreibweisen. */
const EINHEIT_ALIAS = { g: "g", gr: "g", gramm: "g", gram: "g", grams: "g", kg: "kg", kilo: "kg", kilogramm: "kg",
  ml: "ml", milliliter: "ml", cl: "cl", l: "l", liter: "l", el: "EL", essl: "EL", "esslöffel": "EL", essloeffel: "EL",
  tbsp: "EL", tl: "TL", teel: "TL", "teelöffel": "TL", teeloeffel: "TL", tsp: "TL", prise: "Prise", prisen: "Prise",
  msp: "Msp", messerspitze: "Msp", "stück": "Stück", stueck: "Stück", stk: "Stück", dose: "Dose", dosen: "Dose",
  bund: "Bund", zehe: "Zehe", zehen: "Zehe", becher: "Becher", pck: "Pck", pkg: "Pck", packung: "Pck",
  packungen: "Pck", "päckchen": "Pck", scheibe: "Scheibe", scheiben: "Scheibe", handvoll: "Handvoll" };
export function einheitAus(roh){
  const k = String(roh || "").trim().toLowerCase().replace(/\.$/, "");
  if(k === "cl") return null;                       // cl wird unten in ml umgerechnet
  return EINHEIT_ALIAS[k] ?? (EINHEITEN.includes(roh) ? roh : "");
}

/* Was die KI liefert, wird nie ungeprüft gespeichert. */
export function saeubern(o){
  if(!o || typeof o !== "object") return null;
  const zutaten = (Array.isArray(o.zutaten) ? o.zutaten : []).slice(0, 80).map(z => {
    if(!z || typeof z !== "object") return null;
    let name = str(z.name, 80); if(!name) return null;
    let menge = zahl(z.menge, 0, 100000), bis = zahl(z.menge_bis, 0, 100000);
    let roh = z.einheit;
    /* Einheit im Namen gelandet („g geriebener Parmesan“, „EL Butter“)? */
    if(!str(roh, 20) && menge != null){
      const w = name.match(/^(\S+)\s+(.+)$/);
      if(w && EINHEIT_ALIAS[w[1].toLowerCase().replace(/\.$/, "")]){ roh = w[1]; name = w[2]; }
    }
    if(String(roh || "").trim().toLowerCase().replace(/\.$/, "") === "cl"){ roh = "ml"; if(menge != null) menge *= 10; if(bis != null) bis *= 10; }
    if(menge === 0) menge = null;
    if(menge == null || bis == null || bis <= menge) bis = null;
    const einheit = einheitAus(roh) || "";
    const r = { menge, einheit, name, gang: GAENGE.includes(z.gang) ? z.gang : "Sonstiges" };
    if(bis != null) r.menge_bis = bis;
    const g = str(z.gruppe, 60); if(g) r.gruppe = g;
    const h = str(z.hinweis, 120); if(h) r.hinweis = h;
    /* Eine Einheit, die ohne Menge dasteht ("EL Öl"), ist eine erfundene Genauigkeit. */
    if(menge == null && einheit && !r.hinweis) r.hinweis = "Menge nicht genannt";
    return r;
  }).filter(Boolean);
  return {
    titel: str(o.titel, 120),
    portionen: zahl(o.portionen, 1, 500),
    portion_einheit: str(o.portion_einheit, 30) || "Personen",
    zeit_min: zahl(o.zeit_min, 1, 7 * 24 * 60),
    ...(zahl(o.bild_sekunde, 0, 3600) != null ? { bild_sekunde: zahl(o.bild_sekunde, 0, 3600) } : {}),
    zutaten,
    schritte: (Array.isArray(o.schritte) ? o.schritte : []).map(s => str(s, 1000)).filter(Boolean).slice(0, 60),
    notiz: str(o.notiz, 1000),
    quelle: str(o.quelle, 500),
    originale: (Array.isArray(o.originale) ? o.originale : []).filter(x => x && /^[a-z0-9]{24}$/.test(x.id) && ORIGINAL_TYPEN.test(x.typ))
      .slice(0, ORIGINALE_JE_REZEPT).map(x => ({ id: x.id, typ: x.typ, name: str(x.name, 100), groesse: zahl(x.groesse, 1, ORIGINAL_MAX) })),
    kategorien: [...new Set((Array.isArray(o.kategorien) ? o.kategorien : []).filter(k => typeof k === "string" && KAT_ID.test(k)))].slice(0, 5),
    ...(typeof o.vorschau === "string" && /^([a-z0-9]{24}|-)$/.test(o.vorschau) ? { vorschau: o.vorschau } : {}),
  };
}

/* ---------- Rezept aus einem Link ----------
   Befund 08.11.: ein Link zu yummix.fr kam als Rezept ohne Mengen zurück — der Worker hatte die Seite gar nicht
   gelesen, Gemini baute das Rezept aus dem Namen nach. Jetzt holt der Worker die Seite selbst. Fast alle
   Rezeptseiten tragen ein schema.org/Recipe (JSON-LD) für Google; das ist genau und braucht keine Raterei.
   Fehlt es, bekommt Gemini den Seitentext. Instagram/Facebook/TikTok sperren Server ohne Anmeldung (am 08.11.
   geprüft: 403) — dort gleich ein klarer Hinweis statt eines nachgebauten Rezepts. */
export const SOZIAL = /^https?:\/\/(?:[\w-]+\.)*(?:instagram\.com|facebook\.com|fb\.com|fb\.watch|tiktok\.com|threads\.net)(?:[\/?#]|$)/i;
export const linksAus = text => [...new Set((String(text || "").match(/https?:\/\/[^\s<>"']+/g) || []).map(l => l.replace(/[).,;:!?»“”]+$/, "")))];
const SEITE_MAX = 3 * 1024 * 1024;
const LESER = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const BENANNT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  laquo: "«", raquo: "»", hellip: "…", ndash: "–", mdash: "—", deg: "°", frac12: "½", frac14: "¼", frac34: "¾", szlig: "ß",
  oelig: "œ", OElig: "Œ", aelig: "æ", times: "×" };
const AKZENT = { acute: "\u0301", grave: "\u0300", circ: "\u0302", uml: "\u0308", cedil: "\u0327", tilde: "\u0303", ring: "\u030a" };
const entities = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (all, e) => {
  if(e[0] === "#") { const n = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return ""; } }
  if(e in BENANNT) return BENANNT[e];
  const m = e.match(/^([a-zA-Z])(acute|grave|circ|uml|cedil|tilde|ring)$/);   // &eacute; &Uuml; &ccedil; …
  return m ? (m[1] + AKZENT[m[2]]).normalize("NFC") : all;
});
const ohneTags = s => entities(String(s ?? "").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
const istTyp = (o, t) => o && typeof o === "object" && [].concat(o["@type"] || []).some(x => String(x).toLowerCase() === t);

export function rezeptAusLd(html){
  const bloecke = [...String(html).matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)];
  const suche = (o, tiefe = 0) => {
    if(!o || typeof o !== "object" || tiefe > 6) return null;
    if(Array.isArray(o)){ for(const x of o){ const f = suche(x, tiefe + 1); if(f) return f; } return null; }
    if(istTyp(o, "recipe")) return o;
    for(const k of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement", "item"]){ const f = suche(o[k], tiefe + 1); if(f) return f; }
    return null;
  };
  for(const b of bloecke){
    let o; try { o = JSON.parse(b[1].trim().replace(/^<!--|-->$/g, "")); } catch { continue; }
    const f = suche(o); if(f) return f;
  }
  return null;
}
const dauer = d => { const m = String(d || "").match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i); if(!m) return "";
  const min = (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0); return min ? min + " Minuten" : ""; };
export function ldAlsText(ld){
  const z = [];
  const name = ohneTags(ld.name); if(name) z.push("Titel: " + name);
  const ergibt = [].concat(ld.recipeYield || []).map(ohneTags).filter(Boolean); if(ergibt.length) z.push("Ergibt: " + ergibt.join(" / "));
  const zeit = dauer(ld.totalTime) || dauer(ld.cookTime); if(zeit) z.push("Gesamtzeit: " + zeit);
  const zut = [].concat(ld.recipeIngredient || ld.ingredients || []).map(ohneTags).filter(Boolean);
  z.push("Zutaten:"); for(const x of zut) z.push("- " + x);
  const schritte = [];
  const lauf = (s, abschnitt) => {
    if(!s) return;
    if(typeof s === "string"){ for(const t of s.split(/\n+/)) if(ohneTags(t)) schritte.push(ohneTags(t)); return; }
    if(Array.isArray(s)){ for(const x of s) lauf(x, abschnitt); return; }
    if(istTyp(s, "howtosection")){ schritte.push("[" + ohneTags(s.name) + "]"); lauf(s.itemListElement, true); return; }
    const t = ohneTags(s.text || s.name || ""); if(t) schritte.push(t);
  };
  lauf(ld.recipeInstructions);
  z.push("Schritte:"); schritte.forEach((t, i) => z.push((i + 1) + ". " + t));
  const besch = ohneTags(ld.description); if(besch) z.push("Beschreibung: " + besch.slice(0, 500));
  return z.join("\n").slice(0, 30000);
}
export function ldBild(ld){
  let b = ld?.image; if(Array.isArray(b)) b = b[0];
  if(b && typeof b === "object") b = b.url || b.contentUrl;
  return typeof b === "string" && /^https?:\/\//.test(b) ? b : "";
}
export function seitenText(html){
  const s = String(html).replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/li|\/h\d|\/div|\/tr)[^>]*>/gi, "\n");
  return entities(s.replace(/<[^>]*>/g, " ")).replace(/[ \t\r\f\v]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{2,}/g, "\n").trim().slice(0, 40000);
}
const metaBild = html => { const m = String(html).match(/<meta[^>]+property=["']og:image["'][^>]*>/i); const c = m && m[0].match(/content=["']([^"']+)["']/i);
  return c && /^https?:\/\//.test(entities(c[1])) ? entities(c[1]) : ""; };

/* Holt eine Rezeptseite. Liefert { text, bild, art: "ld"|"text" } oder wirft mit verständlichem Grund. */
export async function seiteLesen(url){
  let r;
  try { r = await fetch(url, { headers: { "user-agent": LESER, accept: "text/html,application/xhtml+xml", "accept-language": "de,fr;q=0.8,en;q=0.6" },
    redirect: "follow", signal: AbortSignal.timeout(15000) }); }
  catch(err){ throw new Error(err?.name === "TimeoutError" ? "keine Antwort nach 15 s" : "nicht erreichbar"); }
  if(!r.ok) throw new Error("die Seite antwortet mit " + r.status + (r.status === 403 ? " (sperrt Server aus)" : ""));
  const typ = r.headers.get("content-type") || "";
  if(typ && !/html|xml|text\/plain/i.test(typ)) throw new Error("das ist keine Webseite (" + typ.split(";")[0] + ")");
  const html = (await r.text()).slice(0, SEITE_MAX);
  const ld = rezeptAusLd(html);
  if(ld) return { art: "ld", text: ldAlsText(ld), bild: ldBild(ld) || metaBild(html) };
  const text = seitenText(html);
  if(text.length < 200) throw new Error("auf der Seite steht kaum Text (vielleicht nur mit Anmeldung lesbar)");
  return { art: "text", text, bild: metaBild(html) };
}

/* ---------- Kategorien ----------
   Gemeinsame Liste für die ganze Familie, auf dem Server (Tabelle einstellungen), selbst bearbeitbar.
   Ein Rezept trägt ids in rezept.kategorien. Kachelbilder liegen wie Originale in D1 (rezept = "kategorie"). */
export const KAT_ID = /^[a-z0-9-]{1,30}$/;
export const STANDARD_KATEGORIEN = [
  { id: "vorspeise", name: "Vorspeise", emoji: "🥗" }, { id: "hauptgericht", name: "Hauptgericht", emoji: "🍝" },
  { id: "beilage", name: "Beilage", emoji: "🥔" }, { id: "dessert", name: "Dessert", emoji: "🍰" },
  { id: "backen", name: "Backen", emoji: "🥐" }, { id: "snack", name: "Snack", emoji: "🥨" },
  { id: "getraenk", name: "Getränk", emoji: "🍹" }, { id: "fruehstueck", name: "Frühstück", emoji: "🍳" }];
const KATEGORIEN_MAX = 40;
export function katSaeubern(liste){
  const ids = new Set();
  return (Array.isArray(liste) ? liste : []).map(k => {
    if(!k || typeof k !== "object") return null;
    const name = str(k.name, 30); if(!name) return null;
    let id = typeof k.id === "string" && KAT_ID.test(k.id) ? k.id : "k-" + zufall(8);
    if(ids.has(id)) id = "k-" + zufall(8);
    ids.add(id);
    const r = { id, name, emoji: [...str(k.emoji, 16)].slice(0, 4).join("") };
    if(typeof k.bild === "string" && /^[a-z0-9]{24}$/.test(k.bild)) r.bild = k.bild;
    return r;
  }).filter(Boolean).slice(0, KATEGORIEN_MAX);
}
async function katLesen(db){
  const z = await db.prepare("SELECT wert FROM einstellungen WHERE schluessel = 'kategorien'").first();
  if(!z) return STANDARD_KATEGORIEN;
  try { return katSaeubern(JSON.parse(z.wert)); } catch { return STANDARD_KATEGORIEN; }
}
async function kategorien(env, request){
  const db = env.DB;
  if(request.method === "GET") return json({ kategorien: await katLesen(db) });
  if(request.method !== "PUT") return fehler("Methode nicht erlaubt.", 405);
  const e = await request.json().catch(() => null);
  if(!e || !Array.isArray(e.kategorien)) return fehler("Keine Kategorienliste.", 400);
  const alt = await katLesen(db), neu = katSaeubern(e.kategorien);
  const neuIds = new Set(neu.map(k => k.id));
  const umziehen = e.umziehen && typeof e.umziehen === "object" ? e.umziehen : {};
  const weg = alt.filter(k => !neuIds.has(k.id)).map(k => k.id);
  if(weg.length){
    /* Gelöschte Kategorie: ihre Rezepte bleiben, verlieren nur die Kategorie — oder ziehen in die gewählte um. */
    const r = await db.prepare("SELECT id, daten FROM rezepte").all();
    for(const z of r.results || []){
      const d = JSON.parse(z.daten);
      const k = Array.isArray(d.kategorien) ? d.kategorien : [];
      if(!k.some(x => weg.includes(x))) continue;
      d.kategorien = [...new Set(k.flatMap(x => !weg.includes(x) ? [x] : neuIds.has(umziehen[x]) ? [umziehen[x]] : []))];
      await db.prepare("UPDATE rezepte SET daten = ? WHERE id = ?").bind(JSON.stringify(d), z.id).run();
    }
  }
  const neuBilder = new Set(neu.map(k => k.bild).filter(Boolean));
  for(const k of alt) if(k.bild && !neuBilder.has(k.bild))
    await db.prepare("DELETE FROM originale WHERE id = ? AND rezept = 'kategorie'").bind(k.bild).run();
  await db.prepare("INSERT INTO einstellungen (schluessel, wert) VALUES ('kategorien', ?) ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert")
    .bind(JSON.stringify(neu)).run();
  return json({ kategorien: neu });
}

const YOUTUBE = /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)[\w-]{6,}[^\s]*/i;

/* ---------- Datenbank ---------- */
async function tabellen(db){
  await db.prepare("CREATE TABLE IF NOT EXISTS rezepte (id TEXT PRIMARY KEY, daten TEXT NOT NULL, geaendert INTEGER NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS bring (id TEXT PRIMARY KEY, daten TEXT NOT NULL, bis INTEGER NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS importe (tag TEXT PRIMARY KEY, n INTEGER NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS protokoll (t INTEGER NOT NULL, was TEXT NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS ergebnisse (id TEXT PRIMARY KEY, daten TEXT NOT NULL, t INTEGER NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS originale (id TEXT NOT NULL, nr INTEGER NOT NULL, rezept TEXT NOT NULL, typ TEXT NOT NULL, name TEXT, daten BLOB NOT NULL, t INTEGER NOT NULL, PRIMARY KEY (id, nr))").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS einstellungen (schluessel TEXT PRIMARY KEY, wert TEXT NOT NULL)").run();
}

/* Kurzes Protokoll der Importe (sichtbar unten auf der Testseite): zeigt, ob die KI fertig
   wurde, wie lange sie brauchte und was schiefging — ohne Cloudflare-Logs. */
async function notiere(env, was){
  if(!env.DB) return;
  try {
    await tabellen(env.DB);
    await env.DB.prepare("INSERT INTO protokoll (t, was) VALUES (?, ?)").bind(Date.now(), String(was).slice(0, 500)).run();
    await env.DB.prepare("DELETE FROM protokoll WHERE t < ?").bind(Date.now() - 14 * 864e5).run();
  } catch {}
}

/* ---------- Gemini ---------- */
const DATEIART = /^(image\/|video\/|application\/pdf$|audio\/)/;
const MAX_DIREKT = 1024 * 1024 * 1024;   // direkt vom Handy zu Gemini: bis 1 GB

/* Am 08.11. lehnte Gemini ein gekürztes iPhone-Video (.mov = video/quicktime) mit „invalid argument“ ab,
   das ungekürzte .mp4 nicht. Gemini führt .mov als video/mov. */
export const geminiMime = m => ({ "video/quicktime": "video/mov", "video/x-m4v": "video/mp4", "image/jpg": "image/jpeg" })[m] || m;

async function uploadSitzung(env, len, mime, name){
  mime = geminiMime(mime);
  const start = await fetch(GEMINI + "/upload/v1beta/files", { method: "POST", headers: {
    "x-goog-api-key": env.GEMINI_KEY, "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start",
    "X-Goog-Upload-Header-Content-Length": String(len), "X-Goog-Upload-Header-Content-Type": mime,
    "content-type": "application/json" }, body: JSON.stringify({ file: { display_name: str(name, 100) || "rezept" } }) });
  const url = start.headers.get("x-goog-upload-url");
  if(!start.ok || !url) return { fehler: "Gemini nimmt keine Datei an (" + start.status + "): " + (await start.text()).slice(0, 300) };
  return { url };
}

/* Bevorzugt: das Handy lädt selbst zu Gemini hoch (Google erlaubt das per CORS). Der Worker
   holt nur die Upload-Adresse; sie enthält eine Sitzungsnummer, nicht den Schlüssel. So hängt
   ein langes Video nicht an Cloudflares 100-s-Grenze (Fehler 524) und nicht an 100 MB. */
async function uploadStarten(env, url){
  const len = Number(url.searchParams.get("groesse"));
  const mime = str(url.searchParams.get("typ"), 100);
  if(!(len > 0)) return fehler("Leere Datei.", 400);
  if(len > MAX_DIREKT) return fehler("Datei zu groß (über 1 GB).", 413);
  if(!DATEIART.test(mime)) return fehler("Diese Dateiart geht nicht: " + (mime || "unbekannt"), 415);
  const r = await uploadSitzung(env, len, mime, url.searchParams.get("name"));
  return r.fehler ? fehler(r.fehler, 502) : json({ url: r.url });
}

/* Rückfall: durch den Worker durchgereicht (falls das direkte Hochladen scheitert). */
async function hochladen(env, request, name){
  const len = Number(request.headers.get("content-length"));
  const mime = (request.headers.get("content-type") || "").split(";")[0].trim();
  if(!(len > 0)) return fehler("Leere Datei.", 400);
  if(len > MAX_BYTES) return fehler("Datei zu groß (über 95 MB). Bildschirmaufnahme kürzer machen.", 413);
  if(!DATEIART.test(mime)) return fehler("Diese Dateiart geht nicht: " + (mime || "unbekannt"), 415);
  const sitzung = await uploadSitzung(env, len, mime, name);
  if(sitzung.fehler) return fehler(sitzung.fehler, 502);
  const url = sitzung.url;
  let body = request.body;
  /* Durchreichen ohne Zwischenspeicher; die Länge muss Gemini vorher kennen. */
  if(typeof FixedLengthStream === "function"){
    const f = new FixedLengthStream(len); request.body.pipeTo(f.writable); body = f.readable;
  }
  const up = await fetch(url, { method: "POST", headers: { "content-length": String(len),
    "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" }, body });
  const r = await up.json().catch(() => null);
  if(!up.ok || !r?.file?.uri) return fehler("Hochladen zu Gemini fehlgeschlagen (" + up.status + ").", 502);
  return json({ datei: { name: r.file.name, uri: r.file.uri, mime: r.file.mimeType || mime } });
}

async function rezeptMachen(env, request, ctx){
  const e = await request.json().catch(() => null);
  if(!e) return fehler("Kein gültiger Auftrag.", 400);
  const dateien = (Array.isArray(e.dateien) ? e.dateien : []).slice(0, 10)
    .filter(d => d && /^files\/[\w-]+$/.test(d.name) && typeof d.uri === "string" && d.uri.startsWith(GEMINI + "/"));
  const text = str(e.text, 20000);
  if(!dateien.length && !text) return fehler("Nichts zum Auswerten: Datei wählen oder Text einfügen.", 400);

  /* Videos: erst wenn Gemini sie fertig verarbeitet hat. */
  for(const d of dateien){
    const s = await fetch(GEMINI + "/v1beta/" + d.name, { headers: { "x-goog-api-key": env.GEMINI_KEY } });
    const f = await s.json().catch(() => null);
    if(!s.ok) return fehler("Datei bei Gemini nicht gefunden (" + s.status + "). Bitte neu hochladen.", 502);
    if(f.state === "FAILED") return fehler("Gemini konnte die Datei nicht lesen.", 422);
    if(f.state !== "ACTIVE") return json({ warten: true }, 202);
  }

  /* Links: Webseite lesen, soziale Netzwerke gleich mit Hinweis abweisen (siehe „Rezept aus einem Link“). */
  const links = linksAus(text).filter(l => !YOUTUBE.test(l));
  const rest = links.reduce((t, l) => t.split(l).join(" "), text.replace(YOUTUBE, " ")).replace(/\s+/g, " ").trim();
  const nurLinks = !dateien.length && !YOUTUBE.test(text) && rest.length < 40;
  const webLinks = links.filter(l => !SOZIAL.test(l));
  if(nurLinks && links.length && !webLinks.length)
    return fehler("Instagram, Facebook und TikTok lassen keine Server rein. Mach eine Bildschirmaufnahme vom Video (mit Ton) oder kopier die Beschreibung unter dem Video hier rein.", 422);
  let seite = null, seiteFehler = "";
  if(webLinks.length){
    try { seite = await seiteLesen(webLinks[0]); }
    catch(err){ seiteFehler = String(err?.message || err).slice(0, 160); }
    await notiere(env, seite ? "Seite gelesen (" + (seite.art === "ld" ? "Rezeptdaten" : "Seitentext") + "): " + webLinks[0].slice(0, 120)
      : "✗ Seite nicht lesbar (" + seiteFehler + "): " + webLinks[0].slice(0, 120));
    if(!seite && nurLinks)
      return fehler("Die Seite ließ sich nicht lesen: " + seiteFehler + ". Mach einen Screenshot vom Rezept oder kopier den Rezepttext hier rein.", 422);
  }
  const db = env.DB;
  const katListe = db ? (await tabellen(db), await katLesen(db)) : [];
  if(db){
    const tag = tagLux();
    const z = await db.prepare("SELECT n FROM importe WHERE tag = ?").bind(tag).first();
    if(z && z.n >= IMPORTE_JE_TAG) return fehler("Für heute sind " + IMPORTE_JE_TAG + " Importe erreicht. Morgen geht es weiter.", 429);
    await db.prepare("INSERT INTO importe (tag, n) VALUES (?, 1) ON CONFLICT(tag) DO UPDATE SET n = n + 1").bind(tag).run();
  }

  const parts = dateien.map(d => ({ file_data: { mime_type: geminiMime(d.mime), file_uri: d.uri } }));
  const video = dateien.some(d => /^video\//.test(d.mime));
  const auftrag = /^[\w-]{8,40}$/.test(e.auftrag || "") ? e.auftrag : "";
  const yt = text.match(YOUTUBE);
  if(yt) parts.push({ file_data: { file_uri: yt[0] } });     // YouTube kann Gemini selbst ansehen
  parts.push({ text: AUFTRAG
    + (katListe.length ? "\n\nKategorien zur Auswahl (id = Name): " + katListe.map(k => k.id + " = " + k.name).join(", ") : "")
    + (text ? "\n\nText vom Nutzer (Beschreibung, Link oder Rezept):\n" + text : "")
    + (seite ? "\n\n" + (seite.art === "ld" ? "Rezeptdaten der verlinkten Webseite (genau übernehmen):\n" : "Text der verlinkten Webseite:\n") + seite.text
      : seiteFehler ? "\n\n(Die verlinkte Seite ließ sich nicht lesen. Nichts von dort erfinden.)" : "") });
  const extra = { katIds: katListe.map(k => k.id), bild: seite?.bild || "" };

  const modell = str(env.MODELL, 80) || "gemini-flash-latest";
  /* Die KI braucht bei Videos gern über eine Minute. Cloudflare bricht nach 100 s ohne
     Antwort ab (524). Darum geht die Antwort sofort los und bekommt alle 10 s ein Leerzeichen
     als Lebenszeichen; das Rezept (oder {fehler}) folgt am Ende. JSON verträgt Leerzeichen davor. */
  const { readable, writable } = new TransformStream();
  const w = writable.getWriter(), enc = new TextEncoder();
  const lebe = () => { w.write(enc.encode(" ")).catch(() => {}); };
  lebe();                                           // erstes Byte sofort
  const takt = setInterval(lebe, 5000);
  const t0 = Date.now();
  const was = dateien.map(d => d.mime).join(", ") || "nur Text";
  await notiere(env, "KI gestartet (" + modell + ", " + was + ")");
  const arbeit = (async () => {
    let aus;
    try { aus = await generieren(env, modell, parts, text, video, extra); }
    catch(err){ aus = { fehler: "Fehler im Worker: " + String(err?.message || err).slice(0, 300) }; }
    clearInterval(takt);
    const s = Math.round((Date.now() - t0) / 1000);
    await notiere(env, aus.fehler ? "✗ nach " + s + " s: " + aus.fehler : "✓ nach " + s + " s (" + aus.modell + ", erste Antwort nach " + aus.erstes + " s): " + (aus.rezept?.titel || "(ohne Titel)") + ", " + (aus.rezept?.zutaten?.length || 0) + " Zutaten");
    /* Das Ergebnis bleibt einen Tag abholbar: Reißt die Verbindung zum Handy ab (am 08.11. nach ~2 min
       „Load failed“, während der Worker das Rezept noch fertig bekam), fragt die Seite hier nach. */
    if(auftrag && env.DB){
      try {
        await env.DB.prepare("INSERT OR REPLACE INTO ergebnisse (id, daten, t) VALUES (?, ?, ?)").bind(auftrag, JSON.stringify(aus), Date.now()).run();
        await env.DB.prepare("DELETE FROM ergebnisse WHERE t < ?").bind(Date.now() - 864e5).run();
      } catch {}
    }
    try { await w.write(enc.encode(JSON.stringify(aus))); await w.close(); }
    catch(err){ await notiere(env, "✗ Antwort ging nicht mehr ans Handy raus: " + String(err?.message || err).slice(0, 200)); }
  })();
  if(ctx?.waitUntil) ctx.waitUntil(arbeit);
  return new Response(readable, { headers: { "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, no-transform" } });
}

/* Erfahrung vom 08.11. (erstes echtes Reel, 50 MB): einmal 503 „high demand“, einmal 524 nach 125 s —
   Cloudflare bricht einen Abruf ab, der 100 s lang keine Daten liefert, und das Modell dachte bei einem
   Video so lange nach. Darum:
   - Denken aus (thinkingBudget 0): Zutaten aus einem Video abschreiben braucht kein Nachdenken, und das
     Denken war es, was so lange dauerte. Fassung e hatte stattdessen die Denk-Teile mitgestreamt — danach
     brach am 08.11. nach ~2 min die Verbindung zum Handy ab („Load failed“), ohne Eintrag im Protokoll.
     Nimmt ein Modell thinkingBudget 0 nicht an (400), derselbe Versuch ohne diese Einstellung.
   - streamGenerateContent (SSE): sobald Gemini schreibt, fließen Daten; gezählt wird nur Text ohne thought.
   - mediaResolution LOW: weniger Bildpunkte je Videobild, der Ton bleibt gleich. Bei Kochvideos steckt
     das Rezept im Ton und in eingeblendeten Texten, die auch niedrig aufgelöst lesbar sind.
   - Ist das Modell überlastet oder bricht ab, ein zweiter Versuch mit dem leichteren Modell. */
const ERSATZ_MODELL = "gemini-flash-lite-latest";
const NOCHMAL = [429, 500, 502, 503, 504, 524];

async function einVersuch(env, modell, parts, video = false, ohneDenken = true){
  const t0 = Date.now();
  const g = await fetch(GEMINI + "/v1beta/models/" + encodeURIComponent(modell) + ":streamGenerateContent?alt=sse", {
    method: "POST", headers: { "x-goog-api-key": env.GEMINI_KEY, "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: SCHEMA,
        ...(video ? { mediaResolution: "MEDIA_RESOLUTION_LOW" } : {}), ...(ohneDenken ? { thinkingConfig: { thinkingBudget: 0 } } : {}) } }) });
  if(!g.ok){
    const a = await g.json().catch(() => null);
    const text = str(a?.error?.message || a?.[0]?.error?.message, 300);
    if(g.status === 400 && ohneDenken){
      await notiere(env, "↻ " + modell + ": 400 (" + text.slice(0, 120) + ") → nochmal ohne Denk-Einstellung");
      return einVersuch(env, modell, parts, video, false);
    }
    return { status: g.status, fehler: "Gemini-Fehler (" + g.status + ", " + modell + "): " + text };
  }
  let erstes = 0;
  const leser = g.body.getReader(), dec = new TextDecoder();
  let puffer = "", roh = "", grund = "";
  const zeile = l => {
    if(!l.startsWith("data:")) return;
    let o; try { o = JSON.parse(l.slice(5).trim()); } catch { return; }
    if(o.error) throw new Error(str(o.error.message, 300));
    if(!erstes) erstes = Math.round((Date.now() - t0) / 1000);
    const k = o.candidates?.[0];
    for(const t of k?.content?.parts || []) if(!t.thought && typeof t.text === "string") roh += t.text;
    if(k?.finishReason) grund = k.finishReason;
  };
  for(;;){
    const { done, value } = await leser.read();
    if(value) puffer += dec.decode(value, { stream: true });
    let i; while((i = puffer.indexOf("\n")) >= 0){ zeile(puffer.slice(0, i).trim()); puffer = puffer.slice(i + 1); }
    if(done){ zeile(puffer.trim()); break; }
  }
  return { roh, grund, erstes };
}

/* Befund 08.11.: bei einem 50-MB-Reel lief gemini-flash-latest zweimal über 100 s in den 524, das leichte
   Modell lieferte danach in rund 14 s ein brauchbares Rezept (9 Zutaten). Darum bei Videos das leichte zuerst. */
async function generieren(env, modell, parts, text, video, extra = {}){
  const modelle = [...new Set(video ? [ERSATZ_MODELL, modell] : [modell, ERSATZ_MODELL])];
  let r;
  for(const [i, m] of modelle.entries()){
    try { r = await einVersuch(env, m, parts, video); }
    catch(err){ r = { status: 500, fehler: "Gemini brach ab (" + m + "): " + String(err?.message || err).slice(0, 200) }; }
    if(!r.fehler){ modell = m; break; }
    if(!NOCHMAL.includes(r.status) || i === modelle.length - 1) return { fehler: r.fehler };
    await notiere(env, "↻ " + r.fehler.slice(0, 160) + " → nochmal mit " + modelle[i + 1]);
  }
  let o; try { o = JSON.parse(r.roh); }
  catch { return { fehler: "Gemini hat kein lesbares Rezept geliefert" + (r.grund && r.grund !== "STOP" ? " (" + r.grund + ")" : "") + "." }; }
  const rezept = saeubern(o);
  if(!rezept) return { fehler: "Gemini hat kein lesbares Rezept geliefert." };
  const quelle = text.match(/https?:\/\/\S+/);
  if(quelle && !rezept.quelle) rezept.quelle = quelle[0].slice(0, 500);
  rezept.kategorien = rezept.kategorien.filter(k => (extra.katIds || []).includes(k)).slice(0, 2);
  if(extra.bild) rezept.bild_url = extra.bild.slice(0, 1000);   // Bild der Webseite: die App holt es nach dem Speichern
  return { rezept, modell, erstes: r.erstes };
}

/* ---------- Bring! ----------
   Bring!s Import liest eine Webseite mit schema.org/Recipe. Unsere Liste wird darum kurz
   als solche Seite bereitgestellt (öffentlich, zufällige id, 24 h), und die App öffnet
   Bring!s Deeplink-Dienst mit dieser Adresse. */
async function bringAnlegen(env, request, basis){
  const e = await request.json().catch(() => null);
  const zeilen = (Array.isArray(e?.zeilen) ? e.zeilen : []).map(z => str(z, 120)).filter(Boolean).slice(0, 150);
  if(!zeilen.length) return fehler("Die Liste ist leer.", 400);
  const id = neueId();
  await env.DB.prepare("INSERT INTO bring (id, daten, bis) VALUES (?, ?, ?)")
    .bind(id, JSON.stringify({ titel: str(e.titel, 80) || "Einkauf", zeilen }), Date.now() + BRING_STUNDEN * 3600e3).run();
  await env.DB.prepare("DELETE FROM bring WHERE bis < ?").bind(Date.now()).run();
  const seite = basis + "/bring/" + id;
  return json({ seite, link: "https://api.getbring.com/rest/bringrecipes/deeplink?url=" + encodeURIComponent(seite) + "&source=web" });
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function bringSeite(env, id){
  if(!env.DB) return new Response("Keine Datenbank.", { status: 503 });
  await tabellen(env.DB);
  const r = await env.DB.prepare("SELECT daten, bis FROM bring WHERE id = ?").bind(id).first();
  if(!r || r.bis < Date.now()) return new Response("Diese Liste ist abgelaufen.", { status: 404 });
  const d = JSON.parse(r.daten);
  const ld = { "@context": "https://schema.org", "@type": "Recipe", name: d.titel, recipeYield: "1", recipeIngredient: d.zeilen };
  return new Response(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(d.titel)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script></head>
<body><h1>${esc(d.titel)}</h1><ul>${d.zeilen.map(z => "<li>" + esc(z) + "</li>").join("")}</ul></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

/* ---------- Originale (Foto/PDF zum Rezept) ----------
   Vom Nutzer gewünscht (08.11.2026): das eingescannte Rezept samt Handnotizen soll mit dem Rezept bleiben.
   Liegt in D1 (keine Extra-Einrichtung; R2 bräuchte eine Kreditkarte bei Cloudflare), als BLOB in Stücken zu
   400 KB, weil D1 eine Zeile auf 2 MB begrenzt. Höchstens 2 MB je Datei — Fotos verkleinert die App vorher,
   Videos werden nicht gespeichert (dort ist der Link zum Reel das Original). Abruf über /bild/<id> ohne Code,
   damit <img> und Links funktionieren; die id ist zufällig (24 Zeichen) und nicht zu erraten. */
const ORIGINAL_MAX = 2 * 1024 * 1024;
const ORIGINAL_STUECK = 400 * 1024;
const ORIGINALE_JE_REZEPT = 5;
const ORIGINAL_TYPEN = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;
const zufall = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

async function bytesSpeichern(db, besitzer, typ, name, bytes){
  const id = zufall(24), jetzt = Date.now(), befehle = [];
  for(let nr = 0, ab = 0; ab < bytes.length; nr++, ab += ORIGINAL_STUECK)
    befehle.push(db.prepare("INSERT INTO originale (id, nr, rezept, typ, name, daten, t) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, nr, besitzer, typ, name, bytes.slice(ab, ab + ORIGINAL_STUECK), jetzt));
  if(db.batch) await db.batch(befehle); else for(const b of befehle) await b.run();
  return id;
}
function bytesPruefen(typ, bytes){
  if(!ORIGINAL_TYPEN.test(typ)) return fehler("Diese Dateiart wird nicht als Original gespeichert: " + (typ || "unbekannt"), 415);
  if(!bytes.length) return fehler("Leere Datei.", 400);
  if(bytes.length > ORIGINAL_MAX) return fehler("Original zu groß (über 2 MB), nicht gespeichert.", 413);
  return null;
}
async function rezeptHolen(db, rid){
  const zeile = await db.prepare("SELECT daten FROM rezepte WHERE id = ?").bind(rid).first();
  return zeile ? JSON.parse(zeile.daten) : null;
}
async function rezeptSchreiben(db, rezept){
  rezept.geaendert = Date.now();
  await db.prepare("UPDATE rezepte SET daten = ?, geaendert = ? WHERE id = ?").bind(JSON.stringify(rezept), rezept.geaendert, rezept.id).run();
  return json({ rezept });
}
/* Original anhängen; mit vorschau=1 wird es das Vorschaubild (Bild aus der Mediathek, Bild der Webseite). */
async function originalAnhaengen(env, rid, typ, name, bytes, vorschau){
  const db = env.DB;
  const rezept = await rezeptHolen(db, rid);
  if(!rezept) return fehler("Rezept nicht gefunden.", 404);
  const falsch = bytesPruefen(typ, bytes); if(falsch) return falsch;
  if((rezept.originale || []).length >= ORIGINALE_JE_REZEPT) return fehler("Höchstens " + ORIGINALE_JE_REZEPT + " Originale je Rezept.", 409);
  const id = await bytesSpeichern(db, rid, typ, name, bytes);
  rezept.originale = [...(rezept.originale || []), { id, typ, name, groesse: bytes.length }];
  if(vorschau) rezept.vorschau = id;
  return rezeptSchreiben(db, rezept);
}
async function originalSpeichern(env, request, rid, url){
  const bytes = new Uint8Array(await request.arrayBuffer());
  return originalAnhaengen(env, rid, str(url.searchParams.get("typ"), 60), str(url.searchParams.get("name"), 100), bytes, url.searchParams.get("vorschau") === "1");
}
/* Bild von einer Adresse holen (Bild der Rezept-Webseite). */
async function originalVonUrl(env, rid, url){
  const ziel = url.searchParams.get("url") || "";
  if(!/^https?:\/\//.test(ziel)) return fehler("Keine Bildadresse.", 400);
  let r;
  try { r = await fetch(ziel, { headers: { "user-agent": LESER, accept: "image/*" }, redirect: "follow", signal: AbortSignal.timeout(15000) }); }
  catch { return fehler("Bild nicht erreichbar.", 502); }
  if(!r.ok) return fehler("Bild nicht geladen (" + r.status + ").", 502);
  const typ = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if(!/^image\/(jpeg|png|webp)$/.test(typ)) return fehler("Kein JPEG/PNG/WebP-Bild (" + (typ || "unbekannt") + ").", 415);
  const bytes = new Uint8Array(await r.arrayBuffer());
  const name = (ziel.split(/[?#]/)[0].split("/").pop() || "bild").slice(0, 100);
  return originalAnhaengen(env, rid, typ, name, bytes, url.searchParams.get("vorschau") === "1");
}
async function originalLoeschen(env, rid, oid){
  const db = env.DB;
  const rezept = await rezeptHolen(db, rid);
  if(!rezept) return fehler("Rezept nicht gefunden.", 404);
  if(!(rezept.originale || []).some(o => o.id === oid)) return fehler("Original nicht gefunden.", 404);
  await db.prepare("DELETE FROM originale WHERE id = ? AND rezept = ?").bind(oid, rid).run();
  rezept.originale = rezept.originale.filter(o => o.id !== oid);
  if(rezept.vorschau === oid) delete rezept.vorschau;
  return rezeptSchreiben(db, rezept);
}
async function kategorieBild(env, request, url){
  const typ = str(url.searchParams.get("typ"), 60), bytes = new Uint8Array(await request.arrayBuffer());
  if(!/^image\//.test(typ)) return fehler("Nur Bilder.", 415);
  const falsch = bytesPruefen(typ, bytes); if(falsch) return falsch;
  return json({ id: await bytesSpeichern(env.DB, "kategorie", typ, str(url.searchParams.get("name"), 100), bytes) });
}

const alsBytes = v => v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v)
  : ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : Uint8Array.from(v || []);

async function originalZeigen(env, id){
  if(!env.DB) return new Response("Keine Datenbank.", { status: 503 });
  await tabellen(env.DB);
  const r = await env.DB.prepare("SELECT typ, name, daten FROM originale WHERE id = ? ORDER BY nr").bind(id).all();
  const teile = r.results || [];
  if(!teile.length) return new Response("Nicht gefunden.", { status: 404 });
  const stuecke = teile.map(t => alsBytes(t.daten));
  const alles = new Uint8Array(stuecke.reduce((n, s) => n + s.length, 0));
  let ab = 0; for(const s of stuecke){ alles.set(s, ab); ab += s.length; }
  const name = (teile[0].name || "original").replace(/[^\w.\- ]/g, "_");
  return new Response(alles, { headers: { "content-type": teile[0].typ, "cache-control": "private, max-age=86400",
    "content-disposition": "inline; filename=\"" + name + "\"" } });
}

/* ---------- Rezepte speichern ---------- */
async function rezepte(env, request, id){
  const db = env.DB;
  if(request.method === "GET"){
    const r = await db.prepare("SELECT daten FROM rezepte ORDER BY geaendert DESC").all();
    return json({ rezepte: (r.results || []).map(x => JSON.parse(x.daten)) });
  }
  if(!/^[\w-]{6,40}$/.test(id || "")) return fehler("Ungültige Rezept-id.", 400);
  if(request.method === "DELETE"){
    await db.prepare("DELETE FROM rezepte WHERE id = ?").bind(id).run();
    await db.prepare("DELETE FROM originale WHERE rezept = ?").bind(id).run();
    return json({ ok: true });
  }
  if(request.method === "PUT"){
    const e = await request.json().catch(() => null);
    const r = saeubern(e);
    if(!r || !r.titel) return fehler("Rezept ohne Titel wird nicht gespeichert.", 400);
    const jetzt = Date.now();
    const alt = await rezeptHolen(db, id);
    /* Originale verwaltet nur der Worker (anhängen/löschen); was das Handy mitschickt, kann veraltet sein. */
    r.originale = alt?.originale || [];
    if(r.vorschau && r.vorschau !== "-" && !r.originale.some(o => o.id === r.vorschau)) delete r.vorschau;
    const daten = { ...r, id, erstellt: alt?.erstellt || jetzt, geaendert: jetzt };
    await db.prepare("INSERT INTO rezepte (id, daten, geaendert) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET daten = excluded.daten, geaendert = excluded.geaendert")
      .bind(id, JSON.stringify(daten), jetzt).run();
    return json({ rezept: daten });
  }
  return fehler("Methode nicht erlaubt.", 405);
}

/* ---------- Eingang ---------- */
export default {
  async fetch(request, env, ctx){
    const url = new URL(request.url);
    const basis = url.origin;
    const herkunft = request.headers.get("origin");
    const cors = herkunft === APP_HERKUNFT ? { "access-control-allow-origin": APP_HERKUNFT,
      "access-control-allow-headers": "content-type, x-code", "access-control-allow-methods": "GET, POST, PUT, DELETE",
      "vary": "origin" } : {};
    const mit = r => { for(const [k, v] of Object.entries(cors)) r.headers.set(k, v); return r; };

    if(request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if(url.pathname === "/" && request.method === "GET")
      return new Response(TESTSEITE, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    const b = url.pathname.match(/^\/bring\/([\w]{16})$/);
    if(b && request.method === "GET") return bringSeite(env, b[1]);
    const bild = url.pathname.match(/^\/bild\/([a-z0-9]{24})$/);
    if(bild && request.method === "GET") return originalZeigen(env, bild[1]);
    if(!url.pathname.startsWith("/api/")) return new Response("Nicht gefunden.", { status: 404 });

    if(!env.FAMILIEN_CODE) return mit(fehler("Secret FAMILIEN_CODE fehlt im Worker.", 503));
    if(!gleich(request.headers.get("x-code") || "", env.FAMILIEN_CODE)) return mit(fehler("Falscher Familien-Code.", 401));

    try {
      const erg = url.pathname.match(/^\/api\/ergebnis\/([\w-]{8,40})$/);
      if(erg && env.DB){
        await tabellen(env.DB);
        const r = await env.DB.prepare("SELECT daten FROM ergebnisse WHERE id = ?").bind(erg[1]).first();
        return mit(r ? new Response(r.daten, { headers: { "content-type": "application/json; charset=utf-8" } }) : json({ warten: true }, 202));
      }
      if(url.pathname === "/api/protokoll" && env.DB){
        await tabellen(env.DB);
        const r = await env.DB.prepare("SELECT t, was FROM protokoll ORDER BY t DESC LIMIT 30").all();
        return mit(json({ eintraege: r.results || [] }));
      }
      if(url.pathname === "/api/pruefen"){
        const r = { db: !!env.DB, gemini: false, modell: str(env.MODELL, 80) || "gemini-flash-latest" };
        if(env.GEMINI_KEY){
          const g = await fetch(GEMINI + "/v1beta/models/" + encodeURIComponent(r.modell), { headers: { "x-goog-api-key": env.GEMINI_KEY } });
          r.gemini = g.ok;
          if(!g.ok){ const t = await g.json().catch(() => null);
            r.geminiFehler = g.status + (t?.error?.status ? " " + t.error.status : "") + (t?.error?.message ? ": " + str(t.error.message, 200) : ""); }
        }
        if(env.DB) await tabellen(env.DB);
        return mit(json(r));
      }
      if(!env.GEMINI_KEY && /^\/api\/(datei|datei-start|rezept)$/.test(url.pathname)) return mit(fehler("Secret GEMINI_KEY fehlt im Worker.", 503));
      if(url.pathname === "/api/datei" && request.method === "POST") return mit(await hochladen(env, request, url.searchParams.get("name")));
      if(url.pathname === "/api/datei-start" && request.method === "POST") return mit(await uploadStarten(env, url));
      if(url.pathname === "/api/rezept" && request.method === "POST") return mit(await rezeptMachen(env, request, ctx));
      if(!env.DB) return mit(fehler("D1-Datenbank (Binding DB) fehlt im Worker.", 503));
      await tabellen(env.DB);
      if(url.pathname === "/api/bring" && request.method === "POST") return mit(await bringAnlegen(env, request, basis));
      const og = url.pathname.match(/^\/api\/original\/([\w-]{6,40})$/);
      if(og && request.method === "PUT") return mit(await originalSpeichern(env, request, og[1], url));
      const ou = url.pathname.match(/^\/api\/original-url\/([\w-]{6,40})$/);
      if(ou && request.method === "PUT") return mit(await originalVonUrl(env, ou[1], url));
      const od = url.pathname.match(/^\/api\/original\/([\w-]{6,40})\/([a-z0-9]{24})$/);
      if(od && request.method === "DELETE") return mit(await originalLoeschen(env, od[1], od[2]));
      if(url.pathname === "/api/kategorien") return mit(await kategorien(env, request));
      if(url.pathname === "/api/kategorie-bild" && request.method === "PUT") return mit(await kategorieBild(env, request, url));
      const m = url.pathname.match(/^\/api\/rezepte(?:\/([^/]+))?$/);
      if(m) return mit(await rezepte(env, request, m[1]));
      return mit(fehler("Nicht gefunden.", 404));
    } catch(err){
      return mit(fehler("Fehler im Worker: " + String(err?.message || err).slice(0, 300), 500));
    }
  },
};

/* ---------- Testseite (Notzugang; die App liegt auf strakekine.github.io/recipes) ---------- */
const TESTSEITE = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Recipes · Test</title><meta name="theme-color" content="#14110f">
<style>
:root{--bg:#14110f;--p:#1f1a17;--l:#3a312b;--t:#f3ece6;--m:#a8998c;--a:#f08a4b;--g:#f2c94c;--bad:#ff6b6b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--t);font:16px/1.45 system-ui,-apple-system,sans-serif}
main{max-width:640px;margin:0 auto;padding:16px 16px 80px}h1{margin:4px 0 2px;font-size:26px}h1 span{color:var(--a)}
.s{color:var(--m);font-size:14px}.k{background:var(--p);border:1px solid var(--l);border-radius:14px;padding:14px;margin:14px 0}
input,textarea,button{font:inherit;color:inherit}input[type=password],input[type=text],textarea{width:100%;background:var(--bg);border:1px solid var(--l);border-radius:10px;padding:10px}
textarea{min-height:70px}button{background:var(--a);color:#1b0f06;border:0;border-radius:10px;padding:11px 14px;font-weight:700;cursor:pointer}
button.g{background:transparent;color:var(--t);border:1px solid var(--l)}button:disabled{opacity:.5}
.r{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}ul{padding-left:20px}li{margin:3px 0}
.offen{color:var(--g)}.f{color:var(--bad)}.pz{display:flex;align-items:center;gap:10px}.pz b{font-size:20px;min-width:2ch;text-align:center}
.grp{color:var(--a);font-weight:700;margin-top:8px}.h{color:var(--m);font-size:13px}.li{padding:10px 0;border-top:1px solid var(--l);cursor:pointer}
label.file{display:block;border:2px dashed var(--l);border-radius:12px;padding:16px;text-align:center;cursor:pointer}
</style></head><body><main>
<h1><span>Recipes</span> · Test</h1><div class="s">Testseite: Datei rein → Rezept. Die richtige App kommt danach.</div>
<div class="k" id="codeK"><b>Familien-Code</b><div class="r"><input type="password" id="code" placeholder="Code"><button id="codeOk">Prüfen</button></div><div id="codeS" class="s"></div></div>
<div class="k"><b>+ Rezept</b>
<label class="file">📄 🖼️ 🎬 PDF, Screenshots, Fotos oder Bildschirmaufnahme wählen<input type="file" id="datei" multiple accept="image/*,application/pdf,video/*" hidden></label>
<div id="gewaehlt" class="s"></div>
<div style="margin-top:10px"><textarea id="text" placeholder="oder: Beschreibungstext, YouTube-Link oder Rezepttext einfügen (Link zum Reel gern dazu)"></textarea></div>
<div class="r"><button id="los">Rezept machen</button><span id="stand" class="s"></span></div></div>
<div class="k" id="ergebnis" hidden></div>
<div class="k"><b>Gespeichert</b><div id="liste" class="s">–</div></div>
<details class="k" id="protK"><summary><b>Protokoll</b> <span class="s">(was der Worker zuletzt gemacht hat)</span></summary><div id="prot" class="s">–</div></details>
<div class="s" style="text-align:center">Fassung 09.11.2026 a</div>
</main><script>
const $=id=>document.getElementById(id);
let CODE="";try{CODE=localStorage.getItem("recipes_code")||""}catch{}
$("code").value=CODE;
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function api(pfad,opt={}){const r=await fetch(pfad,{...opt,headers:{"x-code":CODE,...(opt.headers||{})}});
 const roh=await r.text().catch(e=>"[Lesefehler: "+e.message+"]");let d;
 try{d=JSON.parse(roh.trim())}catch{const k=roh.trim();d={fehler:"Antwort nicht lesbar ("+r.status+", "+pfad.split("?")[0]+", "+roh.length+" Zeichen): "+(k?k.slice(0,150):"leer")}}if(d.fehler||(!r.ok&&r.status!==202))throw new Error(d.fehler||("Fehler "+r.status));return{status:r.status,d}}
async function hoch(f){const typ=f.type||"application/octet-stream";
 try{const{d}=await api("/api/datei-start?name="+encodeURIComponent(f.name)+"&groesse="+f.size+"&typ="+encodeURIComponent(typ),{method:"POST"});
  const r=await fetch(d.url,{method:"POST",headers:{"X-Goog-Upload-Command":"upload, finalize","X-Goog-Upload-Offset":"0"},body:f});
  const j=await r.json().catch(()=>null);if(!r.ok||!j?.file?.uri)throw new Error("Google: "+r.status);
  return{name:j.file.name,uri:j.file.uri,mime:j.file.mimeType||typ}}
 catch(e){if(f.size>95*1048576)throw new Error("Hochladen: "+e.message);
  const{d}=await api("/api/datei?name="+encodeURIComponent(f.name),{method:"POST",headers:{"content-type":typ},body:f});return d.datei}}
$("codeOk").onclick=async()=>{CODE=$("code").value.trim();try{localStorage.setItem("recipes_code",CODE)}catch{}
 try{const{d}=await api("/api/pruefen");$("codeS").innerHTML="✓ Code stimmt · Gemini: "+(d.gemini?"✓":"✗ ("+(d.geminiFehler||"Schlüssel fehlt")+")")+" · Datenbank: "+(d.db?"✓":"✗")+" · Modell: "+esc(d.modell);laden()}
 catch(e){$("codeS").innerHTML='<span class="f">'+esc(e.message)+"</span>"}};
$("datei").onchange=()=>{const f=[...$("datei").files];$("gewaehlt").textContent=f.map(x=>x.name+" ("+(x.size/1048576).toFixed(1)+" MB)").join(", ")};
const warte=ms=>new Promise(r=>setTimeout(r,ms));
let R=null,P=0;
$("los").onclick=async()=>{const files=[...$("datei").files],text=$("text").value.trim();
 if(!files.length&&!text){$("stand").textContent="Erst eine Datei wählen oder Text einfügen.";return}
 $("los").disabled=true;const dateien=[];
 try{for(const[i,f]of files.entries()){$("stand").textContent="Lade hoch "+(i+1)+"/"+files.length+" ("+(f.size/1048576).toFixed(0)+" MB) …";
   dateien.push(await hoch(f))}
  const t0=Date.now(),auftrag="a"+Date.now().toString(36)+Math.random().toString(36).slice(2,8);let TXT="KI schaut sich das an";
  const uhr=setInterval(()=>{$("stand").textContent=TXT+" … "+Math.round((Date.now()-t0)/1000)+" s"},1000);
  try{for(;;){let status,d;
   try{({status,d}=await api("/api/rezept",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({dateien,text,auftrag})}))}
   catch(e){if(!/nicht lesbar|Load failed|network|Netzwerk|fetch/i.test(e.message))throw e;
    /* Verbindung abgerissen: der Worker arbeitet weiter und legt das Ergebnis ab. */
    TXT="Verbindung kurz weg, hole das Ergebnis";
    for(;;){if(Date.now()-t0>360000)throw new Error("Kein Ergebnis nach 6 Minuten. Bitte nochmal versuchen.");
     await warte(5000);try{({status,d}=await api("/api/ergebnis/"+auftrag))}catch(e2){if(!/nicht lesbar|Load failed|network|fetch/i.test(e2.message))throw e2;continue}
     if(status!==202)break}}
   if(status===202||d.warten){if(Date.now()-t0>300000)throw new Error("Gemini braucht zu lange für das Video.");TXT="Gemini bereitet das Video vor";await warte(3000);TXT="KI schaut sich das an";continue}
   R={...d.rezept,id:null};P=R.portionen||2;clearInterval(uhr);$("stand").textContent="Fertig ("+Math.round((Date.now()-t0)/1000)+" s, "+esc(d.modell)+")";zeigen();break}}
  finally{clearInterval(uhr)}}
 catch(e){$("stand").innerHTML='<span class="f">'+esc(e.message)+"</span>"}
 if($("protK").open)$("protK").ontoggle();
 $("los").disabled=false};
function fmt(x,e){if(x==null)return"";if(["g","ml"].includes(e)&&x>=100)x=Math.round(x/5)*5;
 else if(["Stück","EL","TL","Zehe","Dose","Bund","Becher","Pck","Scheibe",""].includes(e))x=Math.round(x*2)/2;else x=Math.round(x*10)/10;
 const s=String(x).replace(".",",");return s.replace(/^0,5$/,"½").replace(/,5$/," ½")}
function menge(z,f){if(z.menge==null)return"";let a=z.menge*f,b=z.menge_bis!=null?z.menge_bis*f:null,e=z.einheit;
 if(e==="g"&&a>=1000){a/=1000;b=b&&b/1000;e="kg"}if(e==="ml"&&a>=1000){a/=1000;b=b&&b/1000;e="l"}
 if(e==="Prise"||e==="Msp"){a=z.menge;b=z.menge_bis}
 return fmt(a,e)+(b!=null?"–"+fmt(b,e):"")+(e?" "+e:"")}
function zeilen(){const f=P/(R.portionen||P||1);return R.zutaten.map(z=>(menge(z,f)+" "+z.name).trim())}
function zeigen(){const f=P/(R.portionen||P||1);let g=null,h="";
 for(const z of R.zutaten){if((z.gruppe||"")!==g){g=z.gruppe||"";if(g)h+='</ul><div class="grp">'+esc(g)+"</div><ul>"}
  const m=menge(z,f);h+="<li"+(m?"":' class="offen"')+"><b>"+esc(m)+"</b> "+esc(z.name)+(z.hinweis?' <span class="h">('+esc(z.hinweis)+")</span>":"")+(m?"":' <span class="h">⚠︎</span>')+"</li>"}
 $("ergebnis").hidden=false;$("ergebnis").innerHTML="<h2 style='margin:0'>"+esc(R.titel||"(kein Rezept erkannt)")+"</h2>"
 +'<div class="s">'+(R.zeit_min?"⏱ "+R.zeit_min+" min · ":"")+(R.quelle?'<a style="color:var(--a)" href="'+esc(R.quelle)+'" target="_blank">▶ Original</a>':"")+"</div>"
 +'<div class="r pz">Personen <button class="g" id="m">−</button><b>'+P+'</b><button class="g" id="p">+</button></div>'
 +"<ul>"+h+"</ul><b>Schritte</b><ol>"+R.schritte.map(s=>"<li>"+esc(s)+"</li>").join("")+"</ol>"
 +(R.notiz?'<div class="s">📝 '+esc(R.notiz)+"</div>":"")
 +'<div class="r"><button id="sp">'+(R.id?"Gespeichert ✓":"Speichern")+'</button><button class="g" id="br">In Bring! übernehmen</button><button class="g" id="del" '+(R.id?"":"hidden")+'>Löschen</button></div><div id="brS" class="s"></div>';
 $("m").onclick=()=>{if(P>1){P--;zeigen()}};$("p").onclick=()=>{P++;zeigen()};
 $("sp").onclick=async()=>{try{const id=R.id||(Date.now().toString(36)+Math.random().toString(36).slice(2,8));
  const{d}=await api("/api/rezepte/"+id,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(R)});R=d.rezept;zeigen();laden()}catch(e){alert(e.message)}};
 $("del").onclick=async()=>{if(!confirm("Rezept löschen?"))return;await api("/api/rezepte/"+R.id,{method:"DELETE"});$("ergebnis").hidden=true;R=null;laden()};
 $("br").onclick=async()=>{try{const{d}=await api("/api/bring",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({titel:R.titel,zeilen:zeilen()})});
  $("brS").innerHTML='Testseite für Bring!: <a style="color:var(--a)" href="'+esc(d.seite)+'" target="_blank">ansehen</a>';location.href=d.link}catch(e){$("brS").innerHTML='<span class="f">'+esc(e.message)+"</span>"}}}
let ALLE=[];
async function laden(){try{const{d}=await api("/api/rezepte");ALLE=d.rezepte;
 $("liste").innerHTML=ALLE.length?ALLE.map((r,i)=>'<div class="li" data-i="'+i+'"><b>'+esc(r.titel)+"</b> · "+r.zutaten.length+" Zutaten</div>").join(""):"Noch nichts gespeichert.";
 document.querySelectorAll(".li").forEach(el=>el.onclick=()=>{R=ALLE[+el.dataset.i];P=R.portionen||2;zeigen();$("ergebnis").scrollIntoView({behavior:"smooth"})})}catch{}}
$("protK").ontoggle=async()=>{if(!$("protK").open)return;try{const{d}=await api("/api/protokoll");
 $("prot").innerHTML=d.eintraege.length?d.eintraege.map(e=>"<div>"+new Date(e.t).toLocaleString("de-DE",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"})+" · "+esc(e.was)+"</div>").join(""):"Noch nichts."}catch(e){$("prot").textContent=e.message}};
if(CODE)$("codeOk").click();
</script></body></html>`;
