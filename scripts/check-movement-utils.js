const assert = require("node:assert/strict");
const { roundWindowCoordinate } = require("../movement-utils");

assert.equal(roundWindowCoordinate(10.6), 11);
assert.equal(roundWindowCoordinate(-10.6), -11);
assert.equal(roundWindowCoordinate(-0.1), 0);
assert.equal(Object.is(roundWindowCoordinate(-0.1), -0), false);
assert.equal(Number.isNaN(roundWindowCoordinate("not-a-number")), true);

console.log("movement-utils: OK");
