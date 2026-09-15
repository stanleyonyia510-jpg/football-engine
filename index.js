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

// Helper: safely fetch data from Bzzoiro
async function fetchBzzoiro(endpoint, API_KEY) {
  try {
    const url = "https://sports.bzzoiro.com/api" + endpoint;
    const response = await axios.get(url, {
      headers: { Authorization: "Token " + API_KEY },
      timeout: 8000
    });
    return response.data;
  } catch (error) {
    return null;
  }
}

app.get('/api/analyze', async (req, res) => {
  const teamName = req.query.teamName || 'Arsenal';
  const API_KEY = process.env.BZZOIRO_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({ error: "API key not configured." });
  }

  try {
    // Step 1: Find matches for this team
    const listUrl = "https://sports.bzzoiro.com/api/events/?team_name=" + encodeURIComponent(teamName) + "&limit=10";
    const listResponse = await axios.get(listUrl, {
      headers: { Authorization: "Token " + API_KEY },
      timeout: 8000
    });

    const rawEvents = listResponse.data.results || [];

    if (rawEvents.length === 0) {
      return res.json({ 
        status: "no_matches", 
        message: "No matches found for " + teamName + ". Try another team name." 
      });
    }

    // Step 2: For each match, fetch detailed prediction + odds
    const analyzedMatches = [];

    for (let i = 0; i < rawEvents.length; i++) {
      const match = rawEvents[i];
      const matchId = match.id;

      // Fetch prediction and odds in parallel
      const [prediction, odds] = await Promise.all([
        matchId ? fetchBzzoiro("/events/" + matchId + "/prediction/", API_KEY) : null,
        matchId ? fetchBzzoiro("/events/" + matchId + "/odds/", API_KEY) : null
      ]);

      // Extract team names
      const homeTeamName = (match.home_team && match.home_team.name) ? match.home_team.name : (match.home_team || "Home Team");
      const awayTeamName = (match.away_team && match.away_team.name) ? match.away_team.name : (match.away_team || "Away Team");

      // Extract league
      let leagueName = "Unknown Competition";
      if (match.league && match.league.name) leagueName = match.league.name;
      else if (match.league_name) leagueName = match.league_name;

      // --- REAL PROBABILITY DATA ---
      let homeWinProb = 33, drawProb = 34, awayWinProb = 33;
      let homeXg = 1.4, awayXg = 1.4;
      let over25Prob = 50, bttsProb = 50;
      let confidence = 0;

      // If Bzzoiro gave us a prediction, use it!
      if (prediction && prediction.probabilities) {
        const p = prediction.probabilities;
        if (p.home_win) homeWinProb = Math.round(p.home_win * 100);
        if (p.draw) drawProb = Math.round(p.draw * 100);
        if (p.away_win) awayWinProb = Math.round(p.away_win * 100);
        confidence += 40;
      }

      // Use xG if available
      if (prediction && prediction.expected_goals) {
        homeXg = parseFloat(prediction.expected_goals.home) || homeXg;
        awayXg = parseFloat(prediction.expected_goals.away) || awayXg;
        confidence += 20;
      }

      // If no prediction, calculate from xG
      if (confidence === 0 && match.home_xg && match.away_xg) {
        homeXg = parseFloat(match.home_xg) || 1.4;
        awayXg = parseFloat(match.away_xg) || 1.4;
        homeWinProb = Math.round((homeXg / (homeXg + awayXg)) * 70);
        awayWinProb = Math.round((awayXg / (homeXg + awayXg)) * 70);
        drawProb = 100 - homeWinProb - awayWinProb;
        confidence += 30;
      }

      // Calculate markets from xG
      const totalXg = homeXg + awayXg;
      over25Prob = Math.min(85, Math.round(30 + (totalXg * 15)));
      bttsProb = Math.min(85, Math.round(30 + (Math.min(homeXg, awayXg) * 25)));

      // Real odds data
      if (odds && odds.results && odds.results.length > 0) {
        confidence += 10;
      }

      // Safest bet
      let safestBet = "NO BET";
      let safestProb = 0;

      if (homeWinProb > 55) { safestBet = "HOME WIN"; safestProb = homeWinProb; }
      else if (awayWinProb > 55) { safestBet = "AWAY WIN"; safestProb = awayWinProb; }
      else if (homeWinProb + drawProb > 75) { safestBet = "HOME DOUBLE CHANCE (1X)"; safestProb = homeWinProb + drawProb; }
      else if (awayWinProb + drawProb > 75) { safestBet = "AWAY DOUBLE CHANCE (X2)"; safestProb = awayWinProb + drawProb; }
      else if (over25Prob > 65) { safestBet = "OVER 2.5 GOALS"; safestProb = over25Prob; }
      else if (bttsProb > 65) { safestBet = "BTTS - YES"; safestProb = bttsProb; }

      let verdict = "🔴 NO BET";
      if (safestProb > 65 && confidence > 40) verdict = "🟡 WAIT FOR MORE INFORMATION";
      if (safestProb > 75 && confidence > 60) verdict = "🟢 BET";

      analyzedMatches.push({
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
      });
    }

    res.json({
      status: "success",
      count: analyzedMatches.length,
      searchTerm: teamName,
      matches: analyzedMatches
    });

  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Failed to fetch from Bzzoiro: " + error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));
