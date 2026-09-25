import {Runner} from './runner.mjs';

// One entry point for the browser and headless worker tests.
let send, listen;
if (typeof self !== 'undefined') {
  send = message => self.postMessage(message);
  listen = callback => { self.onmessage = e => callback(e.data); };
} else {
  const {parentPort} = await import('node:worker_threads');
  send = message => parentPort.postMessage(message);
  listen = callback => parentPort.on('message', callback);
}

const runner = new Runner();
let running = true, rate = 40, credit = 0, last = performance.now();
let epoch = 0, measureStart = last, measuredSteps = 0, actualRate = 0;

listen(message => {
  const {id, type} = message;
  try {
    if (type === 'reset') {
      runner.reset(message.config);
      epoch++; credit = 0; last = performance.now();
      measuredSteps = 0; measureStart = last; actualRate = 0;
    } else if (type === 'running') {
      running = Boolean(message.value); credit = 0; last = performance.now();
      actualRate = 0; measuredSteps = 0; measureStart = last;
    } else if (type === 'rate') {
      if (![10, 40, 160, 0].includes(message.value)) throw Error('Невідома швидкість');
      rate = message.value; credit = 0; last = performance.now();
    } else if (type === 'step') {
      running = false; credit = 0; actualRate = 0;
      runner.advance(1);
    } else if (type !== 'snapshot' && type !== 'export') {
      throw Error('Невідома команда');
    }
    const result = runner.snapshot(type === 'snapshot' && message.includeWorld !== false, message.selected);
    send({id, epoch, running, rate, actualRate, ...result});
  } catch (error) {
    send({id, error: error.message});
  }
});

function pump() {
  const now = performance.now();
  const elapsed = Math.min(250, now - last); last = now;
  if (running) {
    if (rate) credit = Math.min(rate * 0.25, credit + elapsed * rate / 1000);
    const deadline = now + 12;
    // Bounded batches keep pause/reset responsive even in unlimited mode.
    while ((rate === 0 || credit >= 1) && performance.now() < deadline) {
      runner.advance(); measuredSteps++;
      if (rate) credit--;
    }
  }
  if (now - measureStart >= 500) {
    actualRate = running ? measuredSteps * 1000 / (now - measureStart) : 0;
    measuredSteps = 0; measureStart = now;
  }
  setTimeout(pump, running && rate === 0 ? 0 : 4);
}
pump();
