uniform vec3 uZenithColor;
uniform vec3 uHorizonColor;
uniform vec3 uGroundColor;
varying vec3 vWorldPosition;
varying vec3 vViewDirection;

void main() {
    vec3 dir = normalize(vWorldPosition);
    float h = dir.y;
    float t = smoothstep(-0.1, 0.5, h);
    vec3 skyColor = mix(uHorizonColor, uZenithColor, t);
    float groundMask = smoothstep(0.0, -0.05, h);
    skyColor = mix(skyColor, uGroundColor, groundMask);
    gl_FragColor = vec4(skyColor, 1.0);
}
