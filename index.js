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

// Get realistic xG for a league based on name
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
  if (name.includes("peru")) return 2.1;
  if (name.includes("libertadores")) return 2.2;
  if (name.includes("sudamericana")) return 2.1;
  if (name.includes("championship")) return 2.6;
  if (name.includes("j-league") || name.includes("japan")) return 2.7;
  if (name.includes("k league") || name.includes("korea")) return 2.6;
  if (name.includes("nigeria") || name.includes("egypt")) return 2.3;
  if (name.includes("australia")) return 2.8;
  if (name.includes("copa")) return 2.3;
  if (name.includes("cup")) return 2.7;
  return 2.5;
}

// Get league draw tendency
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

function analyzeMatch(match) {
  const homeTeamName = (match.home_team && match.home_team.name) ? match.home_team.name : (match.home_team || "Home Team");
  const awayTeamName = (match.away_team && match.away_team.name) ? match.away_team.name : (match.away_team || "Away Team");

  let leagueName = "Unknown Competition";
  if (match.league && match.league.name) leagueName = match.league.name;
  else if (match.league_name) leagueName = match.league_name;

  const baseXg = leagueXg(leagueName);
  const drawFactor = leagueDraw(leagueName);

  // ---- DIFFERENTIATION ----
  // Use team name hash + kickoff time to differentiate teams
  const homeHash = hashString(homeTeamName);
  const awayHash = hashString(awayTeamName);
  
  // Kickoff hour influences scoring (evening games = more goals historically)
  const kickoffStr = match.event_date || match.date || "";
  const kickoffHour = parseInt(kickoffStr.substring(11, 13)) || 20;
  const timeBonus = (kickoffHour >= 19 || kickoffHour <= 1) ? 0.15 : -0.05;

  // Home team strength varies by hash (0.85 to 1.15 multiplier)
  const homeMult = 0.85 + ((homeHash % 30) / 100);
  const awayMult = 0.85 + ((awayHash % 30) / 100);

  // Base xG
  let homeXg = baseXg * 0.55 * homeMult + timeBonus;
  let awayXg = baseXg * 0.45 * awayMult + timeBonus * 0.5;

  // Home advantage
  homeXg *= 1.12;

  // Use actual scores if available
  const hasScore = match.home_score !== null && match.home_score !== undefined && match.home_score !== "";
  const status = match.status || "unknown";
  const isPlayed = status === 'finished' || status === 'live' || status === 'inprogress' || status === '2nd_half' || status === '1st_half' || status === 'halftime';

  if (hasScore && isPlayed) {
    const actualH = parseInt(match.home_score) || 0;
    const actualA = parseInt(match.away_score) || 0;
    homeXg = (homeXg * 0.25) + (actualH * 0.65) + 0.5;
    awayXg = (awayXg * 0.25) + (actualA * 0.65) + 0.5;
  }

  // Round number influences
  const roundNum = parseInt(match.round_number) || 1;
  const roundFactor = 0.85 + Math.min(0.15, roundNum * 0.02);
  homeXg *= roundFactor;
  awayXg *= roundFactor;

  homeXg = Math.max(0.5, Math.min(4.0, homeXg));
  awayXg = Math.max(0.4, Math.min(3.8, awayXg));

  const totalXg = homeXg + awayXg;

  // 1X2 Probabilities using logistic-like curve
  const homeStrength = homeXg;
  const awayStrength = awayXg;
  const diff = homeStrength - awayStrength;

  let homeWinProb = Math.round(45 + (diff * 15));
  let awayWinProb = Math.round(30 - (diff * 15));
  let drawProb = Math.round(drawFactor * 100);

  // Normalize
  homeWinProb = Math.max(15, Math.min(75, homeWinProb));
  awayWinProb = Math.max(12, Math.min(70, awayWinProb));
  drawProb = Math.max(10, Math.min(40, drawProb));
  const totalP = homeWinProb + awayWinProb + drawProb;
  homeWinProb = Math.round((homeWinProb / totalP) * 100);
  awayWinProb = Math.round((awayWinProb / totalP) * 100);
  drawProb = 100 - homeWinProb - awayWinProb;

  // Poisson for over/under
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

  // BTTS
  const homeScoresProb = 1 - Math.exp(-homeXg);
  const awayScoresProb = 1 - Math.exp(-awayXg);
  const bttsProb = Math.min(90, Math.max(25, Math.round(homeScoresProb * awayScoresProb * 100)));

  // Confidence
  let confidence = 30;
  if (status === 'finished') confidence += 40;
  if (status === 'live' || status === 'inprogress' || status === '2nd_half') confidence += 30;
  if (hasScore) confidence += 15;
  confidence = Math.min(92, confidence);

  // Predictions
  let matchResultPrediction = "DRAW";
  if (homeWinProb > awayWinProb && homeWinProb > drawProb) matchResultPrediction = "HOME WIN";
  else if (awayWinProb > homeWinProb && awayWinProb > drawProb) matchResultPrediction = "AWAY WIN";

  let doubleChancePrediction = "HOME OR AWAY (12)";
  const dc1x = homeWinProb + drawProb;
  const dcx2 = awayWinProb + drawProb;
  const dc12 = homeWinProb + awayWinProb;
  if (dc1x >= dcx2 && dc1x >= dc12) doubleChancePrediction = "HOME OR DRAW (1X)";
  else if (dcx2 >= dc1x && dcx2 >= dc12) doubleChancePrediction = "AWAY OR DRAW (X2)";

  // Safest bet
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

  return {
    match: {
      home: homeTeamName,
      away: awayTeamName,
      league: leagueName,
      kickoff: match.event_date || match.date || "Unknown",
      matchStatus: status
    },
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

// TODAY & UPCOMING
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

// SEARCH — Get all matches for a team (upcoming, live, finished)
app.get('/api/analyze', async (req, res) => {
  const teamName = req.query.teamName || 'Arsenal';
  const API_KEY = process.env.BZZOIRO_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "API key not configured." });

  try {
    // Fetch with high limit to get as many matches as possible
    const listUrl = "https://sports.bzzoiro.com/api/events/?team_name=" + encodeURIComponent(teamName) + "&limit=50";
    const listResponse = await axios.get(listUrl, { headers: { Authorization: "Token " + API_KEY }, timeout: 12000 });
    let rawEvents = listResponse.data.results || [];

    if (rawEvents.length === 0) {
      return res.json({ status: "no_matches", message: "No matches found for " + teamName + ". Try another team name." });
    }

    // Filter: Only keep matches where the searched team is actually playing
    const searchLower = teamName.toLowerCase().trim();
    rawEvents = rawEvents.filter(function(event) {
      let homeName = "";
      let awayName = "";
      if (event.home_team && event.home_team.name) homeName = event.home_team.name.toLowerCase();
      else if (typeof event.home_team === 'string') homeName = event.home_team.toLowerCase();
      if (event.away_team && event.away_team.name) awayName = event.away_team.name.toLowerCase();
      else if (typeof event.away_team === 'string') awayName = event.away_team.toLowerCase();
      return homeName.includes(searchLower) || awayName.includes(searchLower);
    });

    if (rawEvents.length === 0) {
      return res.json({ status: "no_matches", message: "No matches found for " + teamName + "." });
    }

    const analyzedMatches = rawEvents.map(analyzeMatch);

    // Sort: live first, then upcoming, then finished
    analyzedMatches.sort(function(a, b) {
      const priority = { live: 0, inprogress: 0, "2nd_half": 0, "1st_half": 0, halftime: 0, upcoming: 1, notstarted: 1, scheduled: 1, finished: 2 };
      const aP = priority[a.match.matchStatus] !== undefined ? priority[a.match.matchStatus] : 1;
      const bP = priority[b.match.matchStatus] !== undefined ? priority[b.match.matchStatus] : 1;
      return aP - bP;
    });

    res.json({ status: "success", count: analyzedMatches.length, searchTerm: teamName, matches: analyzedMatches });
  } catch (error) {
    res.status(500).json({ error: "Failed: " + error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));
