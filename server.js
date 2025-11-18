const express = require('express');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Parser = require('rss-parser');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const parser = new Parser();

// ---------- SUPABASE ----------
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ---------- MIDDLEWARE ----------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static("public"));

app.use(
    session({
        secret: process.env.SESSION_SECRET || "pathway-secret",
        resave: false,
        saveUninitialized: true,
    })
);

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

// ---------- PROFILE PICTURES (DISK, OPTIONAL) ----------
const profileDir = path.join(__dirname, "public/profile");
if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
}
const profileUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, profileDir),
        filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
    }),
});

app.use("/profile", express.static(profileDir));

// ---------- AUTH ROUTES (REGISTER / LOGIN) ----------

// Register: expects FULL reg data
app.post("/register", async (req, res) => {
    try {
        const {
            firstName,
            lastName,
            birthday,
            email,
            occupation,
            password,
            street,
            city,
            state,
            zip,
            college,
            certificate,
            gradDate
        } = req.body;

        // Check if email exists
        const { data: existing, error: existingErr } = await supabase
            .from("users")
            .select("id")
            .eq("email", email)
            .maybeSingle();

        if (existingErr) {
            console.error(existingErr);
            return res.json({ success: false, message: "Database error" });
        }

        if (existing) {
            return res.json({ success: false, message: "Email already exists" });
        }

        const hashed = await bcrypt.hash(password, 10);

        const { data: inserted, error: insertErr } = await supabase
            .from("users")
            .insert({
                full_name: `${firstName} ${lastName}`,
                email,
                password: hashed,
                birthday,
                occupation,
                street,
                city,
                state,
                zip,
                college,
                certificate,
                grad_date: gradDate
            })
            .select()
            .single();

        if (insertErr) {
            console.error(insertErr);
            return res.json({ success: false, message: "Could not create user" });
        }

        res.json({ success: true, message: "Account created", userId: inserted.id });
    } catch (err) {
        console.error(err);
        res.json({ success: false, message: "Server error" });
    }
});

// Login
app.post("/login", async (req, res) => {
    const { email, password } = req.body;

    const { data: user, error } = await supabase
        .from("users")
        .select("*")
        .eq("email", email)
        .single();

    if (error || !user) {
        return res.json({ success: false, message: "User not found" });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.json({ success: false, message: "Incorrect password" });

    req.session.user = {
        _id: user.id,
        fullName: user.full_name,
        email: user.email,
        birthday: user.birthday,
        occupation: user.occupation,
        street: user.street,
        city: user.city,
        state: user.state,
        zip: user.zip,
        college: user.college,
        certificate: user.certificate,
        gradDate: user.grad_date,
        profilePicPath: user.profile_pic_url || null
    };

    res.json({ success: true, message: "Logged in" });
});

// ---------- PROFILE PICTURE ROUTE ----------
app.post("/profile-picture", requireLogin, profileUpload.single("avatar"), async (req, res) => {
    if (!req.file) return res.json({ success: false, message: "Upload failed" });

    const filePath = "/profile/" + req.file.filename;

    // Save in DB
    const { error } = await supabase
        .from("users")
        .update({ profile_pic_url: filePath })
        .eq("id", req.session.user._id);

    if (error) {
        console.error(error);
        return res.json({ success: false, message: "Could not update profile" });
    }

    req.session.user.profilePicPath = filePath;

    res.json({ success: true, message: "Profile picture updated", path: filePath });
});

// ---------- RESUME UPLOAD (SUPABASE STORAGE) ----------
const resumeUpload = multer({ storage: multer.memoryStorage() });

app.post("/uploadResume", requireLogin, resumeUpload.single("resume"), async (req, res) => {
    try {
        if (!req.file) return res.json({ success: false, message: "No file uploaded" });

        const userId = req.session.user._id;
        const file = req.file;
        const filePath = `${userId}/${Date.now()}-${file.originalname}`;

        // Upload to Supabase Storage
        const { error: uploadErr } = await supabase.storage
            .from("resumes")
            .upload(filePath, file.buffer, { contentType: file.mimetype });

        if (uploadErr) {
            console.error(uploadErr);
            return res.json({ success: false, message: "Error uploading resume" });
        }

        const { data: pub } = supabase.storage.from("resumes").getPublicUrl(filePath);
        const fileUrl = pub.publicUrl;

        // Insert metadata into resumes table
        const { error: insertErr } = await supabase.from("resumes").insert({
            user_id: userId,
            file_name: file.originalname,
            file_url: fileUrl
        });

        if (insertErr) {
            console.error(insertErr);
            return res.json({ success: false, message: "Error saving resume info" });
        }

        res.json({
            success: true,
            message: "Resume uploaded successfully",
            fileUrl
        });
    } catch (e) {
        console.error(e);
        res.json({ success: false, message: "Server error" });
    }
});

// List resumes for logged-in user
app.get("/resumes", requireLogin, async (req, res) => {
    const userId = req.session.user._id;

    const { data, error } = await supabase
        .from("resumes")
        .select("*")
        .eq("user_id", userId)
        .order("uploaded_at", { ascending: false });

    if (error || !data || !data.length) {
        return res.json({ success: false, message: "No files found" });
    }

    res.json({ success: true, files: data });
});

// ---------- JOB TRACKER API ----------
app.post("/api/jobs", requireLogin, async (req, res) => {
    const { title, company, status, date } = req.body;
    const userId = req.session.user._id;

    const { data, error } = await supabase
        .from("jobs")
        .insert({ user_id: userId, title, company, status, date })
        .select()
        .single();

    if (error) {
        console.error(error);
        return res.json({ success: false, message: "Could not add job" });
    }

    res.json({ success: true, job: data });
});

app.get("/api/jobs", requireLogin, async (req, res) => {
    const userId = req.session.user._id;
    const { data, error } = await supabase
        .from("jobs")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

    if (error) {
        console.error(error);
        return res.json({ success: false, jobs: [] });
    }

    res.json({ success: true, jobs: data });
});

// ---------- INTERVIEW / CALENDAR API ----------
app.post("/api/interviews", requireLogin, async (req, res) => {
    const { company, role, date, time, notes } = req.body;
    const userId = req.session.user._id;

    const { data, error } = await supabase
        .from("interviews")
        .insert({ user_id: userId, company, role, date, time, notes })
        .select()
        .single();

    if (error) {
        console.error(error);
        return res.json({ success: false, message: "Could not add interview" });
    }

    res.json({ success: true, interview: data });
});

app.get("/api/interviews", requireLogin, async (req, res) => {
    const userId = req.session.user._id;

    const { data, error } = await supabase
        .from("interviews")
        .select("*")
        .eq("user_id", userId)
        .order("date", { ascending: true });

    if (error) {
        console.error(error);
        return res.json({ success: false, interviews: [] });
    }

    res.json({ success: true, interviews: data });
});

// ---------- JOB SUGGESTIONS (STATIC) ----------
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

// ---------- AI RESUME FORMATTER (MOCK) ----------
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
        console.error(err);
        res.json({ success: false, message: "Error fetching news" });
    }
});

// ---------- COLLEGE SEARCH ----------
app.get("/api/colleges", (req, res) => {
    const search = (req.query.search || "").toLowerCase();
    try {
        const filePath = path.join(__dirname, "colleges.json");
        const raw = fs.readFileSync(filePath, "utf-8");
        const data = JSON.parse(raw);
        const list = Array.isArray(data) ? data : (data.colleges || []);
        const filtered = list
            .filter(name => name.toLowerCase().includes(search))
            .slice(0, 20);
        res.json(filtered);
    } catch (e) {
        console.error("Error reading colleges.json", e);
        res.json([]);
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
});
