export class TFSOperationQueue {
    private static instance: TFSOperationQueue;
    private queue: QueuedOperation[] = [];
    private processing = false;
    private cancelled = false;
    private progressCallback?: (message: string, increment?: number) => void;

    public static getInstance(): TFSOperationQueue {
        if (!TFSOperationQueue.instance) {
            TFSOperationQueue.instance = new TFSOperationQueue();
        }
        return TFSOperationQueue.instance;
    }

    /**
     * 设置进度回调以报告操作进度
     */
    setProgressCallback(callback: (message: string, increment?: number) => void): void {
        this.progressCallback = callback;
    }

    async enqueue<T>(operation: () => Promise<T>, operationName?: string): Promise<T> {
        return new Promise((resolve, reject) => {
            this.queue.push({
                execute: operation,
                resolve,
                reject,
                id: this.generateId(),
                name: operationName
            });

            this.processQueue();
        });
    }

    /**
     * 取消所有待处理的操作
     */
    cancelAll(): void {
        this.cancelled = true;

        // 拒绝所有排队的操作
        while (this.queue.length > 0) {
            const operation = this.queue.shift()!;
            operation.reject(new Error('操作已取消'));
        }
    }

    /**
     * 按 ID 取消特定操作
     */
    cancelOperation(id: string): boolean {
        const index = this.queue.findIndex(op => op.id === id);
        if (index !== -1) {
            const operation = this.queue.splice(index, 1)[0];
            operation.reject(new Error('操作已取消'));
            return true;
        }
        return false;
    }

    /**
     * 获取队列状态
     */
    getStatus() {
        return {
            queueLength: this.queue.length,
            isProcessing: this.processing,
            operationIds: this.queue.map(op => op.id)
        };
    }

    private async processQueue(): Promise<void> {
        if (this.processing || this.queue.length === 0 || this.cancelled) return;

        this.processing = true;
        const totalOperations = this.queue.length;

        while (this.queue.length > 0 && !this.cancelled) {
            const operation = this.queue.shift()!;
            const completedOperations = totalOperations - this.queue.length;
            const progressPercent = Math.round((completedOperations / totalOperations) * 100);

            // 报告进度
            if (this.progressCallback) {
                const message = operation.name
                    ? `正在处理: ${operation.name} (${completedOperations}/${totalOperations})`
                    : `正在处理操作 ${completedOperations}/${totalOperations}`;
                this.progressCallback(message, progressPercent);
            }

            try {
                const result = await operation.execute();
                operation.resolve(result);
            } catch (error) {
                operation.reject(error);
            }
        }

        this.processing = false;
        this.cancelled = false; // 重置取消标志

        // 报告完成
        if (this.progressCallback) {
            this.progressCallback('所有操作已完成', 100);
        }
    }

    private generateId(): string {
        return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

interface QueuedOperation {
    id: string;
    execute: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (error: any) => void;
    name?: string;
}