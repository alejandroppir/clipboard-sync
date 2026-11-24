/** What a Rust command returning `Result<T, String>` resolves to. */
type CommandResult<T> = { status: "ok"; data: T } | { status: "error"; error: string };

/** Value of a command result; an error from Rust becomes an exception with its message. */
export function unwrap<T>(result: CommandResult<T>): T {
  if (result.status === "error") {
    throw new Error(result.error);
  }
  return result.data;
}
