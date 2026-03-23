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

    console.log('[FeltService] Upload complete ✓', layer_group_id ? `layer_group_id: ${layer_group_id}` : '(no layer_group_id)');
    return (layer_group_id as string) ?? null;
  }

  /**
   * Lists all layers for a map.
   */
  async listLayers(mapId: string): Promise<Array<{ id: string; name: string; geometry_type?: string; layer_group_id?: string }>> {
    const res = await fetch(`${FELT_API}/maps/${mapId}/layers`, { headers: this.headers });
    if (!res.ok) throw new Error(`Failed to list layers (${res.status})`);
    const data = await res.json();
    const raw: Array<{ id: string; name?: string; geometry_type?: string; layer_group_id?: string }> =
      Array.isArray(data) ? data : (data.layers ?? data.data ?? []);
    return raw.map(l => ({ id: l.id, name: l.name ?? l.id, geometry_type: l.geometry_type, layer_group_id: l.layer_group_id }));
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
      throw new Error(`update_style failed (${res.status}): ${text}`);
    }
  }

  /**
   * Polls for layers belonging to layerGroupId (up to 6 × 2s), then applies
   * categorical FSL colouring by the `type` attribute using typeColors.
   * Errors are silently swallowed — upload success is never blocked.
   */
  async applyStyleToUploadedLayers(
    mapId: string,
    layerGroupId: string,
    typeColors: Record<string, string>,
  ): Promise<void> {
    let layers: Array<{ id: string; name: string; geometry_type?: string; layer_group_id?: string }> = [];
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const all = await this.listLayers(mapId);
        layers = all.filter(l => l.layer_group_id === layerGroupId);
        console.log(`[FeltService] Poll ${i + 1}/6 — found ${layers.length} layer(s) in group ${layerGroupId}`);
        if (layers.length > 0) break;
      } catch {
        // ignore transient errors during polling
      }
    }

    for (const layer of layers) {
      const fsl = this.buildCategoricalFSL(typeColors, layer.geometry_type ?? 'Point');
      console.log('[FeltService] Applying style to layer:', layer.id, layer.name);
      await this.updateLayerStyle(mapId, layer.id, fsl).catch(() => undefined);
    }
  }

  /**
   * Builds a Felt Style Language object for categorical colouring by `type`.
   */
  private buildCategoricalFSL(typeColors: Record<string, string>, geometryType: string): object {
    const matchExpr: unknown[] = ['match', ['get', 'type']];
    for (const [label, hex] of Object.entries(typeColors)) {
      matchExpr.push(label, hex);
    }
    matchExpr.push('#4ade80'); // fallback colour

    const isPolygon = geometryType === 'Polygon';
    const isLine    = geometryType === 'LineString';

    return {
      type: 'categorical',
      version: '2.1',
      config: { categoricalAttribute: 'type' },
      legend: {},
      paint: {
        color: matchExpr,
        opacity: isPolygon ? 0.5 : 0.9,
        ...(isLine  ? { strokeWidth: 2 } : {}),
        ...(!isLine ? { size: isPolygon ? 1 : 8, strokeColor: 'auto', strokeWidth: 1 } : {}),
      },
    };
  }
}
