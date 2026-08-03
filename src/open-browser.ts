import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function tryOpenBrowser(url: string): Promise<boolean> {
  if (process.env.MCPSTACK_NO_BROWSER === "1" || process.env.CI) {
    return false;
  }

  try {
    if (process.platform === "darwin") {
      await execFileAsync("open", [url]);
    } else if (process.platform === "win32") {
      await execFileAsync("cmd", ["/c", "start", "", url], { shell: true });
    } else {
      await execFileAsync("xdg-open", [url]);
    }
    return true;
  } catch {
    return false;
  }
}
