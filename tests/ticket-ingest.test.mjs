import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTicketInfo } from "../functions/api/ticket-ingest.js";

const valid = {
  date: "2026-09-12",
  away: "KIA",
  home: "KT",
  state: "scheduled",
  opensAt: "2026-09-05T16:00:00+09:00",
  sourceUrl: "https://www.ticketlink.co.kr/sports",
  checkedAt: "2026-09-04T08:00:00Z"
};

test("normalizes official per-game ticket data", () => {
  assert.deepEqual(normalizeTicketInfo(valid), valid);
});

test("rejects invalid teams, timestamps, and source hosts", () => {
  assert.equal(normalizeTicketInfo({ ...valid, home: "없는팀" }), null);
  assert.equal(normalizeTicketInfo({ ...valid, opensAt: "soon" }), null);
  assert.equal(normalizeTicketInfo({ ...valid, sourceUrl: "https://example.com/" }), null);
});
