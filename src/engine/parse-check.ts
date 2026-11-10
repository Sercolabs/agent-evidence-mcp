import { supportedRoles, type VerifyCheck } from "./check-types.js";
import { splitCommand } from "./checks/command-exit.js";

export class InvalidCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCheckError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripWrappingQuotes(value: string): string {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) {
    return value;
  }
  if (value.indexOf('"', 1) !== value.length - 1) {
    return value;
  }
  return value.slice(1, -1);
}

function splitFields(body: string): Map<string, string> {
  const parts: string[] = [];
  let current = "";
  let quote = false;
  for (const ch of body) {
    if (ch === '"') {
      quote = !quote;
      current += ch;
      continue;
    }
    if (ch === "," && !quote) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (quote) {
    throw new InvalidCheckError("invalid check: unclosed quote");
  }
  parts.push(current);
  const fields = new Map<string, string>();
  for (const part of parts) {
    if (part.length === 0) {
      throw new InvalidCheckError("invalid check field");
    }
    const eq = part.indexOf("=");
    if (eq <= 0) {
      throw new InvalidCheckError(`invalid check field "${part}"`);
    }
    const key = part.slice(0, eq);
    if (!/^[a-z_]+$/.test(key)) {
      throw new InvalidCheckError(`invalid check field "${key}"`);
    }
    if (fields.has(key)) {
      throw new InvalidCheckError(`duplicate check field "${key}"`);
    }
    fields.set(key, stripWrappingQuotes(part.slice(eq + 1)));
  }
  return fields;
}

function take(fields: Map<string, string>, key: string): string {
  if (!fields.has(key)) {
    throw new InvalidCheckError(`missing field "${key}"`);
  }
  const value = fields.get(key) ?? "";
  fields.delete(key);
  return value;
}

function finishFields(fields: Map<string, string>): void {
  const extra = fields.keys().next().value;
  if (extra !== undefined) {
    throw new InvalidCheckError(`unexpected field "${extra}"`);
  }
}

function parseCode(raw: string): number {
  if (!/^-?\d+$/.test(raw)) {
    throw new InvalidCheckError("invalid check code");
  }
  const code = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(code)) {
    throw new InvalidCheckError("invalid check code");
  }
  return code;
}

function parseRegex(source: string): string {
  if (source.length === 0) {
    throw new InvalidCheckError('missing field "regex"');
  }
  try {
    new RegExp(source);
  } catch {
    throw new InvalidCheckError("invalid check regex");
  }
  return source;
}

function optional(
  fields: Map<string, string>,
  key: string,
): string | undefined {
  return fields.has(key) ? take(fields, key) : undefined;
}
function httpUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error();
  } catch {
    throw new InvalidCheckError(
      "expected HTTP or HTTPS URL without credentials",
    );
  }
  return raw;
}
function timeout(fields: Map<string, string>): number {
  const value = parseCode(optional(fields, "timeout_ms") ?? "5000");
  if (value < 1 || value > 30000)
    throw new InvalidCheckError("timeout_ms must be between 1 and 30000");
  return value;
}
function stateOf(fields: Map<string, string>): "visible" | "attached" {
  const state = optional(fields, "state") ?? "visible";
  if (state !== "visible" && state !== "attached")
    throw new InvalidCheckError("state must be visible or attached");
  return state;
}
function nonempty(value: string): string {
  if (!value.trim()) throw new InvalidCheckError("check field cannot be empty");
  return value;
}

function checkFromFields(
  type: string,
  fields: Map<string, string>,
): VerifyCheck {
  switch (type) {
    case "url":
    case "text":
    case "element": {
      const rawGoto = optional(fields, "goto");
      const goto = rawGoto === undefined ? undefined : httpUrl(rawGoto);
      const timeout_ms = timeout(fields);
      if (type === "url") {
        const glob = optional(fields, "match");
        const regex = optional(fields, "regex");
        if ((glob === undefined) === (regex === undefined))
          throw new InvalidCheckError("url needs match or regex");
        finishFields(fields);
        return {
          type,
          goto,
          timeout_ms,
          match:
            glob !== undefined
              ? { kind: "glob", value: nonempty(glob) }
              : { kind: "regex", source: parseRegex(regex ?? "") },
        };
      }
      const state = stateOf(fields);
      if (type === "text") {
        const text = nonempty(take(fields, "text"));
        const selector = optional(fields, "selector");
        if (selector !== undefined) nonempty(selector);
        finishFields(fields);
        return { type, goto, timeout_ms, text, selector, state };
      }
      const selector = optional(fields, "selector");
      const rawRole = optional(fields, "role");
      const role = supportedRoles.find((role) => role === rawRole);
      if (rawRole !== undefined && role === undefined)
        throw new InvalidCheckError("invalid role");
      const name = optional(fields, "name");
      if (
        (selector === undefined) === (role === undefined) ||
        (selector !== undefined && name !== undefined)
      )
        throw new InvalidCheckError(
          "element needs selector or role with optional name",
        );
      if (role !== undefined && !/^[a-z]+$/.test(role))
        throw new InvalidCheckError("invalid role");
      finishFields(fields);
      return {
        type,
        goto,
        timeout_ms,
        state,
        target:
          selector !== undefined
            ? { kind: "selector", selector: nonempty(selector) }
            : { kind: "role", role: role ?? "generic", name },
      };
    }
    case "api_response": {
      const url = httpUrl(take(fields, "url"));
      const status = parseCode(optional(fields, "status") ?? "200");
      if (status < 100 || status > 599)
        throw new InvalidCheckError("invalid HTTP status");
      const timeout_ms = timeout(fields);
      const body = optional(fields, "body");
      const regex = optional(fields, "regex");
      if (body !== undefined && regex !== undefined)
        throw new InvalidCheckError("api_response needs body or regex");
      finishFields(fields);
      return {
        type,
        url,
        status,
        timeout_ms,
        body:
          body !== undefined
            ? { kind: "text", value: nonempty(body) }
            : regex !== undefined
              ? { kind: "regex", source: parseRegex(regex) }
              : undefined,
      };
    }
    case "file_exists": {
      const path = take(fields, "path");
      finishFields(fields);
      return { type, path };
    }
    case "file_contains": {
      const path = take(fields, "path");
      const hasText = fields.has("text");
      const hasRegex = fields.has("regex");
      if (hasText === hasRegex) {
        throw new InvalidCheckError("file_contains needs text or regex");
      }
      if (hasText) {
        const text = take(fields, "text");
        if (text.length === 0) {
          throw new InvalidCheckError('missing field "text"');
        }
        finishFields(fields);
        return { type, path, match: { kind: "text", value: text } };
      }
      const regex = parseRegex(take(fields, "regex"));
      finishFields(fields);
      return { type, path, match: { kind: "regex", source: regex } };
    }
    case "command_exit": {
      const command = take(fields, "command");
      if (command.length === 0 || splitCommand(command) === undefined) {
        throw new InvalidCheckError("invalid check command");
      }
      let code = 0;
      if (fields.has("code")) {
        code = parseCode(take(fields, "code"));
      }
      finishFields(fields);
      return { type, command, code };
    }
    default:
      throw new InvalidCheckError(`invalid check type "${type}"`);
  }
}

export function parseCheckSpec(spec: string): VerifyCheck {
  const colon = spec.indexOf(":");
  if (colon <= 0) {
    throw new InvalidCheckError(`invalid check "${spec}"`);
  }
  const type = spec.slice(0, colon);
  if (!/^[a-z_]+$/.test(type)) {
    throw new InvalidCheckError(`invalid check type "${type}"`);
  }
  return checkFromFields(type, splitFields(spec.slice(colon + 1)));
}

function fieldsFromRecord(value: Record<string, unknown>): Map<string, string> {
  const fields = new Map<string, string>();
  for (const [key, raw] of Object.entries(value)) {
    if (key === "type") {
      continue;
    }
    if (!/^[a-z_]+$/.test(key)) {
      throw new InvalidCheckError(`invalid check field "${key}"`);
    }
    if (typeof raw === "string") {
      fields.set(key, raw);
      continue;
    }
    if (
      typeof raw === "number" &&
      Number.isSafeInteger(raw) &&
      ["code", "status", "timeout_ms"].includes(key)
    ) {
      fields.set(key, String(raw));
      continue;
    }
    throw new InvalidCheckError(`invalid check field "${key}"`);
  }
  return fields;
}

export function parseCheckValue(value: unknown, depth = 0): VerifyCheck {
  if (depth > 16) throw new InvalidCheckError("checks nesting exceeds 16");
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new InvalidCheckError("invalid check");
  }
  if (value.type === "final_outcome") {
    if (
      Object.keys(value).some((key) => key !== "type" && key !== "checks") ||
      !Array.isArray(value.checks)
    )
      throw new InvalidCheckError("final_outcome needs checks array only");
    return {
      type: "final_outcome",
      checks: value.checks.map((child) => parseCheckValue(child, depth + 1)),
    };
  }
  return checkFromFields(value.type, fieldsFromRecord(value));
}
