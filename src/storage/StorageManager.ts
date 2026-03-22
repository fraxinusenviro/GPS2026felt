import { openDB, type IDBPDatabase } from 'idb';
import type {
  FieldFeature, AppSettings, TypePreset, LayerPreset,
  SavedConnection, ImportedLayer, OnlineLayer
} from '../types';
import {
  DB_NAME, DB_VERSION,
  STORE_FEATURES, STORE_SETTINGS, STORE_PRESETS,
  STORE_LAYERS, STORE_CONNECTIONS, STORE_IMPORTED,
  STORE_TILES, STORE_ONLINE_LAYERS,
  DEFAULT_SETTINGS, DEFAULT_LAYER_PRESETS, DEFAULT_CONNECTIONS
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
      upgrade(db, oldVersion) {
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

        if (oldVersion < 2) {
          // Migration placeholder for future versions
        }
      }
    });

    // Seed defaults if first run
    await this.seedDefaults();
  }

  private async seedDefaults(): Promise<void> {
    // Seed settings
    const existingSettings = await this.getSetting('app_settings');
    if (!existingSettings) {
      await this.saveSetting('app_settings', DEFAULT_SETTINGS);
    }

    // Seed layer presets
    const existingLayers = await this.getAllLayerPresets();
    if (existingLayers.length === 0) {
      for (const lp of DEFAULT_LAYER_PRESETS) {
        await this.db.put(STORE_LAYERS, lp);
        for (const tp of lp.types) {
          await this.db.put(STORE_PRESETS, tp);
        }
      }
    }

    // Purge stale seeded connections no longer in DEFAULT_CONNECTIONS
    // (removes NS DNRR Forestry entries added in a previous session)
    const allConns = await this.getAllConnections();
    const defaultIds = new Set(DEFAULT_CONNECTIONS.map(c => c.id));
    for (const conn of allConns) {
      if (conn.id.startsWith('ns-for-') && !defaultIds.has(conn.id)) {
        await this.db.delete(STORE_CONNECTIONS, conn.id);
      }
    }

    // Seed connections — merge new defaults by ID so existing users get new entries
    const existingConns = await this.getAllConnections();
    const existingIds = new Set(existingConns.map(c => c.id));
    for (const conn of DEFAULT_CONNECTIONS) {
      if (!existingIds.has(conn.id)) {
        await this.db.put(STORE_CONNECTIONS, conn);
      }
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

  async getFeatureCount(): Promise<number> {
    return this.db.count(STORE_FEATURES);
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

  async saveLayerPreset(layer: LayerPreset): Promise<void> {
    await this.db.put(STORE_LAYERS, layer);
  }

  async deleteLayerPreset(id: string): Promise<void> {
    await this.db.delete(STORE_LAYERS, id);
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
    const layers = await this.db.getAll(STORE_IMPORTED);
    return layers;
  }

  async saveImportedLayer(layer: ImportedLayer): Promise<void> {
    await this.db.put(STORE_IMPORTED, layer);
  }

  async deleteImportedLayer(id: string): Promise<void> {
    await this.db.delete(STORE_IMPORTED, id);
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

  // ---- Online Layers ----
  async getAllOnlineLayers(): Promise<OnlineLayer[]> {
    return this.db.getAll(STORE_ONLINE_LAYERS);
  }

  async saveOnlineLayer(layer: OnlineLayer): Promise<void> {
    await this.db.put(STORE_ONLINE_LAYERS, layer);
  }

  async deleteOnlineLayer(id: string): Promise<void> {
    await this.db.delete(STORE_ONLINE_LAYERS, id);
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
