const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// Allow requests from anywhere (CORS)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

// Health check
app.get('/', (req, res) => {
  res.send('Football Engine is running!');
});

// Main endpoint
app.get('/api/analyze', async (req, res) => {
  const teamName = req.query.teamName || 'Arsenal';
  const API_KEY = process.env.BZZOIRO_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({ error: "API key not configured." });
  }

  try {
    // CORRECTED URL: sports.bzzoiro.com/api/events/
    const url = "https://sports.bzzoiro.com/api/events/?team_name=" + teamName + "&limit=5";
    
    const response = await axios.get(url, {
      headers: { Authorization: "Token " + API_KEY }
    });

    const events = response.data.results || [];
    
    res.json({ 
      status: "success", 
      count: events.length,
      matches: events 
    });

  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Failed to fetch from Bzzoiro: " + error.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));
