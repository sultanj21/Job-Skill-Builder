const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const session = require('express-session');
const multer = require('multer');
const { GridFsStorage } = require('multer-gridfs-storage');
const Parser = require('rss-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const parser = new Parser();

// ---------- MIDDLEWARE ----------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static("public"));

app.use(
    session({
        secret: "pathway-secret",
        resave: false,
        saveUninitialized: true,
    })
);

// ---------- MONGODB ----------
const mongoURI = process.env.MONGO_URI;

mongoose
    .connect(mongoURI)
    .then(() => console.log("✅ Connected to MongoDB Atlas"))
    .catch((err) => console.log(err));

// ---------- MODELS ----------
const userSchema = new mongoose.Schema({
    fullName: String,
    email: { type: String, unique: true },
    password: String,
    profilePicPath: String
});

const jobSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    title: String,
    company: String,
    status: String,
    date: String,
    createdAt: { type: Date, default: Date.now }
});

const interviewSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    company: String,
    role: String,
    date: String,
    time: String,
    notes: String,
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema);
const Job = mongoose.model("Job", jobSchema);
const Interview = mongoose.model("Interview", interviewSchema);

// ---------- AUTH MIDDLEWARE ----------
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

app.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true });
    });
});

// ---------- GRIDFS (RESUMES) ----------
let gfs;
const conn = mongoose.connection;

conn.once("open", () => {
    gfs = new mongoose.mongo.GridFSBucket(conn.db, { bucketName: "uploads" });
});

const gridFsStorage = new GridFsStorage({
    url: mongoURI,
    file: (req, file) => ({
        filename: Date.now() + "-" + file.originalname,
        bucketName: "uploads",
    }),
});

const resumeUpload = multer({ storage: gridFsStorage });

// ---------- PROFILE PICTURE UPLOAD (DISK) ----------
const profileDir = path.join(__dirname, "public/profile");
if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
}

const avatarStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, profileDir);
    },
    filename: (req, file, cb) => {
        const unique = Date.now() + "-" + file.originalname;
        cb(null, unique);
    }
});

const avatarUpload = multer({ storage: avatarStorage });

app.use("/profile", express.static(profileDir));

// ---------- AUTH ROUTES ----------
app.post("/register", async (req, res) => {
    const { fullName, email, password } = req.body;

    const exists = await User.findOne({ email });
    if (exists) return res.json({ success: false, message: "Email already exists" });

    const hashed = await bcrypt.hash(password, 10);
    const user = await new User({ fullName, email, password: hashed }).save();

    res.json({ success: true, message: "Account created", userId: user._id });
});

app.post("/login", async (req, res) => {
    const { email, password } = req.body;

    const found = await User.findOne({ email });
    if (!found) return res.json({ success: false, message: "User not found" });

    const match = await bcrypt.compare(password, found.password);
    if (!match) return res.json({ success: false, message: "Incorrect password" });

    req.session.user = {
        _id: found._id,
        fullName: found.fullName,
        email: found.email,
        profilePicPath: found.profilePicPath || null
    };

    res.json({ success: true, message: "Logged in", fullName: found.fullName });
});

// ---------- PROFILE PICTURE ROUTE ----------
app.post("/profile-picture", requireLogin, avatarUpload.single("avatar"), async (req, res) => {
    if (!req.file) return res.json({ success: false, message: "Upload failed" });

    const filePath = "/profile/" + req.file.filename;

    await User.findByIdAndUpdate(req.session.user._id, { profilePicPath: filePath });
    req.session.user.profilePicPath = filePath;

    res.json({ success: true, message: "Profile picture updated", path: filePath });
});

// ---------- RESUME UPLOAD + VIEW ----------
app.post("/uploadResume", requireLogin, resumeUpload.single("resume"), (req, res) => {
    if (!req.file) return res.json({ success: false, message: "Upload failed" });

    res.json({
        success: true,
        message: "Resume uploaded successfully",
        file: req.file.filename,
    });
});

app.get("/resumes", requireLogin, (req, res) => {
    gfs.find().toArray((err, files) => {
        if (!files || files.length === 0) {
            return res.json({ success: false, message: "No files found" });
        }
        res.json({ success: true, files });
    });
});

app.get("/resumes/file/:id", requireLogin, (req, res) => {
    try {
        const id = new mongoose.Types.ObjectId(req.params.id);
        gfs.find({ _id: id }).toArray((err, files) => {
            if (!files || !files.length) {
                return res.status(404).send("File not found");
            }
            res.set("Content-Type", files[0].contentType || "application/pdf");
            gfs.openDownloadStream(id).pipe(res);
        });
    } catch (e) {
        return res.status(400).send("Invalid file id");
    }
});

// ---------- JOB TRACKER API ----------
app.post("/api/jobs", requireLogin, async (req, res) => {
    const { title, company, status, date } = req.body;
    const job = await Job.create({
        userId: req.session.user._id,
        title,
        company,
        status,
        date,
    });
    res.json({ success: true, job });
});

app.get("/api/jobs", requireLogin, async (req, res) => {
    const jobs = await Job.find({ userId: req.session.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, jobs });
});

app.delete("/api/jobs/:id", requireLogin, async (req, res) => {
    await Job.deleteOne({ _id: req.params.id, userId: req.session.user._id });
    res.json({ success: true });
});

// ---------- INTERVIEW / CALENDAR API ----------
app.post("/api/interviews", requireLogin, async (req, res) => {
    const { company, role, date, time, notes } = req.body;
    const interview = await Interview.create({
        userId: req.session.user._id,
        company,
        role,
        date,
        time,
        notes
    });
    res.json({ success: true, interview });
});

app.get("/api/interviews", requireLogin, async (req, res) => {
    const interviews = await Interview.find({ userId: req.session.user._id }).sort({ date: 1, time: 1 });
    res.json({ success: true, interviews });
});

// ---------- JOB SUGGESTIONS (FAKE AI MATCHING) ----------
app.get("/api/job-suggestions", requireLogin, async (req, res) => {
    const suggestions = [
        { title: "Junior Software Developer", company: "TechNova", location: "Remote" },
        { title: "Backend Engineer Intern", company: "CloudCore", location: "Atlanta, GA" },
        { title: "Full-Stack Developer", company: "Pathway Labs", location: "Hybrid" },
        { title: "Front-End React Developer", company: "UIWorks", location: "Remote" },
        { title: "Cybersecurity Analyst Intern", company: "SecureNet", location: "On-site" }
    ];
    res.json({ success: true, suggestions });
});

// ---------- AI RESUME FORMATTER (SERVER-SIDE MOCK) ----------
app.post("/api/format-resume", requireLogin, (req, res) => {
    const { text } = req.body;
    if (!text || !text.trim()) {
        return res.json({ success: false, message: "No resume text provided" });
    }

    const lines = text.split("\n").map(l => l.trim()).filter(l => l);
    const formattedLines = lines.map(l => {
        if (l.startsWith("-") || l.startsWith("•")) return "- " + l.replace(/^[-•]+\s*/, "");
        return l;
    });

    const formattedText =
        "Professional Summary:\n" +
        formattedLines.join("\n");

    res.json({ success: true, formattedText });
});

// ---------- YAHOO NEWS ----------
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

// ---------- PROTECT DASHBOARD ----------
app.get("/dashboard.html", requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

// ---------- START ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌍 Open your website at: http://localhost:${PORT}`);

});
