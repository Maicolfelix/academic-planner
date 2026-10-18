import net from 'node:net';

// Entry point of `assertPortsFree`: prints the ports (argv) that something is already listening on, one per line, exit 0.
const ports = process.argv.slice(2).map(Number);

const listening = (port: number, host: string) =>
  new Promise<boolean>((resolve) => {
    const socket = net.connect({ port, host });
    const done = (busy: boolean) => {
      socket.destroy();
      resolve(busy);
    };
    socket.setTimeout(800, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });

const busy: number[] = [];
for (const port of ports)
  if ((await listening(port, '127.0.0.1')) || (await listening(port, '::1'))) busy.push(port);
console.log(busy.join('\n'));
