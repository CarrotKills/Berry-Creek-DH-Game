const assert = require("node:assert/strict");
const E = require("./score-engine.js");
const X = require("./scorecard-export.js");

const player = {
  id: "export-player",
  name: "Export Player",
  ghin: 10,
  teeKey: "championship",
  group: "A",
  scores: [3, 4, 7, ...Array(15).fill("")]
};
const model = X.buildScorecardModel({
  course: E.COURSE,
  settings: { par: 72, allowance: 100 },
  players: [player],
  group: "A",
  roundName: "Test Round",
  date: "2026-09-03",
  scoring: E
});

assert.equal(model.playerRows.length, 1);
assert.equal(model.teeRows[0].total, 6600);
assert.equal(model.frontPar, 36);
assert.equal(model.backPar, 36);
assert.equal(model.totalPar, 72);
assert.deepEqual(model.playerRows[0].marks.slice(0, 3), ["birdie", "bogey", "double-bogey"]);
assert.equal(model.playerRows[0].totalGross, 14);

(async () => {
  const zip = await X.createZip([
    { name: "group-a.jpg", blob: new Blob([Uint8Array.from([1, 2, 3])], { type: "image/jpeg" }) },
    { name: "group-b.jpg", blob: new Blob([Uint8Array.from([4, 5])], { type: "image/jpeg" }) }
  ]);
  const bytes = new Uint8Array(await zip.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.equal(zip.type, "application/zip");
  assert.match(Buffer.from(bytes).toString("latin1"), /group-a\.jpg/);
  assert.match(Buffer.from(bytes).toString("latin1"), /group-b\.jpg/);
  console.log("Scorecard JPEG model and ZIP export tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });
