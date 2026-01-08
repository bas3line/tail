import { Worker } from "worker_threads";
import { cpus } from "os";
import { createLogger } from "@tails/logger";
import path from "path";
import { EventEmitter } from "events";

const log = createLogger("worker-pool");

export interface WorkerTask<T = any, R = any> {
  id: string;
  type: string;
  data: T;
  resolve: (value: R) => void;
  reject: (error: Error) => void;
  timeout?: number;
  priority?: number;
}

interface WorkerInfo {
  worker: Worker;
  busy: boolean;
  currentTask: string | null;
  tasksCompleted: number;
  errors: number;
  lastActivity: number;
}

export class WorkerPool extends EventEmitter {
  private workers: Map<number, WorkerInfo> = new Map();
  private taskQueue: WorkerTask[] = [];
  private workerScript: string;
  private maxWorkers: number;
  private minWorkers: number;
  private idleTimeout: number;
  private taskTimeout: number;
  private isShuttingDown = false;

  constructor(options: {
    workerScript: string;
    maxWorkers?: number;
    minWorkers?: number;
    idleTimeout?: number;
    taskTimeout?: number;
  }) {
    super();
    this.workerScript = options.workerScript;
    this.maxWorkers = options.maxWorkers || cpus().length;
    this.minWorkers = options.minWorkers || Math.max(1, Math.floor(cpus().length / 2));
    this.idleTimeout = options.idleTimeout || 30000; // 30 seconds
    this.taskTimeout = options.taskTimeout || 60000; // 60 seconds

    // Start minimum workers
    for (let i = 0; i < this.minWorkers; i++) {
      this.spawnWorker();
    }

    // Periodic cleanup of idle workers
    setInterval(() => this.cleanupIdleWorkers(), this.idleTimeout);

    log.info("Worker pool initialized", {
      maxWorkers: this.maxWorkers,
      minWorkers: this.minWorkers,
      script: this.workerScript,
    });
  }

  private spawnWorker(): number {
    const workerId = Date.now() + Math.random();
    
    const worker = new Worker(this.workerScript, {
      workerData: { workerId },
    });

    const workerInfo: WorkerInfo = {
      worker,
      busy: false,
      currentTask: null,
      tasksCompleted: 0,
      errors: 0,
      lastActivity: Date.now(),
    };

    worker.on("message", (result) => {
      this.handleWorkerMessage(workerId, result);
    });

    worker.on("error", (error) => {
      log.error("Worker error", error, { workerId });
      workerInfo.errors++;
      this.handleWorkerError(workerId, error);
    });

    worker.on("exit", (code) => {
      log.debug("Worker exited", { workerId, code });
      this.workers.delete(workerId);
      
      // Respawn if below minimum and not shutting down
      if (!this.isShuttingDown && this.workers.size < this.minWorkers) {
        this.spawnWorker();
      }
    });

    this.workers.set(workerId, workerInfo);
    log.debug("Worker spawned", { workerId, totalWorkers: this.workers.size });

    return workerId;
  }

  private handleWorkerMessage(workerId: number, result: { taskId: string; success: boolean; data?: any; error?: string }) {
    const workerInfo = this.workers.get(workerId);
    if (!workerInfo) return;

    workerInfo.busy = false;
    workerInfo.currentTask = null;
    workerInfo.lastActivity = Date.now();
    workerInfo.tasksCompleted++;

    // Find and resolve the task
    const taskIndex = this.taskQueue.findIndex((t) => t.id === result.taskId);
    if (taskIndex === -1) {
      // Task might have been removed due to timeout
      return;
    }

    const [task] = this.taskQueue.splice(taskIndex, 1);

    if (result.success) {
      task.resolve(result.data);
    } else {
      task.reject(new Error(result.error || "Task failed"));
    }

    // Process next task
    this.processQueue();
  }

  private handleWorkerError(workerId: number, error: Error) {
    const workerInfo = this.workers.get(workerId);
    if (!workerInfo) return;

    // Reject current task if any
    if (workerInfo.currentTask) {
      const taskIndex = this.taskQueue.findIndex((t) => t.id === workerInfo.currentTask);
      if (taskIndex !== -1) {
        const [task] = this.taskQueue.splice(taskIndex, 1);
        task.reject(error);
      }
    }

    // Terminate and respawn worker
    workerInfo.worker.terminate();
    this.workers.delete(workerId);

    if (!this.isShuttingDown && this.workers.size < this.minWorkers) {
      this.spawnWorker();
    }

    this.processQueue();
  }

  private cleanupIdleWorkers() {
    const now = Date.now();
    
    for (const [workerId, info] of this.workers) {
      if (
        !info.busy &&
        this.workers.size > this.minWorkers &&
        now - info.lastActivity > this.idleTimeout
      ) {
        log.debug("Terminating idle worker", { workerId });
        info.worker.terminate();
        this.workers.delete(workerId);
      }
    }
  }

  private getAvailableWorker(): WorkerInfo | null {
    for (const info of this.workers.values()) {
      if (!info.busy) {
        return info;
      }
    }
    return null;
  }

  private processQueue() {
    if (this.taskQueue.length === 0) return;
    if (this.isShuttingDown) return;

    // Sort by priority (higher first)
    this.taskQueue.sort((a, b) => (b.priority || 0) - (a.priority || 0));

    // Find tasks that haven't been assigned yet
    const pendingTasks = this.taskQueue.filter((t) => {
      for (const info of this.workers.values()) {
        if (info.currentTask === t.id) return false;
      }
      return true;
    });

    for (const task of pendingTasks) {
      let worker = this.getAvailableWorker();

      // Spawn new worker if needed and under limit
      if (!worker && this.workers.size < this.maxWorkers) {
        this.spawnWorker();
        worker = this.getAvailableWorker();
      }

      if (worker) {
        worker.busy = true;
        worker.currentTask = task.id;
        worker.lastActivity = Date.now();

        worker.worker.postMessage({
          taskId: task.id,
          type: task.type,
          data: task.data,
        });

        // Set timeout for task
        const timeout = task.timeout || this.taskTimeout;
        setTimeout(() => {
          if (worker?.currentTask === task.id) {
            log.warn("Task timeout", { taskId: task.id, type: task.type });
            const taskIndex = this.taskQueue.findIndex((t) => t.id === task.id);
            if (taskIndex !== -1) {
              const [timedOutTask] = this.taskQueue.splice(taskIndex, 1);
              timedOutTask.reject(new Error("Task timeout"));
            }
            // Reset worker state
            worker.busy = false;
            worker.currentTask = null;
          }
        }, timeout);
      } else {
        // No workers available, task stays in queue
        break;
      }
    }
  }

  /**
   * Execute a task in the worker pool
   */
  async execute<T, R>(type: string, data: T, options?: { timeout?: number; priority?: number }): Promise<R> {
    if (this.isShuttingDown) {
      throw new Error("Worker pool is shutting down");
    }

    return new Promise((resolve, reject) => {
      const task: WorkerTask<T, R> = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type,
        data,
        resolve,
        reject,
        timeout: options?.timeout,
        priority: options?.priority,
      };

      this.taskQueue.push(task);
      this.processQueue();
    });
  }

  /**
   * Get pool statistics
   */
  getStats() {
    let busyWorkers = 0;
    let totalTasksCompleted = 0;
    let totalErrors = 0;

    for (const info of this.workers.values()) {
      if (info.busy) busyWorkers++;
      totalTasksCompleted += info.tasksCompleted;
      totalErrors += info.errors;
    }

    return {
      totalWorkers: this.workers.size,
      busyWorkers,
      idleWorkers: this.workers.size - busyWorkers,
      queuedTasks: this.taskQueue.length,
      totalTasksCompleted,
      totalErrors,
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(timeout = 10000): Promise<void> {
    this.isShuttingDown = true;
    log.info("Shutting down worker pool...");

    // Wait for current tasks to complete
    const deadline = Date.now() + timeout;
    
    while (this.taskQueue.length > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Reject remaining tasks
    for (const task of this.taskQueue) {
      task.reject(new Error("Worker pool shutdown"));
    }
    this.taskQueue = [];

    // Terminate all workers
    const terminatePromises: Promise<number>[] = [];
    for (const [workerId, info] of this.workers) {
      terminatePromises.push(info.worker.terminate());
    }

    await Promise.all(terminatePromises);
    this.workers.clear();

    log.info("Worker pool shut down");
  }
}

// Singleton pools for different task types
let imagePool: WorkerPool | null = null;
let pdfPool: WorkerPool | null = null;
let generalPool: WorkerPool | null = null;
let qrcodePool: WorkerPool | null = null;
let videoPool: WorkerPool | null = null;

// Determine worker directory based on environment
function getWorkerPath(workerName: string): string {
  // In production (built), workers are in dist/workers
  // In development, use the source files directly with bun
  const isDev = process.env.NODE_ENV !== "production";
  
  if (isDev) {
    // Bun can run TypeScript directly in development
    return path.join(__dirname, `${workerName}.ts`);
  }
  
  // Production: use compiled JS files
  // __dirname in the built output will be dist/, workers are in dist/workers/
  return path.join(__dirname, "workers", `${workerName}.js`);
}

export function getImagePool(): WorkerPool {
  if (!imagePool) {
    imagePool = new WorkerPool({
      workerScript: getWorkerPath("image.worker"),
      maxWorkers: Math.max(2, Math.floor(cpus().length / 2)),
      minWorkers: 1,
    });
  }
  return imagePool;
}

export function getPdfPool(): WorkerPool {
  if (!pdfPool) {
    pdfPool = new WorkerPool({
      workerScript: getWorkerPath("pdf.worker"),
      maxWorkers: Math.max(2, Math.floor(cpus().length / 2)),
      minWorkers: 1,
    });
  }
  return pdfPool;
}

export function getGeneralPool(): WorkerPool {
  if (!generalPool) {
    generalPool = new WorkerPool({
      workerScript: getWorkerPath("general.worker"),
      maxWorkers: cpus().length,
      minWorkers: 2,
    });
  }
  return generalPool;
}

export function getQRCodePool(): WorkerPool {
  if (!qrcodePool) {
    qrcodePool = new WorkerPool({
      workerScript: getWorkerPath("qrcode.worker"),
      maxWorkers: Math.max(2, Math.floor(cpus().length / 2)),
      minWorkers: 1,
    });
  }
  return qrcodePool;
}

export function getVideoPool(): WorkerPool {
  if (!videoPool) {
    videoPool = new WorkerPool({
      workerScript: getWorkerPath("video.worker"),
      maxWorkers: Math.max(2, Math.floor(cpus().length / 4)), // Video downloads are I/O bound
      minWorkers: 1,
      taskTimeout: 300000, // 5 minutes for video downloads
    });
  }
  return videoPool;
}

// Cleanup on process exit
process.on("SIGTERM", async () => {
  await Promise.all([
    imagePool?.shutdown(),
    pdfPool?.shutdown(),
    generalPool?.shutdown(),
    qrcodePool?.shutdown(),
    videoPool?.shutdown(),
  ]);
});

process.on("SIGINT", async () => {
  await Promise.all([
    imagePool?.shutdown(),
    pdfPool?.shutdown(),
    generalPool?.shutdown(),
    qrcodePool?.shutdown(),
    videoPool?.shutdown(),
  ]);
});

