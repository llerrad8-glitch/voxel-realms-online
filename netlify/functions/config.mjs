// Tells the browser where the game server lives, so the URL never has to be hard-coded.
// Set GAME_SERVER_URL in Netlify > Site configuration > Environment variables, then redeploy.
export default async () =>
  new Response(JSON.stringify({ server: process.env.GAME_SERVER_URL || '' }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export const config = { path: '/api/config' };
