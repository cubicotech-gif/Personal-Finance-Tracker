import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { padInput, type PadKey } from "./pad";

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
