document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("reformatterForm");
    const resumeInput = document.getElementById("resumeInput");
    const jobInput = document.getElementById("jobInput");
    const statusMessage = document.getElementById("statusMessage");
    const resultSection = document.getElementById("resultSection");
    const resultInner = document.getElementById("resultInner");
    const resultPlaceholder = document.getElementById("resultPlaceholder");
    const tailoredSummary = document.getElementById("tailoredSummary");
    const tailoredResume = document.getElementById("tailoredResume");
    const skillsList = document.getElementById("skillsList");
    const suggestionsList = document.getElementById("suggestionsList");
    const resumeFileInput = document.getElementById("resumeFileInput");
    const resumeUploadBtn = document.getElementById("resumeUploadBtn");
    const uploadStatus = document.getElementById("uploadStatus");

    const normalizeResumeText = (value) => {
        if (!value) return "—";
        if (typeof value === "string") return value;
        if (Array.isArray(value)) return value.join("\n");
        if (typeof value === "object") {
            return Object.entries(value)
                .map(([section, content]) => {
                    if (Array.isArray(content)) {
                        return `${section}:\n- ${content.join("\n- ")}`;
                    }
                    if (typeof content === "object" && content !== null) {
                        return `${section}:\n${normalizeResumeText(content)}`;
                    }
                    return `${section}:\n${content}`;
                })
                .join("\n\n");
        }
        return String(value);
    };

    async function handleSubmit(evt) {
        evt.preventDefault();
        const resumeText = resumeInput.value.trim();
        const jobDescription = jobInput.value.trim();

        if (!resumeText || !jobDescription) {
            statusMessage.classList.remove("hidden");
            statusMessage.style.color = "var(--bad)";
            statusMessage.textContent = "Please provide both resume text and job description.";
            return;
        }

        statusMessage.classList.remove("hidden");
        statusMessage.style.color = "#333";
        statusMessage.textContent = "✨ Tailoring your resume...";
        resultPlaceholder.classList.remove("hidden");
        resultPlaceholder.textContent = "✨ Tailoring your resume...";
        resultInner.classList.add("hidden");

        try {
            const response = await fetch("/api/resume/reformatter", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ resumeText, jobDescription })
            });

            const data = await response.json();
            if (!response.ok) {
                const errorMsg = data.message || "Failed to tailor resume.";
                statusMessage.style.color = "var(--bad)";
                statusMessage.textContent = errorMsg;
                resultPlaceholder.textContent = errorMsg;
                return;
            }

            statusMessage.style.color = "var(--ok)";
            statusMessage.textContent = "✅ Resume tailored successfully!";
            resultPlaceholder.classList.add("hidden");
            resultInner.classList.remove("hidden");

            tailoredSummary.textContent = data.summary || "—";
            tailoredResume.textContent = normalizeResumeText(data.tailoredResume);

            const emphasizedSkills = Array.isArray(data.emphasizedSkills) ? data.emphasizedSkills : [];
            localStorage.setItem("resumeKeywords", JSON.stringify(emphasizedSkills));

            skillsList.innerHTML = "";
            emphasizedSkills.forEach((skill) => {
                const li = document.createElement("li");
                li.textContent = skill;
                skillsList.appendChild(li);
            });
            if (!skillsList.children.length) {
                const li = document.createElement("li");
                li.textContent = "No specific skills returned.";
                skillsList.appendChild(li);
            }

            suggestionsList.innerHTML = "";
            (data.suggestions || []).forEach((tip) => {
                const li = document.createElement("li");
                li.textContent = tip;
                suggestionsList.appendChild(li);
            });
            if (!suggestionsList.children.length) {
                const li = document.createElement("li");
                li.textContent = "No suggestions provided.";
                suggestionsList.appendChild(li);
            }

        } catch (err) {
            console.error("Resume reformatter request failed:", err);
            statusMessage.style.color = "var(--bad)";
            statusMessage.textContent = "Server error. Please try again.";
            resultPlaceholder.classList.remove("hidden");
            resultPlaceholder.textContent = "Server error. Please try again.";
            resultInner.classList.add("hidden");
        }
    }

    if (resumeUploadBtn && resumeFileInput) {
        resumeUploadBtn.addEventListener("click", async () => {
            const file = resumeFileInput.files?.[0];
            if (!file) {
                if (uploadStatus) {
                    uploadStatus.textContent = "Please choose a file first.";
                    uploadStatus.style.color = "var(--bad)";
                }
                return;
            }

            const formData = new FormData();
            formData.append("resume", file);
            if (uploadStatus) {
                uploadStatus.textContent = "⏳ Extracting text and skills...";
                uploadStatus.style.color = "#333";
            }

            try {
                const response = await fetch("/api/upload", {
                    method: "POST",
                    body: formData
                });
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.message || "Resume upload failed.");
                }

                if (data.resumeText) {
                    resumeInput.value = data.resumeText;
                }

                const skills = Array.isArray(data.skills) ? data.skills : [];
                if (skills.length) {
                    localStorage.setItem("resumeKeywords", JSON.stringify(skills));
                }

                if (uploadStatus) {
                    uploadStatus.textContent = data.message || "Resume processed.";
                    uploadStatus.style.color = "var(--ok)";
                }
            } catch (err) {
                console.error("Resume upload failed:", err);
                if (uploadStatus) {
                    uploadStatus.textContent = err.message || "Unable to process resume. Try again.";
                    uploadStatus.style.color = "var(--bad)";
                }
            }
        });
    }

    form.addEventListener("submit", handleSubmit);
});
