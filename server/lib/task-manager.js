const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

class TaskManager extends EventEmitter {
  constructor(maxConcurrent = 2) {
    super();
    this.tasks = new Map();
    this.maxConcurrent = maxConcurrent;
    this.activeTasks = 0;
    this.queue = [];
  }

  createTask(url, options = {}) {
    const id = uuidv4();
    const taskOptions = { ...options, taskId: id };
    const task = {
      id,
      url,
      options: taskOptions,
      status: 'pending',
      progress: 0,
      stage: 'queued',
      outputPath: null,
      error: null,
      logs: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      childProcess: null,
    };

    this.tasks.set(id, task);
    this.queue.push(id);
    this.emit('task:update', id, this.getTask(id));
    this._processQueue();
    return id;
  }

  updateTask(id, updates) {
    const task = this.tasks.get(id);
    if (!task) return false;

    Object.assign(task, updates, { updatedAt: new Date() });
    this.emit('task:update', id, this.getTask(id));

    if (['done', 'error'].includes(task.status)) {
      this.activeTasks = Math.max(0, this.activeTasks - 1);
      this._processQueue();
    }

    return true;
  }

  addLog(id, message) {
    const task = this.tasks.get(id);
    if (!task) return;
    const timestamp = new Date().toLocaleTimeString('vi-VN');
    const logEntry = `[${timestamp}] ${message}`;
    task.logs.push(logEntry);
    // Giữ tối đa 50 dòng log
    if (task.logs.length > 50) task.logs.shift();
    task.updatedAt = new Date();
    this.emit('task:update', id, this.getTask(id));
  }

  getTask(id) {
    const task = this.tasks.get(id);
    if (!task) return null;
    const { childProcess, ...safeTask } = task;
    return safeTask;
  }

  getAllTasks() {
    return Array.from(this.tasks.values()).map((task) => {
      const { childProcess, ...safeTask } = task;
      return safeTask;
    });
  }

  clearCompletedTasks() {
    let clearedCount = 0;
    for (const [id, task] of this.tasks.entries()) {
      if (task.status === 'done') {
        this.tasks.delete(id);
        clearedCount++;
      }
    }
    return clearedCount > 0;
  }

  cancelTask(id) {
    const task = this.tasks.get(id);
    if (!task) return false;

    if (task.childProcess) {
      try {
        task.childProcess.kill('SIGTERM');
      } catch (err) {
        console.error(`Error killing process for task ${id}:`, err);
      }
    }

    this.queue = this.queue.filter((taskId) => taskId !== id);
    this.addLog(id, 'Đã hủy bởi người dùng');
    this.updateTask(id, { status: 'error', error: 'Đã hủy bởi người dùng' });
    return true;
  }

  _processQueue() {
    if (this.activeTasks >= this.maxConcurrent || this.queue.length === 0) return;
    const nextTaskId = this.queue.shift();
    this.activeTasks++;
    this.emit('task:start', nextTaskId);
  }
}

module.exports = TaskManager;
