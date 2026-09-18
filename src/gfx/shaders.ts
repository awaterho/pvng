// Copyright (c) 2013-2015 Marco Biasini
// 
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to 
// deal in the Software without restriction, including without limitation the 
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or 
// sell copies of the Software, and to permit persons to whom the Software is 
// furnished to do so, subject to the following conditions:
// 
// The above copyright notice and this permission notice shall be included in 
// all copies or substantial portions of the Software.
// 
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE 
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING 
// FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
// DEALINGS IN THE SOFTWARE.

export interface ShaderSources {
  PRELUDE_FS: string;
  LINES_FS: string;
  SELECT_LINES_FS: string;
  SELECT_LINES_VS: string;
  SELECT_VS: string;
  SELECT_FS: string;
  LINES_VS: string;
  HEMILIGHT_FS: string;
  HEMILIGHT_VS: string;
  OUTLINE_FS: string;
  OUTLINE_VS: string;
  TEXT_VS: string;
  TEXT_FS: string;
  SPHERES_FS: string;
  SPHERES_VS: string;
  SELECT_SPHERES_FS: string;
  SELECT_SPHERES_VS: string;
  OIT_ACCUM_VS: string;
  OIT_ACCUM_HEMILIGHT_FS: string;
  OIT_ACCUM_LINES_VS: string;
  OIT_ACCUM_LINES_FS: string;
  OIT_ACCUM_SPHERES_VS: string;
  OIT_ACCUM_SPHERES_FS: string;
  OIT_COMPOSITE_VS: string;
  OIT_COMPOSITE_FS: string;
  OIT_BLIT_FS: string;
  SSAO_FS: string;
  SSAO_BLUR_FS: string;
}

const shaders: ShaderSources = {
// NOTE: The shader code below use the placeholder ${PRECISION} variable
// for the shader precision. This values is replaced before compiling 
// the shader program with highp on iOS and mediump on all other devices. 
// This is required, because the outline shaders do not work well on iOS 
// with mediump, but some android devices do not support highp.


// this fragment shader prelude gets added to all fragment shader code
// before  compiling. It essentially contains a selection of functions
// required by  multiple fragment shaders, e.g. alpha/opaqueness handling,
// selection highlighting etc.
PRELUDE_FS : '\n\
precision ${PRECISION} float;\n\
uniform bool opaqueOnly;\n\
vec4 handleAlpha(vec4 inColor) {\n\
  if (opaqueOnly) {\n\
    if (inColor.a < 0.999) { discard; }\n\
    return inColor;\n\
  }\n\
  if (inColor.a == 0.0) { discard; }\n\
  return inColor;\n\
} \n\
\n\
int intMod(int x, int y) { \n\
  int z = x/y;\n\
  return x-y*z;\n\
}\n\
\n\
uniform vec4 selectionColor;\n\
\n\
vec3 handleSelect(vec3 inColor, float vertSelect) { \n\
  return mix(inColor, selectionColor.rgb, \n\
             step(0.5, vertSelect) * selectionColor.a); \n\
} \n\
\n\
uniform bool fog;\n\
uniform float fogNear;\n\
uniform float fogFar;\n\
uniform vec3 fogColor;\n\
vec3 handleFog(vec3 inColor) {\n\
  if (fog) {\n\
    float depth = gl_FragCoord.z / gl_FragCoord.w;\n\
    float fogFactor = smoothstep(fogNear, fogFar, depth);\n\
    return mix(inColor, fogColor, fogFactor);\n\
  } else {\n\
    return inColor;\n\
  }\n\
}',

// line fragment shader, essentially uses the vertColor and adds some fog.
LINES_FS : '\n\
varying vec4 vertColor;\n\
varying vec3 vertNormal;\n\
\n\
void main(void) {\n\
  gl_FragColor = handleAlpha(vertColor);\n\
  gl_FragColor.rgb = handleFog(gl_FragColor.rgb);\n\
}',

SELECT_LINES_FS : '\n\
precision ${PRECISION} float;\n\
\n\
varying float vertSelect;\n\
varying vec3 vertNormal;\n\
uniform float fogNear;\n\
uniform float fogFar;\n\
uniform vec3 fogColor;\n\
uniform bool fog;\n\
uniform vec4 selectionColor;\n\
\n\
void main(void) {\n\
  gl_FragColor = mix(vec4(0.0, 0.0, 0.0, 0.0), \n\
                     vec4(selectionColor.rgb, 1.0), vertSelect);\n\
  gl_FragColor.a = step(0.5, vertSelect);\n\
  if (gl_FragColor.a == 0.0) { discard; }\n\
  float depth = gl_FragCoord.z / gl_FragCoord.w;\n\
  if (fog) {\n\
    float fog_factor = smoothstep(fogNear, fogFar, depth);\n\
    gl_FragColor = mix(gl_FragColor, vec4(fogColor, gl_FragColor.w),\n\
                        fog_factor);\n\
  }\n\
}',
// hemilight vertex shader
SELECT_LINES_VS : '\n\
attribute vec3 attrPos;\n\
attribute float attrSelect;\n\
\n\
uniform mat4 projectionMat;\n\
uniform mat4 modelviewMat;\n\
uniform float pointSize;\n\
varying float vertSelect;\n\
void main(void) {\n\
  gl_Position = projectionMat * modelviewMat * vec4(attrPos, 1.0);\n\
  gl_Position.z += gl_Position.w * 0.000001; \n\
  float distToCamera = vec4(modelviewMat * vec4(attrPos, 1.0)).z;\n\
  gl_PointSize = pointSize * 200.0 / abs(distToCamera); \n\
  vertSelect = attrSelect;\n\
}',
 
SELECT_VS : '\n\
precision ${PRECISION} float;\n\
uniform mat4 projectionMat;\n\
uniform mat4 modelviewMat;\n\
uniform float pointSize;\n\
attribute vec3 attrPos;\n\
attribute float attrObjId;\n\
attribute vec4 attrColor;\n\
\n\
varying float objId;\n\
varying float objAlpha;\n\
\n\
void main(void) {\n\
  gl_Position = projectionMat * modelviewMat * vec4(attrPos, 1.0);\n\
  float distToCamera = vec4(modelviewMat * vec4(attrPos, 1.0)).z;\n\
  gl_PointSize = pointSize * 200.0 / abs(distToCamera); \n\
  objId = attrObjId;\n\
  objAlpha = attrColor.a;\n\
}',

SELECT_FS : '\n\
precision ${PRECISION} float;\n\
\n\
varying float objId;\n\
varying float objAlpha;\n\
uniform int symId;\n\
\n\
int intMod(int x, int y) { \n\
  int z = x/y;\n\
  return x-y*z;\n\
}\n\
void main(void) {\n\
  if (objAlpha == 0.0) { discard; }\n\
  // ints are only required to be 7bit...\n\
  int integralObjId = int(objId+0.5);\n\
  int red = intMod(integralObjId, 256);\n\
  integralObjId/=256;\n\
  int green = intMod(integralObjId, 256);\n\
  integralObjId/=256;\n\
  int blue = intMod(integralObjId, 256);\n\
  int alpha = symId;\n\
  gl_FragColor = vec4(float(red), float(green), \n\
                      float(blue), float(alpha))/255.0;\n\
}',
// hemilight vertex shader
LINES_VS : '\n\
attribute vec3 attrPos;\n\
attribute vec4 attrColor;\n\
\n\
uniform mat4 projectionMat;\n\
uniform mat4 modelviewMat;\n\
varying vec4 vertColor;\n\
uniform float pointSize;\n\
void main(void) {\n\
  gl_Position = projectionMat * modelviewMat * vec4(attrPos, 1.0);\n\
  float distToCamera = vec4(modelviewMat * vec4(attrPos, 1.0)).z;\n\
  gl_PointSize = pointSize * 200.0 / abs(distToCamera); \n\
  vertColor = attrColor;\n\
}',

// hemilight fragment shader
HEMILIGHT_FS : '\n\
varying vec4 vertColor;\n\
varying vec3 vertNormal;\n\
varying float vertSelect;\n\
\n\
void main(void) {\n\
  float dp = dot(vertNormal, vec3(0.0, 0.0, 1.0));\n\
  float hemi = min(1.0, max(0.0, dp)*0.6+0.5);\n\
  gl_FragColor = vec4(vertColor.rgb*hemi, vertColor.a);\n\
  gl_FragColor.rgb = handleFog(handleSelect(gl_FragColor.rgb, vertSelect));\n\
  gl_FragColor = handleAlpha(gl_FragColor);\n\
}',

// hemilight vertex shader
HEMILIGHT_VS : '\n\
attribute vec3 attrPos;\n\
attribute vec4 attrColor;\n\
attribute vec3 attrNormal;\n\
attribute float attrSelect;\n\
\n\
uniform mat4 projectionMat;\n\
uniform mat4 modelviewMat;\n\
varying vec4 vertColor;\n\
varying vec3 vertNormal;\n\
varying vec3 vertPos;\n\
varying float vertSelect;\n\
void main(void) {\n\
  vertPos = (modelviewMat * vec4(attrPos, 1.0)).xyz;\n\
  gl_Position = projectionMat * modelviewMat * vec4(attrPos, 1.0);\n\
  vec4 n = (modelviewMat * vec4(attrNormal, 0.0));\n\
  vertNormal = n.xyz;\n\
  vertColor = attrColor;\n\
  vertSelect = attrSelect;\n\
}',

// outline shader. mixes outlineColor with fogColor
OUTLINE_FS : '\n\
varying float vertAlpha;\n\
varying float vertSelect;\n\
\n\
uniform vec3 outlineColor;\n\
\n\
void main() {\n\
  gl_FragColor = vec4(mix(outlineColor, selectionColor.rgb, \n\
                          step(0.5, vertSelect)), \n\
                      vertAlpha);\n\
  gl_FragColor.rgb = handleFog(gl_FragColor.rgb);\n\
  gl_FragColor = handleAlpha(gl_FragColor);\n\
}',

// outline vertex shader. Expands vertices along the (in-screen) xy
// components of the normals.
OUTLINE_VS : '\n\
precision ${PRECISION} float;\n\
\n\
attribute vec3 attrPos;\n\
attribute vec3 attrNormal;\n\
attribute vec4 attrColor;\n\
attribute float attrSelect;\n\
\n\
uniform vec3 outlineColor;\n\
uniform mat4 projectionMat;\n\
uniform mat4 modelviewMat;\n\
varying float vertAlpha;\n\
varying float vertSelect;\n\
uniform vec2 relativePixelSize;\n\
uniform float outlineWidth;\n\
uniform float outlineOffset;\n\
\n\
void main(void) {\n\
  gl_Position = projectionMat * modelviewMat * vec4(attrPos, 1.0);\n\
  vec4 normal = modelviewMat * vec4(attrNormal, 0.0);\n\
  vertAlpha = attrColor.a;\n\
  vertSelect = attrSelect;\n\
  vec2 expansion = relativePixelSize * \n\
       (outlineWidth + 2.0 * step(0.5, attrSelect));\n\
  vec2 offset = normal.xy * expansion;\n\
  gl_Position.xy += gl_Position.w * offset;\n\
  gl_Position.z += gl_Position.w * outlineOffset;\n\
}',

TEXT_VS : '\n\
precision ${PRECISION} float;\n\
\n\
attribute vec3 attrCenter;\n\
attribute vec2 attrCorner;\n\
uniform mat4 projectionMat;\n\
uniform mat4 modelviewMat;\n\
uniform mat4 rotationMat;\n\
varying vec2 vertTex;\n\
uniform float width;\n\
uniform float height;\n\
void main() { \n\
  vec4 pos = modelviewMat* vec4(attrCenter, 1.0);\n\
  pos.z += 4.0;\n\
  gl_Position = projectionMat * pos;\n\
  gl_Position.xy += vec2(width,height)*attrCorner*gl_Position.w; \n\
  vertTex = (attrCorner+abs(attrCorner))/(2.0*abs(attrCorner)); \n\
}',

TEXT_FS : '\n\
precision ${PRECISION} float;\n\
\n\
uniform mat4 projectionMat;\n\
uniform mat4 modelviewMat;\n\
uniform sampler2D sampler;\n\
uniform float xScale;\n\
uniform float yScale;\n\
varying vec2 vertTex;\n\
void main() { \n\
  vec2 texCoord = vec2(vertTex.x*xScale, vertTex.y*yScale);\n\
  gl_FragColor = texture2D(sampler, texCoord);\n\
  if (gl_FragColor.a == 0.0) { discard; }\n\
}',

// spherical billboard fragment shader
SPHERES_FS : '\n\
#extension GL_EXT_frag_depth : enable\n\
\n\
varying vec2 vertTex;\n\
varying vec4 vertCenter;\n\
varying vec4 vertColor;\n\
varying float vertSelect;\n\
varying float radius;\n\
uniform mat4 projectionMat;\n\
uniform vec3 outlineColor;\n\
varying float border;\n\
uniform bool outlineEnabled;\n\
\n\
void main(void) {\n\
  float zz = dot(vertTex, vertTex);\n\
  if (zz > 1.0)\n\
    discard;\n\
  vec3 normal = vec3(vertTex.x, vertTex.y, sqrt(1.0-zz));\n\
  vec3 pos = vertCenter.xyz + normal * radius;\n\
  float dp = normal.z;\n\
  float hemi = sqrt(min(1.0, max(0.3, dp) + 0.2));\n\
  vec4 projected = projectionMat * vec4(pos, 1.0);\n\
  float depth = projected.z / projected.w;\n\
  gl_FragDepthEXT = (depth + 1.0) * 0.5;\n\
  vec3 rgbColor = vertColor.rgb * hemi; \n\
  rgbColor += min(vertColor.rgb, 0.8) * pow(max(0.0, dp), 18.0);\n\
  if (outlineEnabled) { \n\
    rgbColor = mix(rgbColor * hemi, outlineColor, step(border, sqrt(zz)));\n\
  } else { \n\
    rgbColor *= hemi; \n\
  } \n\
  rgbColor = handleSelect(rgbColor, vertSelect);\n\
  vec4 fogged = vec4(handleFog(rgbColor), vertColor.a);\n\
  gl_FragColor = handleAlpha(fogged);\n\
}',

SPHERES_VS : '\n\
precision ${PRECISION} float;\n\
attribute vec3 attrPos;\n\
attribute vec4 attrColor;\n\
attribute vec3 attrNormal;\n\
attribute float attrSelect;\n\
uniform vec2 relativePixelSize;\n\
uniform float outlineWidth;\n\
varying float radius;\n\
\n\
uniform mat4 projectionMat;\n\
uniform mat4 modelviewMat;\n\
uniform mat4 rotationMat;\n\
varying vec4 vertColor;\n\
varying vec2 vertTex;\n\
varying float border;\n\
varying vec4 vertCenter;\n\
varying float vertSelect;\n\
void main() {\n\
  vec3 d = vec3(attrNormal.xy * attrNormal.z, 0.0);\n\
  vec4 rotated = vec4(d, 0.0)*rotationMat;\n\
  gl_Position = projectionMat * modelviewMat * \n\
                (vec4(attrPos, 1.0)+rotated);\n\
  vertTex = attrNormal.xy;\n\
  vertColor = attrColor;\n\
  vertSelect = attrSelect;\n\
  vertCenter = modelviewMat* vec4(attrPos, 1.0);\n\
  float dist = length((projectionMat * vertCenter).xy - gl_Position.xy);\n\
  float dd = dist / gl_Position.w;\n\
  border = 1.0 - outlineWidth * 1.4 * length(relativePixelSize)/dd;\n\
  radius = attrNormal.z;\n\
}',

// spherical billboard fragment shader
SELECT_SPHERES_FS : '\n\
#extension GL_EXT_frag_depth : enable\n\
\n\
varying vec2 vertTex;\n\
varying vec4 vertCenter;\n\
varying vec4 vertColor;\n\
uniform mat4 projectionMat;\n\
varying float objId;\n\
varying float radius;\n\
uniform int symId;\n\
\n\
void main(void) {\n\
  float zz = dot(vertTex, vertTex);\n\
  if (zz > 1.0)\n\
    discard;\n\
  vec3 normal = vec3(vertTex.x, vertTex.y, sqrt(1.0-zz));\n\
  vec3 pos = vertCenter.xyz + normal * radius;\n\
  vec4 projected = projectionMat * vec4(pos, 1.0);\n\
  float depth = projected.z / projected.w;\n\
  gl_FragDepthEXT = (depth + 1.0) * 0.5;\n\
  // ints are only required to be 7bit...\n\
  int integralObjId = int(objId+0.5);\n\
  int red = intMod(integralObjId, 256);\n\
  integralObjId/=256;\n\
  int green = intMod(integralObjId, 256);\n\
  integralObjId/=256;\n\
  int blue = intMod(integralObjId, 256);\n\
  int alpha = symId;\n\
  gl_FragColor = vec4(float(red), float(green), \n\
                      float(blue), float(alpha))/255.0;\n\
}',

SELECT_SPHERES_VS : '\n\
precision ${PRECISION} float;\n\
attribute vec3 attrPos;\n\
attribute vec4 attrColor;\n\
attribute vec3 attrNormal;\n\
attribute float attrObjId;\n\
varying float radius;\n\
\n\
uniform mat4 projectionMat;\n\
uniform mat4 modelviewMat;\n\
uniform mat4 rotationMat;\n\
varying vec2 vertTex;\n\
varying vec4 vertCenter;\n\
varying float objId;\n\
void main() {\n\
  vec3 d = vec3(attrNormal.xy * attrNormal.z, 0.0);\n\
  vec4 rotated = vec4(d, 0.0)*rotationMat;\n\
  //vec4 rotated = vec4(d, 0.0);\n\
  gl_Position = projectionMat * modelviewMat * \n\
                (vec4(attrPos, 1.0)+rotated);\n\
  vertTex = attrNormal.xy;\n\
  vertCenter = modelviewMat* vec4(attrPos, 1.0);\n\
  radius = attrNormal.z;\n\
  objId = attrObjId;\n\
}',

// --- weighted blended order-independent transparency (OIT) shaders ---
//
// These are GLSL ES 3.00 (WebGL2-only): multiple render targets require
// `out` variables with explicit layout locations, since `gl_FragData[]`
// isn't available under WebGL2. Every other shader in this file stays
// GLSL ES 1.00 (attribute/varying/gl_FragColor) -- a WebGL2 context still
// compiles and runs that dialect unmodified for single-output rendering,
// so only the shaders that need genuinely WebGL2-only features (MRT here)
// are written in ES 3.00.
//
// The accumulation shaders below are the ES 3.00 counterparts of
// HEMILIGHT_FS/LINES_FS: same lighting math, but instead of
// writing a single blended gl_FragColor, they discard fully-opaque and
// fully-transparent fragments and write a weighted premultiplied
// contribution to two targets (accumulation, revealage) that get composited
// over the opaque scene by OIT_COMPOSITE_FS. See Viewer._draw().
OIT_ACCUM_VS : '#version 300 es\n\
in vec3 attrPos;\n\
in vec4 attrColor;\n\
in vec3 attrNormal;\n\
in float attrSelect;\n\
\n\
uniform mat4 projectionMat;\n\
uniform mat4 modelviewMat;\n\
out vec4 vertColor;\n\
out vec3 vertNormal;\n\
out vec3 vertPos;\n\
out float vertSelect;\n\
void main(void) {\n\
  vertPos = (modelviewMat * vec4(attrPos, 1.0)).xyz;\n\
  gl_Position = projectionMat * modelviewMat * vec4(attrPos, 1.0);\n\
  vec4 n = (modelviewMat * vec4(attrNormal, 0.0));\n\
  vertNormal = n.xyz;\n\
  vertColor = attrColor;\n\
  vertSelect = attrSelect;\n\
}',

OIT_ACCUM_HEMILIGHT_FS : '#version 300 es\n\
precision ${PRECISION} float;\n\
\n\
in vec4 vertColor;\n\
in vec3 vertNormal;\n\
in float vertSelect;\n\
\n\
uniform vec4 selectionColor;\n\
uniform bool fog;\n\
uniform float fogNear;\n\
uniform float fogFar;\n\
uniform vec3 fogColor;\n\
\n\
layout(location = 0) out vec4 accumOut;\n\
layout(location = 1) out vec4 revealOut;\n\
\n\
vec3 handleSelect(vec3 inColor, float sel) {\n\
  return mix(inColor, selectionColor.rgb, step(0.5, sel) * selectionColor.a);\n\
}\n\
vec3 handleFog(vec3 inColor, float depth) {\n\
  if (fog) {\n\
    float fogFactor = smoothstep(fogNear, fogFar, depth);\n\
    return mix(inColor, fogColor, fogFactor);\n\
  }\n\
  return inColor;\n\
}\n\
// empirically-tuned weight favoring nearer and more opaque fragments; not\n\
// copied from a specific published constant set -- see McGuire & Bavoil\n\
// 2013 for the general technique this approximates.\n\
float oitWeight(float z, float a) {\n\
  return a * clamp(0.03 / (1e-5 + pow(z / 200.0, 4.0)), 1e-2, 3e3);\n\
}\n\
\n\
void main(void) {\n\
  float dp = dot(vertNormal, vec3(0.0, 0.0, 1.0));\n\
  float hemi = min(1.0, max(0.0, dp)*0.6+0.5);\n\
  vec4 color = vec4(vertColor.rgb*hemi, vertColor.a);\n\
  if (color.a >= 0.999 || color.a <= 0.001) { discard; }\n\
  float depth = gl_FragCoord.z / gl_FragCoord.w;\n\
  color.rgb = handleFog(handleSelect(color.rgb, vertSelect), depth);\n\
  float w = oitWeight(depth, color.a);\n\
  accumOut = vec4(color.rgb * color.a * w, color.a * w);\n\
  revealOut = vec4(color.a);\n\
}',

OIT_ACCUM_LINES_VS : '#version 300 es\n\
in vec3 attrPos;\n\
in vec4 attrColor;\n\
\n\
uniform mat4 projectionMat;\n\
uniform mat4 modelviewMat;\n\
out vec4 vertColor;\n\
uniform float pointSize;\n\
void main(void) {\n\
  gl_Position = projectionMat * modelviewMat * vec4(attrPos, 1.0);\n\
  float distToCamera = vec4(modelviewMat * vec4(attrPos, 1.0)).z;\n\
  gl_PointSize = pointSize * 200.0 / abs(distToCamera); \n\
  vertColor = attrColor;\n\
}',

OIT_ACCUM_LINES_FS : '#version 300 es\n\
precision ${PRECISION} float;\n\
\n\
in vec4 vertColor;\n\
uniform bool fog;\n\
uniform float fogNear;\n\
uniform float fogFar;\n\
uniform vec3 fogColor;\n\
\n\
layout(location = 0) out vec4 accumOut;\n\
layout(location = 1) out vec4 revealOut;\n\
\n\
vec3 handleFog(vec3 inColor, float depth) {\n\
  if (fog) {\n\
    float fogFactor = smoothstep(fogNear, fogFar, depth);\n\
    return mix(inColor, fogColor, fogFactor);\n\
  }\n\
  return inColor;\n\
}\n\
float oitWeight(float z, float a) {\n\
  return a * clamp(0.03 / (1e-5 + pow(z / 200.0, 4.0)), 1e-2, 3e3);\n\
}\n\
\n\
void main(void) {\n\
  vec4 color = vertColor;\n\
  if (color.a >= 0.999 || color.a <= 0.001) { discard; }\n\
  float depth = gl_FragCoord.z / gl_FragCoord.w;\n\
  color.rgb = handleFog(color.rgb, depth);\n\
  float w = oitWeight(depth, color.a);\n\
  accumOut = vec4(color.rgb * color.a * w, color.a * w);\n\
  revealOut = vec4(color.a);\n\
}',

// ES 3.00 accumulation counterpart of SPHERES_VS/SPHERES_FS -- same
// billboard-quad/sphere-normal math, but writes to the OIT accumulation
// targets instead of gl_FragColor, and uses native gl_FragDepth instead of
// gl_FragDepthEXT (core in ES 3.00, no extension needed).
OIT_ACCUM_SPHERES_VS : '#version 300 es\n\
in vec3 attrPos;\n\
in vec4 attrColor;\n\
in vec3 attrNormal;\n\
in float attrSelect;\n\
uniform vec2 relativePixelSize;\n\
uniform float outlineWidth;\n\
out float radius;\n\
\n\
uniform mat4 projectionMat;\n\
uniform mat4 modelviewMat;\n\
uniform mat4 rotationMat;\n\
out vec4 vertColor;\n\
out vec2 vertTex;\n\
out float border;\n\
out vec4 vertCenter;\n\
out float vertSelect;\n\
void main() {\n\
  vec3 d = vec3(attrNormal.xy * attrNormal.z, 0.0);\n\
  vec4 rotated = vec4(d, 0.0)*rotationMat;\n\
  gl_Position = projectionMat * modelviewMat * \n\
                (vec4(attrPos, 1.0)+rotated);\n\
  vertTex = attrNormal.xy;\n\
  vertColor = attrColor;\n\
  vertSelect = attrSelect;\n\
  vertCenter = modelviewMat* vec4(attrPos, 1.0);\n\
  float dist = length((projectionMat * vertCenter).xy - gl_Position.xy);\n\
  float dd = dist / gl_Position.w;\n\
  border = 1.0 - outlineWidth * 1.4 * length(relativePixelSize)/dd;\n\
  radius = attrNormal.z;\n\
}',

OIT_ACCUM_SPHERES_FS : '#version 300 es\n\
precision ${PRECISION} float;\n\
\n\
in vec2 vertTex;\n\
in vec4 vertCenter;\n\
in vec4 vertColor;\n\
in float vertSelect;\n\
in float radius;\n\
uniform mat4 projectionMat;\n\
uniform vec3 outlineColor;\n\
in float border;\n\
uniform bool outlineEnabled;\n\
uniform vec4 selectionColor;\n\
uniform bool fog;\n\
uniform float fogNear;\n\
uniform float fogFar;\n\
uniform vec3 fogColor;\n\
\n\
layout(location = 0) out vec4 accumOut;\n\
layout(location = 1) out vec4 revealOut;\n\
\n\
vec3 handleSelect(vec3 inColor, float sel) {\n\
  return mix(inColor, selectionColor.rgb, step(0.5, sel) * selectionColor.a);\n\
}\n\
vec3 handleFog(vec3 inColor, float depth) {\n\
  if (fog) {\n\
    float fogFactor = smoothstep(fogNear, fogFar, depth);\n\
    return mix(inColor, fogColor, fogFactor);\n\
  }\n\
  return inColor;\n\
}\n\
float oitWeight(float z, float a) {\n\
  return a * clamp(0.03 / (1e-5 + pow(z / 200.0, 4.0)), 1e-2, 3e3);\n\
}\n\
\n\
void main(void) {\n\
  float zz = dot(vertTex, vertTex);\n\
  if (zz > 1.0)\n\
    discard;\n\
  vec3 normal = vec3(vertTex.x, vertTex.y, sqrt(1.0-zz));\n\
  vec3 pos = vertCenter.xyz + normal * radius;\n\
  float dp = normal.z;\n\
  float hemi = sqrt(min(1.0, max(0.3, dp) + 0.2));\n\
  vec4 projected = projectionMat * vec4(pos, 1.0);\n\
  float depth = projected.z / projected.w;\n\
  gl_FragDepth = (depth + 1.0) * 0.5;\n\
  vec3 rgbColor = vertColor.rgb * hemi; \n\
  rgbColor += min(vertColor.rgb, 0.8) * pow(max(0.0, dp), 18.0);\n\
  if (outlineEnabled) { \n\
    rgbColor = mix(rgbColor * hemi, outlineColor, step(border, sqrt(zz)));\n\
  } else { \n\
    rgbColor *= hemi; \n\
  } \n\
  rgbColor = handleSelect(rgbColor, vertSelect);\n\
  vec4 color = vec4(handleFog(rgbColor, gl_FragCoord.z / gl_FragCoord.w), vertColor.a);\n\
  if (color.a >= 0.999 || color.a <= 0.001) { discard; }\n\
  float w = oitWeight(gl_FragCoord.z / gl_FragCoord.w, color.a);\n\
  accumOut = vec4(color.rgb * color.a * w, color.a * w);\n\
  revealOut = vec4(color.a);\n\
}',

// fullscreen-triangle composite pass: blends the accumulation/revealage
// targets over the opaque scene. No vertex buffer needed -- the triangle is
// generated directly from gl_VertexID and oversized to cover the viewport.
// Also reused, unchanged, as the vertex stage for SSAO_FS/SSAO_BLUR_FS below
// -- every fullscreen pass in this file shares this one vertex shader.
OIT_COMPOSITE_VS : '#version 300 es\n\
out vec2 vertUv;\n\
void main(void) {\n\
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));\n\
  vertUv = pos;\n\
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);\n\
}',

OIT_COMPOSITE_FS : '#version 300 es\n\
precision ${PRECISION} float;\n\
in vec2 vertUv;\n\
uniform sampler2D opaqueColor;\n\
uniform sampler2D accumTex;\n\
uniform sampler2D revealTex;\n\
uniform sampler2D ssaoTex;\n\
uniform bool ssaoEnabled;\n\
out vec4 fragColor;\n\
void main(void) {\n\
  vec4 accum = texture(accumTex, vertUv);\n\
  float reveal = texture(revealTex, vertUv).a;\n\
  vec3 opaque = texture(opaqueColor, vertUv).rgb;\n\
  if (ssaoEnabled) {\n\
    opaque *= texture(ssaoTex, vertUv).r;\n\
  }\n\
  vec3 averageColor = accum.rgb / max(accum.a, 1e-5);\n\
  vec3 finalColor = averageColor * (1.0 - reveal) + opaque * reveal;\n\
  fragColor = vec4(finalColor, 1.0);\n\
}',

// trivial fullscreen blit, reusing OIT_COMPOSITE_VS's vertex shader: used
// to present the opaque target directly when OIT isn't supported (no
// accumulation/revealage targets exist in that case). WebGL2's
// blitFramebuffer can't target a multisampled default framebuffer (the
// canvas is multisampled whenever antialiasing is on), so this shader-based
// copy is used instead of gl.blitFramebuffer for that case.
OIT_BLIT_FS : '#version 300 es\n\
precision ${PRECISION} float;\n\
in vec2 vertUv;\n\
uniform sampler2D opaqueColor;\n\
uniform sampler2D ssaoTex;\n\
uniform bool ssaoEnabled;\n\
out vec4 fragColor;\n\
void main(void) {\n\
  vec3 opaque = texture(opaqueColor, vertUv).rgb;\n\
  if (ssaoEnabled) {\n\
    opaque *= texture(ssaoTex, vertUv).r;\n\
  }\n\
  fragColor = vec4(opaque, 1.0);\n\
}',

// screen-space ambient occlusion. Reconstructs view-space position/normal
// from the opaque pass's depth texture (no separate normal G-buffer -- see
// the SSAO plan in the project's implementation notes for why), samples a
// hemisphere kernel around each fragment's normal, and writes an occlusion
// factor (1.0 = fully lit, darker = more occluded) to a single-channel
// target. Reuses OIT_COMPOSITE_VS's fullscreen-triangle trick.
SSAO_FS : '#version 300 es\n\
precision highp float;\n\
in vec2 vertUv;\n\
uniform sampler2D depthTex;\n\
uniform mat4 projectionMat;\n\
uniform mat4 invProjectionMat;\n\
uniform vec3 ssaoKernel[16];\n\
uniform float ssaoRadius;\n\
uniform float ssaoIntensity;\n\
uniform float ssaoBias;\n\
uniform vec2 invResolution;\n\
out vec4 fragAo;\n\
\n\
vec3 viewPosFromUv(vec2 uv, float depth) {\n\
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);\n\
  vec4 view = invProjectionMat * clip;\n\
  return view.xyz / view.w;\n\
}\n\
\n\
void main(void) {\n\
  float centerDepth = texture(depthTex, vertUv).r;\n\
  if (centerDepth >= 1.0) {\n\
    fragAo = vec4(1.0);\n\
    return;\n\
  }\n\
  vec3 P = viewPosFromUv(vertUv, centerDepth);\n\
\n\
  // 4-tap, silhouette-aware normal reconstruction: for each axis, pick\n\
  // whichever neighbor is closer in depth to the center before taking the\n\
  // difference, so the derived normal stays correct at depth\n\
  // discontinuities instead of blending across them.\n\
  vec3 pr = viewPosFromUv(vertUv + vec2(invResolution.x, 0.0),\n\
                          texture(depthTex, vertUv + vec2(invResolution.x, 0.0)).r);\n\
  vec3 pl = viewPosFromUv(vertUv - vec2(invResolution.x, 0.0),\n\
                          texture(depthTex, vertUv - vec2(invResolution.x, 0.0)).r);\n\
  vec3 pu = viewPosFromUv(vertUv + vec2(0.0, invResolution.y),\n\
                          texture(depthTex, vertUv + vec2(0.0, invResolution.y)).r);\n\
  vec3 pd = viewPosFromUv(vertUv - vec2(0.0, invResolution.y),\n\
                          texture(depthTex, vertUv - vec2(0.0, invResolution.y)).r);\n\
  vec3 dx = (abs(pr.z - P.z) < abs(P.z - pl.z)) ? (pr - P) : (P - pl);\n\
  vec3 dy = (abs(pu.z - P.z) < abs(P.z - pd.z)) ? (pu - P) : (P - pd);\n\
  vec3 N = normalize(cross(dx, dy));\n\
\n\
  // rotate the kernel by a hash of a 4x4 screen tile (not the raw pixel) --\n\
  // this yields exactly 16 distinct rotations tiled across the screen, so\n\
  // the 4x4 box blur in SSAO_BLUR_FS averages exactly over the full\n\
  // rotation set, without needing a separate noise texture.\n\
  vec2 tile = mod(floor(gl_FragCoord.xy), 4.0);\n\
  float angle = fract(sin(dot(tile, vec2(12.9898, 78.233))) * 43758.5453) *\n\
               6.28318530718;\n\
  vec3 randomVec = vec3(cos(angle), sin(angle), 0.0);\n\
  vec3 T = normalize(randomVec - N * dot(randomVec, N));\n\
  vec3 B = cross(N, T);\n\
  mat3 TBN = mat3(T, B, N);\n\
\n\
  float occlusion = 0.0;\n\
  for (int i = 0; i < 16; ++i) {\n\
    vec3 samplePos = P + (TBN * ssaoKernel[i]) * ssaoRadius;\n\
    vec4 offset = projectionMat * vec4(samplePos, 1.0);\n\
    offset.xyz /= offset.w;\n\
    vec2 sampleUv = offset.xy * 0.5 + 0.5;\n\
    float sampleDepth = texture(depthTex, sampleUv).r;\n\
    float sceneZ = viewPosFromUv(sampleUv, sampleDepth).z;\n\
    float occluded = step(samplePos.z + ssaoBias, sceneZ);\n\
    float rangeCheck = smoothstep(0.0, 1.0,\n\
                                  ssaoRadius / max(1e-5, abs(P.z - sceneZ)));\n\
    occlusion += occluded * rangeCheck;\n\
  }\n\
  float ao = clamp(1.0 - ssaoIntensity * (occlusion / 16.0), 0.0, 1.0);\n\
  fragAo = vec4(ao);\n\
}',

// depth-aware 4x4 box blur of the raw SSAO buffer -- taps are rejected when\n\
// their linear depth differs too much from the center (relative to the\n\
// center's own distance), which keeps AO from bleeding across silhouettes\n\
// onto whatever is behind them.\n\
SSAO_BLUR_FS : '#version 300 es\n\
precision highp float;\n\
in vec2 vertUv;\n\
uniform sampler2D ssaoTex;\n\
uniform sampler2D depthTex;\n\
uniform vec2 invResolution;\n\
uniform vec2 nearFar;\n\
out vec4 fragAo;\n\
\n\
float linearDepth(float d) {\n\
  float near = nearFar.x;\n\
  float far = nearFar.y;\n\
  return (2.0 * near * far) / (far + near - (d * 2.0 - 1.0) * (far - near));\n\
}\n\
\n\
void main(void) {\n\
  float centerLinZ = linearDepth(texture(depthTex, vertUv).r);\n\
  float sum = 0.0;\n\
  float count = 0.0;\n\
  for (int x = -2; x <= 1; ++x) {\n\
    for (int y = -2; y <= 1; ++y) {\n\
      vec2 uv = vertUv + vec2(float(x), float(y)) * invResolution;\n\
      float linZ = linearDepth(texture(depthTex, uv).r);\n\
      if (abs(linZ - centerLinZ) < 0.02 * centerLinZ) {\n\
        sum += texture(ssaoTex, uv).r;\n\
        count += 1.0;\n\
      }\n\
    }\n\
  }\n\
  fragAo = vec4(count > 0.0 ? sum / count : 1.0);\n\
}'

};

export default shaders;

