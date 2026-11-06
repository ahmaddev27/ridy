import { test } from "node:test";
import assert from "node:assert/strict";
import { gotoDispatch } from "../src/dispatchGoto.js";

const loop = () => new Error("page.goto: net::ERR_TOO_MANY_REDIRECTS at https://vsdispatch.uber.com/");

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
  assert.equal(await gotoDispatch(page, context), true);
  assert.equal(calls.goto, 1);
  assert.deepEqual(calls.cleared, []);
});

test("redirect loop: clears only the dispatch host cookies and retries", async () => {
  const { page, context, calls } = fakes([loop(), null]);
  assert.equal(await gotoDispatch(page, context), true);
  assert.deepEqual(calls.cleared, [{ domain: "vsdispatch.uber.com" }]);
  assert.equal(calls.goto, 2);
});

test("persistent loop: returns false, not thrown", async () => {
  const { page, context, calls } = fakes([loop(), loop()]);
  assert.equal(await gotoDispatch(page, context), false);
  assert.equal(calls.goto, 2);
});

test("other errors propagate without clearing", async () => {
  const { page, context, calls } = fakes([new Error("net::ERR_CONNECTION_RESET")]);
  await assert.rejects(gotoDispatch(page, context), /CONNECTION_RESET/);
  assert.deepEqual(calls.cleared, []);
});
