const express = require("express");
const axios = require("axios");
const cors = require("cors");
const loginRouter = require('./login');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(loginRouter);

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const PORT = process.env.PORT || 5000;

app.get("/api/movies", async (req, res) => {
  try {
    const response = await axios.get(`https://api.themoviedb.org/3/movie/popular?api_key=${TMDB_API_KEY}`);
    const data = response.data;
    console.log(data);
    res.json(data);
  } catch (error) {
    
    res.status(500).json({ error: "Failed to fetch movies" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
