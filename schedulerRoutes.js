// schedulerRoutes.js
const express = require("express");
const nodemailer = require("nodemailer");
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");

const router = express.Router();

/** -------- Paths for data files -------- **/
const usersFilePath = path.join(__dirname, "users.json");
const eventsFilePath = path.join(__dirname, "events.json");

/** -------- Helpers for reading/writing JSON -------- **/
function readJsonFile(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) {
            return fallback;
        }
        const raw = fs.readFileSync(filePath, "utf8");
        if (!raw.trim()) return fallback;
        return JSON.parse(raw);
    } catch (err) {
        console.error(`Error reading JSON from ${filePath}:`, err.message);
        return fallback;
    }
}

function writeJsonFile(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    } catch (err) {
        console.error(`Error writing JSON to ${filePath}:`, err.message);
    }
}

/** -------- USER EMAIL FROM users.json -------- **/
function getCurrentUserEmail() {
    const data = readJsonFile(usersFilePath, null);

    if (Array.isArray(data)) {
        const userWithEmail = data.find(
            (u) => u && typeof u.email === "string" && u.email.trim() !== ""
        );
        if (userWithEmail) {
            return userWithEmail.email;
        }
    }

    if (data && typeof data.email === "string" && data.email.trim() !== "") {
        return data.email;
    }

    return null;
}

/** -------- EVENT STORAGE (events.json) -------- **/
function loadEvents() {
    return readJsonFile(eventsFilePath, []);
}

function saveEvents(events) {
    writeJsonFile(eventsFilePath, events);
}

/** -------- EMAIL TRANSPORT -------- **/
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT || 587),
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

async function sendNotificationEmail(event, whenLabel) {
    const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;
    const startDate = new Date(event.startTime);
    const formattedTime = startDate.toLocaleString("en-US", {
        dateStyle: "full",
        timeStyle: "short",
    });

    const mailOptions = {
        from,
        to: event.userEmail,
        subject: `Reminder (${whenLabel}): ${event.name}`,
        text:
            `This is a reminder for your event:\n\n` +
            `Event: ${event.name}\n` +
            `When: ${formattedTime}\n\n` +
            (event.notes ? `Notes:\n${event.notes}\n\n` : "") +
            `- Job Skill Builder Scheduler`,
    };

    await transporter.sendMail(mailOptions);
}

/** -------- CRON JOB (runs every minute) -------- **/
cron.schedule("* * * * *", async () => {
    const now = new Date();
    let events = loadEvents();
    let changed = false;

    try {
        for (const ev of events) {
            if (!ev.notify) continue;

            const start = new Date(ev.startTime);
            const diffMs = start.getTime() - now.getTime();
            const diffMin = diffMs / (1000 * 60);

            // 1 day before
            if (!ev.notifiedOneDay && diffMin <= 1441 && diffMin >= 1439) {
                try {
                    await sendNotificationEmail(ev, "1 day before");
                    ev.notifiedOneDay = true;
                    changed = true;
                } catch (e) {
                    console.error("Error sending 1-day email:", e.message);
                }
            }

            // 1 hour before
            if (!ev.notifiedOneHour && diffMin <= 61 && diffMin >= 59) {
                try {
                    await sendNotificationEmail(ev, "1 hour before");
                    ev.notifiedOneHour = true;
                    changed = true;
                } catch (e) {
                    console.error("Error sending 1-hour email:", e.message);
                }
            }
        }

        if (changed) {
            saveEvents(events);
        }
    } catch (err) {
        console.error("Scheduler CRON error:", err.message);
    }
});

/** -------- ROUTES -------- **/

// POST /api/events
router.post("/events", async (req, res) => {
    try {
        if (!req.body) {
            return res.status(400).json({ error: "Request body is missing." });
        }

        const { name, date, time, notify, notes } = req.body;

        const userEmail = getCurrentUserEmail();
        if (!userEmail) {
            return res.status(500).json({
                error:
                    "Could not determine user email from server-side users.json file.",
            });
        }

        // Required fields
        if (!name || !date || !time || typeof notify === "undefined") {
            return res.status(400).json({ error: "Missing required fields." });
        }

        if (name.length > 300) {
            return res
                .status(400)
                .json({ error: "Event name must be 300 characters or less." });
        }

        if (notes && notes.length > 2000) {
            return res
                .status(400)
                .json({ error: "Additional notes must be 2000 characters or less." });
        }

        // Parse date: MM/DD/YYYY
        const [monthStr, dayStr, yearStr] = date.split("/");
        const month = Number(monthStr) - 1;
        const day = Number(dayStr);
        const year = Number(yearStr);

        if (
            !Number.isInteger(month) ||
            !Number.isInteger(day) ||
            !Number.isInteger(year)
        ) {
            return res.status(400).json({ error: "Invalid date format." });
        }

        // Parse time
        let hours = 0;
        let minutes = 0;
        let timeString = time.trim().toUpperCase();

        if (timeString.includes("AM") || timeString.includes("PM")) {
            const meridian = timeString.endsWith("PM") ? "PM" : "AM";
            timeString = timeString.replace("AM", "").replace("PM", "").trim();
            const [hStr, mStr] = timeString.split(":");
            hours = Number(hStr);
            minutes = Number(mStr || "0");

            if (meridian === "PM" && hours !== 12) hours += 12;
            if (meridian === "AM" && hours === 12) hours = 0;
        } else {
            const [hStr, mStr] = timeString.split(":");
            hours = Number(hStr);
            minutes = Number(mStr || "0");
        }

        if (
            !Number.isFinite(hours) ||
            !Number.isFinite(minutes) ||
            hours < 0 ||
            hours > 23 ||
            minutes < 0 ||
            minutes > 59
        ) {
            return res.status(400).json({ error: "Invalid time format." });
        }

        const startTime = new Date(year, month, day, hours, minutes, 0, 0);

        // Load, append, save
        const events = loadEvents();
        const newEvent = {
            id: Date.now(), // simple unique id
            name,
            startTime: startTime.toISOString(),
            notify: !!notify,
            notes: notes || "",
            userEmail,
            notifiedOneDay: false,
            notifiedOneHour: false,
        };

        events.push(newEvent);
        saveEvents(events);

        res.status(201).json(newEvent);
    } catch (err) {
        console.error("POST /api/events error:", err);
        res.status(500).json({ error: "Internal server error." });
    }
});

// GET /api/events?month=YYYY-MM
router.get("/events", (req, res) => {
    try {
        const monthParam = req.query.month;
        if (!monthParam) {
            return res.status(400).json({ error: "month query parameter required." });
        }

        const [yearStr, monthStr] = monthParam.split("-");
        const year = Number(yearStr);
        const monthIndex = Number(monthStr) - 1;

        if (
            !Number.isInteger(year) ||
            !Number.isInteger(monthIndex) ||
            monthIndex < 0 ||
            monthIndex > 11
        ) {
            return res.status(400).json({ error: "Invalid month format." });
        }

        const monthStart = new Date(year, monthIndex, 1, 0, 0, 0, 0);
        const monthEnd = new Date(year, monthIndex + 1, 1, 0, 0, 0, 0);

        const events = loadEvents().filter((ev) => {
            const d = new Date(ev.startTime);
            return d >= monthStart && d < monthEnd;
        });

        // Sort by startTime
        events.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

        res.json(events);
    } catch (err) {
        console.error("GET /api/events error:", err);
        res.status(500).json({ error: "Internal server error." });
    }
});

// DELETE /api/events/:id
router.delete("/events/:id", (req, res) => {
    try {
        const idParam = req.params.id;
        if (!idParam) {
            return res.status(400).json({ error: "Event id is required." });
        }

        const id = Number(idParam);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ error: "Invalid event id." });
        }

        const events = loadEvents();
        const beforeCount = events.length;
        const remaining = events.filter((ev) => ev.id !== id);

        if (remaining.length === beforeCount) {
            // nothing removed
            return res.status(404).json({ error: "Event not found." });
        }

        saveEvents(remaining);
        return res.status(200).json({ success: true });
    } catch (err) {
        console.error("DELETE /api/events/:id error:", err);
        return res.status(500).json({ error: "Internal server error." });
    }
});

module.exports = router;
