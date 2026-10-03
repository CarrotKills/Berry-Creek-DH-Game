"use strict";

const CENTRAL_TIME_ZONE = "America/Chicago";
const SCHEDULE_MINUTES = 6 * 60 + 30;
const RETRY_DELAY_MS = 15 * 60 * 1000;

function centralClock(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CENTRAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
    minute: Number(values.minute)
  };
}

function shouldRun(status = {}, now = new Date(), enabled = true) {
  if (!enabled) return false;
  const clock = centralClock(now);
  if (clock.hour * 60 + clock.minute < SCHEDULE_MINUTES) return false;
  if (status.lastCompletedDate === clock.date) return false;
  const lastAttempt = Date.parse(status.lastAttemptAt || "");
  if (Number.isFinite(lastAttempt) && now.getTime() - lastAttempt < RETRY_DELAY_MS) return false;
  return true;
}

module.exports = { CENTRAL_TIME_ZONE, SCHEDULE_MINUTES, RETRY_DELAY_MS, centralClock, shouldRun };
