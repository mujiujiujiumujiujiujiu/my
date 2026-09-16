(function () {
const VERTEX_SOURCE = `#version 300 es
in vec2 a_position;
uniform vec2 u_resolution;
uniform vec2 u_camera;
uniform float u_zoom;

void main() {
  vec2 screen = (a_position - u_camera) * u_zoom + u_resolution * 0.5;
  vec2 zeroToOne = screen / u_resolution;
  vec2 clip = zeroToOne * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const FRAGMENT_SOURCE = `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 outColor;

void main() {
  outColor = u_color;
}`;

const SPRITE_VERTEX_SOURCE = `#version 300 es
in vec2 a_position;
in vec2 a_uv;
uniform vec2 u_resolution;
uniform vec2 u_camera;
uniform float u_zoom;
out vec2 v_uv;

void main() {
  vec2 screen = (a_position - u_camera) * u_zoom + u_resolution * 0.5;
  vec2 zeroToOne = screen / u_resolution;
  vec2 clip = zeroToOne * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = a_uv;
}`;

const SPRITE_FRAGMENT_SOURCE = `#version 300 es
precision mediump float;
uniform sampler2D u_texture;
uniform vec4 u_tint;
in vec2 v_uv;
out vec4 outColor;

void main() {
  outColor = texture(u_texture, v_uv) * u_tint;
}`;

function hexToRgba(value, alpha = 1) {
  const hex = String(value ?? '#ffffff').replace('#', '');
  const normalized = hex.length === 3 ? hex.split('').map((part) => part + part).join('') : hex.padEnd(6, 'f');
  const number = Number.parseInt(normalized.slice(0, 6), 16);
  if (!Number.isFinite(number)) return [1, 1, 1, alpha];
  return [((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255, alpha];
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('无法创建 WebGL shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || '未知 shader 错误';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE);
  const program = gl.createProgram();
  if (!program) throw new Error('无法创建 WebGL program');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || '未知 program 错误';
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

function createSpriteProgram(gl) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, SPRITE_VERTEX_SOURCE);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, SPRITE_FRAGMENT_SOURCE);
  const program = gl.createProgram();
  if (!program) throw new Error('无法创建 WebGL sprite program');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || '未知 sprite program 错误';
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

class NativeWebGLRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      powerPreference: 'high-performance',
    });
    if (!this.gl) throw new Error('当前浏览器没有可用的 WebGL2');

    this.program = createProgram(this.gl);
    this.spriteProgram = createSpriteProgram(this.gl);
    this.positionBuffer = this.gl.createBuffer();
    this.spritePositionBuffer = this.gl.createBuffer();
    this.spriteUvBuffer = this.gl.createBuffer();
    this.positionLocation = this.gl.getAttribLocation(this.program, 'a_position');
    this.resolutionLocation = this.gl.getUniformLocation(this.program, 'u_resolution');
    this.cameraLocation = this.gl.getUniformLocation(this.program, 'u_camera');
    this.zoomLocation = this.gl.getUniformLocation(this.program, 'u_zoom');
    this.colorLocation = this.gl.getUniformLocation(this.program, 'u_color');
    this.spritePositionLocation = this.gl.getAttribLocation(this.spriteProgram, 'a_position');
    this.spriteUvLocation = this.gl.getAttribLocation(this.spriteProgram, 'a_uv');
    this.spriteResolutionLocation = this.gl.getUniformLocation(this.spriteProgram, 'u_resolution');
    this.spriteCameraLocation = this.gl.getUniformLocation(this.spriteProgram, 'u_camera');
    this.spriteZoomLocation = this.gl.getUniformLocation(this.spriteProgram, 'u_zoom');
    this.spriteTextureLocation = this.gl.getUniformLocation(this.spriteProgram, 'u_texture');
    this.spriteTintLocation = this.gl.getUniformLocation(this.spriteProgram, 'u_tint');
    this.spriteTexture = null;
    this.spriteReady = false;
    this.backgroundTexture = null;
    this.backgroundReady = false;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.qualityTier = 'blur';
    this.camera = { x: 800, y: 410, zoom: 0.72 };
    this.resize();

    this.gl.useProgram(this.program);
    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
    this.gl.disable(this.gl.DEPTH_TEST);
  }

  loadTexture(url) {
    return this.loadImageTexture(url, 'sprite');
  }

  loadBackgroundTexture(url) {
    return this.loadImageTexture(url, 'background');
  }

  setQuality(tier = 'blur') {
    const nextTier = ['blur', 'low', 'medium', 'high'].includes(tier) ? tier : 'blur';
    if (this.qualityTier === nextTier) return;
    this.qualityTier = nextTier;
    this.configureTexture(this.spriteTexture);
    this.configureTexture(this.backgroundTexture);
    this.resize();
  }

  qualitySegments(base = 24) {
    const multiplier = this.qualityTier === 'blur' ? 0.44 : this.qualityTier === 'low' ? 0.58 : this.qualityTier === 'medium' ? 0.78 : 1;
    return Math.max(8, Math.round(base * multiplier));
  }

  getDprCap() {
    if (this.qualityTier === 'blur') return 1;
    if (this.qualityTier === 'low') {
      const viewportWidth = Number(window.visualViewport?.width) || window.innerWidth || 1;
      const viewportHeight = Number(window.visualViewport?.height) || window.innerHeight || 1;
      const mobileViewport = Math.min(viewportWidth, viewportHeight) <= 600;
      // 手机 UI 仍走轻量资源，但画布至少保留接近 Retina 的采样密度，避免 CSS 放大后发糊。
      return mobileViewport ? 2 : 1;
    }
    return this.qualityTier === 'medium' ? 1.75 : 2.4;
  }

  configureTexture(texture) {
    if (!texture) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const useMipmaps = !['blur', 'low'].includes(this.qualityTier);
    if (useMipmaps) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, useMipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (useMipmaps) {
      const anisotropic = gl.getExtension('EXT_texture_filter_anisotropic')
        || gl.getExtension('MOZ_EXT_texture_filter_anisotropic')
        || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
      if (anisotropic) {
        const maxAnisotropy = gl.getParameter(anisotropic.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1;
        gl.texParameterf(gl.TEXTURE_2D, anisotropic.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, maxAnisotropy));
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  loadImageTexture(url, target = 'sprite') {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        const gl = this.gl;
        const texture = gl.createTexture();
        if (!texture) {
          reject(new Error(target === 'background' ? '无法创建手绘战场纹理' : '无法创建手绘角色纹理'));
          return;
        }
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.bindTexture(gl.TEXTURE_2D, null);
        this.configureTexture(texture);
        if (target === 'background') {
          if (this.backgroundTexture) gl.deleteTexture(this.backgroundTexture);
          this.backgroundTexture = texture;
          this.backgroundReady = true;
        } else {
          if (this.spriteTexture) gl.deleteTexture(this.spriteTexture);
          this.spriteTexture = texture;
          this.spriteReady = true;
        }
        resolve();
      };
      image.onerror = () => reject(new Error(`${target === 'background' ? '无法加载手绘战场纹理' : '无法加载手绘角色纹理'}：${url}`));
      image.src = url;
    });
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const layoutWidth = this.canvas.clientWidth || this.canvas.offsetWidth || rect.width || 1;
    const layoutHeight = this.canvas.clientHeight || this.canvas.offsetHeight || rect.height || 1;
    this.width = Math.max(1, layoutWidth);
    this.height = Math.max(1, layoutHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, this.getDprCap());
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  begin(camera = this.camera) {
    this.camera = camera;
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.035, 0.047, 0.08, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform2f(this.resolutionLocation, this.width, this.height);
    gl.uniform2f(this.cameraLocation, camera.x, camera.y);
    gl.uniform1f(this.zoomLocation, camera.zoom);
  }

  end() {}

  drawVertices(vertices, color, mode = this.gl.TRIANGLES, alpha = 1) {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);
    const rgba = hexToRgba(color, alpha);
    gl.uniform4f(this.colorLocation, rgba[0], rgba[1], rgba[2], rgba[3]);
    gl.drawArrays(mode, 0, vertices.length / 2);
  }

  drawSprite(x, y, width, height, spriteIndex, alpha = 1, tint = '#ffffff', flipX = false) {
    if (!this.spriteReady || !this.spriteTexture || !Number.isInteger(spriteIndex)) return;
    const column = ((spriteIndex % 4) + 4) % 4;
    const row = Math.floor(spriteIndex / 4);
    const u1 = column / 4;
    const u2 = (column + 1) / 4;
    const v1 = row / 4;
    const v2 = (row + 1) / 4;
    this.drawTextureRect(x, y, width, height, this.spriteTexture, u1, u2, v1, v2, alpha, tint, flipX);
  }

  drawTextureRect(x, y, width, height, texture, u1 = 0, u2 = 1, v1 = 0, v2 = 1, alpha = 1, tint = '#ffffff', flipX = false) {
    if (!texture) return;
    const gl = this.gl;
    const left = x - width / 2;
    const right = x + width / 2;
    const top = y - height / 2;
    const bottom = y + height / 2;
    const uvLeft = flipX ? u2 : u1;
    const uvRight = flipX ? u1 : u2;
    const positions = [left, top, right, top, right, bottom, left, top, right, bottom, left, bottom];
    const uvs = [uvLeft, v1, uvRight, v1, uvRight, v2, uvLeft, v1, uvRight, v2, uvLeft, v2];
    const rgba = hexToRgba(tint, alpha);

    gl.useProgram(this.spriteProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spritePositionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.spritePositionLocation);
    gl.vertexAttribPointer(this.spritePositionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteUvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.spriteUvLocation);
    gl.vertexAttribPointer(this.spriteUvLocation, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(this.spriteResolutionLocation, this.width, this.height);
    gl.uniform2f(this.spriteCameraLocation, this.camera.x, this.camera.y);
    gl.uniform1f(this.spriteZoomLocation, this.camera.zoom);
    gl.uniform4f(this.spriteTintLocation, rgba[0], rgba[1], rgba[2], rgba[3]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this.spriteTextureLocation, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  drawRect(x, y, width, height, color, alpha = 1) {
    const x1 = x - width / 2;
    const x2 = x + width / 2;
    const y1 = y - height / 2;
    const y2 = y + height / 2;
    this.drawVertices([x1, y1, x2, y1, x2, y2, x1, y1, x2, y2, x1, y2], color, this.gl.TRIANGLES, alpha);
  }

  drawPolygon(points, color, alpha = 1) {
    if (!Array.isArray(points) || points.length < 3) return;
    const vertices = [];
    const origin = points[0];
    for (let index = 1; index < points.length - 1; index += 1) {
      const first = points[index];
      const second = points[index + 1];
      vertices.push(origin.x, origin.y, first.x, first.y, second.x, second.y);
    }
    this.drawVertices(vertices, color, this.gl.TRIANGLES, alpha);
  }

  drawTriangle(x, y, size, angle, color, alpha = 1) {
    const points = [];
    for (let index = 0; index < 3; index += 1) {
      const pointAngle = angle + index * Math.PI * 2 / 3 - Math.PI / 2;
      points.push({ x: x + Math.cos(pointAngle) * size, y: y + Math.sin(pointAngle) * size });
    }
    this.drawPolygon(points, color, alpha);
  }

  drawCircle(x, y, radius, color, segments = 24, alpha = 1) {
    const vertices = [x, y];
    for (let index = 0; index <= segments; index += 1) {
      const angle = (index / segments) * Math.PI * 2;
      vertices.push(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
    }
    const triangles = [];
    for (let index = 0; index < segments; index += 1) {
      triangles.push(vertices[0], vertices[1]);
      const first = 2 + index * 2;
      const second = first + 2;
      triangles.push(vertices[first], vertices[first + 1], vertices[second], vertices[second + 1]);
    }
    this.drawVertices(triangles, color, this.gl.TRIANGLES, alpha);
  }

  drawRing(x, y, radius, thickness, color, segments = 32, alpha = 1) {
    const vertices = [];
    const inner = Math.max(0.5, radius - thickness / 2);
    const outer = radius + thickness / 2;
    for (let index = 0; index < segments; index += 1) {
      const a1 = (index / segments) * Math.PI * 2;
      const a2 = ((index + 1) / segments) * Math.PI * 2;
      const c1 = Math.cos(a1);
      const s1 = Math.sin(a1);
      const c2 = Math.cos(a2);
      const s2 = Math.sin(a2);
      vertices.push(
        x + c1 * inner, y + s1 * inner,
        x + c1 * outer, y + s1 * outer,
        x + c2 * outer, y + s2 * outer,
        x + c1 * inner, y + s1 * inner,
        x + c2 * outer, y + s2 * outer,
        x + c2 * inner, y + s2 * inner,
      );
    }
    this.drawVertices(vertices, color, this.gl.TRIANGLES, alpha);
  }

  drawLine(x1, y1, x2, y2, thickness, color, alpha = 1) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy) || 1;
    const nx = (-dy / length) * thickness / 2;
    const ny = (dx / length) * thickness / 2;
    this.drawVertices([
      x1 + nx, y1 + ny, x2 + nx, y2 + ny, x2 - nx, y2 - ny,
      x1 + nx, y1 + ny, x2 - nx, y2 - ny, x1 - nx, y1 - ny,
    ], color, this.gl.TRIANGLES, alpha);
  }

  worldToScreen(x, y) {
    return {
      x: (x - this.camera.x) * this.camera.zoom + this.width / 2,
      y: (y - this.camera.y) * this.camera.zoom + this.height / 2,
    };
  }

  screenToWorld(x, y) {
    return {
      x: this.camera.x + (x - this.width / 2) / this.camera.zoom,
      y: this.camera.y + (y - this.height / 2) / this.camera.zoom,
    };
  }
}

window.MemeWarWebGL = { NativeWebGLRenderer, hexToRgba };
})();
