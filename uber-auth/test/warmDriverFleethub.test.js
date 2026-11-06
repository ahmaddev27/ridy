import { test } from "node:test";
import assert from "node:assert/strict";
import { visitFleetHub } from "../src/warmDriver.js";

const loop = () => new Error("page.goto: net::ERR_TOO_MANY_REDIRECTS at https://fleethub.uber.com/");

function fakes(gotoResults) {
  const calls = { goto: 0, cleared: [] };
  const page = {
    goto: async () => {
      const r = gotoResults[calls.goto++];
      if (r) throw r;
    },
  };
  const context = { clearCookies: async (f) => calls.cleared.push(f) };
  return { page, context, calls };
}

test("happy path: single goto, nothing cleared", async () => {
  const { page, context, calls } = fakes([null]);
  assert.equal(await visitFleetHub(page, context), true);
  assert.equal(calls.goto, 1);
  assert.deepEqual(calls.cleared, []);
});

test("redirect loop: clears fleethub cookies and the retry succeeds", async () => {
  const { page, context, calls } = fakes([loop(), null]);
  assert.equal(await visitFleetHub(page, context), true);
  assert.deepEqual(calls.cleared, [{ domain: "fleethub.uber.com" }]);
});

test("persistent loop: skipped (false), not thrown", async () => {
  const { page, context, calls } = fakes([loop(), loop()]);
  assert.equal(await visitFleetHub(page, context), false);
  assert.equal(calls.goto, 2);
});

test("other errors still propagate", async () => {
  const { page, context } = fakes([new Error("net::ERR_CONNECTION_RESET")]);
  await assert.rejects(visitFleetHub(page, context), /CONNECTION_RESET/);
});
