import * as THREE from 'three';

/** Load vertex and fragment shaders from js/shaders/{name}.vert and .frag */
export async function loadShaders() {
    const names = ['skybox', 'terrain', 'water'];
    const results = {};
    await Promise.all(names.map(async (name) => {
        const [vert, frag] = await Promise.all([
            fetch(`js/shaders/${name}.vert`).then(r => r.text()),
            fetch(`js/shaders/${name}.frag`).then(r => r.text()),
        ]);
        const stripBOM = (s) => s.replace(/^\uFEFF/, '').trim();
        results[name] = { vertexShader: stripBOM(vert), fragmentShader: stripBOM(frag) };
    }));
    return results;
}

export function noise2D(x, y) {
    return Math.sin(x * 0.01) * Math.cos(y * 0.01) * 10 +
           Math.sin(x * 0.02 + 1) * Math.cos(y * 0.02) * 5 +
           Math.sin((x + y) * 0.005) * 8;
}

const smoothstep = (e0, e1, x) => {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
};

/** Terrain height at (x,z) in terrain coords 0..terrainSize*2, with edge falloff so edges are under water. */
export function terrainHeightAt(x, z, terrainSize) {
    const center = terrainSize / 2;
    const innerRadius = 600;
    const outerRadius = 2000;
    const edgeDrop = 55;
    const baseHeight = noise2D(x, z) + noise2D(x * 2, z * 2) * 0.5 +
        Math.abs(Math.sin(x * 0.005) * Math.cos(z * 0.005)) * 15;
    const distFromCenter = Math.sqrt((x - center) ** 2 + (z - center) ** 2);
    const falloff = smoothstep(innerRadius, outerRadius, distFromCenter);
    return baseHeight * 3 - falloff * edgeDrop;
}

/** Creates a terrain height texture for shoreline blending. Height in R (0-1 = -80..80). Terrain world XZ: -terrainSize to 0. */
export function createTerrainHeightTexture(terrainSize) {
    const res = 512;
    const data = new Uint8Array(res * res);
    for (let j = 0; j < res; j++) {
        for (let i = 0; i < res; i++) {
            const worldX = (i / (res - 1)) * terrainSize - terrainSize;
            const worldZ = (j / (res - 1)) * terrainSize - terrainSize;
            const x = worldX + terrainSize;
            const z = worldZ + terrainSize;
            const terrainHeight = terrainHeightAt(x, z, terrainSize);
            const norm = (terrainHeight + 80) / 160;
            data[j * res + i] = Math.floor(Math.max(0, Math.min(1, norm)) * 255);
        }
    }
    const tex = new THREE.DataTexture(data, res, res, THREE.RedFormat);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
}

export function createTerrainTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#2d5016');
    gradient.addColorStop(0.5, '#3d6b1f');
    gradient.addColorStop(1, '#1a3010');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 500; i++) {
        ctx.fillStyle = `rgba(60, 90, 30, ${Math.random() * 0.3})`;
        ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    return canvas;
}

export function createSmokeTexture() {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    g.addColorStop(0.3, 'rgba(255, 255, 255, 0.5)');
    g.addColorStop(0.6, 'rgba(255, 255, 255, 0.15)');
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
}

export function createCloudTexture() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    g.addColorStop(0.4, 'rgba(248, 250, 255, 0.6)');
    g.addColorStop(0.7, 'rgba(240, 248, 255, 0.2)');
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
}
