import * as vscode from "vscode"
import { spawn, execSync } from "child_process"
import * as iconv from 'iconv-lite';

// 模块级编码缓存，只检测一次
let _detectedEncoding: string | null = null;

/** 代码页 → iconv-lite 编码名映射 */
const CODEPAGE_MAP: Record<number, string> = {
  936: 'gbk',
  950: 'big5',
  932: 'shiftjis',
  949: 'euc-kr',
  1251: 'win1251',
  1252: 'win1252',
};

/**
 * 通过 chcp 命令检测当前系统的 ANSI 活动代码页，返回 iconv-lite 编码名。
 * 结果会被缓存，只检测一次。
 */
export function getSystemEncoding(): string {
  if (_detectedEncoding) return _detectedEncoding;

  try {
    const output = execSync('chcp', { encoding: 'utf-8', timeout: 3000 });
    const match = output.match(/(\d+)/);
    if (match) {
      const codePage = parseInt(match[1], 10);
      _detectedEncoding = CODEPAGE_MAP[codePage] || 'win1252';
      return _detectedEncoding;
    }
  } catch {
    // chcp 失败，回退到 win1252
  }

  _detectedEncoding = 'win1252';
  return _detectedEncoding;
}

export async function tf(args: Array<string>, timeoutMs?: number): Promise<string> {
  const tfPath: string | undefined = vscode.workspace.getConfiguration("tfs").get("location")

  if (!tfPath) {
    throw new Error("tf.exe 路径未配置")
  }

  const defaultTimeout = vscode.workspace.getConfiguration("tfs").get("commandTimeout", 30000); // 默认 30 秒
  const actualTimeout = timeoutMs || defaultTimeout;

  return new Promise((resolve, reject) => {
    const child = spawn(tfPath, args, { stdio: 'pipe' });

    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let timeoutId: NodeJS.Timeout;

    // 设置超时
    if (actualTimeout > 0) {
      timeoutId = setTimeout(() => {
        child.kill('SIGTERM'); // 先尝试优雅终止
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL'); // 如果仍在运行则强制终止
          }
        }, 5000); // 等待 5 秒后强制终止

        reject(new Error(`TFS 命令在 ${actualTimeout}ms 后超时: tf ${args.join(' ')}`));
      }, actualTimeout);
    }

    child.stdout.on('data', (data: Buffer) => {
      stdout = Buffer.concat([stdout, data]);
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr = Buffer.concat([stderr, data]);
    });

    child.on('close', (code: number) => {
      // 如果存在则清除超时
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (code !== 0 || stderr.length > 0) {
        const encoding = getSystemEncoding();
        const errorMsg = stderr.length > 0 ? iconv.decode(stderr, encoding) : `tf.exe 退出码: ${code}`;
        reject(new Error(errorMsg));
        return;
      }

      const encoding = getSystemEncoding();
      const outputString = iconv.decode(stdout, encoding);
      resolve(outputString);
    });

    child.on('error', (error: Error) => {
      // 如果存在则清除超时
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      reject(new Error(`执行 tf.exe 失败: ${error.message}`));
    });
  });
}
