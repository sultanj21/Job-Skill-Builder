// elevatorRoutes.js
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const router = express.Router();

// --------- OpenAI client ----------
const openai = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

// --------- Multer setup for audio upload ----------
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname) || ".wav";
        cb(null, unique + ext);
    },
});

const upload = multer({
    storage,
    limits: {
        fileSize: 25 * 1024 * 1024, // 25 MB
    },
    fileFilter: (req, file, cb) => {
        // basic mime check; adjust as needed
        if (
            file.mimetype.startsWith("audio/") ||
            [".mp3", ".wav", ".m4a", ".aac", ".ogg"].some((ext) =>
                file.originalname.toLowerCase().endsWith(ext)
            )
        ) {
            cb(null, true);
        } else {
            cb(new Error("Unsupported file type. Please upload an audio file."));
        }
    },
});

// --------- Helper: build a feedback prompt ----------
function buildFeedbackPrompt(transcript) {
    return `
You are a career coach specializing in evaluating elevator pitches.

The user recorded an elevator pitch for a job opportunity. Analyze it and provide structured feedback.

TRANSCRIPT:
"${transcript}"

Evaluate and give specific, actionable feedback on:

1. Cadence & pacing – Was the speech too fast, too slow, or appropriate? Note any rushed or dragged sections.
2. Pitch & tone – Comment on vocal variety, energy, and whether they sound confident and engaged.
3. Timing & length – Does it feel like a good elevator-pitch length (~30–90 seconds)? If you can’t tell exact time, infer from the transcript density.
4. Clarity & structure – Is there a clear intro, who they are, what they do, and what they’re looking for?
5. Content – Do they highlight relevant skills, experience, and value? Is it tailored to a role/industry?
6. Hook & memorability – Is there a memorable hook, story, or unique angle?
7. Suggestions – Provide **concrete rewrites** or example sentences they could use to improve.

Respond in a friendly, concise way with short paragraphs under each heading.
`;
}

// --------- POST /api/elevator/analyze ----------
router.post(
    "/elevator/analyze",
    upload.single("audio"),
    async (req, res) => {
        if (!openai) {
            return res.status(500).json({
                error: "OpenAI API key is not configured on the server.",
            });
        }

        const filePath = req.file?.path;

        if (!filePath) {
            return res.status(400).json({ error: "Audio file is required." });
        }

        try {
            // 1) Transcribe audio with OpenAI
            const transcription = await openai.audio.transcriptions.create({
                file: fs.createReadStream(filePath),
                model: "gpt-4o-mini-transcribe", // or "whisper-1" depending on availability
                // language: "en", // optional
            });

            const transcriptText =
                transcription.text || transcription.output || JSON.stringify(transcription);

            // 2) Ask the model to analyze the transcript and give feedback
            const feedbackPrompt = buildFeedbackPrompt(transcriptText);

            const completion = await openai.chat.completions.create({
                model: "gpt-4.1-mini", // or another chat model you prefer
                messages: [
                    {
                        role: "system",
                        content:
                            "You are a professional career coach giving feedback on elevator pitches.",
                    },
                    {
                        role: "user",
                        content: feedbackPrompt,
                    },
                ],
            });

            const feedback =
                completion.choices?.[0]?.message?.content ||
                "Sorry, I couldn't generate feedback right now.";

            // Optional: Delete file after processing to avoid disk bloat
            fs.unlink(filePath, (err) => {
                if (err) {
                    console.error("Error deleting uploaded audio:", err.message);
                }
            });

            res.json({
                transcript: transcriptText,
                feedback,
            });
        } catch (err) {
            console.error("Error analyzing elevator pitch:", err);
            // Clean up file on any error
            fs.unlink(filePath, () => {});
            res.status(500).json({
                error: "Failed to analyze elevator pitch. Please try again.",
            });
        }
    }
);

module.exports = router;
