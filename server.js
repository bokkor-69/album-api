const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const axios = require("axios");
const FormData = require("form-data");

const app = express();
dotenv.config();

// MongoDB Schema
const albumSchema = new mongoose.Schema({
  category: String,
  videos: [String]
});
const Album = mongoose.model("Album", albumSchema);

// MongoDB Connect
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error("❌ DB Error", err));

// Admin middleware
const isAdmin = (req, res, next) => {
  const { uid } = req.query;
  const adminUid = "61558455297317";

  if (uid !== adminUid) {
    return res.json({
      error: "❌ Only Bokkor x69 admin can use this command",
      author: "Bokkor"
    });
  }

  next();
};

// 🚀 FAST Catbox Upload (DIRECT API)
const uploadToCatbox = async (fileUrl) => {
  try {
    const fileRes = await axios.get(fileUrl, {
      responseType: "stream"
    });

    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append("fileToUpload", fileRes.data);

    const res = await axios.post(
      "https://catbox.moe/user/api.php",
      form,
      {
        headers: form.getHeaders(),
        maxBodyLength: Infinity
      }
    );

    if (typeof res.data === "string") {
      return res.data.trim();
    }

    return null;
  } catch (err) {
    console.error("❌ Catbox Upload Error:", err.message);
    return null;
  }
};

// Add video
app.get("/api/album/add/:category", async (req, res) => {
  const category = req.params.category.toLowerCase();
  const { url } = req.query;

  if (!url) {
    return res.json({ error: "❌ url parameter required", author: "Bokkor" });
  }

  const uploaded = await uploadToCatbox(url);

  if (!uploaded) {
    return res.json({ error: "❌ Upload failed", author: "Bokkor" });
  }

  let album = await Album.findOne({ category });

  if (!album) {
    album = new Album({ category, videos: [uploaded] });
  } else {
    if (album.videos.includes(uploaded)) {
      return res.json({ message: "⚠️ Already exists", author: "Bokkor" });
    }
    album.videos.push(uploaded);
  }

  await album.save();

  res.json({
    message: `✅ Added to ${category}`,
    total: album.videos.length,
    author: "Bokkor"
  });
});

// List categories
app.get("/api/album/list", async (req, res) => {
  const albums = await Album.find();

  const list = {};
  albums.forEach(a => {
    list[a.category] = a.videos.length;
  });

  res.json({
    total: albums.length,
    data: list,
    author: "Bokkor"
  });
});

// Random video
app.get("/api/album/:category", async (req, res) => {
  const category = req.params.category.toLowerCase();

  const album = await Album.findOne({ category });

  if (!album || album.videos.length === 0) {
    return res.json({ error: "❌ No videos found", author: "Bokkor" });
  }

  const randomVideo =
    album.videos[Math.floor(Math.random() * album.videos.length)];

  res.json({
    category,
    video: randomVideo,
    author: "Bokkor"
  });
});

// List videos
app.get("/api/album/:category/list", async (req, res) => {
  const category = req.params.category.toLowerCase();

  const album = await Album.findOne({ category });

  if (!album) {
    return res.json({ error: "❌ Category not found", author: "Bokkor" });
  }

  res.json({
    total: album.videos.length,
    videos: album.videos,
    author: "Bokkor"
  });
});

// Remove video
app.get("/api/album/remove/:category", isAdmin, async (req, res) => {
  const category = req.params.category.toLowerCase();
  const { url } = req.query;

  if (!url) {
    return res.json({ error: "❌ url required", author: "Bokkor" });
  }

  const album = await Album.findOne({ category });

  if (!album) {
    return res.json({ error: "❌ Category not found", author: "Bokkor" });
  }

  album.videos = album.videos.filter(v => v !== url);
  await album.save();

  res.json({
    message: `✅ Removed from ${category}`,
    total: album.videos.length,
    author: "Bokkor"
  });
});

// Delete category
app.get("/api/album/dlt/:category", isAdmin, async (req, res) => {
  const category = req.params.category;

  const existing = await Album.findOne({
    category: { $regex: new RegExp(`^${category}$`, "i") }
  });

  if (!existing) {
    return res.json({ error: "❌ Not found", author: "Bokkor" });
  }

  await Album.deleteOne({ category: existing.category });

  res.json({
    message: `🗑️ Deleted '${existing.category}'`,
    author: "Bokkor"
  });
});

// Export
app.get("/api/album/export", isAdmin, async (req, res) => {
  const data = await Album.find();

  res.json({
    total: data.length,
    data,
    author: "Bokkor"
  });
});

// Health check
app.get("/api/album", (req, res) => {
  res.json({
    message: "✅ API is running",
    author: "Bokkor x69"
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});