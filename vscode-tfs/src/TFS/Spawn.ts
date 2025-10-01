import * as vscode from "vscode"
import { spawn } from "child_process"
import * as iconv from 'iconv-lite';

export async function tf(args: Array<string>, timeoutMs?: number): Promise<string> {
  const tfPath: string | undefined = vscode.workspace.getConfiguration("tfs").get("location")

  if (!tfPath) {
    throw new Error("tf.exe path is not configured")
  }

  const defaultTimeout = vscode.workspace.getConfiguration("tfs").get("commandTimeout", 30000); // 30 seconds default
  const actualTimeout = timeoutMs || defaultTimeout;

  return new Promise((resolve, reject) => {
    const child = spawn(tfPath, args, { stdio: 'pipe' });

    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let timeoutId: NodeJS.Timeout;

    // Set up timeout
    if (actualTimeout > 0) {
      timeoutId = setTimeout(() => {
        child.kill('SIGTERM'); // Try graceful termination first
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL'); // Force kill if still running
          }
        }, 5000); // Wait 5 seconds before force kill

        reject(new Error(`TFS command timed out after ${actualTimeout}ms: tf ${args.join(' ')}`));
      }, actualTimeout);
    }

    child.stdout.on('data', (data: Buffer) => {
      stdout = Buffer.concat([stdout, data]);
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr = Buffer.concat([stderr, data]);
    });

    child.on('close', (code: number) => {
      // Clear timeout if it exists
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (code !== 0 || stderr.length > 0) {
        const errorMsg = stderr.length > 0 ? stderr.toString() : `tf.exe exited with code ${code}`;
        reject(new Error(errorMsg));
        return;
      }

      const outputString = iconv.decode(stdout, 'win1251');
      resolve(outputString);
    });

    child.on('error', (error: Error) => {
      // Clear timeout if it exists
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      reject(new Error(`Failed to execute tf.exe: ${error.message}`));
    });
  });
}


