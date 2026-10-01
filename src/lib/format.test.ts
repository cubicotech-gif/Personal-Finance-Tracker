import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatAmount, formatTyped, groupIndian } from "./format";

describe("groupIndian", () => {
  it("groups the last three digits, then pairs", () => {
    assert.equal(groupIndian("0"), "0");
    assert.equal(groupIndian("999"), "999");
    assert.equal(groupIndian("1000"), "1,000");
    assert.equal(groupIndian("100000"), "1,00,000");
    assert.equal(groupIndian("1410000"), "14,10,000");
    assert.equal(groupIndian("123456789"), "12,34,56,789");
  });
});

describe("formatAmount", () => {
  it("formats PKR the Pakistani way, from minor units", () => {
    assert.equal(formatAmount(141000000n, "PKR"), "₨14,10,000");
    assert.equal(formatAmount(141000050n, "PKR"), "₨14,10,000.50");
    assert.equal(formatAmount(5n, "PKR"), "₨0.05");
    assert.equal(formatAmount(0n, "PKR"), "₨0");
  });

  it("keeps USD on ordinary grouping", () => {
    assert.equal(formatAmount(141000000n, "USD"), "$1,410,000");
  });

  it("signs, hides the symbol and keeps trailing zeros on request", () => {
    assert.equal(formatAmount(-250000n, "PKR"), "-₨2,500");
    assert.equal(formatAmount(250000n, "PKR", { signed: true }), "+₨2,500");
    assert.equal(formatAmount(250000n, "PKR", { symbol: false }), "2,500");
    assert.equal(formatAmount(250000n, "PKR", { compact: false }), "₨2,500.00");
  });

  it("is exact past 2^53", () => {
    assert.equal(formatAmount(900719925474099312345n, "PKR", { symbol: false }), "90,07,19,92,54,74,09,93,123.45");
  });
});

describe("formatTyped", () => {
  it("groups while typing and keeps what was typed", () => {
    assert.equal(formatTyped("", "PKR"), "0");
    assert.equal(formatTyped("1410000", "PKR"), "14,10,000");
    assert.equal(formatTyped("1410000.", "PKR"), "14,10,000.");
    assert.equal(formatTyped("12.50", "PKR"), "12.50");
    assert.equal(formatTyped("0.", "PKR"), "0.");
    assert.equal(formatTyped("1410000", "USD"), "1,410,000");
  });
});
