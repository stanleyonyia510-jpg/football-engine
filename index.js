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
  if (name.includes("mls") || name.includes("major league")) return 3.2;
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
  if (name.includes("bulgaria") || name.includes("parva")) return 2.3;
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

function normalizeTeamName(name) {
  return (name || "").toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
}

// Extract the predicted winner from the AI text using team name matching
function extractPredictedWinner(aiText, homeTeam, awayTeam) {
  if (!aiText) return null;
  const text = aiText.toLowerCase();
  const homeNorm = normalizeTeamName(homeTeam);
  const awayNorm = normalizeTeamName(awayTeam);
  
  // Get the last word of each team name (usually the most distinctive)
  const homeWords = homeNorm.split(/\s+/).filter(function(w) { return w.length > 3; });
  const awayWords = awayNorm.split(/\s+/).filter(function(w) { return w.length > 3; });
  const homeKey = homeWords.length > 0 ? homeWords[homeWords.length - 1] : homeNorm;
  const awayKey = awayWords.length > 0 ? awayWords[awayWords.length - 1] : awayNorm;

  // Score each team based on proximity to win keywords
  let homeScore = 0, awayScore = 0, drawScore = 0;

  // Keywords that strongly indicate a winner
  const homeWinKeywords = [homeKey + ' win', homeKey + ' victory', homeKey + ' triumph', 'favor ' + homeKey, homeKey + ' have the edge', homeKey + ' edge', homeKey + ' favorit'];
  const awayWinKeywords = [awayKey + ' win', awayKey + ' victory', awayKey + ' triumph', 'favor ' + awayKey, awayKey + ' have the edge', awayKey + ' edge', awayKey + ' favorit'];
  
  homeWinKeywords.forEach(function(k) { if (text.indexOf(k) !== -1) homeScore += 3; });
  awayWinKeywords.forEach(function(k) { if (text.indexOf(k) !== -1) awayScore += 3; });

  // Look for "Prediction:" line with a score
  const predictionMatch = aiText.match(/Prediction:\s*\\[^]?(\d+)\s*[-–]\s*(\d+)[^]?\\/i);
  if (predictionMatch) {
    const firstNum = parseInt(predictionMatch[1]);
    const secondNum = parseInt(predictionMatch[2]);
    // Find which team is mentioned immediately BEFORE the score
    const beforeScoreText = aiText.substring(0, predictionMatch.index).toLowerCase();
    const afterScoreText = aiText.substring(predictionMatch.index).toLowerCase();
    
    // Check the last 200 characters before the prediction
    const context = beforeScoreText.slice(-200) + afterScoreText.slice(0, 100);
    const homePos = context.lastIndexOf(homeKey);
    const awayPos = context.lastIndexOf(awayKey);
    
    if (homePos > awayPos && homePos !== -1) {
      // Home team mentioned more recently - home team is FIRST (winner if firstNum > secondNum)
      if (firstNum > secondNum) homeScore += 5;
      else if (secondNum > firstNum) awayScore += 5;
      else drawScore += 3;
    } else if (awayPos > homePos && awayPos !== -1) {
      // Away team mentioned more recently - away team is FIRST
      if (firstNum > secondNum) awayScore += 5;
      else if (secondNum > firstNum) homeScore += 5;
      else drawScore += 3;
    } else {
      // Fallback: assume home team first
      if (firstNum > secondNum) homeScore += 3;
      else if (secondNum > firstNum) awayScore += 3;
      else drawScore += 2;
    }
  }

  // Generic draw indicators
  if (text.indexOf('draw') !== -1 || text.indexOf('stalemate') !== -1) drawScore += 1;

  // Decide
  if (homeScore > awayScore && homeScore > drawScore) return "HOME";
  if (awayScore > homeScore && awayScore > drawScore) return "AWAY";
  if (drawScore > homeScore && drawScore > awayScore) return "DRAW";
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
  if (match.ai_preview && match.ai_preview.text) {
    aiPreview = match.ai_preview.text;
  }

  let aiPredictedWinner = null;
  if (aiPreview) {
    aiPredictedWinner = extractPredictedWinner(aiPreview, homeTeamName, awayTeamName);

    if (aiPredictedWinner === "HOME") {
      homeWinProb = Math.max(55, homeWinProb);
      awayWinProb = Math.min(awayWinProb, 20);
      drawProb = 100 - homeWinProb - awayWinProb;
    } else if (aiPredictedWinner === "AWAY") {
      awayWinProb = Math.max(55, awayWinProb);
      homeWinProb = Math.min(homeWinProb, 20);
      drawProb = 100 - homeWinProb - awayWinProb;
    } else if (aiPredictedWinner === "DRAW") {
      drawProb = Math.max(32, drawProb);
      homeWinProb = Math.min(homeWinProb, 36);
      awayWinProb = Math.min(awayWinProb, 36);
      const rem = 100 - drawProb;
      homeWinProb = Math.round(rem / 2);
      awayWinProb = 100 - drawProb - homeWinProb;
    }
  }

  const totalP = homeWinProb + awayWinProb + drawProb;
  homeWinProb = Math.round((homeWinProb / totalP) * 100);
  awayWinProb = Math.round((awayWinProb / totalP) * 100);
  drawProb = 100 - homeWinProb - awayWinProb;

  function factorial(n) { return n <= 1 ? 1 : n * factorial(n - 1); }
  function poissonUnder(k, lambda) {
    let sum = 0;
    for (let i = 0; i <= k; i++) {
      sum += Math.exp(-lambda) * Math.pow(lambda, i) / factorial(i);
    }
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
  if (aiPreview && aiPreview.length > 100) confidence += 20;
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
    const listUrl = "https://sports.bzzoiro.com/api/events/?limit=20";
    const listResponse = await axios.get(listUrl, { headers: { Authorization: "Token " + API_KEY }, timeout: 10000 });
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
      listUrl = "https://sports.bzzoiro.com/api/events/?team_name=" + encodeURIComponent(teamName) + "&limit=20";
    } else {
      listUrl = "https://sports.bzzoiro.com/api/events/?limit=20";
    }
    const listResponse = await axios.get(listUrl, { headers: { Authorization: "Token " + API_KEY }, timeout: 12000 });
    const rawEvents = listResponse.data.results || [];
    if (rawEvents.length === 0) return res.json({ status: "no_matches", message: "No matches found. Try another search." });
    const analyzedMatches = rawEvents.map(analyzeMatch);
    res.json({ status: "success", count: analyzedMatches.length, searchTerm: teamName, matches: analyzedMatches });
  } catch (error) {
    res.status(500).json({ error: "Failed: " + error.message });
  }
});

app.get('/api/analyze-one', async (req, res) => {
  const matchId = req.query.id;
  const API_KEY = process.env.BZZOIRO_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "API key not configured." });
  if (!matchId) return res.status(400).json({ error: "Match ID required." });
  try {
    const url = "https://sports.bzzoiro.com/api/events/" + matchId + "/";
    const response = await axios.get(url, { headers: { Authorization: "Token " + API_KEY }, timeout: 10000 });
    const match = response.data;
    if (!match || !match.id) return res.status(404).json({ error: "Match not found." });
    const analyzed = analyzeMatch(match);
    res.json({ status: "success", match: analyzed });
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
app.listen(PORT, () => console.log("Server running on port " + PORT));
