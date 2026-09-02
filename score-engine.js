(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BerryCreekScoring = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const COURSE = Object.freeze({
    name: "The Club at Berry Creek",
    par: 72,
    defaultTee: "championship",
    holes: [
      { number: 1, par: 4 }, { number: 2, par: 3 }, { number: 3, par: 5 },
      { number: 4, par: 4 }, { number: 5, par: 4 }, { number: 6, par: 4 },
      { number: 7, par: 5 }, { number: 8, par: 3 }, { number: 9, par: 4 },
      { number: 10, par: 4 }, { number: 11, par: 5 }, { number: 12, par: 3 },
      { number: 13, par: 5 }, { number: 14, par: 4 }, { number: 15, par: 4 },
      { number: 16, par: 4 }, { number: 17, par: 3 }, { number: 18, par: 4 }
    ],
    strokeIndexes: {
      upper: [15, 17, 1, 5, 13, 3, 7, 11, 9, 8, 4, 10, 6, 12, 16, 14, 18, 2],
      lower: [14, 18, 2, 16, 8, 4, 6, 12, 10, 9, 1, 15, 3, 7, 11, 13, 17, 5]
    },
    tees: {
      championship: { name: "Championship", rating: 72.1, slope: 130, yards: [373,172,548,436,321,457,544,175,326,374,529,181,547,308,334,385,169,421], strokeSet: "upper" },
      member: { name: "Member", rating: 70.0, slope: 128, yards: [342,164,502,414,278,421,506,159,316,368,503,161,508,271,298,341,153,399], strokeSet: "upper" },
      memberCreekCombo: { name: "Member/Creek Combo", rating: 68.1, slope: 121, yards: [342,164,450,346,278,385,506,159,231,312,475,161,473,271,298,341,153,362], strokeSet: "upper" },
      creekMen: { name: "Creek (Men)", rating: 67.1, slope: 118, yards: [288,152,450,346,260,385,454,134,231,312,475,135,473,256,280,328,148,362], strokeSet: "lower" },
      creekWomen: { name: "Creek (Women)", rating: 72.0, slope: 123, yards: [288,152,450,346,260,385,454,134,231,312,475,135,473,256,280,328,148,362], strokeSet: "lower" },
      creekBerryCombo: { name: "Creek/Berry Combo", rating: 71.0, slope: 122, yards: [288,126,450,346,250,359,438,134,231,297,475,121,452,256,280,302,148,338], strokeSet: "lower" },
      berryMen: { name: "Berry (Men)", rating: 64.7, slope: 114, yards: [255,126,400,245,250,359,438,120,212,297,453,121,452,247,266,302,136,338], strokeSet: "lower" },
      berryWomen: { name: "Berry (Women)", rating: 70.0, slope: 120, yards: [255,126,400,245,250,359,438,120,212,297,453,121,452,247,266,302,136,338], strokeSet: "lower" }
    }
  });

  function teeForPlayer(course, player) {
    return course.tees[player?.teeKey] || course.tees[course.defaultTee];
  }

  function holesForPlayer(course, player) {
    const tee = teeForPlayer(course, player);
    const indexes = course.strokeIndexes[tee.strokeSet];
    return course.holes.map((hole, i) => ({ ...hole, yards: tee.yards[i], strokeIndex: indexes[i] }));
  }

  function roundHandicap(value) {
    return Math.round(Number(value) + Number.EPSILON);
  }

  function courseHandicap(index, slope, rating, par) {
    return roundHandicap(Number(index) * (Number(slope) / 113) + (Number(rating) - Number(par)));
  }

  function playingHandicap(index, settings, tee) {
    const rating = tee?.rating ?? settings.rating;
    const slope = tee?.slope ?? settings.slope;
    const course = courseHandicap(index, slope, rating, settings.par);
    return roundHandicap(course * (Number(settings.allowance) / 100));
  }

  function strokesForHole(handicap, strokeIndex) {
    const h = Math.trunc(Number(handicap) || 0);
    const si = Number(strokeIndex);
    if (h >= 0) return Math.floor(h / 18) + (si <= h % 18 ? 1 : 0);
    const owed = Math.abs(h);
    const given = Math.floor(owed / 18) + (si > 18 - (owed % 18) ? 1 : 0);
    return given ? -given : 0;
  }

  function netScore(gross, strokes) {
    if (gross === "" || gross === null || gross === undefined) return null;
    return Number(gross) - Number(strokes || 0);
  }

  function isEagle(gross, par) {
    return Number(gross) >= 1 && Number(gross) === Number(par) - 2;
  }

  function isBirdie(gross, par) {
    return Number(gross) >= 1 && Number(gross) === Number(par) - 1;
  }

  function segmentTotals(player, course, settings, start, end) {
    let gross = 0;
    let net = 0;
    let completed = true;
    const holes = holesForPlayer(course, player);
    const tee = teeForPlayer(course, player);
    for (let i = start; i < end; i += 1) {
      const score = player.scores[i];
      if (!Number.isFinite(Number(score)) || Number(score) < 1) {
        completed = false;
        continue;
      }
      const strokes = strokesForHole(playingHandicap(player.ghin, settings, tee), holes[i].strokeIndex);
      gross += Number(score);
      net += netScore(score, strokes);
    }
    return { gross, net, completed };
  }

  function playerTotals(player, course, settings) {
    const front = segmentTotals(player, course, settings, 0, 9);
    const back = segmentTotals(player, course, settings, 9, 18);
    return {
      front,
      back,
      total: {
        gross: front.gross + back.gross,
        net: front.net + back.net,
        completed: front.completed && back.completed
      }
    };
  }

  function leaders(players, course, settings, segment) {
    const eligible = players
      .map((player) => ({ player, totals: playerTotals(player, course, settings) }))
      .filter((item) => item.totals[segment].completed);
    if (!eligible.length) return [];
    const low = Math.min(...eligible.map((item) => item.totals[segment].net));
    return eligible.filter((item) => item.totals[segment].net === low).map((item) => item.player.id);
  }

  function skinResult(players, course, settings, holeIndex) {
    if (!players.length || holeIndex < 0 || holeIndex > 17) return { status: "pending", winnerId: null, lowNet: null };
    const entries = [];
    for (const player of players) {
      const gross = Number(player.scores[holeIndex]);
      if (!Number.isFinite(gross) || gross < 1) return { status: "pending", winnerId: null, lowNet: null };
      const hole = holesForPlayer(course, player)[holeIndex];
      const strokes = strokesForHole(playingHandicap(player.ghin, settings, teeForPlayer(course, player)), hole.strokeIndex);
      entries.push({ playerId: player.id, net: netScore(gross, strokes) });
    }
    const lowNet = Math.min(...entries.map((entry) => entry.net));
    const lowPlayers = entries.filter((entry) => entry.net === lowNet);
    if (lowPlayers.length !== 1) return { status: "tie", winnerId: null, lowNet };
    return { status: "awarded", winnerId: lowPlayers[0].playerId, lowNet };
  }

  function ticSummary(player, players, course, settings) {
    let birdies = 0;
    let eagles = 0;
    let skins = 0;
    let sandyPars = 0;
    let sandyBirdies = 0;
    let kps = 0;
    holesForPlayer(course, player).forEach((hole, i) => {
      const gross = Number(player.scores[i]);
      if (gross > 0 && gross <= hole.par - 1) birdies += 1;
      if (gross > 0 && gross <= hole.par - 2) eagles += 1;
      if (skinResult(players, course, settings, i).winnerId === player.id) skins += 1;
      if (player.sandies[i] && gross === hole.par) sandyPars += 1;
      if (player.sandies[i] && gross > 0 && gross <= hole.par - 1) sandyBirdies += 1;
      if (settings.kpWinners[String(hole.number)] === player.id) kps += 1;
    });
    const frontLeaders = leaders(players, course, settings, "front");
    const backLeaders = leaders(players, course, settings, "back");
    const totalLeaders = leaders(players, course, settings, "total");
    const front = frontLeaders.includes(player.id) ? 1 : 0;
    const back = backLeaders.includes(player.id) ? 1 : 0;
    const totalNet = totalLeaders.includes(player.id) ? 1 : 0;
    const frontWeight = front ? (frontLeaders.length === 1 ? 2 : 1) : 0;
    const backWeight = back ? (backLeaders.length === 1 ? 2 : 1) : 0;
    const totalNetWeight = totalNet ? (totalLeaders.length === 1 ? 2 : 1) : 0;
    const weightedTics = birdies + eagles + skins + frontWeight + backWeight + totalNetWeight + sandyPars + sandyBirdies + kps;
    return {
      birdies,
      eagles,
      skins,
      front,
      frontWeight,
      back,
      backWeight,
      totalNet,
      totalNetWeight,
      sandyPars,
      sandyBirdies,
      kps,
      total: birdies + skins + front + back + totalNet + sandyPars + sandyBirdies + kps,
      weightedTics,
      pointsEarned: weightedTics * 0.5
    };
  }

  function pointsLedger(player, players, course, settings) {
    const ownPoints = ticSummary(player, players, course, settings).pointsEarned;
    const positive = ownPoints * Math.max(0, players.length - 1);
    const losses = players
      .filter((other) => other.id !== player.id)
      .reduce((sum, other) => sum + ticSummary(other, players, course, settings).pointsEarned, 0);
    const negative = losses ? -losses : 0;
    return { achievementPoints: ownPoints, positive, negative, net: positive + negative };
  }

  return {
    COURSE,
    teeForPlayer,
    holesForPlayer,
    courseHandicap,
    playingHandicap,
    strokesForHole,
    netScore,
    isEagle,
    isBirdie,
    segmentTotals,
    playerTotals,
    leaders,
    skinResult,
    ticSummary,
    pointsLedger
  };
});
