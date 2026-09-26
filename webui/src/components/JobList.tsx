/**
 * Job list for the connected client.
 *
 * Reads `clientJobs(address)` then `jobs(id)` for each ID, and derives a
 * lifecycle status from the struct fields (mirroring the Solidity state
 * machine in `JobsManager`).
 */
import { formatAddress, formatDuration, formatTimestamp, formatTokenAmount } from "../lib/format";
import type { Job } from "../lib/jobsManager";

interface Props {
  jobs: Job[];
  loading: boolean;
  onRefresh: () => void;
}

type JobStatus = {
  label: string;
  tone: "open" | "active" | "done" | "cancelled";
  hint?: string;
};

/**
 * Derives the job status. `nowSeconds` is passed in so every row uses the same
 * clock reading.
 */
function deriveStatus(job: Job, nowSeconds: number): JobStatus {
  if (job.closed) {
    return { label: "Closed", tone: "done" };
  }

  if (job.startTime === 0) {
    const staleAt = job.creationTime + job.duration;
    if (nowSeconds > staleAt) {
      return {
        label: "Expired (open)",
        tone: "cancelled",
        hint: "The client or resolver can cancel with closeJob.",
      };
    }
    return {
      label: job.contractor === "0x0000000000000000000000000000000000000000"
        ? "Open (no nomination)"
        : "Open (nominated)",
      tone: "open",
    };
  }

  const expiresAt = job.startTime + job.duration;
  if (nowSeconds > expiresAt) {
    return {
      label: "Active (expired)",
      tone: "cancelled",
      hint: "Expired. It can be settled with closeJob.",
    };
  }
  return { label: "Active", tone: "active" };
}

const ZERO = "0x0000000000000000000000000000000000000000";

export default function JobList({ jobs, loading, onRefresh }: Props) {
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (loading) {
    return (
      <section className="card">
        <h2>Jobs</h2>
        <p className="muted">Loading jobs…</p>
      </section>
    );
  }

  if (jobs.length === 0) {
    return (
      <section className="card">
        <h2>Jobs</h2>
        <p className="muted">No jobs yet. Create one using the form above.</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>
        Jobs
        <span className="badge">{jobs.length}</span>
        <button type="button" className="secondary refresh" onClick={onRefresh}>
          Reload
        </button>
      </h2>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Status</th>
              <th>Asset / Amount</th>
              <th>Contractor</th>
              <th>Resolver</th>
              <th>Duration</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job, index) => {
              const status = deriveStatus(job, nowSeconds);
              return (
                <tr key={index}>
                  <td>{index + 1}</td>
                  <td>
                    <span className={`pill pill-${status.tone}`}>{status.label}</span>
                    {job.escrowed ? <span className="pill pill-escrow">escrowed</span> : null}
                  </td>
                  <td>
                    <code>{formatAddress(job.asset)}</code>
                    <br />
                    {formatTokenAmount(job.amount)}
                  </td>
                  <td>
                    {job.contractor === ZERO ? (
                      <span className="muted">—</span>
                    ) : (
                      <code>{formatAddress(job.contractor)}</code>
                    )}
                  </td>
                  <td>
                    <code>{formatAddress(job.resolver)}</code>
                  </td>
                  <td>{formatDuration(job.duration)}</td>
                  <td>{formatTimestamp(job.creationTime)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
