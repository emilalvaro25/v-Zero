/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
const vs = `
#define STANDARD

varying vec3 vViewPosition;

// Varyings vViewPosition and vNormal are provided by included chunks.

#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

uniform float time;
uniform vec4 inputData;
uniform vec4 outputData;

vec3 calc( vec3 pos ) {
  vec3 dir = normalize( pos );
  vec3 p = dir + vec3( time, 0., 0. );
  return pos +
    1. * inputData.x * inputData.y * dir * (.5 + .5 * sin(inputData.z * pos.x + time)) +
    1. * outputData.x * outputData.y * dir * (.5 + .5 * sin(outputData.z * pos.y + time))
  ;
}

vec3 spherical( float r, float theta, float phi ) {
  return r * vec3(
    cos( theta ) * cos( phi ),
    sin( theta ) * cos( phi ),
    sin( phi )
  );
}

void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <batching_vertex>

	#include <begin_vertex>
    
    // Custom Displacement Logic
    float r = length( position );
    float theta = ( uv.x + 0.5 ) * 2. * PI;
    float phi = -( uv.y + 0.5 ) * PI;
    transformed = calc( spherical( r, theta, phi ) );

	#include <morphinstance_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>

    vViewPosition = - mvPosition.xyz;

    #include <worldpos_vertex>
    #include <shadowmap_vertex>

    // Normal Calculation
    #include <beginnormal_vertex>
    #include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
    
    // Custom Normal Calculation (overwrites default)
    float inc = 0.001;
    vec3 tangent = normalize( calc( spherical( r, theta + inc, phi ) ) - transformed );
    vec3 bitangent = normalize( calc( spherical( r, theta, phi + inc ) ) - transformed );
    objectNormal = -normalize( cross( tangent, bitangent ) );

    #include <normal_vertex>

	#include <fog_vertex>
}
`;

const fs = `
precision highp float;

varying vec3 vNormal;
varying vec3 vViewPosition;
uniform float time;

// Simplex 2D noise
//
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187,  // (3.0-sqrt(3.0))/6.0
                        0.366025403784439,  // 0.5*(sqrt(3.0)-1.0)
                       -0.577350269189626,  // -1.0 + 2.0 * C.x
                        0.024390243902439); // 1.0 / 41.0
    vec2 i  = floor(v + dot(v, C.yy) );
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1;
    i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
        + i.x + vec3(0.0, i1.x, 1.0 ));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m;
    m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= (1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h ));
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

float FBM(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 6; i++) {
    value += amplitude * snoise(p);
    p *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec3 viewDir = normalize(vViewPosition);

  // Rim light effect
  float rim = 1.0 - smoothstep(0.0, 1.0, dot(vNormal, viewDir));
  vec3 rimColor = pow(rim, 3.0) * vec3(0.5, 0.7, 1.0);

  // Procedural clouds
  vec2 p = vNormal.xy * 3.0;
  float noise = FBM(p + time * 0.1);

  vec3 baseColor = vec3(0.0, 0.1, 0.3); // Deep blue
  vec3 cloudColor1 = vec3(0.1, 0.4, 0.9); // Mid blue
  vec3 cloudColor2 = vec3(0.8, 0.9, 1.0); // Bright white-blue

  vec3 finalColor = baseColor;
  finalColor = mix(finalColor, cloudColor1, smoothstep(0.4, 0.6, noise));
  finalColor = mix(finalColor, cloudColor2, smoothstep(0.7, 0.8, noise));

  finalColor += rimColor;

  gl_FragColor = vec4(finalColor, 1.0);
}
`;

export {fs, vs};