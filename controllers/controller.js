const bcrypt = require("bcryptjs");
const User = require("../models/user.js");
const Watchlist = require("../models/watchlist.js");
const { generateToken } = require("../utils/jwt.js");

const signup = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email and password are required" });
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      password: hashedPassword
    });

    const token = generateToken(user);

    res.status(201).json({
      message: "Signup successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error("Signup error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const token = generateToken(user);

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const watchlistCount = await Watchlist.countDocuments({ user: req.user.id });

    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        date: user.date
      },
      watchlistCount
    });
  } catch (error) {
    console.error("Get profile error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

const updateProfile = async (req, res) => {
  try {
    const { name, email, currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(400).json({ message: "Name cannot be empty" });
      }
      user.name = name.trim();
    }

    if (email !== undefined) {
      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail) {
        return res.status(400).json({ message: "Email cannot be empty" });
      }
      if (normalizedEmail !== user.email) {
        const emailExists = await User.findOne({ email: normalizedEmail });
        if (emailExists) {
          return res.status(400).json({ message: "Email already in use" });
        }
        user.email = normalizedEmail;
      }
    }

    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ message: "Current password is required" });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ message: "New password must be at least 6 characters" });
      }

      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return res.status(400).json({ message: "Current password is incorrect" });
      }

      user.password = await bcrypt.hash(newPassword, 10);
    }

    await user.save();

    res.json({
      message: "Profile updated",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        date: user.date
      }
    });
  } catch (error) {
    console.error("Update profile error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

const deleteAccount = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    await Watchlist.deleteMany({ user: req.user.id });

    res.json({ message: "Account deleted" });
  } catch (error) {
    console.error("Delete account error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

const getWatchlist = async (req, res) => {
  try {
    const items = await Watchlist.find({ user: req.user.id }).sort({ createdAt: -1 });
    res.json({ items });
  } catch (error) {
    console.error("Get watchlist error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

const addToWatchlist = async (req, res) => {
  try {
    const { tmdbId, mediaType = "movie", title, posterPath, overview, voteAverage, releaseDate } = req.body;

    if (!tmdbId || !title) {
      return res.status(400).json({ message: "tmdbId and title are required" });
    }

    if (!["movie", "tv"].includes(mediaType)) {
      return res.status(400).json({ message: "mediaType must be movie or tv" });
    }

    const existing = await Watchlist.findOne({ user: req.user.id, tmdbId, mediaType });
    if (existing) {
      return res.status(200).json({ message: "Already in watchlist", item: existing });
    }

    const item = await Watchlist.create({
      user: req.user.id,
      tmdbId,
      mediaType,
      title,
      posterPath: posterPath || null,
      overview: overview || "",
      voteAverage: voteAverage || 0,
      releaseDate: releaseDate || ""
    });

    res.status(201).json({ message: "Added to watchlist", item });
  } catch (error) {
    console.error("Add to watchlist error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

const removeFromWatchlist = async (req, res) => {
  try {
    const { tmdbId } = req.params;
    const mediaType = req.query.mediaType || "movie";

    const item = await Watchlist.findOneAndDelete({
      user: req.user.id,
      tmdbId: Number(tmdbId),
      mediaType
    });

    if (!item) {
      return res.status(404).json({ message: "Item not found in watchlist" });
    }

    res.json({ message: "Removed from watchlist" });
  } catch (error) {
    console.error("Remove from watchlist error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  signup,
  login,
  getProfile,
  updateProfile,
  deleteAccount,
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist
};