export interface SyncCounts {
  readonly created: number;
  readonly updated: number;
  readonly renamed: number;
  readonly deleted: number;
  readonly unchanged: number;
  readonly preserved: number;
}

export function zeroCounts(): SyncCounts {
  return {
    created: 0,
    updated: 0,
    renamed: 0,
    deleted: 0,
    unchanged: 0,
    preserved: 0,
  };
}

export function changed(counts: SyncCounts): boolean {
  return counts.created + counts.updated + counts.renamed + counts.deleted > 0;
}

export class RepositorySyncError extends Error {
  readonly counts: SyncCounts;

  constructor(message: string, counts: SyncCounts, options?: ErrorOptions) {
    super(message, options);
    this.name = "RepositorySyncError";
    this.counts = Object.freeze({ ...counts });
  }
}
