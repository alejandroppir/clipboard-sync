// Prints the id of the document to create in `admin_config` so a new admin password works (src-tauri/src/users.rs).
// It is a hash, not encryption: the password cannot be recovered from it.
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.question("Nueva pass: ", (password) => {
  console.log(createHash("sha256").update(password.trim()).digest("hex"));
  rl.close();
});
