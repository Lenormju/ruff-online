// Spike: rule select/ignore reconciliation for the category + per-rule checkbox UI.
//
// Goal: turn UI checkbox state (which categories are checked, which individual
// rules are overridden) into the {select, ignore} arrays Ruff's Options expects,
// and back again (for loading an existing pyproject.toml / shared URL into the UI).
//
// Key fact this relies on (Ruff's documented rule-selector precedence):
// an exact rule code ALWAYS beats a prefix selector for that rule, regardless of
// which list (select vs ignore) it's in or what order selectors appear in.
// Among selectors of equal specificity, later-in-the-list wins.
// Source: https://docs.astral.sh/ruff/rules/#rule-selection

import assert from "node:assert/strict";

// --- minimal stand-in for rules.json, same shape, small enough to eyeball ---
const RULES = [
  { code: "E501", linter: "pycodestyle" },
  { code: "E401", linter: "pycodestyle" },
  { code: "F401", linter: "Pyflakes" },
  { code: "F841", linter: "Pyflakes" },
  { code: "B006", linter: "flake8-bugbear" },
  { code: "B008", linter: "flake8-bugbear" },
  { code: "PLR0913", linter: "pylint" },
  { code: "PLR0912", linter: "pylint" },
  { code: "PLW0603", linter: "pylint" },
];

// linter name -> prefix used in select/ignore (this mapping needs to come from
// real ruff data later; codes.rs has the authoritative prefix per linter, and
// some linters have multiple prefixes e.g. "PLR"/"PLW"/"PLC" all under pylint).
// For the spike, prefix = the rule's own leading letters, grouped by linter.
const CATEGORY_PREFIX = {
  pycodestyle: "E",
  Pyflakes: "F",
  "flake8-bugbear": "B",
  pylint: "PL", // NB: real pylint has PLR/PLW/PLC/PLE sub-prefixes; see note below
};

function categoryOf(code) {
  const rule = RULES.find((r) => r.code === code);
  return CATEGORY_PREFIX[rule.linter];
}

// ---------------------------------------------------------------------------
// FORWARD: UI state -> {select, ignore}
//
// UI state:
//   categorySelected: Set<prefix>            categories the user checked
//   ruleOverrides: Map<code, 'on' | 'off'>   meaningful per-rule deviations only
//     'off' = carve-out exception under a selected category
//     'on'  = one-off addition under a category that isn't selected
// ---------------------------------------------------------------------------
function toSelectIgnore(categorySelected, ruleOverrides) {
  const select = [...categorySelected].sort();
  const ignore = [];

  for (const [code, state] of ruleOverrides) {
    const cat = categoryOf(code);
    const catSelected = categorySelected.has(cat);
    if (state === "off" && catSelected) {
      ignore.push(code);
    } else if (state === "on" && !catSelected) {
      select.push(code);
    }
    // else: override is redundant given current category state; caller should
    // have pruned it already (see pruneOverrides below), skip defensively.
  }
  return { select, ignore };
}

// Call this whenever categorySelected changes, so stale/redundant overrides
// (e.g. an 'off' override left behind after the category got unchecked) don't
// silently linger and confuse the next toSelectIgnore() call.
function pruneOverrides(categorySelected, ruleOverrides) {
  for (const [code, state] of [...ruleOverrides]) {
    const catSelected = categorySelected.has(categoryOf(code));
    const stillMeaningful =
      (state === "off" && catSelected) || (state === "on" && !catSelected);
    if (!stillMeaningful) ruleOverrides.delete(code);
  }
}

// ---------------------------------------------------------------------------
// REVERSE (best-effort): {select, ignore, extendSelect, extendIgnore} -> per-rule
// enabled boolean, so we can seed checkbox state from pasted TOML / a shared URL.
//
// This reimplements Ruff's specificity+order precedence for OUR small rule set.
// It is NOT a substitute for Ruff's real resolver (defaults, "ALL", nested
// prefixes like PLR under PL, ambiguous ties) -- flagged as a follow-up: once
// we can run ruff_wasm in tests, diff this against real Workspace behavior
// instead of trusting this reimplementation for production.
// ---------------------------------------------------------------------------
function specificity(selector) {
  // exact code beats prefix; longer prefix beats shorter prefix
  const isExactCode = RULES.some((r) => r.code === selector);
  return isExactCode ? 1000 : selector.length;
}

function resolveEnabled({ select = [], ignore = [], extendSelect = [], extendIgnore = [] }) {
  const enabled = new Map(); // code -> boolean

  const applyList = (list, value) => {
    // within one list, later entries win ties of equal specificity
    const ordered = list.map((sel, i) => ({ sel, i, spec: specificity(sel) }));
    for (const rule of RULES) {
      const matches = ordered.filter(
        ({ sel }) => sel === rule.code || sel === categoryOf(rule.code) || rule.code.startsWith(sel)
      );
      if (matches.length === 0) continue;
      matches.sort((a, b) => a.spec - b.spec || a.i - b.i); // last = highest spec, then last order
      enabled.set(rule.code, value);
    }
  };

  // base: select (or nothing selected if select is empty and we're not using defaults here)
  applyList(select, true);
  applyList(extendSelect, true);
  applyList(ignore, false);
  applyList(extendIgnore, false);

  // proper precedence requires interleaving by specificity across ALL lists at
  // once, not four sequential passes. Redo properly:
  const allSelectors = [
    ...select.map((sel) => ({ sel, value: true })),
    ...extendSelect.map((sel) => ({ sel, value: true })),
    ...ignore.map((sel) => ({ sel, value: false })),
    ...extendIgnore.map((sel) => ({ sel, value: false })),
  ].map((s, i) => ({ ...s, i, spec: specificity(s.sel) }));

  const result = new Map();
  for (const rule of RULES) {
    const matches = allSelectors.filter(
      ({ sel }) => sel === rule.code || rule.code.startsWith(sel)
    );
    if (matches.length === 0) {
      result.set(rule.code, false);
      continue;
    }
    matches.sort((a, b) => a.spec - b.spec || a.i - b.i);
    result.set(rule.code, matches[matches.length - 1].value);
  }
  return result;
}

function uiStateFromResolved(resolvedEnabled) {
  const categorySelected = new Set();
  const ruleOverrides = new Map();

  // NB: this is ambiguous by construction. {B006: off, B008: on} within
  // category B can be represented either as "B selected, B006 carved out" or
  // "B not selected, B008 added one-off" -- both resolve to the identical
  // enabled set. We break ties by picking whichever representation needs
  // fewer overrides (strict majority on -> category checked), and on an
  // exact tie we leave the category unchecked (conservative: don't claim a
  // category is "selected" unless most of its rules actually are).
  // This means round-tripping arbitrary pasted TOML through the UI and back
  // out is only guaranteed to preserve the *resolved rule set*, not the
  // exact checkbox layout -- see the "semantic round-trip" tests below.
  const categories = [...new Set(RULES.map((r) => categoryOf(r.code)))];
  for (const cat of categories) {
    const rulesInCat = RULES.filter((r) => categoryOf(r.code) === cat);
    const onCount = rulesInCat.filter((r) => resolvedEnabled.get(r.code)).length;
    const offCount = rulesInCat.length - onCount;
    if (onCount > offCount) categorySelected.add(cat);
  }
  for (const rule of RULES) {
    const cat = categoryOf(rule.code);
    const on = resolvedEnabled.get(rule.code);
    const catSelected = categorySelected.has(cat);
    if (on && !catSelected) ruleOverrides.set(rule.code, "on");
    if (!on && catSelected) ruleOverrides.set(rule.code, "off");
  }
  return { categorySelected, ruleOverrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
function test(name, fn) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    console.log(`FAIL ${name}`);
    console.log(e);
    process.exitCode = 1;
  }
}

test("category checked -> whole prefix selected", () => {
  const categorySelected = new Set(["B"]);
  const ruleOverrides = new Map();
  assert.deepEqual(toSelectIgnore(categorySelected, ruleOverrides), {
    select: ["B"],
    ignore: [],
  });
});

test("category checked + one rule unchecked -> carve-out ignore", () => {
  const categorySelected = new Set(["B"]);
  const ruleOverrides = new Map([["B006", "off"]]);
  assert.deepEqual(toSelectIgnore(categorySelected, ruleOverrides), {
    select: ["B"],
    ignore: ["B006"],
  });
});

test("category unchecked + one rule checked -> one-off select", () => {
  const categorySelected = new Set();
  const ruleOverrides = new Map([["E501", "on"]]);
  assert.deepEqual(toSelectIgnore(categorySelected, ruleOverrides), {
    select: ["E501"],
    ignore: [],
  });
});

test("pruneOverrides drops stale override after category state flips", () => {
  const categorySelected = new Set(["B"]);
  const ruleOverrides = new Map([["B006", "off"]]);
  categorySelected.delete("B"); // user unchecked the category
  pruneOverrides(categorySelected, ruleOverrides);
  assert.equal(ruleOverrides.has("B006"), false);
});

test("forward -> reverse: exact checkbox layout survives when category is a clear majority (2 of 2... use 3-rule PL category, 2 on 1 off)", () => {
  const categorySelected = new Set(["PL"]);
  const ruleOverrides = new Map([["PLW0603", "off"]]);
  const { select, ignore } = toSelectIgnore(categorySelected, ruleOverrides);
  const resolved = resolveEnabled({ select, ignore });
  const back = uiStateFromResolved(resolved);
  assert.deepEqual([...back.categorySelected], ["PL"]);
  assert.deepEqual([...back.ruleOverrides], [["PLW0603", "off"]]);
});

test("forward -> reverse: 2-rule category exact tie (1 on/1 off) does NOT preserve checkbox layout, but DOES preserve the resolved rule set", () => {
  // documents the ambiguity noted above: {B006: off, B008: on} round-trips to
  // a different-looking but behaviorally identical representation.
  const categorySelected = new Set(["B"]);
  const ruleOverrides = new Map([["B006", "off"]]);
  const { select, ignore } = toSelectIgnore(categorySelected, ruleOverrides);
  const resolvedBefore = resolveEnabled({ select, ignore });

  const back = uiStateFromResolved(resolvedBefore);
  assert.deepEqual([...back.categorySelected], []); // NOT ["B"] -- the ambiguity
  assert.deepEqual([...back.ruleOverrides], [["B008", "on"]]);

  const { select: select2, ignore: ignore2 } = toSelectIgnore(
    back.categorySelected,
    back.ruleOverrides
  );
  const resolvedAfter = resolveEnabled({ select: select2, ignore: ignore2 });
  assert.deepEqual([...resolvedBefore], [...resolvedAfter]); // but semantics match
});

test("forward -> reverse round-trips for one-off addition case (no tie involved)", () => {
  const categorySelected = new Set();
  const ruleOverrides = new Map([["E501", "on"]]);
  const { select, ignore } = toSelectIgnore(categorySelected, ruleOverrides);
  const resolved = resolveEnabled({ select, ignore });
  const back = uiStateFromResolved(resolved);
  assert.deepEqual([...back.categorySelected], []);
  assert.deepEqual([...back.ruleOverrides], [["E501", "on"]]);
});

test("exact code beats prefix regardless of order (ignore before select)", () => {
  // ignore=["B"] then select=["B006"] listed AFTER in the merged selector set:
  // exact code B006 should win and be enabled, even though 'ignore' conceptually
  // sounds like it should apply "on top". Specificity beats order across lists.
  const resolved = resolveEnabled({ select: ["B006"], ignore: ["B"] });
  assert.equal(resolved.get("B006"), true);
  assert.equal(resolved.get("B008"), false);
});

test("pasted TOML with only an exact code (no category) seeds a one-off override", () => {
  const resolved = resolveEnabled({ select: ["F401"] });
  const ui = uiStateFromResolved(resolved);
  assert.deepEqual([...ui.categorySelected], []);
  assert.deepEqual([...ui.ruleOverrides], [["F401", "on"]]);
});

console.log("\nNote: CATEGORY_PREFIX is a spike simplification. Real pylint");
console.log("rules split across PLR/PLW/PLC/PLE prefixes, not one 'PL' -- the");
console.log("category list for the real UI must come from grouping rules.json");
console.log("by linter, not from a hand-picked prefix per linter.");
