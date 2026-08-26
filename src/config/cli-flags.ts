import { parse, stringify, TomlError } from "smol-toml";
import type { RuffOptions } from "./toml-options";

export interface CliFlagsSuccess {
  ok: true;
  options: RuffOptions;
  hasRuffTable: true;
  /** Recognized-but-inert real Ruff flags and positional arguments, in encounter order. */
  ignoredFlags: string[];
}

export interface CliFlagsFailure {
  ok: false;
  message: string;
}

export type CliFlagsResult = CliFlagsSuccess | CliFlagsFailure;

/**
 * Small POSIX-shell-like tokenizer: splits on unquoted whitespace, honors
 * single/double quotes (double-quote allows `\"`/`\\` escapes), so a real
 * pasted command line like `--config "lint.select=[\"E\", \"F\"]"` tokenizes
 * as two tokens rather than splitting on the internal space.
 */
export function shellTokenize(text: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) break;
    let token = "";
    while (i < text.length && !/\s/.test(text[i])) {
      const ch = text[i];
      if (ch === '"' || ch === "'") {
        const quote = ch;
        i++;
        while (i < text.length && text[i] !== quote) {
          if (quote === '"' && text[i] === "\\" && i + 1 < text.length) {
            token += text[i + 1];
            i += 2;
            continue;
          }
          token += text[i];
          i++;
        }
        i++; // skip closing quote
      } else {
        token += ch;
        i++;
      }
    }
    tokens.push(token);
  }
  return tokens;
}

type ArrayFieldKey = "select" | "ignore" | "extend-select" | "fixable" | "unfixable" | "extend-fixable";

/** `lint.<key>` array flags, in real Ruff `check --help`'s own display order. */
const ARRAY_FLAGS: Record<string, ArrayFieldKey> = {
  "--select": "select",
  "--ignore": "ignore",
  "--extend-select": "extend-select",
  "--fixable": "fixable",
  "--unfixable": "unfixable",
  "--extend-fixable": "extend-fixable",
};
const ARRAY_FLAG_ORDER: ArrayFieldKey[] = ["select", "ignore", "extend-select", "fixable", "unfixable", "extend-fixable"];

/** Top-level boolean flags, no value. */
const BOOLEAN_FLAGS = new Set(["--preview", "--fix", "--unsafe-fixes"]);
const BOOLEAN_FLAG_ORDER = ["target-version", "preview", "fix", "unsafe-fixes"];

/** Real Ruff CLI flags with no meaning in a filesystem-less browser tool: 0 values. */
const INERT_FLAGS_0ARY = new Set([
  "--fix-only",
  "--show-fixes",
  "--diff",
  "-w",
  "--watch",
  "--ignore-noqa",
  "--statistics",
  "--show-files",
  "--show-settings",
  "--respect-gitignore",
  "--force-exclude",
  "-n",
  "--no-cache",
  "-e",
  "--exit-zero",
  "--exit-non-zero-on-fix",
  "-v",
  "--verbose",
  "-q",
  "--quiet",
  "-s",
  "--silent",
  "--isolated",
  "-h",
  "--help",
  "--add-noqa",
]);

/** Real Ruff CLI flags with no meaning here that take one value (still consumed, for correct tokenization). */
const INERT_FLAGS_1ARY = new Set([
  "--output-format",
  "-o",
  "--output-file",
  "--extension",
  "--exclude",
  "--extend-exclude",
  "--cache-dir",
  "--stdin-filename",
  "--color",
  "--per-file-ignores",
  "--extend-per-file-ignores",
]);

function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** Deep-sets `value` at `path` in `root`, creating intermediate tables as needed. Mutates `root`. */
function deepSet(root: RuffOptions, path: string[], value: unknown): string | null {
  let node: Record<string, unknown> = root;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const existing = node[key];
    if (existing === undefined) {
      const created: Record<string, unknown> = {};
      node[key] = created;
      node = created;
    } else if (isTable(existing)) {
      node = existing;
    } else {
      return path.slice(0, i + 1).join(".");
    }
  }
  node[path[path.length - 1]] = value;
  return null;
}

function stripFraming(tokens: string[]): string[] {
  let rest = tokens;
  if (rest[0] === "ruff") rest = rest.slice(1);
  if (rest[0] === "check" || rest[0] === "format") rest = rest.slice(1);
  return rest;
}

export function cliFlagsToOptions(text: string): CliFlagsResult {
  const tokens = stripFraming(shellTokenize(text));
  const options: RuffOptions = {};
  const ignoredFlags: string[] = [];

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (!token.startsWith("-")) {
      ignoredFlags.push(token);
      i++;
      continue;
    }

    const eq = token.indexOf("=");
    const flag = eq === -1 ? token : token.slice(0, eq);
    const inlineValue = eq === -1 ? undefined : token.slice(eq + 1);

    if (flag in ARRAY_FLAGS) {
      const value = inlineValue ?? tokens[++i];
      if (value === undefined) return { ok: false, message: `${flag} requires a value` };
      options.lint ??= {};
      (options.lint as Record<string, unknown>)[ARRAY_FLAGS[flag]] = splitList(value);
      i++;
      continue;
    }

    if (flag === "--target-version") {
      const value = inlineValue ?? tokens[++i];
      if (value === undefined) return { ok: false, message: `${flag} requires a value` };
      options["target-version"] = value;
      i++;
      continue;
    }

    if (BOOLEAN_FLAGS.has(flag)) {
      const key = flag === "--preview" ? "preview" : flag === "--fix" ? "fix" : "unsafe-fixes";
      options[key] = true;
      i++;
      continue;
    }

    if (flag === "--config") {
      const value = inlineValue ?? tokens[++i];
      if (value === undefined) return { ok: false, message: "--config requires a value" };
      const eqIdx = value.indexOf("=");
      if (eqIdx === -1) return { ok: false, message: `--config value "${value}" must be "<path>=<toml-value>"` };
      const path = value.slice(0, eqIdx);
      const valueText = value.slice(eqIdx + 1);
      let parsed: unknown;
      try {
        const doc = parse(`v = ${valueText}`);
        parsed = (doc as Record<string, unknown>).v;
      } catch (error) {
        const detail = error instanceof TomlError ? error.message : error instanceof Error ? error.message : String(error);
        return { ok: false, message: `--config "${path}=...": invalid TOML value: ${detail}` };
      }
      const conflict = deepSet(options, path.split("."), parsed);
      if (conflict !== null) {
        return { ok: false, message: `--config "${path}=...": "${conflict}" is already set to a non-table value` };
      }
      i++;
      continue;
    }

    if (INERT_FLAGS_0ARY.has(flag)) {
      ignoredFlags.push(token);
      i++;
      continue;
    }

    if (INERT_FLAGS_1ARY.has(flag)) {
      ignoredFlags.push(token);
      if (inlineValue === undefined) i++; // consume the following value token too
      i++;
      continue;
    }

    return {
      ok: false,
      message: `Unknown flag: ${flag}. Use --config "path=value" to set any Ruff option not listed as a native flag.`,
    };
  }

  return { ok: true, options, hasRuffTable: true, ignoredFlags };
}

/** Hand-rolled inline TOML value writer (`smol-toml`'s `stringify` emits block tables, not inline). */
function tomlKeyLiteral(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlValueLiteral(key);
}

function tomlValueLiteral(value: unknown): string {
  if (Array.isArray(value)) {
    return `[ ${value.map(tomlValueLiteral).join(", ")} ]`;
  }
  if (isTable(value)) {
    const entries = Object.entries(value).map(([k, v]) => `${tomlKeyLiteral(k)} = ${tomlValueLiteral(v)}`);
    return `{ ${entries.join(", ")} }`;
  }
  return stringify({ v: value })
    .replace(/^v = /, "")
    .trimEnd();
}

const ARRAY_FLAG_NAMES: Record<ArrayFieldKey, string> = {
  select: "--select",
  ignore: "--ignore",
  "extend-select": "--extend-select",
  fixable: "--fixable",
  unfixable: "--unfixable",
  "extend-fixable": "--extend-fixable",
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

const SAFE_KEY = /^[A-Za-z0-9_-]+$/;

/**
 * Collects `--config "path=value"` fallback flags for every leaf not covered
 * by native flags. Recurses into a table only when every one of its keys is a
 * safe bare identifier — a key containing e.g. a literal `.` (a file-pattern
 * key like `"__init__.py"` in `per-file-ignores`) would otherwise produce a
 * dotted path indistinguishable from genuine nesting, and fail to round-trip
 * back through `--config`'s own `path.split(".")`. Such a table is instead
 * emitted whole, as one opaque inline-TOML-value leaf.
 */
function collectConfigFallback(node: Record<string, unknown>, path: string[], out: Array<{ path: string; value: unknown }>) {
  for (const [key, value] of Object.entries(node)) {
    const fullPath = [...path, key];
    if (isTable(value) && Object.keys(value).every((k) => SAFE_KEY.test(k))) {
      collectConfigFallback(value, fullPath, out);
    } else {
      out.push({ path: fullPath.join("."), value });
    }
  }
}

export function optionsToCliFlags(options: RuffOptions): { text: string } {
  const remaining: RuffOptions = JSON.parse(JSON.stringify(options)) as RuffOptions;
  const parts: string[] = [];

  const lint = isTable(remaining.lint) ? (remaining.lint as Record<string, unknown>) : undefined;
  for (const key of ARRAY_FLAG_ORDER) {
    const value = lint?.[key];
    if (value !== undefined) {
      if (isStringArray(value)) {
        parts.push(`${ARRAY_FLAG_NAMES[key]} ${value.join(",")}`);
        delete lint![key];
      }
    }
  }
  if (lint && Object.keys(lint).length === 0) delete remaining.lint;

  for (const key of BOOLEAN_FLAG_ORDER) {
    const value = remaining[key];
    if (value === undefined) continue;
    if (key === "target-version") {
      if (typeof value === "string") {
        parts.push(`--target-version ${value}`);
        delete remaining[key];
      }
    } else if (typeof value === "boolean") {
      if (value) parts.push(`--${key === "unsafe-fixes" ? "unsafe-fixes" : key}`);
      delete remaining[key];
    }
  }

  const fallback: Array<{ path: string; value: unknown }> = [];
  collectConfigFallback(remaining, [], fallback);
  fallback.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const { path, value } of fallback) {
    const literal = tomlValueLiteral(value);
    const configArg = `${path}=${literal}`;
    const quote = configArg.includes('"') && !configArg.includes("'") ? "'" : '"';
    const escaped = quote === '"' ? configArg.replace(/\\/g, "\\\\").replace(/"/g, '\\"') : configArg;
    parts.push(`--config ${quote}${escaped}${quote}`);
  }

  return { text: parts.join(" ") };
}

/**
 * Recursive merge for plain-object/table values (key-by-key, siblings from
 * both sides survive); arrays and scalars are atomic replacements by
 * `override` — matching Ruff's real config-layering semantics (CLI/`--config`
 * settings "always take precedence over all configuration files").
 */
export function deepMergeOptions(base: RuffOptions, override: RuffOptions): RuffOptions {
  const result: RuffOptions = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const baseValue = result[key];
    if (isTable(value) && isTable(baseValue)) {
      result[key] = deepMergeOptions(baseValue as RuffOptions, value as RuffOptions);
    } else {
      result[key] = value;
    }
  }
  return result;
}
