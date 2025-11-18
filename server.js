require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const OpenAI = require("openai");
const { PDFParse } = require("pdf-parse");
const mammoth = require("mammoth");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));
const elevatorRoutes = require("./elevatorRoutes");
const app = express();
const PORT = process.env.PORT || 3000;
const openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

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

// ---------- Helper: Generate unique 8-digit ID ----------
function generateUniqueId(users) {
    let id;
    do {
        id = Math.floor(10000000 + Math.random() * 90000000);
    } while (users.find((u) => u.uniqueId === id));
    return id;
}

// ---------- Upload Setup ----------
const upload = multer({ dest: "uploads/" });

async function extractTextFromFile(file) {
    const filePath = file.path;
    const ext = path.extname(file.originalname).toLowerCase();
    const buffer = fs.readFileSync(filePath);

    if (ext === ".pdf" || file.mimetype === "application/pdf") {
        const parser = new PDFParse({ data: buffer });
        try {
            const parsed = await parser.getText();
            return parsed?.text || "";
        } finally {
            await parser.destroy().catch(() => {});
        }
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
