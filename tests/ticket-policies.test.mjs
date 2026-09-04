import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTicketPolicy } from "../functions/api/ticket-policies.js";

test("normalizes a valid ticket policy", () => {
  assert.deepEqual(normalizeTicketPolicy({
    team_id: "LG",
    vendor_name: "티켓링크",
    official_url: "https://ticketlink.co.kr/",
    general_days_before: 7,
    general_open_time: "11:00",
    requires_login: 0,
    presale_description: "경기별 공지 우선",
    verified_at: "2026-09-04"
  }), {
    team: "LG",
    vendor: "티켓링크",
    url: "https://ticketlink.co.kr/",
    daysBefore: 7,
    openTime: "11:00",
    requiresLogin: false,
    description: "경기별 공지 우선",
    verifiedAt: "2026-09-04"
  });
});

test("exposes ticket providers that require login", () => {
  const policy = normalizeTicketPolicy({
    team_id: "NC",
    vendor_name: "NC 다이노스",
    official_url: "https://ticket.ncdinos.com/",
    general_days_before: 7,
    general_open_time: "11:00",
    requires_login: 1,
    verified_at: "2026-09-04"
  });
  assert.equal(policy.requiresLogin, true);
});

test("rejects unsafe or malformed policies", () => {
  assert.equal(normalizeTicketPolicy({ team_id: "LG", official_url: "javascript:alert(1)", general_days_before: 7, general_open_time: "11:00" }), null);
  assert.equal(normalizeTicketPolicy({ team_id: "없는팀", official_url: "https://example.com", general_days_before: 7, general_open_time: "11:00" }), null);
  assert.equal(normalizeTicketPolicy({ team_id: "LG", official_url: "https://example.com", general_days_before: 90, general_open_time: "25:00" }), null);
  assert.equal(normalizeTicketPolicy({ team_id: "LG", official_url: "https://example.com", general_days_before: 7, general_open_time: "11:00", requires_login: 2 }), null);
});
