"use client";

import { useState, useMemo } from "react";
import Link from "next/link";

type Job = {
  id: number;
  title: string;
  company: string;
  externalUrl: string;
  createdAt: string;
  jobrightMatchScore: number | null;
  hasDescription: boolean;
  hasResume: boolean;
  hasCoverLetter: boolean;
};

export default function JobsTable({ initialJobs }: { initialJobs: Job[] }) {
  const [jobs, setJobs] = useState(initialJobs);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ 
    title: "", 
    company: "", 
    externalUrl: "",
    description: ""
  });
  const [dateFilter, setDateFilter] = useState<string>("all"); // "all", "today", "week", "month"
  const [descriptionFilter, setDescriptionFilter] = useState<string>("all"); // "all", "with", "without"
  const [loadingEditForm, setLoadingEditForm] = useState(false);
  const [savingEditForm, setSavingEditForm] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState<string>("");
  const [scanCount, setScanCount] = useState<number>(5); // Default to 5 jobs
  const [generatingDocsForId, setGeneratingDocsForId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>("");

  const handleEdit = async (job: Job) => {
    setEditingId(job.id);
    setLoadingEditForm(true);
    
    // Load job data
    setEditForm({
      title: job.title,
      company: job.company,
      externalUrl: job.externalUrl,
      description: "",
    });

    // Load job description if it exists
    try {
      const response = await fetch(`/api/jobs/${job.id}/description`);
      if (response.ok) {
        const data = await response.json();
        setEditForm(prev => ({ ...prev, description: data.fullText || "" }));
      }
    } catch (error) {
      // Description doesn't exist or error loading - leave empty
    } finally {
      setLoadingEditForm(false);
    }
  };

  const handleSave = async (id: number) => {
    setSavingEditForm(true);
    try {
      // Save job metadata
      const jobResponse = await fetch(`/api/jobs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editForm.title,
          company: editForm.company,
          externalUrl: editForm.externalUrl,
        }),
      });

      if (!jobResponse.ok) {
        throw new Error("Failed to update job");
      }

      const updated = await jobResponse.json();

      // Save job description
      if (editForm.description.trim()) {
        try {
          const descResponse = await fetch(`/api/jobs/${id}/description`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fullText: editForm.description }),
          });

          if (!descResponse.ok) {
            console.warn("Failed to update description, but job was updated");
          }
        } catch (error) {
          console.warn("Error updating description:", error);
        }
      }

      // Update local state
      setJobs(jobs.map((j) => 
        j.id === id 
          ? { ...updated, hasDescription: editForm.description.trim().length > 0, hasResume: j.hasResume, hasCoverLetter: j.hasCoverLetter }
          : j
      ));
      setEditingId(null);
      alert("✅ Job updated successfully");
    } catch (error: any) {
      alert(`❌ Failed to update job: ${error.message || "Unknown error"}`);
    } finally {
      setSavingEditForm(false);
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditForm({ title: "", company: "", externalUrl: "", description: "" });
  };

  const handleGenerateDocs = async (job: Job) => {
    // Require job description before generating docs
    if (!job.hasDescription) {
      const goToEdit = confirm(
        "This job does not have a description yet.\n\n" +
        "To generate a tailored resume and cover letter, please add a job description first.\n\n" +
        "Do you want to open the Edit form now?"
      );
      if (goToEdit) {
        await handleEdit(job);
      }
      return;
    }

    if (generatingDocsForId === job.id) return;

    setGeneratingDocsForId(job.id);
    try {
      const response = await fetch(`/api/jobs/${job.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}), // Use defaults on the server
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || data.message || "Failed to generate documents");
      }

      alert("✅ Resume and cover letter generated successfully");

      // Optimistically update local state to reflect generated docs
      setJobs(jobs.map((j) =>
        j.id === job.id
          ? { ...j, hasResume: true, hasCoverLetter: true }
          : j
      ));
    } catch (error: any) {
      alert(`❌ Failed to generate documents: ${error.message || "Unknown error"}`);
    } finally {
      setGeneratingDocsForId(null);
    }
  };

  const handleDelete = async (id: number) => {
    const job = jobs.find((j) => j.id === id);
    if (!job) return;

    const hasDocs = job.hasResume || job.hasCoverLetter || job.hasDescription;
    const confirmMessage = hasDocs
      ? `Are you sure you want to delete "${job.title}" at ${job.company}?\n\nThis will delete:\n- Job application\n- Job description\n- Generated resumes\n- Generated cover letters\n- All related files\n\nThis action cannot be undone.`
      : `Are you sure you want to delete "${job.title}" at ${job.company}?\n\nThis action cannot be undone.`;

    if (!confirm(confirmMessage)) return;

    try {
      const response = await fetch(`/api/jobs/${id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setJobs(jobs.filter((j) => j.id !== id));
        alert("✅ Job and all related data deleted successfully");
      } else {
        const error = await response.json();
        alert(`❌ Failed to delete job: ${error.error || "Unknown error"}`);
      }
    } catch (error: any) {
      alert(`❌ Error deleting job: ${error.message || "Unknown error"}`);
    }
  };

  // Filter jobs by date and description
  const filteredJobs = useMemo(() => {
    let filtered = jobs;

    // Filter by date
    if (dateFilter !== "all") {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      const monthAgo = new Date(today);
      monthAgo.setMonth(monthAgo.getMonth() - 1);

      filtered = filtered.filter((job) => {
        const jobDate = new Date(job.createdAt);
        switch (dateFilter) {
          case "today":
            return jobDate >= today;
          case "week":
            return jobDate >= weekAgo;
          case "month":
            return jobDate >= monthAgo;
          default:
            return true;
        }
      });
    }

    // Filter by description presence
    if (descriptionFilter !== "all") {
      filtered = filtered.filter((job) => {
        if (descriptionFilter === "with") {
          return job.hasDescription;
        } else if (descriptionFilter === "without") {
          return !job.hasDescription;
        }
        return true;
      });
    }

    // Text search across multiple fields
    if (searchTerm.trim()) {
      const query = searchTerm.toLowerCase();
      filtered = filtered.filter((job) => {
        const dateStr = new Date(job.createdAt).toLocaleDateString().toLowerCase();
        const company = job.company.toLowerCase();
        const title = job.title.toLowerCase();
        const url = job.externalUrl.toLowerCase();
        const matchScore = job.jobrightMatchScore !== null ? String(job.jobrightMatchScore) : "";

        return (
          company.includes(query) ||
          title.includes(query) ||
          url.includes(query) ||
          dateStr.includes(query) ||
          matchScore.includes(query)
        );
      });
    }

    return filtered;
  }, [jobs, dateFilter, descriptionFilter, searchTerm]);



  // Trigger job scan
  const handleScanJobs = async () => {
    if (scanning) return;
    
    setScanning(true);
    setScanStatus(`Starting scan for ${scanCount} jobs...`);
    
    // Store initial job count to track progress
    const initialJobCount = jobs.length;
    let lastJobCount = initialJobCount;
    
    // Poll for new jobs every 3 seconds while scanning
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch("/api/jobs");
        if (response.ok) {
          const newJobs = await response.json();
          const currentCount = newJobs.length;
          
          if (currentCount > lastJobCount) {
            const newJobsCount = currentCount - lastJobCount;
            setScanStatus(`⏳ Scanning... Found ${newJobsCount} new job(s) (${currentCount - initialJobCount} total so far)`);
            // Update jobs list without full page reload
            setJobs(newJobs.map((job: any) => ({
              ...job,
              hasDescription: !!job.jobDescription,
              hasResume: job.tailoredResumes?.length > 0,
              hasCoverLetter: job.coverLetters?.length > 0,
            })));
            lastJobCount = currentCount;
          }
        }
      } catch (error) {
        // Ignore polling errors
      }
    }, 3000);
    
    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maxJobs: scanCount,
          autoGenerateDocuments: true, // Keep default behavior
        }),
      });
      
      const result = await response.json();
      
      // Stop polling
      clearInterval(pollInterval);
      
      if (result.success) {
        const finalCount = lastJobCount - initialJobCount;
        setScanStatus(`✅ Scan completed! Processed ${finalCount} job(s). Refreshing...`);
        // Final refresh to get all updates
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      } else {
        clearInterval(pollInterval);
        setScanStatus(`❌ Scan failed: ${result.message}`);
        setScanning(false);
      }
    } catch (error) {
      clearInterval(pollInterval);
      setScanStatus("❌ Error starting scan");
      setScanning(false);
    }
  };

  // Export to CSV
  const handleExportCSV = () => {
    // Headers matching the table structure
    const headers = [
      "Date",
      "Company",
      "Job Title",
      "Site URL",
      "Match Score",
      "Description",
      "Resume",
      "Cover Letter",
    ];

    // Helper function to escape CSV values properly
    const escapeCSV = (value: any): string => {
      if (value === null || value === undefined) return "";
      const stringValue = String(value);
      // If contains comma, quote, or newline, wrap in quotes and escape quotes
      if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    };

    const rows = filteredJobs.map((job) => [
      new Date(job.createdAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }),
      job.company,
      job.title,
      job.externalUrl,
      job.jobrightMatchScore ? `${job.jobrightMatchScore}%` : "N/A",
      job.hasDescription ? "Yes" : "No",
      job.hasResume ? "Yes" : "No",
      job.hasCoverLetter ? "Yes" : "No",
    ]);

    // Build CSV content with proper escaping
    const csvContent = [
      headers.map(escapeCSV).join(","),
      ...rows.map((row) => row.map(escapeCSV).join(",")),
    ].join("\n");

    // Add BOM for Excel compatibility (UTF-8 BOM)
    const BOM = "\uFEFF";
    const blob = new Blob([BOM + csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    
    // Generate filename with date filter and timestamp
    const dateStr = new Date().toISOString().split("T")[0];
    const filterStr = dateFilter === "all" ? "all" : dateFilter;
    link.setAttribute("download", `job-applications-${filterStr}-${dateStr}.csv`);
    link.setAttribute("href", url);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Clean up
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  return (
    <div>
      {/* Filter and Export Controls */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem",
          gap: "1rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <label htmlFor="dateFilter" style={{ fontWeight: 500 }}>
              Filter by Date:
            </label>
            <select
              id="dateFilter"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              style={{
                padding: "0.5rem",
                border: "1px solid #d1d5db",
                borderRadius: "4px",
                fontSize: "0.875rem",
              }}
            >
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="week">Last 7 Days</option>
              <option value="month">Last 30 Days</option>
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <label htmlFor="descriptionFilter" style={{ fontWeight: 500 }}>
              Filter by Description:
            </label>
            <select
              id="descriptionFilter"
              value={descriptionFilter}
              onChange={(e) => setDescriptionFilter(e.target.value)}
              style={{
                padding: "0.5rem",
                border: "1px solid #d1d5db",
                borderRadius: "4px",
                fontSize: "0.875rem",
              }}
            >
              <option value="all">All Jobs</option>
              <option value="with">With Description</option>
              <option value="without">Without Description</option>
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: "220px" }}>
            <label htmlFor="searchJobs" style={{ fontWeight: 500 }}>
              Search:
            </label>
            <input
              id="searchJobs"
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search company, title, URL, score..."
              style={{
                flex: 1,
                minWidth: "160px",
                padding: "0.5rem",
                border: "1px solid #d1d5db",
                borderRadius: "4px",
                fontSize: "0.875rem",
              }}
            />
          </div>
          <span style={{ color: "#6b7280", fontSize: "0.875rem" }}>
            ({filteredJobs.length} {filteredJobs.length === 1 ? "job" : "jobs"})
          </span>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <label htmlFor="scanCount" style={{ fontWeight: 500, fontSize: "0.875rem" }}>
              Jobs to scan:
            </label>
            <select
              id="scanCount"
              value={scanCount}
              onChange={(e) => setScanCount(Number(e.target.value))}
              disabled={scanning}
              style={{
                padding: "0.5rem",
                border: "1px solid #d1d5db",
                borderRadius: "4px",
                fontSize: "0.875rem",
                backgroundColor: scanning ? "#f3f4f6" : "white",
                cursor: scanning ? "not-allowed" : "pointer",
              }}
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={30}>30</option>
            </select>
          </div>
          <button
            onClick={handleScanJobs}
            disabled={scanning}
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: scanning ? "#9ca3af" : "#3b82f6",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: scanning ? "not-allowed" : "pointer",
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              opacity: scanning ? 0.6 : 1,
            }}
          >
            {scanning ? "⏳ Scanning..." : "🔍 Scan Jobs"}
          </button>
          <button
            onClick={handleExportCSV}
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: "#10b981",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            📥 Export to CSV
          </button>
        </div>
      </div>
      {scanStatus && (
        <div
          style={{
            padding: "0.75rem",
            marginBottom: "1rem",
            borderRadius: "4px",
            backgroundColor: scanStatus.includes("✅") ? "#dcfce7" : scanStatus.includes("❌") ? "#fee2e2" : "#dbeafe",
            color: scanStatus.includes("✅") ? "#166534" : scanStatus.includes("❌") ? "#991b1b" : "#1e40af",
            fontSize: "0.875rem",
          }}
        >
          {scanStatus}
        </div>
      )}

      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          backgroundColor: "#fff",
          borderRadius: "8px",
          overflow: "hidden",
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        }}
      >
        <thead style={{ backgroundColor: "#f3f4f6" }}>
          <tr>
            <th style={{ textAlign: "left", padding: "0.75rem" }}>Date</th>
            <th style={{ textAlign: "left", padding: "0.75rem" }}>Company</th>
            <th style={{ textAlign: "left", padding: "0.75rem" }}>Job Title</th>
            <th style={{ textAlign: "left", padding: "0.75rem" }}>Site URL</th>
            <th style={{ textAlign: "left", padding: "0.75rem" }}>Docs</th>
            <th style={{ textAlign: "left", padding: "0.75rem" }}>Match Score</th>
            <th style={{ textAlign: "left", padding: "0.75rem" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredJobs.map((job) => (
          <tr key={job.id} style={{ borderTop: "1px solid #e5e7eb" }}>
            {/* Date */}
            <td style={{ padding: "0.75rem" }}>
              {new Date(job.createdAt).toLocaleDateString()}
            </td>

            {/* Company */}
            <td style={{ padding: "0.75rem" }}>
              {job.company}
            </td>

            {/* Job Title */}
            <td style={{ padding: "0.75rem" }}>
              {job.title}
            </td>

            {/* Site URL */}
            <td style={{ padding: "0.75rem" }}>
              <Link
                href={job.externalUrl}
                target="_blank"
                style={{ color: "#2563eb", textDecoration: "underline" }}
              >
                {job.externalUrl.length > 50
                  ? `${job.externalUrl.substring(0, 50)}...`
                  : job.externalUrl}
              </Link>
            </td>

            {/* Docs status: description / resume / cover letter (colored circles) */}
            <td style={{ padding: "0.75rem" }}>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                {/* Description circle */}
                <div
                  title={job.hasDescription ? "Description exists" : "Description missing"}
                  style={{
                    width: "12px",
                    height: "12px",
                    borderRadius: "50%",
                    backgroundColor: job.hasDescription ? "#10b981" : "#ef4444",
                    border: "1px solid",
                    borderColor: job.hasDescription ? "#059669" : "#dc2626",
                  }}
                />
                {/* Resume circle */}
                <div
                  title={job.hasResume ? "Resume exists" : "Resume missing"}
                  style={{
                    width: "12px",
                    height: "12px",
                    borderRadius: "50%",
                    backgroundColor: job.hasResume ? "#10b981" : "#ef4444",
                    border: "1px solid",
                    borderColor: job.hasResume ? "#059669" : "#dc2626",
                  }}
                />
                {/* Cover Letter circle */}
                <div
                  title={job.hasCoverLetter ? "Cover letter exists" : "Cover letter missing"}
                  style={{
                    width: "12px",
                    height: "12px",
                    borderRadius: "50%",
                    backgroundColor: job.hasCoverLetter ? "#10b981" : "#ef4444",
                    border: "1px solid",
                    borderColor: job.hasCoverLetter ? "#059669" : "#dc2626",
                  }}
                />
              </div>
            </td>

            {/* Match Score */}
            <td style={{ padding: "0.75rem", textAlign: "center" }}>
              {job.jobrightMatchScore !== null ? (
                <span
                  style={{
                    display: "inline-block",
                    padding: "0.25rem 0.5rem",
                    backgroundColor:
                      job.jobrightMatchScore >= 80
                        ? "#dcfce7"
                        : job.jobrightMatchScore >= 60
                        ? "#fef3c7"
                        : "#fee2e2",
                    color:
                      job.jobrightMatchScore >= 80
                        ? "#166534"
                        : job.jobrightMatchScore >= 60
                        ? "#92400e"
                        : "#991b1b",
                    borderRadius: "4px",
                    fontWeight: 500,
                  }}
                >
                  {job.jobrightMatchScore}%
                </span>
              ) : (
                <span style={{ color: "#9ca3af" }}>N/A</span>
              )}
            </td>
            <td style={{ padding: "0.75rem" }}>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button
                  onClick={() => handleEdit(job)}
                  style={{
                    padding: "0.25rem 0.75rem",
                    backgroundColor: "#3b82f6",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "0.875rem",
                  }}
                >
                  Edit
                </button>
                <button
                  onClick={() => handleGenerateDocs(job)}
                  disabled={!job.hasDescription || generatingDocsForId === job.id}
                  title={
                    job.hasDescription
                      ? "Generate tailored resume and cover letter using this job description"
                      : "Add job description first (Edit) to enable document generation"
                  }
                  style={{
                    padding: "0.25rem 0.75rem",
                    backgroundColor:
                      !job.hasDescription || generatingDocsForId === job.id
                        ? "#9ca3af"
                        : "#8b5cf6",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor:
                      !job.hasDescription || generatingDocsForId === job.id
                        ? "not-allowed"
                        : "pointer",
                    fontSize: "0.875rem",
                    opacity:
                      !job.hasDescription || generatingDocsForId === job.id
                        ? 0.7
                        : 1,
                  }}
                >
                  {generatingDocsForId === job.id ? "Generating..." : "Generate Docs"}
                </button>
                <button
                  onClick={() => handleDelete(job.id)}
                  style={{
                    padding: "0.25rem 0.75rem",
                    backgroundColor: "#ef4444",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "0.875rem",
                  }}
                >
                  Delete
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>

    {/* Edit Job Modal */}
    {editingId && (
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0, 0, 0, 0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
        }}
        onClick={handleCancel}
      >
        <div
          style={{
            backgroundColor: "white",
            borderRadius: "8px",
            padding: "2rem",
            maxWidth: "900px",
            maxHeight: "90vh",
            width: "90%",
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
            overflow: "hidden",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <h2 style={{ marginTop: 0, marginBottom: "1.5rem", fontSize: "1.5rem", fontWeight: 600 }}>
            Edit Job Application
          </h2>
          
          {loadingEditForm ? (
            <div style={{ padding: "2rem", textAlign: "center" }}>Loading...</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem", overflow: "auto", flex: 1 }}>
              {/* Job Title */}
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500, fontSize: "0.875rem" }}>
                  Job Title *
                </label>
                <input
                  type="text"
                  value={editForm.title}
                  onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #d1d5db",
                    borderRadius: "4px",
                    fontSize: "0.875rem",
                  }}
                  placeholder="Enter job title"
                />
              </div>

              {/* Company */}
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500, fontSize: "0.875rem" }}>
                  Company *
                </label>
                <input
                  type="text"
                  value={editForm.company}
                  onChange={(e) => setEditForm({ ...editForm, company: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #d1d5db",
                    borderRadius: "4px",
                    fontSize: "0.875rem",
                  }}
                  placeholder="Enter company name"
                />
              </div>

              {/* External URL */}
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500, fontSize: "0.875rem" }}>
                  Application URL *
                </label>
                <input
                  type="text"
                  value={editForm.externalUrl}
                  onChange={(e) => setEditForm({ ...editForm, externalUrl: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #d1d5db",
                    borderRadius: "4px",
                    fontSize: "0.875rem",
                  }}
                  placeholder="Enter application URL"
                />
              </div>

              {/* Job Description */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: "300px" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500, fontSize: "0.875rem" }}>
                  Job Description
                </label>
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  placeholder="Enter job description..."
                  style={{
                    width: "100%",
                    minHeight: "300px",
                    padding: "1rem",
                    border: "1px solid #d1d5db",
                    borderRadius: "4px",
                    fontSize: "0.875rem",
                    fontFamily: "monospace",
                    resize: "vertical",
                    flex: 1,
                  }}
                />
              </div>

              {/* Action Buttons */}
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", justifyContent: "flex-end" }}>
                <button
                  onClick={handleCancel}
                  disabled={savingEditForm}
                  style={{
                    padding: "0.5rem 1.5rem",
                    backgroundColor: "#6b7280",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: savingEditForm ? "not-allowed" : "pointer",
                    opacity: savingEditForm ? 0.6 : 1,
                    fontSize: "0.875rem",
                    fontWeight: 500,
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleSave(editingId)}
                  disabled={savingEditForm || !editForm.title || !editForm.company || !editForm.externalUrl}
                  style={{
                    padding: "0.5rem 1.5rem",
                    backgroundColor: savingEditForm || !editForm.title || !editForm.company || !editForm.externalUrl
                      ? "#9ca3af"
                      : "#10b981",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: savingEditForm || !editForm.title || !editForm.company || !editForm.externalUrl
                      ? "not-allowed"
                      : "pointer",
                    opacity: savingEditForm || !editForm.title || !editForm.company || !editForm.externalUrl ? 0.6 : 1,
                    fontSize: "0.875rem",
                    fontWeight: 500,
                  }}
                >
                  {savingEditForm ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )}

    </div>
  );
}
