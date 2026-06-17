import * as vscode from "vscode";
import { BlameResult, BlameInfo } from "../TFS/Types";

export class BlameDecorationsProvider {
    private static instance: BlameDecorationsProvider;
    private decorationType: vscode.TextEditorDecorationType;
    private paddingDecorationType: vscode.TextEditorDecorationType;  // 占位符

    private constructor() {
        this.decorationType = vscode.window.createTextEditorDecorationType({
            before: {
                color: new vscode.ThemeColor('editorLineNumber.foreground'),
                fontStyle: 'italic',
                margin: '0 10px 0 0'
            },
            rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen
        });

        this.paddingDecorationType = vscode.window.createTextEditorDecorationType({
            before: {
                // 仅保留空间；不显示文本
                margin: '0 10px 0 0'
            },
            rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen
        });
    }

    public static getInstance(): BlameDecorationsProvider {
        if (!BlameDecorationsProvider.instance) {
            BlameDecorationsProvider.instance = new BlameDecorationsProvider();
        }

        return BlameDecorationsProvider.instance;
    }

    public showBlameInformation(editor: vscode.TextEditor, blameResult: BlameResult) {
        if (!blameResult?.blameInfo) return;

        const blocks = this.groupBlameInfoIntoBlocks(blameResult.blameInfo);

        // 计算最大字符宽度
        const maxWidth = this.calculateMaxBlameWidth(blocks);
        const reservedWidth = `${maxWidth + 2}ch`; // +2 作为间距

        // 收集有标注装饰的行
        const linesWithBlame = new Set<number>();
        for (const block of blocks) {
            const firstLine = block.startLine - 1;
            if (firstLine >= 0) {
                linesWithBlame.add(firstLine);
            }
        }

        // 1) 仅在没有标注装饰的行上添加占位符
        const paddingDecos: vscode.DecorationOptions[] = [];
        for (let i = 0; i < editor.document.lineCount; i++) {
            // 跳过有标注装饰的行
            if (linesWithBlame.has(i)) {
                continue;
            }

            const range = new vscode.Range(i, 0, i, 0);
            paddingDecos.push({
                range,
                renderOptions: { before: { contentText: '', width: reservedWidth } }
            });
        }

        // 2) 仅在每个块的第一行显示标签
        const labelDecos: vscode.DecorationOptions[] = [];
        for (const block of blocks) {
            const firstLine = block.startLine - 1;
            if (firstLine < 0) continue;

            const authorInitials = this.getAuthorInitials(block.author);
            const formattedDate = this.formatDate(block.date);
            const text = `${authorInitials} ${block.changesetId}`;

            labelDecos.push({
                range: new vscode.Range(firstLine, 0, firstLine, 0),
                renderOptions: { before: { contentText: text, width: reservedWidth } },
                hoverMessage: this.createHoverMessage(block)
            });
        }

        // 分别应用，这样它们不会互相覆盖
        editor.setDecorations(this.paddingDecorationType, paddingDecos);
        editor.setDecorations(this.decorationType, labelDecos);
    }

    public hideBlameInformation(editor: vscode.TextEditor) {
        editor.setDecorations(this.paddingDecorationType, []);
        editor.setDecorations(this.decorationType, []);
    }

    private loadingInterval: NodeJS.Timeout | undefined;
    private spinnerFrames: string[] = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    private currentFrameIndex: number = 0;

    public showLoadingIndicator(editor: vscode.TextEditor) {
        // 清除现有的加载动画
        this.hideLoadingIndicator();

        // 在第一行创建动画加载指示器
        const range = new vscode.Range(0, 0, 0, 0);
        const decorations: vscode.DecorationOptions[] = [{
            range: range,
            renderOptions: {
                before: {
                    contentText: this.spinnerFrames[this.currentFrameIndex],
                    color: new vscode.ThemeColor('editorLineNumber.foreground'),
                    fontStyle: 'italic',
                    fontWeight: 'normal'
                }
            }
        }];

        // 将装饰应用到编辑器
        editor.setDecorations(this.paddingDecorationType, decorations);

        // 启动动画
        this.loadingInterval = setInterval(() => {
            this.currentFrameIndex = (this.currentFrameIndex + 1) % this.spinnerFrames.length;
            const decorations: vscode.DecorationOptions[] = [{
                range: range,
                renderOptions: {
                    before: {
                        contentText: this.spinnerFrames[this.currentFrameIndex],
                        color: new vscode.ThemeColor('editorLineNumber.foreground'),
                        fontStyle: 'italic',
                        fontWeight: 'normal'
                    }
                }
            }];
            editor.setDecorations(this.paddingDecorationType, decorations);
        }, 100);
    }

    public hideLoadingIndicator() {
        if (this.loadingInterval) {
            clearInterval(this.loadingInterval);
            this.loadingInterval = undefined;
            this.currentFrameIndex = 0;
        }
    }
    private groupBlameInfoIntoBlocks(blameInfo: BlameInfo[]): any[] {
        if (blameInfo.length === 0) {
            return [];
        }

        const blocks = [];
        let currentBlock = {
            startLine: blameInfo[0].lineNumber,
            endLine: blameInfo[0].lineNumber,
            author: blameInfo[0].author,
            changesetId: blameInfo[0].changesetId,
            date: blameInfo[0].date
        };


        for (let i = 1; i < blameInfo.length; i++) {
            const info = blameInfo[i];

            // 检查此行是否延续当前块
            if (info.author === currentBlock.author &&
                info.changesetId === currentBlock.changesetId &&
                info.date === currentBlock.date &&
                info.lineNumber === currentBlock.endLine + 1) {
                // 扩展当前块
                currentBlock.endLine = info.lineNumber;
            } else {
                if (currentBlock.endLine < info.lineNumber)
                    currentBlock.endLine = info.lineNumber - 1;

                // 完成当前块并开始新块
                blocks.push(currentBlock);
                currentBlock = {
                    startLine: info.lineNumber,
                    endLine: info.lineNumber,
                    author: info.author,
                    changesetId: info.changesetId,
                    date: info.date
                };
            }
        }

        // 不要忘记最后一个块
        blocks.push(currentBlock);

        return blocks;
    }

    private calculateMaxBlameWidth(blocks: any[]): number {
        let maxWidth = 0;

        for (const block of blocks) {
            const authorInitials = this.getAuthorInitials(block.author);
            const formattedDate = this.formatDate(block.date);
            const blameText = `${authorInitials} ${block.changesetId} ${formattedDate}`;
            maxWidth = Math.max(maxWidth, blameText.length);
        }

        return maxWidth;
    }

    private getAuthorInitials(author: string): string {
        // 从作者姓名中提取首字母
        const parts = author.split(' ');
        if (parts.length === 1) {
            return parts[0].substring(0, 2);
        } else if (parts.length >= 2) {
            return parts[0].charAt(0) + parts[1].charAt(0);
        }
        return author.substring(0, 2);
    }

    private formatDate(dateString: string): string {
        // 将日期格式化为更紧凑的形式
        const date = new Date(dateString);
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    private createHoverMessage(block: any): vscode.MarkdownString {
        // 创建包含完整信息的详细悬停消息
        const hoverMessage = new vscode.MarkdownString();
        hoverMessage.appendMarkdown(`**作者:** ${block.author}\n\n`);
        hoverMessage.appendMarkdown(`**变更集:** ${block.changesetId}\n\n`);
        hoverMessage.appendMarkdown(`**日期:** ${block.date}\n\n`);
        hoverMessage.appendMarkdown(`**行范围:** ${block.startLine}-${block.endLine}`);
        return hoverMessage;
    }
}