import type { LabelDefinition } from "./label-types";
import { labelKey } from "./label-identity";

const LABEL_FIELDS = ["name", "color", "description", "aliases"] as const;
const LABEL_FIELD_SET = new Set<string>(LABEL_FIELDS);

export function validatedLabelDefinition(value: unknown, context: string): LabelDefinition {
  if (!isRecord(value)) {
    throw new TypeError(`${context}必须是对象。`);
  }

  const unknown = Object.keys(value)
    .filter((key) => !LABEL_FIELD_SET.has(key))
    .sort();
  if (unknown.length > 0) {
    throw new TypeError(`${context}包含未知字段：${unknown.join(", ")}`);
  }

  const missing = LABEL_FIELDS.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing.length > 0) {
    throw new TypeError(`${context}缺少字段：${missing.join(", ")}`);
  }

  for (const key of ["name", "color", "description"] as const) {
    if (typeof value[key] !== "string") {
      throw new TypeError(`${context}${key} 必须是字符串。`);
    }
  }
  if (!Array.isArray(value.aliases) || value.aliases.some((alias) => typeof alias !== "string")) {
    throw new TypeError(`${context}aliases 必须是字符串数组。`);
  }

  const name = value.name as string;
  const color = value.color as string;
  const description = value.description as string;
  const aliases = value.aliases as string[];
  if (name.trim().length === 0) {
    throw new TypeError(`${context}name 不能为空。`);
  }
  if (name !== name.trim()) {
    throw new TypeError(`${context}name 不能包含首尾空白。`);
  }
  if (Array.from(name).length > 50) {
    throw new TypeError(`${context}name 超过 50 个字符。`);
  }
  if (!/^[0-9A-F]{6}$/.test(color)) {
    throw new TypeError(`${context}color 必须是六位大写十六进制值。`);
  }
  if (Array.from(description).length > 100) {
    throw new TypeError(`${context}description 超过 100 个字符。`);
  }
  if (description !== description.trim()) {
    throw new TypeError(`${context}description 不能包含首尾空白。`);
  }
  if (aliases.some((alias) => alias.trim().length === 0)) {
    throw new TypeError(`${context}aliases 不能包含空值。`);
  }
  if (aliases.some((alias) => alias !== alias.trim())) {
    throw new TypeError(`${context}aliases 不能包含首尾空白。`);
  }
  if (new Set(aliases.map(labelKey)).size !== aliases.length) {
    throw new TypeError(`${context}aliases 包含重复值。`);
  }

  return Object.freeze({ name, color, description, aliases: Object.freeze([...aliases]) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
