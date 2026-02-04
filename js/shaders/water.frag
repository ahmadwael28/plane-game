uniform float uTime;
uniform vec3 uWaterColor;
uniform vec3 uDeepColor;
uniform vec3 uSkyColor;
uniform vec3 uHorizonColor;
uniform vec3 uCameraPosition;
uniform float uWaterSize;
uniform float uMoveFactor;
uniform sampler2D uDudvMap;
uniform sampler2D uNormalMap;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
varying vec2 textureCoords;
varying vec3 vViewPosition;
varying vec3 vWorldPosition;
varying vec3 vNormal;
varying float vFogDepth;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float hash(vec2 p, float t) {
    return fract(sin(dot(p + t, vec2(127.1, 311.7))) * 43758.5453);
}
float simplexNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
    float v = 0.0, a = 0.5, f = 1.0;
    for (int i = 0; i < 4; i++) {
        v += a * simplexNoise(p * f + uTime * 0.25);
        a *= 0.5;
        f *= 2.0;
    }
    return v;
}
vec3 getRippleNormal(vec2 pos) {
    float eps = 1.5;
    float h = fbm(pos * 0.28);
    float hx = fbm(pos * 0.28 + vec2(eps, 0.0));
    float hz = fbm(pos * 0.28 + vec2(0.0, eps));
    vec3 smallRipple = normalize(vec3(h - hx, 1.0, h - hz));
    return normalize(vNormal + smallRipple * 0.35);
}

vec2 sampleDudv(vec2 uv) {
    return texture2D(uDudvMap, uv).rg;
}

vec3 baseWaterColor() {
    return vec3(0.0, 0.0, 1.0);
}

vec3 sampleEnvironment(vec3 R) {
    float y = R.y;
    vec3 zenithColor = uSkyColor;
    vec3 horizonColor = uHorizonColor;
    vec3 groundColor = uDeepColor;
    float t = smoothstep(-0.15, 0.0, y);
    vec3 lower = mix(groundColor, horizonColor, t);
    t = smoothstep(0.0, 0.4, y);
    vec3 mid = mix(horizonColor, zenithColor, t);
    t = smoothstep(0.4, 1.0, y);
    vec3 env = mix(mid, zenithColor, t);
    return env;
}

const float tiling = 64.0;

void main() {
    const float waveStrength = 0.012;
    
    vec2 dudvSample1 = sampleDudv(vec2(textureCoords.x + uMoveFactor, textureCoords.y)) * 0.1;
    vec2 distortedTexCoords = textureCoords + vec2(dudvSample1.x, dudvSample1.y + uMoveFactor);
    vec2 totalDistortion = (sampleDudv(distortedTexCoords) * 2.0 - 1.0) * waveStrength;
    
    vec4 normalMapColour = texture2D(uNormalMap, distortedTexCoords);
    vec3 normalFromMap = normalize(vec3(normalMapColour.r * 2.0 - 1.0, normalMapColour.b * 3.0, normalMapColour.g * 2.0 - 1.0));
    
    vec3 viewDirWorld = normalize(uCameraPosition - vWorldPosition);
    vec3 viewDir = normalize(vViewPosition);
    vec2 uv = (textureCoords / tiling) * uWaterSize * 0.001;
    vec3 N = normalize(vNormal + normalFromMap * 0.6);
    
    float NdotV = max(dot(N, viewDir), 0.0);
    float F0 = 0.02;
    float fresnel = F0 + (1.0 - F0) * pow(1.0 - NdotV, 5.0);
    
    vec3 R = reflect(-viewDirWorld, N);
    R.xz += totalDistortion * 0.8;
    R = normalize(R);
    vec3 envReflection = sampleEnvironment(R);
    
    vec3 N1 = getRippleNormal(uv + vec2(1.5, 0.0));
    vec3 N2 = getRippleNormal(uv + vec2(0.0, 1.5));
    vec3 N3 = getRippleNormal(uv + vec2(1.0, 1.0));
    vec3 N4 = getRippleNormal(uv + vec2(-1.0, 0.5));
    vec3 R1 = reflect(-viewDirWorld, N1);
    vec3 R2 = reflect(-viewDirWorld, N2);
    vec3 R3 = reflect(-viewDirWorld, N3);
    vec3 R4 = reflect(-viewDirWorld, N4);
    envReflection = (envReflection + sampleEnvironment(R1) + sampleEnvironment(R2) + sampleEnvironment(R3) + sampleEnvironment(R4)) / 5.0;
    
    vec3 deepColor = mix(baseWaterColor(), uDeepColor, 0.6);
    vec3 reflectColor = mix(deepColor, envReflection, fresnel * 0.95);
    
    vec3 finalColor = reflectColor;
    finalColor = mix(finalColor, vec3(0.0, 0.3, 0.5), 0.2);
    float alpha = mix(0.45, 0.72, fresnel);
    
    vec4 baseColor = vec4(finalColor, alpha);
    float fogFactor = clamp((fogFar - vFogDepth) / (fogFar - fogNear), 0.0, 1.0);
    gl_FragColor = mix(vec4(fogColor, alpha), baseColor, fogFactor);
}
