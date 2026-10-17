import { odata, RestError, TableClient, TableServiceClient, type TransactionAction } from '@azure/data-tables';
import type { TokenCredential } from '@azure/identity';
import type { FlashRow, TableStore } from './store.js';

/** Holds one row: the newest GLM file end time, for the display's staleness check. */
const STATUS_TABLE = 'boltstatus';
const STATUS_PARTITION = 'glm';
const STATUS_ROW = 'latest';

function isStatus(error: unknown, status: number): boolean {
  return error instanceof RestError && error.statusCode === status;
}

/** TableStore on Azure Table Storage, signed in with a managed identity (no account keys). */
export class AzureTableStore implements TableStore {
  private readonly service: TableServiceClient;
  private readonly created = new Set<string>();

  constructor(
    private readonly endpoint: string,
    private readonly credential: TokenCredential,
  ) {
    this.service = new TableServiceClient(endpoint, credential);
  }

  private table(name: string): TableClient {
    return new TableClient(this.endpoint, name, this.credential);
  }

  private async ensureTable(name: string): Promise<void> {
    if (this.created.has(name)) return;
    try {
      await this.service.createTable(name);
    } catch (error) {
      if (!isStatus(error, 409)) throw error; // already exists
    }
    this.created.add(name);
  }

  async upsertPartition(table: string, partitionKey: string, rows: FlashRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.ensureTable(table);
    const actions: TransactionAction[] = rows.map((row) => [
      'upsert',
      {
        partitionKey,
        rowKey: row.rowKey,
        id: row.id,
        timeMs: row.timeMs,
        lat: row.lat,
        lon: row.lon,
        fileStartMs: row.fileStartMs,
      },
      'Replace',
    ]);
    await this.table(table).submitTransaction(actions);
  }

  async queryPartition(table: string, partitionKey: string, fromRowKey: string): Promise<FlashRow[]> {
    const rows: FlashRow[] = [];
    try {
      const entities = this.table(table).listEntities<Omit<FlashRow, 'partitionKey' | 'rowKey'>>({
        queryOptions: { filter: odata`PartitionKey eq ${partitionKey} and RowKey ge ${fromRowKey}` },
      });
      for await (const e of entities) {
        rows.push({
          partitionKey: e.partitionKey!,
          rowKey: e.rowKey!,
          id: Number(e.id),
          timeMs: Number(e.timeMs),
          lat: Number(e.lat),
          lon: Number(e.lon),
          fileStartMs: Number(e.fileStartMs),
        });
      }
    } catch (error) {
      if (isStatus(error, 404)) return []; // hour with no flashes yet, or already purged
      throw error;
    }
    return rows;
  }

  async listTables(prefix: string): Promise<string[]> {
    const names: string[] = [];
    const tables = this.service.listTables({
      queryOptions: { filter: odata`TableName ge ${prefix} and TableName lt ${`${prefix}~`}` },
    });
    for await (const t of tables) if (t.name) names.push(t.name);
    return names.sort();
  }

  async deleteTable(table: string): Promise<void> {
    try {
      await this.service.deleteTable(table);
    } catch (error) {
      if (!isStatus(error, 404)) throw error;
    }
    this.created.delete(table);
  }

  async latestFileEnd(): Promise<number | undefined> {
    try {
      const row = await this.table(STATUS_TABLE).getEntity<{ latestFileEndMs: number }>(STATUS_PARTITION, STATUS_ROW);
      return Number(row.latestFileEndMs);
    } catch (error) {
      if (isStatus(error, 404)) return undefined;
      throw error;
    }
  }

  async raiseLatestFileEnd(endMs: number): Promise<number> {
    await this.ensureTable(STATUS_TABLE);
    const client = this.table(STATUS_TABLE);
    // Concurrent deliveries can race; an ETag-guarded update never moves the time backwards.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const row = await client.getEntity<{ latestFileEndMs: number }>(STATUS_PARTITION, STATUS_ROW);
        const current = Number(row.latestFileEndMs);
        if (current >= endMs) return current;
        await client.updateEntity(
          { partitionKey: STATUS_PARTITION, rowKey: STATUS_ROW, latestFileEndMs: endMs },
          'Replace',
          { etag: row.etag },
        );
        return endMs;
      } catch (error) {
        if (isStatus(error, 404)) {
          try {
            await client.createEntity({ partitionKey: STATUS_PARTITION, rowKey: STATUS_ROW, latestFileEndMs: endMs });
            return endMs;
          } catch (createError) {
            if (!isStatus(createError, 409)) throw createError;
          }
        } else if (!isStatus(error, 412)) {
          throw error;
        }
      }
    }
    throw new Error('Could not update the latest GLM file end time after 5 attempts');
  }
}
