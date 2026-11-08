const mongoose = require("mongoose");

const watchlistSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true, index: true },
  tmdbId: { type: Number, required: true },
  mediaType: { type: String, enum: ["movie", "tv"], default: "movie" },
  title: { type: String, required: true },
  posterPath: { type: String, default: null },
  overview: { type: String, default: "" },
  voteAverage: { type: Number, default: 0 },
  releaseDate: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now }
});

watchlistSchema.index({ user: 1, tmdbId: 1, mediaType: 1 }, { unique: true });

module.exports = mongoose.model("watchlist", watchlistSchema);
