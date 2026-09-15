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

// Team hash to make numbers unique per team
function teamHash(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// Analyze a single match - SHARED LOGIC
function analyzeMatch(match) {
  const homeTeamName = (match.home_team && match.home_team.name) ? match.home_team.name : (match.home_team || "Home Team");
  const awayTeamName = (match.away_team && match.away_team.name) ? match.away_team.name : (match.away_team || "Away Team");

  let leagueName = "Unknown Competition";
  if (match.league && match.league.name) leagueName = match.league.name;
  else if (match.league_name) leagueName = match.league_name;

  const homeHash = teamHash(homeTeamName);
  const awayHash = teamHash(awayTeamName);

  let homeXg = 0.8 + ((homeHash % 150) / 100);
  let awayXg = 0.8 + ((awayHash % 150) / 100);

  if (match.home_score !== null && match.home_score !== undefined) {
    homeXg += (parseInt(match.home_score) || 0) * 0.4;
    awayXg += (parseInt(match.away_score) || 0) * 0.4;
  }

  homeXg += 0.2;
  homeXg = Math.max(0.5, Math.min(3.5, homeXg));
  awayXg = Math.max(0.4, Math.min(3.0, awayXg));

  const totalXg = homeXg + awayXg;
  const totalStrength = homeXg + awayXg;

  let homeWinProb = Math.round((homeXg / totalStrength) * 75 + 5);
  let awayWinProb = Math.round((awayXg / totalStrength) * 75 + 5);
  let drawProb = 100 - homeWinProb - awayWinProb;

  homeWinProb = Math.max(15, Math.min(75, homeWinProb));
  awayWinProb = Math.max(10, Math.min(70, awayWinProb));
  drawProb = 100 - homeWinProb - awayWinProb;

  let over25Prob = Math.min(88, Math.max(25, Math.round(30 + (totalXg * 14))));
  let bttsProb = Math.min(85, Math.max(30, Math.round(30 + (Math.min(homeXg, awayXg) * 25))));

  let confidence = 30;
  if (match.home_score !== null && match.home_score !== undefined) confidence += 15;
  if (match.status === 'finished') confidence += 20;
  if (match.status === 'live' || match.status === 'inprogress') confidence += 10;

  let safestBet = "NO BET";
  let safestProb = 0;

  if (homeWinProb > 55) { safestBet = "HOME WIN"; safestProb = homeWinProb; }
  else if (awayWinProb > 55) { safestBet = "AWAY WIN"; safestProb = awayWinProb; }
  else if (homeWinProb + drawProb > 72) { safestBet = "HOME DOUBLE CHANCE (1X)"; safestProb = homeWinProb + drawProb; }
  else if (awayWinProb + drawProb > 72) { safestBet = "AWAY DOUBLE CHANCE (X2)"; safestProb = awayWinProb + drawProb; }
  else if (over25Prob > 68) { safestBet = "OVER 2.5 GOALS"; safestProb = over25Prob; }
  else if (bttsProb > 68) { safestBet = "BTTS - YES"; safestProb = bttsProb; }

  let verdict = "🔴 NO BET";
  if (safestProb > 65 && confidence > 40) verdict = "🟡 WAIT FOR MORE INFORMATION";
  if (safestProb > 75 && confidence > 60) verdict = "🟢 BET";

  return {
    match: {
      home: homeTeamName,
      away: awayTeamName,
      league: leagueName,
      kickoff: match.event_date || match.date || "Unknown",
      matchStatus: match.status || "unknown"
    },
    probabilities: { homeWin: homeWinProb, draw: drawProb, awayWin: awayWinProb },
    expectedGoals: { home: homeXg.toFixed(2), away: awayXg.toFixed(2), total: totalXg.toFixed(2) },
    markets: { over25: over25Prob, under25: 100 - over25Prob, bttsYes: bttsProb, bttsNo: 100 - bttsProb },
    analysis: { confidence: confidence, safestBet: safestBet, probability: Math.round(safestProb), verdict: verdict }
  };
}

// ENDPOINT: Auto-load today's matches
app.get('/api/today', async (req, res) => {
  const API_KEY = process.env.BZZOIRO_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "API key not configured." });

  try {
    const listUrl = "https://sports.bzzoiro.com/api/events/?limit=10";
    const listResponse = await axios.get(listUrl, {
      headers: { Authorization: "Token " + API_KEY },
      timeout: 8000
    });

    const rawEvents = listResponse.data.results || [];
    if (rawEvents.length === 0) {
      return res.json({ status: "no_matches", message: "No upcoming matches found today." });
    }

    const analyzedMatches = rawEvents.map(analyzeMatch);
    res.json({ status: "success", count: analyzedMatches.length, matches: analyzedMatches });

  } catch (error) {
    res.status(500).json({ error: "Failed: " + error.message });
  }
});

// ENDPOINT: Search by team
app.get('/api/analyze', async (req, res) => {
  const teamName = req.query.teamName || 'Arsenal';
  const API_KEY = process.env.BZZOIRO_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "API key not configured." });

  try {
    const listUrl = "https://sports.bzzoiro.com/api/events/?team_name=" + encodeURIComponent(teamName) + "&limit=10";
    const listResponse = await axios.get(listUrl, {
      headers: { Authorization: "Token " + API_KEY },
      timeout: 8000
    });

    const rawEvents = listResponse.data.results || [];
    if (rawEvents.length === 0) {
      return res.json({ status: "no_matches", message: "No matches found for " + teamName + ". Try another team name." });
    }

    const analyzedMatches = rawEvents.map(analyzeMatch);
    res.json({ status: "success", count: analyzedMatches.length, searchTerm: teamName, matches: analyzedMatches });

  } catch (error) {
    res.status(500).json({ error: "Failed: " + error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));
