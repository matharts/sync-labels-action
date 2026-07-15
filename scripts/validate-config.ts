#!/usr/bin/env nub

import { runConfigValidationCommand } from "../src/config-validation-command";

void runConfigValidationCommand(process.argv.slice(2), {
  cwd: process.cwd(),
  info: (message) => console.log(message),
  error: (message) => console.error(message),
}).then((exitCode) => {
  process.exitCode = exitCode;
});
