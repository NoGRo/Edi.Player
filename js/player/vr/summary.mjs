import * as THREE from '../../../lib/vr/three.module.min.js';

// Paint the shared overlay model directly; no HTML capture or DOM layout in XR frames.
export function createVrSummary(video, preferences) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true,
        opacity: 0, depthTest: false, depthWrite: false, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.renderOrder = 21;
    mesh.userData.playerSummary = true;
    mesh.visible = false;
    let width = 1, height = 59, target = 0, opacity = 0, previous = null, expires = Infinity, signature = '';
    const baseScale = new THREE.Vector3(1, 1, 1);

    function icon(part, x) {
        context.save(); context.translate(x, (height - 27.2) / 2); context.scale(27.2 / 24, 27.2 / 24);
        context.strokeStyle = part.color || '#fff'; context.lineWidth = 2.2;
        context.lineCap = context.lineJoin = 'round';
        context.beginPath();
        if (part.icon === 'stroker') {
            context.roundRect(7, 2.5, 10, 19, 5); context.stroke();
            context.stroke(new Path2D('M12 6v12M9.5 8.5 12 6l2.5 2.5M9.5 15.5 12 18l2.5-2.5'));
            if (part.paused) { context.lineWidth = 3.2; context.stroke(new Path2D('M3.5 3.5l17 17')); }
        } else if (part.icon === 'intensity') {
            for (let i = 0; i < 4; i++) context.roundRect(4 + i * 5, 8 - i * 2, 2, 12 + i * 2, .5);
            context.stroke();
        } else {
            context.scale(24 / 28, 1);
            context.stroke(new Path2D('M4 12h20M8 8l-4 4 4 4M20 8l4 4-4 4'));
        }
        context.restore();
    }
    function show(event) {
        const model = event.detail;
        target = model.visible ? 1 : 0;
        if (!model.visible) return;
        const parts = model.parts || [];
        expires = model.duration == null ? Infinity : performance.now() + model.duration;
        const nextSignature = JSON.stringify(parts);
        if (signature === nextSignature) return;
        signature = nextSignature;
        context.font = '24px system-ui';
        width = Math.ceil(32 + parts.reduce((total, part) => total + (part.icon ? 27.2 : context.measureText(part.text || '').width), 0)
            + Math.max(0, parts.length - 1) * 10.4);
        canvas.width = width * 2; canvas.height = height * 2;
        context.scale(2, 2);
        context.fillStyle = 'rgba(0,0,0,.65)'; context.beginPath(); context.roundRect(0, 0, width, height, 7.2); context.fill();
        context.font = '24px system-ui'; context.textBaseline = 'middle';
        let x = 16;
        for (const part of parts) {
            if (part.icon) { icon(part, x); x += 27.2; }
            else { context.fillStyle = part.color || '#fff'; context.fillText(part.text || '', x, height / 2); x += context.measureText(part.text || '').width; }
            x += 10.4;
        }
        texture.needsUpdate = true;
        layout();
    }
    function layout() {
        const size = video.dimensions();
        // Fullscreen CSS spacing, expressed in a 1280px-wide video coordinate space.
        const unit = size.width / 1280;
        const scale = Math.min(1, 1256 / width, size.height / unit / (height + 24));
        const w = width * unit * scale, h = height * unit * scale;
        baseScale.set(w, h, 1);
        mesh.scale.copy(baseScale);
        const x = size.width / 2 - 12 * unit - w / 2;
        const curvature = Math.max(0, Math.min(1.6, Number(preferences.curvature) || 0));
        const radius = curvature ? size.width / (2 * Math.sin(curvature / 2)) : Infinity;
        const edge = size.width / 2;
        const z = curvature ? edge * edge / (radius + Math.sqrt(radius * radius - edge * edge)) : 0;
        mesh.position.set(x, size.height / 2 - 12 * unit - h / 2, z + .008);
    }
    function update(milliseconds) {
        if (milliseconds >= expires) target = 0;
        const step = previous == null ? 0 : Math.min(1, (milliseconds - previous) / 180);
        previous = milliseconds;
        opacity += Math.sign(target - opacity) * Math.min(Math.abs(target - opacity), step);
        material.opacity = 1 - Math.pow(1 - opacity, 2);
        mesh.scale.copy(baseScale).multiplyScalar(.96 + .04 * material.opacity);
        mesh.visible = opacity > 0;
    }
    document.addEventListener('edi-player-overlay', show);
    return { mesh, layout, update, dispose() {
        document.removeEventListener('edi-player-overlay', show);
        mesh.geometry.dispose(); material.dispose(); texture.dispose();
    } };
}
