const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const axios = require("axios");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const FormData = require("form-data");

dotenv.config();
const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// 🛡️ 1. Rate Limiter (Spam Protection: 100 requests per 15 mins)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "❌ Too many requests from this IP, please try again later." }
});
app.use("/api/", apiLimiter);

// 🗄️ 2. Upgraded MongoDB Schema with Indexes & Analytics
const albumSchema = new mongoose.Schema({
  category: { type: String, required: true, lowercase: true, trim: true, unique: true, index: true },
  videos: [{ type: String, trim: true }],
  totalViews: { type: Number, default: 0 }
}, { timestamps: true });

const Album = mongoose.model("Album", albumSchema);

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI || "your_mongodb_uri_here")
  .then(() => console.log("✅ MongoDB Connected (v3.0 Engine)"))
  .catch(err => console.error("❌ DB Error:", err));

// 🔐 Admin Authentication Middleware
const isAdmin = (req, res, next) => {
  const { uid, secret } = req.query;
  const ADMIN_UID = "61558455297317";
  const SECRET_KEY = process.env.API_SECRET || "bokkor69";

  if (uid === ADMIN_UID || secret === SECRET_KEY) {
    return next();
  }
  return res.status(403).json({ error: "❌ Admin authorization required", author: "Bokkor" });
};

// 🚀 Strict Catbox Re-upload Engine
// (ক্যাটবক্স আপলোড ব্যর্থ হলে সরাসরি Error মারবে, অরিজিনাল লিংক ডেটাবেজে সেভ হতে দেবে না)
const processVideoUrl = async (fileUrl) => {
  if (fileUrl.includes("catbox.moe")) return fileUrl;

  // Attempt 1: Direct Stream to Official Catbox API
  try {
    const stream = await axios({
      method: "get",
      url: fileUrl,
      responseType: "stream",
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" 
      },
      timeout: 20000
    });

    const formData = new FormData();
    formData.append("reqtype", "fileupload");
    formData.append("fileToUpload", stream.data, "video.mp4");

    const catboxRes = await axios.post("https://catbox.moe/user/api.php", formData, {
      headers: formData.getHeaders(),
      timeout: 35000
    });

    if (catboxRes.data && typeof catboxRes.data === "string" && catboxRes.data.startsWith("http")) {
      console.log("✅ Successfully converted to Catbox:", catboxRes.data.trim());
      return catboxRes.data.trim();
    }
  } catch (err) {
    console.warn("⚠️ Direct Catbox upload failed, trying fallback API...", err.message);
  }

  // Attempt 2: Fallback to External Catbox API
  try {
    const res = await axios.get(
      `https://mahmud-apis-999.onrender.com/api/catbox?url=${encodeURIComponent(fileUrl)}`,
      { timeout: 15000 }
    );
    if (res.data?.status && res.data?.link) return res.data.link.trim();
  } catch (err) {
    console.warn("⚠️ External Catbox API failed:", err.message);
  }

  // 🛑 STRICT MODE: দুইটা মেথডই ফেল মারলে সরাসরি Error Throw করবে!
  throw new Error("Catbox upload failed! Video was not saved.");
};

// ==========================================
// 📌 PUBLIC ROUTES
// ==========================================

// Health Check
app.get("/", (req, res) => {
  res.json({ status: "online", version: "3.0", author: "Bokkor x69" });
});

// 📊 1. Aggregation-Powered Global Stats
app.get("/api/album/stats", async (req, res) => {
  try {
    const stats = await Album.aggregate([
      {
        $project: {
          category: 1,
          videoCount: { $size: "$videos" },
          totalViews: 1
        }
      },
      {
        $group: {
          _id: null,
          totalCategories: { $sum: 1 },
          totalVideos: { $sum: "$videoCount" },
          totalViews: { $sum: "$totalViews" }
        }
      }
    ]);

    const topCategory = await Album.findOne().sort({ totalViews: -1 }).select("category totalViews videos");

    res.json({
      summary: stats[0] || { totalCategories: 0, totalVideos: 0, totalViews: 0 },
      mostPopularCategory: topCategory ? {
        category: topCategory.category,
        views: topCategory.totalViews,
        count: topCategory.videos.length
      } : null,
      author: "Bokkor"
    });
  } catch (err) {
    res.status(500).json({ error: "❌ Failed to fetch stats", details: err.message });
  }
});

// 📁 2. List Categories (With Video Counts)
app.get("/api/album/list", async (req, res) => {
  try {
    const albums = await Album.find().select("category videos totalViews").lean();
    const list = {};

    albums.forEach(a => {
      list[a.category] = {
        count: a.videos.length,
        views: a.totalViews || 0
      };
    });

    res.json({ totalCategories: albums.length, data: list, author: "Bokkor" });
  } catch (err) {
    res.status(500).json({ error: "❌ Server Error", details: err.message });
  }
});

// 🔍 3. Category Search API
app.get("/api/album/search", async (req, res) => {
  try {
    const query = req.query.q?.toLowerCase().trim();
    if (!query) return res.status(400).json({ error: "❌ Search query 'q' required" });

    const results = await Album.find({ category: { $regex: query, $options: "i" } })
      .select("category videos totalViews")
      .lean();

    res.json({
      query,
      resultsCount: results.length,
      data: results.map(r => ({ category: r.category, count: r.videos.length, views: r.totalViews }))
    });
  } catch (err) {
    res.status(500).json({ error: "❌ Search failed", details: err.message });
  }
});

// ➕ 4. Add Single Video (Strict Mode)
app.get("/api/album/add/:category", async (req, res) => {
  try {
    const category = req.params.category.toLowerCase().trim();
    const { url } = req.query;

    if (!url) return res.status(400).json({ error: "❌ 'url' parameter required" });

    // Catbox এ কনভার্ট না হতে পারলে এটি সরাসরি Catch এ চলে যাবে
    const finalUrl = await processVideoUrl(url);

    const updatedAlbum = await Album.findOneAndUpdate(
      { category },
      { $addToSet: { videos: finalUrl } },
      { upsert: true, new: true }
    );

    res.json({
      message: `✅ Video added to '${category}'`,
      totalVideos: updatedAlbum.videos.length,
      url: finalUrl,
      author: "Bokkor"
    });
  } catch (err) {
    res.status(500).json({ 
      error: "❌ Add failed", 
      details: err.message || "Could not upload video to Catbox host." 
    });
  }
});

// 📑 5. Paginated Video List in Category
app.get("/api/album/:category/list", async (req, res) => {
  try {
    const category = req.params.category.toLowerCase().trim();
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const album = await Album.findOne({ category }).lean();
    if (!album) return res.status(404).json({ error: "❌ Category not found" });

    const startIndex = (page - 1) * limit;
    const paginatedVideos = album.videos.slice(startIndex, startIndex + limit);

    res.json({
      category,
      totalVideos: album.videos.length,
      currentPage: page,
      totalPages: Math.ceil(album.videos.length / limit),
      videos: paginatedVideos,
      author: "Bokkor"
    });
  } catch (err) {
    res.status(500).json({ error: "❌ Server error", details: err.message });
  }
});

// ==========================================
// 🔐 ADMIN ONLY ROUTES
// ==========================================

// 🗑️ Delete Entire Category (Admin Only)
app.get("/api/album/delete-category/:category", isAdmin, async (req, res) => {
  try {
    const category = req.params.category.toLowerCase().trim();
    const deletedAlbum = await Album.findOneAndDelete({ category });

    if (!deletedAlbum) {
      return res.status(404).json({ error: `Category '${category}' not found!` });
    }

    res.json({
      message: `Category '${category}' and all videos deleted successfully.`,
      author: "Bokkor"
    });
  } catch (err) {
    res.status(500).json({ error: "Deletion failed", details: err.message });
  }
});

// 📦 6. Bulk Add Videos (POST Method - Only saves successful Catbox links)
app.post("/api/album/bulk-add/:category", isAdmin, async (req, res) => {
  try {
    const category = req.params.category.toLowerCase().trim();
    const { urls } = req.body;

    if (!Array.isArray(urls) || !urls.length) {
      return res.status(400).json({ error: "❌ 'urls' must be a non-empty array" });
    }

    // Promise.allSettled ব্যবহার করে সফল আপলোডগুলো ফিল্টার করা হচ্ছে
    const results = await Promise.allSettled(urls.map(url => processVideoUrl(url)));
    const successfulUrls = results
      .filter(r => r.status === "fulfilled")
      .map(r => r.value);

    if (successfulUrls.length === 0) {
      return res.status(500).json({ 
        error: "❌ Bulk add failed. None of the provided URLs could be converted to Catbox." 
      });
    }

    const album = await Album.findOneAndUpdate(
      { category },
      { $addToSet: { videos: { $each: successfulUrls } } },
      { upsert: true, new: true }
    );

    res.json({
      message: `✅ Bulk added ${successfulUrls.length}/${urls.length} items to '${category}'`,
      totalVideos: album.videos.length,
      failedCount: urls.length - successfulUrls.length,
      author: "Bokkor"
    });
  } catch (err) {
    res.status(500).json({ error: "❌ Bulk add failed", details: err.message });
  }
});

// 🗑️ 7. Remove Single Video
app.get("/api/album/remove/:category", isAdmin, async (req, res) => {
  try {
    const category = req.params.category.toLowerCase().trim();
    const { url } = req.query;

    if (!url) return res.status(400).json({ error: "❌ 'url' parameter required" });

    const album = await Album.findOneAndUpdate(
      { category },
      { $pull: { videos: url } },
      { new: true }
    );

    if (!album) return res.status(404).json({ error: "❌ Category not found" });

    res.json({
      message: `✅ Video removed from '${category}'`,
      remainingVideos: album.videos.length,
      author: "Bokkor"
    });
  } catch (err) {
    res.status(500).json({ error: "❌ Remove failed", details: err.message });
  }
});

// 🧹 8. Database Clean-up (Removes empty categories & duplicate links)
app.get("/api/album/admin/cleanup", isAdmin, async (req, res) => {
  try {
    const albums = await Album.find();
    let cleanedCategories = 0;

    for (let album of albums) {
      if (album.videos.length === 0) {
        await Album.deleteOne({ _id: album._id });
        cleanedCategories++;
      } else {
        album.videos = [...new Set(album.videos)];
        await album.save();
      }
    }

    res.json({
      message: `✨ Database cleanup completed. Removed ${cleanedCategories} empty categories.`,
      author: "Bokkor"
    });
  } catch (err) {
    res.status(500).json({ error: "❌ Cleanup failed", details: err.message });
  }
});

// ==========================================
// 🎲 RANDOM VIDEO ROUTE (MUST BE AT THE BOTTOM)
// ==========================================
app.get("/api/album/:category", async (req, res) => {
  try {
    const category = req.params.category.toLowerCase().trim();

    const album = await Album.findOneAndUpdate(
      { category, "videos.0": { $exists: true } },
      { $inc: { totalViews: 1 } },
      { new: true }
    ).lean();

    if (!album || !album.videos.length) {
      return res.status(404).json({ error: `❌ No videos found in '${category}'` });
    }

    const randomVideo = album.videos[Math.floor(Math.random() * album.videos.length)];

    res.json({
      category,
      video: randomVideo,
      totalCategoryViews: album.totalViews,
      author: "Bokkor"
    });
  } catch (err) {
    res.status(500).json({ error: "❌ Server error", details: err.message });
  }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
