# JuegoMusical

Juego multijugador tipo *blind test*: suena un fragmento de 30 s y gana quien adivine la canción más rápido.

## Cómo se juega
- **Música**: categorías listas (Reguetón, Top Colombia, Rock en español…), o por género, playlist o artista de Deezer.
- **Qué adivinar**: la canción o el artista.
- **Cómo responder**: elegir entre 4 opciones, o escribir la respuesta (3 intentos; se perdonan tildes y errores pequeños, validado en el servidor con `unaccent` + distancia de Levenshtein).
- **Fragmento**: desde el inicio o desde un segundo al azar.
- **Puntos**: 500 por acertar + hasta 500 por rapidez, y +150 por acierto desde una racha de 3.
- **Invitar**: código de 5 letras, enlace o código QR.

## Stack
- **Next.js** (App Router) — interfaz y rutas `/api/*` que consultan Deezer desde el servidor.
- **Supabase** (proyecto `juego-musical`, independiente de otros proyectos) — salas, jugadores, rondas y puntajes, con Realtime.
- **Deezer API** pública — catálogo y fragmentos de 30 s, sin clave.

## Seguridad
- Los clientes solo **leen** `rooms`, `players` y `rounds`. Todo cambio pasa por funciones RPC que validan un token secreto por jugador.
- Las respuestas correctas viven en `round_secrets` (inaccesible para el cliente) y solo se copian a `rounds` al revelar.
- El servidor arma las rondas y las guarda directamente: la respuesta nunca pasa por el navegador.

## Desarrollo
```bash
npm install
npm run dev
```
Variables opcionales (por defecto apuntan al proyecto `juego-musical`):
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```
El esquema de la base de datos está en `supabase/migrations/`.

## Pruebas
| Nivel | Qué cubre | Cómo correrlo |
|---|---|---|
| Unitarias y componentes (Vitest + Testing Library) | Armado de rondas, Deezer, títulos, categorías, sesión, audio, rutas `/api`, inicio, sala, juego, buscador, resultados | `npm test` |
| Base de datos (Vitest + Postgres) | Todas las reglas del juego en SQL con las migraciones reales: salas, permisos, puntos, rachas, modo escribir, multijugador completo | `source scripts/local-postgres.sh && npm run test:db` |
| Punta a punta (Playwright) | Varios navegadores jugando contra Supabase local + Deezer real, tiempo real, audio, seguridad de la API, celular | En GitHub Actions (`.github/workflows/pruebas.yml`) |
