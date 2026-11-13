export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const easingAlpha = (seconds, ease) => 1 - Math.exp(-Math.max(0, seconds) / Math.max(.05, ease));
const distance = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]));
export const rotationDistance = (a, b) => 2 * Math.acos(clamp(Math.abs(a.reduce((sum, value, index) => sum + value * b[index], 0)), 0, 1));

// Once hidden, small corrections must not wake the pointer. Require a continuous
// deliberate gesture (450 ms and 5 cm or ~9 degrees), with a short jitter gap.
export function createPointerActivity() {
    let awake = true, initialized = false, lastActivity = 0, revealSince = null, lastMotion = 0;
    const previousPosition = {}, previousRotation = {}, anchorPosition = {}, anchorRotation = {};
    const capture = (position, rotation, p, q) => {
        p.x = position.x; p.y = position.y; p.z = position.z;
        q.x = rotation.x; q.y = rotation.y; q.z = rotation.z; q.w = rotation.w;
    };
    const travel = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    const angle = (a, b) => 2 * Math.acos(clamp(Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w), 0, 1));
    return { update(now, position, rotation, forced = false) {
        if (!initialized) {
            initialized = true; lastActivity = now;
            capture(position, rotation, previousPosition, previousRotation);
        }
        const moved = travel(position, previousPosition) > .004 || angle(rotation, previousRotation) > .01;
        if (awake && now - lastActivity >= 1.1) {
            awake = false; revealSince = null;
            capture(position, rotation, anchorPosition, anchorRotation);
        }
        if (forced) { awake = true; lastActivity = now; revealSince = null; }
        if (moved) {
            if (awake) lastActivity = now;
            else {
                if (revealSince === null || now - lastMotion > .16) {
                    revealSince = now;
                    capture(previousPosition, previousRotation, anchorPosition, anchorRotation);
                }
                lastMotion = now;
                if (now - revealSince >= .45 && (travel(position, anchorPosition) >= .05 || angle(rotation, anchorRotation) >= .15)) {
                    awake = true; lastActivity = now; revealSince = null;
                }
            }
            capture(position, rotation, previousPosition, previousRotation);
        }
        return awake ? 1 - clamp((now - lastActivity - .65) / .45, 0, 1) : 0;
    } };
}

// Keep the screen in the useful forward viewing cone. The limits are relative
// to distance, so a nearby screen cannot be dragged out beside the viewer while
// a distant screen still has enough room for comfortable placement.
export function constrainPlacement(position) {
    const distance = clamp(-position.z, .45, 8);
    return {
        x: clamp(position.x, -distance * .85, distance * .85),
        y: clamp(position.y, -distance * .65, distance * .65),
        z: -distance
    };
}

// Compare with a stable sample so small movements accumulate instead of silently
// resetting the stillness timer on every frame. Time is supplied by the XR loop.
export function createStillnessGate() {
    let sample = null, since = 0;
    return {
        reset() { sample = null; },
        ready(now, pose, delay) {
            if (!sample || distance(sample.position, pose.position) > .02
                || rotationDistance(sample.rotation, pose.rotation) > Math.PI / 120) {
                sample = { position: [...pose.position], rotation: [...pose.rotation] };
                since = now;
                return false;
            }
            return now - since >= delay;
        }
    };
}

// The follow boundary is expressed in the video's own dimensions. This makes
// a wide screen allow more horizontal head movement than vertical movement,
// and naturally scales the usable viewing area with distance and screen size.
export function insideFollowContour(point, width, height, inset = .12) {
    const safe = clamp(1 - inset, .5, .95);
    return Number.isFinite(point?.x) && Number.isFinite(point?.y)
        && Math.abs(point.x) <= width * .5 * safe
        && Math.abs(point.y) <= height * .5 * safe;
}

// Follow motion has three deliberate phases: a hesitant launch, a confident
// middle, and a slow precision approach. Return a distance rather than a lerp
// alpha so a suspended frame cannot overshoot its moving target.
export function enforcementStep(distance, journey, elapsed, dt, response = .6) {
    if (distance <= 0 || dt <= 0) return 0;
    const launch = .16 + .84 * clamp(elapsed / .45, 0, 1) ** 2;
    const finish = .08 + .92 * clamp(distance / Math.max(.025, journey * .22), 0, 1) ** 1.5;
    const speed = Math.max(.035, Math.max(.1, journey) / Math.max(.15, response) * launch * finish);
    return Math.min(distance, speed * Math.min(dt, .05));
}

export function stickAction(axes, target = 'intensity') {
    const x = axes?.[2] || 0, y = -(axes?.[3] || 0);
    // Seeking requires explicitly pointing at the video control surface.
    const value = target === 'seek' && Math.abs(x) > Math.abs(y) ? x : y;
    const deadzone = .22;
    return { kind: target, value: Math.abs(value) <= deadzone ? 0
        : Math.sign(value) * (Math.abs(value) - deadzone) / (1 - deadzone) };
}

// Quest thumbsticks reach their full reported range with little physical travel.
// A power curve keeps the center precise while preserving deliberate full-range changes.
export function intensityStickVelocity(value) {
    return Math.sign(value) * Math.pow(clamp(Math.abs(value), 0, 1), 3) * 200;
}

// Integrate every XR sample, publishing at 4 Hz or on release. A tap follows
// exactly the same analog curve as a sustained movement, without a bonus point.
export function createIntensityStick() {
    let remainder = 0, elapsed = 0, direction = 0;
    return {
        reset() { remainder = 0; elapsed = 0; direction = 0; },
        update(value, dt) {
            const nextDirection = Math.sign(value);
            if (nextDirection && direction && nextDirection !== direction) {
                remainder = 0; elapsed = 0;
            }
            direction = nextDirection;
            remainder += intensityStickVelocity(value) * dt;
            elapsed += dt;
            if (value && elapsed + 1e-9 < .25) return 0;
            const step = Math.round(Math.abs(remainder)) * Math.sign(remainder);
            remainder = value ? remainder - step : 0;
            elapsed = 0;
            return step;
        }
    };
}

// Require deliberate horizontal travel; hysteresis prevents threshold jitter.
export function seekStickDirection(axes, previous = 0) {
    const x = axes?.[2] || 0, y = axes?.[3] || 0;
    if (Math.abs(y) > .35) return 0;
    if (previous && Math.sign(x) === previous && Math.abs(x) >= .7) return previous;
    return Math.abs(x) >= .8 ? Math.sign(x) : 0;
}

// One immediate seek, then repeat after half a second. Holding accelerates the
// repeated jumps from 10 to 30 seconds over three seconds, with at most 4 seeks/s.
export function createSeekStick() {
    let direction = 0, started = 0, next = 0;
    return {
        reset() { direction = 0; started = 0; next = 0; },
        update(value, now) {
            if (!value) { direction = 0; return 0; }
            if (value !== direction) {
                direction = value; started = now; next = now + .5;
                return value * 10;
            }
            if (now + 1e-9 < next) return 0;
            next = now + .25;
            return value * (10 + 20 * clamp((now - started - .5) / 2.5, 0, 1));
        }
    };
}

export function gripStickAction(axes) {
    const x = axes?.[2] || 0, y = -(axes?.[3] || 0), deadzone = .22;
    const normalize = value => Math.abs(value) <= deadzone ? 0
        : Math.sign(value) * (Math.abs(value) - deadzone) / (1 - deadzone);
    return { curve: normalize(-x), scale: normalize(y) };
}

export function horizontalStick(axes, mapping = '') {
    if (!axes?.length) return 0;
    const candidates = mapping === 'xr-standard' ? [axes[2] || 0] : [axes[0] || 0, axes[2] || 0];
    const value = candidates.reduce((strongest, candidate) => Math.abs(candidate) > Math.abs(strongest) ? candidate : strongest, 0);
    return Math.abs(value) >= .65 ? Math.sign(value) : 0;
}

export function controllerButtons(source, previous = []) {
    const gamepad = source?.gamepad;
    const known = gamepad?.mapping === 'xr-standard';
    const pressed = index => Boolean(known && gamepad.buttons[index]?.pressed);
    const buttons = [pressed(4), pressed(5), pressed(3)]; // A/B + thumbstick on Touch.
    return { buttons, primary: buttons[0] && !previous[0], variant: buttons[1] && !previous[1],
        stick: buttons[2] && !previous[2] };
}
