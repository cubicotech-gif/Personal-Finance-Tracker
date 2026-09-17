import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  RATE_SCALE,
  formatMinor,
  formatRate,
  parseAmount,
  parseRate,
  sum,
  toPkr,
} from "./money";

describe("parseAmount", () => {
  it("reads plain and grouped decimals", () => {
    assert.equal(parseAmount("1234.56", "PKR"), 123456n);
    assert.equal(parseAmount("1,234.5", "PKR"), 123450n);
    assert.equal(parseAmount(" 12 ", "PKR"), 1200n);
    assert.equal(parseAmount(".5", "PKR"), 50n);
    assert.equal(parseAmount("-12.34", "PKR"), -1234n);
  });

  it("tolerates what a person actually types", () => {
    assert.equal(parseAmount("Rs 300", "PKR"), 30000n);
    assert.equal(parseAmount("$12.50", "USD"), 1250n);
    assert.equal(parseAmount("1 000", "PKR"), 100000n);
  });

  it("rounds extra digits half away from zero, symmetrically", () => {
    assert.equal(parseAmount("1.005", "PKR"), 101n);
    assert.equal(parseAmount("-1.005", "PKR"), -101n);
    assert.equal(parseAmount("1.004", "PKR"), 100n);
  });

  it("rejects anything that is not a number", () => {
    for (const bad of ["", "   ", "abc", "-", ".", "1.2.3", "12x"]) {
      assert.equal(parseAmount(bad, "PKR"), null, `expected ${JSON.stringify(bad)} to be rejected`);
    }
  });

  it("never loses precision past 2^53", () => {
    // 2^53 + 1 is the smallest integer a JS number cannot represent.
    assert.equal(parseAmount("90071992547409.93", "PKR"), 9007199254740993n);
  });
});

describe("formatMinor", () => {
  it("groups thousands and keeps minor units", () => {
    assert.equal(formatMinor(123456n, "PKR"), "Rs 1,234.56");
    assert.equal(formatMinor(-123456n, "PKR"), "-Rs 1,234.56");
    assert.equal(formatMinor(5n, "PKR"), "Rs 0.05");
    assert.equal(formatMinor(0n, "USD"), "$ 0.00");
  });

  it("honours compact, signed and symbol-free forms", () => {
    assert.equal(formatMinor(100000n, "PKR", { compact: true }), "Rs 1,000");
    assert.equal(formatMinor(100050n, "PKR", { compact: true }), "Rs 1,000.50");
    assert.equal(formatMinor(123456n, "PKR", { signed: true }), "+Rs 1,234.56");
    assert.equal(formatMinor(123456n, "PKR", { symbol: false }), "1,234.56");
  });

  it("round-trips through parseAmount", () => {
    const values = [0n, 1n, -1n, 50n, 99n, 100n, 123456n, -987654321n, 9007199254740993n];
    for (const value of values) {
      const text = formatMinor(value, "PKR", { symbol: false });
      assert.equal(parseAmount(text, "PKR"), value, `round trip failed for ${value} via "${text}"`);
    }
  });
});

describe("rates", () => {
  it("parses a decimal rate into 1e8 scale", () => {
    assert.equal(parseRate("278.5"), 27_850_000_000n);
    assert.equal(parseRate("1"), RATE_SCALE);
    assert.equal(parseRate("0"), null);
    assert.equal(parseRate("-5"), null);
    assert.equal(parseRate("nope"), null);
  });

  it("formats back without trailing zeros", () => {
    assert.equal(formatRate(27_850_000_000n), "278.5");
    assert.equal(formatRate(RATE_SCALE), "1");
  });
});

describe("toPkr", () => {
  const rate = parseRate("278.5") as bigint;

  it("passes PKR through untouched", () => {
    assert.equal(toPkr(12345n, "PKR", undefined), 12345n);
  });

  it("converts cents to paisa exactly", () => {
    // $1.00 at 278.50 is Rs 278.50.
    assert.equal(toPkr(100n, "USD", rate), 27850n);
    assert.equal(toPkr(10_000n, "USD", rate), 2_785_000n);
  });

  it("rounds half away from zero, symmetrically", () => {
    // 1 cent is 2.785 paisa, which must not drift by sign.
    assert.equal(toPkr(1n, "USD", rate), 279n);
    assert.equal(toPkr(-1n, "USD", rate), -279n);
  });

  it("refuses to guess when no rate has been entered", () => {
    assert.throws(() => toPkr(100n, "USD", undefined), /no PKR rate/);
  });
});

describe("sum", () => {
  it("adds bigints without going through a number", () => {
    assert.equal(sum([9007199254740993n, 1n, -2n]), 9007199254740992n);
    assert.equal(sum([]), 0n);
  });
});
