import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';

// ============ GAME STATE ============
// Terrain config - must be before planeState (which uses TERRAIN_SIZE)
const TERRAIN_SIZE = 4000;  // 2x bigger - 8x was too heavy for performance
const TERRAIN_SEGMENTS = 128;

let scene, camera, renderer;
let plane, planeGroup;
let terrain, terrainGeometry;
let water = null;  // Water mesh for ripple animation
let trees = [];  // Tree instances for collision
let cannons = [];  // Ground cannons - fire homing missiles
let initialCannonCount = 0;  // For kills/remaining display
let missiles = [];  // Homing missiles from cannons (enemy)
let playerMissiles = [];  // Missiles fired by player (from wings)
let lockedCannon = null;  // GTA-style lock-on target
let explosionParticles = [];
let groundFireParticles = [];  // Persistent flames at crash site
let propeller = null;  // Spinning propeller reference
let flaps = [];  // Flap meshes for animation
let wingMissileLeft = null;  // Stored missile under left wing
let wingMissileRight = null;  // Stored missile under right wing
const wingMissileReload = { left: 0, right: 0 };
const MISSILE_RELOAD_TIME = 3;
let gameOver = false;
let crashed = false;
let hitByMissile = false;  // Set when enemy missile hits; game continues until terrain crash
let shotDownFalling = false;  // Plane is on fire, falling; controls disabled, game over shown
let shotDownTime = 0;  // When shot, for periodic fire bursts

// Plane physics
const planeState = {
    position: new THREE.Vector3(-TERRAIN_SIZE / 2, 100, -TERRAIN_SIZE / 2),  // Terrain center
    velocity: new THREE.Vector3(0, 0, -50),
    rotation: new THREE.Euler(0, 0, 0),
    speed: 75,
    maxSpeed: 120,
    minSpeed: 20,
    pitch: 0,
    roll: 0,       // Visual roll (Z axis) - from A/D and Numpad 4/6
    turnRoll: 0,   // Bank into turn (affects Y) - only from A/D, not Numpad 4/6
    yaw: 0,
    verticalVelocity: 0,  // Gravity/lift - positive = climbing, negative = falling
};

// Input state
const keys = {};
const mouse = { prevX: 0, prevY: 0, lastMoveTime: 0 };

// Camera shake - triggered when cannon destroyed (unused, replaced by screen brighten)
const cameraShake = { intensity: 0, duration: 0, elapsed: 0 };
// Screen brighten - flashes when player destroys enemy
const screenBrighten = { intensity: 0, duration: 0, elapsed: 0 };

// Camera orbit - follows plane, mouse adds offset, auto-centers when idle
const cameraOrbit = {
    thetaOffset: 0,   // user's horizontal offset from plane heading
    phiOffset: 0,     // user's vertical offset
    radius: 18,
    minRadius: 8,
    maxRadius: 55,
    sensitivity: 0.006,    // mouse movement to orbit (increased for responsiveness)
    autoCenterSpeed: 2.5,   // how fast camera returns to center when mouse idle
    idleTimeToCenter: 1.5,  // seconds of no mouse movement before auto-center
};

// Optional: Set to a URL to load a custom plane GLB model (e.g. from Sketchfab download)
const PLANE_MODEL_URL = null;  // e.g. 'models/plane.glb'

// ============ CREATE SKY ============
function createSky(sunLight) {
    const sky = new Sky();
    sky.scale.setScalar(450000);
    scene.add(sky);
    
    const sunPosition = new THREE.Vector3();
    sunPosition.copy(sunLight.position);
    sky.material.uniforms.sunPosition.value.copy(sunPosition);
    sky.material.uniforms.turbidity.value = 6;
    sky.material.uniforms.rayleigh.value = 0.8;
    sky.material.uniforms.mieCoefficient.value = 0.012;
    sky.material.uniforms.mieDirectionalG.value = 0.76;
}

// ============ CREATE CLOUDS (simple plane-based) ============
function createClouds() {
    const cloudTexture = createCloudTexture();
    const cloudCount = 60;
    const rand = (s) => ((Math.sin(s) * 10000) % 1 + 1) / 2;
    
    const cloudMat = new THREE.MeshBasicMaterial({
        map: cloudTexture,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    
    for (let c = 0; c < cloudCount; c++) {
        const cx = (rand(c * 7) - 0.5) * 4500;
        const cy = 450 + rand(c * 7 + 1) * 200;
        const cz = (rand(c * 7 + 2) - 0.5) * 4500;
        const w = 120 + rand(c * 7 + 3) * 180;
        const h = 80 + rand(c * 7 + 4) * 100;
        
        const geometry = new THREE.PlaneGeometry(w, h);
        const cloud = new THREE.Mesh(geometry, cloudMat);
        cloud.position.set(cx, cy, cz);
        cloud.rotation.y = rand(c * 11) * Math.PI * 2;
        cloud.rotation.x = (rand(c * 11 + 1) - 0.5) * 0.3;
        cloud.renderOrder = 10;
        cloud.frustumCulled = false;
        scene.add(cloud);
    }
}

function createCloudTexture() {
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

// ============ SIMPLEX NOISE (simplified) ============
function noise2D(x, y) {
    const n = Math.sin(x * 0.01) * Math.cos(y * 0.01) * 10 +
              Math.sin(x * 0.02 + 1) * Math.cos(y * 0.02) * 5 +
              Math.sin((x + y) * 0.005) * 8;
    return n;
}

// ============ CREATE TERRAIN ============
function createTerrain() {
    const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
    geometry.rotateX(-Math.PI / 2);
    
    const positions = geometry.attributes.position;
    const centerX = TERRAIN_SIZE / 2;
    const centerZ = TERRAIN_SIZE / 2;
    
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i) + centerX;
        const z = positions.getZ(i) + centerZ;
        const height = noise2D(x, z) + 
                       noise2D(x * 2, z * 2) * 0.5 +
                       Math.abs(Math.sin(x * 0.005) * Math.cos(z * 0.005)) * 15;
        positions.setY(i, height * 3);
    }
    
    geometry.computeVertexNormals();
    
    const texture = new THREE.CanvasTexture(createTerrainTexture());
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(20, 20);
    
    const material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.9,
        metalness: 0.1,
        flatShading: false,
    });
    
    terrain = new THREE.Mesh(geometry, material);
    terrain.position.set(-TERRAIN_SIZE / 2, 0, -TERRAIN_SIZE / 2);
    terrain.receiveShadow = true;
    scene.add(terrain);
    
    terrainGeometry = geometry;
    createWater();
    createTrees();
    createCannons();
    return terrain;
}

// ============ CREATE WATER (steady with subtle ripples & sun glare) ============
function createWater() {
    const waterSize = 12000;
    const waterGeometry = new THREE.PlaneGeometry(waterSize, waterSize);
    waterGeometry.rotateX(-Math.PI / 2);
    
    const sunDir = new THREE.Vector3(100, 200, 50).normalize();
    
    const waterMaterial = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uWaterColor: { value: new THREE.Color(0x1e6fcc) },
            uSkyColor: { value: new THREE.Color(0x87ceeb) },
            uSunDirection: { value: sunDir },
            fogColor: { value: scene.fog ? scene.fog.color.clone() : new THREE.Color(0x87ceeb) },
            fogNear: { value: scene.fog ? scene.fog.near : 400 },
            fogFar: { value: scene.fog ? scene.fog.far : 1400 },
        },
        vertexShader: `
            varying vec2 vUv;
            varying vec3 vViewPosition;
            varying float vFogDepth;
            
            void main() {
                vUv = uv;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vViewPosition = -mvPosition.xyz;
                vFogDepth = -mvPosition.z;
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform vec3 uWaterColor;
            uniform vec3 uSkyColor;
            uniform vec3 uSunDirection;
            uniform vec3 fogColor;
            uniform float fogNear;
            uniform float fogFar;
            varying vec2 vUv;
            varying vec3 vViewPosition;
            varying float vFogDepth;
            
            void main() {
                vec3 viewDir = normalize(vViewPosition);
                vec3 normal = vec3(0.0, 1.0, 0.0);
                
                // Subtle ripple - tiny normal variation for glitter/shimmer (no waves)
                float rx = sin(vUv.x * 60.0 + uTime * 1.5) * sin(vUv.y * 40.0 + uTime) * 0.02;
                float rz = sin(vUv.x * 40.0 + uTime) * sin(vUv.y * 60.0 + uTime * 1.2) * 0.02;
                vec3 rippleNormal = normalize(vec3(rx, 1.0, rz));
                
                // Fresnel - sky reflection at grazing angles
                float fresnel = pow(1.0 - max(dot(viewDir, rippleNormal), 0.0), 2.5);
                vec3 reflectColor = mix(uWaterColor, uSkyColor, fresnel * 0.7);
                
                // Sun glare - strong specular highlight
                vec3 halfDir = normalize(viewDir + uSunDirection);
                float spec = pow(max(dot(rippleNormal, halfDir), 0.0), 64.0);
                vec3 glare = vec3(1.0, 0.98, 0.9) * spec * 1.2;
                
                vec3 finalColor = reflectColor + glare;
                float alpha = 0.92;
                
                vec4 baseColor = vec4(finalColor, alpha);
                float fogFactor = clamp((fogFar - vFogDepth) / (fogFar - fogNear), 0.0, 1.0);
                gl_FragColor = mix(vec4(fogColor, alpha), baseColor, fogFactor);
            }
        `,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: true,
    });
    
    water = new THREE.Mesh(waterGeometry, waterMaterial);
    water.renderOrder = 0;  // Render before clouds (clouds use renderOrder 10)
    water.position.set(-TERRAIN_SIZE / 2, -5, -TERRAIN_SIZE / 2);
    water.receiveShadow = true;
    scene.add(water);
}

// ============ CREATE TREES ============
function createTrees() {
    const treeCount = 2000;
    const trunkHeight = 3;
    // Terrain spans world (-2000, -2000) to (0, 0) - place trees within bounds
    const minX = -TERRAIN_SIZE + 80;
    const maxX = -80;
    const minZ = -TERRAIN_SIZE + 80;
    const maxZ = -80;
    const trunkGeom = new THREE.CylinderGeometry(0.35, 0.6, trunkHeight, 8);
    const trunkMat = new THREE.MeshStandardMaterial({ 
        color: 0x4a3728,
        roughness: 0.9,
        metalness: 0.1 
    });
    
    const pineFoliageGeom = new THREE.ConeGeometry(2.5, 5, 8);
    const oakFoliageGeom = new THREE.SphereGeometry(2, 8, 6);
    const spruceFoliageGeom = new THREE.ConeGeometry(1.8, 6, 6);
    
    const pineMat = new THREE.MeshStandardMaterial({ color: 0x2d5a27, roughness: 0.95, metalness: 0 });
    const oakMat = new THREE.MeshStandardMaterial({ color: 0x3d6b2f, roughness: 0.9, metalness: 0 });
    const spruceMat = new THREE.MeshStandardMaterial({ color: 0x1e4d2b, roughness: 0.95, metalness: 0 });
    
    const trunkInstances = [];
    const foliageInstances = [];
    const treeData = [];
    
    let placed = 0;
    let attempts = 0;
    
    while (placed < treeCount && attempts < treeCount * 4) {
        attempts++;
        const x = minX + Math.random() * (maxX - minX);
        const z = minZ + Math.random() * (maxZ - minZ);
        const terrainH = getTerrainHeight(x, z);
        
        const noiseX = x + TERRAIN_SIZE;
        const noiseZ = z + TERRAIN_SIZE;
        const slope = Math.abs(noise2D(noiseX + 1, noiseZ) - noise2D(noiseX - 1, noiseZ)) + 
                      Math.abs(noise2D(noiseX, noiseZ + 1) - noise2D(noiseX, noiseZ - 1));
        if (slope > 3 || terrainH < -10) continue;
        
        const type = Math.floor(Math.random() * 3);
        const scale = 0.7 + Math.random() * 0.6;
        const rotY = Math.random() * Math.PI * 2;
        
        // Trunk: cylinder center at terrainH + trunkHeight/2 so BOTTOM sits on terrain
        const trunkCenterY = terrainH + trunkHeight / 2;
        const matrix = new THREE.Matrix4();
        matrix.compose(
            new THREE.Vector3(x, trunkCenterY, z),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)),
            new THREE.Vector3(scale, scale, scale)
        );
        
        trunkInstances.push({ matrix: matrix.clone() });
        
        // Foliage: sits on top of trunk (trunk top = terrainH + trunkHeight)
        const trunkTop = terrainH + trunkHeight * scale;
        const foliageY = type === 0 ? trunkTop + 2.5 * scale : type === 1 ? trunkTop + 2 * scale : trunkTop + 3 * scale;
        const foliageMatrix = new THREE.Matrix4();
        foliageMatrix.compose(
            new THREE.Vector3(x, foliageY, z),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)),
            new THREE.Vector3(scale, scale, type === 1 ? scale * 1.2 : scale)
        );
        foliageInstances.push({ matrix: foliageMatrix, type });
        
        treeData.push({ 
            position: new THREE.Vector3(x, terrainH, z), 
            radius: 2.5 * scale,
            height: 8 * scale 
        });
        placed++;
    }
    
    // Create instanced meshes
    const trunkInstanced = new THREE.InstancedMesh(trunkGeom, trunkMat, trunkInstances.length);
    trunkInstanced.castShadow = true;
    trunkInstanced.receiveShadow = true;
    trunkInstances.forEach((inst, i) => trunkInstanced.setMatrixAt(i, inst.matrix));
    trunkInstanced.instanceMatrix.needsUpdate = true;
    scene.add(trunkInstanced);
    
    const pineInstanced = new THREE.InstancedMesh(pineFoliageGeom, pineMat, 
        foliageInstances.filter(f => f.type === 0).length);
    const oakInstanced = new THREE.InstancedMesh(oakFoliageGeom, oakMat, 
        foliageInstances.filter(f => f.type === 1).length);
    const spruceInstanced = new THREE.InstancedMesh(spruceFoliageGeom, spruceMat, 
        foliageInstances.filter(f => f.type === 2).length);
    
    let pineIdx = 0, oakIdx = 0, spruceIdx = 0;
    foliageInstances.forEach((inst) => {
        if (inst.type === 0) { pineInstanced.setMatrixAt(pineIdx++, inst.matrix); }
        else if (inst.type === 1) { oakInstanced.setMatrixAt(oakIdx++, inst.matrix); }
        else { spruceInstanced.setMatrixAt(spruceIdx++, inst.matrix); }
    });
    
    [pineInstanced, oakInstanced, spruceInstanced].forEach(m => {
        m.castShadow = true;
        m.receiveShadow = true;
        m.instanceMatrix.needsUpdate = true;
        scene.add(m);
    });
    
    trees = treeData;
}

// ============ CREATE CANNONS ============
function createCannons() {
    cannons = [];
    const cannonCount = 48;
    const minX = -TERRAIN_SIZE + 120;
    const maxX = -120;
    const minZ = -TERRAIN_SIZE + 120;
    const maxZ = -120;
    const cannonMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.6, roughness: 0.5 });
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.5, roughness: 0.6 });
    
    const rand = (s) => ((Math.sin(s) * 10000) % 1 + 1) / 2;
    let placed = 0;
    let attempts = 0;
    
    while (placed < cannonCount && attempts < cannonCount * 8) {
        attempts++;
        const c = placed + attempts;
        const x = minX + rand(c * 13) * (maxX - minX);
        const z = minZ + rand(c * 13 + 1) * (maxZ - minZ);
        const terrainH = getTerrainHeight(x, z);
        const noiseX = x + TERRAIN_SIZE;
        const noiseZ = z + TERRAIN_SIZE;
        const slope = Math.abs(noise2D(noiseX + 1, noiseZ) - noise2D(noiseX - 1, noiseZ)) +
                      Math.abs(noise2D(noiseX, noiseZ + 1) - noise2D(noiseX, noiseZ - 1));
        if (slope > 2 || terrainH < -5) continue;
        
        const cannonGroup = new THREE.Group();
        const baseGeom = new THREE.CylinderGeometry(3.5, 4.2, 1.8, 8);
        const base = new THREE.Mesh(baseGeom, baseMat);
        base.position.y = 0.9;
        base.castShadow = true;
        cannonGroup.add(base);
        const barrelGeom = new THREE.CylinderGeometry(0.7, 1.0, 6.5, 8);
        const barrel = new THREE.Mesh(barrelGeom, cannonMat);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 2.2, 3.2);
        barrel.castShadow = true;
        cannonGroup.add(barrel);
        const turretGeom = new THREE.CylinderGeometry(1.8, 2.2, 1.4, 8);
        const turret = new THREE.Mesh(turretGeom, cannonMat);
        turret.position.y = 1.6;
        turret.castShadow = true;
        cannonGroup.add(turret);
        
        cannonGroup.position.set(x, terrainH, z);
        cannonGroup.castShadow = true;
        scene.add(cannonGroup);
        
        cannons.push({
            mesh: cannonGroup,
            position: new THREE.Vector3(x, terrainH + 2.5, z),
            lastFireTime: 0,
            active: true,
            radius: 5,
        });
        placed++;
    }
    initialCannonCount = cannons.length;
}

function createTerrainTexture() {
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

// ============ GET TERRAIN HEIGHT AT POSITION ============
// Uses the SAME formula as terrain creation - guarantees trees and collision match terrain exactly
function getTerrainHeight(worldX, worldZ) {
    // Terrain: world = mesh.position + vertex => worldX = -1000 + geomX, so geomX = worldX + 1000
    // Terrain creation used: noiseX = geomX + 1000, noiseZ = geomZ + 1000
    // So noise coords = (worldX + 2000, worldZ + 2000)
    const x = worldX + TERRAIN_SIZE;
    const z = worldZ + TERRAIN_SIZE;
    
    if (x < 0 || x > TERRAIN_SIZE * 2 || z < 0 || z > TERRAIN_SIZE * 2) {
        return 0;
    }
    
    const height = noise2D(x, z) + 
                  noise2D(x * 2, z * 2) * 0.5 +
                  Math.abs(Math.sin(x * 0.005) * Math.cos(z * 0.005)) * 15;
    return height * 3;
}

// ============ CREATE PLANE ============
function createPlane() {
    if (PLANE_MODEL_URL) {
        loadPlaneModel(PLANE_MODEL_URL);
        return;
    }
    createProceduralPlane();
}

function loadPlaneModel(url) {
    const loader = new GLTFLoader();
    propeller = null;
    flaps = [];
    wingMissileLeft = null;
    wingMissileRight = null;
    loader.load(url, (gltf) => {
        planeGroup = gltf.scene;
        planeGroup.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        // Scale to fit (typical plane models are 1-5 units)
        const box = new THREE.Box3().setFromObject(planeGroup);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 8 / maxDim;
        planeGroup.scale.setScalar(scale);
        planeGroup.rotation.order = 'YZX';  // Yaw, Roll, Pitch - so pitch rotates around plane's local X (wing axis)
        planeGroup.position.copy(planeState.position);
        scene.add(planeGroup);
        plane = planeGroup;
    }, undefined, (err) => {
        console.warn('Failed to load plane model, using procedural:', err);
        createProceduralPlane();
    });
}

function createProceduralPlane() {
    planeGroup = new THREE.Group();
    
    const bodyMat = new THREE.MeshStandardMaterial({ 
        color: 0x5a6b5a,
        metalness: 0.5,
        roughness: 0.5 
    });
    const wingMat = new THREE.MeshStandardMaterial({ 
        color: 0x4a5a4a,
        metalness: 0.45,
        roughness: 0.55 
    });
    const cockpitMat = new THREE.MeshStandardMaterial({ 
        color: 0x99ccff,
        transparent: true,
        opacity: 0.85,
        metalness: 0.7,
        roughness: 0.25 
    });
    const propMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.6, roughness: 0.4 });
    
    // Fuselage - streamlined body (P-51 style)
    const fuselageGeom = new THREE.CylinderGeometry(0.45, 0.5, 8, 12);
    const fuselage = new THREE.Mesh(fuselageGeom, bodyMat);
    fuselage.rotation.x = Math.PI / 2;
    fuselage.castShadow = true;
    planeGroup.add(fuselage);
    
    // Nose - rounded engine cowling
    const noseGeom = new THREE.SphereGeometry(0.55, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const nose = new THREE.Mesh(noseGeom, bodyMat);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = -4.5;
    nose.castShadow = true;
    planeGroup.add(nose);
    
    // Propeller + spinner - detailed curved design
    const propellerGroup = new THREE.Group();
    propellerGroup.position.z = -5;
    // Spinner - streamlined cone with back plate
    const spinnerCone = new THREE.ConeGeometry(0.32, 0.35, 12);
    const spinnerMesh = new THREE.Mesh(spinnerCone, propMat);
    spinnerMesh.rotation.x = Math.PI / 2;
    spinnerMesh.position.z = -0.15;
    propellerGroup.add(spinnerMesh);
    const backPlate = new THREE.CylinderGeometry(0.28, 0.28, 0.06, 12);
    const backPlateMesh = new THREE.Mesh(backPlate, propMat);
    backPlateMesh.rotation.x = Math.PI / 2;
    backPlateMesh.position.z = 0.12;
    propellerGroup.add(backPlateMesh);
    // Curved propeller blades (4 blades, tapered airfoil-like profile)
    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(0, 0);
    bladeShape.quadraticCurveTo(0.5, 0.06, 1.0, 0.05);
    bladeShape.quadraticCurveTo(1.6, 0.03, 1.95, 0.01);
    bladeShape.lineTo(1.9, -0.02);
    bladeShape.quadraticCurveTo(1.2, -0.03, 0.5, -0.02);
    bladeShape.quadraticCurveTo(0.1, -0.01, 0, 0);
    const bladeGeom = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.006, bevelSegments: 2 });
    for (let i = 0; i < 4; i++) {
        const blade = new THREE.Mesh(bladeGeom, propMat);
        blade.rotation.z = (i / 4) * Math.PI * 2;
        blade.position.z = 0.06;
        propellerGroup.add(blade);
    }
    propellerGroup.castShadow = true;
    planeGroup.add(propellerGroup);
    propeller = propellerGroup;
    
    // Cockpit - teardrop bubble
    const canopyGeom = new THREE.SphereGeometry(0.6, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2.1);
    const canopy = new THREE.Mesh(canopyGeom, cockpitMat);
    canopy.position.set(0, 0.35, -1.8);
    canopy.rotation.x = Math.PI / 2;
    canopy.castShadow = true;
    planeGroup.add(canopy);
    
    // Main wings - wider, thinner, with separate flaps
    const wingSpan = 14;
    const wingChord = 3.2;
    const wingThickness = 0.04;
    const wingGeom = new THREE.BoxGeometry(wingSpan, wingThickness, wingChord);
    const wings = new THREE.Mesh(wingGeom, wingMat);
    wings.position.set(0, -0.04, -0.3);
    wings.castShadow = true;
    planeGroup.add(wings);
    // Flaps - trailing edge, hinge at leading edge, deploy with low speed / pitch up
    flaps = [];
    const flapSpan = 2.2;
    const flapChord = 0.7;
    const flapGeom = new THREE.BoxGeometry(flapSpan, wingThickness * 1.2, flapChord);
    const hingeZ = -0.3 + wingChord/2;  // Trailing edge of main wing
    const flapL = new THREE.Mesh(flapGeom, wingMat);
    const flapGroupL = new THREE.Group();
    flapGroupL.position.set(-wingSpan/2 + flapSpan/2 + 0.5, -0.04, hingeZ);
    flapL.position.z = flapChord/2;  // Leading edge at hinge
    flapL.castShadow = true;
    flapGroupL.add(flapL);
    planeGroup.add(flapGroupL);
    flaps.push(flapGroupL);
    const flapR = new THREE.Mesh(flapGeom, wingMat);
    const flapGroupR = new THREE.Group();
    flapGroupR.position.set(wingSpan/2 - flapSpan/2 - 0.5, -0.04, hingeZ);
    flapR.position.z = flapChord/2;
    flapR.castShadow = true;
    flapGroupR.add(flapR);
    planeGroup.add(flapGroupR);
    flaps.push(flapGroupR);
    
    // Stored missiles under wings (hardpoints)
    wingMissileLeft = createMissileMesh(0x3ddb8a, false);
    wingMissileLeft.scale.setScalar(0.75);
    wingMissileLeft.position.set(-wingSpan/2 + 0.5, -0.55, -0.3);
    planeGroup.add(wingMissileLeft);
    wingMissileRight = createMissileMesh(0x3ddb8a, false);
    wingMissileRight.scale.setScalar(0.75);
    wingMissileRight.position.set(wingSpan/2 - 0.5, -0.55, -0.3);
    planeGroup.add(wingMissileRight);
    
    // Tail - vertical fin
    const finGeom = new THREE.BoxGeometry(0.08, 1.8, 1.2);
    const fin = new THREE.Mesh(finGeom, wingMat);
    fin.position.set(0, 0.9, 4.2);
    fin.castShadow = true;
    planeGroup.add(fin);
    
    // Horizontal stabilizers
    const stabGeom = new THREE.BoxGeometry(4, 0.06, 1);
    const stabL = new THREE.Mesh(stabGeom, wingMat);
    stabL.position.set(-1.5, 0.35, 4);
    stabL.castShadow = true;
    planeGroup.add(stabL);
    const stabR = new THREE.Mesh(stabGeom, wingMat);
    stabR.position.set(1.5, 0.35, 4);
    stabR.castShadow = true;
    planeGroup.add(stabR);
    
    // Tail cone
    const tailGeom = new THREE.ConeGeometry(0.35, 1.8, 8);
    const tail = new THREE.Mesh(tailGeom, bodyMat);
    tail.rotation.x = -Math.PI / 2;
    tail.position.z = 5.2;
    tail.castShadow = true;
    planeGroup.add(tail);
    
    planeGroup.position.copy(planeState.position);
    planeGroup.rotation.order = 'YZX';
    scene.add(planeGroup);
    plane = planeGroup;
}

// ============ CREATE MISSILE MESH (realistic shape) ============
function createMissileMesh(color, includeExhaust = true) {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color, metalness: 0.7, roughness: 0.35 });
    const finMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.5, roughness: 0.5 });
    
    const noseCone = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 8), bodyMat);
    noseCone.rotation.x = Math.PI / 2;
    noseCone.position.z = -0.9;
    group.add(noseCone);
    
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 1.2, 8), bodyMat);
    body.rotation.x = Math.PI / 2;
    body.position.z = -0.3;
    group.add(body);
    
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.4, 8), bodyMat);
    tail.rotation.x = Math.PI / 2;
    tail.position.z = 0.5;
    group.add(tail);
    
    const finGeom = new THREE.BoxGeometry(0.06, 0.3, 0.2);
    const finDist = 0.28;
    for (let i = 0; i < 4; i++) {
        const fin = new THREE.Mesh(finGeom, finMat);
        const angle = (i / 4) * Math.PI * 2;
        fin.rotation.x = Math.PI / 2;
        fin.rotation.z = angle;
        fin.position.set(Math.cos(angle) * finDist, Math.sin(angle) * finDist, 0.8);
        group.add(fin);
    }
    
    if (includeExhaust) {
        const exhaustGeom = new THREE.ConeGeometry(0.12, 0.5, 8);
        const exhaustMat = new THREE.MeshBasicMaterial({
            color: 0xff8800,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        const exhaust = new THREE.Mesh(exhaustGeom, exhaustMat);
        exhaust.rotation.x = -Math.PI / 2;
        exhaust.position.z = 1.05;
        group.add(exhaust);
        const exhaustInner = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.35, 6), new THREE.MeshBasicMaterial({
            color: 0xffcc00,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        }));
        exhaustInner.rotation.x = -Math.PI / 2;
        exhaustInner.position.z = 1.15;
        group.add(exhaustInner);
    }
    
    return group;
}

// ============ FIRE PLAYER MISSILE (from wings) ============
let nextMissileWing = 0;  // Alternate left/right wing

function firePlayerMissile() {
    if (!plane || !wingMissileLeft || !wingMissileRight) return;
    
    const leftReady = wingMissileReload.left <= 0;
    const rightReady = wingMissileReload.right <= 0;
    if (!leftReady && !rightReady) return;  // No missiles to fire
    
    let fireFromLeft = nextMissileWing === 0;
    if (fireFromLeft && !leftReady) fireFromLeft = false;
    else if (!fireFromLeft && !rightReady) fireFromLeft = true;
    nextMissileWing = 1 - nextMissileWing;
    
    plane.updateMatrixWorld(true);
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(plane.quaternion);
    forward.normalize();
    
    const wingSpan = 14;
    const wingY = -0.55;
    const wingZ = -0.3;
    const wingOffset = new THREE.Vector3(fireFromLeft ? -wingSpan/2 + 0.5 : wingSpan/2 - 0.5, wingY, wingZ);
    wingOffset.applyQuaternion(plane.quaternion);
    const spawnPos = plane.position.clone().add(wingOffset);
    
    if (fireFromLeft) {
        wingMissileLeft.visible = false;
        wingMissileReload.left = MISSILE_RELOAD_TIME;
    } else {
        wingMissileRight.visible = false;
        wingMissileReload.right = MISSILE_RELOAD_TIME;
    }
    
    const missile = createMissileMesh(0x3ddb8a);
    
    const missileSpeed = 180;
    const initialVel = forward.clone().multiplyScalar(missileSpeed);
    
    missile.userData = {
        position: spawnPos.clone(),
        velocity: initialVel,
        active: true,
        spawnTime: performance.now(),
        target: lockedCannon,
        homingStrength: 2.2,
    };
    
    missile.position.copy(spawnPos);
    const dir = initialVel.clone().normalize();
    missile.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    scene.add(missile);
    playerMissiles.push(missile);
}

// ============ CREATE EXPLOSION/FIRE ============
function createExplosion(pos) {
    const particleCount = 200;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = [];
    
    const colors = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
        positions[i * 3] = pos.x + (Math.random() - 0.5) * 2;
        positions[i * 3 + 1] = pos.y + (Math.random() - 0.5) * 2;
        positions[i * 3 + 2] = pos.z + (Math.random() - 0.5) * 2;
        colors[i * 3] = 1;
        colors[i * 3 + 1] = 0.4 + Math.random() * 0.5;
        colors[i * 3 + 2] = 0;
        velocities.push({
            x: (Math.random() - 0.5) * 18,
            y: Math.random() * 12 + 4,
            z: (Math.random() - 0.5) * 18,
            life: 1,
            decay: 0.003 + Math.random() * 0.002,  // 3-5 second visible duration at 60fps
        });
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    const material = new THREE.PointsMaterial({
        size: 3.5,
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        sizeAttenuation: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    
    const particles = new THREE.Points(geometry, material);
    particles.userData = { velocities, startTime: Date.now() };
    scene.add(particles);
    explosionParticles.push(particles);
}

// ============ FIRE HOMING MISSILE ============
function fireMissile(fromPos) {
    const missile = createMissileMesh(0xe85d04);
    missile.scale.setScalar(1.8);
    const spawnPos = fromPos.clone().add(new THREE.Vector3(0, 0.5, 0));
    const toPlayer = planeState.position.clone().sub(spawnPos).normalize();
    missile.userData = {
        position: spawnPos.clone(),
        velocity: toPlayer.clone().multiplyScalar(65),
        active: true,
        spawnTime: performance.now(),
    };
    missile.position.copy(spawnPos);
    missile.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), toPlayer);
    scene.add(missile);
    missiles.push(missile);
}

// ============ CREATE GROUND FIRE (persistent flames at crash site) ============
function createGroundFire(pos, duration = 8) {
    const particleCount = 80;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = [];
    
    const colors = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
        positions[i * 3] = pos.x + (Math.random() - 0.5) * 6;
        positions[i * 3 + 1] = pos.y + Math.random() * 0.5;
        positions[i * 3 + 2] = pos.z + (Math.random() - 0.5) * 6;
        colors[i * 3] = 1;
        colors[i * 3 + 1] = 0.3 + Math.random() * 0.4;
        colors[i * 3 + 2] = 0;
        velocities.push({
            x: (Math.random() - 0.5) * 2,
            y: 2 + Math.random() * 4,
            z: (Math.random() - 0.5) * 2,
            life: 0.5 + Math.random() * 0.5,
            decay: 0.015 + Math.random() * 0.02,
        });
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    const material = new THREE.PointsMaterial({
        size: 3,
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        sizeAttenuation: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    
    const particles = new THREE.Points(geometry, material);
    particles.userData = { velocities, duration, elapsed: 0 };
    scene.add(particles);
    groundFireParticles.push(particles);
}

// ============ SHOW GAME OVER UI (GTA Wasted style) ============
function showGameOver(title, subtitle) {
    document.getElementById('game-over-title').textContent = 'WASTED';
    document.getElementById('game-over-subtitle').textContent = subtitle;
    document.getElementById('status').textContent = title;
    document.getElementById('game-over-overlay').style.display = 'block';
    document.getElementById('game-over').style.display = 'block';
}

// ============ SET PLANE ON FIRE (emissive glow) ============
function setPlaneOnFire() {
    if (!plane) return;
    plane.traverse((child) => {
        if (child.isMesh && child.material) {
            child.material = child.material.clone();
            child.material.emissive = new THREE.Color(0xff4400);
            child.material.emissiveIntensity = 0.5;
        }
    });
}

// ============ CRASH SEQUENCE ============
function triggerCrash(skipUI = false) {
    if (crashed) return;
    crashed = true;
    shotDownFalling = false;
    gameOver = true;
    
    if (!skipUI) {
        if (hitByMissile) {
            showGameOver('SHOT DOWN!', 'You were hit by an enemy missile');
        } else {
            showGameOver('CRASHED!', 'You hit the terrain at full speed');
        }
    }
    
    const crashPos = plane ? plane.position.clone() : planeState.position.clone();
    const terrainH = getTerrainHeight(crashPos.x, crashPos.z);
    crashPos.y = terrainH + 0.5;
    
    // Initial explosion burst
    createExplosion(crashPos);
    createExplosion(crashPos.clone().add(new THREE.Vector3(2, 1, 0)));
    createExplosion(crashPos.clone().add(new THREE.Vector3(-1, 0.5, 1)));
    
    // Drop burning wreck to ground and keep it visible in flames
    if (plane) {
        plane.position.copy(crashPos);
        plane.rotation.x = 0.5;  // Tilted on ground
        plane.rotation.z = Math.random() * 0.5 - 0.25;
        plane.visible = true;
        plane.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material = child.material.clone();
                child.material.color.setHex(0x2a2a2a);
                child.material.emissive = new THREE.Color(0xff4400);
                child.material.emissiveIntensity = 0.4;
            }
        });
    }
    
    // Sustained ground fire - flames rising from wreck
    createGroundFire(crashPos);
    
    const crashInterval = setInterval(() => {
        createExplosion(crashPos.clone().add(
            new THREE.Vector3((Math.random() - 0.5) * 8, Math.random() * 2, (Math.random() - 0.5) * 8)
        ));
        createGroundFire(crashPos.clone().add(
            new THREE.Vector3((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4)
        ), 4);
    }, 150);
    
    setTimeout(() => clearInterval(crashInterval), 3000);
}

// ============ COLLISION CHECK ============
function checkCollision() {
    if (!plane) return;
    const terrainHeight = getTerrainHeight(plane.position.x, plane.position.z);
    const planeBottom = plane.position.y - 0.8;  // Bottom of fuselage
    
    if (planeBottom <= terrainHeight + 0.3) {
        triggerCrash(shotDownFalling);  // Skip UI if already shown (shot down)
        return;
    }
    
    // Tree collision
    for (const tree of trees) {
        const dx = plane.position.x - tree.position.x;
        const dz = plane.position.z - tree.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < tree.radius && plane.position.y < tree.position.y + tree.height) {
            triggerCrash(shotDownFalling);
            return;
        }
    }
}

// ============ INIT ============
function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);  // Fallback; Sky dome provides main background
    scene.fog = new THREE.Fog(0x87ceeb, 800, 6000);
    
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 15000);
    camera.position.set(0, 0, 15);
    camera.lookAt(0, 0, -20);
    
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('game-container').appendChild(renderer.domElement);
    
    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    
    const sun = new THREE.DirectionalLight(0xffffee, 1);
    sun.position.set(100, 200, 50);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 500;
    sun.shadow.camera.left = -200;
    sun.shadow.camera.right = 200;
    sun.shadow.camera.top = 200;
    sun.shadow.camera.bottom = -200;
    scene.add(sun);
    
    createSky(sun);
    createClouds();
    createTerrain();
    createPlane();
    planeState.rotation.order = 'YZX';  // Yaw, Roll, Pitch - pitch around plane's local X axis
    
    // Event listeners
    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', (e) => {
        keys[e.code] = true;
        if (e.code === 'Space') e.preventDefault();
    });
    document.addEventListener('keyup', (e) => keys[e.code] = false);
    
    // Mouse orbit camera - move mouse to add offset, camera follows plane when idle
    let mouseInitialized = false;
    document.addEventListener('mousemove', (e) => {
        if (gameOver && !shotDownFalling) return;
        if (keys['KeyC']) return;  // Don't update orbit when looking behind
        mouse.lastMoveTime = performance.now() / 1000;
        if (!mouseInitialized) {
            mouse.prevX = e.clientX;
            mouse.prevY = e.clientY;
            mouseInitialized = true;
            return;
        }
        const dx = e.clientX - mouse.prevX;
        const dy = e.clientY - mouse.prevY;
        cameraOrbit.thetaOffset -= dx * cameraOrbit.sensitivity;
        cameraOrbit.phiOffset -= dy * cameraOrbit.sensitivity;
        cameraOrbit.phiOffset = THREE.MathUtils.clamp(cameraOrbit.phiOffset, -0.8, 0.8);
        mouse.prevX = e.clientX;
        mouse.prevY = e.clientY;
    });
    
    document.addEventListener('wheel', (e) => {
        if (gameOver && !shotDownFalling) return;
        e.preventDefault();
        const zoomSpeed = 2;
        cameraOrbit.radius += e.deltaY > 0 ? zoomSpeed : -zoomSpeed;
        cameraOrbit.radius = THREE.MathUtils.clamp(cameraOrbit.radius, cameraOrbit.minRadius, cameraOrbit.maxRadius);
    }, { passive: false });
    
    document.getElementById('restart-btn').addEventListener('click', restart);
    
    animate();
}

// ============ UPDATE PLANE ============
function updatePlane(delta) {
    if (!plane) return;
    if (gameOver && !shotDownFalling) return;  // Crashed, no update
    
    // Shot down: plane keeps flying but failing - loses lift, engine dying, glides to ground
    if (shotDownFalling) {
        plane.updateMatrixWorld(true);
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(plane.quaternion);
        planeState.speed *= 0.992;  // Engine failing - gradual speed loss
        planeState.speed = Math.max(planeState.speed, 15);
        const gravity = -22;
        planeState.verticalVelocity += gravity * delta;  // No lift - gravity pulls down
        planeState.verticalVelocity = Math.max(planeState.verticalVelocity, -50);
        planeState.pitch += 0.12 * delta;  // Nose gradually drops as lift fails
        planeState.pitch = Math.min(planeState.pitch, 0.6);
        planeState.roll += (Math.random() - 0.5) * 0.2 * delta;  // Slight instability
        planeState.rotation.x = planeState.pitch;
        planeState.rotation.z = -planeState.roll;
        planeState.position.add(forward.clone().multiplyScalar(planeState.speed * delta));
        planeState.position.y += planeState.verticalVelocity * delta;
        plane.position.copy(planeState.position);
        plane.rotation.copy(planeState.rotation);
        if (propeller) propeller.rotation.z += planeState.speed * 0.15 * delta;
        // Periodic fire bursts while falling
        const now = performance.now() / 1000;
        if (now - shotDownTime > 0.35) {
            createExplosion(planeState.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 4)));
            shotDownTime = now;
        }
        updateCameraOrbit(delta);
        checkCollision();
        document.getElementById('altitude').textContent = Math.floor(planeState.position.y);
        document.getElementById('speed').textContent = Math.floor(planeState.speed);
        return;
    }
    
    // GTA-style controls: W/S throttle, A/D roll, Numpad pitch/yaw
    const turnRate = 1.0;
    const pitchRate = 0.9;
    
    // W/S - Throttle
    if (keys['KeyW']) planeState.speed = Math.min(planeState.maxSpeed, planeState.speed + 40 * delta);
    if (keys['KeyS']) planeState.speed = Math.max(planeState.minSpeed, planeState.speed - 40 * delta);
    
    // A/D - Roll + bank into turn (affects both Z and Y)
    if (keys['KeyA']) { planeState.roll += turnRate * delta; planeState.turnRoll += turnRate * delta; }
    if (keys['KeyD']) { planeState.roll -= turnRate * delta; planeState.turnRoll -= turnRate * delta; }
    
    // Numpad 4/6 - Pure roll on Z axis only (inverted: 4=roll right, 6=roll left)
    if (keys['Numpad4']) planeState.roll -= turnRate * 1.5 * delta;
    if (keys['Numpad6']) planeState.roll += turnRate * 1.5 * delta;
    
    // Numpad 8/5 - Pitch (nose up/down) - inverted
    if (keys['Numpad8']) planeState.pitch -= pitchRate * delta;  // nose down
    if (keys['Numpad5']) planeState.pitch += pitchRate * delta;  // nose up
    
    // Numpad 2 - nose down (alternate)
    if (keys['Numpad2']) planeState.pitch -= pitchRate * delta;
    
    // Fallback: Arrow keys
    if (keys['ArrowUp']) planeState.pitch += pitchRate * delta;
    if (keys['ArrowDown']) planeState.pitch -= pitchRate * delta;
    if (keys['ArrowLeft']) planeState.yaw += turnRate * delta;
    if (keys['ArrowRight']) planeState.yaw -= turnRate * delta;
    
    planeState.pitch = THREE.MathUtils.clamp(planeState.pitch, -1.2, 1.2);
    planeState.roll *= 0.995;    // Very slow decay - allows full 360° roll
    planeState.turnRoll *= 0.995;
    
    planeState.rotation.x = planeState.pitch;
    planeState.rotation.z = -planeState.roll;
    planeState.rotation.y += planeState.turnRoll * 0.6 * delta;  // Only A/D affects heading
    planeState.rotation.y += planeState.yaw * 0.4 * delta;
    planeState.yaw *= 0.95;
    
    plane.rotation.copy(planeState.rotation);
    plane.updateMatrixWorld(true);
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(plane.quaternion);
    planeState.velocity.copy(forward).multiplyScalar(planeState.speed);
    
    // Gravity and lift - plane tends to sink; must pitch up slightly to maintain altitude
    const gravity = -22;
    const stallSpeed = 38;
    const cruiseSpeed = 75;
    const isStalling = planeState.speed < stallSpeed && planeState.pitch > 0.25;
    let liftAccel = 0;
    if (isStalling) {
        liftAccel = -16;  // Stall: sudden loss of lift, nose drops
        planeState.pitch -= 1.5 * delta;  // Nose drops during stall
        planeState.pitch = Math.max(-0.5, planeState.pitch);
    } else {
        // Lift balances gravity at cruise speed when level (pitch 0) - neutral altitude
        const speedLift = (planeState.speed / cruiseSpeed) * (-gravity);
        const pitchLift = planeState.pitch * 25;  // Nose up adds lift, nose down reduces it
        liftAccel = speedLift + pitchLift;
    }
    planeState.verticalVelocity += (gravity + liftAccel) * delta;
    planeState.verticalVelocity = THREE.MathUtils.clamp(planeState.verticalVelocity, -55, 50);
    
    planeState.position.add(planeState.velocity.clone().multiplyScalar(delta));
    planeState.position.y += planeState.verticalVelocity * delta;
    
    plane.position.copy(planeState.position);
    
    // Spin propeller based on speed (rotation around Z = prop axis)
    if (propeller) {
        propeller.rotation.z += planeState.speed * 0.2 * delta;
    }
    
    // Missile reload - show stored missile when reload complete
    if (wingMissileLeft) {
        wingMissileReload.left = Math.max(0, wingMissileReload.left - delta);
        if (wingMissileReload.left <= 0) wingMissileLeft.visible = true;
    }
    if (wingMissileRight) {
        wingMissileReload.right = Math.max(0, wingMissileReload.right - delta);
        if (wingMissileReload.right <= 0) wingMissileRight.visible = true;
    }
    
    // Flaps move with controls
    const flapRate = 1.2;
    const maxFlapAngle = 0.65;
    const rollFlapRate = 1.0;
    const flapResetSpeed = 5;  // How fast differential resets when 4/6 released
    let flapDelta = 0;
    let leftFlapDelta = 0, rightFlapDelta = 0;
    if (keys['Numpad5'] || keys['KeyS']) flapDelta += flapRate * delta;   // Both deploy
    if (keys['Numpad8'] || keys['KeyW']) flapDelta -= flapRate * delta;   // Both retract
    if (keys['Numpad2']) flapDelta -= flapRate * delta;
    if (keys['Numpad4']) { leftFlapDelta += rollFlapRate * delta; rightFlapDelta -= rollFlapRate * delta; }  // Left down, right up
    if (keys['Numpad6']) { leftFlapDelta -= rollFlapRate * delta; rightFlapDelta += rollFlapRate * delta; }  // Left up, right down
    if (flaps.length >= 2) {
        flaps[0].rotation.x += flapDelta + leftFlapDelta;   // Left flap
        flaps[1].rotation.x += flapDelta + rightFlapDelta; // Right flap
        if (!keys['Numpad4'] && !keys['Numpad6']) {
            const avg = (flaps[0].rotation.x + flaps[1].rotation.x) / 2;
            const t = Math.min(1, delta * flapResetSpeed);
            flaps[0].rotation.x += (avg - flaps[0].rotation.x) * t;
            flaps[1].rotation.x += (avg - flaps[1].rotation.x) * t;
        }
        flaps[0].rotation.x = THREE.MathUtils.clamp(flaps[0].rotation.x, 0, maxFlapAngle);
        flaps[1].rotation.x = THREE.MathUtils.clamp(flaps[1].rotation.x, 0, maxFlapAngle);
    }
    
    // Orbit camera: follows plane, auto-centers when mouse idle
    updateCameraOrbit(delta);
    
    checkCollision();
    
    document.getElementById('altitude').textContent = Math.floor(planeState.position.y);
    document.getElementById('speed').textContent = Math.floor(planeState.speed);
}

// ============ UPDATE CAMERA ORBIT ============
function updateCameraOrbit(delta) {
    const targetPos = plane ? plane.position : planeState.position;
    const r = cameraOrbit.radius;
    
    // C = look behind (rear view)
    const lookBehind = keys['KeyC'];
    
    // Auto-center: when mouse idle, smoothly return offset to 0 (skip when looking behind)
    if (!lookBehind) {
        const now = performance.now() / 1000;
        const timeSinceMouseMove = now - mouse.lastMoveTime;
        if (timeSinceMouseMove > cameraOrbit.idleTimeToCenter) {
            const lerp = Math.min(1, cameraOrbit.autoCenterSpeed * delta);
            cameraOrbit.thetaOffset += (0 - cameraOrbit.thetaOffset) * lerp;
            cameraOrbit.phiOffset += (0 - cameraOrbit.phiOffset) * lerp;
            if (Math.abs(cameraOrbit.thetaOffset) < 0.005) cameraOrbit.thetaOffset = 0;
            if (Math.abs(cameraOrbit.phiOffset) < 0.005) cameraOrbit.phiOffset = 0;
        }
    }
    
    // Camera follows plane orientation - moves with pitch and roll
    if (!plane) return;
    plane.updateMatrixWorld(true);
    const planeUp = new THREE.Vector3(0, 1, 0).applyQuaternion(plane.quaternion);
    const planeRight = new THREE.Vector3(1, 0, 0).applyQuaternion(plane.quaternion);
    const planeBack = new THREE.Vector3(0, 0, 1).applyQuaternion(plane.quaternion);
    
    const phi = lookBehind ? 0.25 : THREE.MathUtils.clamp(0.25 + cameraOrbit.phiOffset, -0.7, 0.7);
    const theta = lookBehind ? Math.PI : cameraOrbit.thetaOffset;
    // Spherical coords: cos(theta) for back/front, sin(theta) for left/right - allows full 360° orbit
    const horiz = r * Math.cos(phi);
    const camOffset = planeBack.clone().multiplyScalar(horiz * Math.cos(theta))
        .add(planeUp.clone().multiplyScalar(r * Math.sin(phi)))
        .add(planeRight.clone().multiplyScalar(horiz * Math.sin(theta)));
    
    camera.position.copy(targetPos).add(camOffset);
    
    if (cameraShake.duration > 0) {
        const decay = 1 - cameraShake.elapsed / cameraShake.duration;
        const shake = cameraShake.intensity * decay * decay;
        camera.position.x += (Math.random() - 0.5) * 2 * shake;
        camera.position.y += (Math.random() - 0.5) * 2 * shake;
        camera.position.z += (Math.random() - 0.5) * 2 * shake;
        cameraShake.elapsed += delta;
        if (cameraShake.elapsed >= cameraShake.duration) {
            cameraShake.duration = 0;
        }
    }
    
    camera.lookAt(targetPos);
}

function triggerCameraShake(intensity = 0.6, duration = 0.4) {
    cameraShake.intensity = intensity;
    cameraShake.duration = duration;
    cameraShake.elapsed = 0;
}

function triggerScreenBrighten(intensity = 0.5, duration = 0.5) {
    screenBrighten.intensity = intensity;
    screenBrighten.duration = duration;
    screenBrighten.elapsed = 0;
}

function updateScreenBrighten(delta) {
    const el = document.getElementById('screen-brighten');
    if (!el || screenBrighten.duration <= 0) return;
    screenBrighten.elapsed += delta;
    const t = screenBrighten.elapsed / screenBrighten.duration;
    // Quick brighten (0-0.2), then fade back (0.2-1)
    let opacity = 0;
    if (t < 0.2) {
        opacity = (t / 0.2) * screenBrighten.intensity;
    } else {
        opacity = screenBrighten.intensity * (1 - (t - 0.2) / 0.8);
    }
    el.style.opacity = Math.max(0, opacity);
    if (screenBrighten.elapsed >= screenBrighten.duration) {
        screenBrighten.duration = 0;
        el.style.opacity = 0;
    }
}

// ============ MINIMAP (rotating map, fixed arrow pointing up = direction of travel) ============
function updateMinimap() {
    const canvas = document.getElementById('minimap-canvas');
    if (!canvas || !plane) return;
    
    const ctx = canvas.getContext('2d');
    const size = 160;
    const center = size / 2;
    // Use velocity direction for heading - ensures map shows actual direction of travel
    const vx = planeState.velocity.x;
    const vz = planeState.velocity.z;
    const yaw = Math.atan2(vx, -vz);  // Heading from velocity (forward = -Z when yaw 0)
    const scale = size / 1200;  // Show ~600 units radius
    const playerX = planeState.position.x;
    const playerZ = planeState.position.z;
    
    // Rotate the map content so arrow stays fixed (up = direction of travel)
    ctx.save();
    ctx.translate(center, center);
    ctx.rotate(-yaw);
    ctx.translate(-center, -center);
    
    // Clear with dark background
    ctx.fillStyle = 'rgba(12, 20, 35, 0.95)';
    ctx.beginPath();
    ctx.arc(center, center, center - 3, 0, Math.PI * 2);
    ctx.fill();
    
    // Grid lines (rotate with map)
    ctx.strokeStyle = 'rgba(0, 255, 204, 0.12)';
    ctx.lineWidth = 1;
    for (let r = 40; r < center; r += 40) {
        ctx.beginPath();
        ctx.arc(center, center, r, 0, Math.PI * 2);
        ctx.stroke();
    }
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        ctx.beginPath();
        ctx.moveTo(center, center);
        ctx.lineTo(center + Math.cos(a) * (center - 3), center + Math.sin(a) * (center - 3));
        ctx.stroke();
    }
    
    // Enemy blips - use world coords (dx, dz); context rotation handles the rest
    ctx.font = 'bold 9px Rajdhani, sans-serif';
    for (const cannon of cannons) {
        if (!cannon.active) continue;
        const dx = cannon.position.x - playerX;
        const dz = cannon.position.z - playerZ;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > 600) continue;
        const mx = center + dx * scale;
        const mz = center + dz * scale;  // -Z = up on map
        if (mx < 8 || mx > size - 8 || mz < 8 || mz > size - 8) continue;
        ctx.fillStyle = '#ff4444';
        ctx.strokeStyle = '#ff6666';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(mx, mz - 5);
        ctx.lineTo(mx + 5, mz);
        ctx.lineTo(mx, mz + 5);
        ctx.lineTo(mx - 5, mz);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }
    
    // North indicator - fixed at top in map space, so it rotates with the map
    const nx = center;
    const nz = 20;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = 'bold 10px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, nz);
    
    ctx.restore();  // End map rotation
    
    // Player indicator: fixed arrow always pointing up (direction of travel)
    ctx.save();
    ctx.translate(center, center);
    ctx.strokeStyle = '#00ffcc';
    ctx.fillStyle = '#00ffcc';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -18);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -22);
    ctx.lineTo(-5, -14);
    ctx.lineTo(5, -14);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 255, 204, 0.9)';
    ctx.fill();
    ctx.strokeStyle = '#00ffcc';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    
    // Border ring
    ctx.strokeStyle = 'rgba(0, 255, 204, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(center, center, center - 3, 0, Math.PI * 2);
    ctx.stroke();
}

// ============ LOCK BRACKET (screen-space indicator) ============
function updateLockBracket() {
    const el = document.getElementById('lock-bracket');
    if (!el || !camera) return;
    if (gameOver) { el.style.display = 'none'; return; }
    
    if (!lockedCannon || !lockedCannon.active) {
        el.style.display = 'none';
        return;
    }
    
    const vector = lockedCannon.position.clone().project(camera);
    if (vector.z > 1) {
        el.style.display = 'none';
        return;
    }
    
    const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
    const y = (vector.y * -0.5 + 0.5) * window.innerHeight;
    const size = 48;
    
    el.style.display = 'block';
    el.style.left = (x - size/2) + 'px';
    el.style.top = (y - size/2) + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
}

// ============ LOCK-ON TARGET ============
function getLockTarget() {
    if (!plane || cannons.length === 0) return null;
    plane.updateMatrixWorld(true);
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(plane.quaternion);
    const planePos = planeState.position;
    const lockRange = 550;
    const maxAngle = 0.85;  // ~58 deg cone in front
    
    let best = null;
    let bestDist = lockRange + 1;
    
    for (const cannon of cannons) {
        if (!cannon.active) continue;
        const toCannon = cannon.position.clone().sub(planePos);
        const dist = toCannon.length();
        if (dist > lockRange) continue;
        const dot = forward.dot(toCannon.normalize());
        if (dot < maxAngle) continue;
        if (dist < bestDist) {
            bestDist = dist;
            best = cannon;
        }
    }
    return best;
}

// ============ UPDATE PLAYER MISSILES ============
function updatePlayerMissiles(delta) {
    const now = performance.now();
    const missileLifetime = 5000;
    
    for (let i = playerMissiles.length - 1; i >= 0; i--) {
        const m = playerMissiles[i];
        if (!m.userData.active) {
            scene.remove(m);
            playerMissiles.splice(i, 1);
            continue;
        }
        
        const target = m.userData.target;
        if (target && target.active) {
            const toTarget = target.position.clone().sub(m.userData.position).normalize();
            m.userData.velocity.lerp(toTarget.multiplyScalar(200), m.userData.homingStrength * delta);
            m.userData.velocity.clampLength(120, 220);
        }
        
        m.userData.position.add(m.userData.velocity.clone().multiplyScalar(delta));
        m.position.copy(m.userData.position);
        const vel = m.userData.velocity.clone();
        if (vel.lengthSq() > 0.01) {
            vel.normalize();
            m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), vel);
        }
        
        // Terrain collision - explode on impact
        const terrainH = getTerrainHeight(m.userData.position.x, m.userData.position.z);
        if (m.userData.position.y <= terrainH + 0.5) {
            createExplosion(m.userData.position.clone());
            m.userData.active = false;
            continue;
        }
        
        for (let j = cannons.length - 1; j >= 0; j--) {
            const cannon = cannons[j];
            if (!cannon.active) continue;
            const dist = m.userData.position.distanceTo(cannon.position);
            if (dist < cannon.radius + 1) {
                createExplosion(cannon.position.clone());
                triggerScreenBrighten(0.95, 0.6);
                scene.remove(cannon.mesh);
                cannon.active = false;
                cannons.splice(j, 1);
                if (lockedCannon === cannon) lockedCannon = null;
                m.userData.active = false;
                break;
            }
        }
        
        if (now - m.userData.spawnTime > missileLifetime) {
            createExplosion(m.userData.position.clone());
            m.userData.active = false;
        }
    }
}

// ============ UPDATE CANNONS ============
function updateCannons(delta) {
    if (gameOver || !plane) return;
    const now = performance.now() / 1000;
    const cannonRange = 450;
    const cannonFireInterval = 2.5;
    
    for (const cannon of cannons) {
        if (!cannon.active) continue;
        const dx = planeState.position.x - cannon.position.x;
        const dz = planeState.position.z - cannon.position.z;
        const dist2D = Math.sqrt(dx * dx + dz * dz);
        if (dist2D < cannonRange && now - cannon.lastFireTime > cannonFireInterval) {
            fireMissile(cannon.position);
            cannon.lastFireTime = now;
        }
    }
}

// ============ UPDATE MISSILES ============
function updateMissiles(delta) {
    if (gameOver) return;
    const now = performance.now();
    const missileLifetime = 8000;
    const homingStrength = 1.5;  // Higher = harder to dodge (tracks player more aggressively)
    
    for (let i = missiles.length - 1; i >= 0; i--) {
        const m = missiles[i];
        if (!m.userData.active) {
            scene.remove(m);
            missiles.splice(i, 1);
            continue;
        }
        
        const toPlayer = planeState.position.clone().sub(m.userData.position).normalize();
        m.userData.velocity.lerp(toPlayer.multiplyScalar(105), homingStrength * delta);
        m.userData.velocity.clampLength(65, 115);
        m.userData.position.add(m.userData.velocity.clone().multiplyScalar(delta));
        m.position.copy(m.userData.position);
        const eVel = m.userData.velocity.clone();
        if (eVel.lengthSq() > 0.01) {
            eVel.normalize();
            m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), eVel);
        }
        
        const hitDist = m.userData.position.distanceTo(planeState.position);
        if (hitDist < 4 && plane) {
            createExplosion(planeState.position.clone());
            hitByMissile = true;
            shotDownFalling = true;
            gameOver = true;
            shotDownTime = performance.now() / 1000;
            setPlaneOnFire();
            showGameOver('SHOT DOWN!', 'You were hit by an enemy missile');
            m.userData.active = false;
        }
        
        if (now - m.userData.spawnTime > missileLifetime) {
            createExplosion(m.userData.position.clone());
            m.userData.active = false;
        }
    }
}

// ============ UPDATE EXPLOSION ============
function updateExplosions(delta) {
    for (let i = explosionParticles.length - 1; i >= 0; i--) {
        const p = explosionParticles[i];
        const positions = p.geometry.attributes.position;
        const colors = p.geometry.attributes.color;
        const vels = p.userData.velocities;
        
        for (let j = 0; j < vels.length; j++) {
            vels[j].life -= vels[j].decay;
            positions.array[j * 3] += vels[j].x * delta;
            positions.array[j * 3 + 1] += vels[j].y * delta;
            positions.array[j * 3 + 2] += vels[j].z * delta;
            
            const life = vels[j].life;
            colors.array[j * 3] = 1;
            colors.array[j * 3 + 1] = life * 0.5;
            colors.array[j * 3 + 2] = 0;
        }
        
        positions.needsUpdate = true;
        colors.needsUpdate = true;
        p.material.opacity = Math.max(0, p.userData.velocities[0]?.life || 0);
        
        if (p.userData.velocities[0]?.life <= 0) {
            scene.remove(p);
            explosionParticles.splice(i, 1);
        }
    }
}

// ============ UPDATE GROUND FIRE ============
function updateGroundFire(delta) {
    for (let i = groundFireParticles.length - 1; i >= 0; i--) {
        const p = groundFireParticles[i];
        const positions = p.geometry.attributes.position;
        const colors = p.geometry.attributes.color;
        const vels = p.userData.velocities;
        
        p.userData.elapsed += delta;
        
        for (let j = 0; j < vels.length; j++) {
            vels[j].life -= vels[j].decay;
            positions.array[j * 3] += vels[j].x * delta;
            positions.array[j * 3 + 1] += vels[j].y * delta;
            positions.array[j * 3 + 2] += vels[j].z * delta;
            
            const life = Math.max(0, vels[j].life);
            colors.array[j * 3] = 1;
            colors.array[j * 3 + 1] = life * 0.6;
            colors.array[j * 3 + 2] = 0;
        }
        
        positions.needsUpdate = true;
        colors.needsUpdate = true;
        p.material.opacity = Math.max(0, 0.9 - p.userData.elapsed / p.userData.duration);
        
        if (p.userData.elapsed >= p.userData.duration) {
            scene.remove(p);
            groundFireParticles.splice(i, 1);
        }
    }
}

// ============ ANIMATE ============
let lastTime = performance.now();
let lastFire = 0;

function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const delta = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    
    updatePlane(delta);
    lockedCannon = getLockTarget();  // Automatic lock - no key needed
    updateMinimap();
    updateLockBracket();
    updateScreenBrighten(delta);
    updatePlayerMissiles(delta);
    updateCannons(delta);
    updateMissiles(delta);
    updateExplosions(delta);
    updateGroundFire(delta);
    if (water && water.material.uniforms) {
        water.material.uniforms.uTime.value = now * 0.001;
        const sunDir = new THREE.Vector3(100, 200, 50).normalize();
        water.material.uniforms.uSunDirection.value.copy(
            sunDir.transformDirection(camera.matrixWorldInverse)
        );
    }
    
    
    if (keys['Space'] && !gameOver && now - lastFire > 400) {
        firePlayerMissile();
        lastFire = now;
    }
    
    document.getElementById('lock-status').textContent = (!gameOver && lockedCannon) ? 'LOCKED' : '';
    document.getElementById('kills').textContent = initialCannonCount - cannons.length;
    document.getElementById('cannons-remaining').textContent = cannons.length;
    
    renderer.render(scene, camera);
}

// ============ RESTART ============
function restart() {
    gameOver = false;
    crashed = false;
    hitByMissile = false;
    shotDownFalling = false;
    
    playerMissiles.forEach(m => scene.remove(m));
    playerMissiles = [];
    lockedCannon = null;
    
    cannons.forEach(c => { if (c.mesh.parent) c.mesh.parent.remove(c.mesh); });
    cannons = [];
    missiles.forEach(m => scene.remove(m));
    missiles = [];
    
    createCannons();
    
    explosionParticles.forEach(p => scene.remove(p));
    explosionParticles = [];
    groundFireParticles.forEach(p => scene.remove(p));
    groundFireParticles = [];
    
    planeState.position.set(-TERRAIN_SIZE / 2, 100, -TERRAIN_SIZE / 2);  // Center of terrain
    planeState.velocity.set(0, 0, -50);
    planeState.rotation.set(0, 0, 0);
    planeState.pitch = 0;
    planeState.roll = 0;
    planeState.turnRoll = 0;
    planeState.yaw = 0;
    planeState.speed = 75;
    planeState.verticalVelocity = 0;
    
    cameraOrbit.thetaOffset = 0;
    cameraOrbit.phiOffset = 0;
    
    // Remove crashed plane and create fresh one
    if (plane) {
        scene.remove(plane);
    }
    wingMissileReload.left = 0;
    wingMissileReload.right = 0;
    createPlane();
    
    document.getElementById('status').textContent = 'FLYING';
    document.getElementById('game-over-overlay').style.display = 'none';
    document.getElementById('game-over').style.display = 'none';
}

// ============ RESIZE ============
function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Start
init();
