import { describe, expect, it } from "vitest";

import { Application } from "../src/application";
import type { Repository } from "../src/github-client";
import type { ActionLogger, RepositorySynchronizerPort } from "../src/repository-synchronizer";
import { RepositorySyncError, zeroCounts } from "../src/sync-result";

function repository(fullName: string): Repository {
  return { fullName, archived: false, disabled: false, fork: false };
}

describe("Application", () => {
  it("continues after one repository fails and preserves its completed counts", async () => {
    const synchronizer: RepositorySynchronizerPort = {
      async sync(fullName) {
        const counts = { ...zeroCounts(), created: 1 };
        if (fullName.endsWith("failing")) {
          throw new RepositorySyncError("simulated failure", counts);
        }
        return counts;
      },
    };
    const events: string[] = [];
    const logger: ActionLogger = {
      info: (message) => events.push(`info:${message}`),
      error: (message) => events.push(`error:${message}`),
      startGroup: () => {},
      endGroup: () => {},
    };
    const application = new Application(
      [repository("matharts/failing"), repository("matharts/healthy")],
      synchronizer,
      true,
      logger,
    );

    const result = await application.run();

    expect(result.success).toBe(false);
    expect(result.failures.map(({ repository: name }) => name)).toEqual(["matharts/failing"]);
    expect(result.results.map(({ repository: name }) => name)).toEqual([
      "matharts/failing",
      "matharts/healthy",
    ]);
    expect(result.results[0]?.counts.created).toBe(1);
    expect(result.totals.created).toBe(2);
    expect(events.join("\n")).toContain("simulated failure");
  });
});
