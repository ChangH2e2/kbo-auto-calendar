import assert from "node:assert/strict";
import test from "node:test";

import { latestGameDataTimestamp } from "../functions/api/games.js";

test("reports the latest source timestamp instead of request time", () => {
  assert.equal(latestGameDataTimestamp([
    { source_updated_at: "2026-09-04T08:00:00Z", ingested_at: "2026-09-04T08:01:00Z" },
    { source_updated_at: "2026-09-04T09:00:00Z", ingested_at: "2026-09-04T09:01:00Z" },
    { source_updated_at: null, ingested_at: "not-a-date" }
  ]), "2026-09-04T09:00:00.000Z");
  assert.equal(latestGameDataTimestamp([]), null);
});
