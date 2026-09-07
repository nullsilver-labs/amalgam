// Single application instance for the first release. The DB enforces one run per conversation.
export const activeRuns = new Map<string, AbortController>();
