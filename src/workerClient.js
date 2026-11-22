// Worker 客户端：封装消息往返与任务队列，主线程用 Promise 调用
export class PathWorkerClient {
  constructor(url) {
    this.worker = new Worker(url, { type: 'module' });
    this.seq = 0;
    this.pending = new Map();
    this.worker.onmessage = (e) => {
      const { id, results, error } = e.data;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (error) p.reject(new Error(error));
      else p.resolve(results);
    };
    this.worker.onerror = (err) => {
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
  }

  search(data, variants) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, data, variants });
    });
  }

  dispose() {
    this.worker.terminate();
    this.pending.clear();
  }
}
