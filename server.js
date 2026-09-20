const express = require("express");
const axios = require("axios");
const cors = require("cors");
const authRouter = require("./routes/route");
const connectDb = require("./config/db");
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(authRouter);

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const PORT = process.env.PORT || 5000;
const API_CACHE_TTL_MS = 2 * 60 * 1000;
const apiCache = new Map();
const TMDB_IMAGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const imageCache = new Map();

const allowedImageSizes = new Set(["w92", "w154", "w185", "w342", "w500", "w780", "w1280", "original"]);

const genreMap = {
  comedy: 35,
  romance: 10749,
  thriller: 53,
  action: 28,
  drama: 18,
  horror: 27,
  mystery: 9648
};

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const fetchTmdb = async (url, attempts = 2) => {
  try {
    return await axios.get(url, { timeout: 15000 });
  } catch (error) {
    const retryable = ["ECONNRESET", "ETIMEDOUT", "ECONNABORTED"].includes(error.code);
    if (!retryable || attempts === 0) throw error;
    await wait(500);
    return fetchTmdb(url, attempts - 1);
  }
};

const fetchPages = async (url, count) => {
  const responses = [];

  for (let page = 1; page <= count; page += 5) {
    const requests = Array.from(
      { length: Math.min(5, count - page + 1) },
      (_, index) => fetchTmdb(`${url}&page=${page + index}`)
    );
    responses.push(...await Promise.all(requests));
  }

  return responses;
};

const getCachedValue = (key) => {
  const cached = apiCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt < Date.now()) {
    apiCache.delete(key);
    return null;
  }
  return cached.value;
};

const setCachedValue = (key, value) => {
  apiCache.set(key, {
    value,
    expiresAt: Date.now() + API_CACHE_TTL_MS
  });
};

const getCachedImage = (key) => {
  const cached = imageCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt < Date.now()) {
    imageCache.delete(key);
    return null;
  }
  return cached.value;
};

const setCachedImage = (key, value) => {
  imageCache.set(key, {
    value,
    expiresAt: Date.now() + TMDB_IMAGE_CACHE_TTL_MS
  });
};
app.get("/ping", (req, res) => {
  res.status(200).send("OK");
});
app.get("/api/tmdb-image", async (req, res) => {
  try {
    const { path, size = "w342" } = req.query;

    if (!path || typeof path !== "string") {
      return res.status(400).json({ error: "Image path is required" });
    }

    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    if (normalizedPath.includes("://") || normalizedPath.includes("..")) {
      return res.status(400).json({ error: "Invalid image path" });
    }

    const safeSize = allowedImageSizes.has(size) ? size : "w342";
    const cacheKey = `${safeSize}:${normalizedPath}`;
    const cached = getCachedImage(cacheKey);

    if (cached) {
      res.setHeader("Content-Type", cached.contentType);
      res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
      return res.send(cached.buffer);
    }

    const imageUrl = `https://image.tmdb.org/t/p/${safeSize}${normalizedPath}`;
    const response = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 12000 });
    const buffer = Buffer.from(response.data);
    const contentType = response.headers["content-type"] || "image/jpeg";

    setCachedImage(cacheKey, { buffer, contentType });
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    res.send(buffer);
  } catch (error) {
    console.error("TMDB image proxy error:", error.message);
    const status = error?.response?.status || 502;
    res.status(status >= 400 && status < 600 ? status : 502).json({ error: "Failed to fetch image" });
  }
});
app.get("/api/movies", async (req, res) => {
  try {
    const cacheKey = "movies:popular";
    const cached = getCachedValue(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const responses = await fetchPages(
      `https://api.themoviedb.org/3/movie/popular?api_key=${TMDB_API_KEY}`,
      10
    );
    const allResults = responses.flatMap((response) => response.data.results || []);

    const payload = { results: allResults, total_results: allResults.length };
    setCachedValue(cacheKey, payload);
    res.json(payload);
  } catch (error) {
    console.error("Popular movies error:", error.message);
    res.status(500).json({ error: "Failed to fetch movies" });
  }
});

app.get("/api/movies/tamil", async (req, res) => {
  try {
    const genre = req.query.genre || "all";
    const cacheKey = genre === "all" ? "movies:tamil" : `movies:tamil:${genre}`;
    const cached = getCachedValue(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    let baseUrl = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&with_original_language=ta&with_release_type=4&primary_release_date.lte=${today}&sort_by=primary_release_date.desc&include_adult=false&region=IN`;
    
    // Add genre filter if specified
    if (genre !== "all" && genreMap[genre]) {
      baseUrl += `&with_genres=${genreMap[genre]}`;
    }
    const responses = await fetchPages(baseUrl, 35);
    const allResults = responses.flatMap((response) => response.data.results || []);

    const payload = { results: allResults, total_results: allResults.length };
    setCachedValue(cacheKey, payload);
    res.json(payload);
  } catch (error) {
    console.error("Tamil OTT error:", error.message);
    res.status(500).json({ error: "Failed to fetch Tamil OTT movies" });
  }
});

app.get("/api/movies/tamil/trending", async (req, res) => {
  try {
    const cacheKey = "movies:tamil:trending";
    const cached = getCachedValue(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const trendingNewTamilUrl = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&with_original_language=ta&primary_release_date.lte=${today}&sort_by=popularity.desc&include_adult=false&region=IN`;
    
    const responses = await fetchPages(trendingNewTamilUrl, 5);
    const allResults = responses.flatMap((response) => response.data.results || []);

    const payload = { results: allResults, total_results: allResults.length };
    setCachedValue(cacheKey, payload);
    res.json(payload);
  } catch (error) {
    console.error("Tamil trending error:", error.message);
    res.status(500).json({ error: "Failed to fetch Tamil trending movies" });
  }
});

app.get("/api/movie", async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ error: "Query parameter is required" });
    }

    const normalizedQuery = query.trim().toLowerCase();
    const cacheKey = `search:${normalizedQuery}`;
    const cached = getCachedValue(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const response = await fetchTmdb(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}`);
    const data = response.data || {};
    const filteredResults = (data.results || []).filter((item) => item.media_type === "movie" || item.media_type === "tv");

    const payload = { ...data, results: filteredResults };
    setCachedValue(cacheKey, payload);
    res.json(payload);
  } catch (error) {
    console.error("Search error:", error.message);
    res.status(500).json({ error: "Failed to search movies" });
  }
});

app.get("/api/series", async (req, res) => {
  try {
    const cacheKey = "series:popular";
    const cached = getCachedValue(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const responses = await fetchPages(
      `https://api.themoviedb.org/3/tv/popular?api_key=${TMDB_API_KEY}`,
      5
    );
    const allResults = responses.flatMap((response) => response.data.results || []);

    const payload = { results: allResults, total_results: allResults.length };
    setCachedValue(cacheKey, payload);
    res.json(payload);
  } catch (error) {
    console.error("Series error:", error.message);
    res.status(500).json({ error: "Failed to fetch series" });
  }
});

app.get("/api/stream/:id", async (req, res) => {
  const streamUrl = `https://cinesrc.st/embed/movie/${req.params.id}`;
  const fallbackUrl = `https://vidsrc.sbs/embed/movie/${req.params.id}`;
  const fallbackUrl2 = `https://player.videasy.net/movie/${req.params.id}`;
  res.json({ streamUrl, fallbackUrl, fallbackUrl2 });
});

app.get("/api/series/stream/:id", async (req, res) => {
  const season = req.query.season || 1;
  const episode = req.query.episode || 1;
  const streamUrl = `https://cinesrc.st/embed/tv/${req.params.id}?s=${season}&e=${episode}`;
  const fallbackUrl = `https://vidsrc.sbs/embed/tv/${req.params.id}/${season}/${episode}`;
  const fallbackUrl2 = `https://player.videasy.net/tv/${req.params.id}/${season}/${episode}?nextEpisode=true&autoplayNextEpisode=true&episodeSelector=true&overlay=true&color=8B5CF6`;
  res.json({ streamUrl, fallbackUrl, fallbackUrl2 });
});

app.get("/api/movie/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const response = await fetchTmdb(`https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_API_KEY}`);
    res.json(response.data);
  } catch (error) {
    console.error("Movie details error:", error.message);
    res.status(500).json({ error: "Failed to fetch movie details" });
  }
});

app.get("/api/series/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const response = await fetchTmdb(`https://api.themoviedb.org/3/tv/${id}?api_key=${TMDB_API_KEY}`);
    res.json(response.data);
  } catch (error) {
    console.error("Series details error:", error.message);
    res.status(500).json({ error: "Failed to fetch series details" });
  }
});

// Cast endpoints for movies and series
app.get("/api/movie/:id/credits", async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = `credits:movie:${id}`;
    const cached = getCachedValue(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const response = await fetchTmdb(`https://api.themoviedb.org/3/movie/${id}/credits?api_key=${TMDB_API_KEY}`);
    const cast = response.data.cast || [];
    const topCast = cast.slice(0, 12); // Get top 12 cast members
    
    const payload = { cast: topCast };
    setCachedValue(cacheKey, payload);
    res.json(payload);
  } catch (error) {
    console.error("Movie credits error:", error.message);
    res.status(500).json({ error: "Failed to fetch movie credits", cast: [] });
  }
});

app.get("/api/series/:id/credits", async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = `credits:series:${id}`;
    const cached = getCachedValue(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const response = await fetchTmdb(`https://api.themoviedb.org/3/tv/${id}/aggregate_credits?api_key=${TMDB_API_KEY}`);
    const cast = response.data.cast || [];
    const topCast = cast.slice(0, 12); // Get top 12 cast members
    
    const payload = { cast: topCast };
    setCachedValue(cacheKey, payload);
    res.json(payload);
  } catch (error) {
    console.error("Series credits error:", error.message);
    res.status(500).json({ error: "Failed to fetch series credits", cast: [] });
  }
});

const startServer = async () => {
  try {
    await connectDb();
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server due to database connection error:", error.message);
    process.exit(1);
  }
};

startServer();
