/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // 8th Wall gère son propre cycle caméra : éviter le double-mount de StrictMode
  async headers() {
    return [
      {
        // .glb servi avec le bon MIME
        source: '/:path*.glb',
        headers: [{ key: 'Content-Type', value: 'model/gltf-binary' }],
      },
    ]
  },
}

module.exports = nextConfig
