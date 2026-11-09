import { WORKSPACE_DDL, WORKSPACE_UPSERT, type WorkspaceBody } from "@/lib/case-persistence";

type PgClient = {
  connect: () => Promise<void>;
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<void>;
};

let ready: Promise<void> | null = null;

async function client(): Promise<PgClient> {
  const url = process.env.DATABASE_URL;
  if (!url || !/^postgres(ql)?:\/\//i.test(url)) throw new Error("postgres URL required");
  const { Client } = await import("pg");
  const connection = new Client({ connectionString: url, connectionTimeoutMillis: 4000 }) as unknown as PgClient;
  await connection.connect();
  return connection;
}

async function ensure(connection: PgClient) {
  if (!ready) {
    ready = connection.query(WORKSPACE_DDL).then(() => undefined).catch((error) => {
      ready = null;
      throw error;
    });
  }
  await ready;
}

export async function readCaseWorkspace(caseId: number) {
  const connection = await client();
  try {
    await ensure(connection);
    const result = await connection.query(
      "SELECT payload, snapshot_as_of, updated_at FROM sentinel_case_workspace WHERE case_id = $1",
      [caseId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      payload: row.payload as WorkspaceBody,
      snapshotAsOf: String(row.snapshot_as_of),
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    };
  } finally {
    await connection.end();
  }
}

export async function writeCaseWorkspace(caseId: number, snapshotAsOf: string, record: WorkspaceBody) {
  const connection = await client();
  try {
    await ensure(connection);
    await connection.query(WORKSPACE_UPSERT, [caseId, snapshotAsOf, JSON.stringify(record)]);
  } finally {
    await connection.end();
  }
}
