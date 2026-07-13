# JamListener MVP

**Demo pública:** https://juancg13.github.io/jam-listener-mvp/

Aplicación web que escucha una fuente musical monofónica, estima notas y tonalidad durante 60 segundos y genera una improvisación sintética compatible.

## Ejecutar

```bash
npm install
npm run dev
```

Abre la URL local en Chrome o Edge, conecta auriculares y autoriza el micrófono. `Probar demo automática` permite validar todo el flujo sin instrumento y sin esperar audio real.

## Validación

```bash
npm test
npm run build
```

El audio se procesa completamente en el navegador. No existe backend ni grabación.

## Límites del MVP

- Mejor resultado con guitarra limpia y notas/arpegios claros.
- La detección usa tono dominante; los acordes densos, ruido y distorsión reducen precisión.
- La tonalidad es una estimación estadística, no una transcripción completa.
