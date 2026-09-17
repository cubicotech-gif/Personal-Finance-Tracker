import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { dropHeader, matchOption, parseBoolean, parseRows } from "./paste";

describe("parseRows", () => {
  it("reads a tab-separated block copied out of a spreadsheet", () => {
    assert.deepEqual(parseRows("Cash\tasset\t25000\r\nMeezan\tasset\t310000\r\n"), [
      ["Cash", "asset", "25000"],
      ["Meezan", "asset", "310000"],
    ]);
  });

  it("falls back to commas when there are no tabs", () => {
    assert.deepEqual(parseRows("Cash,asset,25000"), [["Cash", "asset", "25000"]]);
  });

  it("honours quoted fields containing the delimiter", () => {
    assert.deepEqual(parseRows('"Traders, Bilal",float_client,"said ""next week"""'), [
      ["Traders, Bilal", "float_client", 'said "next week"'],
    ]);
  });

  it("skips blank lines", () => {
    assert.deepEqual(parseRows("a\tb\n\n\nc\td\n"), [
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});

describe("dropHeader", () => {
  it("removes a label row but keeps data that merely looks similar", () => {
    const withHeader = [["Name", "Type"], ["Cash", "asset"]];
    assert.deepEqual(dropHeader(withHeader, ["name", "type"]), [["Cash", "asset"]]);

    const withoutHeader = [["Cash", "asset"]];
    assert.deepEqual(dropHeader(withoutHeader, ["name", "type"]), [["Cash", "asset"]]);
  });
});

describe("cell coercion", () => {
  it("reads the many ways a person writes yes", () => {
    for (const yes of ["yes", "Y", "TRUE", "1", "x"]) assert.equal(parseBoolean(yes), true, yes);
    for (const no of ["no", "", "false", "0", undefined]) assert.equal(parseBoolean(no), false, String(no));
  });

  it("matches options loosely and via aliases", () => {
    const kinds = ["person", "float_client"] as const;
    assert.equal(matchOption("Float Client", kinds), "float_client");
    assert.equal(matchOption("  PERSON ", kinds), "person");
    assert.equal(matchOption("client", kinds, { client: "float_client" }), "float_client");
    assert.equal(matchOption("nonsense", kinds), null);
    assert.equal(matchOption(undefined, kinds), null);
  });
});
