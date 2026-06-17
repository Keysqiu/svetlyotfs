import * as vscode from 'vscode';
import * as assert from 'assert';
import { BlameManager } from '../TFS/BlameManager';
import { BlameDecorationsProvider } from '../vscode/BlameDecorationsProvider';
import { TFSCommandExecutor } from '../TFS/Commands';

/**
 * 标注功能的集成测试
 */
export async function runBlameIntegrationTest() {
    // 获取活动文本编辑器
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('未找到活动文本编辑器');
        return;
    }

    try {
        // 测试 BlameManager
        const blameManager = BlameManager.getInstance();
        assert.ok(blameManager, 'BlameManager 应该被实例化');
        assert.strictEqual(typeof blameManager.isEnabled(), 'boolean', 'isEnabled 应该返回布尔值');

        // 测试 BlameDecorationsProvider
        const decorationsProvider = BlameDecorationsProvider.getInstance();
        assert.ok(decorationsProvider, 'BlameDecorationsProvider 应该被实例化');

        // 测试 TFSCommandExecutor
        const tfsExecutor = TFSCommandExecutor.getInstance();
        assert.ok(tfsExecutor, 'TFSCommandExecutor 应该被实例化');

        // 显示成功消息
        vscode.window.showInformationMessage('标注功能集成测试通过！');
    } catch (error: any) {
        vscode.window.showErrorMessage(`标注功能集成测试失败: ${error.message}`);
        console.error('标注功能集成测试失败:', error);
    }
}