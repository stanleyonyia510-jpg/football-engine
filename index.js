const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();

app.use(express.json());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function leagueXg(leagueName) {
  const name = (leagueName || "").toLowerCase();
  if (name.includes("premier league")) return 3.0;
  if (name.includes("la liga")) return 2.6;
  if (name.includes("bundesliga")) return 3.2;
  if (name.includes("serie a")) return 2.7;
  if (name.includes("ligue 1")) return 2.7;
  if (name.includes("champions league")) return 3.0;
  if (name.includes("europa")) return 2.9;
  if (name.includes("conference")) return 2.9;
  if (name.includes("mls")) return 3.2;
  if (name.includes("liga mx")) return 3.0;
  if (name.includes("brasileir")) return 2.4;
  if (name.includes("argentina")) return 2.2;
  if (name.includes("colombia")) return 2.1;
  if (name.includes("chile")) return 2.3;
  if (name.includes("libertadores")) return 2.2;
  if (name.includes("sudamericana")) return 2.1;
  if (name.includes("championship")) return 2.6;
  if (name.includes("japan") || name.includes("korea")) return 2.7;
  if (name.includes("nigeria") || name.includes("egypt") || name.includes("tunisia")) return 2.4;
  if (name.includes("bulgaria")) return 2.3;
  if (name.includes("girabola") || name.includes("angola")) return 2.2;
  if (name.includes("copa")) return 2.3;
  if (name.includes("cup")) return 2.7;
  return 2.5;
}

function leagueDraw(leagueName) {
  const name = (leagueName || "").toLowerCase();
  if (name.includes("ligue 1")) return 0.30;
  if (name.includes("serie a")) return 0.28;
  if (name.includes("argentina")) return 0.35;
  if (name.includes("colombia")) return 0.34;
  if (name.includes("chile")) return 0.32;
  if (name.includes("libertadores")) return 0.36;
  if (name.includes("sudamericana")) return 0.36;
  if (name.includes("copa")) return 0.32;
  if (name.includes("mls")) return 0.22;
  if (name.includes("bundesliga")) return 0.24;
  if (name.includes("premier league")) return 0.24;
  return 0.27;
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getTeamName(team) {
  if (!team) return "Unknown";
  if (typeof team === 'string') return team;
  if (team.name) return team.name;
  return "Unknown";
}

function normalize(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ====================== FINAL SIMPLE PARSER ======================
// Bzzoiro always writes: "Prediction:\n\n*WinningTeam X-Y LosingTeam.*"
// We extract the bolded prediction line and read it directly.
function parseAIPrediction(aiText, homeTeam, awayTeam) {
  if (!aiText) return null;

  const homeNorm = normalize(homeTeam);
  const awayNorm = normalize(awayTeam);

  // Split team names into first word (like "Sfaxien" from "CS Sfaxien")
  function firstWord(name) {
    const parts = name.split(" ").filter(function(p) { return p.length > 2; });
    return parts.length > 0 ? parts[parts.length - 1] : name;
  }
  const homeKey = firstWord(homeNorm);
  const awayKey = firstWord(awayNorm);

  // ============ METHOD 1: The "Prediction:" bold line ============
  // Matches: Prediction:\n\n*Winner 2-0 Loser.* OR Prediction: *Winner 2-0 Loser*
  const predMatch = aiText.match(/Prediction:\s*\n*\s*\\([^]+?)\\*/i);

  if (predMatch) {
    const predLine = predMatch[1];
    const predLineNorm = normalize(predLine);

    // Find the score (X-Y format)
    const scoreMatch = predLineNorm.match(/(\d+)\s+(\d+)/) || predLine.match(/(\d+)\s*[-–]\s*(\d+)/);

    if (scoreMatch) {
      // Get the part of the line BEFORE the score
      let beforeScore;
      if (scoreMatch.index !== undefined) {
        beforeScore = normalize(predLine.substring(0, scoreMatch.index));
      } else {
        beforeScore = predLineNorm;
      }

      // Check which team is in the "beforeScore" part
      const homeInBefore = beforeScore.indexOf(homeKey) !== -1;
      const awayInBefore = beforeScore.indexOf(awayKey) !== -1;

      if (homeInBefore && !awayInBefore) return "HOME";
      if (awayInBefore && !homeInBefore) return "AWAY";

      // If neither matched, try the whole prediction line
      const homeInLine = predLineNorm.indexOf(homeKey) !== -1;
      const awayInLine = predLineNorm.indexOf(awayKey) !== -1;

      if (homeInLine && !awayInLine) return "HOME";
      if (awayInLine && !homeInLine) return "AWAY";

      // If both, check position — the one mentioned first is likely the winner
      const homePos = predLineNorm.indexOf(homeKey);
      const awayPos = predLineNorm.indexOf(awayKey);
      if (homePos !== -1 && awayPos !== -1) {
        const hScore = parseInt(scoreMatch[1]);
        const aScore = parseInt(scoreMatch[2]);
        if (homePos < awayPos) {
          if (hScore > aScore) return "HOME";
          if (aScore > hScore) return "AWAY";
          return "DRAW";
        } else {
          if (hScore > aScore) return "AWAY";
          if (aScore > hScore) return "HOME";
          return "DRAW";
        }
      }
    }
  }

  // ============ METHOD 2: "Lean X to..." / "Back X" / "Favor X" ============
  const textNorm = normalize(aiText);
  const leanPatterns = [
    /lean\s+(?:towards?\s+)?([a-z0-9 ]{3,30}?)\s+to/i,
    /back(?:ing)?\s+([a-z0-9 ]{3,30}?)\s+to/i,
    /favor(?:ing)?\s+([a-z0-9 ]{3,30}?)\s+to/i,
    /expect\s+([a-z0-9 ]{3,30}?)\s+to/i,
    /([a-z0-9 ]{3,30}?)\s+to\s+(?:win|snatch|take|grind|continue)/i
  ];
  for (let i = 0; i < leanPatterns.length; i++) {
    const m = textNorm.match(leanPatterns[i]);
    if (m && m[1]) {
      const phrase = m[1];
      if (phrase.indexOf(homeKey) !== -1 && phrase.indexOf(awayKey) === -1) return "HOME";
      if (phrase.indexOf(awayKey) !== -1 && phrase.indexOf(homeKey) === -1) return "AWAY";
    }
  }

  // ============ METHOD 3: Bold headline winner phrases ============
  const boldMatches = aiText.match(/\\([^]+?)\\*/g);
  if (boldMatches) {
    let homeWins = 0, awayWins = 0;
    const winPhrases = ["rolling", "favorites", "favorit", "dominat", "have the edge", "win", "victor", "sharp", "clinical", "strong", "unbeaten", "on form"];
    const lossPhrases = ["freefall", "crisis", "struggling", "weak", "poor", "limping", "losing", "wobbling", "vulnerable", "in freefall"];
    
    boldMatches.forEach(function(bold) {
      const bLower = normalize(bold);
      const homeInBold = bLower.indexOf(homeKey) !== -1;
      const awayInBold = bLower.indexOf(awayKey) !== -1;
      winPhrases.forEach(function(w) {
        if (homeInBold && bLower.indexOf(w) !== -1) homeWins += 2;
        if (awayInBold && bLower.indexOf(w) !== -1) awayWins += 2;
      });
      lossPhrases.forEach(function(w) {
        if (homeInBold && bLower.indexOf(w) !== -1) awayWins += 1;
        if (awayInBold && bLower.indexOf(w) !== -1) homeWins += 1;
      });
    });
    if (homeWins > awayWins && homeWins >= 2) return "HOME";
    if (awayWins > homeWins && awayWins >= 2) return "AWAY";
  }

  // ============ METHOD 4: "X win" or "X have the edge" proximity ============
  let homeScore = 0, awayScore = 0;
  const winWords = ["win", "victory", "triumph", "dominant", "favorites", "edge", "stronger", "rolling", "sharp", "clinical", "unbeaten"];
  
  if (textNorm.indexOf(homeKey + " win") !== -1) homeScore += 3;
  if (textNorm.indexOf(homeKey + " victory") !== -1) homeScore += 3;
  if (textNorm.indexOf(homeKey + " have the edge") !== -1) homeScore += 3;
  if (textNorm.indexOf(homeKey + " to win") !== -1) homeScore += 3;
  if (textNorm.indexOf(homeKey + " to snatch") !== -1) homeScore += 3;
  
  if (textNorm.indexOf(awayKey + " win") !== -1) awayScore += 3;
  if (textNorm.indexOf(awayKey + " victory") !== -1) awayScore += 3;
  if (textNorm.indexOf(awayKey + " have the edge") !== -1) awayScore += 3;
  if (textNorm.indexOf(awayKey + " to win") !== -1) awayScore += 3;
  if (textNorm.indexOf(awayKey + " to snatch") !== -1) awayScore += 3;

  if (homeScore > awayScore && homeScore >= 3) return "HOME";
  if (awayScore > homeScore && awayScore >= 3) return "AWAY";

  return null;
}

function analyzeMatch(match) {
  const homeTeamName = getTeamName(match.home_team);
  const awayTeamName = getTeamName(match.away_team);

  let leagueName = "Unknown Competition";
  if (match.league && match.league.name) leagueName = match.league.name;
  else if (match.league_name) leagueName = match.league_name;

  const baseXg = leagueXg(leagueName);
  const drawFactor = leagueDraw(leagueName);
  const homeHash = hashString(homeTeamName);
  const awayHash = hashString(awayTeamName);

  const kickoffStr = match.event_date || match.date || "";
  const kickoffHour = parseInt(kickoffStr.substring(11, 13)) || 20;
  const timeBonus = (kickoffHour >= 19 || kickoffHour <= 1) ? 0.15 : -0.05;

  const homeMult = 0.85 + ((homeHash % 30) / 100);
  const awayMult = 0.85 + ((awayHash % 30) / 100);

  let homeXg = baseXg * 0.55 * homeMult + timeBonus;
  let awayXg = baseXg * 0.45 * awayMult + timeBonus * 0.5;
  homeXg *= 1.12;

  const hasScore = match.home_score !== null && match.home_score !== undefined && match.home_score !== "";
  const status = match.status || "unknown";
  const isPlayed = status === 'finished' || status === 'live' || status === 'inprogress' || status === '2nd_half' || status === '1st_half' || status === 'halftime';

  if (hasScore && isPlayed) {
    const actualH = parseInt(match.home_score) || 0;
    const actualA = parseInt(match.away_score) || 0;
    homeXg = (homeXg * 0.25) + (actualH * 0.65) + 0.5;
    awayXg = (awayXg * 0.25) + (actualA * 0.65) + 0.5;
  }

  homeXg = Math.max(0.5, Math.min(4.0, homeXg));
  awayXg = Math.max(0.4, Math.min(3.8, awayXg));
  const totalXg = homeXg + awayXg;

  const diff = homeXg - awayXg;
  let homeWinProb = Math.round(45 + (diff * 15));
  let awayWinProb = Math.round(30 - (diff * 15));
  let drawProb = Math.round(drawFactor * 100);

  homeWinProb = Math.max(15, Math.min(75, homeWinProb));
  awayWinProb = Math.max(12, Math.min(70, awayWinProb));
  drawProb = Math.max(10, Math.min(40, drawProb));

  let aiPreview = "";
  if (match.ai_preview && match.ai_preview.text) aiPreview = match.ai_preview.text;

  let aiPredictedWinner = null;
  if (aiPreview) {
    aiPredictedWinner = parseAIPrediction(aiPreview, homeTeamName, awayTeamName);
  }

  // OVERRIDE: When AI has a clear winner, use it
  if (aiPredictedWinner === "HOME") {
    homeWinProb = 60; drawProb = 22; awayWinProb = 18;
  } else if (aiPredictedWinner === "AWAY") {
    awayWinProb = 60; drawProb = 22; homeWinProb = 18;
  } else if (aiPredictedWinner === "DRAW") {
    drawProb = 38; homeWinProb = 31; awayWinProb = 31;
  }

  const totalP = homeWinProb + awayWinProb + drawProb;
  homeWinProb = Math.round((homeWinProb / totalP) * 100);
  awayWinProb = Math.round((awayWinProb / totalP) * 100);
  drawProb = 100 - homeWinProb - awayWinProb;

  function factorial(n) { return n <= 1 ? 1 : n * factorial(n - 1); }
  function poissonUnder(k, lambda) {
    let sum = 0;
    for (let i = 0; i <= k; i++) sum += Math.exp(-lambda) * Math.pow(lambda, i) / factorial(i);
    return Math.min(99, Math.max(1, sum * 100));
  }
  const under15 = Math.round(poissonUnder(1, totalXg));
  const under25 = Math.round(poissonUnder(2, totalXg));
  const under35 = Math.round(poissonUnder(3, totalXg));
  const under45 = Math.round(poissonUnder(4, totalXg));

  const homeScoresProb = 1 - Math.exp(-homeXg);
  const awayScoresProb = 1 - Math.exp(-awayXg);
  const bttsProb = Math.min(90, Math.max(25, Math.round(homeScoresProb * awayScoresProb * 100)));

  let confidence = 30;
  if (status === 'finished') confidence += 40;
  if (status === 'live' || status === 'inprogress' || status === '2nd_half') confidence += 30;
  if (hasScore) confidence += 15;
  if (aiPredictedWinner) confidence += 25;
  confidence = Math.min(95, confidence);

  let matchResultPrediction = "DRAW";
  if (homeWinProb > awayWinProb && homeWinProb > drawProb) matchResultPrediction = "HOME WIN";
  else if (awayWinProb > homeWinProb && awayWinProb > drawProb) matchResultPrediction = "AWAY WIN";

  let doubleChancePrediction = "HOME OR AWAY (12)";
  const dc1x = homeWinProb + drawProb;
  const dcx2 = awayWinProb + drawProb;
  const dc12 = homeWinProb + awayWinProb;
  if (dc1x >= dcx2 && dc1x >= dc12) doubleChancePrediction = "HOME OR DRAW (1X)";
  else if (dcx2 >= dc1x && dcx2 >= dc12) doubleChancePrediction = "AWAY OR DRAW (X2)";

  let safestBet = "NO BET";
  let safestProb = 0;
  const candidates = [
    { name: "HOME WIN", prob: homeWinProb },
    { name: "AWAY WIN", prob: awayWinProb },
    { name: "HOME DOUBLE CHANCE (1X)", prob: dc1x },
    { name: "AWAY DOUBLE CHANCE (X2)", prob: dcx2 },
    { name: "OVER 1.5 GOALS", prob: 100 - under15 },
    { name: "OVER 2.5 GOALS", prob: 100 - under25 },
    { name: "BTTS - YES", prob: bttsProb }
  ];
  candidates.forEach(function(c) {
    if (c.prob > safestProb && c.prob < 97) { safestProb = c.prob; safestBet = c.name; }
  });

  let verdict = "🔴 NO BET";
  if (safestProb > 60 && confidence > 50) verdict = "🟡 WAIT FOR MORE INFORMATION";
  if (safestProb > 72 && confidence > 65) verdict = "🟢 BET";

  let venue = "";
  if (match.venue && match.venue.name) venue = match.venue.name;
  let referee = "";
  if (match.referee && match.referee.name) referee = match.referee.name;

  return {
    matchId: match.id || null,
    match: {
      home: homeTeamName,
      away: awayTeamName,
      league: leagueName,
      kickoff: match.event_date || match.date || "Unknown",
      matchStatus: status,
      venue: venue,
      referee: referee
    },
    aiPreview: aiPreview,
    aiPredictedWinner: aiPredictedWinner,
    probabilities: { homeWin: homeWinProb, draw: drawProb, awayWin: awayWinProb },
    expectedGoals: { home: homeXg.toFixed(2), away: awayXg.toFixed(2), total: totalXg.toFixed(2) },
    predictions: { matchResult: matchResultPrediction, doubleChance: doubleChancePrediction },
    markets: {
      over15: 100 - under15, under15: under15,
      over25: 100 - under25, under25: under25,
      over35: 100 - under35, under35: under35,
      over45: 100 - under45, under45: under45,
      bttsYes: bttsProb, bttsNo: 100 - bttsProb
    },
    analysis: { confidence: confidence, safestBet: safestBet, probability: safestProb, verdict: verdict }
  };
}

app.get('/api/today', async (req, res) => {
  const API_KEY = process.env.BZZOIRO_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "API key not configured." });
  try {
    const listUrl = "https://sports.bzzoiro.com/api/events/?limit=50";
    const listResponse = await axios.get(listUrl, { headers: { Authorization: "Token " + API_KEY }, timeout: 15000 });
    const rawEvents = listResponse.data.results || [];
    if (rawEvents.length === 0) return res.json({ status: "no_matches", message: "No matches found." });
    const analyzedMatches = rawEvents.map(analyzeMatch);
    res.json({ status: "success", count: analyzedMatches.length, matches: analyzedMatches });
  } catch (error) {
    res.status(500).json({ error: "Failed: " + error.message });
  }
});

app.get('/api/analyze', async (req, res) => {
  const teamName = req.query.teamName || '';
  const API_KEY = process.env.BZZOIRO_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "API key not configured." });
  try {
    let listUrl;
    if (teamName && teamName.trim() !== '') {
      listUrl = "https://sports.bzzoiro.com/api/events/?team_name=" + encodeURIComponent(teamName) + "&limit=50";
    } else {
      listUrl = "https://sports.bzzoiro.com/api/events/?limit=50";
    }
    const listResponse = await axios.get(listUrl, { headers: { Authorization: "Token " + API_KEY }, timeout: 15000 });
    const rawEvents = listResponse.data.results || [];
    if (rawEvents.length === 0) return res.json({ status: "no_matches", message: "No matches found. Try another search." });
    const analyzedMatches = rawEvents.map(analyzeMatch);
    res.json({ status: "success", count: analyzedMatches.length, searchTerm: teamName, matches: analyzedMatches });
  } catch (error) {
    res.status(500).json({ error: "Failed: " + error.message });
  }
});

app.get('/api/live', async (req, res) => {
  const API_KEY = process.env.BZZOIRO_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "API key not configured." });
  try {
    let rawEvents = [];
    try {
      const liveUrl = "https://sports.bzzoiro.com/api/events/live/";
      const liveResponse = await axios.get(liveUrl, { headers: { Authorization: "Token " + API_KEY }, timeout: 10000 });
      rawEvents = liveResponse.data.results || [];
    } catch (e) {
      const listResponse = await axios.get("https://sports.bzzoiro.com/api/events/?limit=50", { headers: { Authorization: "Token " + API_KEY }, timeout: 10000 });
      const all = listResponse.data.results || [];
      rawEvents = all.filter(function(m) {
        const s = (m.status || "").toLowerCase();
        return s === 'live' || s === 'inprogress' || s === '2nd_half' || s === '1st_half' || s === 'halftime';
      });
    }
    const analyzedMatches = rawEvents.map(analyzeMatch);
    res.json({ status: "success", count: analyzedMatches.length, matches: analyzedMatches });
  } catch (error) {
    res.status(500).json({ error: "Failed: " + error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT))
