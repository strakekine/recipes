# Recipes

Rezepte aus PDF, Screenshot, Foto, Reel oder Link zu einer Rezeptseite per KI auseinandernehmen, in Kategorien ablegen, im Küchenmodus nachkochen, für beliebig viele Personen umrechnen und
die Einkaufsliste an Bring! schicken.

**App:** https://strakekine.github.io/recipes/ — in Safari öffnen, Familien-Code eingeben, dann
Teilen → „Zum Home-Bildschirm“.

| Datei | Was |
|---|---|
| `index.html` | die App (eine Datei, kein Build) |
| `worker.js` | Cloudflare Worker: KI (Gemini), Speichern (D1), Bring!-Brücke |
| `test/` | `node test/worker.mjs`, `node test/logik.mjs`, `node --no-warnings test/oberflaeche.mjs` |

Worker bei Cloudflare: Secrets `GEMINI_KEY` und `FAMILIEN_CODE`, D1-Binding `DB`.
