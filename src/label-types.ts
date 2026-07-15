export interface LabelDefinition {
  readonly name: string;
  readonly color: string;
  readonly description: string;
  readonly aliases: readonly string[];
}

export interface ExistingLabel {
  readonly name: string;
  readonly color: string;
  readonly description?: string | null;
}

export interface PlanningConfig {
  readonly labels: readonly LabelDefinition[];
  managed(name: string): boolean;
}
