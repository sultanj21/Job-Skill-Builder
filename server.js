require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const { Pool } = require("pg");
const OpenAI = require("openai");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));
const elevatorRoutes = require("./elevatorRoutes");
const app = express();
const PORT = process.env.PORT || 3000;
const openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// ---------- Database (Supabase Postgres) ----------
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "";
const SUPABASE_USERS_TABLE = process.env.SUPABASE_USERS_TABLE || "users";
let dbPool = null;

if (SUPABASE_DB_URL) {
    dbPool = new Pool({
        connectionString: SUPABASE_DB_URL,
        ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false }
    });

    dbPool.on("error", (err) => {
        console.error("Postgres pool error:", err.message);
    });

    ensureUsersTable().catch((err) => {
        console.error("Failed to ensure Supabase users table:", err.message);
    });
} else {
    console.warn("ℹ️ SUPABASE_DB_URL not set; falling back to local JSON storage.");
}

// ---------- Middleware ----------
app.use(cors());
app.use(bodyParser.json());
app.use(express.json());
app.use("/api", elevatorRoutes);
app.use(express.static("public", { index: false })); // Serve frontend files

// ---------- File paths ----------
const USERS_FILE = path.join(__dirname, "users.json");
const COLLEGES_FILE = path.join(__dirname, "colleges.json");

// ---------- Ensure JSON files exist ----------
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "[]");
if (!fs.existsSync(COLLEGES_FILE)) {
    fs.writeFileSync(
        COLLEGES_FILE,
        JSON.stringify([
            "Harvard University",
            "Stanford University",
            "Massachusetts Institute of Technology",
            "Princeton University",
            "Yale University",
            "Columbia University",
            "University of California, Berkeley",
            "University of Michigan",
            "New York University",
            "Georgia Institute of Technology",
            "University of Florida",
            "Boston University",
            "University of Illinois Urbana-Champaign",
            "Purdue University",
            "University of Washington"
        ], null, 2)
    );
}

async function ensureUsersTable() {
    if (!dbPool) return;
    const tableName = SUPABASE_USERS_TABLE;
    const extensionSQL = `CREATE EXTENSION IF NOT EXISTS "pgcrypto";`;
    const createTableSQL = `
        CREATE TABLE IF NOT EXISTS ${tableName} (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            unique_id BIGINT UNIQUE,
            firstname TEXT NOT NULL,
            lastname TEXT NOT NULL,
            fullname TEXT NOT NULL,
            birthday DATE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            occupation TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            street TEXT NOT NULL,
            city TEXT NOT NULL,
            state TEXT NOT NULL,
            zip TEXT NOT NULL,
            college TEXT NOT NULL,
            certificate TEXT NOT NULL,
            graddate DATE NOT NULL,
            profilepicpath TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `;
    const emailIndexSQL = `CREATE UNIQUE INDEX IF NOT EXISTS ${tableName}_email_idx ON ${tableName}(email);`;
    const uniqueIdIndexSQL = `CREATE UNIQUE INDEX IF NOT EXISTS ${tableName}_unique_id_idx ON ${tableName}(unique_id) WHERE unique_id IS NOT NULL;`;

    await dbPool.query(extensionSQL);
    await dbPool.query(createTableSQL);
    await dbPool.query(emailIndexSQL);
    await dbPool.query(uniqueIdIndexSQL);
}

// ---------- Helper: Generate unique 8-digit ID ----------
function generateUniqueId(users) {
    let id;
    do {
        id = Math.floor(10000000 + Math.random() * 90000000);
    } while (users.find((u) => u.uniqueId === id));
    return id;
}

async function generateDbUniqueId() {
    if (!dbPool) return Math.floor(10000000 + Math.random() * 90000000);
    let id;
    let exists = true;
    while (exists) {
        id = Math.floor(10000000 + Math.random() * 90000000);
        const { rowCount } = await dbPool.query(
            `SELECT 1 FROM ${SUPABASE_USERS_TABLE} WHERE unique_id = $1`,
            [id]
        );
        exists = rowCount > 0;
    }
    return id;
}

function mapDbUser(row) {
    if (!row) return null;
    return {
        id: row.id,
        uniqueId: row.unique_id || row.id,
        firstName: row.firstname,
        lastName: row.lastname,
        birthday: row.birthday,
        email: row.email,
        occupation: row.occupation,
        address: {
            street: row.street,
            city: row.city,
            state: row.state,
            zip: row.zip
        },
        education: {
            college: row.college,
            certificate: row.certificate,
            gradDate: row.graddate
        },
        registeredAt: row.created_at,
        profilePicPath: row.profilepicpath || null
    };
}

async function fetchDbUserByEmail(email) {
    if (!dbPool) return null;
    const { rows } = await dbPool.query(
        `SELECT * FROM ${SUPABASE_USERS_TABLE} WHERE email = $1 LIMIT 1`,
        [email]
    );
    return rows[0] || null;
}

// ---------- Upload Setup ----------
const upload = multer({ dest: "uploads/" });

async function extractTextFromFile(file) {
    const filePath = file.path;
    const ext = path.extname(file.originalname).toLowerCase();
    const buffer = fs.readFileSync(filePath);

    if (ext === ".pdf" || file.mimetype === "application/pdf") {
        const parsed = await pdfParse(buffer);
        return parsed?.text || "";
    }

    if (ext === ".docx" || file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
        const result = await mammoth.extractRawText({ buffer });
        return result.value || "";
    }

    return buffer.toString("utf8");
}

async function analyzeResume(text) {
    if (!openaiClient) {
        throw new Error("OpenAI API key is not configured on the server.");
    }

    const completion = await openaiClient.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
            {
                role: "system",
                content: "You extract resume insights. Respond with JSON: summary (2 sentences), skills (array of skill names), recommendedRoles (array of role titles)."
            },
            {
                role: "user",
                content: text.slice(0, 15000)
            }
        ]
    });

    return JSON.parse(completion.choices?.[0]?.message?.content || "{}");
}

async function fetchLiveJobs() {
    const REMOTIVE_ENDPOINT = "https://remotive.com/api/remote-jobs";
    const url = `${REMOTIVE_ENDPOINT}?limit=30`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Remotive API error: ${res.status}`);
    const payload = await res.json();
    const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    return jobs.slice(0, 20).map((job) => {
        const tags = Array.isArray(job.tags) ? job.tags.map((t) => t.toLowerCase()) : [];
        const cleanDescription = (job.description || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        return {
            title: job.title,
            company: job.company_name,
            location: job.candidate_required_location || job.location || "Remote",
            type: job.job_type || "Remote",
            salary: job.salary || job.salary_range || "",
            logo: job.company_logo_url || "",
            link: job.url,
            description: cleanDescription.slice(0, 260) + (cleanDescription.length > 260 ? "…" : ""),
            keywords: tags
        };
    });
}

// ---------- API: Register New User ----------
app.post("/api/register", async (req, res) => {
    const {
        firstName, lastName, birthday, email, occupation,
        street, city, state, zip, college, certificate, gradDate,
        password, confirmPassword
    } = req.body;

    if (!firstName || !lastName || !birthday || !email || !occupation ||
        !street || !city || !state || !zip || !college || !certificate ||
        !gradDate || !password || !confirmPassword) {
        return res.status(400).json({ message: "All fields are required" });
    }

    if (password !== confirmPassword) {
        return res.status(400).json({ message: "Passwords do not match" });
    }

    if (dbPool) {
        try {
            const existing = await fetchDbUserByEmail(email);
            if (existing) {
                return res.status(400).json({ message: "Email already registered" });
            }

            const hashedPassword = await bcrypt.hash(password, 10);
            const uniqueId = await generateDbUniqueId();
            const insertSQL = `
                INSERT INTO ${SUPABASE_USERS_TABLE}
                    (unique_id, firstname, lastname, fullname, birthday, email, occupation, password_hash, street, city, state, zip, college, certificate, graddate, profilepicpath)
                VALUES
                    ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                RETURNING *;
            `;

            const { rows } = await dbPool.query(insertSQL, [
                uniqueId,
                firstName,
                lastName,
                `${firstName} ${lastName}`.trim(),
                birthday,
                email,
                occupation,
                hashedPassword,
                street,
                city,
                state,
                zip,
                college,
                certificate,
                gradDate,
                null
            ]);

            const dbUser = mapDbUser(rows[0]);
            console.log(` Registered new user (Supabase): ${firstName} ${lastName} (ID: ${uniqueId})`);
            return res.json({ message: "Registration successful!", user: dbUser });
        } catch (err) {
            console.error("Supabase registration error:", err);
            return res.status(500).json({ message: "Failed to register user. Please try again." });
        }
    }

    const users = fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE, "utf8")) : [];
    if (users.find((u) => u.email === email)) {
        return res.status(400).json({ message: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const uniqueId = generateUniqueId(users);

    const newUser = {
        id: users.length + 1,
        uniqueId,
        firstName,
        lastName,
        birthday,
        email,
        occupation,
        password: hashedPassword,
        address: { street, city, state, zip },
        education: { college, certificate, gradDate },
        registeredAt: new Date().toISOString()
    };

    users.push(newUser);
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

    console.log(` Registered new user: ${firstName} ${lastName} (ID: ${uniqueId})`);
    res.json({ message: "Registration successful!", user: { ...newUser, password: undefined } });
});

// ---------- API: User Login ----------
app.post("/api/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: "Email and password are required" });

    if (dbPool) {
        try {
            const row = await fetchDbUserByEmail(email);
            if (!row) return res.status(401).json({ message: "Invalid email or password" });

            const isMatch = await bcrypt.compare(password, row.password_hash);
            if (!isMatch) return res.status(401).json({ message: "Invalid email or password" });

            const safeUser = mapDbUser(row);
            console.log(`🔐 ${safeUser.firstName} ${safeUser.lastName} logged in via Supabase (ID: ${safeUser.uniqueId})`);

            return res.json({
                message: `Welcome back, ${safeUser.firstName}!`,
                user: safeUser
            });
        } catch (err) {
            console.error("Supabase login error:", err);
            return res.status(500).json({ message: "Server error. Please try again." });
        }
    }

    const users = fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE, "utf8")) : [];
    const user = users.find((u) => u.email === email);
    if (!user) return res.status(401).json({ message: "Invalid email or password" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: "Invalid email or password" });

    console.log(`🔐 ${user.firstName} ${user.lastName} logged in (ID: ${user.uniqueId})`);
    res.json({
        message: `Welcome back, ${user.firstName}!`,
        user: {
            id: user.id,
            uniqueId: user.uniqueId,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            occupation: user.occupation,
            birthday: user.birthday,
            address: user.address,
            education: user.education,
            registeredAt: user.registeredAt
        }
    });
});

// ---------- API: College Search ----------
app.get("/api/colleges", (req, res) => {
    const { search } = req.query;
    if (!search || search.length < 3) return res.json([]);
    const colleges = JSON.parse(fs.readFileSync(COLLEGES_FILE, "utf8"));
    const results = colleges.filter(c => c.toLowerCase().includes(search.toLowerCase()));
    res.json(results.slice(0, 10));
});

// ---------- API: Resume Upload ----------
app.post("/api/upload", upload.single("resume"), async (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).json({ message: "No file uploaded" });

    try {
        const resumeText = await extractTextFromFile(file);
        if (!resumeText.trim()) throw new Error("Unable to extract readable text from resume.");

        const analysis = await analyzeResume(resumeText);
        const skills = analysis.skills || [];
        const summary = analysis.summary || "";
        const recommendedRoles = analysis.recommendedRoles || [];

        console.log("Uploaded resume analyzed:", file.originalname);
        res.json({
            message: `Resume '${file.originalname}' analyzed successfully!`,
            resumeText: resumeText.trim(),
            skills,
            summary,
            recommendedRoles
        });
    } catch (error) {
        console.error("Resume upload analysis error:", error);
        res.status(500).json({ message: error.message || "Failed to analyze resume." });
    } finally {
        fs.unlink(file.path, () => {});
    }
});

// ---------- API: Resume Reformatter (OpenAI) ----------
app.post("/api/resume/reformatter", async (req, res) => {
    if (!openaiClient) {
        return res.status(500).json({ message: "OpenAI API key is not configured on the server." });
    }

    const { resumeText, jobDescription } = req.body || {};
    if (!resumeText || !jobDescription) {
        return res.status(400).json({ message: "Resume text and job description are required." });
    }

    try {
        const completion = await openaiClient.chat.completions.create({
            model: process.env.OPENAI_MODEL || "gpt-4o-mini",
            temperature: 0.2,
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: [
                        {
                            type: "text",
                            text: "You are an expert resume coach who tailors resumes to target job postings. Respond strictly with JSON containing: (1) summary - 2 sentences selling why the candidate is ideal for the role, (2) tailoredResume - a single ATS-friendly resume text string (no nested JSON) that blends the candidate's experience with the job requirements, (3) emphasizedSkills - array of prominent skills/keywords used, (4) suggestions - array of action items. Ensure tailoredResume is a string, even if it has multiple sections."
                        }
                    ]
                },
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: `ORIGINAL RESUME:\n${resumeText.trim()}\n\nTARGET JOB DESCRIPTION:\n${jobDescription.trim()}`
                        }
                    ]
                }
            ]
        });

        const content = completion.choices?.[0]?.message?.content || "{}";
        const formatted = JSON.parse(content);
        res.json(formatted);
    } catch (error) {
        console.error("OpenAI resume reformatter error:", error);
        const message = error?.response?.data?.error?.message || error.message || "Failed to generate tailored resume.";
        res.status(500).json({ message });
    }
});

// ---------- API: Jobs ----------
app.get("/api/jobs", async (req, res) => {
    try {
        const liveJobs = await fetchLiveJobs();
        if (liveJobs.length) {
            return res.json(liveJobs);
        }
    } catch (err) {
        console.error("Live job feed error:", err.message);
    }

    const jobsPath = path.join(__dirname, "public", "jobs.json");
    const fallbackJobs = fs.existsSync(jobsPath) ? JSON.parse(fs.readFileSync(jobsPath, "utf8")) : [];
    res.json(fallbackJobs);
});

// ---------- Default Route ----------
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "login.html"));
});

const schedulerRoutes = require("./schedulerRoutes");

// API routes for scheduler
app.use("/api", schedulerRoutes);

// ---------- Start Server ----------
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
