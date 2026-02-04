import * as THREE from 'three';

export function noise2D(x, y) {
    return Math.sin(x * 0.01) * Math.cos(y * 0.01) * 10 +
           Math.sin(x * 0.02 + 1) * Math.cos(y * 0.02) * 5 +
           Math.sin((x + y) * 0.005) * 8;
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
