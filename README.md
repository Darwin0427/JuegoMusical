# JuegoMusical

Juego multijugador tipo *blind test*: suena un fragmento de 30 s y gana quien adivine la canción más rápido.

## Modos
- **Por género**: las canciones más escuchadas de un género de Deezer.
- **Por playlist**: cualquier playlist pública de Deezer (búsqueda o enlace pegado).
- **Por artista**: solo canciones de un artista.

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
