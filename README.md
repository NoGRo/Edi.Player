# EDI Player

EDI Player is a browser video player that synchronizes local videos and funscript
assets with devices through Easy Device Integration (EDI). It provides desktop
playback controls, playlists, per-device settings and an immersive VR mode.

## Features

- Add multiple videos and their matching scripts by choosing files or dragging
  them into the player.
- Reorder playlists, repeat videos, enable autoplay and resume from saved positions.
- Keep an asset library and player preferences in browser storage.
- Control device intensity, pause/resume and script variants, with separate
  participation settings for each device.
- Select primary and secondary variants and generate automatic variants from
  existing scripts.
- Watch videos on a movable flat screen in VR, including mono and side-by-side
  stereo video, with interactive playback, playlist and device panels.

## Requirements

- EDI WPF on Windows, with support for serving a selected game folder as a static
  website and the player asset/device API.
- A modern browser that supports the codecs used by your videos.
- For device playback, a device configured in EDI and matching script assets.
- For immersive VR, a WebXR-capable browser and headset in a secure context.
  Browser and headset support determine available codecs, resolutions and controls.

EDI provides the local web server and device connections. The player files do
not require a separate web server or a build step.

## Download and open

1. On [this repository](https://github.com/NoGRo/Edi.Player), choose **Code → Download
   ZIP** and extract it, or clone it:

   ```sh
   git clone https://github.com/NoGRo/Edi.Player.git
   ```

2. In EDI WPF, select the extracted or cloned folder as a game. Choose the folder
   containing `index.html` and `EdiConfig.json`.
3. Configure your device in EDI. The included configuration enables automatic
   launch: once at least one device is ready, WPF opens the player in your default
   browser.

You can also open [the local player](http://127.0.0.1:5000/) manually while EDI is
running with that folder selected. Open the site through EDI rather than opening
`index.html` directly from disk.

## Using the player

Add videos together with their matching `.funscript` files or other EDI repository
assets. Matching filenames associate scripts and variants with each video. Select
a playlist item, choose device variants and use the playback controls to start.
The device panel provides intensity and participation controls for multiple devices.

Videos remain in the browser where they were selected; the asset upload API is
for repository inputs such as scripts, audio and definitions. Uploading changes
EDI's active playback definitions while files in the selected game folder remain
accessible. Browser storage retains assets, settings and resume positions; videos
may need to be selected again after a reload.

The included `EdiConfig.json` uses `AutoLaunch` and `ExecuteOnReady` to open
`http://127.0.0.1:5000/` through WPF's existing device-ready launch mechanism. Set
`AutoLaunch` to `false` if you prefer to open the player manually.

## VR playback

Open the player in the browser that will run the WebXR session, add your media,
and use the headset button when immersive VR is available. Local loopback can
provide a secure context on the same computer; a separate headset needs an
accessible trusted HTTPS address. Selecting files on a desktop browser does not
transfer them to the headset browser.

The VR screen supports mono and side-by-side packing, eye-order overrides,
repositioning, resizing, recentering and delayed head following. It is a flat
virtual screen; filename markers such as `180` do not enable panoramic projection.
See the [VR guide](js/player/vr/README.md) for video naming and controller inputs.

## Development

The player is plain HTML, CSS and JavaScript modules. Run the hardware-free unit
tests from the repository folder with Node.js:

```sh
node --test Tests/*.test.mjs
```

Browser tests require Playwright available to Node.js and Microsoft Edge installed:

```sh
node --test Tests/browser/*.test.mjs
```

Browser tests serve the static site, mock EDI endpoints and simulate WebXR. They
do not require physical devices or establish physical headset compatibility.
See the [architecture guide](js/player/README.md) for module responsibilities.
