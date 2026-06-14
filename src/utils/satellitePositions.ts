/**
 * GPS satellite position calculator.
 *
 * Propagates Keplerian orbital elements from a Yuma almanac to the current
 * time, then converts ECEF satellite coordinates to azimuth/elevation at the
 * observer's position.
 */

import type { AlmanacSatellite } from './almanacParser';

export interface SatellitePosition {
  prn:       number;
  azimuth:   number;  // degrees, 0 = North, increasing clockwise
  elevation: number;  // degrees above horizon (negative = below horizon)
  healthy:   boolean;
}

// GPS / WGS-84 constants
const GM       = 3.986005e14;           // m³/s² — Earth gravitational constant
const OMEGA_E  = 7.2921151467e-5;       // rad/s — Earth rotation rate
const WGS84_A  = 6378137.0;            // m     — WGS-84 semi-major axis
const WGS84_E2 = 0.00669437999014;     // WGS-84 first eccentricity squared
const GPS_EPOCH_MS = Date.UTC(1980, 0, 6); // Jan 6 1980 00:00:00 UTC
const GPS_LEAP_SECONDS = 18;            // leap seconds as of December 2016

const DEG = Math.PI / 180;

/** Current GPS time in seconds (TAI-based, no leap-second steps). */
function currentGpsSeconds(): number {
  return (Date.now() - GPS_EPOCH_MS) / 1000 - GPS_LEAP_SECONDS;
}

/** Solve Kepler's equation  M = E − e·sin(E)  for eccentric anomaly E. */
function solveKepler(M: number, e: number): number {
  let E = M;
  for (let i = 0; i < 50; i++) {
    const dE = (M - (E - e * Math.sin(E))) / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

/** Observer position in ECEF (metres) from WGS-84 lat/lon (degrees). */
function observerECEF(lat: number, lon: number): [number, number, number] {
  const latR = lat * DEG;
  const lonR = lon * DEG;
  const sinLat = Math.sin(latR);
  const cosLat = Math.cos(latR);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return [
    N * cosLat * Math.cos(lonR),
    N * cosLat * Math.sin(lonR),
    N * (1 - WGS84_E2) * sinLat,
  ];
}

/** Compute azimuth and elevation of a satellite from its ECEF position. */
function ecefToAzEl(
  satX: number, satY: number, satZ: number,
  obsX: number, obsY: number, obsZ: number,
  lat: number, lon: number,
): { azimuth: number; elevation: number } {
  const dx = satX - obsX;
  const dy = satY - obsY;
  const dz = satZ - obsZ;

  const latR = lat * DEG;
  const lonR = lon * DEG;
  const sinLat = Math.sin(latR), cosLat = Math.cos(latR);
  const sinLon = Math.sin(lonR), cosLon = Math.cos(lonR);

  // Rotate ECEF delta into local East-North-Up frame
  const east  = -sinLon * dx + cosLon * dy;
  const north = -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz;
  const up    =  cosLat * cosLon * dx + cosLat * sinLon * dy + sinLat * dz;

  const elevation = Math.atan2(up, Math.sqrt(east * east + north * north)) / DEG;
  const azimuth   = ((Math.atan2(east, north) / DEG) + 360) % 360;

  return { azimuth, elevation };
}

export function computeSatellitePositions(
  sats: AlmanacSatellite[],
  lat: number,
  lon: number,
): SatellitePosition[] {
  const t   = currentGpsSeconds();
  const obs = observerECEF(lat, lon);

  return sats.map((sat) => {
    const toe = sat.week * 604800 + sat.toe;
    let dt = t - toe;
    // Clamp to nearest half-week to handle week boundary crossings
    if (dt >  302400) dt -= 604800;
    if (dt < -302400) dt += 604800;

    const a  = sat.sqrtA * sat.sqrtA;
    const n  = Math.sqrt(GM / (a * a * a));
    const M  = sat.m0 + n * dt;
    const e  = sat.eccentricity;
    const E  = solveKepler(M, e);

    // True anomaly via atan2 for correct quadrant
    const sinE = Math.sin(E), cosE = Math.cos(E);
    const nu = Math.atan2(Math.sqrt(1 - e * e) * sinE, cosE - e);

    const u  = nu + sat.w;
    const r  = a * (1 - e * cosE);

    const xOrb = r * Math.cos(u);
    const yOrb = r * Math.sin(u);

    // Right ascension of ascending node, corrected for Earth rotation
    const Omega = sat.omega0 + (sat.omegaDot - OMEGA_E) * dt - OMEGA_E * sat.toe;

    const cosO = Math.cos(Omega), sinO = Math.sin(Omega);
    const cosi = Math.cos(sat.inclination), sini = Math.sin(sat.inclination);

    const satX = xOrb * cosO - yOrb * cosi * sinO;
    const satY = xOrb * sinO + yOrb * cosi * cosO;
    const satZ = yOrb * sini;

    const { azimuth, elevation } = ecefToAzEl(satX, satY, satZ, obs[0], obs[1], obs[2], lat, lon);

    return { prn: sat.prn, azimuth, elevation, healthy: sat.health === 0 };
  });
}
