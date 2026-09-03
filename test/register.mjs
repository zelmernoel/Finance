// Meldet den Auflösungs-Hook an. Wird über `node --import` geladen,
// bevor die Testdateien ausgewertet werden.
import { register } from 'node:module';
register('./ts-resolver.mjs', import.meta.url);
