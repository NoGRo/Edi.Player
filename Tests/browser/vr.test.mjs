import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep, join } from 'node:path';
import { tmpdir } from 'node:os';
import { installFakeXr } from './fake-xr.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = fileURLToPath(new URL('../../', import.meta.url));
async function rig(run) {
    const server = createServer(async (request, response) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        const path = resolve(root, pathname === '/' ? 'index.html' : `.${pathname}`);
        if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) { response.writeHead(403).end(); return; }
        try {
            response.writeHead(200, { 'Content-Type': { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }[extname(path)] || 'application/octet-stream' });
            response.end(await readFile(path));
        } catch { response.writeHead(404).end(); }
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    let browser;
    try {
        browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-webxr-testing', '--enable-blink-test-features'] });
        const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } }), errors = [], calls = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/Edi/**', route => { calls.push(route.request().url()); return route.fulfill({ json: [] }); });
        await page.route('**/Devices**', route => route.fulfill({ json: [{ name: 'Preview', isReady: true,
            variants: ['default', 'fast', 'None'], selectedVariant: 'default', min: 0, max: 100, baseMin: 0, baseMax: 100 }] }));
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.waitForFunction(() => document.querySelector('.device-card') && document.querySelector('#vrSettings'));
        await run(page, calls);
        assert.deepEqual(errors, []);
    } finally {
        await browser?.close();
        await new Promise(done => server.close(done));
    }
}

async function addVideo(page, name = 'scene_180_LR.webm') {
    const fixture = await readFile(new URL('./drop-video.webm', import.meta.url));
    await page.evaluate(({ encoded, name }) => {
        const data = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
        const transfer = new DataTransfer(); transfer.items.add(new File([data], name, { type: 'video/webm' }));
        window.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, { encoded: fixture.toString('base64'), name });
    await page.waitForFunction(() => document.querySelector('#videoPlayer').readyState >= 2);
}

test('VR summary paints shared colored feedback, fades and releases its listener', async () => rig(async page => {
    await addVideo(page);
    await installFakeXr(page);
    await page.evaluate(() => document.querySelector('#enterVr').click());
    await page.waitForFunction(() => window.fakeXr.panels.some(mesh => mesh.userData.playerSummary));
    await page.evaluate(async () => {
        window.summaryModels = [];
        document.addEventListener('edi-player-overlay', event => window.summaryModels.push(event.detail));
        document.dispatchEvent(new CustomEvent('edi-variant-switched', { detail: { devices: [{ side: 'A', variant: 'fast' }] } }));
    });
    await page.waitForFunction(() => window.fakeXr.panels.find(mesh => mesh.userData.playerSummary).material.opacity === 1);
    const result = await page.evaluate(() => {
        const mesh = window.fakeXr.panels.find(mesh => mesh.userData.playerSummary);
        const image = mesh.material.map.image;
        window.summaryMesh = mesh;
        window.summaryVersion = mesh.material.map.version;
        return { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z,
            pixels: [...image.getContext('2d').getImageData(0, 0, image.width, image.height).data].some(value => value > 0),
            model: window.summaryModels.find(model => model.visible), image: image.toDataURL() };
    });
    assert.ok(result.x > 0 && result.y > 0 && result.z > 0);
    assert.equal(result.pixels, true);
    assert.deepEqual(result.model.parts, [{ icon: 'variant', color: '#fff' }, { text: 'A: fast', color: '#fff' }]);
    await writeFile(join(tmpdir(), 'edi-vr-summary-qa.png'), Buffer.from(result.image.split(',')[1], 'base64'));
    await page.waitForFunction(() => !window.summaryMesh.visible);
    assert.equal(await page.evaluate(() => window.summaryMesh.material.map.version), await page.evaluate(() => window.summaryVersion));
    const resized = await page.evaluate(() => {
        const mesh = window.summaryMesh;
        const before = mesh.position.x;
        const width = document.querySelector('[data-vr-setting=width]');
        width.value = Number(width.value) * 1.5; width.dispatchEvent(new Event('input', { bubbles: true }));
        const after = mesh.position.x;
        const curve = document.querySelector('[data-vr-setting=curvature]');
        curve.value = 1.2; curve.dispatchEvent(new Event('input', { bubbles: true }));
        return { ratio: after / before, z: mesh.position.z, x: mesh.position.x, after };
    });
    assert.ok(Math.abs(resized.ratio - 1.5) < .001, 'summary keeps its relative upper-right position when resized');
    assert.equal(resized.x, resized.after);
    assert.ok(resized.z > .1, 'summary remains in front of the curved screen');
    await page.evaluate(() => {
        window.summaryMovementTimer = setInterval(() => document.dispatchEvent(new CustomEvent('edi-vr-summary-movement')), 100);
    });
    await page.waitForFunction(() => window.summaryModels.some(model => model.parts?.[0]?.icon === 'stroker' && model.duration === 650));
    const activitySummary = await page.evaluate(() => {
        clearInterval(window.summaryMovementTimer);
        return window.summaryModels.find(model => model.parts?.[0]?.icon === 'stroker');
    });
    assert.equal(activitySummary.parts[1].text.endsWith('%'), true);
    assert.equal(activitySummary.parts[2].text, 'A: fast');
    await page.evaluate(async () => {
        const { createOverlays } = await import('/js/player/overlays.mjs');
        const overlays = createOverlays({ state: {}, elements: { video: document.querySelector('video'),
            intensityOverlay: document.createElement('div'), optionButtons: { intensity: document.querySelector('#intensityToggle') } },
        presentation: {}, playerUiActive: () => false, hideFullscreenToolbar() {} });
        overlays.showIntensityOverlay(0);
    });
    await page.waitForFunction(() => window.summaryMesh.material.opacity === 1);
    const zero = await page.evaluate(() => {
        const canvas = window.summaryMesh.material.map.image;
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let red = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 180 && pixels[i + 1] < 90 && pixels[i + 2] < 110) red++;
        return { red, model: window.summaryModels.at(-1) };
    });
    assert.ok(zero.red > 10, 'zero intensity paints red icon and text');
    assert.equal(zero.model.parts[1].text, '0%');
    await page.evaluate(async () => { await window.fakeXr.session.end(); window.summaryVersion = window.summaryMesh.material.map.version; });
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('edi-variant-switched', { detail: { devices: [{ variant: 'default' }] } })));
    assert.equal(await page.evaluate(() => window.summaryMesh.material.map.version), await page.evaluate(() => window.summaryVersion));
}));

test('VR pointer stays hidden through jitter and brief motion until a sustained deliberate movement', async () => rig(async page => {
    await addVideo(page, 'scene.webm');
    await installFakeXr(page);
    await page.evaluate(async () => {
        const THREE = await import('/lib/vr/three.module.min.js'), add = THREE.Group.prototype.add;
        window.pointerLines = [];
        THREE.Group.prototype.add = function(...objects) {
            window.pointerLines.push(...objects.filter(object => object.isLine));
            return add.apply(this, objects);
        };
        document.querySelector('#enterVr').click();
    });
    await page.waitForFunction(() => window.fakeXr.session?.frames > 5);
    const step = async (time, x) => {
        await page.evaluate(({ time, x }) => {
            window.fakeXr.session.clock = time; window.fakeXr.session.rayPosition[0] = x;
            window.pointerFrame = window.fakeXr.session.frames;
        }, { time, x });
        await page.waitForFunction(() => window.fakeXr.session.frames > window.pointerFrame + 1);
        return page.evaluate(() => window.pointerLines.some(line => line.visible));
    };
    assert.equal(await step(10000, .2), false);
    for (let i = 0; i < 14; i++) assert.equal(await step(10100 + i * 50, .2 + (i % 2 ? .006 : 0)), false);
    assert.equal(await step(11000, .2), false);
    assert.equal(await step(11050, .23), false);
    assert.equal(await step(11100, .26), false, 'a quick movement cannot wake the pointer');
    assert.equal(await step(11500, .26), false);
    for (let i = 1; i <= 9; i++) assert.equal(await step(11500 + i * 50, .26 + i * .012), false);
    assert.equal(await step(12050, .392), true);
    await page.evaluate(() => window.fakeXr.session.end());
}));

test('VR settings detect media, remember overrides and explain unavailable sessions', async () => rig(async page => {
    await addVideo(page);
    await page.locator('#vrSettingsToggle').click();
    assert.equal(await page.locator('[data-vr-setting=projection]').count(), 0);
    assert.equal(await page.locator('[data-vr-setting=stereo]').inputValue(), 'sbs');
    await page.locator('[data-vr-setting=stereo]').selectOption('mono');
    await page.locator('[data-vr-setting=follow]').check();
    assert.equal(await page.locator('#vrFollowToggle').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[data-vr-setting=follow]').isChecked(), true);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('edi-player-vr')).formats['scene_180_lr.webm'].stereo), 'mono');
    await page.locator('[data-vr-auto]').click();
    assert.equal(await page.locator('[data-vr-setting=stereo]').inputValue(), 'sbs');
    await page.evaluate(() => {
        Object.defineProperty(navigator, 'xr', { configurable: true, value: undefined });
        document.querySelector('#enterVr').hidden = true;
    });
    assert.equal(await page.locator('#enterVr').isHidden(), true);
    assert.equal(await page.locator('#playbackToolbar').evaluate(node => node.parentElement.className), 'player-controls mb-2');
    assert.equal(await page.locator('#enterVr').isEnabled(), true);
}));

test('VR HTML panels paint the original controls, dispatch changes, reflect mutations and restore them', async () => rig(async page => {
    await addVideo(page);
    await page.locator('#vrSettingsToggle').click();
    await page.evaluate(async () => {
        const { getPlayerElements } = await import('/js/player/elements.mjs');
        const { createHtmlPanels } = await import('/js/player/vr/html-panels.mjs');
        const THREE = await import('/lib/vr/three.module.min.js');
        const elements = getPlayerElements(); elements.intensityOverlay = document.querySelector('.edi-intensity-overlay');
        const originals = [elements.playbackToolbar, elements.deviceControls, elements.customVideoControls,
            elements.dropZone, elements.devicesPanel, document.querySelector('#vrSettings')].map(node => ({ node, parent: node.parentElement }));
        const preferences = { width: 2.4, stereo: 'sbs', swapEyes: false, halfResolution: false };
        const errors = [], panels = await createHtmlPanels({ rig: new THREE.Group(), elements, preferences, exit: async () => {}, onError: error => errors.push(error.message) });
        const timer = setInterval(() => panels.update(performance.now() / 1000), 25);
        window.vrTest = { panels, originals, errors, timer,
            hit(selector) {
                const element = document.querySelector(selector);
                const panel = panels.meshes().map(mesh => mesh.userData.panel).find(panel => panel.root.contains(element));
                const rect = element.getBoundingClientRect(), bounds = panel.root.getBoundingClientRect();
                return panels.hitAt(panel, { x: (rect.x + rect.width / 2 - bounds.x) / panel.width,
                    y: 1 - (rect.y + rect.height / 2 - bounds.y) / panel.height });
            },
            click(selector) { const hit = this.hit(selector); const press = panels.press(hit); panels.release(press, hit); }
        };
    });
    await page.waitForFunction(() => window.vrTest.panels.meshes().length === 1 && window.vrTest.panels.meshes()[0].userData.panel.captured);
    const snapshot = await page.evaluate(() => window.vrTest.panels.meshes()[0].material.map.image.toDataURL());
    await writeFile(join(tmpdir(), 'edi-vr-settings-qa.png'), Buffer.from(snapshot.split(',')[1], 'base64'));
    await page.evaluate(() => {
        window.vrTest.loopTextureVersion = window.vrTest.panels.meshes()[0].material.map.version;
        window.vrTest.click('#loopToggle');
    });
    assert.equal(await page.locator('#loopToggle').getAttribute('aria-label'), 'Repeat video');
    await page.waitForFunction(() => window.vrTest.panels.meshes()[0].material.map.version > window.vrTest.loopTextureVersion);
    await page.evaluate(() => {
        window.vrTest.popupTextureVersion = window.vrTest.panels.meshes()[0].material.map.version;
        window.vrTest.click('[data-vr-setting=stereo]');
    });
    await page.waitForFunction(() => document.querySelector('.vr-popup')
        && window.vrTest.panels.meshes()[0].material.map.version > window.vrTest.popupTextureVersion);
    const option = await page.evaluate(() => [...document.querySelectorAll('.vr-popup button')].find(button => button.textContent.includes('Mono')).textContent);
    await page.evaluate(label => {
        const button = [...document.querySelectorAll('.vr-popup button')].find(node => node.textContent === label);
        button.id = 'testVrOption'; window.vrTest.click('#testVrOption');
    }, option);
    assert.equal(await page.locator('[data-vr-setting=stereo]').inputValue(), 'mono');
    assert.equal(await page.locator('.vr-popup').count(), 0);
    await page.evaluate(() => {
        const hit = window.vrTest.hit('#customVolume');
        const range = hit.panel.hits.find(item => item.element.id === 'customVolume');
        hit.x = range.inputLeft + range.inputWidth * .25;
        const press = window.vrTest.panels.press(hit); window.vrTest.panels.release(press, hit);
    });
    assert.equal(await page.locator('#videoPlayer').evaluate(video => video.volume), .25);
    const restored = await page.evaluate(() => {
        clearInterval(window.vrTest.timer); window.vrTest.panels.dispose();
        return { errors: window.vrTest.errors, restored: window.vrTest.originals.every(({ node, parent }) => node.parentElement === parent) };
    });
    assert.deepEqual(restored, { errors: [], restored: true });
    assert.equal(await page.locator('.vr-dom-panels').count(), 0);
    assert.equal(await page.locator('#customVideoControls').count(), 1);
}));

test('immersive startup keeps producing frames without a hidden runtime error', async () => rig(async page => {
    await addVideo(page, 'scene_SBS.webm');
    await installFakeXr(page);
    await page.evaluate(async () => {
        const THREE = await import('/lib/vr/three.module.min.js');
        const add = THREE.Group.prototype.add;
        THREE.Group.prototype.add = function(...objects) {
            const result = add.apply(this, objects);
            if (objects.some(mesh => mesh.material?.map?.isVideoTexture)) window.startupVideoSurface = this.parent;
            return result;
        };
        window.XRWebGLLayer.getNativeFramebufferScaleFactor = () => 1.4;
        window.mediaLayerCreations = 0;
        window.XRMediaBinding = class {
            createQuadLayer(video, options) { window.mediaLayerCreations++; return { ...options }; }
        };
        window.XRRigidTransform = class {};
        const requestSession = navigator.xr.requestSession;
        navigator.xr.requestSession = async (...args) => {
            const session = await requestSession(...args);
            session.renderState.layers = [];
            return session;
        };
        document.querySelector('#enterVr').click();
    });
    await page.waitForFunction(() => window.startupVideoSurface && window.ediVrDiagnostics?.frames > 10);
    assert.equal(await page.evaluate(() => window.ediVrDiagnostics.lastError), null);
    assert.equal(await page.evaluate(() => window.startupVideoSurface.visible), true);
    const quality = await page.evaluate(() => window.ediVrDiagnostics.quality);
    assert.equal(quality.framebufferScale, 1.4);
    assert.equal(await page.evaluate(() => window.fakeXr.session.renderState.baseLayer.framebufferScaleFactor), 1.4);
    assert.equal(quality.foveation, 0);
    assert.equal(quality.antialias, true);
    assert.ok(quality.anisotropy >= 1);
    assert.deepEqual([quality.sourceWidth, quality.sourceHeight], await page.evaluate(() => {
        const video = document.querySelector('#videoPlayer'); return [video.videoWidth, video.videoHeight];
    }));
    assert.equal(await page.evaluate(() => {
        const texture = window.startupVideoSurface.children[0].children[0].material.map;
        return texture.image === document.querySelector('#videoPlayer')
            && texture.anisotropy === window.ediVrDiagnostics.quality.anisotropy;
    }), true, 'VR samples the original video with the supported anisotropy');
    assert.ok(await page.evaluate(() => window.startupVideoSurface.position.toArray().every(Number.isFinite)));
    const transitions = await page.evaluate(async () => {
        const video = window.startupVideoSurface;
        const texture = video.children[0].children[0].material.map;
        const position = video.position.toArray();
        const button = window.fakeXr.panels.find(mesh => mesh.userData.exitControlButton);
        const buttonPosition = button.parent.position.toArray();
        const field = document.querySelector('[data-vr-setting=curvature]');
        const samples = [];
        for (const curvature of [.05, .8, 1.6, 0, 1, 0]) {
            field.value = curvature; field.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const mesh = video.children[0].children[0];
            samples.push({ stream: window.ediVrDiagnostics.videoStream,
                sameTexture: mesh.material.map === texture, visible: mesh.material.visible,
                position: video.position.toArray(), buttonPosition: button.parent.position.toArray(),
                width: Math.abs(mesh.geometry.attributes.position.getX(0)) * 2 });
        }
        return { samples, position, buttonPosition, creations: window.mediaLayerCreations };
    });
    assert.equal(transitions.creations, 0, 'native video support must not switch the projection');
    for (const sample of transitions.samples) {
        assert.equal(sample.stream, 'webgl-texture');
        assert.equal(sample.sameTexture, true);
        assert.equal(sample.visible, true);
        assert.deepEqual(sample.position, transitions.position);
        assert.deepEqual(sample.buttonPosition, transitions.buttonPosition);
        assert.ok(Math.abs(sample.width - 2.4) < 1e-6);
    }
    await page.evaluate(() => window.fakeXr.session.end());
}));

test('VR stick click toggles video playback once per press independently of stroker mode', async () => rig(async page => {
    await addVideo(page);
    await installFakeXr(page);
    await page.evaluate(() => {
        document.querySelector('#videoPlayer').pause();
        const stroker = document.querySelector('#strokerToggle');
        if (stroker.getAttribute('aria-pressed') !== 'true') stroker.click();
        document.querySelector('#enterVr').click();
    });
    await page.waitForFunction(() => window.fakeXr.session?.frames > 10);
    const strokerPaused = await page.locator('#strokerToggle').evaluate(button => button.classList.contains('stroker-paused'));
    await page.evaluate(() => { window.fakeXr.source.gamepad.buttons[3].pressed = true; });
    await page.waitForFunction(() => !document.querySelector('#videoPlayer').paused);
    const frames = await page.evaluate(() => window.fakeXr.session.frames);
    await page.waitForFunction(frames => window.fakeXr.session.frames > frames + 5, frames);
    assert.equal(await page.locator('#videoPlayer').evaluate(video => video.paused), false);
    const releaseFrame = await page.evaluate(() => {
        window.fakeXr.source.gamepad.buttons[3].pressed = false;
        return window.fakeXr.session.frames;
    });
    await page.waitForFunction(frames => window.fakeXr.session.frames > frames + 1, releaseFrame);
    await page.evaluate(() => { window.fakeXr.source.gamepad.buttons[3].pressed = true; });
    await page.waitForFunction(() => document.querySelector('#videoPlayer').paused);
    assert.equal(await page.locator('#strokerToggle').evaluate(button => button.classList.contains('stroker-paused')), strokerPaused);
    await page.evaluate(() => window.fakeXr.session.end());
}));

test('VR analog intensity and deliberate lateral seeking use the XR axis samples', async () => rig(async page => {
    await addVideo(page);
    await installFakeXr(page);
    await page.evaluate(() => document.querySelector('#enterVr').click());
    await page.waitForFunction(() => window.fakeXr.session?.frames > 10);
    await page.evaluate(() => {
        window.fakeXr.session.clock = 0;
        const video = document.querySelector('#videoPlayer');
        window.seekValue = 50; window.seekWrites = [];
        Object.defineProperty(video, 'duration', { configurable: true, get: () => 120 });
        Object.defineProperty(video, 'currentTime', { configurable: true,
            get: () => window.seekValue, set: value => { window.seekValue = value; window.seekWrites.push(value); } });
        window.variantEvents = 0;
        video.addEventListener('mousedown', event => { if (event.button === 2) window.variantEvents++; });
    });
    async function sample(x, y, milliseconds = 50) {
        const frames = await page.evaluate(({ x, y, milliseconds }) => {
            window.fakeXr.source.gamepad.axes[2] = x;
            window.fakeXr.source.gamepad.axes[3] = y;
            window.fakeXr.session.clock += milliseconds;
            return window.fakeXr.session.frames;
        }, { x, y, milliseconds });
        await page.waitForFunction(frames => window.fakeXr.session.frames > frames + 1, frames);
    }
    await sample(0, 0, 0);
    for (let i = 0; i < 10; i++) await sample(.8, 1);
    assert.equal(await page.evaluate(() => Number(localStorage.getItem('edi-player-intensity'))), 0);
    assert.deepEqual(await page.evaluate(() => window.seekWrites), []);
    await sample(0, 0);
    await sample(0, -.5);
    await sample(0, -.5);
    await sample(0, 0);
    assert.equal(await page.evaluate(() => Number(localStorage.getItem('edi-player-intensity'))), 1);
    for (let i = 0; i < 10; i++) await sample(0, -1);
    assert.equal(await page.evaluate(() => Number(localStorage.getItem('edi-player-intensity'))), 100);
    await sample(.79, 0);
    assert.deepEqual(await page.evaluate(() => window.seekWrites), []);
    await sample(.8, 0);
    await sample(.75, 0);
    await sample(.8, 0);
    assert.deepEqual(await page.evaluate(() => window.seekWrites), [60]);
    await sample(.8, 0, 400);
    assert.deepEqual(await page.evaluate(() => window.seekWrites), [60, 70]);
    await sample(.8, 0, 250);
    await sample(.8, 0, 250);
    assert.deepEqual(await page.evaluate(() => window.seekWrites), [60, 70, 82, 96]);
    await sample(0, 0);
    await sample(-.8, 0);
    assert.deepEqual(await page.evaluate(() => window.seekWrites), [60, 70, 82, 96, 86]);
    await sample(-.8, -.6, 1000); // A vertical diagonal stops the held seek.
    assert.deepEqual(await page.evaluate(() => window.seekWrites), [60, 70, 82, 96, 86]);
    await sample(-.8, 0);
    assert.equal(await page.evaluate(() => window.seekValue), 76);
    assert.equal(await page.evaluate(() => window.variantEvents), 0);
    await page.evaluate(() => window.fakeXr.session.end());
}));

test('immersive session renders without HTML overlays, uses A/B actions and restores the desktop', async () => rig(async (page, calls) => {
    await addVideo(page, 'scene_SBS.webm');
    await installFakeXr(page);
    await page.evaluate(() => document.querySelector('#enterVr').click());
    await page.waitForFunction(() => document.querySelector('#enterVr').getAttribute('aria-pressed') === 'true'
        && window.fakeXr.session.frames > 10);
    assert.equal(await page.locator('.vr-canvas').count(), 1);
    assert.equal(await page.locator('.vr-dom-panels').count(), 0);
    assert.equal(await page.locator('#customVideoControls').evaluate(node => node.parentElement.id), 'videoStage');
    assert.equal(await page.evaluate(() => window.ediVrDiagnostics.lastError), null);
    assert.ok(await page.evaluate(() => window.ediVrDiagnostics.frames > 10));
    await page.evaluate(() => {
        window.mouseButtons = [];
        document.querySelector('#videoPlayer').addEventListener('mousedown', event => window.mouseButtons.push(event.button));
        window.fakeXr.source.gamepad.buttons[4].pressed = true;
    });
    await page.waitForFunction(() => !document.querySelector('#videoPlayer').paused);
    await page.evaluate(() => {
        window.fakeXr.source.gamepad.buttons[4].pressed = false;
        window.buttonReleaseFrame = window.fakeXr.session.frames;
    });
    await page.waitForFunction(() => window.fakeXr.session.frames > window.buttonReleaseFrame + 1);
    await page.evaluate(() => {
        document.querySelector('#strokerToggle').click();
        window.fakeXr.source.gamepad.buttons[4].pressed = true;
    });
    await page.waitForFunction(() => document.querySelector('#strokerToggle').classList.contains('stroker-paused'));
    assert.equal(await page.locator('#videoPlayer').evaluate(video => video.paused), false);
    await page.evaluate(() => { window.fakeXr.source.gamepad.buttons[5].pressed = true; });
    await page.waitForFunction(() => window.mouseButtons.includes(2));
    await page.evaluate(() => {
        window.fakeXr.source.gamepad.buttons[4].pressed = false;
        window.fakeXr.source.gamepad.buttons[5].pressed = false;
        window.fakeXr.session.pointAt(0, 2.8, -3); // Outside all control panels.
        window.fakeXr.source.gamepad.axes[3] = -1;
    });
    await page.waitForFunction(() => Number(localStorage.getItem('edi-player-intensity')) >= 5);
    assert.ok(calls.some(path => path.includes('/Edi/Intensity/')));
    await page.evaluate(() => {
        window.fakeXr.source.gamepad.axes[3] = 0;
    });
    await page.evaluate(() => {
        window.fakeXr.source.gamepad.axes[2] = 0;
        window.fakeXr.session.pointAt(0, 1.6, -2);
        window.fakeXr.session.trigger('selectstart');
        window.fakeXr.session.rayPosition[0] += .3;
        window.dragFrame = window.fakeXr.session.frames;
    });
    await page.waitForFunction(() => window.fakeXr.session.frames > window.dragFrame + 3);
    await page.evaluate(() => window.fakeXr.session.trigger('selectend'));
    assert.ok(Math.abs(await page.evaluate(() => JSON.parse(localStorage.getItem('edi-player-vr')).view.offsetX) - .3) < .02);
    for (const [stereo, delta, expected] of [['sbs', .3, .6], ['mono', -.25, .35]]) {
        await page.evaluate(({ stereo, delta }) => {
            const field = document.querySelector('[data-vr-setting=stereo]'); field.value = stereo; field.dispatchEvent(new Event('input', { bubbles: true }));
            const offset = JSON.parse(localStorage.getItem('edi-player-vr')).view.offsetX;
            window.fakeXr.session.pointAt(offset, 1.6, -2);
            window.fakeXr.session.trigger('squeezestart');
            window.fakeXr.session.rayPosition[0] += delta;
            window.dragFrame = window.fakeXr.session.frames;
        }, { stereo, delta });
        await page.waitForFunction(() => window.fakeXr.session.frames > window.dragFrame + 3);
        await page.evaluate(() => window.fakeXr.session.trigger('squeezeend'));
        assert.ok(Math.abs(await page.evaluate(() => JSON.parse(localStorage.getItem('edi-player-vr')).view.offsetX) - expected) < .02, `grip ${stereo}`);
    }
    await page.evaluate(async () => { window.fakeXr.source.gamepad.axes[3] = 0; await window.fakeXr.session.end(); });
    await page.waitForFunction(() => !document.querySelector('.vr-canvas') && !document.querySelector('.vr-dom-panels'));
    assert.equal(await page.locator('#customVideoControls').evaluate(node => node.parentElement.id), 'videoStage');
    assert.equal(await page.locator('#enterVr').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#enterVr').isEnabled(), true);
    await page.evaluate(() => document.querySelector('#videoPlayer').pause());
    await page.evaluate(() => document.querySelector('#enterVr').click());
    await page.waitForFunction(() => document.querySelector('#enterVr').getAttribute('aria-pressed') === 'true');
    await page.evaluate(async () => { await window.fakeXr.session.end(); });
    assert.equal(await page.locator('#customVideoControls').count(), 1);
    assert.equal(await page.locator('.vr-dom-panels').count(), 0);
}));

test('the Three.js exit button appears only near the pointer and ends VR', async () => rig(async page => {
    await addVideo(page, 'scene.webm');
    await installFakeXr(page);
    await page.evaluate(() => document.querySelector('#enterVr').click());
    await page.waitForFunction(() => window.fakeXr.panels.some(mesh => mesh.userData.exitControlButton)
        && window.fakeXr.session.frames > 5);
    assert.equal(await page.locator('.vr-dom-panels').count(), 0);
    assert.equal(await page.evaluate(() => window.fakeXr.panels.find(mesh => mesh.userData.exitControlButton).visible), false);
    await page.evaluate(async () => {
        const THREE = await import('/lib/vr/three.module.min.js');
        const button = window.fakeXr.panels.find(mesh => mesh.userData.exitControlButton);
        const point = button.localToWorld(new THREE.Vector3());
        window.fakeXr.session.pointAt(...point.toArray());
    });
    await page.waitForFunction(() => window.fakeXr.panels.find(mesh => mesh.userData.exitControlButton).visible);
    await page.evaluate(() => {
        window.fakeXr.session.trigger('selectstart');
        window.fakeXr.session.trigger('selectend');
    });
    await page.waitForFunction(() => document.querySelector('#enterVr').getAttribute('aria-pressed') === 'false');
    assert.equal(await page.locator('#customVideoControls').evaluate(node => node.parentElement.id), 'videoStage');
}));

test('grip keeps the video facing the viewer and locked follow waits, eases and ignores micro motion', async () => rig(async page => {
    await addVideo(page, 'scene_SBS.webm');
    await installFakeXr(page);
    await page.evaluate(async () => {
        const THREE = await import('/lib/vr/three.module.min.js');
        const add = THREE.Group.prototype.add;
        THREE.Group.prototype.add = function(...objects) {
            const result = add.apply(this, objects);
            if (objects.some(mesh => mesh.material?.map?.isVideoTexture)) window.videoSurface = this.parent;
            return result;
        };
    });
    await page.evaluate(() => document.querySelector('#enterVr').click());
    await page.waitForFunction(() => window.videoSurface && window.fakeXr.session.frames > 5);
    const step = async milliseconds => {
        await page.evaluate(milliseconds => {
            window.fakeXr.session.clock += milliseconds;
            window.poseFrame = window.fakeXr.session.frames;
        }, milliseconds);
        await page.waitForFunction(() => window.fakeXr.session.frames > window.poseFrame + 1);
    };
    const pose = () => page.evaluate(() => ({ position: window.videoSurface.position.toArray(), rotation: window.videoSurface.quaternion.toArray() }));
    await page.evaluate(() => {
        window.fakeXr.session.pointAt(0, 1.6, -2);
        window.fakeXr.session.trigger('squeezestart');
        window.fakeXr.session.rayPosition[1] += .25;
    });
    await step(50);
    await page.evaluate(() => window.fakeXr.session.trigger('squeezeend'));
    assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('edi-player-vr')).view.offsetY) > .2,
        'grip records a vertical relative placement');
    const initial = await pose();
    await page.evaluate(() => {
        window.fakeXr.session.clock = 0;
        for (const [key, value] of [['followDelay', .5], ['followEase', .15]]) {
            const field = document.querySelector(`[data-vr-setting=${key}]`);
            field.value = value; field.dispatchEvent(new Event('input', { bubbles: true }));
        }
        document.querySelector('#vrFollowToggle').click();
    });
    assert.equal(await page.locator('#vrFollowToggle').getAttribute('aria-pressed'), 'true');
    await step(0);
    await page.evaluate(() => {
        window.fakeXr.session.headPosition[0] = .01;
        window.fakeXr.session.headRotation = [0, Math.sin(.01), 0, Math.cos(.01)];
    });
    await step(600);
    assert.deepEqual((await pose()).position, initial.position);
    await page.evaluate(() => {
        window.fakeXr.session.headPosition[0] = .3;
        window.fakeXr.session.headRotation = [0, Math.sin(.35), 0, Math.cos(.35)];
    });
    await step(0);
    await step(400);
    assert.deepEqual((await pose()).position, initial.position);
    await step(200);
    let targetX = .3 - 2 * Math.sin(.7), targetZ = -2 * Math.cos(.7);
    let first = await pose();
    for (let index = 0; index < 4 && first.position[0] >= -.03; index++) {
        await step(50); first = await pose();
    }
    assert.ok(first.position[0] < -.03 && first.position[0] > targetX + .02,
        `follow eases instead of snapping: x=${first.position[0]}, target=${targetX}, diagnostics=${JSON.stringify(await page.evaluate(() => window.ediVrDiagnostics.follow))}`);
    await page.evaluate(() => {
        window.fakeXr.session.headPosition[0] = .4;
        window.fakeXr.session.headRotation = [0, Math.sin(.4), 0, Math.cos(.4)];
    });
    const beforeRetarget = await pose(); await step(50); const afterRetarget = await pose();
    assert.equal(await page.evaluate(() => window.ediVrDiagnostics.follow.catchingUp), true);
    assert.notDeepEqual(afterRetarget.position, beforeRetarget.position, 'head motion cannot cancel active enforcement');
    targetX = .4 - 2 * Math.sin(.8); targetZ = -2 * Math.cos(.8);
    for (let index = 0; index < 30; index++) await step(50);
    const settled = await pose();
    assert.ok(Math.abs(settled.position[0] - targetX) < .01 && Math.abs(settled.position[2] - targetZ) < .01);
    assert.ok(Math.abs(settled.position[1] - initial.position[1]) < .01, 'follow preserves the grip height');
    assert.ok(Math.abs(settled.rotation[1] - Math.sin(.4)) < .01);
    await page.evaluate(() => document.querySelector('#vrFollowToggle').click());
    await page.evaluate(() => {
        window.fakeXr.session.headPosition[0] = -1;
        window.fakeXr.session.headRotation = [0, Math.sin(-.35), 0, Math.cos(-.35)];
    });
    await step(1000);
    const unlocked = await pose();
    assert.deepEqual(unlocked.position, settled.position, 'unlock leaves the video position in the world');
    assert.notDeepEqual(unlocked.rotation, settled.rotation, 'the stationary screen still turns to face the viewer');
    await page.evaluate(() => {
        window.fakeXr.session.headPosition = [0, 1.6, 0];
        window.fakeXr.session.headRotation = [0, 0, 0, 1];
    });
    await step(0);
    await page.evaluate(() => {
        document.querySelector('[data-vr-recenter]').click();
        window.fakeXr.session.pointAt(0, 1.6, -2);
        window.fakeXr.session.trigger('squeezestart');
    });
    await page.evaluate(async () => {
        const THREE = await import('/lib/vr/three.module.min.js');
        const hand = new THREE.Quaternion(...window.fakeXr.session.rayRotation);
        window.fakeXr.session.rayRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .25).multiply(hand).toArray();
    });
    await step(50);
    await page.evaluate(() => window.fakeXr.session.trigger('squeezeend'));
    const facing = await page.evaluate(async () => {
        const THREE = await import('/lib/vr/three.module.min.js');
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(window.videoSurface.quaternion);
        const toHead = new THREE.Vector3(...window.fakeXr.session.headPosition).sub(window.videoSurface.position).normalize();
        return normal.dot(toHead);
    });
    assert.ok(facing > .999, 'grip rotation cannot turn the screen away from the viewer');
    await page.evaluate(() => window.fakeXr.session.end());
}));

test('a failed XR request restores controls and VR no longer depends on HTML snapshots', async () => rig(async page => {
    await page.evaluate(() => Object.defineProperty(navigator, 'xr', { configurable: true, value: {
        async requestSession() { throw new Error('Test session rejected'); }
    } }));
    await page.evaluate(() => document.querySelector('#enterVr').click());
    await page.waitForFunction(() => document.querySelector('#vrStatus').textContent.includes('Test session rejected'));
    assert.equal(await page.locator('.vr-dom-panels').count(), 0);
    await installFakeXr(page);
    await page.evaluate(() => { window.html2canvas = async () => { throw new Error('Unused HTML snapshot'); }; });
    await page.evaluate(() => document.querySelector('#enterVr').click());
    await page.waitForFunction(() => window.ediVrDiagnostics?.frames > 5);
    await page.evaluate(() => window.fakeXr.session.end());
    await page.waitForFunction(() => !document.querySelector('.vr-canvas'));
    assert.equal(await page.locator('.vr-canvas').count(), 0);
    assert.equal(await page.locator('.vr-dom-panels').count(), 0);
    assert.equal(await page.locator('#enterVr').isEnabled(), true);
    assert.equal(await page.locator('#customVideoControls').evaluate(node => node.parentElement.id), 'videoStage');
}));
