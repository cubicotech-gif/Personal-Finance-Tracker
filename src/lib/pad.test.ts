import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { minorToTyped, padInput, type PadKey } from "./pad";

const press = (keys: PadKey[], from = "") => keys.reduce(padInput, from);

describe("padInput", () => {
  it("builds a number digit by digit", () => {
    assert.equal(press(["1", "4", "5", "0"]), "1450");
  });

  it("never leaves a leading zero", () => {
    assert.equal(press(["0", "0", "0"]), "0");
    assert.equal(press(["0", "7"]), "7");
  });

  it("starts a decimal from nothing as 0.", () => {
    assert.equal(press(["."]), "0.");
    assert.equal(press([".", "5"]), "0.5");
  });

  it("allows one point and two decimals", () => {
    assert.equal(press(["1", ".", ".", "2", "5", "9"]), "1.25");
  });

  it("deletes one character, and clears on demand", () => {
    assert.equal(press(["back"], "12.5"), "12.");
    assert.equal(press(["back", "back", "back"], "12"), "");
    assert.equal(press(["clear"], "999"), "");
  });

  it("caps the whole part", () => {
    assert.equal(press(Array(20).fill("9") as PadKey[]).length, 12);
  });
});

describe("minorToTyped", () => {
  it("round-trips minor units into pad text", () => {
    assert.equal(minorToTyped(125000n), "1250");
    assert.equal(minorToTyped(125050n), "1250.5");
    assert.equal(minorToTyped(125005n), "1250.05");
    assert.equal(minorToTyped(5n), "0.05");
    assert.equal(minorToTyped(0n), "0");
  });
});
