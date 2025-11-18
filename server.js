// ---------- ENV + IMPORTS ----------
require("dotenv").config();

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { createClient } = require("@supabase/supabase-js");
const path = require("path");

const app = express();

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

app.use(
    session({
        secret: process.env.SESSION_SECRET || "dev_secret_change_me",
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            maxAge: 1000 * 60 * 60 * 24, // 1 day
        },
    })
);

// Static files
app.use(express.static(path.join(__dirname, "public")));

// ---------- AUTH MIDDLEWARE ----------
function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.redirect("/login.html");
    }
    next();
}

// ---------- BASIC PAGES ----------
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/login", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "login.html"));
});

// Make /register redirect to the personal step (for convenience)
app.get("/register", (req, res) => {
    res.redirect("/register-personal");
});

// === NEW: dashed routes matching what you're visiting ===

// Step 1 – personal info
app.get("/register-personal", (req, res) => {
    res.sendFile(
        path.join(__dirname, "public", "register_personal_information.html")
    );
});

// Step 2 – address
app.get("/register-address", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "register_address.html"));
});

// Step 3 – college / education
app.get("/register-college", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "register_college.html"));
});

// Dashboard + Jobs (protected)
app.get("/dashboard", requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.get("/jobs", requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "jobs.html"));
});

// ---------- API: CURRENT USER ----------
app.get("/api/me", requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;

        const { data, error } = await supabase
            .from("users")
            .select(
                "id, firstname, lastname, fullname, birthday, email, occupation, street, city, state, zip, college, certificate, graddate, profilepicpath, created_at"
            )
            .eq("id", userId)
            .maybeSingle();

        if (error) {
            console.error("Supabase /api/me error:", error);
            return res.status(500).json({
                success: false,
                message: "Database error",
            });
        }

        if (!data) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        res.json({ success: true, user: data });
    } catch (err) {
        console.error("/api/me unexpected error:", err);
        res.status(500).json({
            success: false,
            message: "Server error",
        });
    }
});

// ---------- API: REGISTER ----------
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
            gradDate,
        } = req.body;

        // Basic validation
        if (
            !firstName ||
            !lastName ||
            !birthday ||
            !email ||
            !occupation ||
            !password
        ) {
            return res.json({
                success: false,
                message: "Please fill in all required fields.",
            });
        }

        // Check if email already exists
        const { data: existing, error: existingErr } = await supabase
            .from("users")
            .select("id")
            .eq("email", email)
            .maybeSingle();

        if (existingErr) {
            console.error("Supabase existingErr:", existingErr);
            return res.json({
                success: false,
                message: "Database error. Try again.",
            });
        }

        if (existing) {
            return res.json({
                success: false,
                message: "Email already exists.",
            });
        }

        const hashed = await bcrypt.hash(password, 10);

        const { data: inserted, error: insertErr } = await supabase
            .from("users")
            .insert({
                firstname: firstName,
                lastname: lastName,
                fullname: `${firstName} ${lastName}`,
                birthday, // YYYY-MM-DD string; Supabase will cast to date
                email,
                occupation,
                password_hash: hashed,
                street,
                city,
                state,
                zip,
                college,
                certificate,
                graddate: gradDate, // also date in DB
            })
            .select()
            .single();

        if (insertErr) {
            console.error("Supabase insertErr:", insertErr);
            return res.json({
                success: false,
                message: "Server error. Try again.",
            });
        }

        return res.json({
            success: true,
            message: "Registration successful. You can now log in.",
        });
    } catch (err) {
        console.error("/register unexpected error:", err);
        return res.json({
            success: false,
            message: "Server error. Try again.",
        });
    }
});

// ---------- API: LOGIN ----------
app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.json({
                success: false,
                message: "Please enter email and password.",
            });
        }

        const { data: user, error } = await supabase
            .from("users")
            .select("id, fullname, password_hash")
            .eq("email", email)
            .maybeSingle();

        if (error) {
            console.error("Supabase login error:", error);
            return res.json({
                success: false,
                message: "Database error. Try again.",
            });
        }

        if (!user) {
            return res.json({
                success: false,
                message: "Invalid email or password.",
            });
        }

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            return res.json({
                success: false,
                message: "Invalid email or password.",
            });
        }

        req.session.user = {
            id: user.id,
            fullname: user.fullname,
            email,
        };

        return res.json({
            success: true,
            message: "Login successful.",
        });
    } catch (err) {
        console.error("/login unexpected error:", err);
        return res.json({
            success: false,
            message: "Server error. Try again.",
        });
    }
});

// ---------- API: LOGOUT ----------
app.post("/logout", (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true, message: "Logged out." });
    });
});

// ---------- START SERVER ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
});
