import type { ExistingLabel, LabelDefinition } from "./label-types";
import type { RepositoryMetadata } from "./repository-types";

export interface RepositoryCatalogPort {
  listOrganizationRepositories(owner: string): Promise<readonly RepositoryMetadata[]>;
  getRepository(owner: string, name: string): Promise<RepositoryMetadata>;
}

export interface LabelWriterPort {
  createLabel(fullName: string, desired: LabelDefinition): Promise<void>;
  updateLabel(fullName: string, currentName: string, desired: LabelDefinition): Promise<void>;
  deleteLabel(fullName: string, name: string): Promise<void>;
}

export interface LabelSyncPort extends LabelWriterPort {
  listLabels(fullName: string): Promise<readonly ExistingLabel[]>;
}

export interface GitHubPort extends RepositoryCatalogPort, LabelSyncPort {}
