export class RuntimeOptions {
  readonly token: string;
  readonly owner: string;
  readonly configFile: string;
  readonly policyFile: string;
  readonly onlyRepository: string;
  readonly apiUrl: string;
  readonly dryRun: boolean;

  private constructor(values: RuntimeOptions) {
    this.token = values.token;
    this.owner = values.owner;
    this.configFile = values.configFile;
    this.policyFile = values.policyFile;
    this.onlyRepository = values.onlyRepository;
    this.apiUrl = values.apiUrl;
    this.dryRun = values.dryRun;
    Object.freeze(this);
  }

  static load(environment: Readonly<Record<string, string | undefined>>): RuntimeOptions {
    const token = environment.SYNC_LABELS_TOKEN ?? "";
    const owner = (environment.SYNC_LABELS_OWNER ?? "").trim();

    if (token.trim().length === 0) {
      throw new Error("SYNC_LABELS_TOKEN 不能为空。");
    }
    if (owner.length === 0) {
      throw new Error("SYNC_LABELS_OWNER 不能为空。");
    }

    return new RuntimeOptions({
      token,
      owner,
      configFile: environment.SYNC_LABELS_CONFIG_FILE ?? ".github/labels.yml",
      policyFile: environment.SYNC_LABELS_POLICY_FILE ?? ".github/label-policy.yml",
      onlyRepository: (environment.SYNC_LABELS_REPOSITORY ?? "").trim(),
      apiUrl: (environment.SYNC_LABELS_API_URL ?? "https://api.github.com")
        .trim()
        .replace(/\/$/, ""),
      dryRun: parseBoolean("SYNC_LABELS_DRY_RUN", environment.SYNC_LABELS_DRY_RUN ?? "true"),
    });
  }
}

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
