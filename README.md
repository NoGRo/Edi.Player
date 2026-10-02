# EDI Player

This is an independent repository, normally checked out beside the EDI repository
as `../Edi.Player`. It contains only the website and its tests. EDI WPF and its
embedded API remain in EDI.

Standalone static player, including the VR functionality integrated from `VrFirstTest`
(commits b53e390, e8816c2, 463056b). No MVC host or JavaScript build is required.

Select this `Edi.Player` folder as a game in EDI WPF, then open
http://127.0.0.1:5000/ in the browser. The bundled EdiConfig.json enables
AutoLaunch and sets ExecuteOnReady to that URL: WPF opens the default browser
automatically once at least one device is ready. EDI serves index.html and its CSS,
JavaScript modules and libraries directly from the selected game folder.
API requests use the same origin. Selecting another game changes the served site.

Game files remain available under `/Edi/Assets/` when scripts are uploaded.
Temporary repository inputs are served separately under `/Edi/Upload/`.
Uploading still changes the active playback definitions; it does not change
which selected game folder hosts the website. Videos stay in the selected
folder or browser-local storage; the upload API accepts repository inputs only.

For immersive WebXR, use a browser supporting WebXR in a secure context
(loopback is suitable for local use). See js/player/vr/README.md for controls
and supported video formats.

Run unit tests from this repository: `node --test Tests/*.test.mjs`.
Optional browser tests require Playwright and Edge:
`node --test Tests/browser/*.test.mjs`.
