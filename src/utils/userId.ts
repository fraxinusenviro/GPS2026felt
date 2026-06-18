/**
 * Helpers for the "User" identity (user_id) — the short code stamped onto
 * captured features (created_by) and point IDs (e.g. IB_2026_05_01_1241).
 */

/** localStorage flag: set when user_id was derived from the Cloudflare login. */
export const USERID_SOURCE_KEY = 'ffm_userid_source';

/** Normalize a raw value to the user_id format: A–Z/0–9, uppercase, max 10. */
export function normalizeUserId(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
}

/**
 * Derive a user_id from an email address by taking the local part (before the
 * @) and normalizing it, e.g. `ibryson@fraxinusenviro.com` → `IBRYSON`.
 */
export function userIdFromEmail(email: string): string {
  const prefix = email.split('@')[0] ?? '';
  return normalizeUserId(prefix);
}
