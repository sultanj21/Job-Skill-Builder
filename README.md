# Job-Skill-Builder
Pathway: Job Skills Builder Platform

Pathway is an AI-powered career readiness platform designed to help users strengthen their skills, optimize resumes, prepare for interviews, and expand their professional networks—all in one place. Developed by a team of computer science students from Georgia State University, this project integrates cutting-edge technologies to streamline the job search process and enhance employability outcomes.

The platform enables users to:

Build tailored resumes using Generative AI that aligns with specific job descriptions.

Receive personalized job recommendations based on uploaded resumes and skill profiles.

Access skill-building resources and AI-generated project ideas to enhance technical growth.

Track applications, schedule deadlines, and manage career goals using the built-in planner.

Participate in mock AI interviews with instant feedback and analytics.

Sync data with LinkedIn for seamless professional networking.

With a focus on innovation, user experience, and data security, Pathway integrates AI models, third-party APIs, and secure authentication to provide a comprehensive all-in-one solution for modern job seekers.

Developed by: Amogh, Sashank, Matt, Niruthiya, Ananti, and Sultan
Course: Software Engineering Project (Fall 2025)
Guide: Dr. Tushara Sadasivuni

## Supabase / Postgres Setup

1. In the Supabase dashboard open **Project Settings → Database** and click **Reset database password** (or set it during project creation). Choose a strong password; this is the value that replaces `[YOUR_PASSWORD]` in the connection string Supabase shows at the top of that page.
2. Copy the full URL (for example `postgresql://postgres:<PASSWORD>@db.dvyowyoxiixtfsjyqqae.supabase.co:5432/postgres`) and add it to your `.env` file:
   ```
   SUPABASE_DB_URL=postgresql://postgres:<PASSWORD>@db.dvyowyoxiixtfsjyqqae.supabase.co:5432/postgres
   SUPABASE_USERS_TABLE=users
   ```
   Leave `SUPABASE_USERS_TABLE` unset if you want to use the default `users` table.
3. Restart `node server.js`. When the env vars are present the API stores login data inside Supabase; if they are missing the code falls back to the local `users.json` file for offline development.
