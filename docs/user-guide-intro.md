# Fraxinus Field Mapper — Introduction & Quick-Start Guide

*A brief overview for staff. A comprehensive in-app manual is coming soon.*

---

## What Is Fraxinus Field Mapper?

Fraxinus Field Mapper is a browser-based mapping app built for environmental fieldwork. It runs on any phone, tablet, or laptop — no installation required — and works fully offline once loaded. Staff use it to capture GPS locations, sketch features on a map, record photos and notes, and export data to standard GIS formats. All data is saved locally on your device first; optional cloud sync lets the team share edits in real time when connected.

> **[SCREENSHOT — Full app view on a phone: map canvas, toolbar, coordinate display in header]**

---

## Getting Started

### 1. Open the App
Navigate to the app URL in your browser (Chrome or Safari recommended). On first load, enter your team PIN or sign in with your Fraxinus email address.

### 2. Install to Your Home Screen (Recommended)
For the best field experience — including offline access — install the app to your device:

- **iPhone/iPad**: Tap the Share button in Safari → *Add to Home Screen*
- **Android**: Tap the three-dot menu in Chrome → *Add to Home Screen* (or *Install App*)
- **Desktop (Chrome/Edge)**: Click the install icon in the address bar

Once installed, the app opens full-screen and caches itself and map tiles for offline use.

> **[SCREENSHOT — iOS "Add to Home Screen" prompt]**

### 3. App Layout at a Glance

| Area | What's There |
|------|-------------|
| Top bar | Settings (left), project switcher, coordinate display, GPS accuracy badge |
| Left toolbar | Tools for capturing data, managing layers, importing/exporting |
| Map canvas | Interactive map — pinch/scroll to zoom, tap to interact |
| Right panels | Slide-in panels for settings, feature editing, export, etc. |

> **[SCREENSHOT — Annotated app layout with callouts for each area]**

---

## Core Features

### Capturing Field Data

**GPS Point** — Tap the GPS Point button in the toolbar to drop a point at your current location. The app records your coordinates, elevation, accuracy, and timestamp automatically.

**GPS Streaming** — Tap GPS Stream, then walk a line or boundary. The app traces your path in real time. Tap again to finish. Ideal for transects, fence lines, and polygon boundaries.

**Sketch** — When GPS isn't needed (or available), use the sketch tools to draw points, lines, or polygons directly on the map by hand. A simplification slider lets you smooth out hand-drawn lines.

> **[SCREENSHOT — Toolbar with GPS Point, GPS Stream, and Sketch buttons highlighted]**

---

### Adding Details to a Feature

After capturing a feature, a panel slides in on the right to fill in details:

- **Feature type** — select from the presets configured for your project (e.g., Plot, Transect, Observation)
- **Description & notes** — free-text fields for anything relevant
- **Photos** — tap to attach one or more photos from your device camera or gallery

Every feature is also auto-stamped with: coordinates, elevation, GPS accuracy, timestamp, and your initials (set once in Settings).

> **[SCREENSHOT — Feature editor panel with type selector, notes field, and photo button]**

---

### Working with the Map

**Basemaps** — Switch between satellite imagery, topographic, street, and several specialty maps using the layers icon. Opacity is adjustable per layer.

**Reference Layers** — The built-in data library includes dozens of pre-configured Nova Scotia datasets: watercourses, wetlands, property parcels (PID lookup), parks, protected areas, habitat layers, crown land, and more. Add them with a tap.

**Import Your Own Data** — Drag and drop (or browse to) a file to load it as a reference layer. Supported formats: GeoJSON, Shapefile (.zip), KML, GPX, MBTiles.

**Coordinate Display** — Your current map-centre coordinates (Decimal Degrees and UTM) are always shown in the top bar. Tap the GPS accuracy badge (top right) to see satellite signal details.

> **[SCREENSHOT — Layer panel open with a reference layer toggled on]**

---

### Projects

Data is organized into **projects**. Each project has its own set of features, layer configurations, and feature-type presets tailored to that job.

- Tap the project name in the top bar to switch projects or create a new one
- Each project can have a different default basemap, layer stack, and preset feature types
- Your collected data stays separate per project

> **[SCREENSHOT — Project switcher panel]**

---

### Exporting Data

When you're ready to share or archive your data, tap the Export button in the toolbar:

- Choose which features to include (all, or a selection)
- Pick a format: **GeoJSON**, **Shapefile**, **KML**, or **CSV**
- The file downloads directly to your device

**Felt.com** — For online team collaboration, use the Felt export to upload your data directly to a shared Felt map with colour-coded symbology.

> **[SCREENSHOT — Export panel with format options]**

---

### Wetland Delineation (Specialist Workflow)

For wetland survey staff, the app includes a dedicated delineation workflow:

- Open a wetland plot feature to access the full survey form (matches the WETLANDS app schema): site metadata, hydrology, vegetation strata, and soil indicators
- Generate a formatted **PDF report** for each plot from within the app
- Export all wetland plots across projects in a single master export

> **[SCREENSHOT — Wetland survey form showing hydrology and vegetation sections]**

---

## Working Offline

Fraxinus Field Mapper is built to work without a connection in the field:

- The app itself, your data, and recently viewed map tiles are all cached on your device
- You can capture, edit, and review features with no signal
- When you return to connectivity, any pending cloud sync will run automatically in the background
- An offline indicator appears in the top bar if the network is unavailable

> **Tip:** Before heading into the field, open the app while connected and pan around your working area to cache the map tiles for that region.

---

## Tips for Field Use

- **GPS accuracy badge** — the coloured dot in the top right shows fix quality. Green = good; yellow = marginal; red = poor. Tap it for satellite details. Wait for green before capturing important points.
- **Screen-on lock** — enable *Keep Screen On* in Settings so the display doesn't sleep mid-traverse.
- **Outdoor mode** — enable *Outdoor Mode* in Settings to reduce brightness and improve screen visibility in direct sunlight.
- **Undo** — made a mistake? The undo button in the toolbar steps back through recent edits.

---

## Getting Help

Contact [your project lead / IT support] for access, PIN resets, or technical issues.

*A comprehensive in-app manual covering all features in detail is currently in development and will be added as a Help section within the app.*
