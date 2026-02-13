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
  const [editForm, setEditForm] = useState({ title: "", company: "", externalUrl: "" });
  const [dateFilter, setDateFilter] = useState<string>("all"); // "all", "today", "week", "month"
  const [descriptionFilter, setDescriptionFilter] = useState<string>("all"); // "all", "with", "without"
  const [viewingDescriptionId, setViewingDescriptionId] = useState<number | null>(null);
  const [descriptionText, setDescriptionText] = useState<string>("");
  const [loadingDescription, setLoadingDescription] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState<string>("");

  const handleEdit = (job: Job) => {
    setEditingId(job.id);
    setEditForm({
      title: job.title,
      company: job.company,
      externalUrl: job.externalUrl,
    });
  };

  const handleSave = async (id: number) => {
    try {
      const response = await fetch(`/api/jobs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });

      if (response.ok) {
        const updated = await response.json();
        setJobs(jobs.map((j) => (j.id === id ? updated : j)));
        setEditingId(null);
      } else {
        alert("Failed to update job");
      }
    } catch (error) {
      alert("Error updating job");
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditForm({ title: "", company: "", externalUrl: "" });
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this job?")) return;

    try {
      const response = await fetch(`/api/jobs/${id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setJobs(jobs.filter((j) => j.id !== id));
      } else {
        alert("Failed to delete job");
      }
    } catch (error) {
      alert("Error deleting job");
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

    return filtered;
  }, [jobs, dateFilter, descriptionFilter]);

  // View job description
  const handleViewDescription = async (jobId: number) => {
    setLoadingDescription(true);
    setViewingDescriptionId(jobId);
    try {
      const response = await fetch(`/api/jobs/${jobId}/description`);
      if (response.ok) {
        const data = await response.json();
        setDescriptionText(data.fullText || "No description available");
      } else {
        setDescriptionText("Description not found");
      }
    } catch (error) {
      setDescriptionText("Error loading description");
    } finally {
      setLoadingDescription(false);
    }
  };

  const handleCloseDescription = () => {
    setViewingDescriptionId(null);
    setDescriptionText("");
  };

  // Trigger job scan
  const handleScanJobs = async () => {
    if (scanning) return;
    
    setScanning(true);
    setScanStatus("Starting scan...");
    
    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      
      const result = await response.json();
      
      if (result.success) {
        setScanStatus("✅ Scan completed! Refreshing jobs...");
        // Refresh the page to show new jobs
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } else {
        setScanStatus(`❌ Scan failed: ${result.message}`);
        setScanning(false);
      }
    } catch (error) {
      setScanStatus("❌ Error starting scan");
      setScanning(false);
    }
  };

  // Export to CSV
  const handleExportCSV = () => {
    const headers = ["Date", "Job Title", "Company", "Match Score", "Site URL"];
    const rows = filteredJobs.map((job) => [
      new Date(job.createdAt).toLocaleDateString(),
      job.title,
      job.company,
      job.jobrightMatchScore ? `${job.jobrightMatchScore}%` : "N/A",
      job.externalUrl,
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `job-applications-${dateFilter}-${new Date().toISOString().split("T")[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
          <span style={{ color: "#6b7280", fontSize: "0.875rem" }}>
            ({filteredJobs.length} {filteredJobs.length === 1 ? "job" : "jobs"})
          </span>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
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
            <th style={{ textAlign: "left", padding: "0.75rem" }}>Job Title</th>
            <th style={{ textAlign: "left", padding: "0.75rem" }}>Company</th>
            <th style={{ textAlign: "left", padding: "0.75rem" }}>Match Score</th>
            <th style={{ textAlign: "left", padding: "0.75rem" }}>Docs</th>
            <th style={{ textAlign: "left", padding: "0.75rem" }}>Site URL</th>
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

            {/* Job Title */}
            <td style={{ padding: "0.75rem" }}>
              {editingId === job.id ? (
                <input
                  type="text"
                  value={editForm.title}
                  onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid #d1d5db",
                    borderRadius: "4px",
                  }}
                />
              ) : (
                job.title
              )}
            </td>

            {/* Company */}
            <td style={{ padding: "0.75rem" }}>
              {editingId === job.id ? (
                <input
                  type="text"
                  value={editForm.company}
                  onChange={(e) => setEditForm({ ...editForm, company: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid #d1d5db",
                    borderRadius: "4px",
                  }}
                />
              ) : (
                job.company
              )}
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

            {/* Docs status: resume / cover letter / description */}
            <td style={{ padding: "0.75rem" }}>
              <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                <span
                  style={{
                    padding: "0.15rem 0.5rem",
                    borderRadius: "999px",
                    fontSize: "0.75rem",
                    fontWeight: 500,
                    backgroundColor: job.hasResume ? "#dcfce7" : "#f3f4f6",
                    color: job.hasResume ? "#166534" : "#6b7280",
                    border: job.hasResume ? "1px solid #bbf7d0" : "1px solid #e5e7eb",
                  }}
                >
                  Resume
                </span>
                <span
                  style={{
                    padding: "0.15rem 0.5rem",
                    borderRadius: "999px",
                    fontSize: "0.75rem",
                    fontWeight: 500,
                    backgroundColor: job.hasCoverLetter ? "#dbeafe" : "#f3f4f6",
                    color: job.hasCoverLetter ? "#1d4ed8" : "#6b7280",
                    border: job.hasCoverLetter ? "1px solid #bfdbfe" : "1px solid #e5e7eb",
                  }}
                >
                  Cover
                </span>
                <span
                  style={{
                    padding: "0.15rem 0.5rem",
                    borderRadius: "999px",
                    fontSize: "0.75rem",
                    fontWeight: 500,
                    backgroundColor: job.hasDescription ? "#f5f3ff" : "#f3f4f6",
                    color: job.hasDescription ? "#6d28d9" : "#6b7280",
                    border: job.hasDescription ? "1px solid #ddd6fe" : "1px solid #e5e7eb",
                  }}
                >
                  Desc
                </span>
              </div>
            </td>
            <td style={{ padding: "0.75rem" }}>
              {editingId === job.id ? (
                <input
                  type="text"
                  value={editForm.externalUrl}
                  onChange={(e) => setEditForm({ ...editForm, externalUrl: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid #d1d5db",
                    borderRadius: "4px",
                  }}
                />
              ) : (
                <Link
                  href={job.externalUrl}
                  target="_blank"
                  style={{ color: "#2563eb", textDecoration: "underline" }}
                >
                  {job.externalUrl.length > 50
                    ? `${job.externalUrl.substring(0, 50)}...`
                    : job.externalUrl}
                </Link>
              )}
            </td>
            <td style={{ padding: "0.75rem" }}>
              {editingId === job.id ? (
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    onClick={() => handleSave(job.id)}
                    style={{
                      padding: "0.25rem 0.75rem",
                      backgroundColor: "#10b981",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    Save
                  </button>
                  <button
                    onClick={handleCancel}
                    style={{
                      padding: "0.25rem 0.75rem",
                      backgroundColor: "#6b7280",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    onClick={() => handleViewDescription(job.id)}
                    style={{
                      padding: "0.25rem 0.75rem",
                      backgroundColor: "#8b5cf6",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    View Description
                  </button>
                  <button
                    onClick={() => handleEdit(job)}
                    style={{
                      padding: "0.25rem 0.75rem",
                      backgroundColor: "#3b82f6",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    Edit
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
                    }}
                  >
                    Delete
                  </button>
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>

    {/* Description Modal */}
    {viewingDescriptionId && (
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
        onClick={handleCloseDescription}
      >
        <div
          style={{
            backgroundColor: "white",
            borderRadius: "8px",
            padding: "2rem",
            maxWidth: "800px",
            maxHeight: "80vh",
            width: "90%",
            overflow: "auto",
            boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h2 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600 }}>Job Description</h2>
            <button
              onClick={handleCloseDescription}
              style={{
                background: "none",
                border: "none",
                fontSize: "1.5rem",
                cursor: "pointer",
                color: "#6b7280",
              }}
            >
              ×
            </button>
          </div>
          {loadingDescription ? (
            <p>Loading description...</p>
          ) : (
            <div
              style={{
                whiteSpace: "pre-wrap",
                lineHeight: "1.6",
                color: "#374151",
                maxHeight: "60vh",
                overflow: "auto",
              }}
            >
              {descriptionText || "No description available"}
            </div>
          )}
        </div>
      </div>
    )}
    </div>
  );
}
