import test from 'node:test';
import assert from 'node:assert/strict';
import { detectVideoFormat, eyeUv, eyeAspect } from '../js/player/vr/format.mjs';
import { constrainPlacement, controllerButtons, createStillnessGate, easingAlpha, enforcementStep, insideFollowContour, gripStickAction,
    createIntensityStick, createSeekStick, horizontalStick, intensityStickVelocity, seekStickDirection, stickAction } from '../js/player/vr/motion.mjs';
import { createVideoSurface, videoGeometry } from '../js/player/vr/video-surface.mjs';
import { createMediaLayer } from '../js/player/vr/media-layer.mjs';
import { createPointerActivity } from '../js/player/vr/motion.mjs';

test('hidden VR pointer rejects brief or tiny movements and wakes after a deliberate sustained gesture', () => {
    const activity = createPointerActivity(), rotation = { x: 0, y: 0, z: 0, w: 1 };
    const at = (time, x, forced = false) => activity.update(time, { x, y: 0, z: 0 }, rotation, forced);
    assert.equal(at(0, 0), 1);
    assert.equal(at(1.2, 0), 0);
    assert.equal(at(1.3, .03), 0);
    assert.equal(at(1.4, .06), 0, 'brief large motion stays hidden');
    assert.equal(at(1.9, .06), 0);
    for (let i = 0; i < 15; i++) assert.equal(at(2 + i * .05, .06 + (i % 2 ? .006 : 0)), 0, 'small jitter stays hidden');
    for (let i = 0; i < 9; i++) assert.equal(at(3 + i * .05, .06 + i * .012), 0, 'delay must elapse');
    assert.equal(at(3.5, .18), 1);
    assert.equal(at(5, .18), 0);
    assert.equal(at(5.01, .18, true), 1, 'interaction responds immediately');
});

test('hidden VR pointer also accepts a sustained rotation without translation', () => {
    const activity = createPointerActivity(), position = { x: 0, y: 0, z: 0 };
    const at = (time, yaw) => activity.update(time, position, { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
    at(0, 0); assert.equal(at(1.2, 0), 0);
    for (let i = 0; i < 9; i++) assert.equal(at(2 + i * .05, i * .025), 0);
    assert.equal(at(2.5, .25), 1);
});

test('VR filename conventions detect only flat mono or side-by-side screens', () => {
    for (const [name, stereo, swapEyes] of [
        ['scene.mp4', 'mono', false], ['Scene_3DH.MP4', 'sbs', false],
        ['scene_HSBS.mkv', 'sbs', false], ['scene_halfsbs.mp4', 'sbs', false],
        ['scene_180_LR.mp4', 'sbs', false], ['scene_VR180_RL.mp4', 'sbs', true],
        ['scene_360_SBS.mp4', 'sbs', false], ['360days_2.mp4', 'mono', false]
    ]) {
        const format = detectVideoFormat(name);
        assert.deepEqual([format.stereo, format.swapEyes], [stereo, swapEyes], name);
        assert.equal('projection' in format, false);
    }
});

test('each eye receives its own reversible SBS region', () => {
    assert.deepEqual(eyeUv(.5, .5, 0, { stereo: 'sbs' }), [.25, .5]);
    assert.deepEqual(eyeUv(.5, .5, 1, { stereo: 'sbs' }), [.75, .5]);
    assert.deepEqual(eyeUv(.5, .5, 0, { stereo: 'sbs', swapEyes: true }), [.75, .5]);
    assert.equal(eyeAspect(3840, 1080, { stereo: 'sbs' }), 16 / 9);
    assert.equal(eyeAspect(1920, 1080, detectVideoFormat('movie_HSBS.mp4')), 16 / 9);
});

test('video geometry stays a simple flat plane with separate SBS eye UVs', () => {
    const settings = { ...detectVideoFormat('scene_180_LR.mp4'), width: 2.4 };
    const geometries = [0, 1].map(eye => videoGeometry({ videoWidth: 3840, videoHeight: 1080 }, settings, eye));
    geometries.forEach((geometry, eye) => {
        assert.equal(geometry.attributes.position.count, 4);
        const uv = geometry.attributes.uv;
        for (let index = 0; index < uv.count; index++) {
            assert.ok(uv.getX(index) >= eye / 2 && uv.getX(index) <= (eye + 1) / 2);
            assert.ok(uv.getY(index) >= 0 && uv.getY(index) <= 1);
        }
        geometry.dispose();
    });
});

test('video curvature bends only the horizontal plane and remains bounded', () => {
    const flat = videoGeometry({ videoWidth: 1920, videoHeight: 1080 }, { stereo: 'mono', width: 2.4, curvature: 0 }, 0);
    const curved = videoGeometry({ videoWidth: 1920, videoHeight: 1080 }, { stereo: 'mono', width: 2.4, curvature: 1.6 }, 0);
    assert.equal(flat.attributes.position.count, 4);
    assert.ok(curved.attributes.position.count > flat.attributes.position.count);
    const position = curved.attributes.position;
    assert.ok(position.getZ(0) > 0, 'curved edges wrap toward the viewer');
    assert.ok(Math.abs(Math.abs(position.getX(0)) - 1.2) < 1e-6, 'curvature preserves visible width');
    assert.equal(new Set(Array.from({ length: position.count }, (_, index) => position.getY(index))).size, 2);
    flat.dispose(); curved.dispose();
});

test('head follow waits for stillness, tolerates micro motion and resets after cumulative turns', () => {
    const gate = createStillnessGate();
    const pose = yaw => ({ position: [0, 1.6, 0], rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)] });
    assert.equal(gate.ready(0, pose(0), 2), false);
    assert.equal(gate.ready(1.9, pose(.005), 2), false);
    assert.equal(gate.ready(2, pose(.008), 2), true);
    assert.equal(gate.ready(2.1, pose(.04), 2), false);
    assert.equal(gate.ready(4, pose(.04), 2), false);
    assert.equal(gate.ready(4.11, pose(.04), 2), true);
    gate.reset();
    assert.equal(gate.ready(20, pose(.04), 2), false);
});

test('smoothing is frame-rate independent and cannot overshoot after a suspended frame', () => {
    assert.ok(Math.abs(1 - Math.pow(1 - easingAlpha(1 / 90, .6), 90) - easingAlpha(1, .6)) < 1e-12);
    assert.equal(easingAlpha(-1, .6), 0);
    assert.ok(easingAlpha(10, .6) <= 1);
});

test('follow contour scales independently with the current video width and height', () => {
    assert.equal(insideFollowContour({ x: .9, y: 0 }, 2.4, 1.35), true);
    assert.equal(insideFollowContour({ x: 0, y: .6 }, 2.4, 1.35), false);
    assert.equal(insideFollowContour({ x: 1.1, y: 0 }, 2.4, 1.35), false);
    assert.equal(insideFollowContour({ x: 1.1, y: 0 }, 6, 3.375), true);
});

test('enforcement starts timidly, is confident in the middle and slows for final precision', () => {
    const timid = enforcementStep(1, 1, 0, 1 / 90, .6);
    const confident = enforcementStep(.6, 1, .6, 1 / 90, .6);
    const precise = enforcementStep(.01, 1, 1.2, 1 / 90, .6);
    assert.ok(timid < confident);
    assert.ok(precise < confident);
    assert.ok(precise > 0 && precise <= .01);
});

test('native media and WebGL controls are composed as separate ordered streams', () => {
    const previousBinding = globalThis.XRMediaBinding, previousTransform = globalThis.XRRigidTransform;
    class Transform { constructor(position = {}, orientation = {}) { this.position = position; this.orientation = orientation; } }
    class Binding { createQuadLayer(video, options) { return { video, ...options }; } }
    globalThis.XRMediaBinding = Binding; globalThis.XRRigidTransform = Transform;
    try {
        const projectionLayer = { kind: 'controls' };
        const session = { renderState: { layers: [projectionLayer] },
            updateRenderState(update) { this.renderState = { ...this.renderState, ...update }; } };
        const settings = { width: 2.4, curvature: 0, stereo: 'sbs', swapEyes: false };
        const media = createMediaLayer({ session, referenceSpace: {}, projectionLayer,
            video: { videoWidth: 3840, videoHeight: 1080 },
            settings });
        assert.equal(media.rebuild(), true);
        assert.equal(session.renderState.layers.length, 2);
        assert.equal(session.renderState.layers[0].layout, 'stereo-left-right');
        assert.equal(session.renderState.layers[1], projectionLayer);
        media.update({ x: 1, y: 2, z: -3 }, { x: 0, y: 0, z: 0, w: 1 });
        assert.deepEqual(session.renderState.layers[0].transform.position, { x: 1, y: 2, z: -3 });
        const original = session.renderState.layers[0];
        settings.curvature = 1;
        assert.equal(media.rebuild(), false);
        settings.curvature = 0; settings.width = 3;
        assert.equal(media.rebuild({ x: 1, y: 2, z: -3 }, { x: 0, y: 0, z: 0, w: 1 }), true);
        assert.equal(session.renderState.layers[0], original);
        assert.equal(original.width, 3);
        assert.deepEqual(original.transform.position, { x: 1, y: 2, z: -3 });
        media.remove();
        assert.deepEqual(session.renderState.layers, [projectionLayer]);
    } finally {
        globalThis.XRMediaBinding = previousBinding; globalThis.XRRigidTransform = previousTransform;
    }
});

test('VR screen placement stays in front of the viewer and inside a useful viewing cone', () => {
    assert.deepEqual(constrainPlacement({ x: 20, y: -20, z: 2 }), { x: .3825, y: -.29250000000000004, z: -.45 });
    assert.deepEqual(constrainPlacement({ x: 5, y: 5, z: -2 }), { x: 1.7, y: 1.3, z: -2 });
    assert.deepEqual(constrainPlacement({ x: .5, y: -.5, z: -20 }), { x: .5, y: -.5, z: -8 });
});

test('stick intensity is the default; horizontal seek requires the explicit video target', () => {
    assert.deepEqual(stickAction([0, 0, 1, 0]), { kind: 'intensity', value: 0 });
    assert.deepEqual(stickAction([0, 0, 1, 0], 'seek'), { kind: 'seek', value: 1 });
    assert.deepEqual(stickAction([0, 0, 0, -1], 'volume'), { kind: 'volume', value: 1 });
    assert.deepEqual(stickAction([0, 0, 0, -.15]), { kind: 'intensity', value: 0 });
    assert.deepEqual(stickAction([0, 0, 0, 1]), { kind: 'intensity', value: -1 });
});

test('Quest intensity uses a fine center curve and a refresh-independent full-stick speed', () => {
    assert.equal(intensityStickVelocity(0), 0);
    assert.ok(intensityStickVelocity(.25) < 4);
    assert.ok(intensityStickVelocity(-.25) > -4);
    assert.equal(intensityStickVelocity(1), 200);
    assert.equal(intensityStickVelocity(-1), -200);
});

test('analog intensity integrates time at 4 Hz without a special tap step', () => {
    for (const hz of [60, 72, 90, 120]) {
        const stick = createIntensityStick();
        let total = 0, commits = 0;
        for (let frame = 0; frame < hz / 2; frame++) {
            const step = stick.update(1, 1 / hz);
            total += step; if (step) commits++;
        }
        total += stick.update(0, 0);
        assert.equal(total, 100, `${hz} Hz: full range in half a second`);
        assert.ok(commits <= 2);
    }
    const tap = value => {
        const stick = createIntensityStick();
        stick.update(value, .05);
        return stick.update(0, 0);
    };
    assert.equal(tap(.05), 0);
    assert.equal(tap(.5), 1);
    assert.equal(tap(1), 10);
    assert.equal(tap(-.5), -1);
    const stick = createIntensityStick();
    assert.equal(stick.update(1, .1), 0);
    stick.reset();
    assert.equal(stick.update(0, .01), 0);
    stick.update(1, .1);
    stick.update(-.5, .05);
    assert.equal(stick.update(0, 0), -1);
});

test('VR seek requires 80 percent horizontal travel and rejects vertical diagonals', () => {
    assert.equal(seekStickDirection([0, 0, .79, 0]), 0);
    assert.equal(seekStickDirection([0, 0, .8, .2]), 1);
    assert.equal(seekStickDirection([0, 0, -.8, 0]), -1);
    assert.equal(seekStickDirection([0, 0, 1, -.6]), 0);
    assert.equal(seekStickDirection([0, 0, .75, 0], 1), 1);
    assert.equal(seekStickDirection([0, 0, .69, 0], 1), 0);
});

test('held VR seek repeats at 4 Hz, accelerates with a cap and resets on release or reversal', () => {
    const seek = createSeekStick();
    assert.equal(seek.update(1, 0), 10);
    assert.equal(seek.update(1, .49), 0);
    assert.equal(seek.update(1, .5), 10);
    assert.equal(seek.update(1, .6), 0);
    assert.equal(seek.update(1, .75), 12);
    assert.equal(seek.update(1, 1), 14);
    assert.equal(seek.update(1, 3), 30);
    assert.equal(seek.update(1, 10), 30); // no catch-up burst after a stalled frame
    assert.equal(seek.update(-1, 10.01), -10);
    assert.equal(seek.update(-1, 10.51), -10);
    assert.equal(seek.update(-1, 11.01), -14);
    assert.equal(seek.update(0, 11.02), 0);
    assert.equal(seek.update(-1, 11.03), -10);
    seek.reset();
    assert.equal(seek.update(-1, 11.04), -10);
});

test('grip stick separates size and curve while a lateral stick has a deliberate threshold', () => {
    assert.deepEqual(gripStickAction([0, 0, .61, -.61]), { curve: -.5, scale: .5 });
    assert.deepEqual(gripStickAction([0, 0, -.61, -.61]), { curve: .5, scale: .5 });
    assert.equal(horizontalStick([.64, 0, 0, 0], 'standard'), 0);
    assert.equal(horizontalStick([-.8, 0, .7, 0], 'standard'), -1);
    assert.equal(horizontalStick([0, 0, .8, 0], 'xr-standard'), 1);
});

test('A/B are rising-edge actions and unsupported gamepad layouts are ignored', () => {
    const source = { gamepad: { mapping: 'xr-standard', buttons: Array.from({ length: 6 }, () => ({ pressed: false })) } };
    source.gamepad.buttons[4].pressed = true;
    assert.equal(controllerButtons(source).primary, true);
    assert.equal(controllerButtons(source, [true, false]).primary, false);
    source.gamepad.buttons[5].pressed = true;
    assert.equal(controllerButtons(source, [true, false]).variant, true);
    source.gamepad.buttons[3].pressed = true;
    assert.equal(controllerButtons(source, [true, true, false]).stick, true);
    source.gamepad.mapping = '';
    assert.equal(controllerButtons(source).primary, false);
    assert.equal(controllerButtons(source).variant, false);
});

 test('SBS curvature transitions retain texture, width and eye aspect', () => {
    const settings = { stereo: 'sbs', width: 2.4, curvature: 0 };
    const surface = createVideoSurface({ videoWidth: 3840, videoHeight: 1080 }, settings);
    const texture = surface.meshes()[0].material.map;
    for (const curve of [.001, .8, 1.6, .05, 0, 1.6, 0]) {
        settings.curvature = curve;
        surface.rebuild();
        assert.equal(surface.meshes()[0].material.map, texture);
        assert.deepEqual(surface.dimensions(), { width: 2.4, height: 1.35 });
        const positions = surface.meshes()[0].geometry.attributes.position;
        assert.ok(Math.abs(Math.abs(positions.getX(0)) - 1.2) < 1e-6);
        assert.ok(Array.from(positions.array).every(Number.isFinite));
    }
    surface.dispose();
});

test('curving preserves horizontal image proportions in mono and both SBS eyes', () => {
    for (const stereo of ['mono', 'sbs']) for (const eye of [0, 1]) {
        for (const curvature of [.000001, .05, .8, 1.6]) {
            const settings = { stereo, width: 2.4, curvature };
            const geometry = videoGeometry({ videoWidth: 3840, videoHeight: 1080 }, settings, eye);
            const positions = geometry.attributes.position, uv = geometry.attributes.uv;
            for (let i = 1; i < 64; i++) {
                const u = stereo === 'sbs' ? uv.getX(i) * 2 - eye : uv.getX(i);
                assert.ok(Math.abs(positions.getX(i) - (u - .5) * settings.width) < 3e-7,
                    'image columns retain their flat-screen horizontal position, including the center');
            }
            assert.ok(Array.from(positions.array).every(Number.isFinite));
            geometry.dispose();
        }
    }
});
