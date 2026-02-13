export default function HomePage() {
  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "2rem", fontWeight: 600, marginBottom: "0.5rem" }}>
        Job Application Bot
      </h1>
      <p style={{ marginBottom: "1.5rem", color: "#555" }}>
        Next.js scaffold is ready. We&apos;ll now add database, automation, and UI
        for managing your Jobright applications.
      </p>
      <ul style={{ listStyle: "disc", paddingLeft: "1.5rem", color: "#333" }}>
        <li>PostgreSQL + Prisma schema and migrations</li>
        <li>API routes for jobs, resumes, and automation runs</li>
        <li>Playwright-based Jobright scanner worker</li>
        <li>Dashboard, Job list, Job detail, and Resume management pages</li>
      </ul>
    </main>
  );
}

