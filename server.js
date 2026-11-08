const express = require("express");
const axios = require("axios");
const cors = require("cors");
const authRouter = require("./routes/route");
const authMiddleware = require("./middlewares/middleware");
const Watchlist = require("./models/watchlist");
const connectDb = require("./config/db");
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(authRouter);

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const OMDB_API_KEY = process.env.OMDB_API_KEY;
const PORT = process.env.PORT || 5000;
const API_CACHE_TTL_MS = 2 * 60 * 1000;
const apiCache = new Map();
const IMDB_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const imdbCache = new Map();
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

// ===== CATEGORY ENDPOINTS =====

// Movie Categories
app.get("/api/movies/category/:category", async (req, res) => {
  try {
    const { category } = req.params;
    const page = req.query.page || 1;
    const cacheKey = `movies:category:${category}:page:${page}`;
    const cached = getCachedValue(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const today = new Date().toISOString().split("T")[0];
    let url = "";

    switch (category) {
      case "popular":
        url = `https://api.themoviedb.org/3/movie/popular?api_key=${TMDB_API_KEY}&page=${page}`;
        break;
      case "top-rated":
        url = `https://api.themoviedb.org/3/movie/top_rated?api_key=${TMDB_API_KEY}&page=${page}`;
        break;
      case "now-playing":
        url = `https://api.themoviedb.org/3/movie/now_playing?api_key=${TMDB_API_KEY}&page=${page}`;
        break;
      case "upcoming":
        url = `https://api.themoviedb.org/3/movie/upcoming?api_key=${TMDB_API_KEY}&page=${page}`;
        break;
      case "in-theatres":
        url = `https://api.themoviedb.org/3/movie/now_playing?api_key=${TMDB_API_KEY}&page=${page}`;
        break;
      case "coming-soon":
        url = `https://api.themoviedb.org/3/movie/upcoming?api_key=${TMDB_API_KEY}&page=${page}`;
        break;
      case "for-rent":
        url = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&with_watch_monetization_types=rent&page=${page}&sort_by=popularity.desc`;
        break;
      case "new-on-streaming":
        url = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&with_watch_monetization_types=flatrate&page=${page}&sort_by=primary_release_date.desc`;
        break;
      case "new-on-netflix":
        url = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&with_watch_providers=8&watch_region=US&with_watch_monetization_types=flatrate&page=${page}&sort_by=primary_release_date.desc`;
        break;
      case "new-on-prime":
        url = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&with_watch_providers=9&watch_region=US&with_watch_monetization_types=flatrate&page=${page}&sort_by=primary_release_date.desc`;
        break;
      case "free-to-watch":
        url = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&with_watch_monetization_types=free&page=${page}&sort_by=popularity.desc`;
        break;
      case "top-rated":
        url = `https://api.themoviedb.org/3/movie/top_rated?api_key=${TMDB_API_KEY}&page=${page}`;
        break;
      case "calendar":
        const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
        url = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&primary_release_date.gte=${today}&primary_release_date.lte=${nextWeek}&sort_by=primary_release_date.asc&page=${page}`;
        break;
      default:
        return res.status(400).json({ error: "Invalid category" });
    }

    const response = await fetchTmdb(url);
    const payload = { results: response.data.results || [], total_results: response.data.total_results, page: response.data.page, total_pages: response.data.total_pages };
    setCachedValue(cacheKey, payload);
    res.json(payload);
  } catch (error) {
    console.error(`Category ${category} error:`, error.message);
    res.status(500).json({ error: "Failed to fetch category" });
  }
});

// TV Series Categories
app.get("/api/series/category/:category", async (req, res) => {
  try {
    const { category } = req.params;
    const page = req.query.page || 1;
    const cacheKey = `series:category:${category}:page:${page}`;
    const cached = getCachedValue(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const today = new Date().toISOString().split("T")[0];
    let url = "";

    switch (category) {
      case "popular":
        url = `https://api.themoviedb.org/3/tv/popular?api_key=${TMDB_API_KEY}&page=${page}`;
        break;
      case "top-rated":
        url = `https://api.themoviedb.org/3/tv/top_rated?api_key=${TMDB_API_KEY}&page=${page}`;
        break;
      case "airing-today":
        url = `https://api.themoviedb.org/3/tv/airing_today?api_key=${TMDB_API_KEY}&page=${page}`;
        break;
      case "on-the-air":
        url = `https://api.themoviedb.org/3/tv/on_the_air?api_key=${TMDB_API_KEY}&page=${page}`;
        break;
      case "airing-tonight":
        url = `https://api.themoviedb.org/3/tv/airing_today?api_key=${TMDB_API_KEY}&page=${page}`;
        break;
      case "new-series":
        url = `https://api.themoviedb.org/3/discover/tv?api_key=${TMDB_API_KEY}&first_air_date.gte=2024-01-01&sort_by=first_air_date.desc&page=${page}`;
        break;
      case "returning-this-week":
        const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
        url = `https://api.themoviedb.org/3/tv/on_the_air?api_key=${TMDB_API_KEY}&page=${page}&first_air_date.gte=${today}&first_air_date.lte=${nextWeek}`;
        break;
      case "currently-airing":
        url = `https://api.themoviedb.org/3/tv/on_the_air?api_key=${TMDB_API_KEY}&page=${page}`;
        break;
      case "top-rated":
        url = `https://api.themoviedb.org/3/tv/top_rated?api_key=${TMDB_API_KEY}&page=${page}`;
        break;
      default:
        return res.status(400).json({ error: "Invalid category" });
    }

    const response = await fetchTmdb(url);
    const payload = { results: response.data.results || [], total_results: response.data.total_results, page: response.data.page, total_pages: response.data.total_pages };
    setCachedValue(cacheKey, payload);
    res.json(payload);
  } catch (error) {
    console.error(`Series category ${category} error:`, error.message);
    res.status(500).json({ error: "Failed to fetch category" });
  }
});

// ===== END CATEGORY ENDPOINTS =====

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

app.get("/api/recommendations", authMiddleware, async (req, res) => {
  try {
    const watchlist = await Watchlist.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    if (!watchlist.length) {
      return res.json({ results: [], basedOn: [] });
    }

    const seeds = watchlist.slice(0, 5);
    const cacheKey = `recommendations:${req.user.id}:${seeds
      .map((seed) => `${seed.mediaType}${seed.tmdbId}`)
      .join("-")}`;
    const cached = getCachedValue(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const responses = await Promise.allSettled(
      seeds.map((seed) =>
        fetchTmdb(
          `https://api.themoviedb.org/3/${seed.mediaType}/${seed.tmdbId}/recommendations?api_key=${TMDB_API_KEY}`
        )
      )
    );

    const excluded = new Set(watchlist.map((item) => `${item.mediaType}:${item.tmdbId}`));
    const candidates = new Map();

    responses.forEach((response, index) => {
      if (response.status !== "fulfilled") return;

      const seed = seeds[index];
      const results = response.value.data.results || [];

      results.slice(0, 20).forEach((item) => {
        const key = `${seed.mediaType}:${item.id}`;
        if (excluded.has(key)) return;

        const existing = candidates.get(key) || { item, mediaType: seed.mediaType, score: 0 };
        existing.score += 1 / (index + 1);
        candidates.set(key, existing);
      });
    });

    const results = Array.from(candidates.values())
      .filter(({ item }) => item.poster_path)
      .sort((a, b) => b.score - a.score || (b.item.popularity || 0) - (a.item.popularity || 0))
      .slice(0, 28)
      .map(({ item, mediaType }) => ({ ...item, media_type: mediaType }));

    if (results.length < 28) {
      const fallbackSources = [
        { mediaType: "movie", path: "movie/popular" },
        { mediaType: "tv", path: "tv/popular" }
      ];

      const fallbackResponses = await Promise.allSettled(
        fallbackSources.map((source) =>
          fetchTmdb(`https://api.themoviedb.org/3/${source.path}?api_key=${TMDB_API_KEY}&page=1`)
        )
      );

      const existingKeys = new Set(results.map((item) => `${item.media_type}:${item.id}`));

      fallbackResponses.forEach((response, index) => {
        if (response.status !== "fulfilled") return;

        const { mediaType } = fallbackSources[index];
        const items = response.value.data.results || [];

        for (const item of items) {
          if (results.length >= 28) break;

          const key = `${mediaType}:${item.id}`;
          if (!item.poster_path || excluded.has(key) || existingKeys.has(key)) continue;

          results.push({ ...item, media_type: mediaType });
          existingKeys.add(key);
        }
      });
    }

    const payload = { results, basedOn: seeds.map((seed) => seed.title) };
    setCachedValue(cacheKey, payload);
    res.json(payload);
  } catch (error) {
    console.error("Recommendations error:", error.message);
    res.status(500).json({ results: [], error: "Failed to fetch recommendations" });
  }
});

app.get("/api/imdb-rating", async (req, res) => {
  try {
    const { tmdbId } = req.query;
    const mediaType = req.query.mediaType === "tv" ? "tv" : "movie";

    if (!tmdbId) {
      return res.status(400).json({ error: "tmdbId is required" });
    }

    const cacheKey = `${mediaType}:${tmdbId}`;
    const cached = imdbCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return res.json(cached.value);
    }

    if (!OMDB_API_KEY) {
      return res.json({ imdbId: null, rating: null, votes: null });
    }

    const externalIds = await fetchTmdb(
      `https://api.themoviedb.org/3/${mediaType}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`
    );
    const imdbId = externalIds.data?.imdb_id || null;

    if (!imdbId) {
      const payload = { imdbId: null, rating: null, votes: null };
      imdbCache.set(cacheKey, { value: payload, expiresAt: Date.now() + IMDB_CACHE_TTL_MS });
      return res.json(payload);
    }

    const omdbResponse = await axios.get(
      `https://www.omdbapi.com/?apikey=${OMDB_API_KEY}&i=${encodeURIComponent(imdbId)}`,
      { timeout: 10000 }
    );

    const parsedRating = parseFloat(omdbResponse.data?.imdbRating);
    const payload = {
      imdbId,
      rating: Number.isFinite(parsedRating) ? parsedRating : null,
      votes: omdbResponse.data?.imdbVotes || null
    };

    if (payload.rating !== null) {
      imdbCache.set(cacheKey, { value: payload, expiresAt: Date.now() + IMDB_CACHE_TTL_MS });
    }

    res.json(payload);
  } catch (error) {
    console.error("IMDb rating error:", error.message);
    res.status(500).json({ imdbId: null, rating: null, votes: null, error: "Failed to fetch IMDb rating" });
  }
});

app.get("/api/stream/:id", async (req, res) => {
  const streamUrl = `https://cinesrc.st/embed/movie/${req.params.id}`;
  const fallbackUrl = `https://vidsrc.to/embed/movie/${req.params.id}`;
  res.json({ streamUrl, fallbackUrl });
});

app.get("/api/series/stream/:id", async (req, res) => {
  const season = req.query.season || 1;
  const episode = req.query.episode || 1;
  const streamUrl = `https://cinesrc.st/embed/tv/${req.params.id}?s=${season}&e=${episode}`;
  const fallbackUrl = `https://vidsrc.to/embed/tv/${req.params.id}/${season}/${episode}`;
  res.json({ streamUrl, fallbackUrl });
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

// Trailer endpoints for movies and series
app.get("/api/movie/:id/videos", async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = `videos:movie:${id}`;
    const cached = getCachedValue(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const response = await fetchTmdb(`https://api.themoviedb.org/3/movie/${id}/videos?api_key=${TMDB_API_KEY}`);
    const videos = response.data.results || [];
    const trailer =
      videos.find((video) => video.site === "YouTube" && video.type === "Trailer" && video.official) ||
      videos.find((video) => video.site === "YouTube" && video.type === "Trailer") ||
      videos.find((video) => video.site === "YouTube" && video.type === "Teaser") ||
      null;

    const payload = { trailer };
    setCachedValue(cacheKey, payload);
    res.json(payload);
  } catch (error) {
    console.error("Movie trailer error:", error.message);
    res.status(500).json({ trailer: null, error: "Failed to fetch trailer" });
  }
});

app.get("/api/series/:id/videos", async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = `videos:series:${id}`;
    const cached = getCachedValue(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const response = await fetchTmdb(`https://api.themoviedb.org/3/tv/${id}/videos?api_key=${TMDB_API_KEY}`);
    const videos = response.data.results || [];
    const trailer =
      videos.find((video) => video.site === "YouTube" && video.type === "Trailer" && video.official) ||
      videos.find((video) => video.site === "YouTube" && video.type === "Trailer") ||
      videos.find((video) => video.site === "YouTube" && video.type === "Teaser") ||
      null;

    const payload = { trailer };
    setCachedValue(cacheKey, payload);
    res.json(payload);
  } catch (error) {
    console.error("Series trailer error:", error.message);
    res.status(500).json({ trailer: null, error: "Failed to fetch trailer" });
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
