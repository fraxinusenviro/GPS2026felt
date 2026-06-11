// NS - REST - ALL: full catalogue of Nova Scotia GeoNOVA ArcGIS REST layers
// (nsgiwa.novascotia.ca). Generated from a service crawl — every queryable
// layer is exposed as an nshn-vector def (GeoJSON query endpoint) and every
// non-queryable / point layer as a raster def (MapServer export endpoint).
// These defs appear only in the Data Library (not the basemap palette).

import type { BasemapDef } from '../types';
import rawDefs from './nsRestAll.json';

export const NS_REST_ALL_GROUP = 'NS - REST - ALL';

export const NS_REST_ALL_DEFS: BasemapDef[] = rawDefs as unknown as BasemapDef[];
