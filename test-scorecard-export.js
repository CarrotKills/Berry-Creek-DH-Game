const assert = require("node:assert/strict");
const fs = require("node:fs");
const E = require("./score-engine.js");
const X = require("./scorecard-export.js");

const player = {
  id: "export-player",
  name: "Export Player",
  ghin: 10,
  teeKey: "championship",
  group: "A",
  scores: [3, 4, 7, ...Array(8).fill(""), 3, ...Array(6).fill("")]
};
player.scores[16] = 4;
const model = X.buildScorecardModel({
  course: E.COURSE,
  settings: { par: 72, allowance: 100, kpWinners: { 8: "export-player", 12: "export-player", 17: "export-player" }, kpClaims: { 2: ["export-player"], 8: ["export-player"], 12: ["export-player"], 17: ["export-player"] } },
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
assert.equal(model.playerRows[0].totalGross, 21);
assert.equal(model.playerRows[0].kpStatuses[1], "marked");
assert.equal(model.playerRows[0].kpStatuses[7], "pending");
assert.equal(model.playerRows[0].kpStatuses[11], "kp");
assert.equal(model.playerRows[0].kpStatuses[16], "three-putt");

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
  const sampleJpeg = new Blob([fs.readFileSync("berry-creek-logo.jpeg")], { type: "image/jpeg" });
  const pdf = await X.createScorecardPdf([sampleJpeg, sampleJpeg]);
  const pdfBytes = Buffer.from(await pdf.arrayBuffer());
  assert.equal(pdf.type, "application/pdf");
  assert.equal(pdfBytes.subarray(0, 8).toString("latin1"), "%PDF-1.4");
  assert.match(pdfBytes.toString("latin1"), /\/Count 2/);
  assert.match(pdfBytes.toString("latin1"), /%%EOF/);
  const drawCalls = [];
  const savedAlpha = [];
  const context = {
    globalAlpha: 1,
    measureText: (value) => ({ width: String(value).length * 10 }),
    save() { savedAlpha.push(this.globalAlpha); },
    restore() { this.globalAlpha = savedAlpha.pop() ?? 1; },
    fillText(value) { drawCalls.push({ kind: "fill", value, alpha: this.globalAlpha }); },
    strokeText(value) { drawCalls.push({ kind: "stroke", value, alpha: this.globalAlpha }); },
    beginPath() {}, arc() {}, drawImage() {}, fill() {}, fillRect() {}, rotate() {}, stroke() {}, strokeRect() {}, translate() {}
  };
  global.document = { createElement: () => ({ getContext: () => context, toBlob: (callback) => callback(sampleJpeg) }) };
  await X.createScorecardJpeg({
    course: E.COURSE,
    settings: { par: 72, allowance: 100, kpWinners: { 8: "another-player", 17: "export-player" }, kpClaims: { 8: ["export-player", "another-player"], 17: ["export-player"] } },
    players: [player],
    group: "A",
    roundName: "Overlay Test",
    date: "2026-09-03",
    scoring: E
  });
  delete global.document;
  const markedFill = drawCalls.find((call) => call.kind === "fill" && call.value === "KP MARKED");
  const markedStroke = drawCalls.find((call) => call.kind === "stroke" && call.value === "KP MARKED");
  const threePuttFill = drawCalls.find((call) => call.kind === "fill" && call.value === "KP 3-PUTT");
  const threePuttStroke = drawCalls.find((call) => call.kind === "stroke" && call.value === "KP 3-PUTT");
  assert.equal(markedFill.alpha, 0.31);
  assert.equal(markedStroke.alpha, 0.7);
  assert.equal(threePuttFill.alpha, 0.34);
  assert.equal(threePuttStroke.alpha, 0.76);
  console.log("Scorecard JPEG, PDF, and ZIP export tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });
