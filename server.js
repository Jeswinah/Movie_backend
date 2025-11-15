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
const BASE_URL = "https://api.themoviedb.org/3/discover/movie";

const GENRES = {
  comedy: 35,
  romance: 10749,
  crime: 80,
  thriller: 53,
};

async function fetchTamilMoviesByGenre(genreId) {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  const url = `${BASE_URL}?api_key=${TMDB_API_KEY}&with_original_language=ta&with_genres=${genreId}&with_release_type=4&primary_release_date.lte=${today}&sort_by=primary_release_date.desc&include_adult=false&region=IN`;

  const res = await axios.get(url);
  return res.data.results;
}

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
app.get("/api/movies/tamil", async (req, res) => {
  try {
    const [comedy, romance, crime, thriller] = await Promise.all([
      fetchTamilMoviesByGenre(GENRES.comedy),
      fetchTamilMoviesByGenre(GENRES.romance),
      fetchTamilMoviesByGenre(GENRES.crime),
      fetchTamilMoviesByGenre(GENRES.thriller),
    ]);

    res.json({
      comedy,
      romance,
      crime,
      thriller,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error fetching Tamil OTT movies" });
  }
});

app.get("/api/movie", async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ error: "Query parameter is required" });
    }
    console.log("Searching for:", query);
    const response = await axios.get(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}`);
    const data = response.data;
    console.log("Found movies:", data.results.length);
    res.json(data);
  } catch (error) {
    console.error("Search error:", error.message);
    res.status(500).json({ error: "Failed to search movies" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
