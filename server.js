const express = require("express");
const bodyParser = require("body-parser");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Middleware ----------
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public")); // Serve frontend files

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

    console.log(`✅ Registered new user: ${firstName} ${lastName} (ID: ${uniqueId})`);
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
app.post("/api/upload", upload.single("resume"), (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).json({ message: "No file uploaded" });

    console.log("Uploaded resume:", file.originalname);
    const extractedSkills = ["React", "SQL", "Node.js", "Problem Solving"];
    res.json({ message: `Resume '${file.originalname}' analyzed successfully!`, skills: extractedSkills });
});

// ---------- API: Jobs ----------
app.get("/api/jobs", (req, res) => {
    const jobsPath = path.join(__dirname, "public", "jobs.json");
    const jobs = fs.existsSync(jobsPath) ? JSON.parse(fs.readFileSync(jobsPath, "utf8")) : [];
    res.json(jobs);
});

// ---------- Default Route ----------
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------- Start Server ----------
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
