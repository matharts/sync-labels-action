import { describe, expect, it, vi } from "vitest";

import type { ActionRuntime } from "../src/action";

const coreMocks = vi.hoisted(() => ({
  getInput: vi.fn(() => "input-value"),
  setSecret: vi.fn(),
  setOutput: vi.fn(),
  summaryAddRaw: vi.fn(),
  summaryWrite: vi.fn(async () => {}),
  setFailed: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  startGroup: vi.fn(),
  endGroup: vi.fn(),
}));

const actionMocks = vi.hoisted(() => ({
  runAction: vi.fn(async (_runtime: ActionRuntime) => {}),
}));

vi.mock("@actions/core", () => ({
  getInput: coreMocks.getInput,
  setSecret: coreMocks.setSecret,
  setOutput: coreMocks.setOutput,
  summary: { addRaw: coreMocks.summaryAddRaw },
  setFailed: coreMocks.setFailed,
  info: coreMocks.info,
  error: coreMocks.error,
  startGroup: coreMocks.startGroup,
  endGroup: coreMocks.endGroup,
}));

vi.mock("../src/action", () => ({
  runAction: actionMocks.runAction,
}));

describe("Action entrypoint", () => {
  it("adapts every Action runtime operation to @actions/core", async () => {
    coreMocks.summaryAddRaw.mockReturnValue({ write: coreMocks.summaryWrite });

    await import("../src/main");

    expect(actionMocks.runAction).toHaveBeenCalledOnce();
    const runtime = actionMocks.runAction.mock.calls[0]?.[0] as ActionRuntime;

    expect(runtime.getInput("token")).toBe("input-value");
    runtime.setSecret("secret");
    runtime.setOutput("changed", true);
    await runtime.writeSummary("summary");
    runtime.setFailed("failure");
    runtime.info("information");
    runtime.error("untitled");
    runtime.error("titled", "title");
    runtime.startGroup("repository");
    runtime.endGroup();

    expect(coreMocks.getInput).toHaveBeenCalledWith("token", { trimWhitespace: false });
    expect(coreMocks.setSecret).toHaveBeenCalledWith("secret");
    expect(coreMocks.setOutput).toHaveBeenCalledWith("changed", true);
    expect(coreMocks.summaryAddRaw).toHaveBeenCalledWith("summary");
    expect(coreMocks.summaryWrite).toHaveBeenCalledOnce();
    expect(coreMocks.setFailed).toHaveBeenCalledWith("failure");
    expect(coreMocks.info).toHaveBeenCalledWith("information");
    expect(coreMocks.error).toHaveBeenNthCalledWith(1, "untitled", {});
    expect(coreMocks.error).toHaveBeenNthCalledWith(2, "titled", { title: "title" });
    expect(coreMocks.startGroup).toHaveBeenCalledWith("repository");
    expect(coreMocks.endGroup).toHaveBeenCalledOnce();
  });
});
