interface ConfigurationPaths {
  readonly configFile: string;
  readonly policyFile: string;
}

export interface ValidationRuntimeOptions extends ConfigurationPaths {
  readonly mode: "validate";
}

export interface SynchronizationRuntimeOptions extends ConfigurationPaths {
  readonly mode: "preview" | "apply";
  readonly token: string;
  readonly owner: string;
  readonly onlyRepository: string;
  readonly apiUrl: string;
}

export type RuntimeOptions = ValidationRuntimeOptions | SynchronizationRuntimeOptions;

export const RuntimeOptions = Object.freeze({
  load(environment: Readonly<Record<string, string | undefined>>): RuntimeOptions {
    const validateOnly = parseBoolean(
      "SYNC_LABELS_VALIDATE_ONLY",
      environment.SYNC_LABELS_VALIDATE_ONLY ?? "false",
    );
    const paths = {
      configFile: environment.SYNC_LABELS_CONFIG_FILE ?? ".github/labels.yml",
      policyFile: environment.SYNC_LABELS_POLICY_FILE ?? ".github/label-policy.yml",
    };

    if (validateOnly) {
      return Object.freeze({ mode: "validate", ...paths });
    }

    const token = environment.SYNC_LABELS_TOKEN ?? "";
    const owner = (environment.SYNC_LABELS_OWNER ?? "").trim();

    if (token.trim().length === 0) {
      throw new Error("SYNC_LABELS_TOKEN 不能为空。");
    }
    if (owner.length === 0) {
      throw new Error("SYNC_LABELS_OWNER 不能为空。");
    }

    const dryRun = parseBoolean("SYNC_LABELS_DRY_RUN", environment.SYNC_LABELS_DRY_RUN ?? "true");
    return Object.freeze({
      mode: dryRun ? "preview" : "apply",
      token,
      owner,
      ...paths,
      onlyRepository: (environment.SYNC_LABELS_REPOSITORY ?? "").trim(),
      apiUrl: (environment.SYNC_LABELS_API_URL ?? "https://api.github.com")
        .trim()
        .replace(/\/$/, ""),
    });
  },
});

function parseBoolean(name: string, value: string): boolean {
  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      throw new TypeError(`${name} 必须是 true/false、1/0、yes/no 或 on/off。`);
  }
}
