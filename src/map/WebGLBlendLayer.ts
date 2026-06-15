/**
 * WebGLBlendLayer — MapLibre CustomLayerInterface that renders XYZ/WMS tiles
 * with photoshop-style blend modes inside MapLibre's WebGL pipeline.
 * Inserted at the correct z-position via map.addLayer(layer, beforeId).
 */
import type { Map as MapLibreMap, CustomLayerInterface } from 'maplibre-gl';

// ---- Tile math helpers ----
function lng2tile(lng: number, z: number) { return (lng + 180) / 360 * Math.pow(2, z); }
function lat2tile(lat: number, z: number) {
  return (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z);
}
function tile2lng(x: number, z: number) { return x / Math.pow(2, z) * 360 - 180; }
function tile2lat(y: number, z: number) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}
function lngLatToMercator(lng: number, lat: number): [number, number] {
  const x = (lng + 180) / 360;
  const sinLat = Math.sin(lat * Math.PI / 180);
  const y = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
  return [x, y];
}

// ---- GLSL ----
const VS = `
  attribute vec2 a_pos;
  attribute vec2 a_uv;
  uniform mat4 u_matrix;
  varying vec2 v_uv;
  void main() {
    gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
    v_uv = a_uv;
  }
`;

const FS = `
  precision highp float;
  uniform sampler2D u_tile;
  uniform sampler2D u_dest;
  uniform int u_mode;
  uniform float u_opacity;
  uniform vec2 u_canvas_size;
  varying vec2 v_uv;

  vec3 blendMultiply(vec3 s, vec3 d)  { return s * d; }
  vec3 blendScreen(vec3 s, vec3 d)    { return s + d - s * d; }
  vec3 blendOverlay(vec3 s, vec3 d) {
    return mix(2.0*s*d, 1.0-2.0*(1.0-s)*(1.0-d), step(0.5, d));
  }
  vec3 blendDarken(vec3 s, vec3 d)    { return min(s, d); }
  vec3 blendLighten(vec3 s, vec3 d)   { return max(s, d); }
  vec3 blendHardLight(vec3 s, vec3 d) {
    return mix(2.0*s*d, 1.0-2.0*(1.0-s)*(1.0-d), step(0.5, s));
  }
  vec3 blendSoftLight(vec3 s, vec3 d) {
    return (1.0-2.0*s)*d*d + 2.0*s*d;
  }
  vec3 blendDifference(vec3 s, vec3 d) { return abs(s - d); }

  void main() {
    vec4 src = texture2D(u_tile, v_uv);
    if (src.a < 0.004) discard;

    vec2 screen_uv = gl_FragCoord.xy / u_canvas_size;
    vec4 dst = texture2D(u_dest, screen_uv);

    vec3 blended;
    if      (u_mode == 1) blended = blendMultiply(src.rgb, dst.rgb);
    else if (u_mode == 2) blended = blendScreen(src.rgb, dst.rgb);
    else if (u_mode == 3) blended = blendOverlay(src.rgb, dst.rgb);
    else if (u_mode == 4) blended = blendDarken(src.rgb, dst.rgb);
    else if (u_mode == 5) blended = blendLighten(src.rgb, dst.rgb);
    else if (u_mode == 6) blended = blendHardLight(src.rgb, dst.rgb);
    else if (u_mode == 7) blended = blendSoftLight(src.rgb, dst.rgb);
    else if (u_mode == 8) blended = blendDifference(src.rgb, dst.rgb);
    else                  blended = src.rgb;

    float a = src.a * u_opacity;
    vec3 result = mix(dst.rgb, blended, a);
    gl_FragColor = vec4(result, 1.0);
  }
`;

const MODE_MAP: Record<string, number> = {
  normal: 0, multiply: 1, screen: 2, overlay: 3,
  darken: 4, lighten: 5, 'hard-light': 6, 'soft-light': 7, difference: 8,
};

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  return sh;
}

function makeProgram(gl: WebGLRenderingContext): WebGLProgram {
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  return prog;
}

// ---- Class ----
export class WebGLBlendLayer implements CustomLayerInterface {
  readonly type = 'custom' as const;
  readonly id: string;
  readonly renderingMode = '2d' as const;

  private tileUrl: string;
  private blendMode: string;
  private opacity: number;
  private visible: boolean;

  private map!: MapLibreMap;
  private gl!: WebGLRenderingContext;

  private prog!: WebGLProgram;
  private aPos!: number;
  private aUv!: number;
  private uMatrix!: WebGLUniformLocation;
  private uTile!: WebGLUniformLocation;
  private uDest!: WebGLUniformLocation;
  private uMode!: WebGLUniformLocation;
  private uOpacity!: WebGLUniformLocation;
  private uCanvasSize!: WebGLUniformLocation;

  private posBuf!: WebGLBuffer;
  private uvBuf!: WebGLBuffer;
  private idxBuf!: WebGLBuffer;
  private destTex!: WebGLTexture;

  // Image loading cache
  private imgCache = new Map<string, HTMLImageElement | null>();
  private pending = new Set<string>();

  // WebGL texture cache (url → texture)
  private texCache = new Map<string, WebGLTexture>();

  constructor(id: string, tileUrl: string, blendMode: string, opacity: number, visible: boolean) {
    this.id = id;
    this.tileUrl = tileUrl;
    this.blendMode = blendMode;
    this.opacity = opacity;
    this.visible = visible;
  }

  onAdd(map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this.map = map;
    this.gl = gl as WebGLRenderingContext;

    this.prog = makeProgram(gl);
    this.aPos = gl.getAttribLocation(this.prog, 'a_pos');
    this.aUv  = gl.getAttribLocation(this.prog, 'a_uv');
    this.uMatrix     = gl.getUniformLocation(this.prog, 'u_matrix')!;
    this.uTile       = gl.getUniformLocation(this.prog, 'u_tile')!;
    this.uDest       = gl.getUniformLocation(this.prog, 'u_dest')!;
    this.uMode       = gl.getUniformLocation(this.prog, 'u_mode')!;
    this.uOpacity    = gl.getUniformLocation(this.prog, 'u_opacity')!;
    this.uCanvasSize = gl.getUniformLocation(this.prog, 'u_canvas_size')!;

    this.posBuf = gl.createBuffer()!;
    this.uvBuf  = gl.createBuffer()!;
    this.idxBuf = gl.createBuffer()!;
    this.destTex = gl.createTexture()!;

    // destTex: clamp, nearest — will be populated each frame via copyTexImage2D
    gl.bindTexture(gl.TEXTURE_2D, this.destTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  onRemove(_map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    const g = gl as WebGLRenderingContext;
    for (const tex of this.texCache.values()) g.deleteTexture(tex);
    this.texCache.clear();
    g.deleteTexture(this.destTex);
    g.deleteBuffer(this.posBuf);
    g.deleteBuffer(this.uvBuf);
    g.deleteBuffer(this.idxBuf);
    g.deleteProgram(this.prog);
    this.imgCache.clear();
    this.pending.clear();
  }

  setBlendMode(mode: string): void {
    this.blendMode = mode;
    this.map?.triggerRepaint();
  }

  setOpacityAndVisible(opacity: number, visible: boolean): void {
    this.opacity = opacity;
    this.visible = visible;
    this.map?.triggerRepaint();
  }

  private getTileUrl(x: number, y: number, z: number): string {
    if (this.tileUrl.includes('{bbox-epsg-3857}')) {
      const HALF = 20037508.3428;
      const n = Math.pow(2, z);
      const xmin = (x / n) * HALF * 2 - HALF;
      const xmax = ((x + 1) / n) * HALF * 2 - HALF;
      const ymax = -(y / n) * HALF * 2 + HALF;
      const ymin = -((y + 1) / n) * HALF * 2 + HALF;
      return this.tileUrl.replace('{bbox-epsg-3857}', `${xmin},${ymin},${xmax},${ymax}`);
    }
    return this.tileUrl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  }

  private loadTile(url: string): void {
    if (this.imgCache.has(url) || this.pending.has(url)) return;
    this.pending.add(url);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.pending.delete(url);
      this.imgCache.set(url, img);
      this.map?.triggerRepaint();
    };
    img.onerror = () => {
      this.pending.delete(url);
      this.imgCache.set(url, null);
    };
    img.src = url;
  }

  private uploadTile(gl: WebGLRenderingContext, url: string, img: HTMLImageElement): WebGLTexture {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.texCache.set(url, tex);
    return tex;
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, matrix: ArrayLike<number>, _options?: unknown): void {
    if (!this.visible || this.opacity <= 0) return;
    const g = gl as WebGLRenderingContext;

    const map  = this.map;
    const z    = Math.min(Math.max(Math.round(map.getZoom()), 0), 22);
    const max  = Math.pow(2, z);
    const b    = map.getBounds();
    const minTX = Math.floor(lng2tile(b.getWest(),  z)) - 1;
    const maxTX = Math.floor(lng2tile(b.getEast(),  z)) + 1;
    const minTY = Math.max(0, Math.floor(lat2tile(b.getNorth(), z)) - 1);
    const maxTY = Math.min(max - 1, Math.floor(lat2tile(b.getSouth(), z)) + 1);

    // Build geometry and a parallel list of tile textures (only loaded tiles)
    const posData: number[] = [];
    const uvData:  number[] = [];
    const idxData: number[] = [];
    const tileDraw: WebGLTexture[] = [];  // one entry per 6-index quad

    for (let tx = minTX; tx <= maxTX; tx++) {
      for (let ty = minTY; ty <= maxTY; ty++) {
        const wx  = ((tx % max) + max) % max;
        const url = this.getTileUrl(wx, ty, z);
        const img = this.imgCache.get(url) ?? null;
        if (!img) { this.loadTile(url); continue; }

        let tex = this.texCache.get(url);
        if (!tex) tex = this.uploadTile(g, url, img);

        // Mercator [0,1] corners — use unwrapped tx for correct anti-meridian positioning
        const [mxW, myN] = lngLatToMercator(tile2lng(tx,     z), tile2lat(ty,     z));
        const [mxE]      = lngLatToMercator(tile2lng(tx + 1, z), tile2lat(ty,     z));
        const [,    myS] = lngLatToMercator(tile2lng(tx,     z), tile2lat(ty + 1, z));

        // UNPACK_FLIP_Y_WEBGL=false: image row 0 (north) lands at texture v=0
        // NW uv(0,0)  NE uv(1,0)  SW uv(0,1)  SE uv(1,1)
        const base = posData.length / 2;
        posData.push(mxW, myN,  mxE, myN,  mxW, myS,  mxE, myS);
        uvData.push( 0, 0,      1, 0,      0, 1,       1, 1);
        idxData.push(base, base+1, base+2,  base+1, base+3, base+2);
        tileDraw.push(tex);
      }
    }

    if (tileDraw.length === 0) return;

    // Snapshot everything rendered below this layer
    g.bindTexture(g.TEXTURE_2D, this.destTex);
    g.copyTexImage2D(g.TEXTURE_2D, 0, g.RGBA, 0, 0, g.canvas.width as number, g.canvas.height as number, 0);
    g.bindTexture(g.TEXTURE_2D, null);

    // Upload geometry once
    g.bindBuffer(g.ARRAY_BUFFER, this.posBuf);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array(posData), g.DYNAMIC_DRAW);
    g.bindBuffer(g.ARRAY_BUFFER, this.uvBuf);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array(uvData), g.DYNAMIC_DRAW);
    g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    g.bufferData(g.ELEMENT_ARRAY_BUFFER, new Uint16Array(idxData), g.DYNAMIC_DRAW);

    g.useProgram(this.prog);
    g.enable(g.BLEND);
    g.blendFunc(g.ONE, g.ZERO);  // shader writes final composited colour

    g.uniformMatrix4fv(this.uMatrix, false, new Float32Array(matrix));
    g.uniform1i(this.uMode, MODE_MAP[this.blendMode] ?? 0);
    g.uniform1f(this.uOpacity, this.opacity);
    g.uniform2f(this.uCanvasSize, g.canvas.width as number, g.canvas.height as number);

    g.activeTexture(g.TEXTURE1);
    g.bindTexture(g.TEXTURE_2D, this.destTex);
    g.uniform1i(this.uDest, 1);

    g.enableVertexAttribArray(this.aPos);
    g.enableVertexAttribArray(this.aUv);
    g.bindBuffer(g.ARRAY_BUFFER, this.posBuf);
    g.vertexAttribPointer(this.aPos, 2, g.FLOAT, false, 0, 0);
    g.bindBuffer(g.ARRAY_BUFFER, this.uvBuf);
    g.vertexAttribPointer(this.aUv, 2, g.FLOAT, false, 0, 0);
    g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, this.idxBuf);

    // One draw call per tile (each has its own texture)
    for (let i = 0; i < tileDraw.length; i++) {
      g.activeTexture(g.TEXTURE0);
      g.bindTexture(g.TEXTURE_2D, tileDraw[i]);
      g.uniform1i(this.uTile, 0);
      g.drawElements(g.TRIANGLES, 6, g.UNSIGNED_SHORT, i * 6 * 2);
    }

    g.disableVertexAttribArray(this.aPos);
    g.disableVertexAttribArray(this.aUv);
    g.bindBuffer(g.ARRAY_BUFFER, null);
    g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, null);
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, null);

    // Restore MapLibre's default blend state
    g.blendFunc(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA);
  }
}
