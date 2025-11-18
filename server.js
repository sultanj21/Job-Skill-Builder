// ======================================================
//  ENV + IMPORTS
// ======================================================
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

// ======================================================
//  SUPABASE CONFIG
// ======================================================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Missing SUPABASE_URL or SUPABASE_KEY in environment");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
console.log("🔗 Supabase Dashboard:", supabaseUrl);

// ======================================================
//  MIDDLEWARE
// ======================================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Login page first
app.get("/", (req, res) => {
    res.redirect("/login.html");
});

// static frontend
app.use(express.static(path.join(__dirname, "public")));

app.use(
    session({
        secret: process.env.SESSION_SECRET || "fallback-secret",
        resave: false,
        saveUninitialized: true,
        cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 day
    })
);

// ======================================================
//  MULTER: PROFILE PICTURES (LOCAL)
// ======================================================
const profileDir = path.join(__dirname, "public/profile");
if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

const avatarUpload = multer({
    storage: multer.diskStorage({
        destination: profileDir,
        filename: (_, file, cb) =>
            cb(null, Date.now() + "-" + file.originalname.replace(/\s+/g, "_"))
    })
});

// ======================================================
//  MULTER: RESUMES (TEMP → SUPABASE STORAGE)
// ======================================================
const resumesTmpDir = path.join(__dirname, "tmp/resumes");
if (!fs.existsSync(resumesTmpDir)) fs.mkdirSync(resumesTmpDir, { recursive: true });

const resumeUpload = multer({
    storage: multer.diskStorage({
        destination: resumesTmpDir,
        filename: (_, file, cb) =>
            cb(null, Date.now() + "-" + file.originalname.replace(/\s+/g, "_"))
    })
});

app.use("/profile", express.static(profileDir));

// ======================================================
//  HELPERS
// ======================================================
function requireLogin(req, res, next) {
    if (!req.session.user || !req.session.user.email) {
        return res.status(401).json({ success: false, message: "Not logged in" });
    }
    next();
}

// read from camelCase / snake_case / lowercase
function getField(obj, ...names) {
    for (const n of names) {
        if (obj && obj[n] !== undefined && obj[n] !== null) return obj[n];
    }
    return null;
}

// ======================================================
//  REGISTER
//  expects Supabase `users` table columns like:
//  first_name, last_name, full_name, birthday, email, occupation,
//  password_hash, street, city, state, zip, college, certificate,
//  grad_date, profile_pic_path
// ======================================================
app.post("/api/register", async (req, res) => {
    console.log("🟦 /api/register body:", req.body);

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
            console.error("❌ Supabase error checking existing user:", existsError);
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

        // IMPORTANT: use snake_case column names to match your Supabase table
        const insertPayload = {
            first_name: firstName || null,
            last_name: lastName || null,
            full_name: fullName || null,
            birthday: birthday || null,        // must be 'YYYY-MM-DD' or null
            email,
            occupation: occupation || null,
            password_hash: hash,
            street: street || null,
            city: city || null,
            state: state || null,
            zip: zip || null,
            college: college || null,
            certificate: certificate || null,
            grad_date: gradDate || null        // 'YYYY-MM-DD' or null
        };

        console.log("📝 /api/register insertPayload:", insertPayload);

        const { data: inserted, error: insertError } = await supabase
            .from("users")
            .insert([insertPayload])
            .select("*")
            .single();

        if (insertError || !inserted) {
            console.error("❌ Supabase insert user error:", insertError);
            return res
                .status(500)
                .json({ success: false, message: "Registration failed" });
        }

        return res.json({
            success: true,
            message: "Registration successful",
            user: inserted
        });
    } catch (err) {
        console.error("💥 Register error:", err);
        res.status(500).json({
            success: false,
            message: "Server error",
            detail: String(err)
        });
    }
});

// ======================================================
//  LOGIN
// ======================================================
app.post("/api/login", async (req, res) => {
    console.log("🟦 /api/login body:", req.body);

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
            console.error("❌ Supabase login query error:", error);
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

        // resolve all fields with both snake_case and camelCase
        const firstName = getField(user, "first_name", "firstName", "firstname");
        const lastName = getField(user, "last_name", "lastName", "lastname");
        const fullName =
            getField(user, "full_name", "fullName", "fullname") ||
            `${firstName || ""} ${lastName || ""}`.trim() ||
            email;

        const birthday = getField(user, "birthday", "birthdate", "dob");
        const occupation = getField(user, "occupation");
        const street = getField(user, "street");
        const city = getField(user, "city");
        const state = getField(user, "state");
        const zip = getField(user, "zip", "postal_code");
        const college = getField(user, "college");
        const certificate = getField(user, "certificate", "degree");
        const gradDate = getField(user, "grad_date", "gradDate", "graduationDate");
        const profilePicPath = getField(
            user,
            "profile_pic_path",
            "profilePicPath",
            "profile_pic"
        );

        const sessionUser = {
            id: user.id,
            email: user.email,
            firstName,
            lastName,
            fullName,
            birthday,
            occupation,
            street,
            city,
            state,
            zip,
            college,
            certificate,
            gradDate,
            profilePicPath
        };

        req.session.user = sessionUser;

        return res.json({
            success: true,
            message: "Login successful",
            user: sessionUser
        });
    } catch (err) {
        console.error("💥 Login error:", err);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ======================================================
//  CHECK SESSION + FULL PROFILE
// ======================================================
app.get("/check-session", async (req, res) => {
    try {
        if (!req.session.user || !req.session.user.email) {
            return res.json({ loggedIn: false });
        }

        const email = req.session.user.email;

        const { data, error } = await supabase
            .from("users")
            .select("*")
            .eq("email", email)
            .single();

        if (error || !data) {
            console.error(
                "Supabase profile fetch error, falling back to session:",
                error
            );
            return res.json({ loggedIn: true, user: req.session.user });
        }

        const u = data;

        const firstName =
            getField(u, "first_name", "firstName", "firstname") ||
            req.session.user.firstName ||
            "";
        const lastName =
            getField(u, "last_name", "lastName", "lastname") ||
            req.session.user.lastName ||
            "";
        const fullName =
            getField(u, "full_name", "fullName", "fullname") ||
            `${firstName} ${lastName}`.trim() ||
            req.session.user.fullName ||
            "";

        const birthday =
            getField(u, "birthday", "birthdate", "dob") ||
            req.session.user.birthday ||
            null;
        const occupation =
            getField(u, "occupation") || req.session.user.occupation || null;
        const street = getField(u, "street") || req.session.user.street || null;
        const city = getField(u, "city") || req.session.user.city || null;
        const state = getField(u, "state") || req.session.user.state || null;
        const zip =
            getField(u, "zip", "postal_code") || req.session.user.zip || null;
        const college =
            getField(u, "college") || req.session.user.college || null;
        const certificate =
            getField(u, "certificate", "degree") ||
            req.session.user.certificate ||
            null;
        const gradDate =
            getField(u, "grad_date", "gradDate", "graduationDate") ||
            req.session.user.gradDate ||
            null;
        const profilePicPath =
            getField(u, "profile_pic_path", "profilePicPath", "profile_pic") ||
            req.session.user.profilePicPath ||
            null;

        const userObj = {
            id: u.id,
            email: u.email,
            firstName,
            lastName,
            fullName,
            birthday,
            occupation,
            street,
            city,
            state,
            zip,
            college,
            certificate,
            gradDate,
            profilePicPath
        };

        req.session.user = userObj;
        return res.json({ loggedIn: true, user: userObj });
    } catch (err) {
        console.error("💥 check-session error:", err);
        res.json({ loggedIn: false });
    }
});

// ======================================================
//  LOGOUT
// ======================================================
app.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true });
    });
});

// ======================================================
//  PROFILE PICTURE UPLOAD
// ======================================================
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

            const { error } = await supabase
                .from("users")
                .update({ profile_pic_path: filePath })
                .eq("id", req.session.user.id);

            if (error) {
                console.error("Supabase update avatar error:", error);
            }

            req.session.user.profilePicPath = filePath;

            res.json({
                success: true,
                message: "Profile picture updated",
                path: filePath
            });
        } catch (err) {
            console.error("profile-picture error:", err);
            res.json({ success: false, message: "Server error" });
        }
    }
);

// ======================================================
//  RESUME UPLOAD → SUPABASE STORAGE
// ======================================================
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
                    upsert: false
                });

            fs.unlinkSync(localPath);

            if (uploadError) {
                console.error("Supabase resume upload error:", uploadError);
                return res.json({
                    success: false,
                    message: "Error uploading resume"
                });
            }

            const {
                data: { publicUrl }
            } = supabase.storage.from("resumes").getPublicUrl(storagePath);

            return res.json({
                success: true,
                message: "Resume uploaded successfully",
                url: publicUrl
            });
        } catch (err) {
            console.error("uploadResume error:", err);
            res.json({ success: false, message: "Server error" });
        }
    }
);

// ======================================================
//  LIST RESUMES
// ======================================================
app.get("/resumes", requireLogin, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const folder = `user-${userId}`;

        const { data, error } = await supabase.storage
            .from("resumes")
            .list(folder, {
                limit: 100,
                offset: 0
            });

        if (error) {
            console.error("Supabase list resumes error:", error);
            return res.json({
                success: false,
                message: "Could not list resumes"
            });
        }

        if (!data || !data.length) {
            return res.json({ success: true, files: [] });
        }

        const files = data.map((f) => {
            const fullPath = `${folder}/${f.name}`;
            const {
                data: { publicUrl }
            } = supabase.storage.from("resumes").getPublicUrl(fullPath);

            return {
                name: f.name,
                url: publicUrl,
                createdAt: f.created_at || null
            };
        });

        res.json({ success: true, files });
    } catch (err) {
        console.error("resumes list error:", err);
        res.json({ success: false, message: "Server error" });
    }
});

// ======================================================
//  AI RESUME FORMATTER
// ======================================================
app.post("/api/format-resume", requireLogin, (req, res) => {
    const { text } = req.body;
    if (!text || !text.trim()) {
        return res.json({
            success: false,
            message: "No resume text provided"
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

// ======================================================
//  JOB TRACKER
// ======================================================
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
                    date
                }
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

// ======================================================
//  INTERVIEWS
// ======================================================
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
                    notes
                }
            ])
            .select("*")
            .single();

        if (error) {
            console.error("Supabase insert interview error:", error);
            return res.json({
                success: false,
                message: "Could not add interview"
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

// ======================================================
//  AI JOB SUGGESTIONS
// ======================================================
app.get("/api/job-suggestions", requireLogin, (req, res) => {
    const suggestions = [
        {
            title: "Junior Software Developer",
            company: "TechNova",
            location: "Remote"
        },
        {
            title: "Backend Engineer Intern",
            company: "CloudCore",
            location: "Atlanta, GA"
        },
        {
            title: "Full-Stack Developer",
            company: "Pathway Labs",
            location: "Hybrid"
        },
        {
            title: "Front-End React Developer",
            company: "UIWorks",
            location: "Remote"
        },
        {
            title: "Cybersecurity Analyst Intern",
            company: "SecureNet",
            location: "On-site"
        }
    ];
    res.json({ success: true, suggestions });
});

// ======================================================
//  NEWS
// ======================================================
app.get("/api/news", async (req, res) => {
    try {
        const feed = await parser.parseURL("https://www.yahoo.com/news/rss");
        const articles = feed.items.slice(0, 10).map((item) => ({
            title: item.title,
            link: item.link,
            pubDate: item.pubDate
        }));
        res.json({ success: true, articles });
    } catch (err) {
        console.error("News fetch error:", err);
        res.json({ success: false, message: "Error fetching news" });
    }
});

// ======================================================
//  START SERVER
// ======================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);

    if (process.env.RENDER_EXTERNAL_URL) {
        console.log(`🌍 Live URL: ${process.env.RENDER_EXTERNAL_URL}`);
    } else {
        console.log(`🌍 Local URL: http://localhost:${PORT}`);
    }
});
