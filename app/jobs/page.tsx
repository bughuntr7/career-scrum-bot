import { prisma } from "@/lib/prisma";

import JobsTable from "./JobsTable";

async function getJobs() {
  // For now, show all jobs regardless of user; later we can filter by logged-in user.
  const jobs = await prisma.jobApplication.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      company: true,
      externalUrl: true,
      createdAt: true,
      jobrightMatchScore: true,
      jobDescription: {
        select: {
          id: true,
        },
      },
      tailoredResumes: {
        select: {
          id: true,
        },
      },
      coverLetters: {
        select: {
          id: true,
        },
      },
    },
  });

  // Shape data for the UI: add flags and drop relation arrays
  return jobs.map((job) => {
    const { jobDescription, tailoredResumes, coverLetters, ...rest } = job;
    return {
      ...rest,
      hasDescription: !!jobDescription,
      hasResume: (tailoredResumes ?? []).length > 0,
      hasCoverLetter: (coverLetters ?? []).length > 0,
    };
  });
}

export default async function JobsPage() {
  const jobs = await getJobs();

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "1.75rem", fontWeight: 600, marginBottom: "1rem" }}>
        Saved Job Applications
      </h1>
      {jobs.length === 0 ? (
        <p style={{ color: "#555" }}>No jobs saved yet. Run your Jobright scraper first.</p>
      ) : (
        <JobsTable initialJobs={jobs} />
      )}
    </main>
  );
}

