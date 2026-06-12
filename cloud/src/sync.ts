/**
 * Sync engine: POST /sync (push) and GET /changes?since= (pull).
 *
 * Conflict resolution is last-write-wins on the client `updated_at` (ISO 8601,
 * lexically sortable). Every applied write gets a server-assigned `rev` from the
 * global sync_seq, and /changes streams rows with rev > cursor in rev order, so
 * a client can pull incrementally with a single integer cursor.
 */

import type { Env, Identity, SyncEntity, EntityKind } from './types';
import { ENTITY_KINDS, TABLES } from './types';
import { json, bad } from './http';

interface SyncBody {
  projects?: SyncEntity[];
  features?: SyncEntity[];
  layer_presets?: SyncEntity[];
  type_presets?: SyncEntity[];
}

/** Reserve a contiguous block of `count` rev numbers; returns the first rev. */
async function reserveRevs(env: Env, count: number): Promise<number> {
  const row = await env.DB.prepare('UPDATE sync_seq SET value = value + ?1 WHERE id = 0 RETURNING value')
    .bind(count)
    .first<{ value: number }>();
  if (!row) throw new Error('sync_seq missing (run migrations)');
  return row.value - count + 1; // first rev of the reserved block
}

export async function handleSync(request: Request, env: Env, who: Identity): Promise<Response> {
  const body = (await request.json().catch(() => null)) as SyncBody | null;
  if (!body || typeof body !== 'object') return bad('expected a JSON object of entity arrays');

  // Flatten every incoming entity, tagged with its kind, preserving order.
  const items: Array<{ kind: EntityKind; e: SyncEntity }> = [];
  for (const kind of ENTITY_KINDS) {
    const arr = body[kind];
    if (arr == null) continue;
    if (!Array.isArray(arr)) return bad(`${kind} must be an array`);
    for (const e of arr) {
      if (e && typeof e.id === 'string') items.push({ kind, e });
    }
  }
  if (items.length === 0) return json({ applied: emptyCounts(), skipped: 0, rev: await currentRev(env) });

  const firstRev = await reserveRevs(env, items.length);
  const nowIso = new Date().toISOString();

  const statements: D1PreparedStatement[] = [];
  items.forEach(({ kind, e }, i) => {
    const cfg = TABLES[kind];
    const rev = firstRev + i;
    const updatedAt = typeof e.updated_at === 'string' ? e.updated_at : nowIso;
    const promoted = cfg.promote(e);

    const cols = ['id', ...cfg.extraColumns, 'doc', 'updated_at', 'updated_by', 'deleted', 'rev'];
    const values: unknown[] = [
      e.id,
      ...cfg.extraColumns.map((c) => promoted[c] ?? null),
      JSON.stringify(e),
      updatedAt,
      who.email,
      e.deleted ? 1 : 0,
      rev,
    ];
    const placeholders = cols.map((_, n) => `?${n + 1}`).join(', ');
    // last-write-wins: only overwrite when the incoming row is newer-or-equal.
    const updates = cols
      .filter((c) => c !== 'id')
      .map((c) => `${c} = excluded.${c}`)
      .join(', ');
    const sql =
      `INSERT INTO ${cfg.table} (${cols.join(', ')}) VALUES (${placeholders}) ` +
      `ON CONFLICT(id) DO UPDATE SET ${updates} WHERE excluded.updated_at >= ${cfg.table}.updated_at`;
    statements.push(env.DB.prepare(sql).bind(...values));
  });

  const results = await env.DB.batch(statements);

  const applied = emptyCounts();
  let appliedTotal = 0;
  items.forEach(({ kind }, i) => {
    if ((results[i]?.meta.changes ?? 0) > 0) {
      applied[kind]++;
      appliedTotal++;
    }
  });

  return json({
    applied,
    skipped: items.length - appliedTotal,
    received: items.length,
    rev: firstRev + items.length - 1,
  });
}

export async function handleChanges(url: URL, env: Env): Promise<Response> {
  const since = Number(url.searchParams.get('since') ?? '0') || 0;
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '1000') || 1000, 5000);

  const out: Record<string, unknown[]> = {};
  let cursor = since;

  for (const kind of ENTITY_KINDS) {
    const cfg = TABLES[kind];
    const { results } = await env.DB.prepare(
      `SELECT doc, updated_at, deleted, rev FROM ${cfg.table} WHERE rev > ?1 ORDER BY rev ASC LIMIT ?2`
    )
      .bind(since, limit)
      .all<{ doc: string; updated_at: string; deleted: number; rev: number }>();

    out[kind] = (results ?? []).map((r) => {
      if (r.rev > cursor) cursor = r.rev;
      return { ...JSON.parse(r.doc), updated_at: r.updated_at, deleted: !!r.deleted, rev: r.rev };
    });
  }

  const count = ENTITY_KINDS.reduce((n, k) => n + out[k].length, 0);
  return json({ since, cursor, count, ...out });
}

function emptyCounts(): Record<EntityKind, number> {
  return { projects: 0, features: 0, layer_presets: 0, type_presets: 0 };
}

async function currentRev(env: Env): Promise<number> {
  const row = await env.DB.prepare('SELECT value FROM sync_seq WHERE id = 0').first<{ value: number }>();
  return row?.value ?? 0;
}
