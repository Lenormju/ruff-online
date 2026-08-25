import { describe, expect, test } from "vitest";
import { trimRule } from "../scripts/gen-rules-json.mjs";

describe("trimRule", () => {
  test("marks a rule with fix_availability Always as fixable", () => {
    const raw = {
      code: "F401",
      name: "unused-import",
      linter: "Pyflakes",
      summary: "`os` imported but unused",
      fix_availability: "Always",
      preview: false,
    };

    const result = trimRule(raw, new Set());

    expect(result.fixable).toBe(true);
  });

  test("marks a rule with fix_availability None as not fixable", () => {
    const raw = {
      code: "AIR001",
      name: "airflow-variable-name-task-id-mismatch",
      linter: "Airflow",
      summary: "Task variable name should match the task_id",
      fix_availability: "None",
      preview: false,
    };

    const result = trimRule(raw, new Set());

    expect(result.fixable).toBe(false);
  });

  test("marks a rule whose code is in enabledCodes as enabled", () => {
    const raw = {
      code: "F401",
      name: "unused-import",
      linter: "Pyflakes",
      summary: "`os` imported but unused",
      fix_availability: "Always",
      preview: false,
    };

    const result = trimRule(raw, new Set(["F401", "E501"]));

    expect(result.enabled).toBe(true);
  });

  test("marks a rule whose code is not in enabledCodes as disabled", () => {
    const raw = {
      code: "B006",
      name: "mutable-argument-default",
      linter: "flake8-bugbear",
      summary: "Do not use mutable data structures for argument defaults",
      fix_availability: "None",
      preview: false,
    };

    const result = trimRule(raw, new Set(["F401", "E501"]));

    expect(result.enabled).toBe(false);
  });

  test("passes through code, name, linter, summary, and preview unchanged", () => {
    const raw = {
      code: "E501",
      name: "line-too-long",
      linter: "pycodestyle",
      summary: "Line too long ({length} > {limit})",
      fix_availability: "None",
      preview: true,
    };

    const result = trimRule(raw, new Set());

    expect(result).toEqual({
      code: "E501",
      name: "line-too-long",
      linter: "pycodestyle",
      summary: "Line too long ({length} > {limit})",
      fixable: false,
      preview: true,
      enabled: false,
    });
  });
});
