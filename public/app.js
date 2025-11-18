document.addEventListener('DOMContentLoaded', () => {

    // ---------- Step 0: Check if user is logged in ----------
    const requiresAuth = document.body?.dataset?.requireAuth === "true";
    const currentUser = JSON.parse(localStorage.getItem("user"));
    if (requiresAuth && !currentUser) {
        // If not logged in, redirect to login page
        window.location.href = "login.html";
        return;
    }

    // ---------- Step 1: Logout ----------
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            localStorage.removeItem("user"); // Clear logged-in user
            window.location.href = "login.html"; // Redirect to login
        });
    }

    // ---------- Step 2: Handle Resume Upload ----------
    const analyzeBtn = document.getElementById("analyzeBtn");
    if (analyzeBtn) {
        analyzeBtn.addEventListener("click", async () => {
            const file = document.getElementById("resumeFile").files[0];
            const out = document.getElementById("analysis");
            if (!file) return alert("Please upload a file first!");

            const formData = new FormData();
            formData.append("resume", file);

            out.classList.remove("hidden");
            out.innerHTML = "⏳ Analyzing your resume...";

            const response = await fetch("/api/upload", { method: "POST", body: formData });
            const data = await response.json();

            if (!response.ok) {
                out.innerHTML = `❌ ${data.message || "Failed to analyze resume."}`;
                return;
            }

            const skillsArray = Array.isArray(data.skills) ? data.skills : [];
            localStorage.setItem("resumeKeywords", JSON.stringify(skillsArray));

            const skills = skillsArray.length ? skillsArray.join(", ") : "Not detected";
            const summary = data.summary ? `<strong>Summary:</strong> ${data.summary}<br>` : "";
            const roles = Array.isArray(data.recommendedRoles) && data.recommendedRoles.length
                ? `<strong>Recommended Roles:</strong> ${data.recommendedRoles.join(", ")}<br>`
                : "";

            out.innerHTML = `✅ ${data.message}<br>${summary}${roles}<strong>Extracted Skills:</strong> ${skills}`;
        });
    }

    // ---------- Step 3: Handle Job Recommendations ----------
    const filterJobsBtn = document.getElementById("filterJobsBtn");
    const resumeKeywordsInput = document.getElementById("resumeKeywordsInput");
    const jobsList = document.getElementById("jobsList");
    const jobStatus = document.getElementById("jobStatus");
    const pendingBanner = document.getElementById("pendingApplicationBanner");
    const PENDING_KEY = "pendingApplications";
    const TRACKED_KEY = "appliedJobsLog";
    let cachedJobs = [];

    sessionStorage.removeItem("pendingBannerSnooze");

    const getStoredResumeKeywords = () => {
        try {
            const raw = localStorage.getItem("resumeKeywords");
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed.map((entry) => entry?.toString().trim()).filter(Boolean);
            }
            if (typeof parsed === "string") {
                return parsed.split(/[,;]+/).map((entry) => entry.trim()).filter(Boolean);
            }
            return [];
        } catch (err) {
            console.warn("Unable to parse stored resume keywords", err);
            return [];
        }
    };

    const fetchJobs = async () => {
        if (cachedJobs.length) return cachedJobs;
        const res = await fetch("/api/jobs");
        cachedJobs = await res.json();
        return cachedJobs;
    };

    const normalizeWord = (word) => word.toLowerCase().replace(/[^a-z0-9+]/g, "");

    const extractKeywords = (text) => {
        return Array.from(
            new Set(
                text
                    .split(/\s+/)
                    .map(normalizeWord)
                    .filter((word) => word.length > 3)
            )
        );
    };

    const getPendingApplications = () => JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
    const savePendingApplications = (queue) => localStorage.setItem(PENDING_KEY, JSON.stringify(queue));
    const logApplication = (job) => {
        const log = JSON.parse(localStorage.getItem(TRACKED_KEY) || "[]");
        log.push({ ...job, loggedAt: new Date().toISOString() });
        localStorage.setItem(TRACKED_KEY, JSON.stringify(log));
    };
    const renderPendingBanner = () => {
        if (!pendingBanner) return;
        if (sessionStorage.getItem("pendingBannerSnooze") === "true") {
            pendingBanner.classList.add("hidden");
            return;
        }
        const queue = getPendingApplications();
        if (!queue.length) {
            pendingBanner.classList.add("hidden");
            pendingBanner.innerHTML = "";
            return;
        }
        const job = queue[0];
        pendingBanner.classList.remove("hidden");
        pendingBanner.innerHTML = `
            <div>
                <strong>Did you apply?</strong><br>
                ${job.title} @ ${job.company}
            </div>
            <div class="banner-actions">
                <button type="button" data-banner-action="log">Yes, log it</button>
                <button type="button" data-banner-action="later">Remind me later</button>
                <button type="button" data-banner-action="skip">Skip</button>
            </div>
        `;
    };
    const queueJobForTracker = (job) => {
        const queue = getPendingApplications();
        queue.push({ ...job, queuedAt: new Date().toISOString() });
        savePendingApplications(queue);
        sessionStorage.removeItem("pendingBannerSnooze");
        renderPendingBanner();
    };
    if (pendingBanner) {
        pendingBanner.addEventListener("click", (event) => {
            const action = event.target.dataset.bannerAction;
            if (!action) return;
            const queue = getPendingApplications();
            if (!queue.length) {
                pendingBanner.classList.add("hidden");
                return;
            }
            const current = queue[0];
            if (action === "log") {
                logApplication(current);
                queue.shift();
                savePendingApplications(queue);
                alert(`Saved ${current.title} at ${current.company} to your tracker queue.`);
            } else if (action === "skip") {
                queue.shift();
                savePendingApplications(queue);
            } else if (action === "later") {
                sessionStorage.setItem("pendingBannerSnooze", "true");
                pendingBanner.classList.add("hidden");
                return;
            }
            sessionStorage.removeItem("pendingBannerSnooze");
            renderPendingBanner();
        });
    }

    const renderJobs = (jobs) => {
        if (!jobsList) return;
        if (!jobs.length) {
            jobsList.innerHTML = "<p>No matching job postings at the moment.</p>";
            return;
        }
        jobsList.innerHTML = jobs.map(job => {
            const logoContent = job.logo
                ? `<img src="${job.logo}" alt="${job.company} logo"/>`
                : `<span>${job.company?.charAt(0) || "?"}</span>`;
            const tags = [
                job.type,
                job.salary,
                job.location
            ].filter(Boolean);
            const keywordTags = (job.keywords || []).slice(0, 4).map(k => `<span>${k}</span>`).join("");
            const trackerPayload = encodeURIComponent(JSON.stringify({
                title: job.title,
                company: job.company,
                location: job.location,
                salary: job.salary,
                type: job.type,
                link: job.link,
                description: job.description
            }));
            return `
                <div class="job-card">
                    <div class="job-logo">${logoContent}</div>
                    <div class="job-body">
                        <h3>${job.title}</h3>
                        <p class="job-meta">${job.company}${job.location ? " · " + job.location : ""}</p>
                        <p>${job.description || ""}</p>
                        <div class="job-tags">
                            ${tags.map(tag => `<span>${tag}</span>`).join("")}
                            ${keywordTags}
                        </div>
                        <div class="job-actions">
                            <a class="job-apply" data-job="${trackerPayload}" href="${job.link}" target="_blank" rel="noopener">View / Apply</a>
                        </div>
                    </div>
                </div>
            `;
        }).join("");
    };

    if (filterJobsBtn && resumeKeywordsInput) {
        const storedWords = getStoredResumeKeywords();
        if (!resumeKeywordsInput.value.trim() && storedWords.length) {
            resumeKeywordsInput.value = storedWords.join(", ");
            if (jobStatus) {
                jobStatus.textContent = "Using skills from your last analyzed resume. Adjust below if needed.";
            }
        } else if (jobStatus && !storedWords.length) {
            jobStatus.textContent = "Upload your resume or enter keywords to get tailored roles.";
        }

        filterJobsBtn.addEventListener("click", async () => {
            if (jobStatus) {
                jobStatus.textContent = "Matching jobs to your resume...";
            }

            const filterText = resumeKeywordsInput.value.trim();
            let keywords = extractKeywords(filterText);
            if (!keywords.length) {
                keywords = getStoredResumeKeywords()
                    .map((word) => normalizeWord(word))
                    .filter(Boolean);
            }
            if (!keywords.length) {
                if (jobStatus) {
                    jobStatus.textContent = "Please upload a resume or type some keywords to get recommendations.";
                }
                alert("Upload your resume on the Upload Resume page or enter keywords to get job recommendations.");
                return;
            }
            const jobs = await fetchJobs();

            const filtered = jobs.filter(job => {
                const jobKeywords = (job.keywords || []).map(normalizeWord);
                return keywords.some(key => jobKeywords.includes(key));
            });

            if (jobStatus) {
                jobStatus.textContent = `Showing ${filtered.length} role(s) that mention ${keywords.slice(0, 5).join(", ")}`;
            }

            renderJobs(filtered);
        });

        // initial load
        fetchJobs().then((jobs) => {
            renderJobs(jobs);
            if (jobStatus) {
                jobStatus.textContent = storedWords.length
                    ? `Using ${storedWords.length} stored skill(s).`
                    : `Showing all ${jobs.length} role(s). Paste resume keywords to refine.`;
            }
            renderPendingBanner();
        });

        if (jobsList) {
            jobsList.addEventListener("click", (event) => {
                const link = event.target.closest(".job-apply");
                if (!link) return;
                const jobData = JSON.parse(decodeURIComponent(link.dataset.job || "%7B%7D"));
                queueJobForTracker(jobData);
            });
        }
    } else {
        renderPendingBanner();
    }

    // ---------- Step 4: Handle Login ----------
    const loginBtn = document.getElementById("loginBtn");
    if (loginBtn) {
        loginBtn.addEventListener("click", async () => {
            const username = document.getElementById("loginUsername").value;
            const password = document.getElementById("loginPassword").value;
            const out = document.getElementById("loginResult");

            const res = await fetch("/api/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            });

            const data = await res.json();
            out.classList.remove("hidden");
            out.innerHTML = data.message;

            if (res.ok) {
                localStorage.setItem("user", JSON.stringify(data.user));
                window.location.href = "index.html";
            }
        });
    }

    // ---------- Step 5: Handle Registration ----------
    const registerBtn = document.getElementById("registerBtn");
    if (registerBtn) {
        registerBtn.addEventListener("click", async () => {
            const name = document.getElementById("regName").value;
            const username = document.getElementById("regUsername").value;
            const password = document.getElementById("regPassword").value;
            const out = document.getElementById("regResult");

            const res = await fetch("/api/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, username, password })
            });

            const data = await res.json();
            out.classList.remove("hidden");
            out.innerHTML = data.message;

            if (res.ok) {
                localStorage.setItem("user", JSON.stringify({ username, name }));
                window.location.href = "index.html";
            }
        });
    }

});
