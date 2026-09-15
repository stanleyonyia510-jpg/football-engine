const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// Allow requests from anywhere
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

// Health check endpoint
app.get('/', (req, res) => {
  res.send('Football Engine is running!');
});

// The main analysis endpoint
app.get('/api/analyze', async (req, res) => {
  const { teamName } = req.query;
  const API_KEY = process.env.BZZOIRO_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({ error: "API key not configured." });
  }

  try {
    const response = await axios.get(https://api.bzzoiro.com/v2/events/?team_name=${teamName}&limit=5, {
