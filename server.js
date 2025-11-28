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
    const page=[];
    for(let i=1;i<=5;i++){
      page.push(axios.get(`https://api.themoviedb.org/3/movie/popular?api_key=${TMDB_API_KEY}&page=${i}`));
    }
    const responses = await Promise.all(page);
    const allResults = responses.reduce((acc, response) => {
      return acc.concat(response.data.results || []);
    }, []);
    // console.log(allResults);
    res.json({ results: allResults, total_results: allResults.length });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch movies" });
  }
});
app.get("/api/movies/tamil", async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const baseUrl = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&with_original_language=ta&with_release_type=4&primary_release_date.lte=${today}&sort_by=primary_release_date.desc&include_adult=false&region=IN`;

    
    const pagePromises = [];
    for (let page = 1; page <= 10; page++) {
      pagePromises.push(axios.get(`${baseUrl}&page=${page}`));
    }

    const responses = await Promise.all(pagePromises);
    
    // Combine all results from all pages
    const allResults = responses.reduce((acc, response) => {
      return acc.concat(response.data.results || []);
    }, []);

    // console.log("Tamil OTT movies:", allResults.length);
    res.json({ results: allResults, total_results: allResults.length });
  } catch (error) {
    console.error("Tamil OTT error:", error.message);
    res.status(500).json({ error: "Failed to fetch Tamil OTT movies" });
  }
});

app.get("/api/movie", async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ error: "Query parameter is required" });
    }
    // console.log("Searching for:", query);
    const response = await axios.get(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}`);
    const data = response.data;
    // console.log("Found movies:", data.results.length);
    res.json(data);
  } catch (error) {
    console.error("Search error:", error.message);
    res.status(500).json({ error: "Failed to search movies" });
  }
});

app.get("/api/stream/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const streamUrl = `https://player.videasy.net/movie/${id}?autoplay=1`;
    res.json({ streamUrl });
  } catch (error) {
    console.error("Stream error:", error.message);
    res.status(500).json({ error: "Failed to get stream URL" });
  }
});

app.get("/api/movie/:id", async (req, res) => {
  try {
    const { id } = req.params;
    // console.log("Fetching movie details for ID:", id);
    const response = await axios.get(`https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_API_KEY}`);
    res.json(response.data);
  } catch (error) {
    console.error("Movie details error:", error.message);
    res.status(500).json({ error: "Failed to fetch movie details" });
  }
});

app.use((req, res) => {
  res.status(404).send("<h1>404 Page Not Found</h1>");
  console.log("404 page not found");
  
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
