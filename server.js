// ============================
// server.js (FINAL WORKING VERSION)
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
app.use(express.static("public")); // Serve HTML/CSS/JS

app.use(
    session({
        secret: "pathway-secret",
        resave: false,
        saveUninitialized: true,
    })
);

// ------------------ MONGODB CONNECTION ------------------
const mongoURI = process.env.MONGO_URI;

mongoose
    .connect(mongoURI)
    .then(() => console.log("✅ Connected to MongoDB Atlas"))
    .catch((err) => console.log(err));

// ------------------ USER MODEL ------------------
const userSchema = new mongoose.Schema({
    fullName: String,
    email: { type: String, unique: true },
    password: String,
});

const User = mongoose.model("User", userSchema);

// ------------------ LOGIN PROTECTION ------------------
function requireLogin(req, res, next) {
    if (!req.session.user) return res.redirect("/login.html");
    next();
}

app.get("/check-session", (req, res) => {
    if (req.session.user) {
        res.json({ loggedIn: true, user: req.session.user });
    } else {
        res.json({ loggedIn: false });
    }
});

// ------------------ GRIDFS STORAGE ------------------
let gfs;
const conn = mongoose.connection;

conn.once("open", () => {
    gfs = new mongoose.mongo.GridFSBucket(conn.db, { bucketName: "uploads" });
});

const storage = new GridFsStorage({
    url: mongoURI,
    file: (req, file) => ({
        filename: Date.now() + "-" + file.originalname,
        bucketName: "uploads",
    }),
});

const upload = multer({ storage });

// ------------------ REGISTER ------------------
app.post("/register", async (req, res) => {
    const { fullName, email, password } = req.body;

    const exists = await User.findOne({ email });
    if (exists) return res.json({ success: false, message: "Email already exists" });

    const hashed = await bcrypt.hash(password, 10);

    await new User({ fullName, email, password: hashed }).save();
    res.json({ success: true, message: "Account created" });
});

// ------------------ LOGIN ------------------
app.post("/login", async (req, res) => {
    const { email, password } = req.body;

    const found = await User.findOne({ email });
    if (!found) return res.json({ success: false, message: "User not found" });

    const match = await bcrypt.compare(password, found.password);
    if (!match) return res.json({ success: false, message: "Incorrect password" });

    req.session.user = found;
    res.json({ success: true, message: "Logged in", fullName: found.fullName });
});

// ------------------ UPLOAD RESUME (Protected) ------------------
app.post("/uploadResume", requireLogin, upload.single("resume"), (req, res) => {
    if (!req.file) return res.json({ success: false, message: "Upload failed" });

    res.json({
        success: true,
        message: "Resume uploaded successfully",
        file: req.file.filename,
    });
});

// ------------------ GET RESUMES ------------------
app.get("/resumes", requireLogin, (req, res) => {
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
        const articles = feed.items.slice(0, 10).map(item => ({
            title: item.title,
            link: item.link,
            pubDate: item.pubDate
        }));

        res.json({ success: true, articles });
    } catch (err) {
        res.json({ success: false, message: "Error fetching news" });
    }
});

// ------------------ PROTECT DASHBOARD ------------------
app.get("/dashboard.html", requireLogin, (req, res) => {
    res.sendFile(__dirname + "/public/dashboard.html");
});

// ------------------ START SERVER ------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
