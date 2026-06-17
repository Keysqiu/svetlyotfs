import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { BlameManager } from '../TFS/BlameManager';
import { BlameDecorationsProvider } from '../vscode/BlameDecorationsProvider';

// 导入 mocha 类型
import 'mocha';

suite('标注功能测试套件', () => {
    vscode.window.showInformationMessage('开始所有测试。');

    test('BlameManager 实例创建', () => {
        const blameManager = BlameManager.getInstance();
        assert.ok(blameManager);
    });

    test('BlameDecorationsProvider 实例创建', () => {
        const decorationsProvider = BlameDecorationsProvider.getInstance();
        assert.ok(decorationsProvider);
    });

    test('BlameManager isEnabled', () => {
        const blameManager = BlameManager.getInstance();
        // 默认情况下，标注功能应该启用
        assert.strictEqual(blameManager.isEnabled(), true);
    });
});