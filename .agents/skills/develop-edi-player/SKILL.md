---
name: develop-edi-player
description: Desarrollar, depurar y validar el reproductor standalone Edi.Player en HTML, CSS y JavaScript, incluidos controles, playlists, sincronización con EDI y WebXR. Aplicar a cambios en este repo, con prioridad en diseño responsive y respuesta rápida en Microsoft Edge.
---

# Desarrollar EDI Player

Trabajar desde el repo standalone que contiene `index.html`, `js/`, `css/` y
`Tests/`. Es un sitio estático servido por EDI al seleccionar esta carpeta como
juego; no necesita un build de .NET ni un servidor MVC propio.

## Prioridad: responsive y respuesta inmediata en Edge

**El diseño responsive y la rapidez de interacción son requisitos centrales del
producto. Microsoft Edge es el navegador de referencia para el reproductor web.**
Los controles deben responder con rapidez mientras se reproduce vídeo, se
actualizan dispositivos y se usan playlists. En VR, comprobar también el navegador
WebXR del visor: una prueba en Edge no demuestra compatibilidad física del headset.

- Adaptar controles y paneles al espacio disponible, a ventanas estrechas, al
  redimensionado y a pantalla completa. Evitar desbordamiento horizontal,
  controles tapados y zonas de interacción inaccesibles.
- Mantener las acciones frecuentes al alcance y conservar sus atajos de ratón,
  teclado y controlador. Dar feedback visual inmediato, distinguiendo una acción
  pendiente de una confirmada por el backend.
- Mantener libre el hilo principal: evitar cálculos pesados, reconstrucciones
  completas del DOM, lecturas/escrituras de layout intercaladas y trabajo repetido
  por frame. Reutilizar estado y actualizar solo lo que cambió.
- No hacer que intensidad, pausa o navegación esperen consultas o cargas que no
  necesitan. Agrupar cambios de variantes y reutilizar las colas y cachés
  existentes; en ajustes continuos, conservar el valor pendiente más reciente
  sin acumular comandos obsoletos.
- Mantener las operaciones que requieren confirmación en orden: preparar assets
  y variantes antes de enviar Play. No sacrificar la sincronización para aparentar
  rapidez ni mostrar como aplicado un cambio rechazado.
- Evaluar la fluidez en Edge con reproducción activa y varios dispositivos
  simulados. Si se cambia trabajo frecuente, usar Performance cuando haya indicios
  de bloqueos; no afirmar mejoras de rendimiento sin evidencia.

## Arquitectura y límites

Leer `js/player/README.md` para ubicar responsabilidades y
`js/player/vr/README.md` al modificar VR. Confirmar los detalles en el código:
la documentación puede conservar descripciones de versiones anteriores.

- `js/edi-player.js` compone la sesión; mantener el comportamiento en los módulos
  existentes de `js/player/` en lugar de concentrarlo en el punto de entrada.
- Reutilizar `synchronization.mjs`, `playback-events.mjs`, `assets.mjs` y
  `device-routing.mjs`; conservar pausa selectiva, variantes, rangos y orden de
  comandos. Los controles de UI no deben crear rutas paralelas de sincronización.
- Conservar preferencias, claves de almacenamiento y la biblioteca IndexedDB.
  Liberar object URLs, listeners y recursos al reemplazar medios o salir de VR.
- Cargar las dependencias VR bajo demanda y mantener el vídeo y la UI separados.
  Conservar el fallback de textura WebGL cuando las capas nativas no estén
  disponibles. No reintroducir capturas HTML por frame como solución a controles.
- Este repo es independiente de `Edi.Mvc`. Si se pide sincronizar con MVC,
  comparar módulos, dependencias, HTML y pruebas; adaptar las rutas `wwwroot`
  al standalone. No sobrescribir `EdiConfig.json` ni modificaciones del usuario.
  No propagar cambios al repo hermano salvo que el alcance lo requiera.
- No iniciar EDI ni enviar comandos a hardware para una comprobación automática.
  Usar endpoints simulados y WebXR simulado; una prueba física requiere una
  petición expresa del usuario.

## Validación proporcional

Revisar `git status --short --branch` antes de editar y preservar cambios ajenos.
Para cambios de comportamiento, actualizar la prueba existente que demuestre el
resultado sin replicar detalles internos.

Desde la raíz del repo:

```powershell
node --test Tests/*.test.mjs
node --test Tests/browser/*.test.mjs
```

Las pruebas de navegador necesitan Playwright resoluble por Node y Edge instalado;
sirven el sitio estático con APIs simuladas. Para cambios de presentación,
comprobar en Edge ventana amplia y estrecha, pantalla completa y acceso a controles
con ratón y teclado. Para VR, validar entrada/salida, restauración del escritorio
y ausencia de trabajo innecesario en el frame loop con el visor simulado.

Revisar el diff final y ejecutar `git diff --check`. Informar qué se verificó,
qué falló y cualquier limitación de navegador o hardware. Si aparece un fallo
previo, comprobar su origen antes de atribuirlo al cambio.
