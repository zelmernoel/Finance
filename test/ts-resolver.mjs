// Auflösungs-Hook nur für den Test-Runner.
//
// Der Anwendungscode importiert ohne Dateiendung ("../utils") — so löst Vite
// auf, und so steht es an 23 von 24 Stellen im Projekt. Node verlangt in ESM
// dagegen die vollständige Endung. Statt den Anwendungscode an diese
// Werkzeuggrenze anzupassen, hängt dieser Hook die Endung beim Auflösen an.
//
// Greift nur bei relativen Pfaden und nur, wenn Node ohne Endung scheitert.

const KANDIDATEN = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (fehler) {
    if (!specifier.startsWith('.')) throw fehler;
    for (const endung of KANDIDATEN) {
      try {
        return await next(specifier + endung, context);
      } catch {
        // nächste Endung probieren
      }
    }
    throw fehler;
  }
}
