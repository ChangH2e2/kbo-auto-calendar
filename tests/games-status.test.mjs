import assert from "node:assert/strict";
import test from "node:test";

import { inferLiveStatus } from "../functions/api/games.js";

test("infers live status for a scheduled game during its five-hour window", () => {
  const startsAt = Date.parse("2026-09-05T18:30:00+09:00");
  assert.equal(inferLiveStatus({ status: "scheduled", starts_at: "2026-09-05T18:30:00+09:00" }, startsAt + 90 * 60 * 1000), "live");
  assert.equal(inferLiveStatus({ status: "scheduled", starts_at: "2026-09-05T18:30:00+09:00" }, startsAt - 1), "scheduled");
  assert.equal(inferLiveStatus({ status: "final", starts_at: "2026-09-05T18:30:00+09:00" }, startsAt + 90 * 60 * 1000), "final");
});
