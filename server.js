// ---------- ENV + IMPORTS ----------
require("dotenv").config();

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { createClient } = require("@supabase/supabase-js");
const multer = require("multer");
const Parser = require("rss-parser");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
const parser = new Parser();

// ---------- SUPABASE CONFIG ----------
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Missing SUPABASE_URL or SUPABASE_KEY in .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
console.log("🔗 Supabase Dashboard:", supabaseUrl);

// ---------- MIDDLEWARE ----------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// serve frontend files from /public
app.use(express.static(path.join(__dirname, "public")));

app.use(
    session({
        secret: "pathway-secret",
        resave: false,
        saveUninitialized: true,
        cookie: {
            maxAge: 1000 * 60 * 60 * 24, // 1 day
        },
    })
);

// ---------- MULTER: PROFILE PICS (LOCAL DISK) ----------
const profileDir = path.join(__dirname, "public/profile");
if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
}

const avatarStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, profileDir),
    filename: (req, file, cb) =>
        cb(null, Date.now() + "-" + file.originalname.replace(/\s+/g, "_")),
});

const avatarUpload = multer({ storage: avatarStorage });

// ---------- MULTER: RESUMES (TEMP DISK, THEN SUPABASE STORAGE) ----------
const resumesTmpDir = path.join(__dirname, "tmp", "resumes");
if (!fs.existsSync(resumesTmpDir)) {
    fs.mkdirSync(resumesTmpDir, { recursive: true });
}

const resumeStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, resumesTmpDir),
    filename: (req, file, cb) =>
        cb(null, Date.now() + "-" + file.originalname.replace(/\s+/g, "_")),
});

const resumeUpload = multer({ storage: resumeStorage });

app.use("/profile", express.static(profileDir));

// ---------- HELPERS ----------
function requireLogin(req, res, next) {
    if (!req.session.user || !req.session.user.email) {
        return res.status(401).json({ success: false, message: "Not logged in" });
    }
    next();
}

// ---------- ROOT ----------
app.get("/", (req, res) => {
    res.redirect("/login.html");
});

// ---------- AUTH: REGISTER ----------
app.post("/api/register", async (req, res) => {
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
            gradDate,
        } = req.body;

        if (!email || !password) {
            return res
                .status(400)
                .json({ success: false, message: "Email and password required" });
        }

        // check if user exists
        const { data: existing, error: existsError } = await supabase
            .from("users")
            .select("id")
            .eq("email", email);

        if (existsError) {
            console.error("Supabase error checking existing user:", existsError);
            return res
                .status(500)
                .json({ success: false, message: "Database error" });
        }

        if (existing && existing.length > 0) {
            return res
                .status(400)
                .json({ success: false, message: "Email already registered" });
        }

        const hash = await bcrypt.hash(password, 10);
        const fullName = `${firstName || ""} ${lastName || ""}`.trim();

        const { data: inserted, error: insertError } = await supabase
            .from("users")
            .insert([
                {
                    firstName,
                    lastName,
                    fullName,
                    birthday,
                    email,
                    occupation,
                    password_hash: hash,
                    street,
                    city,
                    state,
                    zip,
                    college,
                    certificate,
                    gradDate,
                },
            ])
            .select("id, fullName, email")
            .single();

        if (insertError || !inserted) {
            console.error("Supabase insert user error:", insertError);
            return res
                .status(500)
                .json({ success: false, message: "Registration failed" });
        }

        return res.json({
            success: true,
            message: "Registration successful",
            user: {
                id: inserted.id,
                fullName: inserted.fullName,
                email: inserted.email,
            },
        });
    } catch (err) {
        console.error("Register error:", err);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ---------- AUTH: LOGIN ----------
app.post("/api/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res
                .status(400)
                .json({ success: false, message: "Email and password required" });
        }

        const { data, error } = await supabase
            .from("users")
            .select("*")
            .eq("email", email);

        if (error) {
            console.error("Supabase login query error:", error);
            return res
                .status(500)
                .json({ success: false, message: "Database error" });
        }

        if (!data || data.length === 0) {
            return res
                .status(400)
                .json({ success: false, message: "User not found" });
        }

        const user = data[0];

        const ok = await bcrypt.compare(password, user.password_hash || "");
        if (!ok) {
            return res
                .status(400)
                .json({ success: false, message: "Incorrect password" });
        }

        const fullName =
            user.fullName ||
            `${user.firstName || ""} ${user.lastName || ""}`.trim() ||
            "";

        req.session.user = {
            id: user.id,
            email: user.email,
            fullName,
            profilePicPath: user.profilePicPath || null,
        };

        return res.json({
            success: true,
            message: "Login successful",
            user: {
                id: user.id,
                fullName,
                email: user.email,
                occupation: user.occupation,
                college: user.college,
                gradDate: user.gradDate,
            },
        });
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ---------- CHECK SESSION + FULL PROFILE ----------
app.get("/check-session", async (req, res) => {
    try {
        if (!req.session.user || !req.session.user.email) {
            return res.json({ loggedIn: false });
        }

        const email = req.session.user.email;

        const { data, error } = await supabase
            .from("users")
            .select("*")
            .eq("email", email);

        if (error) {
            console.error("Supabase profile fetch error:", error);
            return res.json({ loggedIn: true, user: req.session.user }); // fallback
        }

        if (!data || data.length === 0) {
            return res.json({ loggedIn: true, user: req.session.user });
        }

        const u = data[0];
        const fullName =
            u.fullName ||
            `${u.firstName || ""} ${u.lastName || ""}`.trim() ||
            req.session.user.fullName ||
            "";

        return res.json({
            loggedIn: true,
            user: {
                id: u.id,
                fullName,
                email: u.email,
                occupation: u.occupation,
                birthday: u.birthday,
                street: u.street,
                city: u.city,
                state: u.state,
                zip: u.zip,
                college: u.college,
                certificate: u.certificate,
                gradDate: u.gradDate,
                profilePicPath: u.profilePicPath || req.session.user.profilePicPath,
            },
        });
    } catch (err) {
        console.error("check-session error:", err);
        res.json({ loggedIn: false });
    }
});

// ---------- LOGOUT ----------
app.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true });
    });
});

// ---------- PROFILE PICTURE UPLOAD ----------
app.post(
    "/profile-picture",
    requireLogin,
    avatarUpload.single("avatar"),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.json({ success: false, message: "Upload failed" });
            }

            const filePath = "/profile/" + req.file.filename;

            // update user in Supabase
            const { error } = await supabase
                .from("users")
                .update({ profilePicPath: filePath })
                .eq("id", req.session.user.id);

            if (error) {
                console.error("Supabase update avatar error:", error);
            }

            req.session.user.profilePicPath = filePath;

            res.json({
                success: true,
                message: "Profile picture updated",
                path: filePath,
            });
        } catch (err) {
            console.error("profile-picture error:", err);
            res.json({ success: false, message: "Server error" });
        }
    }
);

// ---------- RESUME UPLOAD (SUPABASE STORAGE "resumes" BUCKET") ----------
app.post(
    "/uploadResume",
    requireLogin,
    resumeUpload.single("resume"),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.json({ success: false, message: "No file uploaded" });
            }

            const userId = req.session.user.id;
            const localPath = req.file.path;
            const fileBuffer = fs.readFileSync(localPath);

            const storagePath = `user-${userId}/${req.file.filename}`;

            const { error: uploadError } = await supabase.storage
                .from("resumes")
                .upload(storagePath, fileBuffer, {
                    contentType: req.file.mimetype || "application/octet-stream",
                    upsert: false,
                });

            // remove temp file
            fs.unlinkSync(localPath);

            if (uploadError) {
                console.error("Supabase resume upload error:", uploadError);
                return res.json({
                    success: false,
                    message: "Error uploading resume",
                });
            }

            const {
                data: { publicUrl },
            } = supabase.storage.from("resumes").getPublicUrl(storagePath);

            return res.json({
                success: true,
                message: "Resume uploaded successfully",
                url: publicUrl,
            });
        } catch (err) {
            console.error("uploadResume error:", err);
            res.json({ success: false, message: "Server error" });
        }
    }
);

// ---------- LIST RESUMES FOR USER ----------
app.get("/resumes", requireLogin, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const folder = `user-${userId}`;

        const { data, error } = await supabase.storage
            .from("resumes")
            .list(folder, {
                limit: 100,
                offset: 0,
                sortBy: { column: "created_at", order: "desc" },
            });

        if (error) {
            console.error("Supabase list resumes error:", error);
            return res.json({
                success: false,
                message: "Could not list resumes",
            });
        }

        if (!data || !data.length) {
            return res.json({ success: true, files: [] });
        }

        const files = data.map((f) => {
            const fullPath = `${folder}/${f.name}`;
            const {
                data: { publicUrl },
            } = supabase.storage.from("resumes").getPublicUrl(fullPath);

            return {
                name: f.name,
                url: publicUrl,
                createdAt: f.created_at || null,
            };
        });

        res.json({ success: true, files });
    } catch (err) {
        console.error("resumes list error:", err);
        res.json({ success: false, message: "Server error" });
    }
});

// ---------- AI RESUME FORMATTER ----------
app.post("/api/format-resume", requireLogin, (req, res) => {
    const { text } = req.body;
    if (!text || !text.trim()) {
        return res.json({
            success: false,
            message: "No resume text provided",
        });
    }

    const lines = text
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l);

    const formattedLines = lines.map((l) => {
        if (l.startsWith("-") || l.startsWith("•"))
            return "- " + l.replace(/^[-•]+\s*/, "");
        return l;
    });

    const formattedText =
        "Professional Summary:\n" + formattedLines.join("\n");

    res.json({ success: true, formattedText });
});

// ---------- JOB TRACKER ----------
app.post("/api/jobs", requireLogin, async (req, res) => {
    try {
        const { title, company, status, date } = req.body;
        const userId = req.session.user.id;

        const { data, error } = await supabase
            .from("jobs")
            .insert([
                {
                    user_id: userId,
                    title,
                    company,
                    status,
                    date,
                },
            ])
            .select("*")
            .single();

        if (error) {
            console.error("Supabase insert job error:", error);
            return res.json({ success: false, message: "Could not add job" });
        }

        res.json({ success: true, job: data });
    } catch (err) {
        console.error("add job error:", err);
        res.json({ success: false, message: "Server error" });
    }
});

app.get("/api/jobs", requireLogin, async (req, res) => {
    try {
        const userId = req.session.user.id;

        const { data, error } = await supabase
            .from("jobs")
            .select("*")
            .eq("user_id", userId)
            .order("created_at", { ascending: false });

        if (error) {
            console.error("Supabase fetch jobs error:", error);
            return res.json({ success: false, jobs: [] });
        }

        res.json({ success: true, jobs: data || [] });
    } catch (err) {
        console.error("get jobs error:", err);
        res.json({ success: false, jobs: [] });
    }
});

// ---------- INTERVIEWS ----------
app.post("/api/interviews", requireLogin, async (req, res) => {
    try {
        const { company, role, date, time, notes } = req.body;
        const userId = req.session.user.id;

        const { data, error } = await supabase
            .from("interviews")
            .insert([
                {
                    user_id: userId,
                    company,
                    role,
                    date,
                    time,
                    notes,
                },
            ])
            .select("*")
            .single();

        if (error) {
            console.error("Supabase insert interview error:", error);
            return res.json({
                success: false,
                message: "Could not add interview",
            });
        }

        res.json({ success: true, interview: data });
    } catch (err) {
        console.error("add interview error:", err);
        res.json({ success: false, message: "Server error" });
    }
});

app.get("/api/interviews", requireLogin, async (req, res) => {
    try {
        const userId = req.session.user.id;

        const { data, error } = await supabase
            .from("interviews")
            .select("*")
            .eq("user_id", userId)
            .order("date", { ascending: true })
            .order("time", { ascending: true });

        if (error) {
            console.error("Supabase fetch interviews error:", error);
            return res.json({ success: false, interviews: [] });
        }

        res.json({ success: true, interviews: data || [] });
    } catch (err) {
        console.error("get interviews error:", err);
        res.json({ success: false, interviews: [] });
    }
});

// ---------- AI JOB SUGGESTIONS (STATIC) ----------
app.get("/api/job-suggestions", requireLogin, (req, res) => {
    const suggestions = [
        {
            title: "Junior Software Developer",
            company: "TechNova",
            location: "Remote",
        },
        {
            title: "Backend Engineer Intern",
            company: "CloudCore",
            location: "Atlanta, GA",
        },
        {
            title: "Full-Stack Developer",
            company: "Pathway Labs",
            location: "Hybrid",
        },
        {
            title: "Front-End React Developer",
            company: "UIWorks",
            location: "Remote",
        },
        {
            title: "Cybersecurity Analyst Intern",
            company: "SecureNet",
            location: "On-site",
        },
    ];
    res.json({ success: true, suggestions });
});

// ---------- YAHOO NEWS EXAMPLE ----------
app.get("/api/news", async (req, res) => {
    try {
        const feed = await parser.parseURL("https://www.yahoo.com/news/rss");
        const articles = feed.items.slice(0, 10).map((item) => ({
            title: item.title,
            link: item.link,
            pubDate: item.pubDate,
        }));
        res.json({ success: true, articles });
    } catch (err) {
        console.error("News fetch error:", err);
        res.json({ success: false, message: "Error fetching news" });
    }
});

// ---------- START SERVER ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
