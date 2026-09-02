import localtunnel from 'localtunnel';

async function main() {
  const tunnel = await localtunnel({ port: 3000 });
  console.log('PUBLIC TUNNEL URL:', tunnel.url);

  tunnel.on('close', () => {
    console.log('Tunnel closed');
  });
}

main().catch(console.error);
