/** Clayform as a library. */

export * from './core/schema.js';
export { applyOps, Op, merge } from './core/ops.js';
export { compile, type Compiled, type Prim } from './core/compile.js';
export { buildScene, type Build, type BuildOptions, type MeshData } from './core/build.js';
export { simplifyBuild, type SimplifyOptions } from './core/simplify.js';
export { critique, formatReport, type Issue, type Report } from './critic/critics.js';
export { renderSheet, renderTiles, cameraFor, VIEWS, DEFAULT_VIEWS, type View, type Sheet, type SheetOptions } from './render/views.js';
export { renderClipStrip } from './render/motion.js';
export { encodePng } from './render/png.js';
export { buildRig, sampleClip, poseMeshes, critiqueClip, type Rig, type SampledClip } from './anim/rig.js';
export { exportGlb, exportObj, type GlbOptions, type GlbResult } from './export/gltf.js';
export { bakeEffect, resolveEffect, PRESETS as EFFECT_PRESETS_TABLE, type Flipbook } from './vfx/effects.js';
export { TEMPLATES, getTemplate, type Template } from './templates/index.js';
export { Workspace, describe } from './session.js';
export { GUIDE } from './guide.js';
export { fitReference, silhouettePng } from './reference.js';
export { measureBetween, measurePart, measureRatio, partAtPixel } from './measure.js';
export { decodePng } from './render/pngdecode.js';
export { VERSION } from './version.js';
