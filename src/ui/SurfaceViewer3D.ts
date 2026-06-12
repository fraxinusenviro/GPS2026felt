/**
 * SurfaceViewer3D — lightweight, dependency-free WebGL viewer for a cut/fill
 * result surface. Launches in its own full-screen modal overlay and supports:
 *
 *   • Orbit  — left-drag
 *   • Pan    — right-drag (or Shift + left-drag)
 *   • Zoom   — mouse wheel / pinch
 *
 * The modified surface is rendered as a lit, vertex-coloured height-field mesh.
 * The user can colour by elevation or by cut/fill difference, toggle the
 * original ground surface (translucent grey) for comparison, and adjust the
 * vertical exaggeration.
 *
 * No external 3D library is used — a small hand-rolled mat4 helper and a single
 * Gouraud-shaded program keep the bundle lean and offline-friendly.
 */

import type { CutFillResult } from '../lib/cutFillEngine';
import { sampleRamp, HRDEM_RAMPS } from '../lib/elevationRenderer';
import { CUTFILL_DIFF_RAMP } from '../map/CutFillLayer';

// Cap mesh resolution per axis so very large grids stay interactive.
const MAX_AXIS = 220;

type ColorMode = 'elevation' | 'diff';

interface Mesh {
  positions: Float32Array; // xyz per vertex (metres, recentred)
  normals: Float32Array;
  colors: Float32Array;    // rgb 0..1
  indices: Uint16Array;
  groundY: Float32Array;   // original ground height per vertex (for ground mesh)
  modY: Float32Array;      // modified height per vertex
  count: number;
}

export class SurfaceViewer3D {
  private static instance: SurfaceViewer3D | null = null;

  static open(result: CutFillResult): void {
    if (!SurfaceViewer3D.instance) SurfaceViewer3D.instance = new SurfaceViewer3D();
    SurfaceViewer3D.instance.show(result);
  }

  // DOM
  private overlay!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private gl!: WebGLRenderingContext;

  // GL objects
  private program!: WebGLProgram;
  private posBuf!: WebGLBuffer;
  private normBuf!: WebGLBuffer;
  private colBuf!: WebGLBuffer;
  private idxBuf!: WebGLBuffer;

  // Ground (original surface) buffers
  private groundPosBuf!: WebGLBuffer;
  private groundNormBuf!: WebGLBuffer;

  private attrLoc!: { position: number; normal: number; color: number };
  private uniLoc!: {
    mvp: WebGLUniformLocation; model: WebGLUniformLocation;
    lightDir: WebGLUniformLocation; uColor: WebGLUniformLocation;
    uUseVColor: WebGLUniformLocation; uAlpha: WebGLUniformLocation;
  };

  // Mesh / view state
  private mesh: Mesh | null = null;
  private result: CutFillResult | null = null;
  private colorMode: ColorMode = 'elevation';
  private vExag = 1.5;
  private showGround = false;
  private extentX = 100;
  private extentZ = 100;

  // Orbit camera (spherical around a target)
  private yaw = -0.6;          // radians
  private pitch = 0.9;
  private dist = 200;
  private target: [number, number, number] = [0, 0, 0];

  // Interaction
  private dragging: 'orbit' | 'pan' | null = null;
  private lastX = 0;
  private lastY = 0;
  private rafPending = false;
  private initialized = false;

  // ── DOM construction ───────────────────────────────────────────────────────

  private ensureDom(): void {
    if (this.initialized) return;

    const overlay = document.createElement('div');
    overlay.id = 'cf3d-overlay';
    overlay.className = 'cf3d-overlay';
    overlay.style.display = 'none';
    overlay.innerHTML = `
      <div class="cf3d-modal">
        <div class="cf3d-header">
          <span class="cf3d-title">3D Surface Viewer</span>
          <div class="cf3d-controls">
            <button class="cf3d-btn" id="cf3d-mode-elev" title="Colour by elevation">Elevation</button>
            <button class="cf3d-btn" id="cf3d-mode-diff" title="Colour by cut / fill">Cut/Fill</button>
            <label class="cf3d-toggle"><input type="checkbox" id="cf3d-ground"> Ground</label>
            <span class="cf3d-sep"></span>
            <label class="cf3d-vexag">Z×<input type="range" id="cf3d-vexag" min="0.5" max="6" step="0.5" value="1.5"></label>
            <button class="cf3d-btn" id="cf3d-reset" title="Reset view">Reset</button>
            <button class="cf3d-btn cf3d-close" id="cf3d-close" title="Close">✕</button>
          </div>
        </div>
        <div class="cf3d-canvas-wrap">
          <canvas id="cf3d-canvas"></canvas>
          <div class="cf3d-hint">Drag to orbit · right-drag to pan · scroll to zoom</div>
          <div class="cf3d-legend" id="cf3d-legend"></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    this.overlay = overlay;
    this.canvas = overlay.querySelector<HTMLCanvasElement>('#cf3d-canvas')!;

    // Buttons
    overlay.querySelector('#cf3d-close')?.addEventListener('click', () => this.hide());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.hide(); });
    overlay.querySelector('#cf3d-mode-elev')?.addEventListener('click', () => this.setColorMode('elevation'));
    overlay.querySelector('#cf3d-mode-diff')?.addEventListener('click', () => this.setColorMode('diff'));
    overlay.querySelector<HTMLInputElement>('#cf3d-ground')?.addEventListener('change', (e) => {
      this.showGround = (e.target as HTMLInputElement).checked;
      this.requestRender();
    });
    overlay.querySelector<HTMLInputElement>('#cf3d-vexag')?.addEventListener('input', (e) => {
      this.vExag = parseFloat((e.target as HTMLInputElement).value) || 1;
      if (this.result) this.buildMesh(this.result);
      this.requestRender();
    });
    overlay.querySelector('#cf3d-reset')?.addEventListener('click', () => { this.resetView(); this.requestRender(); });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.overlay.style.display !== 'none') this.hide();
    });

    this.initGL();
    this.wirePointer();
    window.addEventListener('resize', () => { if (this.overlay.style.display !== 'none') { this.resize(); this.requestRender(); } });

    this.initialized = true;
  }

  // ── Show / hide ──────────────────────────────────────────────────────────

  private show(result: CutFillResult): void {
    this.ensureDom();
    this.result = result;
    this.overlay.style.display = 'flex';
    requestAnimationFrame(() => this.overlay.classList.add('open'));
    this.resize();
    this.buildMesh(result);
    this.resetView();
    this.syncControls();
    this.requestRender();
  }

  private hide(): void {
    this.overlay.classList.remove('open');
    setTimeout(() => { this.overlay.style.display = 'none'; }, 180);
  }

  // ── WebGL setup ────────────────────────────────────────────────────────────

  private initGL(): void {
    const gl = this.canvas.getContext('webgl', { antialias: true, alpha: false });
    if (!gl) { throw new Error('WebGL not supported'); }
    this.gl = gl;

    const vs = `
      attribute vec3 position;
      attribute vec3 normal;
      attribute vec3 color;
      uniform mat4 uMVP;
      uniform mat4 uModel;
      varying vec3 vNormal;
      varying vec3 vColor;
      void main() {
        gl_Position = uMVP * vec4(position, 1.0);
        vNormal = mat3(uModel) * normal;
        vColor = color;
      }
    `;
    const fs = `
      precision mediump float;
      varying vec3 vNormal;
      varying vec3 vColor;
      uniform vec3 uLightDir;
      uniform vec3 uColor;
      uniform float uUseVColor;
      uniform float uAlpha;
      void main() {
        vec3 n = normalize(vNormal);
        float diff = max(dot(n, normalize(uLightDir)), 0.0);
        float light = 0.35 + 0.65 * diff;
        vec3 base = mix(uColor, vColor, uUseVColor);
        gl_FragColor = vec4(base * light, uAlpha);
      }
    `;

    const program = this.linkProgram(vs, fs);
    this.program = program;
    this.attrLoc = {
      position: gl.getAttribLocation(program, 'position'),
      normal: gl.getAttribLocation(program, 'normal'),
      color: gl.getAttribLocation(program, 'color'),
    };
    this.uniLoc = {
      mvp: gl.getUniformLocation(program, 'uMVP')!,
      model: gl.getUniformLocation(program, 'uModel')!,
      lightDir: gl.getUniformLocation(program, 'uLightDir')!,
      uColor: gl.getUniformLocation(program, 'uColor')!,
      uUseVColor: gl.getUniformLocation(program, 'uUseVColor')!,
      uAlpha: gl.getUniformLocation(program, 'uAlpha')!,
    };

    this.posBuf = gl.createBuffer()!;
    this.normBuf = gl.createBuffer()!;
    this.colBuf = gl.createBuffer()!;
    this.idxBuf = gl.createBuffer()!;
    this.groundPosBuf = gl.createBuffer()!;
    this.groundNormBuf = gl.createBuffer()!;

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0.07, 0.09, 0.11, 1);
  }

  private linkProgram(vsSrc: string, fsSrc: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string): WebGLShader => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error('Shader compile error: ' + gl.getShaderInfoLog(sh));
      }
      return sh;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('Program link error: ' + gl.getProgramInfoLog(program));
    }
    return program;
  }

  // ── Mesh construction from the result grid ───────────────────────────────────

  private buildMesh(result: CutFillResult): void {
    const { modifiedGrid, originalGrid, diffGrid, width, height, bbox, nodata, stretchMin, stretchMax } = result;
    const [west, south, east, north] = bbox;

    // Stride to keep vertex count bounded
    const step = Math.max(1, Math.ceil(Math.max(width, height) / MAX_AXIS));
    const cols = Math.floor((width - 1) / step) + 1;
    const rows = Math.floor((height - 1) / step) + 1;

    // Real-world extents (metres) for correct aspect ratio
    const latMid = (south + north) / 2;
    const extX = (east - west) * 111320 * Math.cos(latMid * Math.PI / 180);
    const extZ = (north - south) * 110540;
    this.extentX = extX;
    this.extentZ = extZ;

    const elevMid = (stretchMin + stretchMax) / 2;
    const horizScale = Math.max(extX, extZ);

    const nVerts = cols * rows;
    const positions = new Float32Array(nVerts * 3);
    const colors = new Float32Array(nVerts * 3);
    const modY = new Float32Array(nVerts);
    const groundY = new Float32Array(nVerts);

    const isNodata = (v: number, og: number): boolean =>
      !isFinite(v) || (nodata !== null && Math.abs(og - nodata) < 0.001);

    // Diff range for colour mapping
    let maxAbsDiff = 0;
    for (let i = 0; i < diffGrid.length; i++) {
      const a = Math.abs(diffGrid[i]);
      if (a > maxAbsDiff) maxAbsDiff = a;
    }
    if (maxAbsDiff < 0.01) maxAbsDiff = 1;

    const elevRamp = HRDEM_RAMPS['terrain'].ramp;

    let vi = 0;
    for (let r = 0; r < rows; r++) {
      const gr = Math.min(height - 1, r * step);
      const lat = north - (gr / (height - 1)) * (north - south);
      const zMeters = (north - lat) * 110540 - extZ / 2; // recentre
      for (let c = 0; c < cols; c++) {
        const gc = Math.min(width - 1, c * step);
        const gi = gr * width + gc;
        const lon = west + (gc / (width - 1)) * (east - west);
        const xMeters = (lon - west) * 111320 * Math.cos(latMid * Math.PI / 180) - extX / 2;

        const mv = modifiedGrid[gi];
        const og = originalGrid[gi];
        const nd = isNodata(mv, og);

        const y = nd ? 0 : (mv - elevMid) * this.vExag;
        const gy = nd ? 0 : (og - elevMid) * this.vExag;

        const p = vi * 3;
        positions[p] = xMeters;
        positions[p + 1] = y;
        positions[p + 2] = zMeters;
        modY[vi] = y;
        groundY[vi] = gy;

        // Colour
        let cr = 0.5, cg = 0.5, cb = 0.5;
        if (!nd) {
          if (this.colorMode === 'diff') {
            const t = Math.max(0, Math.min(1, 0.5 + diffGrid[gi] / (2 * maxAbsDiff)));
            const [rr, gg, bb] = sampleRamp(CUTFILL_DIFF_RAMP, t);
            cr = rr / 255; cg = gg / 255; cb = bb / 255;
          } else {
            const t = stretchMin === stretchMax ? 0.5 : (mv - stretchMin) / (stretchMax - stretchMin);
            const [rr, gg, bb] = sampleRamp(elevRamp, Math.max(0, Math.min(1, t)));
            cr = rr / 255; cg = gg / 255; cb = bb / 255;
          }
        }
        const cidx = vi * 3;
        colors[cidx] = cr; colors[cidx + 1] = cg; colors[cidx + 2] = cb;

        vi++;
      }
    }

    // Indices (two triangles per quad), skipping quads touching nodata
    const idx: number[] = [];
    const ndVert = new Uint8Array(nVerts);
    {
      let k = 0;
      for (let r = 0; r < rows; r++) {
        const gr = Math.min(height - 1, r * step);
        for (let c = 0; c < cols; c++) {
          const gc = Math.min(width - 1, c * step);
          const gi = gr * width + gc;
          ndVert[k++] = isNodata(modifiedGrid[gi], originalGrid[gi]) ? 1 : 0;
        }
      }
    }
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        const b = a + 1;
        const d = a + cols;
        const e = d + 1;
        if (ndVert[a] || ndVert[b] || ndVert[d] || ndVert[e]) continue;
        idx.push(a, d, b, b, d, e);
      }
    }

    // MAX_AXIS keeps vertex count < 65 536, so 16-bit indices are always safe.
    const indices = new Uint16Array(idx);

    const normals = this.computeNormals(positions, indices, nVerts);

    this.mesh = { positions, normals, colors, indices, groundY, modY, count: idx.length };

    this.uploadMesh();
    this.buildLegend(result, maxAbsDiff);
  }

  private computeNormals(positions: Float32Array, indices: Uint16Array, nVerts: number): Float32Array {
    const normals = new Float32Array(nVerts * 3);
    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i] * 3, i1 = indices[i + 1] * 3, i2 = indices[i + 2] * 3;
      const ax = positions[i1] - positions[i0], ay = positions[i1 + 1] - positions[i0 + 1], az = positions[i1 + 2] - positions[i0 + 2];
      const bx = positions[i2] - positions[i0], by = positions[i2 + 1] - positions[i0 + 1], bz = positions[i2 + 2] - positions[i0 + 2];
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      for (const vi of [indices[i], indices[i + 1], indices[i + 2]]) {
        normals[vi * 3] += nx; normals[vi * 3 + 1] += ny; normals[vi * 3 + 2] += nz;
      }
    }
    for (let v = 0; v < nVerts; v++) {
      const o = v * 3;
      const len = Math.hypot(normals[o], normals[o + 1], normals[o + 2]) || 1;
      normals[o] /= len; normals[o + 1] /= len; normals[o + 2] /= len;
    }
    return normals;
  }

  private uploadMesh(): void {
    const gl = this.gl;
    const m = this.mesh!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, m.positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, m.normals, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf);
    gl.bufferData(gl.ARRAY_BUFFER, m.colors, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.STATIC_DRAW);

    // Ground mesh shares topology; only Y differs
    const gpos = new Float32Array(m.positions);
    for (let v = 0; v < m.groundY.length; v++) gpos[v * 3 + 1] = m.groundY[v];
    const gnorm = this.computeNormals(gpos, m.indices, m.groundY.length);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.groundPosBuf);
    gl.bufferData(gl.ARRAY_BUFFER, gpos, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.groundNormBuf);
    gl.bufferData(gl.ARRAY_BUFFER, gnorm, gl.STATIC_DRAW);
  }

  // ── Camera / view ────────────────────────────────────────────────────────────

  private resetView(): void {
    this.yaw = -0.6;
    this.pitch = 0.95;
    this.target = [0, 0, 0];
    this.dist = Math.max(this.extentX, this.extentZ) * 1.4 || 200;
  }

  private resize(): void {
    const wrap = this.canvas.parentElement!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = wrap.clientWidth, h = wrap.clientHeight;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
  }

  private requestRender(): void {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => { this.rafPending = false; this.render(); });
  }

  private render(): void {
    const gl = this.gl;
    if (!this.mesh) return;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const proj = mat4Perspective(Math.PI / 4, aspect, this.dist * 0.01, this.dist * 10 + 1000);

    // Camera position from spherical orbit around target
    const cp = this.pitch;
    const ex = this.target[0] + this.dist * Math.cos(cp) * Math.sin(this.yaw);
    const ey = this.target[1] + this.dist * Math.sin(cp);
    const ez = this.target[2] + this.dist * Math.cos(cp) * Math.cos(this.yaw);
    const view = mat4LookAt([ex, ey, ez], this.target, [0, 1, 0]);
    const mvp = mat4Multiply(proj, view);
    const model = mat4Identity();

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniLoc.mvp, false, mvp);
    gl.uniformMatrix4fv(this.uniLoc.model, false, model);
    gl.uniform3f(this.uniLoc.lightDir, 0.5, 0.8, 0.3);

    // Modified surface (vertex-coloured, opaque)
    this.bindAttrib(this.attrLoc.position, this.posBuf, 3);
    this.bindAttrib(this.attrLoc.normal, this.normBuf, 3);
    this.bindAttrib(this.attrLoc.color, this.colBuf, 3);
    gl.uniform1f(this.uniLoc.uUseVColor, 1);
    gl.uniform1f(this.uniLoc.uAlpha, 1);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    gl.drawElements(gl.TRIANGLES, this.mesh.count, gl.UNSIGNED_SHORT, 0);

    // Ground surface (flat grey, translucent) — drawn last for blending
    if (this.showGround) {
      this.bindAttrib(this.attrLoc.position, this.groundPosBuf, 3);
      this.bindAttrib(this.attrLoc.normal, this.groundNormBuf, 3);
      gl.disableVertexAttribArray(this.attrLoc.color);
      gl.vertexAttrib3f(this.attrLoc.color, 0.7, 0.7, 0.72);
      gl.uniform1f(this.uniLoc.uUseVColor, 0);
      gl.uniform3f(this.uniLoc.uColor, 0.7, 0.7, 0.72);
      gl.uniform1f(this.uniLoc.uAlpha, 0.35);
      gl.drawElements(gl.TRIANGLES, this.mesh.count, gl.UNSIGNED_SHORT, 0);
    }
  }

  private bindAttrib(loc: number, buf: WebGLBuffer, size: number): void {
    const gl = this.gl;
    if (loc < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }

  // ── Pointer interaction ──────────────────────────────────────────────────────

  private wirePointer(): void {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.dragging = (e.button === 2 || e.shiftKey) ? 'pan' : 'orbit';
      this.lastX = e.clientX; this.lastY = e.clientY;
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX; this.lastY = e.clientY;

      if (this.dragging === 'orbit') {
        this.yaw -= dx * 0.008;
        this.pitch = Math.max(0.05, Math.min(Math.PI / 2 - 0.02, this.pitch + dy * 0.008));
      } else {
        // Pan in the camera's screen plane
        const panScale = this.dist * 0.0018;
        const right: [number, number, number] = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
        const fwd: [number, number, number] = [Math.sin(this.yaw), 0, Math.cos(this.yaw)];
        this.target[0] -= (right[0] * dx - fwd[0] * dy) * panScale;
        this.target[2] -= (right[2] * dx - fwd[2] * dy) * panScale;
        this.target[1] += 0; // keep height
      }
      this.requestRender();
    });
    const end = (e: PointerEvent) => {
      this.dragging = null;
      try { c.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = Math.exp(e.deltaY * 0.0012);
      this.dist = Math.max(this.extentX * 0.05 + 1, Math.min(this.dist * factor, this.extentX * 12 + 5000));
      this.requestRender();
    }, { passive: false });
  }

  // ── Controls / legend ────────────────────────────────────────────────────────

  private setColorMode(mode: ColorMode): void {
    this.colorMode = mode;
    if (this.result) this.buildMesh(this.result);
    this.syncControls();
    this.requestRender();
  }

  private syncControls(): void {
    const elev = this.overlay.querySelector('#cf3d-mode-elev');
    const diff = this.overlay.querySelector('#cf3d-mode-diff');
    elev?.classList.toggle('cf3d-btn-active', this.colorMode === 'elevation');
    diff?.classList.toggle('cf3d-btn-active', this.colorMode === 'diff');
    const gchk = this.overlay.querySelector<HTMLInputElement>('#cf3d-ground');
    if (gchk) gchk.checked = this.showGround;
    const vex = this.overlay.querySelector<HTMLInputElement>('#cf3d-vexag');
    if (vex) vex.value = String(this.vExag);
  }

  private buildLegend(result: CutFillResult, maxAbsDiff: number): void {
    const el = this.overlay.querySelector<HTMLElement>('#cf3d-legend');
    if (!el) return;
    if (this.colorMode === 'diff') {
      el.innerHTML = `
        <div class="cf3d-legend-title">Cut / Fill (m)</div>
        <div class="cf3d-legend-bar cf3d-legend-diff"></div>
        <div class="cf3d-legend-labels"><span>−${maxAbsDiff.toFixed(1)} cut</span><span>0</span><span>+${maxAbsDiff.toFixed(1)} fill</span></div>`;
    } else {
      el.innerHTML = `
        <div class="cf3d-legend-title">Elevation (m)</div>
        <div class="cf3d-legend-bar cf3d-legend-elev"></div>
        <div class="cf3d-legend-labels"><span>${result.stretchMin.toFixed(1)}</span><span>${result.stretchMax.toFixed(1)}</span></div>`;
    }
  }
}

// ---------------------------------------------------------------------------
// Minimal column-major mat4 helpers (returns Float32Array length 16)
// ---------------------------------------------------------------------------

function mat4Identity(): Float32Array {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function mat4Perspective(fovy: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

function mat4LookAt(eye: number[], center: number[], up: number[]): Float32Array {
  const zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
  let zl = Math.hypot(zx, zy, zz) || 1;
  const z = [zx / zl, zy / zl, zz / zl];
  const xx = up[1] * z[2] - up[2] * z[1];
  const xy = up[2] * z[0] - up[0] * z[2];
  const xz = up[0] * z[1] - up[1] * z[0];
  let xl = Math.hypot(xx, xy, xz) || 1;
  const x = [xx / xl, xy / xl, xz / xl];
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const out = new Float32Array(16);
  out[0] = x[0]; out[1] = y[0]; out[2] = z[0]; out[3] = 0;
  out[4] = x[1]; out[5] = y[1]; out[6] = z[1]; out[7] = 0;
  out[8] = x[2]; out[9] = y[2]; out[10] = z[2]; out[11] = 0;
  out[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
  out[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
  out[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
  out[15] = 1;
  return out;
}

function mat4Multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      out[i * 4 + j] =
        a[0 * 4 + j] * b[i * 4 + 0] +
        a[1 * 4 + j] * b[i * 4 + 1] +
        a[2 * 4 + j] * b[i * 4 + 2] +
        a[3 * 4 + j] * b[i * 4 + 3];
    }
  }
  return out;
}
