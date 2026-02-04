uniform sampler2D backgroundTexture;
uniform sampler2D rTexture;
uniform sampler2D gTexture;
uniform sampler2D bTexture;
uniform sampler2D blendMap;
uniform vec3 lightColor;
uniform vec3 skyColour;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vLightDir;
varying float vVisibility;

void main() {
    vec4 blendMapColour = texture2D(blendMap, vUv);
    float backAmount = 1.0 - (blendMapColour.r + blendMapColour.g + blendMapColour.b);
    vec2 tiled = vUv * 40.0;
    vec4 bgCol = texture2D(backgroundTexture, tiled) * backAmount;
    vec4 rCol = texture2D(rTexture, tiled) * blendMapColour.r;
    vec4 gCol = texture2D(gTexture, tiled) * blendMapColour.g;
    vec4 bCol = texture2D(bTexture, tiled) * blendMapColour.b;
    vec4 totalColour = bgCol + rCol + gCol + bCol;
    vec3 N = normalize(vNormal);
    vec3 L = normalize(vLightDir);
    float NdotL = max(dot(N, L), 0.3);
    vec3 diffuse = NdotL * lightColor.rgb;
    diffuse = max(diffuse, vec3(0.2));
    vec4 lit = vec4(diffuse, 1.0) * totalColour;
    gl_FragColor = mix(vec4(skyColour, 1.0), lit, vVisibility);
}
