/** One line per event, on stderr, so stdout stays free for nothing in particular. */
export type Log = (message: string) => void;

export const stderrLog: Log = (message) => {
  process.stderr.write(`${new Date().toISOString()} ${message}\n`);
};
