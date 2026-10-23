import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// Coolify healthcheck endpoint — GET /api/health
// Returns 200 + {"status":"ok"} when the app is up and the DB is reachable.
// Coolify will poll this instead of relying on container liveness alone.
export const dynamic = 'force-dynamic';

export function GET() {
  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    return NextResponse.json({ status: 'ok', db: 'reachable' });
  } catch (err) {
    return NextResponse.json(
      { status: 'error', db: 'unreachable', detail: String(err) },
      { status: 503 }
    );
  }
}