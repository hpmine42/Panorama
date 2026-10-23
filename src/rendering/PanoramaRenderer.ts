import type { ImageAsset, PanoramaCoverage, ViewerMode, ViewState, ViewportSize } from '../types';
import { decodeImageFromUrl, releaseImageSource } from '../utils/imageProcessing';
import { computeCameraParams, getNormalDisplaySize } from './panoramaMath';

const MAX_MOBILE_TEXTURE_DIMENSION = 8192;
const HIGH_MEMORY_MAX_TEXELS = 33_554_432;
const LOW_MEMORY_MAX_TEXELS = 16_777_216;

const VERTEX_SHADER = `
  attribute vec2 aPosition;
  varying vec2 vUv;

  void main() {
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

const PRECISION_HEADER = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif
`;

const PANORAMA_FRAGMENT_SHADER = `
  ${PRECISION_HEADER}
  varying vec2 vUv;
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uVFov;
  uniform float uVHalfTan;
  uniform float uYaw;
  uniform float uPitch;
  uniform float uCurvature;
  uniform float uHSpan;
  uniform float uVSpan;
  uniform float uPitchCenter;
  uniform float uWrapH;

  const float PI = 3.141592653589793;

  vec3 rotateY(vec3 direction, float angle) {
    float sine = sin(angle);
    float cosine = cos(angle);
    return vec3(
      direction.x * cosine + direction.z * sine,
      direction.y,
      -direction.x * sine + direction.z * cosine
    );
  }

  vec3 rotateX(vec3 direction, float angle) {
    float sine = sin(angle);
    float cosine = cos(angle);
    return vec3(
      direction.x,
      direction.y * cosine - direction.z * sine,
      direction.y * sine + direction.z * cosine
    );
  }

  void main() {
    vec2 normalized = vUv * 2.0 - 1.0;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 screenPos = vec2(normalized.x * aspect, normalized.y);

    vec3 rectilinearRay = normalize(vec3(
      screenPos.x * uVHalfTan,
      screenPos.y * uVHalfTan,
      -1.0
    ));

    // Isotropic screen-space fisheye ray so zoomed-out panoramas curve
    // spherically without oval distortion on portrait or landscape phones.
    float lensRadius = length(screenPos);
    float lensAngle = lensRadius * (uVFov * 0.5);
    vec2 lensDirection = lensRadius > 0.0001
      ? (screenPos / lensRadius)
      : vec2(0.0, 0.0);
    vec3 fisheyeRay = vec3(
      lensDirection * sin(lensAngle),
      -cos(lensAngle)
    );
    vec3 ray = normalize(mix(rectilinearRay, fisheyeRay, uCurvature));

    ray = rotateX(ray, uPitch);
    ray = rotateY(ray, uYaw);

    float longitude = atan(ray.x, -ray.z);
    float latitude = asin(clamp(ray.y, -1.0, 1.0));

    float panoramaU;
    if (uWrapH > 0.5) {
      panoramaU = fract(0.5 + longitude / (2.0 * PI));
    } else {
      panoramaU = 0.5 + longitude / max(uHSpan, 0.001);
      if (panoramaU < 0.0 || panoramaU > 1.0) {
        discard;
      }
    }

    float panoramaV = 0.5 + (latitude - uPitchCenter) / max(uVSpan, 0.001);
    if (panoramaV < 0.0 || panoramaV > 1.0) {
      discard;
    }

    gl_FragColor = texture2D(uTexture, vec2(panoramaU, panoramaV));
  }
`;

const IMAGE_FRAGMENT_SHADER = `
  ${PRECISION_HEADER}
  varying vec2 vUv;
  uniform sampler2D uTexture;
  uniform vec2 uDisplaySize;
  uniform vec2 uOffset;

  void main() {
    vec2 p = vec2(vUv.x - 0.5, 0.5 - vUv.y);
    vec2 imageUv = (p - uOffset) / uDisplaySize + 0.5;
    if (imageUv.x < 0.0 || imageUv.x > 1.0 || imageUv.y < 0.0 || imageUv.y > 1.0) {
      discard;
    }

    gl_FragColor = texture2D(uTexture, vec2(imageUv.x, 1.0 - imageUv.y));
  }
`;

type UniformName =
  | 'resolution'
  | 'vFov'
  | 'vHalfTan'
  | 'yaw'
  | 'pitch'
  | 'curvature'
  | 'hSpan'
  | 'vSpan'
  | 'pitchCenter'
  | 'wrapH'
  | 'displaySize'
  | 'offset';

type ProgramUniforms = {
  position: number;
  texture: WebGLUniformLocation | null;
} & Partial<Record<UniformName, WebGLUniformLocation | null>>;

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('WebGL konnte keinen Shader erstellen.');
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'Unbekannter Shader-Fehler';
    gl.deleteShader(shader);
    throw new Error(`WebGL-Shader konnte nicht kompiliert werden: ${log}`);
  }
  return shader;
}

function createProgram(
  gl: WebGLRenderingContext,
  fragmentSource: string,
  uniformNames: UniformName[],
): { program: WebGLProgram; uniforms: ProgramUniforms } {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error('WebGL konnte kein Programm erstellen.');
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'Unbekannter Linker-Fehler';
    gl.deleteProgram(program);
    throw new Error(`WebGL-Programm konnte nicht gelinkt werden: ${log}`);
  }

  const uniforms: ProgramUniforms = {
    position: gl.getAttribLocation(program, 'aPosition'),
    texture: gl.getUniformLocation(program, 'uTexture'),
  };
  for (const name of uniformNames) {
    uniforms[name] = gl.getUniformLocation(program, `u${name[0].toUpperCase()}${name.slice(1)}`);
  }

  return { program, uniforms };
}

function getMaxTexelBudget(): number {
  const memoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (typeof memoryGb === 'number' && memoryGb > 0 && memoryGb <= 4) {
    return LOW_MEMORY_MAX_TEXELS;
  }
  return HIGH_MEMORY_MAX_TEXELS;
}

/**
 * Lightweight WebGL renderer supporting both full 360° equirectangular spheres,
 * bounded partial mobile sweep panoramas, and flat photos. Recovers cleanly from
 * mobile OS background context loss.
 */
export class PanoramaRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderingContext;
  private readonly onContextRestored?: () => void;
  private buffer: WebGLBuffer | null = null;
  private panorama: { program: WebGLProgram; uniforms: ProgramUniforms } | null = null;
  private image: { program: WebGLProgram; uniforms: ProgramUniforms } | null = null;
  private texture: WebGLTexture | null = null;
  private currentAsset: ImageAsset | null = null;
  private imageWidth = 1;
  private imageHeight = 1;
  private viewport: ViewportSize = { width: 1, height: 1, dpr: 1 };
  private contextLost = false;
  private destroyed = false;

  readonly maxTextureSize: number;
  readonly maxTexels: number;

  constructor(canvas: HTMLCanvasElement, onContextRestored?: () => void) {
    this.canvas = canvas;
    this.onContextRestored = onContextRestored;

    const context = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!context) {
      throw new Error('WebGL ist in diesem Browser nicht verfügbar.');
    }
    this.gl = context;
    const reportedMax = Number(context.getParameter(context.MAX_TEXTURE_SIZE)) || 4096;
    this.maxTextureSize = Math.min(reportedMax, MAX_MOBILE_TEXTURE_DIMENSION);
    this.maxTexels = getMaxTexelBudget();

    this.initializeGpuResources();
    this.canvas.addEventListener('webglcontextlost', this.handleContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored, false);
  }

  private initializeGpuResources(): void {
    const gl = this.gl;
    const vertices = new Float32Array([-1, -1, 3, -1, -1, 3]);
    const buffer = gl.createBuffer();
    if (!buffer) {
      throw new Error('WebGL konnte keinen Zeichenpuffer erstellen.');
    }
    this.buffer = buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    this.panorama = createProgram(gl, PANORAMA_FRAGMENT_SHADER, [
      'resolution',
      'vFov',
      'vHalfTan',
      'yaw',
      'pitch',
      'curvature',
      'hSpan',
      'vSpan',
      'pitchCenter',
      'wrapH',
    ]);
    this.image = createProgram(gl, IMAGE_FRAGMENT_SHADER, ['displaySize', 'offset']);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
  }

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.texture = null;
    this.buffer = null;
    this.panorama = null;
    this.image = null;
  };

  private readonly handleContextRestored = (): void => {
    if (this.destroyed) return;
    this.contextLost = false;
    try {
      this.initializeGpuResources();
      this.resize(this.viewport);
      const activeAsset = this.currentAsset;
      if (activeAsset) {
        void decodeImageFromUrl(activeAsset.url)
          .then((decoded) => {
            if (this.destroyed || this.currentAsset?.id !== activeAsset.id) {
              decoded.src = '';
              return;
            }
            this.uploadElementToTexture(decoded, activeAsset.width, activeAsset.height);
            decoded.src = '';
            this.onContextRestored?.();
          })
          .catch(() => undefined);
      }
    } catch {
      // Context restoration failed; keep fallback state harmless.
    }
  };

  resize(viewport: ViewportSize): void {
    this.viewport = viewport;
    const pixelWidth = Math.max(1, Math.round(viewport.width * viewport.dpr));
    const pixelHeight = Math.max(1, Math.round(viewport.height * viewport.dpr));
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    if (!this.contextLost) {
      this.gl.viewport(0, 0, pixelWidth, pixelHeight);
    }
  }

  private computeUploadDimensions(sourceWidth: number, sourceHeight: number): { width: number; height: number } {
    const totalPixels = Math.max(1, sourceWidth * sourceHeight);
    const scale = Math.min(
      1,
      this.maxTextureSize / Math.max(sourceWidth, 1),
      this.maxTextureSize / Math.max(sourceHeight, 1),
      Math.sqrt(this.maxTexels / totalPixels),
    );
    return {
      width: Math.max(1, Math.round(sourceWidth * scale)),
      height: Math.max(1, Math.round(sourceHeight * scale)),
    };
  }

  private uploadElementToTexture(source: HTMLImageElement, naturalWidth: number, naturalHeight: number): void {
    this.deleteTexture();
    if (this.contextLost) return;

    const { width, height } = this.computeUploadDimensions(naturalWidth, naturalHeight);

    // Drawing through a 2D staging canvas guarantees EXIF orientation is applied
    // consistently across iOS Safari WebKit and Android Chrome before texImage2D.
    const stagingCanvas = document.createElement('canvas');
    stagingCanvas.width = width;
    stagingCanvas.height = height;
    const stagingContext = stagingCanvas.getContext('2d', { alpha: true });
    if (!stagingContext) {
      stagingCanvas.width = 0;
      stagingCanvas.height = 0;
      throw new Error('Das Bild konnte für die GPU nicht vorbereitet werden.');
    }
    stagingContext.imageSmoothingEnabled = true;
    stagingContext.imageSmoothingQuality = 'high';
    stagingContext.drawImage(source, 0, 0, width, height);

    const texture = this.gl.createTexture();
    if (!texture) {
      stagingCanvas.width = 0;
      stagingCanvas.height = 0;
      throw new Error('WebGL konnte keine Bildtextur erstellen.');
    }

    try {
      this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
      this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, 1);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.RGBA,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        stagingCanvas,
      );
      this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    } finally {
      // Zeroing dimensions immediately releases mobile Safari/Chrome backing RAM.
      stagingCanvas.width = 0;
      stagingCanvas.height = 0;
    }

    this.texture = texture;
  }

  setImage(asset: ImageAsset | null): void {
    this.deleteTexture();
    this.currentAsset = asset;
    if (!asset) {
      this.imageWidth = 1;
      this.imageHeight = 1;
      return;
    }

    this.imageWidth = asset.width;
    this.imageHeight = asset.height;

    if (asset.source) {
      this.uploadElementToTexture(asset.source, asset.width, asset.height);
      releaseImageSource(asset);
    } else {
      void decodeImageFromUrl(asset.url)
        .then((decoded) => {
          if (this.destroyed || this.currentAsset?.id !== asset.id) {
            decoded.src = '';
            return;
          }
          this.uploadElementToTexture(decoded, asset.width, asset.height);
          decoded.src = '';
          this.onContextRestored?.();
        })
        .catch(() => undefined);
    }
  }

  render(view: ViewState, mode: ViewerMode, coverage: PanoramaCoverage): void {
    if (this.destroyed || this.contextLost || !this.buffer || !this.panorama || !this.image) return;
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.texture) return;

    const programData = mode === 'panorama' ? this.panorama : this.image;
    gl.useProgram(programData.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(programData.uniforms.position);
    gl.vertexAttribPointer(programData.uniforms.position, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(programData.uniforms.texture, 0);

    if (mode === 'panorama') {
      const uniforms = programData.uniforms;
      const camera = computeCameraParams(this.viewport.width, this.viewport.height, view.zoom);
      gl.uniform2f(uniforms.resolution ?? null, this.viewport.width, this.viewport.height);
      gl.uniform1f(uniforms.vFov ?? null, camera.vFov);
      gl.uniform1f(uniforms.vHalfTan ?? null, camera.vHalfTan);
      gl.uniform1f(uniforms.yaw ?? null, view.yaw);
      gl.uniform1f(uniforms.pitch ?? null, view.pitch);
      gl.uniform1f(uniforms.curvature ?? null, camera.curvature);
      gl.uniform1f(uniforms.hSpan ?? null, coverage.horizontalSpan);
      gl.uniform1f(uniforms.vSpan ?? null, coverage.verticalSpan);
      gl.uniform1f(uniforms.pitchCenter ?? null, coverage.pitchCenter);
      gl.uniform1f(uniforms.wrapH ?? null, coverage.wrapsHorizontally ? 1 : 0);
    } else {
      const display = getNormalDisplaySize(
        this.imageWidth,
        this.imageHeight,
        this.viewport.width,
        this.viewport.height,
        view.zoom,
      );
      gl.uniform2f(programData.uniforms.displaySize ?? null, display.width, display.height);
      gl.uniform2f(programData.uniforms.offset ?? null, view.offsetX, view.offsetY);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  disposeImage(): void {
    this.currentAsset = null;
    this.deleteTexture();
  }

  dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost, false);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored, false);
    this.currentAsset = null;
    this.deleteTexture();
    if (!this.contextLost) {
      if (this.buffer) this.gl.deleteBuffer(this.buffer);
      if (this.panorama) this.gl.deleteProgram(this.panorama.program);
      if (this.image) this.gl.deleteProgram(this.image.program);
    }
    this.buffer = null;
    this.panorama = null;
    this.image = null;
  }

  private deleteTexture(): void {
    if (this.texture && !this.contextLost) {
      this.gl.deleteTexture(this.texture);
    }
    this.texture = null;
  }
}
