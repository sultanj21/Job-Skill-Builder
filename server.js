// ============================
// server.js (FULL VERSION)
// ============================

const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const session = require('express-session');
const multer = require('multer');
const { GridFsStorage } = require('multer-gridfs-storage');
const Parser = require('rss-parser');
const cors = require('cors');
require('dotenv').config();

const app = express();
const parser = new Parser();

// ------------------ MIDDLEWARE ------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static("public")); // for HTML/CSS/JS
app.use(
    session({
        secret: "pathway-secret",
        resave: false,
        saveUninitialized: true,
    })
);

// ------------------ MONGODB CONNECTION ------------------
const mongoURI = process.env.MONGO_URI || "your-mongodb-atlas-uri";

mongoose
    .connect(mongoURI)
    .then(() => console.log("✅ Connected to MongoDB Atlas"))
    .catch((err) => console.log(err));

// ------------------ USER MODEL ------------------
const userSchema = new mongoose.Schema({
    fullName: String,
    email: String,
    password: String,
});

const User = mongoose.model("User", userSchema);

// ------------------ GRIDFS STORAGE ------------------
let gfs;
const conn = mongoose.connection;

conn.once("open", () => {
    const gridfsBucket = new mongoose.mongo.GridFSBucket(conn.db, {
        bucketName: "uploads",
    });
    gfs = gridfsBucket;
});

// Storage engine
const storage = new GridFsStorage({
    url: mongoURI,
    file: (req, file) => {
        return {
            filename: Date.now() + "-" + file.originalname,
            bucketName: "uploads",
        };
    },
});

const upload = multer({ storage });

// ------------------ REGISTER ------------------
app.post("/register", async (req, res) => {
    const { fullName, email, password } = req.body;

    const userExists = await User.findOne({ email });
    if (userExists)
        return res.json({ success: false, message: "Email already exists" });

    const hashed = await bcrypt.hash(password, 10);

    const newUser = new User({
        fullName,
        email,
        password: hashed,
    });

    await newUser.save();
    res.json({ success: true, message: "Account created" });
});

// ------------------ LOGIN ------------------
app.post("/login", async (req, res) => {
    const { email, password } = req.body;

    const found = await User.findOne({ email });
    if (!found) return res.json({ success: false, message: "User not found" });

    const correct = await bcrypt.compare(password, found.password);
    if (!correct)
        return res.json({ success: false, message: "Incorrect password" });

    req.session.user = found;
    res.json({
        success: true,
        message: "Logged in successfully",
        fullName: found.fullName,
    });
});

// ------------------ UPLOAD RESUME ------------------
app.post("/uploadResume", upload.single("resume"), (req, res) => {
    if (!req.file)
        return res.json({ success: false, message: "File upload failure" });

    res.json({
        success: true,
        message: "Resume uploaded successfully",
        file: req.file.filename,
    });
});

// ------------------ GET UPLOADED RESUMES ------------------
app.get("/resumes", async (req, res) => {
    gfs.find().toArray((err, files) => {
        if (!files || files.length === 0)
            return res.json({ success: false, message: "No files found" });

        res.json({ success: true, files });
    });
});

// ------------------ YAHOO NEWS API ------------------
app.get("/api/news", async (req, res) => {
    try {
        const feed = await parser.parseURL("https://www.yahoo.com/news/rss");
        const articles = feed.items.slice(0, 10).map((item) => ({
            title: item.title,
            link: item.link,
            pubDate: item.pubDate,
        }));

        res.json({ success: true, articles });
    } catch (error) {
        res.json({ success: false, message: "Error fetching news" });
    }
});

// ------------------ START SERVER ------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
