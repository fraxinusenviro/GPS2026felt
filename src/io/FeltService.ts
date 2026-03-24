// ============================================================
// Felt API Service
// Endpoints confirmed against https://github.com/fraxinusenviro/FELT
// ============================================================

const FELT_API = 'https://felt.com/api/v2';

export interface FeltProject {
  id: string;
  name: string;
}

export interface FeltMap {
  id: string;
  title: string;
  url: string;
}

export class FeltService {
  constructor(private apiKey: string) {}

  private get headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Validates the API key by calling the projects endpoint.
   * Throws if the key is invalid or the request fails.
   */
  async validateKey(): Promise<void> {
    const res = await fetch(`${FELT_API}/projects`, { headers: this.headers });
    if (res.status === 401 || res.status === 403) throw new Error('Invalid API key');
    if (!res.ok) throw new Error(`Felt API error (${res.status})`);
  }

  /**
   * Lists all projects accessible with this API key.
   * Response: array of { id, name }
   */
  async getProjects(): Promise<FeltProject[]> {
    const res = await fetch(`${FELT_API}/projects`, { headers: this.headers });
    if (!res.ok) throw new Error(`Failed to load projects (${res.status})`);
    const data = await res.json();
    const raw: { id: string; name?: string }[] =
      Array.isArray(data) ? data : (data.projects ?? data.data ?? []);
    return raw.map(p => ({ id: p.id, name: p.name ?? p.id }));
  }

  /**
   * Gets maps for a specific project.
   * Uses GET /projects/{id} → project.maps array.
   * Returns empty array if no projectId provided (no global maps listing in v2).
   */
  async getMaps(projectId?: string): Promise<FeltMap[]> {
    if (!projectId) return [];
    const res = await fetch(`${FELT_API}/projects/${encodeURIComponent(projectId)}`, {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`Failed to load project maps (${res.status})`);
    const project = await res.json();
    const maps: { id: string; title?: string; url?: string }[] = project.maps ?? [];
    return maps.map(m => ({ id: m.id, title: m.title ?? m.id, url: m.url ?? '' }));
  }

  /**
   * Creates a new map then optionally moves it into a project.
   * Felt v2: create with { title } only, then POST /maps/{id}/move with { project_id }.
   */
  async createMap(title: string, projectId?: string): Promise<FeltMap> {
    const res = await fetch(`${FELT_API}/maps`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ title }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create map: ${text}`);
    }
    const newMap = await res.json();
    const mapId: string = newMap.id;

    if (projectId) {
      // Move into project — best-effort, don't fail the whole operation
      await fetch(`${FELT_API}/maps/${mapId}/move`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ project_id: projectId }),
      }).catch(() => undefined);
    }

    return { id: mapId, title: newMap.title ?? title, url: newMap.url ?? '' };
  }

  /**
   * Uploads a GeoJSON string to a Felt map as a new layer.
   * Step 1: POST /maps/{id}/upload → { url, presigned_attributes }
   * Step 2: multipart POST to S3 (file field must be last per AWS requirements)
   */
  /**
   * Uploads a GeoJSON string to a Felt map as a new layer.
   * Returns the layer_group_id so callers can apply style after processing.
   */
  async uploadGeoJSON(mapId: string, geojsonStr: string, layerName: string): Promise<string | null> {
    const fileName = 'data.geojson'; // fixed name matches server.js behaviour

    // Step 1: Request presigned S3 URL from Felt
    console.log('[FeltService] Requesting presigned upload URL for map:', mapId, 'layer:', layerName);
    const feltRes = await fetch(`${FELT_API}/maps/${mapId}/upload`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ name: layerName }),
    });

    if (!feltRes.ok) {
      const text = await feltRes.text();
      console.error('[FeltService] Upload init failed:', feltRes.status, text);
      throw new Error(`Felt upload init failed (${feltRes.status}): ${text}`);
    }

    const payload = await feltRes.json();
    console.log('[FeltService] Upload init response keys:', Object.keys(payload));
    console.log('[FeltService] Full upload init payload:', JSON.stringify(payload));

    const { url, presigned_attributes, layer_group_id } = payload;

    if (!url || !presigned_attributes) {
      console.error('[FeltService] Missing presigned details. Full response:', payload);
      throw new Error(
        `Felt API did not return presigned upload details — check API key permissions.\n` +
        `Response keys: ${Object.keys(payload).join(', ')}`
      );
    }

    console.log('[FeltService] S3 URL received. Presigned fields:', Object.keys(presigned_attributes));

    // Step 2: POST file to S3 (file field MUST be appended last per AWS requirements)
    const formData = new FormData();
    for (const [k, v] of Object.entries(presigned_attributes as Record<string, string>)) {
      formData.append(k, v);
    }
    formData.append('file', new Blob([geojsonStr], { type: 'application/geo+json' }), fileName);

    console.log('[FeltService] Posting to S3…');
    const s3Res = await fetch(url, { method: 'POST', body: formData });
    console.log('[FeltService] S3 response status:', s3Res.status);

    if (s3Res.status !== 204) {
      const s3Body = await s3Res.text().catch(() => '(unreadable)');
      console.error('[FeltService] S3 error body:', s3Body);
      throw new Error(`S3 upload failed (${s3Res.status}): ${s3Body}`);
    }

    console.log('[FeltService] Upload complete ✓ layer_id:', payload.layer_id ?? '(none)');
    return (payload.layer_id as string) ?? null;
  }

  /**
   * Updates the FSL style for a single layer.
   */
  async updateLayerStyle(mapId: string, layerId: string, fsl: object): Promise<void> {
    const res = await fetch(`${FELT_API}/maps/${mapId}/layers/${layerId}/update_style`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ style: fsl }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('[FeltService] updateLayerStyle failed:', res.status, text);
      throw new Error(`update_style failed (${res.status}): ${text}`);
    }
    console.log('[FeltService] updateLayerStyle succeeded for layer:', layerId);
  }

  /**
   * Polls GET /maps/{mapId}/layers/{layerId} (up to 10 × 3s = 30s) until Felt
   * finishes processing the uploaded layer, then applies categorical FSL by `type`.
   * Errors are swallowed — upload success is never blocked by style failure.
   */
  async applyStyleToUploadedLayers(
    mapId: string,
    layerId: string,
    typeColors: Record<string, string>,
  ): Promise<void> {
    console.log('[FeltService] applyStyle start — layerId:', layerId);
    console.log('[FeltService] typeColors:', JSON.stringify(typeColors));

    let geometryType = 'Point';
    let found = false;
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const res = await fetch(`${FELT_API}/maps/${mapId}/layers/${layerId}`, { headers: this.headers });
        console.log(`[FeltService] Poll ${i + 1}/10 — layer status: ${res.status}`);
        if (res.ok) {
          const layer = await res.json();
          geometryType = layer.geometry_type ?? 'Point';
          console.log('[FeltService] Layer ready — geometry_type:', geometryType);
          found = true;
          break;
        }
      } catch (err) {
        console.error(`[FeltService] Poll ${i + 1}/10 error:`, err);
      }
    }

    if (!found) {
      console.warn('[FeltService] Layer not ready after 10 polls (30s) — style not applied');
      return;
    }

    const fsl = this.buildCategoricalFSL(typeColors, geometryType);
    console.log('[FeltService] Applying FSL — layerId:', layerId, 'FSL:', JSON.stringify(fsl));
    await this.updateLayerStyle(mapId, layerId, fsl).catch((err) => {
      console.error('[FeltService] updateLayerStyle failed:', err);
    });
  }

  /**
   * Builds a Felt Style Language (FSL v2.3) object for categorical colouring by `type`.
   * paint.color must be an array of hex values (one per category), not a match expression.
   * Felt geometry_type values: "Point", "Line", "Polygon" (singular, capitalised).
   * TypePreset.color defaults to '#4ade80'; any type still using that default gets a
   * deterministic hash-based colour so all types appear distinct on the map.
   */
  private buildCategoricalFSL(typeColors: Record<string, string>, geometryType: string): object {
    const DEFAULT_COLOR = '#4ade80';
    const entries = Object.entries(typeColors);
    const categories = entries.map(([label]) => label);
    const colors     = entries.map(([label, hex]) =>
      hex === DEFAULT_COLOR ? this.hashHex(label) : hex
    );

    const geo = geometryType.toLowerCase();
    const isPolygon = geo.includes('polygon');
    const isLine    = geo.includes('line');

    return {
      version: '2.3',
      type: 'categorical',
      config: {
        categoricalAttribute: 'type',
        categories,
        showOther: true,
      },
      legend: {},
      paint: {
        color: colors,
        opacity: isPolygon ? 0.5 : 0.9,
        ...(isLine  ? { strokeWidth: 2 } : {}),
        ...(!isLine ? { size: 8, strokeColor: 'auto', strokeWidth: 1 } : {}),
      },
    };
  }

  /** Converts a type label to a deterministic hex colour using HSL hashing. */
  private hashHex(label: string): string {
    let hash = 0;
    for (let i = 0; i < label.length; i++) {
      hash = ((hash << 5) - hash) + label.charCodeAt(i);
      hash |= 0;
    }
    const h = Math.abs(hash) % 360;
    // hsl(h, 70%, 55%) → hex
    const s = 0.7, l = 0.55;
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return '#' + [f(0), f(8), f(4)]
      .map(x => Math.round(x * 255).toString(16).padStart(2, '0'))
      .join('');
  }
}
