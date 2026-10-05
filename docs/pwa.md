# PWA instalable (Fase 13)

## Qué hace y qué no

Academic Planner es una **PWA instalable**: tiene manifest, service worker, iconos y modo `standalone`. Se puede instalar desde navegadores que lo permitan y el shell estático (HTML, JS, CSS, iconos) abre aunque no haya conexión.

**No es una aplicación offline.** Consultar o modificar datos académicos (actividades, asignaturas, agenda, Captura rápida, Bandeja académica…) **requiere conexión y backend**. Sin conexión se muestra un mensaje claro y no se aparenta éxito. Fuera de alcance (y no implementado): escrituras offline, cola de peticiones, background sync, resolución de conflictos, Web Push.

## Piezas

| Pieza                                                               | Dónde                                                                                                                           |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Manifest + service worker (generados)                               | `apps/web/vite.config.ts` con `vite-plugin-pwa` 2.0 (Workbox `generateSW`)                                                      |
| Iconos                                                              | `apps/web/public/`: `icon.svg` (fuente propia), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` |
| Metadatos (`theme-color`, `apple-touch-icon`, `viewport-fit=cover`) | `apps/web/index.html`                                                                                                           |
| Estado puro (instalación, standalone, iOS, mensajes)                | `apps/web/src/pwa/pwaState.ts` (con tests)                                                                                      |
| Instalación                                                         | `usePwaInstall.ts` + `InstallPrompt.tsx` (en el Dashboard, discreto)                                                            |
| Aviso sin conexión y de actualización                               | `PwaNotices.tsx` (encima de la app, en el flujo normal)                                                                         |
| Safe areas                                                          | `env(safe-area-inset-*)` en `index.css` (vale 0 en navegadores sin muescas)                                                     |

## Manifest

`name` «Academic Planner», `short_name` «Planner» (cabe bajo el icono en pantallas de inicio; el nombre completo se ve al instalar), `id` y `start_url` `/` (el enrutado y la autenticación existentes deciden a dónde entra el usuario), `scope` `/`, `display` `standalone`, `theme_color` `#0f172a`, `background_color` `#ffffff`, `lang` `es`, iconos 192, 512 y 512 maskable (contenido dentro del 80 % seguro). Los iconos son propios (un calendario con una marca de verificación), sin logos externos.

## Service worker y caché

- **Precache:** solo el shell estático y los assets con hash (`**/*.{js,css,html,svg,png,webmanifest}`). Workbox versiona por contenido y `cleanupOutdatedCaches` elimina los precaches antiguos al activar una versión nueva (no hay nombres de caché manuales).
- **Navegación:** `navigateFallback: /index.html` para que `/dashboard`, `/activities`, `/calendar`, `/radar`, `/progress`, `/inbox`… abran como enlace directo o recarga, **excepto `/api/*`** (`navigateFallbackDenylist`).
- **API:** toda petición a `/api/*` (cualquier método, también autenticación) usa `NetworkOnly`. **Nunca se guardan respuestas de la API en Cache Storage.**
- **Desarrollo:** el service worker está desactivado en `npm run dev` (`devOptions.enabled: false`) para no dejar cachés viejas. Solo existe en `build` + `preview`/producción.

## Privacidad y seguridad

- Las sesiones siguen siendo cookies HttpOnly; nada de autenticación pasa a `localStorage`.
- Como la API no se cachea, tras cerrar sesión (o con el botón atrás / sin conexión) el shell puede abrir pero **no hay datos privados** que mostrar: el estado de sesión se vuelve a pedir al backend. Los tests lo comprueban listando Cache Storage antes y después de cerrar sesión.
- Los service workers exigen contexto seguro: **HTTPS** en producción (`localhost` vale en desarrollo).

## Sin conexión

- **Aviso:** si `navigator.onLine` es `false` aparece «Sin conexión» (rol `status`, con texto, una sola vez al cambiar). `onLine` es solo una pista: si la API cae con red disponible siguen funcionando los estados de error de siempre.
- **Pantalla completa:** si el shell carga pero la API no responde, las guardas muestran «Academic Planner está sin conexión. Algunas funciones no están disponibles.», una explicación y «Reintentar». Nada de pantalla en blanco ni de datos falsos.
- Con datos ya cargados, un fallo de refetch en segundo plano **no** reemplaza la pantalla por un error (se conserva lo que el usuario ve).
- **Acciones:** TanStack Query usa `networkMode: 'always'`, así que consultas y mutaciones **fallan** con un mensaje en lugar de quedarse esperando. Los errores de red no se reintentan solos; el usuario pulsa «Reintentar» o repite la acción. Al volver la conexión la app se recupera sin cerrarse.
- Captura rápida y Bandeja académica siguen dependiendo de la API (asignaturas, periodo, duplicados): no hay una versión offline duplicada. El texto escrito se conserva.

## Instalación

- Navegadores con `beforeinstallprompt` (Chromium): aparece el botón «Instalar Academic Planner» en el Dashboard solo cuando el navegador ofrece instalar; llama a `prompt()` una vez y se oculta al aceptar o descartar.
- **iOS:** no existe ese evento. En Safari (no en Chrome/Firefox para iOS) se muestra una línea: «En Safari, usa Compartir → Agregar a pantalla de inicio.».
- Si ya está instalada (`display-mode: standalone` o `navigator.standalone`) no se ofrece nada. Nunca hay un modal bloqueante: la app funciona igual en el navegador.

## Actualizaciones

`registerType: 'prompt'`: el worker nuevo queda **en espera** y la app muestra «Nueva versión disponible» con **Actualizar ahora** / **Más tarde**. Nunca se recarga sola, para no perder un formulario a medias (actividad, asignatura, horario, Captura rápida, Bandeja). La app busca versión nueva al cargar y cada hora.

## Cómo depurar / limpiar

DevTools → Application → Service Workers (Unregister) y Storage → Clear site data. En consola: `navigator.serviceWorker.getRegistrations().then(r => r.forEach(x => x.unregister()))` y `caches.keys().then(k => k.forEach(n => caches.delete(n)))`.

## Verificación

- `e2e/pwa.spec.ts` (sobre el bundle compilado servido con `vite preview`, a 360 y 1366 px): manifest válido y completo, iconos accesibles, worker registrado/activo/controlando, precache del shell, ausencia de `/api/` en Cache Storage (antes y después de cerrar sesión), el worker generado solo usa `NetworkOnly`, enlaces directos, `/api` nunca responde con el shell, shell sin conexión con mensaje y recuperación, acción fallida sin conexión, aviso en 360 px, botón de instalar (aceptado/descartado, instalada, iOS).
- Comprobaciones negativas (se rompió a propósito y los tests fallaron): manifest sin icono de 512, worker sin registrar, API con `NetworkFirst`, sin fallback de navegación, `/api` sin denylist, ofrecer instalar estando instalada.
- Lighthouse: la categoría PWA ya no existe en las versiones actuales, así que no se usa como criterio; se verifican directamente manifest, worker, precache y comportamiento offline.
- Sin cubrir en e2e: el aviso de actualización (requiere publicar dos builds consecutivos). Su lógica de decisión es mínima (`needRefresh` del plugin) y se revisó a mano.

## Limitaciones

- Sin datos offline, ni siquiera de solo lectura.
- Navegación offline limitada al shell; las pantallas muestran el mensaje de conexión.
- El favicon va en línea (`data:` URI) a propósito: una petición de archivo iniciada por el navegador fue la que `vite preview` rechazó bajo carga en los tests (ver `docs/project-state.md`).
- El icono es sencillo; no hay capturas ni `screenshots` en el manifest.
