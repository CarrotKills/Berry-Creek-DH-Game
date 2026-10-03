"use strict";

const assert = require("node:assert/strict");
const Schedule = require("./index-update-schedule.js");

assert.deepEqual(Schedule.centralClock(new Date("2026-01-15T12:29:00Z")), { date: "2026-01-15", hour: 6, minute: 29 });
assert.equal(Schedule.shouldRun({}, new Date("2026-01-15T12:29:00Z")), false, "Do not run before 6:30 AM CST");
assert.equal(Schedule.shouldRun({}, new Date("2026-01-15T12:30:00Z")), true, "Run at 6:30 AM CST");
assert.deepEqual(Schedule.centralClock(new Date("2026-07-15T11:30:00Z")), { date: "2026-07-15", hour: 6, minute: 30 });
assert.equal(Schedule.shouldRun({}, new Date("2026-07-15T11:30:00Z")), true, "Observe daylight saving time at 6:30 AM CDT");
assert.equal(Schedule.shouldRun({ lastCompletedDate: "2026-07-15" }, new Date("2026-07-15T18:00:00Z")), false, "Run only once after a completed daily check");
assert.equal(Schedule.shouldRun({ lastAttemptAt: "2026-07-15T11:25:00Z" }, new Date("2026-07-15T11:35:00Z")), false, "Wait before retrying a failed request");
assert.equal(Schedule.shouldRun({ lastAttemptAt: "2026-07-15T11:15:00Z" }, new Date("2026-07-15T11:30:00Z")), true, "Retry a failed request after 15 minutes");
assert.equal(Schedule.shouldRun({}, new Date("2026-07-15T11:30:00Z"), false), false, "Honor the disable switch");

console.log("Automatic index-update schedule tests passed.");
