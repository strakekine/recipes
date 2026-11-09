// Logik von index.html (Zutatenzeilen, Mengen, Personen, Einkaufsliste). Aufruf: node test/logik.mjs
import { readFileSync } from "node:fs";
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const a = html.indexOf("/* ==== Logik ===="), b = html.indexOf("/* ==== Oberfläche ====");
if(a < 0 || b < 0) throw new Error("Marken Logik/Oberfläche nicht gefunden");
const L = new Function(html.slice(a, b) + "; return { mengeLesen, mengeEingabe, zutatAusFeldern, istNachGeschmack, zeileLesen, mengeText, zeileAus, zutatenText, zutatenLesen, gangRaten, einkaufDazu, einkaufText, nachGang, istVorrat, vorratListe, sucheTrifft, zahlLesen, timerAus, uhrText, rezepteInKat, gekochtText, heuteGekocht };")();

let fehler = 0;
const ok = (x, t) => { console.log((x ? "✓ " : "✗ ") + t); if(!x) fehler++; };
const gleich = (x, y, t) => ok(JSON.stringify(x) === JSON.stringify(y), t + (JSON.stringify(x) === JSON.stringify(y) ? "" : "  → " + JSON.stringify(x)));

// Zeilen lesen
gleich(L.zeileLesen("200 g Mehl"), { menge: 200, einheit: "g", name: "Mehl" }, "200 g Mehl");
gleich(L.zeileLesen("2 Eier"), { menge: 2, einheit: "", name: "Eier" }, "2 Eier ohne Einheit");
gleich(L.zeileLesen("2-3 Zehen Knoblauch"), { menge: 2, einheit: "Zehe", name: "Knoblauch", menge_bis: 3 }, "Spanne mit Einheit im Plural");
gleich(L.zeileLesen("½ TL Salz"), { menge: 0.5, einheit: "TL", name: "Salz" }, "½ TL");
gleich(L.zeileLesen("1 1/2 EL Öl"), { menge: 1.5, einheit: "EL", name: "Öl" }, "1 1/2 EL");
gleich(L.zeileLesen("1,5 kg Kartoffeln"), { menge: 1.5, einheit: "kg", name: "Kartoffeln" }, "Komma-Zahl");
gleich(L.zeileLesen("Basilikum (nach Gefühl)"), { menge: null, einheit: "", name: "Basilikum", hinweis: "nach Gefühl" }, "ohne Menge, mit Hinweis");
gleich(L.zeileLesen("- 1 Dose gehackte Tomaten"), { menge: 1, einheit: "Dose", name: "gehackte Tomaten" }, "Spiegelstrich weg");
gleich(L.zeileLesen("Prise Salz"), { menge: null, einheit: "", name: "Prise Salz" }, "Einheit ohne Zahl bleibt im Namen");
ok(L.zeileLesen("   ") === null, "leere Zeile → null");

// Mengen und Personen
ok(L.mengeText({ menge: 500, einheit: "g" }, 2) === "1 kg", "500 g × 2 = 1 kg");
ok(L.mengeText({ menge: 250, einheit: "g" }, 1.5) === "375 g", "250 g × 1,5 = 375 g");
ok(L.mengeText({ menge: 333, einheit: "g" }, 1) === "335 g", "ab 100 g auf 5er gerundet");
ok(L.mengeText({ menge: 1, einheit: "" }, 1.5) === "1 ½", "1 Stück × 1,5 = 1 ½");
ok(L.mengeText({ menge: 1, einheit: "Prise" }, 3) === "1 Prise", "Prise skaliert nicht");
ok(L.mengeText({ menge: 2, einheit: "Zehe", menge_bis: 3 }, 2) === "4–6 Zehe", "Spanne skaliert");
ok(L.mengeText({ menge: 1, einheit: "" }, 0.25) === "½", "nie 0 Stück");
ok(L.mengeText({ menge: null, einheit: "" }, 2) === "", "ohne Menge leer");

// Hin und zurück (Bearbeiten)
const zut = [{ menge: 200, einheit: "ml", name: "Sahne", gang: "Kühlregal", gruppe: "Sauce" }, { menge: null, einheit: "", name: "Basilikum", hinweis: "Menge nicht genannt", gang: "Obst & Gemüse" }];
const txt = L.zutatenText(zut);
ok(txt === "Sauce:\n200 ml Sahne\nBasilikum (Menge nicht genannt)", "als Text, Gruppe mit Doppelpunkt");
gleich(L.zutatenLesen("Für den Teig:\n500 g Mehl\n## Belag\n1 Tomate").map(z => [z.name, z.gruppe]), [["Mehl", "Für den Teig"], ["Tomate", "Belag"]], "Doppelpunkt-Zeile und alte ##-Schreibweise werden Gruppen");
ok(L.zutatenLesen("2 EL Öl:")[0].name === "Öl:", "Zeile mit Menge bleibt eine Zutat, auch mit Doppelpunkt");
const zur = L.zutatenLesen(txt, zut);
gleich(zur.map(z => [z.menge, z.einheit, z.name, z.gruppe || "", z.gang]), [[200, "ml", "Sahne", "Sauce", "Kühlregal"], [null, "", "Basilikum", "Sauce", "Obst & Gemüse"]], "zurück gelesen, Gang behalten");
ok(L.zutatenLesen("3 Zwiebeln")[0].gang === "Obst & Gemüse", "Gang geraten: Zwiebeln");
ok(L.gangRaten("Burrata") === "Kühlregal" && L.gangRaten("Spaghetti") === "Nudeln, Reis & Trockenes" && L.gangRaten("Zauberpulver") === "Sonstiges", "Gang raten");

// Editor-Felder
gleich(L.mengeLesen("2"), { menge: 2 }, "Menge 2");
gleich(L.mengeLesen("0,5"), { menge: 0.5 }, "Menge 0,5");
gleich(L.mengeLesen("2-3"), { menge: 2, menge_bis: 3 }, "Menge 2-3");
gleich(L.mengeLesen("½"), { menge: 0.5 }, "Menge ½");
gleich(L.mengeLesen(""), { menge: null }, "leer = ohne Menge");
gleich(L.mengeLesen("viel"), { fehler: true }, "Unsinn wird gemeldet");
ok(L.mengeEingabe({ menge: 2, menge_bis: 3 }) === "2–3" && L.mengeEingabe({ menge: 0.5 }) === "0,5" && L.mengeEingabe({ menge: null }) === "", "Menge fürs Eingabefeld");
const alt = { name: "Burrata", menge: null, einheit: "", hinweis: "Menge nicht genannt", gang: "Kühlregal" };
gleich(L.zutatAusFeldern("1", "", "Burrata", alt), { name: "Burrata", einheit: "", menge: 1, gang: "Kühlregal" }, "Menge eingetragen: Hinweis „nicht genannt“ weg, Gang bleibt");
gleich(L.zutatAusFeldern("5", "ng", "Salz", { name: "Salz", gang: "Gewürze, Öl & Saucen" }), { name: "Salz", einheit: "", menge: null, hinweis: "nach Geschmack", gang: "Gewürze, Öl & Saucen" }, "„nach Geschmack“: Menge entfällt");
ok(L.istNachGeschmack({ menge: null, hinweis: "nach Geschmack" }) && L.istNachGeschmack({ menge: null, hinweis: "nach Gefühl" }) && !L.istNachGeschmack({ menge: null, hinweis: "Menge nicht genannt" }), "nach Geschmack/Gefühl = grau, nicht genannt = gelb");
gleich(L.zutatAusFeldern("2", "EL", "Pesto rosso", { name: "Pesto", gang: "Konserven & Gläser" }), { name: "Pesto rosso", einheit: "EL", menge: 2, gang: "Konserven & Gläser" }, "umbenannt: Gang neu geraten");
ok(L.zutatAusFeldern("", "", "  ") === null, "leere Zeile entfällt");
ok(L.zutatAusFeldern("zwei", "EL", "Öl").fehler.includes("zwei"), "falsche Menge mit Fehlertext");
ok(L.zutatAusFeldern("", "EL", "Öl").menge === null && L.zutatAusFeldern("", "EL", "Öl").einheit === "", "Einheit ohne Menge wird nicht gespeichert");

// Einkaufsliste
const v = L.vorratListe("Salz, Pfeffer, Öl");
let { liste, weg } = L.einkaufDazu([], [
  { menge: 500, einheit: "g", name: "Mehl", gang: "Backzutaten" },
  { menge: 1, einheit: "TL", name: "Salz", gang: "Gewürze, Öl & Saucen" },
  { menge: null, einheit: "", name: "Basilikum", gang: "Obst & Gemüse" }], 2, "Pizza", v);
ok(weg.join() === "Salz", "Salz bleibt weg (Vorrat)");
({ liste } = L.einkaufDazu(liste, [{ menge: 0.5, einheit: "kg", name: "mehl", gang: "Backzutaten" }, { menge: 2, einheit: "", name: "Basilikum" }], 1, "Brot", v));
const mehl = liste.find(x => x.n === "Mehl");
ok(liste.length === 2 && mehl.m === 1500 && L.einkaufText(mehl) === "1,5 kg Mehl" && mehl.von.join() === "Pizza,Brot", "g + kg zusammengezählt, beide Rezepte vermerkt");
const bas = liste.find(x => x.n === "Basilikum");
ok(L.einkaufText(bas) === "2 Basilikum (+ etwas)", "ohne Menge + mit Menge → „+ etwas“");
({ liste } = L.einkaufDazu(liste, [{ menge: 2, einheit: "EL", name: "Mehl" }], 1, "X", v));
ok(liste.filter(x => x.n.toLowerCase() === "mehl").length === 2, "andere Einheit = eigene Zeile");
liste[0].ok = true;
({ liste } = L.einkaufDazu(liste, [{ menge: 100, einheit: "g", name: "Mehl" }], 1, "Y", v));
ok(liste.filter(x => x.k === "mehl|g").length === 2, "Abgehaktes wird nicht wieder aufgefüllt");
ok(L.nachGang(liste)[0][0] === "Obst & Gemüse", "nach Gängen sortiert");
ok(!L.istVorrat("Olivenöl", L.vorratListe("Öl")) && L.istVorrat("Olivenöl extra", L.vorratListe("Olivenöl")) && L.istVorrat("Salz", v) && !L.istVorrat("Salzbrezel", v), "Vorrat: ganze Wörter");

// Suche
const r = { titel: "Croissant Mozzarella-Sandwich", zutaten: [{ name: "Burrata" }, { name: "Rucola" }] };
ok(L.sucheTrifft(r, "rucola") && L.sucheTrifft(r, "croissant burrata") && !L.sucheTrifft(r, "lachs"), "Suche über Titel und Zutaten");


// Küchenmodus: Zeiten im Schritt
gleich(L.timerAus("10 Minuten köcheln").map(t => [t.sek, t.label]), [[600, "10 min"]], "10 Minuten");
gleich(L.timerAus("2–3 Min. anbraten, dann 1 Stunde ruhen").map(t => [t.sek, t.label]), [[120, "2–3 min"], [3600, "1 Std."]], "Spanne (kürzere Zeit) und Stunde");
gleich(L.timerAus("1,5 Std. backen, 30 Sekunden rühren").map(t => t.sek), [5400, 30], "Komma-Stunden, Sekunden");
gleich(L.timerAus("bei 180 °C backen, 2 h gehen lassen, 20 min").map(t => t.sek), [7200, 1200], "°C ist keine Zeit, h und min");
gleich(L.timerAus("4 Eier, 200 g Mehl, Minze hacken"), [], "Mengen und „Minze“ sind keine Zeiten");
ok(L.uhrText(65) === "1:05" && L.uhrText(3725) === "1:02:05" && L.uhrText(-3) === "0:00", "Restzeit als Uhr");
// Kategorien
const RK = [{ id: "a", kategorien: ["x"] }, { id: "b", kategorien: ["x", "y"] }, { id: "c" }, { id: "d", kategorien: ["weg"] }];
ok(L.rezepteInKat(RK, "x", ["x", "y"]).map(r => r.id).join() === "a,b" && L.rezepteInKat(RK, "ohne", ["x", "y"]).map(r => r.id).join() === "c,d" && L.rezepteInKat(RK, "alle", []).length === 4, "Rezepte je Kategorie, „ohne“ zählt unbekannte Kategorien mit");


// Sterne, gekocht, Kochliste
const T0 = new Date(2026, 10, 9, 18).getTime();
ok(L.gekochtText({}) === "Noch nie gekocht" && L.gekochtText({ gekocht: [new Date(2026, 9, 3).getTime(), T0 - 3600e3] }, T0) === "2× gekocht, zuletzt heute", "gekocht-Text");
ok(L.gekochtText({ gekocht: [new Date(2026, 9, 3).getTime()] }, T0) === "1× gekocht, zuletzt 03.10." && !L.heuteGekocht({ gekocht: [T0 - 86400e3] }, T0) && L.heuteGekocht({ gekocht: [T0] }, T0), "Datum, heute gekocht?");
ok(L.rezepteInKat([{ id: "a", merken: 5 }, { id: "b" }, { id: "c", merken: 2 }], "merken", []).map(r => r.id).join() === "c,a", "Kochliste: älteste Idee zuerst");

console.log(fehler ? `\n${fehler} Fehler` : "\nAlles grün");
process.exit(fehler ? 1 : 0);
