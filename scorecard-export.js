(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BerryCreekScorecardExport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const COLORS = Object.freeze({
    navy: "#34445d",
    navyDark: "#27364c",
    red: "#b51222",
    ink: "#171717",
    muted: "#5c6169",
    line: "#cfd5df",
    paper: "#ffffff",
    tee: "#e2e9fb",
    alternate: "#f5f6f8",
    canvas: "#f7f6f2"
  });

  function sum(values) {
    return values.reduce((total, value) => total + Number(value || 0), 0);
  }

  function countScores(scores, start, end) {
    return scores.slice(start, end).filter((score) => Number.isFinite(Number(score)) && Number(score) >= 1).length;
  }

  function buildScorecardModel({ course, settings, players, group, roundName, date, scoring }) {
    const roster = Array.isArray(players) ? players : [];
    const teeKeys = [...new Set(roster.map((player) => player.teeKey || course.defaultTee))];
    const teeRows = teeKeys.map((teeKey) => {
      const tee = course.tees[teeKey] || course.tees[course.defaultTee];
      return {
        key: teeKey,
        name: tee.name,
        yards: tee.yards,
        front: sum(tee.yards.slice(0, 9)),
        back: sum(tee.yards.slice(9)),
        total: sum(tee.yards)
      };
    });
    const strokeSets = [...new Set(roster.map((player) => scoring.teeForPlayer(course, player).strokeSet))];
    const strokeRows = strokeSets.map((set) => ({
      name: strokeSets.length === 1 ? "Handicap" : `Hcp (${set === "upper" ? "Upper" : "Lower"})`,
      indexes: course.strokeIndexes[set]
    }));
    const playerRows = roster.map((player, index) => {
      const tee = scoring.teeForPlayer(course, player);
      const holes = scoring.holesForPlayer(course, player);
      const handicap = scoring.playingHandicap(player.ghin, settings, tee);
      const totals = scoring.playerTotals(player, course, settings);
      const scores = Array.from({ length: 18 }, (_, holeIndex) => player.scores?.[holeIndex] ?? "");
      const frontCount = countScores(scores, 0, 9);
      const backCount = countScores(scores, 9, 18);
      const totalCount = frontCount + backCount;
      return {
        name: String(player.name || "").trim() || `Player ${index + 1}`,
        teeName: tee.name,
        handicap,
        scores,
        marks: scores.map((score, holeIndex) => scoring.scoreMark(score, course.holes[holeIndex].par)),
        strokes: holes.map((hole) => Math.max(0, scoring.strokesForHole(handicap, hole.strokeIndex))),
        kpStatuses: holes.map((hole) => {
          const status = scoring.kpClaimStatus(player, course, settings, hole.number - 1);
          return status === "none" ? "" : status;
        }),
        frontGross: frontCount ? totals.front.gross : "",
        backGross: backCount ? totals.back.gross : "",
        totalGross: totalCount ? totals.total.gross : "",
        totalNet: totalCount ? totals.total.net : ""
      };
    });
    const pars = course.holes.map((hole) => hole.par);
    return {
      courseName: course.name,
      roundName: String(roundName || "Berry Creek Round"),
      date: String(date || ""),
      group: String(group || "A"),
      pars,
      frontPar: sum(pars.slice(0, 9)),
      backPar: sum(pars.slice(9)),
      totalPar: sum(pars),
      teeRows,
      strokeRows,
      playerRows
    };
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Club logo could not be loaded"));
      image.src = src;
    });
  }

  function fitText(ctx, text, maxWidth) {
    const value = String(text ?? "");
    if (ctx.measureText(value).width <= maxWidth) return value;
    let shortened = value;
    while (shortened.length > 1 && ctx.measureText(`${shortened}…`).width > maxWidth) shortened = shortened.slice(0, -1);
    return `${shortened}…`;
  }

  function drawCell(ctx, x, y, width, height, options = {}) {
    ctx.fillStyle = options.fill || COLORS.paper;
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = options.line || COLORS.line;
    ctx.lineWidth = options.lineWidth || 2;
    ctx.strokeRect(x, y, width, height);
  }

  function drawCenteredText(ctx, text, x, y, width, height, options = {}) {
    ctx.fillStyle = options.color || COLORS.ink;
    ctx.font = options.font || "700 30px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(fitText(ctx, text, width - 16), x + width / 2, y + height / 2 + (options.offsetY || 0));
  }

  function drawScoreSymbol(ctx, centerX, centerY, mark) {
    if (!["birdie", "eagle", "bogey", "double-bogey"].includes(mark)) return;
    ctx.save();
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 3;
    if (mark === "birdie" || mark === "eagle") {
      ctx.beginPath();
      ctx.arc(centerX, centerY, 25, 0, Math.PI * 2);
      ctx.stroke();
      if (mark === "eagle") {
        ctx.beginPath();
        ctx.arc(centerX, centerY, 32, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else {
      ctx.strokeRect(centerX - 25, centerY - 25, 50, 50);
      if (mark === "double-bogey") ctx.strokeRect(centerX - 32, centerY - 32, 64, 64);
    }
    ctx.restore();
  }

  function drawKpBadge(ctx, status, x, y, width, height) {
    if (!status) return;
    if (status === "marked" || status === "three-putt") {
      const stamp = status === "marked" ? "KP MARKED" : "KP 3-PUTT";
      ctx.save();
      ctx.translate(x + width / 2, y + height / 2);
      ctx.rotate(-Math.PI / 7);
      ctx.fillStyle = COLORS.red;
      ctx.font = "900 15px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.globalAlpha = status === "marked" ? 0.31 : 0.34;
      ctx.fillText(stamp, 0, 1);
      ctx.globalAlpha = status === "marked" ? 0.7 : 0.76;
      ctx.strokeStyle = COLORS.red;
      ctx.lineWidth = 0.9;
      ctx.strokeText(stamp, 0, 1);
      ctx.restore();
      return;
    }
    const badgeWidth = 44;
    const badgeHeight = 21;
    const badgeX = x + width - badgeWidth - 6;
    const badgeY = y + height - badgeHeight - 5;
    ctx.save();
    ctx.fillStyle = status === "kp" ? COLORS.red : COLORS.paper;
    ctx.strokeStyle = COLORS.red;
    ctx.lineWidth = status === "kp" ? 2 : 3;
    ctx.fillRect(badgeX, badgeY, badgeWidth, badgeHeight);
    ctx.strokeRect(badgeX, badgeY, badgeWidth, badgeHeight);
    ctx.fillStyle = status === "kp" ? "#ffffff" : COLORS.red;
    ctx.font = "800 15px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("KP", badgeX + badgeWidth / 2, badgeY + badgeHeight / 2 + 1);
    ctx.restore();
  }

  function drawPlayerScore(ctx, value, mark, strokes, kpStatus, x, y, width, height) {
    const centerX = x + width / 2;
    const centerY = y + height / 2 + 3;
    drawScoreSymbol(ctx, centerX, centerY, mark);
    drawCenteredText(ctx, value === "" ? "—" : value, x, y, width, height, {
      color: value === "" ? "#8b9098" : COLORS.ink,
      font: "700 31px Arial, sans-serif",
      offsetY: 3
    });
    if (strokes > 0) {
      const spacing = 13;
      const startX = centerX - ((strokes - 1) * spacing) / 2;
      ctx.fillStyle = COLORS.red;
      for (let dot = 0; dot < strokes; dot += 1) {
        ctx.beginPath();
        ctx.arc(startX + dot * spacing, y + 10, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    drawKpBadge(ctx, kpStatus, x, y, width, height);
  }

  function formatDate(value) {
    if (!value) return "";
    const parsed = new Date(`${value}T12:00:00`);
    if (Number.isNaN(parsed.getTime())) return value;
    return new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(parsed);
  }

  function panelHeight(model) {
    return 72 + 68 + model.strokeRows.length * 58 + model.teeRows.length * 58 + model.playerRows.length * 86;
  }

  function drawPanel(ctx, model, startHole, y, dimensions) {
    const { margin, width, labelWidth, valueWidth } = dimensions;
    const segment = startHole === 0 ? "OUT" : "IN";
    const holes = Array.from({ length: 9 }, (_, index) => startHole + index);
    const rowValues = (holeValues, segmentValue, totalValue = "", netValue = "") => [
      ...holes.map((holeIndex) => holeValues[holeIndex]), segmentValue, totalValue, netValue
    ];
    const drawStandardRow = (label, values, rowY, height, fill, font = "700 28px Arial, sans-serif") => {
      drawCell(ctx, margin, rowY, labelWidth, height, { fill });
      ctx.fillStyle = COLORS.ink;
      ctx.font = "700 27px Arial, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(fitText(ctx, label, labelWidth - 34), margin + 22, rowY + height / 2);
      values.forEach((value, index) => {
        const x = margin + labelWidth + index * valueWidth;
        drawCell(ctx, x, rowY, valueWidth, height, { fill });
        drawCenteredText(ctx, value, x, rowY, valueWidth, height, { font });
      });
    };

    const headings = [...holes.map((holeIndex) => model.pars[holeIndex] ? holeIndex + 1 : ""), segment, "TOT", "NET"];
    drawCell(ctx, margin, y, labelWidth, 72, { fill: COLORS.navy, line: COLORS.navyDark });
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 32px Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("Hole", margin + 22, y + 36);
    headings.forEach((heading, index) => {
      const x = margin + labelWidth + index * valueWidth;
      drawCell(ctx, x, y, valueWidth, 72, { fill: COLORS.navy, line: COLORS.navyDark });
      drawCenteredText(ctx, heading, x, y, valueWidth, 72, { color: "#ffffff", font: "800 32px Arial, sans-serif" });
    });
    let rowY = y + 72;
    const segmentPar = startHole === 0 ? model.frontPar : model.backPar;
    drawStandardRow("Par", rowValues(model.pars, segmentPar, model.totalPar), rowY, 68, COLORS.paper, "700 30px Arial, sans-serif");
    rowY += 68;
    model.strokeRows.forEach((strokeRow) => {
      drawStandardRow(strokeRow.name, rowValues(strokeRow.indexes, ""), rowY, 58, COLORS.paper, "700 27px Arial, sans-serif");
      rowY += 58;
    });
    model.teeRows.forEach((teeRow) => {
      const segmentYards = startHole === 0 ? teeRow.front : teeRow.back;
      drawStandardRow(teeRow.name, rowValues(teeRow.yards, segmentYards, teeRow.total), rowY, 58, COLORS.tee, "700 26px Arial, sans-serif");
      rowY += 58;
    });
    model.playerRows.forEach((player, playerIndex) => {
      const fill = playerIndex % 2 ? COLORS.alternate : COLORS.paper;
      drawCell(ctx, margin, rowY, labelWidth, 86, { fill });
      ctx.fillStyle = COLORS.ink;
      ctx.font = "700 28px Arial, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(fitText(ctx, player.name, labelWidth - 34), margin + 22, rowY + 31);
      ctx.fillStyle = COLORS.muted;
      ctx.font = "500 20px Arial, sans-serif";
      ctx.fillText(fitText(ctx, `${player.teeName} · Hcp ${player.handicap < 0 ? `+${Math.abs(player.handicap)}` : player.handicap}`, labelWidth - 34), margin + 22, rowY + 61);
      const segmentGross = startHole === 0 ? player.frontGross : player.backGross;
      const values = rowValues(player.scores, segmentGross, player.totalGross, player.totalNet);
      values.forEach((value, index) => {
        const x = margin + labelWidth + index * valueWidth;
        drawCell(ctx, x, rowY, valueWidth, 86, { fill });
        if (index < 9) {
          const holeIndex = startHole + index;
          drawPlayerScore(ctx, value, player.marks[holeIndex], player.strokes[holeIndex], player.kpStatuses[holeIndex], x, rowY, valueWidth, 86);
        } else {
          drawCenteredText(ctx, value === "" ? "—" : value, x, rowY, valueWidth, 86, { font: "800 30px Arial, sans-serif" });
        }
      });
      rowY += 86;
    });
    ctx.strokeStyle = COLORS.navyDark;
    ctx.lineWidth = 4;
    ctx.strokeRect(margin, y, width - margin * 2, rowY - y);
    return rowY;
  }

  async function createScorecardJpeg(options) {
    if (typeof document === "undefined") throw new Error("JPEG export requires a web browser");
    const model = buildScorecardModel(options);
    if (!model.playerRows.length) throw new Error(`No players are assigned to Group ${model.group}`);
    const width = 2400;
    const margin = 90;
    const labelWidth = 348;
    const valueWidth = (width - margin * 2 - labelWidth) / 12;
    const top = 265;
    const gap = 42;
    const footerHeight = 170;
    const onePanelHeight = panelHeight(model);
    const height = top + onePanelHeight * 2 + gap + footerHeight;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser could not create the scorecard image");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = COLORS.canvas;
    ctx.fillRect(0, 0, width, height);

    const logo = options.logoUrl ? await loadImage(options.logoUrl).catch(() => null) : null;
    if (logo) {
      const logoHeight = 190;
      const logoWidth = logoHeight * (logo.width / logo.height);
      ctx.drawImage(logo, margin, 34, logoWidth, logoHeight);
    }
    const titleX = logo ? 390 : margin;
    ctx.fillStyle = COLORS.navyDark;
    ctx.font = "700 34px Georgia, serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(fitText(ctx, model.courseName.toUpperCase(), width - titleX - margin), titleX, 72);
    ctx.fillStyle = COLORS.red;
    ctx.font = "800 58px Georgia, serif";
    ctx.fillText(fitText(ctx, `GROUP ${model.group} SCORECARD`, width - titleX - margin), titleX, 133);
    ctx.fillStyle = COLORS.muted;
    ctx.font = "600 28px Arial, sans-serif";
    const meta = [model.roundName, formatDate(model.date)].filter(Boolean).join("  ·  ");
    ctx.fillText(fitText(ctx, meta, width - titleX - margin), titleX, 188);
    ctx.fillStyle = COLORS.red;
    ctx.fillRect(margin, 236, width - margin * 2, 7);

    const dimensions = { margin, width, labelWidth, valueWidth };
    const frontBottom = drawPanel(ctx, model, 0, top, dimensions);
    const backBottom = drawPanel(ctx, model, 9, frontBottom + gap, dimensions);
    ctx.fillStyle = COLORS.muted;
    ctx.font = "600 24px Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("Red dots show handicap strokes received.", margin, backBottom + 50);
    ctx.fillText("Birdie: circle  ·  Eagle or better: double circle  ·  Bogey: square  ·  Double bogey or higher: double square", margin, backBottom + 91);
    ctx.fillText("Filled KP: qualifier (1 tic)  ·  KP MARKED: later beaten (0)  ·  KP 3-PUTT: latest closest is over par; no KP awarded until a later qualifier (0)  ·  Outlined KP: pending (0)", margin, backBottom + 132);

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The scorecard JPEG could not be created")), "image/jpeg", 0.94);
    });
  }

  function concatBytes(parts) {
    const length = parts.reduce((total, part) => total + part.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  }

  function jpegDimensions(bytes) {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("A scorecard image is not a valid JPEG");
    const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset];
      offset += 1;
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (marker === 0xda || offset + 1 >= bytes.length) break;
      const length = (bytes[offset] << 8) | bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length) break;
      if (startOfFrame.has(marker)) {
        return {
          height: (bytes[offset + 3] << 8) | bytes[offset + 4],
          width: (bytes[offset + 5] << 8) | bytes[offset + 6]
        };
      }
      offset += length;
    }
    throw new Error("The scorecard JPEG dimensions could not be read");
  }

  async function createScorecardPdf(jpegs) {
    const sources = Array.isArray(jpegs) ? jpegs : [jpegs];
    if (!sources.length || sources.some((source) => !source)) throw new Error("There are no scorecards to export as a PDF");
    const pages = [];
    for (const source of sources) {
      const blob = source instanceof Blob ? source : new Blob([source], { type: "image/jpeg" });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      pages.push({ bytes, ...jpegDimensions(bytes) });
    }

    const encoder = new TextEncoder();
    const ascii = (value) => encoder.encode(value);
    const pageWidth = 792;
    const pageHeight = 612;
    const margin = 18;
    const objectCount = 2 + pages.length * 3;
    const objects = new Map();
    const pageIds = pages.map((_, index) => 3 + index * 3);
    objects.set(1, [ascii("<< /Type /Catalog /Pages 2 0 R >>")]);
    objects.set(2, [ascii(`<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`)]);

    pages.forEach((page, index) => {
      const pageId = pageIds[index];
      const imageId = pageId + 1;
      const contentId = pageId + 2;
      const scale = Math.min((pageWidth - margin * 2) / page.width, (pageHeight - margin * 2) / page.height);
      const drawWidth = page.width * scale;
      const drawHeight = page.height * scale;
      const drawX = (pageWidth - drawWidth) / 2;
      const drawY = (pageHeight - drawHeight) / 2;
      const content = ascii(`q\n${drawWidth.toFixed(3)} 0 0 ${drawHeight.toFixed(3)} ${drawX.toFixed(3)} ${drawY.toFixed(3)} cm\n/Im0 Do\nQ\n`);
      objects.set(pageId, [ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`)]);
      objects.set(imageId, [
        ascii(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Interpolate true /Length ${page.bytes.length} >>\nstream\n`),
        page.bytes,
        ascii("\nendstream")
      ]);
      objects.set(contentId, [ascii(`<< /Length ${content.length} >>\nstream\n`), content, ascii("endstream")]);
    });

    const header = concatBytes([ascii("%PDF-1.4\n%"), new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3]), ascii("\n")]);
    const parts = [header];
    const offsets = Array(objectCount + 1).fill(0);
    let byteOffset = header.length;
    for (let id = 1; id <= objectCount; id += 1) {
      const object = concatBytes([ascii(`${id} 0 obj\n`), ...objects.get(id), ascii("\nendobj\n")]);
      offsets[id] = byteOffset;
      parts.push(object);
      byteOffset += object.length;
    }
    const xrefOffset = byteOffset;
    const xref = ascii(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
    parts.push(xref);
    return new Blob(parts, { type: "application/pdf" });
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let value = 0; value < 256; value += 1) {
      let crc = value;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
      table[value] = crc >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function zipDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
  }

  function zipHeader(length, writer) {
    const bytes = new Uint8Array(length);
    writer(new DataView(bytes.buffer));
    return bytes;
  }

  async function createZip(files) {
    if (!Array.isArray(files) || !files.length) throw new Error("There are no scorecards to export");
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const stamp = zipDateTime();
    for (const file of files) {
      const name = encoder.encode(String(file.name || "scorecard.jpg"));
      const source = file.blob instanceof Blob ? file.blob : new Blob([file.blob]);
      const data = new Uint8Array(await source.arrayBuffer());
      const checksum = crc32(data);
      const local = zipHeader(30, (view) => {
        view.setUint32(0, 0x04034b50, true);
        view.setUint16(4, 20, true);
        view.setUint16(6, 0x0800, true);
        view.setUint16(8, 0, true);
        view.setUint16(10, stamp.time, true);
        view.setUint16(12, stamp.date, true);
        view.setUint32(14, checksum, true);
        view.setUint32(18, data.length, true);
        view.setUint32(22, data.length, true);
        view.setUint16(26, name.length, true);
        view.setUint16(28, 0, true);
      });
      localParts.push(local, name, data);
      const central = zipHeader(46, (view) => {
        view.setUint32(0, 0x02014b50, true);
        view.setUint16(4, 20, true);
        view.setUint16(6, 20, true);
        view.setUint16(8, 0x0800, true);
        view.setUint16(10, 0, true);
        view.setUint16(12, stamp.time, true);
        view.setUint16(14, stamp.date, true);
        view.setUint32(16, checksum, true);
        view.setUint32(20, data.length, true);
        view.setUint32(24, data.length, true);
        view.setUint16(28, name.length, true);
        view.setUint16(30, 0, true);
        view.setUint16(32, 0, true);
        view.setUint16(34, 0, true);
        view.setUint16(36, 0, true);
        view.setUint32(38, 0, true);
        view.setUint32(42, offset, true);
      });
      centralParts.push(central, name);
      offset += local.length + name.length + data.length;
    }
    const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
    const end = zipHeader(22, (view) => {
      view.setUint32(0, 0x06054b50, true);
      view.setUint16(4, 0, true);
      view.setUint16(6, 0, true);
      view.setUint16(8, files.length, true);
      view.setUint16(10, files.length, true);
      view.setUint32(12, centralSize, true);
      view.setUint32(16, offset, true);
      view.setUint16(20, 0, true);
    });
    return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
  }

  return { buildScorecardModel, createScorecardJpeg, createScorecardPdf, createZip };
});
