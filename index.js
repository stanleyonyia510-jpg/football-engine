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

function getTeamName(team) {
  if (!team) return "Unknown";
  if (typeof team === 'string') return team;
  if (team.name) return team.name;
  return "Unknown";
}

function normalizeName(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function coreName(name) {
  const stop = ["fc", "sc", "cf", "ac", "afc", "the", "and", "city", "club",
                "united", "de", "do", "da", "aif", "if", "sk", "cd", "cs", "us", "as",
                "sportif", "sportive", "clube", "sport", "sportivo", "sporting",
                "atletico", "athletic", "atlantico"];
  const words = normalizeName(name).split(" ").filter(function(w) {
    return w.length > 2 && stop.indexOf(w) === -1;
  });
  return words.join(" ");
}

function distinctiveKeyword(name) {
  const core = coreName(name);
  const words = core.split(" ").filter(function(w) { return w.length > 3; });
  if (words.length > 0) return words[words.length - 1];
  return core || normalizeName(name);
}

function extractPredictionLine(aiText) {
  if (!aiText) return null;
  const patterns = [
    /Prediction:\s*\n*\s*\\([^]+?)\\*/i,
    /Prediction:\s*\\([^]+?)\\*/i,
    /Prediction:\s*\n*\s*([^\n]+?)(?:\n|$)/i
  ];
  for (let i = 0; i < patterns.length; i++) {
    const m = aiText.match(patterns[i]);
    if (m && m[1] && m[1].trim().length > 3) return m[1].trim();
  }
  return null;
}

function parsePredictionScore(predictionLine) {
  if (!predictionLine) return null;
  const scorePatterns = [
    /(\d+)\s*[-–—]\s*(\d+)/,
    /(\d+)\s*:\s*(\d+)/
  ];
  for (let i = 0; i < scorePatterns.length; i++) {
    const m = predictionLine.match(scorePatterns[i]);
    if (m) {
      return {
        firstTeamText: predictionLine.substring(0, m.index).trim(),
        firstScore: parseInt(m[1]),
        secondScore: parseInt(m[2]),
        secondTeamText: predictionLine.substring(m.index + m[0].length).trim().replace(/^[.\s]+|[.\s]+$/g, "")
      };
    }
  }
  return null;
}

function matchTeamText(teamText, homeName, awayName) {
  if (!teamText || teamText.length < 2) return null;
  const textNorm = normalizeName(teamText);
  const homeCore = coreName(homeName);
  const awayCore = coreName(awayName);
  const homeKey = distinctiveKeyword(homeName);
  const awayKey = distinctiveKeyword(awayName);

  const homeCoreMatch = homeCore.length > 2 && textNorm.indexOf(homeCore) !== -1;
  const awayCoreMatch = awayCore.length > 2 && textNorm.indexOf(awayCore) !== -1;

  if (homeCoreMatch && !awayCoreMatch) return "HOME";
  if (awayCoreMatch && !homeCoreMatch) return "AWAY";

  const homeKeyMatch = homeKey && textNorm.indexOf(homeKey) !== -1;
  const awayKeyMatch = awayKey && textNorm.indexOf(awayKey) !== -1;

  if (homeKeyMatch && !awayKeyMatch) return "HOME";
  if (awayKeyMatch && !homeKeyMatch) return "AWAY";

  const homeFullMatch = textNorm.indexOf(normalizeName(homeName)) !== -1;
  const awayFullMatch = textNorm.indexOf(normalizeName(awayName)) !== -1;

  if (homeFullMatch && !awayFullMatch) return "HOME";
  if (awayFullMatch && !homeFullMatch) return "AWAY";

  return null;
}

function parseAIPrediction(aiText, homeTeam, awayTeam) {
  if (!aiText) return null;
  const homeName = getTeamName(homeTeam);
  const awayName = getTeamName(awayTeam);

  const predictionLine = extractPredictionLine(aiText);
  if (!predictionLine) return null;

  const parsed = parsePredictionScore(predictionLine);
  if (!parsed) return null;

  const firstTeamSide = matchTeamText(parsed.firstTeamText, homeName, awayName);
  const secondTeamSide = matchTeamText(parsed.secondTeamText, homeName, awayName);

  let predictedHomeScore = null;
  let predictedAwayScore = null;

  if (firstTeamSide === "HOME") {
    predictedHomeScore = parsed.firstScore;
    predictedAwayScore = parsed.secondScore;
  } else if (firstTeamSide === "AWAY") {
    predictedAwayScore = parsed.firstScore;
    predictedHomeScore = parsed.secondScore;
  } else if (secondTeamSide === "HOME") {
    predictedHomeScore = parsed.secondScore;
    predictedAwayScore = parsed.firstScore;
  } else if (secondTeamSide === "AWAY") {
    predictedAwayScore = parsed.secondScore;
    predictedHomeScore = parsed.firstScore;
  } else {
    return null;
  }

  let predictedWinner = "DRAW";
  if (predictedHomeScore > predictedAwayScore) predictedWinner = "HOME";
  else if (predictedAwayScore > predictedHomeScore) predictedWinner = "AWAY";

  return {
    predictedHomeScore: predictedHomeScore,
    predictedAwayScore: predictedAwayScore,
    predictedWinner: predictedWinner,
    predictionLine: predictionLine
  };
}

// ============ PROBABILITIES FROM SCORELINE ============
function probabilitiesFromScoreline(homeScore, awayScore, leagueName) {
  const totalGoals = homeScore + awayScore;
  const goalDiff = homeScore - awayScore;

  let homeWin, draw, awayWin;

  if (goalDiff >= 3) { homeWin = 78; draw = 12; awayWin = 10; }
  else if (goalDiff === 2) { homeWin = 68; draw = 18; awayWin = 14; }
  else if (goalDiff === 1) { homeWin = 55; draw = 24; awayWin = 21; }
  else if (goalDiff === 0) {
    if (totalGoals <= 1) { homeWin = 22; draw = 56; awayWin = 22; }
    else if (totalGoals <= 3) { homeWin = 28; draw = 44; awayWin = 28; }
    else { homeWin = 32; draw = 36; awayWin = 32; }
  }
  else if (goalDiff === -1) { homeWin = 21; draw = 24; awayWin = 55; }
  else if (goalDiff === -2) { homeWin = 14; draw = 18; awayWin = 68; }
  else { homeWin = 10; draw = 12; awayWin = 78; }

  const leagueDrawRate = leagueDraw(leagueName);
  const drawAdjust = (leagueDrawRate - 0.27) * 20;
  draw = Math.max(10, Math.min(50, draw + drawAdjust));
  const remaining = 100 - draw;
  const homeRatio = homeWin / (homeWin + awayWin);
  homeWin = Math.round(remaining * homeRatio);
  awayWin = 100 - draw - homeWin;

  return { homeWin: homeWin, draw: draw, awayWin: awayWin };
}

// ============ GOALS MARKETS FROM SCORELINE ============
function goalsFromScoreline(homeScore, awayScore) {
  const totalGoals = homeScore + awayScore;
  const homeScored = homeScore > 0;
  const awayScored = awayScore > 0;

  // Over/Under markets — exact based on total goals
  let over15, over25, over35, over45;
  if (totalGoals === 0) { over15 = 5; over25 = 2; over35 = 1; over45 = 0; }
  else if (totalGoals === 1) { over15 = 55; over25 = 18; over35 = 6; over45 = 2; }
  else if (totalGoals === 2) { over15 = 90; over25 = 45; over35 = 18; over45 = 6; }
  else if (totalGoals === 3) { over15 = 96; over25 = 78; over35 = 40; over45 = 15; }
  else if (totalGoals === 4) { over15 = 98; over25 = 90; over35 = 65; over45 = 32; }
  else if (totalGoals === 5) { over15 = 99; over25 = 95; over35 = 82; over45 = 55; }
  else { over15 = 99; over25 = 97; over35 = 90; over45 = 75; }

  // BTTS — based on whether both scored
  let bttsProb;
  if (homeScored && awayScored) {
    bttsProb = totalGoals >= 4 ? 90 : (totalGoals === 3 ? 82 : 70);
  } else if (homeScored && !awayScored) {
    bttsProb = 22;
  } else if (!homeScored && awayScored) {
    bttsProb = 20;
  } else {
    bttsProb = 8;
  }

  return {
    over15: over15, under15: 100 - over15,
    over25: over25, under25: 100 - over25,
    over35: over35, under35: 100 - over35,
    over45: over45, under45: 100 - over45,
    bttsYes: bttsProb, bttsNo: 100 - bttsProb
  };
}

// ============ FALLBACK FOR NO AI PREDICTION ============
function fallbackGoals() {
  return {
    over15: 68, under15: 32,
    over25: 45, under25: 55,
    over35: 22, under35: 78,
    over45: 8, under45: 92,
    bttsYes: 48, bttsNo: 52
  };
}

function analyzeMatch(match) {
  const homeTeamName = getTeamName(match.home_team);
  const awayTeamName = getTeamName(match.away_team);

  let leagueName = "Unknown Competition";
  if (match.league && match.league.name) leagueName = match.league.name;
  else if (match.league_name) leagueName = match.league_name;

  let aiPreview = "";
  if (match.ai_preview && match.ai_preview.text) aiPreview = match.ai_preview.text;

  let aiPrediction = null;
  if (aiPreview) {
    aiPrediction = parseAIPrediction(aiPreview, match.home_team, match.away_team);
  }

  // ---- PROBABILITIES ----
  let homeWinProb, drawProb, awayWinProb;
  if (aiPrediction) {
    const probs = probabilitiesFromScoreline(aiPrediction.predictedHomeScore, aiPrediction.predictedAwayScore, leagueName);
    homeWinProb = probs.homeWin;
    drawProb = probs.draw;
    awayWinProb = probs.awayWin;
  } else {
    homeWinProb = 40;
    drawProb = 28;
    awayWinProb = 32;
  }

  // ---- GOALS & BTTS ----
  let markets;
  if (aiPrediction) {
    markets = goalsFromScoreline(aiPrediction.predictedHomeScore, aiPrediction.predictedAwayScore);
  } else {
    markets = fallbackGoals();
  }

  // ---- PREDICTIONS ----
  let matchResultPrediction = "NO CLEAR AI PREDICTION";
  let doubleChancePrediction = "NO CLEAR AI PREDICTION";

  if (aiPrediction) {
    if (aiPrediction.predictedWinner === "HOME") {
      matchResultPrediction = "HOME WIN";
      doubleChancePrediction = "HOME OR DRAW (1X)";
    } else if (aiPrediction.predictedWinner === "AWAY") {
      matchResultPrediction = "AWAY WIN";
      doubleChancePrediction = "AWAY OR DRAW (X2)";
    } else {
      matchResultPrediction = "DRAW";
      doubleChancePrediction = "HOME OR DRAW (1X)";
    }
  }

  // ---- SAFEST BET ----
  let safestBet = "NO BET";
  let safestProb = 0;

  if (aiPrediction) {
    if (aiPrediction.predictedWinner === "HOME") { safestBet = "HOME WIN"; safestProb = homeWinProb; }
    else if (aiPrediction.predictedWinner === "AWAY") { safestBet = "AWAY WIN"; safestProb = awayWinProb; }
    else { safestBet = "DRAW"; safestProb = drawProb; }
  }

  // ---- CONFIDENCE ----
  let confidence = 40;
  if (aiPrediction) confidence += 20;
  const status = match.status || "unknown";
  const hasScore = match.home_score !== null && match.home_score !== undefined && match.home_score !== "";
  if (hasScore) confidence += 10;
  if (status === 'finished') confidence += 10;
  confidence = Math.min(85, confidence);

  let confidenceLabel = "LOW";
  if (confidence >= 50) confidenceLabel = "MODERATE";
  if (confidence >= 70) confidenceLabel = "HIGH";

  // ---- VERDICT ----
  let verdict = "🔴 NO BET";
  if (aiPrediction && confidence >= 50) verdict = "🟡 WAIT FOR MORE INFORMATION";
  if (aiPrediction && confidence >= 60 && safestProb >= 50) verdict = "🟢 BET";

  let venue = "";
  if (match.venue && match.venue.name) venue = match.venue.name;
  let referee = "";
  if (match.referee && match.referee.name) referee = match.referee.name;

  const aiPredictionOutput = aiPrediction ? {
    predictedHomeScore: aiPrediction.predictedHomeScore,
    predictedAwayScore: aiPrediction.predictedAwayScore,
    predictedWinner: aiPrediction.predictedWinner,
    predictionLine: aiPrediction.predictionLine
  } : null;

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
    aiPrediction: aiPredictionOutput,
    probabilities: { homeWin: homeWinProb, draw: drawProb, awayWin: awayWinProb },
    markets: markets,
    predictions: {
      matchResult: matchResultPrediction,
      doubleChance: doubleChancePrediction
    },
    analysis: {
      confidence: confidence,
      confidenceLabel: confidenceLabel,
      safestBet: safestBet,
      probability: safestProb,
      verdict: verdict
    }
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
app.listen(PORT, () => console.log("Server running on port " + PORT));
