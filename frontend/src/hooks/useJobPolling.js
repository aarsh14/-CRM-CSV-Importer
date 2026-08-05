import { useEffect, useState } from "react";
import { fetchJobStatus } from "../api/client.js";

export function useJobPolling(jobId, intervalMs = 500) {
    const [state, setState] = useState({
        status: "pending",
        processedRows: 0,
        totalRows: 0,
        result: null,
        error: null,

    });

    useEffect(() => {

        if (!jobId) return;

        let cancelled = false;

        const poll = async () => {
            try {
                const data = await fetchJobStatus(jobId);
                if (cancelled) return;

                setState({
                    status: data.status,
                    processedRows: data.processedRows,
                    totalRows: data.totalRows,
                    result: data.status === "completed" ? data : null,
                    error: null
                })

                if (data.status != "completed" && data.status != "failed") {
                    setTimeout(poll, intervalMs)
                }
            } catch (error) {
                if (!cancelled) {
                    setState((s) => ({ ...s, error: error.message }))
                }
            }
        }
        poll()
        return () => {
            cancelled = true
        }

    }, [jobId, intervalMs])

    return state
}