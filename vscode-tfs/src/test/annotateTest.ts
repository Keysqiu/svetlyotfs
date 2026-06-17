import * as vscode from 'vscode';
import * as path from 'path';
import { TFSCommandExecutor } from '../TFS/Commands';

/**
 * 调试标注命令输出的测试函数
 */
export async function testAnnotateCommand() {
    try {
        // 获取活动文本编辑器
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('未找到活动文本编辑器');
            return;
        }

        // 获取 TFS 命令执行器
        const tfsExecutor = TFSCommandExecutor.getInstance();

        // 对当前文件运行标注命令
        const blameResult = await tfsExecutor.annotate(editor.document.uri);

        if (blameResult) {
            // 记录标注结果用于调试
            console.log('标注结果:', blameResult);

            // 在消息中显示结果
            vscode.window.showInformationMessage(`标注命令成功。处理了 ${blameResult.blameInfo.length} 行。`);

            // 显示前几行的详细信息
            const sampleLines = blameResult.blameInfo.slice(0, 5);
            for (const line of sampleLines) {
                console.log(`第 ${line.lineNumber} 行: 变更集 ${line.changesetId} 由 ${line.author} 于 ${line.date}`);
            }
        } else {
            vscode.window.showErrorMessage('未返回标注信息');
        }
    } catch (error: any) {
        vscode.window.showErrorMessage(`运行标注命令时出错: ${error.message}`);
        console.error('运行标注命令时出错:', error);
    }
}
