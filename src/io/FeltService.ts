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
  async uploadGeoJSON(mapId: string, geojsonStr: string, layerName: string): Promise<void> {
    const fileName = `${layerName.replace(/[^a-z0-9_-]/gi, '_')}.geojson`;

    // Step 1: Request presigned S3 URL from Felt
    const feltRes = await fetch(`${FELT_API}/maps/${mapId}/upload`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ name: layerName }),
    });

    if (!feltRes.ok) {
      const text = await feltRes.text();
      throw new Error(`Felt upload init failed (${feltRes.status}): ${text}`);
    }

    const { url, presigned_attributes } = await feltRes.json();

    if (!url || !presigned_attributes) {
      throw new Error('Felt API did not return presigned upload details — check API key permissions.');
    }

    // Step 2: POST file to S3 (file field MUST be appended last per AWS requirements)
    const formData = new FormData();
    for (const [k, v] of Object.entries(presigned_attributes as Record<string, string>)) {
      formData.append(k, v);
    }
    formData.append('file', new Blob([geojsonStr], { type: 'application/geo+json' }), fileName);

    const s3Res = await fetch(url, { method: 'POST', body: formData });
    if (s3Res.status !== 204) {
      const s3Body = await s3Res.text();
      throw new Error(`S3 upload failed (${s3Res.status}): ${s3Body}`);
    }
  }
}
