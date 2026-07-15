export interface OperationCountValues {
  readonly created: number;
  readonly updated: number;
  readonly renamed: number;
  readonly deleted: number;
  readonly unchanged: number;
  readonly preserved: number;
}

const COUNT_FIELD_BY_OPERATION = {
  create: "created",
  update: "updated",
  rename: "renamed",
  delete: "deleted",
  unchanged: "unchanged",
  preserve: "preserved",
} as const satisfies Record<string, keyof OperationCountValues>;

export type SyncOperation = keyof typeof COUNT_FIELD_BY_OPERATION;

type MutableCountValues = { -readonly [Field in keyof OperationCountValues]: number };

export class OperationCounts implements OperationCountValues {
  readonly created: number;
  readonly updated: number;
  readonly renamed: number;
  readonly deleted: number;
  readonly unchanged: number;
  readonly preserved: number;

  constructor(values: Partial<OperationCountValues> = {}) {
    if (typeof values !== "object" || values === null) {
      throw new TypeError("同步操作计数必须是对象。");
    }

    this.created = countValue(values.created, "created");
    this.updated = countValue(values.updated, "updated");
    this.renamed = countValue(values.renamed, "renamed");
    this.deleted = countValue(values.deleted, "deleted");
    this.unchanged = countValue(values.unchanged, "unchanged");
    this.preserved = countValue(values.preserved, "preserved");
    Object.freeze(this);
  }

  static fromOperations(operations: Iterable<SyncOperation>): OperationCounts {
    const values = mutableZeroValues();
    for (const operation of operations) {
      const field = operationField(operation);
      values[field] += 1;
    }
    return new OperationCounts(values);
  }

  static sum(values: Iterable<OperationCounts>): OperationCounts {
    const totals = mutableZeroValues();
    for (const counts of values) {
      if (!(counts instanceof OperationCounts)) {
        throw new TypeError("只能聚合同步操作计数。");
      }
      totals.created += counts.created;
      totals.updated += counts.updated;
      totals.renamed += counts.renamed;
      totals.deleted += counts.deleted;
      totals.unchanged += counts.unchanged;
      totals.preserved += counts.preserved;
    }
    return new OperationCounts(totals);
  }

  get changed(): boolean {
    return this.created + this.updated + this.renamed + this.deleted > 0;
  }

  toJSON(): OperationCountValues {
    return {
      created: this.created,
      updated: this.updated,
      renamed: this.renamed,
      deleted: this.deleted,
      unchanged: this.unchanged,
      preserved: this.preserved,
    };
  }
}

function mutableZeroValues(): MutableCountValues {
  return {
    created: 0,
    updated: 0,
    renamed: 0,
    deleted: 0,
    unchanged: 0,
    preserved: 0,
  };
}

function operationField(operation: SyncOperation): keyof OperationCountValues {
  const field = (COUNT_FIELD_BY_OPERATION as Partial<Record<string, keyof OperationCountValues>>)[
    operation
  ];
  if (field === undefined) {
    throw new TypeError(`未知同步操作：${JSON.stringify(operation)}`);
  }
  return field;
}

function countValue(value: number | undefined, field: keyof OperationCountValues): number {
  const normalized = value ?? 0;
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new TypeError(`同步操作计数 ${field} 必须是非负安全整数。`);
  }
  return normalized;
}
