uniform float uTime;
uniform float uWaterSize;
varying vec2 textureCoords;
varying vec3 vViewPosition;
varying vec3 vWorldPosition;
varying vec3 vNormal;
varying float vFogDepth;

#define PI 3.14159265359

vec3 gerstnerWave(vec2 uv, vec2 dir, float steepness, float wavelength, float t, inout vec3 tangent, inout vec3 binormal) {
    float k = 2.0 * PI / wavelength;
    float c = sqrt(9.8 / k);
    vec2 d = normalize(dir);
    float f = k * (dot(d, uv) - c * t);
    float a = steepness / k;
    tangent += vec3(-d.x * d.x * (steepness * sin(f)), d.x * (steepness * cos(f)), -d.x * d.y * (steepness * sin(f)));
    binormal += vec3(-d.x * d.y * (steepness * sin(f)), d.y * (steepness * cos(f)), -d.y * d.y * (steepness * sin(f)));
    return vec3(d.x * (a * cos(f)), a * sin(f), d.y * (a * cos(f)));
}

const float tiling = 64.0;

void main() {
    vec2 pos = vec2(position.x, position.z);
    vec2 baseCoords = vec2(position.x / uWaterSize + 0.5, position.z / uWaterSize + 0.5);
    textureCoords = baseCoords * tiling;
    
    vec3 tangent = vec3(1.0, 0.0, 0.0);
    vec3 binormal = vec3(0.0, 0.0, 1.0);
    vec3 disp = vec3(0.0);
    disp += gerstnerWave(pos, vec2(1.0, 0.3), 0.01, 16.0, uTime * 0.6, tangent, binormal);
    disp += gerstnerWave(pos, vec2(-0.7, 0.6), 0.008, 12.0, uTime * 0.5, tangent, binormal);
    disp += gerstnerWave(pos, vec2(0.4, -0.9), 0.006, 10.0, uTime * 0.4, tangent, binormal);
    disp += gerstnerWave(pos, vec2(-0.2, -0.5), 0.005, 8.0, uTime * 0.35, tangent, binormal);
    vec3 newPos = vec3(position.x, 0.0, position.z) + disp * 0.5;
    vec4 worldPos = modelMatrix * vec4(newPos, 1.0);
    vWorldPosition = worldPos.xyz;
    vNormal = normalize(cross(binormal, tangent));
    vec4 mvPosition = modelViewMatrix * vec4(newPos, 1.0);
    vViewPosition = -mvPosition.xyz;
    vFogDepth = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
}
