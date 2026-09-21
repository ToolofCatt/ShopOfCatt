import net from 'node:net';

// Chỉ bind IP bridge nội bộ; relay không đọc token/body, không giải mã TLS.
const bind=process.env.TELEGRAM_RELAY_BIND;
if(!bind||bind==='0.0.0.0'||bind==='::')throw new Error('Set a private bridge bind address');
const server=net.createServer(client=>{
  client.setTimeout(65000,()=>client.destroy());
  let header=Buffer.alloc(0);
  const read=data=>{
    header=Buffer.concat([header,data]);
    if(header.length>8192){client.destroy();return;}
    const boundary=header.indexOf('\r\n\r\n');if(boundary<0)return;
    client.removeListener('data',read);
    if(!/^CONNECT api\.telegram\.org:443 HTTP\/1\.[01]\r\n/.test(header.toString('ascii',0,boundary))){client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
    let upstream;
    const sockets=new Set();const timers=[];
    const cleanup=()=>{timers.forEach(clearTimeout);for(const socket of sockets)if(socket!==upstream)socket.destroy();};
    // Đua TCP trước khi có TLS/body: không phát lại POST dù đường truyền chập chờn.
    const connect=family=>{
      if(upstream||client.destroyed)return;
      const socket=net.connect({host:'api.telegram.org',port:443,family});sockets.add(socket);
      socket.on('error',()=>{if(socket===upstream)client.destroy();});
      socket.once('connect',()=>{
        if(upstream||client.destroyed){socket.destroy();return;}
        upstream=socket;cleanup();client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        const rest=header.subarray(boundary+4);if(rest.length)upstream.write(rest);
        client.pipe(upstream);upstream.pipe(client);
        upstream.once('close',()=>client.destroy());
      });
    };
    connect(6);timers.push(setTimeout(()=>connect(4),300),setTimeout(()=>connect(6),1000),setTimeout(()=>connect(4),1500),setTimeout(()=>client.destroy(),7000));
    client.once('close',()=>{cleanup();upstream?.destroy();});
  };
  client.on('error',()=>{});client.on('data',read);
});
server.maxConnections=100;
server.listen(Number(process.env.TELEGRAM_RELAY_PORT??18443),bind);
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
