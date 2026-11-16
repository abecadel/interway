/// <reference lib="webworker" />
// Routing runs in a worker so the UI stays responsive and everything works offline once data is cached.
import { RoutingService, type WorkerRequest } from './service';

const service = new RoutingService();
self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  self.postMessage(await service.respond(ev.data));
};
