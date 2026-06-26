import { v4 as uuidv4 } from 'uuid';
import type { FieldFeature, PhotoPointData } from '../types';

/** Build the canonical "USER_YYYY_MM_DD_HHMM" point id from a timestamp. */
export function generatePointId(userId: string, when: Date = new Date()): string {
  const y = when.getFullYear();
  const mo = String(when.getMonth() + 1).padStart(2, '0');
  const d = String(when.getDate()).padStart(2, '0');
  const h = String(when.getHours()).padStart(2, '0');
  const mi = String(when.getMinutes()).padStart(2, '0');
  return `${userId}_${y}_${mo}_${d}_${h}${mi}`;
}

export interface PhotoFeatureInput {
  photoDataUrl: string;
  lat: number;
  lon: number;
  elevation: number | null;
  accuracy: number | null;
  bearing: number;
  observer: string;
  notes: string;
  caption: string;
  /** Where the location/bearing came from. */
  source: 'gps' | 'exif';
  /** Capture instant (ISO); defaults to now. */
  createdAt?: string;
  projectId: string;
  layerId: string;
}

/** Assemble a Photo Point FieldFeature ready to persist. */
export function buildPhotoFeature(input: PhotoFeatureInput): FieldFeature {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const when = new Date(createdAt);
  const creator = input.observer || 'USER';

  const photoData: PhotoPointData = {
    bearing: Math.round(((input.bearing % 360) + 360) % 360),
    observer: input.observer,
    source: input.source,
  };
  if (input.caption.trim()) photoData.caption = input.caption.trim();

  return {
    id: uuidv4(),
    point_id: generatePointId(creator, isNaN(when.getTime()) ? new Date() : when),
    type: 'Photo Point',
    desc: input.notes,
    geometry_type: 'Point',
    geometry: {
      type: 'Point',
      coordinates: input.elevation != null
        ? [input.lon, input.lat, input.elevation]
        : [input.lon, input.lat],
    },
    capture_method: 'gps',
    created_at: createdAt,
    updated_at: new Date().toISOString(),
    created_by: creator,
    lat: input.lat,
    lon: input.lon,
    elevation: input.elevation,
    accuracy: input.accuracy,
    layer_id: input.layerId,
    project_id: input.projectId,
    notes: input.notes,
    photos: [input.photoDataUrl],
    photo_data: photoData,
  };
}
