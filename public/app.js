document.addEventListener('DOMContentLoaded', () => {

    // ---------- Step 0: Check if user is logged in ----------
    const currentUser = JSON.parse(localStorage.getItem("user"));
    if (!currentUser) {
        // If not logged in, redirect to login page
        window.location.href = "login.html";
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

            out.innerHTML = `✅ ${data.message}<br><strong>Extracted Skills:</strong> ${data.skills.join(", ")}`;
        });
    }

    // ---------- Step 3: Handle Job Recommendations ----------
    const loadJobsBtn = document.getElementById("loadJobsBtn");
    if (loadJobsBtn) {
        loadJobsBtn.addEventListener("click", async () => {
            const res = await fetch("/api/jobs");
            const jobs = await res.json();
            const container = document.getElementById("jobs");
            container.innerHTML = jobs.map(job =>
                `<div class="job-card">
                   <h3>${job.title}</h3>
                   <p>${job.company} — ${job.location}</p>
                   <a href="${job.link}" target="_blank">Apply</a>
                 </div>`
            ).join("");
        });
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
