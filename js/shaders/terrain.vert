varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vLightDir;
varying float vVisibility;
uniform vec3 lightPosition;
uniform mat4 modelMatrix;
uniform float density;
uniform float gradient;

void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vLightDir = (viewMatrix * vec4(normalize(lightPosition - worldPos.xyz), 0.0)).xyz;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    float dist = length(mvPos.xyz);
    vVisibility = clamp(exp(-pow((dist * density), gradient)), 0.0, 1.0);
    gl_Position = projectionMatrix * mvPos;
}
