// Logik von index.html (Zutatenzeilen, Mengen, Personen, Einkaufsliste). Aufruf: node test/logik.mjs
import { readFileSync } from "node:fs";
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const a = html.indexOf("/* ==== Logik ===="), b = html.indexOf("/* ==== Oberfläche ====");
if(a < 0 || b < 0) throw new Error("Marken Logik/Oberfläche nicht gefunden");
const L = new Function(html.slice(a, b) + "; return { zeileLesen, mengeText, zeileAus, zutatenText, zutatenLesen, gangRaten, einkaufDazu, einkaufText, nachGang, istVorrat, vorratListe, sucheTrifft, zahlLesen };")();

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
ok(txt === "## Sauce\n200 ml Sahne\nBasilikum (Menge nicht genannt)", "als Text");
const zur = L.zutatenLesen(txt, zut);
gleich(zur.map(z => [z.menge, z.einheit, z.name, z.gruppe || "", z.gang]), [[200, "ml", "Sahne", "Sauce", "Kühlregal"], [null, "", "Basilikum", "Sauce", "Obst & Gemüse"]], "zurück gelesen, Gang behalten");
ok(L.zutatenLesen("3 Zwiebeln")[0].gang === "Obst & Gemüse", "Gang geraten: Zwiebeln");
ok(L.gangRaten("Burrata") === "Kühlregal" && L.gangRaten("Spaghetti") === "Nudeln, Reis & Trockenes" && L.gangRaten("Zauberpulver") === "Sonstiges", "Gang raten");

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

console.log(fehler ? `\n${fehler} Fehler` : "\nAlles grün");
process.exit(fehler ? 1 : 0);
