# VR browser player

Open EDI Player in the headset's WebXR browser using a **trusted HTTPS**
address, add videos/assets, then use the headset icon in the player toolbar.
The same native video, playlist, playback events and EDI synchronization continue
to own playback. Videos remain local to the browser where they were selected;
this mode does not transfer a desktop browser's File objects to another headset.
Supported codecs/resolutions depend on that browser and headset.

## Controls

| Input | Action |
| --- | --- |
| Grip / squeeze, pointing at the video | Hold to move the flat video screen inside its forward viewing cone; it stays facing the viewer |
| Trigger held on the video | Also moves/rotates it using the pointer pose |
| Point near the button below/right of the video | Reveal the lightweight Three.js `Exit VR` button |
| Trigger on `Exit VR` | End the immersive session and return to the unchanged web player |
| A (X on left Touch controller) | Original video left-mouse sequence: video play/pause, or devices pause/resume when the player stroker option is enabled |
| B (Y on left Touch controller) | Original right-mousedown variant action, respecting whether that feature is enabled |
| Stick click | Play/pause the video; while gripping the video, recenter the screen |
| Stick up/down | Analog intensity: cubic response up to 200 points/s, updated at 4 Hz and on release; respects the intensity toggle and per-device participation |
| Stick left/right at 80% travel, near horizontal | Seek back/forward 10 seconds; after 0.5 s repeat at 4 Hz, increasing each jump up to 30 seconds after 3 s held. Release below 70% or move vertically to stop and reset acceleration |

The lock button enables enforced head following. It captures the video's chosen
position relative to the current head pose and uses an inner contour derived from
the screen's current physical width and aspect ratio, so a wide screen permits
more horizontal than vertical looking. Remaining inside that contour does not
move the screen. Staying outside it for the configured delay starts enforcement;
once started, further head movement retargets the screen instead of cancelling
it. Enforcement ends only after the screen catches the current pose and the head
is still. Its motion is deliberately timid at launch, firm through the middle and
slow for the final alignment. Dragging suspends following and records the new
position on release. The menu adjusts the delay (0.5–5 s), response speed,
screen width/distance and horizontal/vertical offsets. Recenter restores the screen
in the current view. Native session visibility loss pauses playback through the
same media event/synchronization path as desktop pause.

## Video formats

The VR surface is always a flat screen. Filename matching is case insensitive and
only detects mono or side-by-side packing:

| Markers | Interpretation |
| --- | --- |
| `LR`, `SBS`, `3DH`, `3DPH` | Left/right images |
| `RL` | Right/left images |
| `HSBS` | Half-size side-by-side packing, restoring the full screen aspect |

For example, both `scene_180_LR.mp4` and `movie_SBS.mp4` open as flat SBS screens;
the `180` marker is deliberately ignored. Unmarked files open flat/mono.
Packing, eye order and half-size overrides persist **per filename** under
`edi-player-vr`; view/follow settings persist separately in the same key.
"Detect filename" clears only that video's override.

## Ownership and extensions

`immersive.mjs` owns entry, exit, preferences and the module's callback ports.
`runtime.mjs` owns the WebXR session renderer, poses, controller subscriptions,
grab/follow state and frame loop. `video-surface.mjs` owns the shared video
texture and per-eye geometries for both flat and curved screens.
`media-layer.mjs` is retained but native media promotion is disabled to keep
video and the exit control in the same projection. `format.mjs` and `motion.mjs` are hardware-free math/input seams.
`menu.mjs` owns only the additional VR settings UI. `summary.mjs` paints the shared
player feedback model directly into a canvas texture: pause, intensity, variant
notices and the activity summary retain their desktop colors and lifetimes.

The immersive runtime never moves or rasterizes the fullscreen HTML controls.
They remain in the normal web player and are not rendered over the video in VR.
The VR UI includes a canvas summary at the video's upper-right corner and a
small Three.js exit button below the screen's right edge;
its larger invisible proximity target reveals it when a controller points near
the button. Exiting cancels the frame loop and disposes controller listeners,
geometries and textures without touching the desktop DOM.
Controller movement over the video reveals the summary with the same
650 ms activity threshold and hide delay as desktop pointer movement. The canvas
is repainted only when its content changes; fades update material opacity and
scale, and resizing/curvature changes preserve its screen-relative placement.
After the pointer fades, revealing it requires at least 450 ms of sustained
movement covering 5 cm or about 9 degrees. Tiny corrections and brief movements
leave it hidden; trigger/grip interactions remain immediate.

The player composition root imports only the lightweight entry module. Three.js
loads when entering VR, from pinned local files under
`lib/vr`; normal playback does not need a CDN. No EDI API or core/device
code is changed by this mode.

Flat and curved video use the same WebGL projection as the exit control and
controller pointers. Curvature changes geometry without switching compositor
streams, so screen dimensions and placement remain consistent with the controls.
The renderer queries the headset's native framebuffer scale and uses at least
the full recommended resolution, disables
fixed foveation and enables MSAA. Size and curve adjustments reuse the video texture.
Curvature preserves horizontal image coordinates and bends only depth; it does
not widen the center. Grip + left stick increases curvature; right flattens it.
Video textures retain the decoded source resolution, sRGB color and linear filtering,
with the GPU's supported anisotropy for angled views. No per-frame mipmap generation
or full-screen blur pass is added.
These quality settings increase GPU work; smooth playback and the actual visual
result still need verification on the physical headset.

## Quest diagnostics

While a session is running, `window.ediVrDiagnostics` contains the current FPS,
last and worst JavaScript frame time, video readiness, selected video stream and
the last runtime error. The last sample remains available after leaving VR. A
frame-loop exception is also printed as `VR frame failed` and ends the session
with the error shown in the VR settings status instead of leaving a silent black
screen.

For a physical headset, enable Developer Mode and USB debugging, connect it with
ADB, open the player in Meta Quest Browser, then inspect that tab from desktop
Chrome at `chrome://inspect/#devices`. In DevTools, inspect
`window.ediVrDiagnostics` in Console and record the Performance panel while playing video and moving the screen. Inspect `fps`/`maxFrameMs` while adjusting curvature; `videoStream` stays
`webgl-texture` for both flat and curved screens.
