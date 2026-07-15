export interface RepositoryMetadata {
  readonly fullName: string;
  readonly archived: boolean;
  readonly disabled: boolean;
  readonly fork: boolean;
}

export interface RepositoryTarget {
  readonly fullName: string;
}
