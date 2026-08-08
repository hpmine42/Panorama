import type { ImageAsset, ViewState, ViewportSize } from '../types';

const PI = Math.PI;
const MAX_MOBILE_TEXTURE_DIMENSION = 4096;

const VERTEX_SHADER = `
  attribute vec2 aPosition;
  varying vec2 vUv;

  void main() {
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

const PANORAMA_FRAGMENT_SHADER = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uFov;
  uniform float uYaw;
  uniform float uPitch;
  uniform float uFrameScale;

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
    vec2 normalized = (vUv * 2.0 - 1.0) / max(uFrameScale, 0.001);
    if (abs(normalized.x) > 1.0 || abs(normalized.y) > 1.0) {
      discard;
    }
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float halfFov = tan(uFov * 0.5);
    vec3 ray = normalize(vec3(
      normalized.x * aspect * halfFov,
      normalized.y * halfFov,
      -1.0
    ));

    ray = rotateX(ray, uPitch);
    ray = rotateY(ray, uYaw);

    float longitude = atan(ray.x, -ray.z);
    float latitude = asin(clamp(ray.y, -1.0, 1.0));
    float panoramaU = fract(0.5 + longitude / (2.0 * PI));
    float panoramaV = 0.5 - latitude / PI;

    // The texture is uploaded with UNPACK_FLIP_Y_WEBGL, so texture V=0 is
    // the top of the original image. panoramaV is already top-origin.
    gl_FragColor = texture2D(uTexture, vec2(panoramaU, panoramaV));
  }
`;

const IMAGE_FRAGMENT_SHADER = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTexture;
  uniform vec2 uDisplaySize;
  uniform vec2 uOffset;

  void main() {
    // p is a screen coordinate centred at zero; positive Y points down.
    vec2 p = vec2(vUv.x - 0.5, 0.5 - vUv.y);
    vec2 imageUv = (p - uOffset) / uDisplaySize + 0.5;
    if (imageUv.x < 0.0 || imageUv.x > 1.0 || imageUv.y < 0.0 || imageUv.y > 1.0) {
      discard;
    }

    // UNPACK_FLIP_Y_WEBGL makes V=0 correspond to the top of the source.
    gl_FragColor = texture2D(uTexture, imageUv);
  }
`;

type ProgramUniforms = {
  position: number;
  texture: WebGLUniformLocation | null;
  resolution?: WebGLUniformLocation | null;
  fov?: WebGLUniformLocation | null;
  yaw?: WebGLUniformLocation | null;
  pitch?: WebGLUniformLocation | null;
  frameScale?: WebGLUniformLocation | null;
  displaySize?: WebGLUniformLocation | null;
  offset?: WebGLUniformLocation | null;
};

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
  uniformNames: Array<'resolution' | 'fov' | 'yaw' | 'pitch' | 'frameScale' | 'displaySize' | 'offset'>,
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

/**
 * Lightweight WebGL renderer. Panoramas use a perspective raycaster into an
 * equirectangular texture (not a horizontal image scroller). Regular photos
 * use the same GPU texture with a contain/zoom camera so they can be explored
 * with the exact same gestures.
 */
export class PanoramaRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderingContext;
  private readonly buffer: WebGLBuffer;
  private readonly panorama: { program: WebGLProgram; uniforms: ProgramUniforms };
  private readonly image: { program: WebGLProgram; uniforms: ProgramUniforms };
  private texture: WebGLTexture | null = null;
  private textureWidth = 1;
  private textureHeight = 1;
  private mode: ImageAsset['mode'] = 'image';
  private viewport: ViewportSize = { width: 1, height: 1, dpr: 1 };
  private destroyed = false;

  readonly maxTextureSize: number;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      desynchronized: true,
    });
    if (!context) {
      throw new Error('WebGL ist in diesem Browser nicht verfügbar.');
    }
    this.gl = context;
    const reportedMax = Number(context.getParameter(context.MAX_TEXTURE_SIZE)) || 2048;
    this.maxTextureSize = Math.min(reportedMax, MAX_MOBILE_TEXTURE_DIMENSION);

    const vertices = new Float32Array([-1, -1, 3, -1, -1, 3]);
    const buffer = context.createBuffer();
    if (!buffer) {
      throw new Error('WebGL konnte keinen Zeichenpuffer erstellen.');
    }
    this.buffer = buffer;
    context.bindBuffer(context.ARRAY_BUFFER, buffer);
    context.bufferData(context.ARRAY_BUFFER, vertices, context.STATIC_DRAW);

    this.panorama = createProgram(context, PANORAMA_FRAGMENT_SHADER, [
      'resolution',
      'fov',
      'yaw',
      'pitch',
      'frameScale',
    ]);
    this.image = createProgram(context, IMAGE_FRAGMENT_SHADER, ['displaySize', 'offset']);

    context.disable(context.DEPTH_TEST);
    context.enable(context.BLEND);
    context.blendFunc(context.SRC_ALPHA, context.ONE_MINUS_SRC_ALPHA);
    context.clearColor(0, 0, 0, 0);
  }

  resize(viewport: ViewportSize): void {
    this.viewport = viewport;
    const pixelWidth = Math.max(1, Math.round(viewport.width * viewport.dpr));
    const pixelHeight = Math.max(1, Math.round(viewport.height * viewport.dpr));
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    this.gl.viewport(0, 0, pixelWidth, pixelHeight);
  }

  setImage(asset: ImageAsset | null): void {
    this.deleteTexture();
    if (!asset) {
      this.textureWidth = 1;
      this.textureHeight = 1;
      return;
    }

    const scale = Math.min(1, this.maxTextureSize / asset.width, this.maxTextureSize / asset.height);
    const width = Math.max(1, Math.round(asset.width * scale));
    const height = Math.max(1, Math.round(asset.height * scale));
    let uploadSource: CanvasImageSource = asset.source;
    let stagingCanvas: HTMLCanvasElement | null = null;

    if (width !== asset.width || height !== asset.height) {
      stagingCanvas = document.createElement('canvas');
      stagingCanvas.width = width;
      stagingCanvas.height = height;
      const stagingContext = stagingCanvas.getContext('2d', { alpha: true });
      if (!stagingContext) {
        throw new Error('Das Bild konnte für die GPU nicht vorbereitet werden.');
      }
      stagingContext.imageSmoothingEnabled = true;
      stagingContext.imageSmoothingQuality = 'high';
      stagingContext.drawImage(asset.source, 0, 0, width, height);
      uploadSource = stagingCanvas;
    }

    const texture = this.gl.createTexture();
    if (!texture) {
      throw new Error('WebGL konnte keine Bildtextur erstellen.');
    }

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
      uploadSource,
    );
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);

    // A staging canvas is only needed during texImage2D. Dropping the reference
    // allows its backing store to be collected on large images.
    stagingCanvas = null;
    this.texture = texture;
    this.textureWidth = width;
    this.textureHeight = height;
    this.mode = asset.mode;
  }

  render(view: ViewState): void {
    if (this.destroyed) return;
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.texture) return;

    const programData = this.mode === 'panorama' ? this.panorama : this.image;
    gl.useProgram(programData.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(programData.uniforms.position);
    gl.vertexAttribPointer(programData.uniforms.position, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(programData.uniforms.texture, 0);

    if (this.mode === 'panorama') {
      const uniforms = programData.uniforms;
      const fov = Math.min(2.45, Math.max(0.24, (Math.PI * 0.82) / Math.max(view.zoom, 0.05)));
      gl.uniform2f(uniforms.resolution ?? null, this.viewport.width, this.viewport.height);
      gl.uniform1f(uniforms.fov ?? null, fov);
      gl.uniform1f(uniforms.yaw ?? null, view.yaw);
      gl.uniform1f(uniforms.pitch ?? null, view.pitch);
      gl.uniform1f(uniforms.frameScale ?? null, Math.min(1, Math.max(0.58, view.zoom)));
    } else {
      const imageAspect = this.textureWidth / Math.max(this.textureHeight, 1);
      const viewportAspect = this.viewport.width / Math.max(this.viewport.height, 1);
      const baseWidth = imageAspect >= viewportAspect ? 1 : imageAspect / viewportAspect;
      const baseHeight = imageAspect >= viewportAspect ? viewportAspect / imageAspect : 1;
      gl.uniform2f(
        programData.uniforms.displaySize ?? null,
        baseWidth * view.zoom,
        baseHeight * view.zoom,
      );
      gl.uniform2f(programData.uniforms.offset ?? null, view.offsetX, view.offsetY);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  disposeImage(): void {
    this.deleteTexture();
  }

  dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.deleteTexture();
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteProgram(this.panorama.program);
    this.gl.deleteProgram(this.image.program);
  }

  private deleteTexture(): void {
    if (this.texture) {
      this.gl.deleteTexture(this.texture);
      this.texture = null;
    }
  }
}
