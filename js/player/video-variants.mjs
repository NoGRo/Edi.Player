import { parseAutoVariant } from '../funscript-tools.mjs';
import { assetVariantsForVideo } from './assets.mjs';

export function variantsForVideo(device, context, assets = []) {
    if (!context) return (device.variants || []).filter(variant => variant === 'None');
    const available = new Set(assetVariantsForVideo(assets, context.name).map(variant => variant.toLowerCase()));
    return (device.variants || []).filter(variant => variant === 'None' || available.has(variant.toLowerCase()));
}

export function videoVariantPair({ history, previous = {}, variants, selected, defaults = {}, side = 'primary' }) {
    const normalize = value => {
        if (value?.startsWith('real:')) {
            const variant = variants.find(variant => variant.toLowerCase() === value.slice(5).toLowerCase());
            return variant ? `real:${variant}` : null;
        }
        return ['auto:double', 'auto:halve'].includes(value)
            && (variants.some(variant => parseAutoVariant(variant)?.kind === value.slice(5))
                || variants.some(variant => variant !== 'None' && !parseAutoVariant(variant))) ? value : null;
    };
    const originals = variants.filter(value => value !== 'None' && !parseAutoVariant(value));
    const first = originals.find(value => value.toLowerCase() === (defaults.defaultVariant || 'default').toLowerCase())
        || originals[0] || 'None';
    const fallback = `real:${first}`;
    const pair = { activeSide: history?.activeSide || side, bases: {} };
    for (const key of ['primary', 'secondary']) {
        for (const source of [history, previous]) {
            const choice = normalize(source?.[key]);
            const base = source?.bases?.[key];
            if (!choice || (choice.startsWith('auto:') && base
                && !originals.some(value => value.toLowerCase() === base.toLowerCase()))) continue;
            pair[key] = choice;
            if (base) pair.bases[key] = base;
            break;
        }
        if (!pair[key]) {
            pair[key] = key === 'secondary' && originals.length ? 'auto:halve' : fallback;
            if (pair[key] === 'auto:halve') {
                const primary = pair.primary.startsWith('real:') ? pair.primary.slice(5) : pair.bases.primary;
                pair.bases.secondary = originals.find(value => value.toLowerCase() === primary?.toLowerCase()) || first;
            }
        }
        // Legacy automatic choices without a saved base must also load without a dialog.
        if (pair[key].startsWith('auto:') && !pair.bases[key] && originals.length) pair.bases[key] = first;
    }
    // An explicit stop survives navigation, even when this video has an older active preference.
    if (selected === 'None') pair[pair.activeSide] = 'real:None';
    return pair;
}
