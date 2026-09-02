import localtunnel from 'localtunnel';

async function main() {
  const tunnel = await localtunnel({ port: 5173, subdomain: 'niche-monteria-pos' });
  console.log('PUBLIC FRONTEND TUNNEL URL:', tunnel.url);

  tunnel.on('close', () => {
    console.log('Frontend Tunnel closed');
  });
}

main().catch(console.error);
