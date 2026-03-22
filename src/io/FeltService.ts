// ============================================================
// Felt API Service
// https://developers.felt.com/rest-api
// ============================================================

const FELT_API = 'https://felt.com/api/v2';

export interface FeltProject {
  id: string;
  title: string;
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

  /** Validates the API key by fetching the workspace list. Returns workspace name. */
  async validateKey(): Promise<string> {
    const res = await fetch(`${FELT_API}/workspaces`, { headers: this.headers });
    if (res.status === 401 || res.status === 403) throw new Error('Invalid API key');
    if (!res.ok) throw new Error(`Felt API error (${res.status})`);
    const data = await res.json();
    const workspaces: { name?: string; slug?: string }[] =
      data.workspaces ?? data.data ?? (Array.isArray(data) ? data : []);
    const ws = workspaces[0];
    return ws?.name ?? ws?.slug ?? 'Workspace';
  }

  /** Lists all projects accessible with this API key. */
  async getProjects(): Promise<FeltProject[]> {
    const res = await fetch(`${FELT_API}/projects`, { headers: this.headers });
    if (!res.ok) throw new Error(`Failed to load projects (${res.status})`);
    const data = await res.json();
    const raw: { id: string; title?: string; name?: string }[] =
      data.projects ?? data.data ?? (Array.isArray(data) ? data : []);
    return raw.map(p => ({ id: p.id, title: p.title ?? p.name ?? p.id }));
  }

  /** Lists maps, optionally filtered to a specific project. */
  async getMaps(projectId?: string): Promise<FeltMap[]> {
    const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
    const res = await fetch(`${FELT_API}/maps${qs}`, { headers: this.headers });
    if (!res.ok) throw new Error(`Failed to load maps (${res.status})`);
    const data = await res.json();
    const raw: { id: string; title?: string; url?: string }[] =
      data.maps ?? data.data ?? (Array.isArray(data) ? data : []);
    return raw.map(m => ({ id: m.id, title: m.title ?? m.id, url: m.url ?? '' }));
  }

  /** Creates a new map, optionally within a project. */
  async createMap(title: string, projectId?: string): Promise<FeltMap> {
    const body: Record<string, unknown> = { title };
    if (projectId) body.project_id = projectId;

    const res = await fetch(`${FELT_API}/maps`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create map: ${text}`);
    }
    const data = await res.json();
    const m = data.map ?? data;
    return { id: m.id, title: m.title ?? title, url: m.url ?? '' };
  }

  /**
   * Uploads a GeoJSON string to a Felt map as a new layer.
   * Uses the two-step presigned S3 upload flow.
   */
  async uploadGeoJSON(mapId: string, geojsonStr: string, layerName: string): Promise<void> {
    const fileName = `${layerName.replace(/[^a-z0-9_-]/gi, '_')}.geojson`;

    // Step 1 — create layer & get presigned S3 upload URL
    const initRes = await fetch(`${FELT_API}/maps/${mapId}/layers`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ file_name: fileName, name: layerName }),
    });

    if (!initRes.ok) {
      const text = await initRes.text();
      throw new Error(`Upload init failed (${initRes.status}): ${text}`);
    }

    const initData = await initRes.json();

    // Response shape varies; handle both single-layer and layer_group wrappers
    const presigned: { url: string; fields: Record<string, string> } | undefined =
      initData.presigned_attributes ??
      initData.layer_group?.presigned_attributes ??
      initData.layer_group?.layers?.[0]?.presigned_attributes ??
      initData.layers?.[0]?.presigned_attributes;

    if (!presigned) {
      throw new Error('Felt API did not return a presigned upload URL. Check API key permissions.');
    }

    // Step 2 — multipart POST to S3
    const formData = new FormData();
    for (const [k, v] of Object.entries(presigned.fields)) {
      formData.append(k, v);
    }
    formData.append('file', new Blob([geojsonStr], { type: 'application/geo+json' }), fileName);

    const s3Res = await fetch(presigned.url, { method: 'POST', body: formData });
    // S3 returns 204 No Content on success, sometimes 200
    if (!s3Res.ok && s3Res.status !== 204) {
      throw new Error(`S3 upload failed (${s3Res.status})`);
    }
  }
}
