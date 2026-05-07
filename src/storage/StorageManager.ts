import { openDB, type IDBPDatabase } from 'idb';
import type {
  FieldFeature, AppSettings, TypePreset, LayerPreset,
  SavedConnection, ImportedLayer, OnlineLayer, TileCacheRecord, Project
} from '../types';
import {
  DB_NAME, DB_VERSION,
  STORE_FEATURES, STORE_SETTINGS, STORE_PRESETS,
  STORE_LAYERS, STORE_CONNECTIONS, STORE_IMPORTED,
  STORE_TILES, STORE_ONLINE_LAYERS, STORE_TILE_CACHES, STORE_PROJECTS,
  DEFAULT_SETTINGS, DEFAULT_LAYER_PRESETS, DEFAULT_CONNECTIONS,
  DEFAULT_PROJECT_LAYER_PRESETS, buildDefaultProjectStack
} from '../constants';

export class StorageManager {
  private db!: IDBPDatabase;
  private static instance: StorageManager;

  static getInstance(): StorageManager {
    if (!StorageManager.instance) StorageManager.instance = new StorageManager();
    return StorageManager.instance;
  }

  async init(): Promise<void> {
    this.db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        // Features store
        if (!db.objectStoreNames.contains(STORE_FEATURES)) {
          const fs = db.createObjectStore(STORE_FEATURES, { keyPath: 'id' });
          fs.createIndex('by_type', 'type');
          fs.createIndex('by_layer', 'layer_id');
          fs.createIndex('by_geom_type', 'geometry_type');
          fs.createIndex('by_created', 'created_at');
        }
        // Settings store
        if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
          db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
        }
        // Type presets store
        if (!db.objectStoreNames.contains(STORE_PRESETS)) {
          const ps = db.createObjectStore(STORE_PRESETS, { keyPath: 'id' });
          ps.createIndex('by_geom_type', 'geometry_type');
        }
        // Layer presets
        if (!db.objectStoreNames.contains(STORE_LAYERS)) {
          db.createObjectStore(STORE_LAYERS, { keyPath: 'id' });
        }
        // Saved connections
        if (!db.objectStoreNames.contains(STORE_CONNECTIONS)) {
          db.createObjectStore(STORE_CONNECTIONS, { keyPath: 'id' });
        }
        // Imported layers
        if (!db.objectStoreNames.contains(STORE_IMPORTED)) {
          db.createObjectStore(STORE_IMPORTED, { keyPath: 'id' });
        }
        // Tile cache (for MBTiles)
        if (!db.objectStoreNames.contains(STORE_TILES)) {
          const ts = db.createObjectStore(STORE_TILES, { keyPath: 'key' });
          ts.createIndex('by_layer', 'layer_id');
        }
        // Online layers
        if (!db.objectStoreNames.contains(STORE_ONLINE_LAYERS)) {
          db.createObjectStore(STORE_ONLINE_LAYERS, { keyPath: 'id' });
        }

        if (oldVersion < 3) {
          if (!db.objectStoreNames.contains(STORE_TILE_CACHES)) {
            db.createObjectStore(STORE_TILE_CACHES, { keyPath: 'id' });
          }
        }

        if (oldVersion < 4) {
          if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
            db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
          }
          // Add by_project index to existing stores via the upgrade transaction
          const featStore = transaction.objectStore(STORE_FEATURES);
          if (!featStore.indexNames.contains('by_project')) {
            featStore.createIndex('by_project', 'project_id');
          }
          const layerStore = transaction.objectStore(STORE_LAYERS);
          if (!layerStore.indexNames.contains('by_project')) {
            layerStore.createIndex('by_project', 'project_id');
          }
          const importedStore = transaction.objectStore(STORE_IMPORTED);
          if (!importedStore.indexNames.contains('by_project')) {
            importedStore.createIndex('by_project', 'project_id');
          }
        }
      }
    });

    await this.seedDefaults();
  }

  private async seedDefaults(): Promise<void> {
    const now = new Date().toISOString();

    // Seed / patch settings
    const existingSettings = await this.getSetting('app_settings');
    if (!existingSettings) {
      await this.saveSetting('app_settings', DEFAULT_SETTINGS);
    } else if (!existingSettings.active_project_id) {
      existingSettings.active_project_id = 'default';
      await this.saveSetting('app_settings', existingSettings);
    }

    // --- Data migration: stamp project_id: 'default' on legacy records ---
    const orphanFeatures = (await this.db.getAll(STORE_FEATURES)).filter((f: FieldFeature) => !f.project_id);
    for (const f of orphanFeatures) await this.db.put(STORE_FEATURES, { ...f, project_id: 'default' });

    const orphanLayers = (await this.db.getAll(STORE_LAYERS)).filter((l: LayerPreset) => !l.project_id);
    for (const l of orphanLayers) await this.db.put(STORE_LAYERS, { ...l, project_id: 'default', visible: true });

    const orphanImported = (await this.db.getAll(STORE_IMPORTED)).filter((l: ImportedLayer) => !l.project_id);
    for (const l of orphanImported) await this.db.put(STORE_IMPORTED, { ...l, project_id: 'default' });

    // --- Seed 'default' project record ---
    if (!(await this.getProject('default'))) {
      const settings = await this.getAppSettings();
      const currentStack = localStorage.getItem('fm2026_bm_stack') ?? buildDefaultProjectStack();
      const defaultProject: Project = {
        id: 'default',
        name: 'Default Project',
        description: '',
        created_at: now,
        updated_at: now,
        default_layer_id: settings.default_layer_id || 'default',
        basemap_stack_json: currentStack,
        map_center: [-63.5, 45.0],
        map_zoom: 10,
      };
      await this.saveProject(defaultProject);
    }

    // --- Seed layer presets — merge new defaults by ID ---
    const existingLayers = await this.getAllLayerPresets();
    const existingLayerIds = new Set(existingLayers.map(l => l.id));
    for (const lp of DEFAULT_LAYER_PRESETS) {
      if (!existingLayerIds.has(lp.id)) {
        await this.db.put(STORE_LAYERS, { ...lp, project_id: 'default', visible: true });
        for (const tp of lp.types) await this.db.put(STORE_PRESETS, tp);
      }
    }

    // --- Seed 3 default project layer presets for 'default' project ---
    const defaultProjectLayers = DEFAULT_PROJECT_LAYER_PRESETS('default');
    for (const lp of defaultProjectLayers) {
      if (!existingLayerIds.has(lp.id)) {
        await this.db.put(STORE_LAYERS, lp);
      }
    }

    // --- Purge stale seeded connections ---
    const allConns = await this.getAllConnections();
    const defaultIds = new Set(DEFAULT_CONNECTIONS.map(c => c.id));
    for (const conn of allConns) {
      if (conn.id.startsWith('ns-for-') && !defaultIds.has(conn.id)) {
        await this.db.delete(STORE_CONNECTIONS, conn.id);
      }
    }

    // --- Seed connections by ID ---
    const existingConns = await this.getAllConnections();
    const existingConnIds = new Set(existingConns.map(c => c.id));
    for (const conn of DEFAULT_CONNECTIONS) {
      if (!existingConnIds.has(conn.id)) await this.db.put(STORE_CONNECTIONS, conn);
    }
  }

  // ---- Settings ----
  async getSetting(key: string): Promise<AppSettings | null> {
    const record = await this.db.get(STORE_SETTINGS, key);
    return record ? record.value : null;
  }

  async saveSetting(key: string, value: AppSettings): Promise<void> {
    await this.db.put(STORE_SETTINGS, { key, value });
  }

  async getAppSettings(): Promise<AppSettings> {
    const settings = await this.getSetting('app_settings');
    return settings ?? { ...DEFAULT_SETTINGS };
  }

  async saveAppSettings(settings: AppSettings): Promise<void> {
    await this.saveSetting('app_settings', settings);
  }

  // ---- Features ----
  async saveFeature(feature: FieldFeature): Promise<void> {
    feature.updated_at = new Date().toISOString();
    await this.db.put(STORE_FEATURES, feature);
  }

  async getFeature(id: string): Promise<FieldFeature | undefined> {
    return this.db.get(STORE_FEATURES, id);
  }

  async getAllFeatures(): Promise<FieldFeature[]> {
    return this.db.getAll(STORE_FEATURES);
  }

  async getFeaturesByProject(projectId: string): Promise<FieldFeature[]> {
    return this.db.getAllFromIndex(STORE_FEATURES, 'by_project', projectId);
  }

  async deleteFeature(id: string): Promise<void> {
    await this.db.delete(STORE_FEATURES, id);
  }

  async getFeaturesByLayer(layerId: string): Promise<FieldFeature[]> {
    return this.db.getAllFromIndex(STORE_FEATURES, 'by_layer', layerId);
  }

  async getFeaturesByGeomType(geomType: string): Promise<FieldFeature[]> {
    return this.db.getAllFromIndex(STORE_FEATURES, 'by_geom_type', geomType);
  }

  async clearAllFeatures(): Promise<void> {
    await this.db.clear(STORE_FEATURES);
  }

  async deleteFeaturesByProject(projectId: string): Promise<void> {
    const tx = this.db.transaction(STORE_FEATURES, 'readwrite');
    const index = tx.store.index('by_project');
    let cursor = await index.openCursor(projectId);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  }

  async getFeatureCount(): Promise<number> {
    return this.db.count(STORE_FEATURES);
  }

  async getProjectFeatureCount(projectId: string): Promise<number> {
    return this.db.countFromIndex(STORE_FEATURES, 'by_project', projectId);
  }

  // ---- Presets ----
  async getAllTypePresets(): Promise<TypePreset[]> {
    return this.db.getAll(STORE_PRESETS);
  }

  async saveTypePreset(preset: TypePreset): Promise<void> {
    await this.db.put(STORE_PRESETS, preset);
  }

  async deleteTypePreset(id: string): Promise<void> {
    await this.db.delete(STORE_PRESETS, id);
  }

  async getAllLayerPresets(): Promise<LayerPreset[]> {
    return this.db.getAll(STORE_LAYERS);
  }

  async getLayersByProject(projectId: string): Promise<LayerPreset[]> {
    return this.db.getAllFromIndex(STORE_LAYERS, 'by_project', projectId);
  }

  async saveLayerPreset(layer: LayerPreset): Promise<void> {
    await this.db.put(STORE_LAYERS, layer);
  }

  async deleteLayerPreset(id: string): Promise<void> {
    await this.db.delete(STORE_LAYERS, id);
  }

  async deleteLayersByProject(projectId: string): Promise<void> {
    const tx = this.db.transaction(STORE_LAYERS, 'readwrite');
    const index = tx.store.index('by_project');
    let cursor = await index.openCursor(projectId);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  }

  // ---- Connections ----
  async getAllConnections(): Promise<SavedConnection[]> {
    return this.db.getAll(STORE_CONNECTIONS);
  }

  async saveConnection(conn: SavedConnection): Promise<void> {
    await this.db.put(STORE_CONNECTIONS, conn);
  }

  async deleteConnection(id: string): Promise<void> {
    await this.db.delete(STORE_CONNECTIONS, id);
  }

  // ---- Imported Layers ----
  async getAllImportedLayers(): Promise<ImportedLayer[]> {
    return this.db.getAll(STORE_IMPORTED);
  }

  async getImportedLayersByProject(projectId: string): Promise<ImportedLayer[]> {
    return this.db.getAllFromIndex(STORE_IMPORTED, 'by_project', projectId);
  }

  async saveImportedLayer(layer: ImportedLayer): Promise<void> {
    await this.db.put(STORE_IMPORTED, layer);
  }

  async deleteImportedLayer(id: string): Promise<void> {
    await this.db.delete(STORE_IMPORTED, id);
  }

  async deleteImportedLayersByProject(projectId: string): Promise<void> {
    const tx = this.db.transaction(STORE_IMPORTED, 'readwrite');
    const index = tx.store.index('by_project');
    let cursor = await index.openCursor(projectId);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  }

  // ---- Tile Cache (MBTiles) ----
  async saveTile(layerId: string, z: number, x: number, y: number, data: Blob): Promise<void> {
    const key = `${layerId}/${z}/${x}/${y}`;
    await this.db.put(STORE_TILES, { key, layer_id: layerId, z, x, y, data });
  }

  async getTile(layerId: string, z: number, x: number, y: number): Promise<Blob | null> {
    const key = `${layerId}/${z}/${x}/${y}`;
    const record = await this.db.get(STORE_TILES, key);
    return record ? record.data : null;
  }

  async clearTilesForLayer(layerId: string): Promise<void> {
    const tx = this.db.transaction(STORE_TILES, 'readwrite');
    const index = tx.store.index('by_layer');
    let cursor = await index.openCursor(layerId);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  }

  // ---- Online Layers (global — not project-scoped) ----
  async getAllOnlineLayers(): Promise<OnlineLayer[]> {
    return this.db.getAll(STORE_ONLINE_LAYERS);
  }

  async saveOnlineLayer(layer: OnlineLayer): Promise<void> {
    await this.db.put(STORE_ONLINE_LAYERS, layer);
  }

  async deleteOnlineLayer(id: string): Promise<void> {
    await this.db.delete(STORE_ONLINE_LAYERS, id);
  }

  // ---- Tile Cache metadata ----
  async saveCache(record: TileCacheRecord): Promise<void> {
    await this.db.put(STORE_TILE_CACHES, record);
  }

  async getAllCaches(): Promise<TileCacheRecord[]> {
    return this.db.getAll(STORE_TILE_CACHES);
  }

  async getCacheById(id: string): Promise<TileCacheRecord | undefined> {
    return this.db.get(STORE_TILE_CACHES, id);
  }

  async deleteCache(id: string): Promise<void> {
    await this.db.delete(STORE_TILE_CACHES, id);
  }

  // ---- Projects ----
  async saveProject(project: Project): Promise<void> {
    await this.db.put(STORE_PROJECTS, project);
  }

  async getAllProjects(): Promise<Project[]> {
    return this.db.getAll(STORE_PROJECTS);
  }

  async getProject(id: string): Promise<Project | undefined> {
    return this.db.get(STORE_PROJECTS, id);
  }

  async deleteProject(id: string): Promise<void> {
    await this.db.delete(STORE_PROJECTS, id);
  }

  // ---- Export all data for backup ----
  async exportAllData(): Promise<string> {
    const features = await this.getAllFeatures();
    const settings = await this.getAppSettings();
    const presets = await this.getAllTypePresets();
    const layers = await this.getAllLayerPresets();

    return JSON.stringify({
      version: DB_VERSION,
      exported_at: new Date().toISOString(),
      features,
      settings,
      presets,
      layers
    }, null, 2);
  }
}
