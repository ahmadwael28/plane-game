import * as THREE from 'three';

// Terrain
export const TERRAIN_SIZE = 4000;
export const TERRAIN_SEGMENTS = 128;

// Lighting - overhead ambient for terrain (no sun)
export const TERRAIN_LIGHT_POSITION = new THREE.Vector3(0, 5000, 0);

// Missiles
export const MISSILE_RELOAD_TIME = 3;

// Plane model (set to URL to load custom GLB)
export const PLANE_MODEL_URL = null;
