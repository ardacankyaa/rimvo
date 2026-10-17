let workersCreated = 0;
let activeWorkers = 0;
const tracked = new WeakSet<Worker>();

export function createTrackedWorker(url: string | URL, options: WorkerOptions): Worker {
  const worker = new Worker(url, options);
  workersCreated += 1;
  activeWorkers += 1;
  let active = true;
  const terminate = worker.terminate.bind(worker);
  Object.defineProperty(worker, 'terminate', {
    configurable: true,
    value: (): void => {
      if (active) {
        active = false;
        activeWorkers = Math.max(0, activeWorkers - 1);
      }
      terminate();
    },
  });
  tracked.add(worker);
  return worker;
}

export function workerDiagnostics(): Readonly<{ workersCreated: number; activeWorkers: number }> {
  return Object.freeze({ workersCreated, activeWorkers });
}
