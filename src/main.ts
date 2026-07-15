import * as core from "@actions/core";

import { runAction, type ActionRuntime } from "./action";

const runtime: ActionRuntime = {
  getInput: (name) => core.getInput(name, { trimWhitespace: false }),
  setSecret: (value) => core.setSecret(value),
  setOutput: (name, value) => core.setOutput(name, value),
  writeSummary: async (markdown) => {
    await core.summary.addRaw(markdown).write();
  },
  setFailed: (message) => core.setFailed(message),
  info: (message) => core.info(message),
  error: (message, title) => core.error(message, title === undefined ? {} : { title }),
  startGroup: (name) => core.startGroup(name),
  endGroup: () => core.endGroup(),
};

void runAction(runtime);
